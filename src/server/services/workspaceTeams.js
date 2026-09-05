import { check } from '../utils/authzReBAC.js';
import { UUID_RE } from '../utils/workspaceContext.js';
import { withTransaction } from './chatProjectAuthority.js';

const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };
function uuid(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) fail(400, 'invalid_id', 'A valid identifier is required');
  return value.toLowerCase();
}
export function validateTeamInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_team', 'Team details are required');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120) fail(400, 'invalid_team', 'Use a team name between 1 and 120 characters');
  if (typeof input.description !== 'string' || input.description.length > 2000) fail(400, 'invalid_team', 'Description must be at most 2,000 characters');
  const ids = (value) => {
    if (!Array.isArray(value) || value.length > 200) fail(400, 'invalid_assignment', 'Provide at most 200 assignments');
    return [...new Set(value.map(uuid))];
  };
  return { name: input.name.trim(), description: input.description.trim(), projectIds: ids(input.project_ids), agentIds: ids(input.agent_ids) };
}
async function authorize(db, workspaceId, userId, relation) {
  uuid(workspaceId); uuid(userId);
  const allowed = await check(db, { object: `workspace:${workspaceId}`, relation, subject: `user:${userId}` });
  if (!allowed.allowed) fail(403, 'workspace_access_denied', relation === 'admin' ? 'Workspace admin access is required' : 'Workspace access denied');
}
async function teamRows(db, workspaceId) {
  return (await db.query(`SELECT t.*,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'is_archived',p.is_archived) ORDER BY p.name)
      FROM workspace_team_projects tp JOIN chat_projects p ON p.id=tp.project_id WHERE tp.team_id=t.id), '[]'::jsonb) AS projects,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.user_id,'name',u.display_name,'status',a.status) ORDER BY u.display_name)
      FROM workspace_team_agents ta JOIN agent_identities a ON a.user_id=ta.agent_id JOIN users u ON u.id=a.user_id
      WHERE ta.team_id=t.id), '[]'::jsonb) AS agents
    FROM workspace_teams t WHERE t.workspace_id=$1 AND t.archived_at IS NULL ORDER BY lower(t.name),t.id`, [workspaceId])).rows;
}
export async function listWorkspaceTeams(db, workspaceId, userId) {
  await authorize(db, workspaceId, userId, 'viewer');
  const canManage = (await check(db, { object: `workspace:${workspaceId}`, relation: 'admin', subject: `user:${userId}` })).allowed;
  const teams = await teamRows(db, workspaceId);
  // Only the owner may newly assign a canonical agent. Assignment grants no execution authority.
  const availableAgents = canManage ? (await db.query(`SELECT a.user_id AS id,u.display_name AS name
    FROM agent_identities a JOIN users u ON u.id=a.user_id WHERE a.owner_user_id=$1 AND a.status='active'
    AND NOT EXISTS (SELECT 1 FROM workspace_team_agents ta WHERE ta.workspace_id=$2 AND ta.agent_id=a.user_id)
    ORDER BY u.display_name,a.user_id`, [userId, workspaceId])).rows : [];
  const projects = (await db.query(`SELECT id,name FROM chat_projects WHERE workspace_id=$1 AND is_archived=false ORDER BY name,id`, [workspaceId])).rows;
  return { teams, projects, available_agents: availableAgents, can_manage: canManage };
}
export async function saveWorkspaceTeam(db, { workspaceId, userId, teamId = null, input, archive = false }) {
  uuid(workspaceId); uuid(userId);
  if (teamId) uuid(teamId);
  if (archive && !teamId) fail(400, 'invalid_id', 'Team id is required');
  const data = archive ? null : validateTeamInput(input);
  if (teamId && (!Number.isSafeInteger(input?.version) || input.version < 1)) fail(400, 'invalid_version', 'The current team version is required');
  try {
    return await withTransaction(db, async (tx) => {
      // Same lock used by membership changes: revocation and team writes cannot race.
      await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId]);
      await authorize(tx, workspaceId, userId, 'admin');
      const previous = teamId ? (await tx.query('SELECT * FROM workspace_teams WHERE id=$1 AND workspace_id=$2 AND archived_at IS NULL FOR UPDATE', [teamId, workspaceId])).rows[0] : null;
      if (teamId && !previous) fail(404, 'team_not_found', 'Team not found in this workspace');
      if (previous && previous.version !== input.version) fail(409, 'team_version_conflict', 'This team changed in another session. Refresh before saving.');
      if (archive) {
        await tx.query('DELETE FROM workspace_team_projects WHERE team_id=$1', [teamId]);
        await tx.query('DELETE FROM workspace_team_agents WHERE team_id=$1', [teamId]);
        await tx.query('UPDATE workspace_teams SET archived_at=now(),updated_at=now(),version=version+1 WHERE id=$1', [teamId]);
      } else {
        const projects = (await tx.query(`SELECT id FROM chat_projects WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND is_archived=false FOR SHARE`, [workspaceId, data.projectIds])).rows;
        if (projects.length !== data.projectIds.length) fail(400, 'invalid_project_assignment', 'Projects must be active and belong to this workspace');
        const agents = (await tx.query(`SELECT a.user_id FROM agent_identities a WHERE a.user_id=ANY($1::uuid[]) AND a.status='active'
          AND (a.owner_user_id=$2 OR EXISTS (SELECT 1 FROM workspace_team_agents ta WHERE ta.team_id=$3 AND ta.agent_id=a.user_id)) FOR SHARE`, [data.agentIds, userId, teamId])).rows;
        if (agents.length !== data.agentIds.length) fail(400, 'invalid_agent_assignment', 'New assignments require active agents owned by you');
        if (previous) {
          await tx.query('UPDATE workspace_teams SET name=$2,description=$3,version=version+1,updated_at=now() WHERE id=$1', [teamId, data.name, data.description]);
        } else {
          teamId = (await tx.query('INSERT INTO workspace_teams(workspace_id,name,description) VALUES($1,$2,$3) RETURNING id', [workspaceId, data.name, data.description])).rows[0].id;
        }
        await tx.query('DELETE FROM workspace_team_projects WHERE team_id=$1', [teamId]);
        for (const projectId of data.projectIds) await tx.query('INSERT INTO workspace_team_projects(workspace_id,team_id,project_id) VALUES($1,$2,$3)', [workspaceId, teamId, projectId]);
        await tx.query('DELETE FROM workspace_team_agents WHERE team_id=$1', [teamId]);
        for (const agentId of data.agentIds) await tx.query('INSERT INTO workspace_team_agents(workspace_id,team_id,agent_id) VALUES($1,$2,$3)', [workspaceId, teamId, agentId]);
      }
      await tx.query(`INSERT INTO workspace_audit(workspace_id,actor_user_id,action,target,metadata) VALUES($1,$2,$3,$4,$5::jsonb)`,
        [workspaceId, userId, archive ? 'team.archived' : previous ? 'team.updated' : 'team.created', `team:${teamId}`, JSON.stringify(archive ? { previous_version: previous.version } : { name: data.name, project_ids: data.projectIds, agent_ids: data.agentIds, previous_version: previous?.version ?? null })]);
      return { id: teamId };
    });
  } catch (error) {
    if (error.code === '23505') fail(409, 'team_assignment_conflict', 'A team with this name exists, or an agent is already assigned to another team. Refresh and try again.');
    throw error;
  }
}

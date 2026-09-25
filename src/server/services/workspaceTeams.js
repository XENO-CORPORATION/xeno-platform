/**
 * Workspace teams -- on the ONE canonical team model (XENO-WORKFORCE-01 D21, decided 2026-09-25).
 *
 * This module used to own a second team model (`workspace_teams`, `workspace_team_projects`,
 * `workspace_team_agents`), built eighteen days before `workforce_resources` kind='team' and linked
 * to it by nothing (spec evidence E16). D21 made the workforce model canonical, and
 * 20260925110000-workforce-team-project-responsibility.sql absorbed the old tables into it. The HTTP
 * contract at /api/workspaces/:id/teams and the /overview/teams page are unchanged; what a team IS
 * underneath is now the canonical record, so a workspace team can also be lent to another workspace,
 * carry humans as well as agents, and keeps its history instead of being rewritten on every save.
 *
 * How the page's concepts map (ASN-02, ASN-04, ASN-05, ASN-09):
 *   a team               a workforce_resources kind='team' OWNED BY the workspace
 *   "in this workspace"  one ACCEPTED self-assignment into the workspace, policy `none`. Both ASN-04
 *                        checks are made by this workspace's admin and both are recorded.
 *   assigned agents      active workforce_team_memberships, function `worker`, whose member is the
 *                        agent's canonical principal -- captured as the assignment's approved member set
 *   assigned projects    workforce_project_participations (resource_kind='team'), one per project,
 *                        bound to that assignment; ASN-02's explicit team->project record
 *
 * 🔴 NOTHING HERE GRANTS EXECUTION. The page has always said "assignments organize work; existing
 * membership, execution permissions, and filesystem access remain unchanged", and every record this
 * writes carries policy `none`. A capability is only ever granted by a deliberate assignment policy.
 *
 * A save is RETAINED HISTORY, never delete-and-reinsert: a removed agent's membership is revoked and a
 * removed project's participation is ended, both keeping their rows. A change to the member set is a
 * new approved member set on the same assignment, captured and admitted by the same admin in one
 * transaction -- the D02 path, where the target and the source are the same workspace.
 */
import { check } from '../utils/authzReBAC.js';
import { UUID_RE } from '../utils/workspaceContext.js';
import { withTransaction } from './chatProjectAuthority.js';
import { lockWorkspaceAuthority } from './workspaceOperationReceipts.js';

const NONE = Object.freeze({ schemaVersion: 1, mode: 'none', capabilities: [] });
const RESPONSIBILITY = 'assigned team';

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

/** The live self-assignment that puts a workspace-owned team "in" its workspace, or null. */
async function selfAssignment(db, workspaceId, teamId, lock = '') {
  return (await db.query(`SELECT * FROM workforce_workspace_assignments
    WHERE resource_id=$1 AND workspace_id=$2 AND source_owner_workspace_id=$2 AND target_division_id IS NULL
      AND state='accepted' ORDER BY created_at DESC LIMIT 1 ${lock}`, [teamId, workspaceId])).rows[0] ?? null;
}

async function teamRows(db, workspaceId) {
  // A team is listed once per workspace it is live in; `version` is the resource revision the page
  // round-trips for its optimistic check. Agents are the ACTIVE memberships; projects are the ACTIVE
  // participations on this workspace's self-assignment.
  return (await db.query(`SELECT r.id, $1::uuid AS workspace_id, r.name, r.description, r.revision::int AS version,
      r.created_at, r.updated_at,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'is_archived',p.is_archived) ORDER BY p.name, p.id)
        FROM workforce_project_participations pp JOIN chat_projects p ON p.id=pp.project_id
        WHERE pp.resource_id=r.id AND pp.assignment_id=a.id AND pp.state='active'), '[]'::jsonb) AS projects,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ai.user_id,'name',u.display_name,'status',ai.status) ORDER BY u.display_name, ai.user_id)
        FROM workforce_team_memberships m JOIN agent_identities ai ON ai.user_id=m.member_principal_id JOIN users u ON u.id=ai.user_id
        WHERE m.team_id=r.id AND m.state='active'), '[]'::jsonb) AS agents
    FROM workforce_resources r
    JOIN workforce_workspace_assignments a ON a.resource_id=r.id AND a.workspace_id=$1 AND a.source_owner_workspace_id=$1
      AND a.target_division_id IS NULL AND a.state='accepted'
    WHERE r.kind='team' AND r.owner_workspace_id=$1 AND r.status='active'
    ORDER BY lower(r.name), r.id`, [workspaceId])).rows;
}

export async function listWorkspaceTeams(db, workspaceId, userId) {
  await authorize(db, workspaceId, userId, 'viewer');
  const canManage = (await check(db, { object: `workspace:${workspaceId}`, relation: 'admin', subject: `user:${userId}` })).allowed;
  const teams = await teamRows(db, workspaceId);
  // Only the owner may newly assign a canonical agent, and an agent belongs to one team per workspace
  // on this page. Assignment grants no execution authority.
  const availableAgents = canManage ? (await db.query(`SELECT a.user_id AS id,u.display_name AS name
    FROM agent_identities a JOIN users u ON u.id=a.user_id WHERE a.owner_user_id=$1 AND a.status='active'
    AND NOT EXISTS (SELECT 1 FROM workforce_team_memberships m JOIN workforce_resources t ON t.id=m.team_id
      WHERE m.member_principal_id=a.user_id AND m.state='active' AND t.owner_workspace_id=$2 AND t.status='active')
    ORDER BY u.display_name,a.user_id`, [userId, workspaceId])).rows : [];
  const projects = (await db.query(`SELECT id,name FROM chat_projects WHERE workspace_id=$1 AND is_archived=false ORDER BY name,id`, [workspaceId])).rows;
  return { teams, projects, available_agents: availableAgents, can_manage: canManage };
}

/** Capture the team's CURRENT active memberships as the assignment's next approved member set. */
async function captureMemberSet(tx, assignment, teamId, workspaceId, userId, { admit }) {
  const revision = (await tx.query('SELECT team_membership_revision FROM workforce_resources WHERE id=$1', [teamId])).rows[0].team_membership_revision;
  const members = (await tx.query(`SELECT id, revision, role FROM workforce_team_memberships WHERE team_id=$1 AND state='active' ORDER BY id`, [teamId])).rows;
  const snapshot = admit
    ? Number((await tx.query('SELECT COALESCE(max(snapshot_revision),0)+1 AS n FROM workforce_assignment_member_sets WHERE assignment_id=$1', [assignment.id])).rows[0].n)
    : Number(assignment.member_set_revision);
  await tx.query(`INSERT INTO workforce_assignment_member_sets(assignment_id,snapshot_revision,team_id,workspace_id,
      team_membership_revision,member_count,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [assignment.id, snapshot, teamId, workspaceId, revision, members.length, userId]);
  for (const m of members) {
    await tx.query(`INSERT INTO workforce_assignment_members(assignment_id,snapshot_revision,team_id,membership_id,membership_revision,role)
      VALUES($1,$2,$3,$4,$5,$6)`, [assignment.id, snapshot, teamId, m.id, m.revision, m.role]);
  }
  // A later set is only effective once the TARGET admits it (D02). Source and target are the same
  // workspace here, so the same admin admits it -- as a separate, recorded act.
  if (admit) {
    await tx.query(`UPDATE workforce_assignment_member_sets SET admitted_at=clock_timestamp(), admitted_by_user_id=$3
      WHERE assignment_id=$1 AND snapshot_revision=$2`, [assignment.id, snapshot, userId]);
  }
}

export async function saveWorkspaceTeam(db, { workspaceId, userId, teamId = null, input, archive = false }) {
  uuid(workspaceId); uuid(userId);
  if (teamId) uuid(teamId);
  if (archive && !teamId) fail(400, 'invalid_id', 'Team id is required');
  const data = archive ? null : validateTeamInput(input);
  if (teamId && (!Number.isSafeInteger(input?.version) || input.version < 1)) fail(400, 'invalid_version', 'The current team version is required');
  try {
    return await withTransaction(db, async (tx) => {
      // The workspace authority gate first -- the lock order every workforce writer uses -- then the
      // workspace row, which also serializes with membership changes and revocation.
      await lockWorkspaceAuthority(tx, workspaceId);
      await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId]);
      await authorize(tx, workspaceId, userId, 'admin');
      const previous = teamId ? (await tx.query(`SELECT * FROM workforce_resources
        WHERE id=$1 AND kind='team' AND owner_workspace_id=$2 AND status='active' FOR UPDATE`, [teamId, workspaceId])).rows[0] : null;
      if (teamId && !previous) fail(404, 'team_not_found', 'Team not found in this workspace');
      if (previous && Number(previous.revision) !== input.version) fail(409, 'team_version_conflict', 'This team changed in another session. Refresh before saving.');
      const assignment = previous ? await selfAssignment(tx, workspaceId, teamId, 'FOR UPDATE') : null;
      if (previous && !assignment) fail(404, 'team_not_found', 'Team not found in this workspace');

      if (archive) {
        // Retained, never deleted: end the project responsibilities, revoke the self-assignment, archive
        // the team. Memberships stay as history; the archived team admits nobody new (OWN-06).
        await tx.query(`UPDATE workforce_project_participations SET state='ended', revision=revision+1, ended_at=clock_timestamp(),
          ended_by_user_id=$2 WHERE assignment_id=$1 AND state='active'`, [assignment.id, userId]);
        await tx.query(`UPDATE workforce_workspace_assignments SET state='revoked', revision=revision+1, revoked_at=clock_timestamp(),
          updated_at=clock_timestamp() WHERE id=$1`, [assignment.id]);
        await tx.query(`UPDATE workforce_resources SET status='archived', revision=revision+1, updated_at=clock_timestamp() WHERE id=$1`, [teamId]);
      } else {
        const projects = (await tx.query(`SELECT id FROM chat_projects WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND is_archived=false FOR SHARE`, [workspaceId, data.projectIds])).rows;
        if (projects.length !== data.projectIds.length) fail(400, 'invalid_project_assignment', 'Projects must be active and belong to this workspace');
        const currentAgents = previous ? (await tx.query(`SELECT member_principal_id AS id FROM workforce_team_memberships
          WHERE team_id=$1 AND state='active' AND member_principal_id IS NOT NULL`, [teamId])).rows.map((r) => r.id) : [];
        const agents = (await tx.query(`SELECT a.user_id FROM agent_identities a WHERE a.user_id=ANY($1::uuid[]) AND a.status='active'
          AND (a.owner_user_id=$2 OR a.user_id=ANY($3::uuid[])) FOR SHARE`, [data.agentIds, userId, currentAgents])).rows;
        if (agents.length !== data.agentIds.length) fail(400, 'invalid_agent_assignment', 'New assignments require active agents owned by you');
        // One team per agent per workspace, as the page has always promised.
        const elsewhere = (await tx.query(`SELECT 1 FROM workforce_team_memberships m JOIN workforce_resources t ON t.id=m.team_id
          WHERE m.member_principal_id=ANY($1::uuid[]) AND m.state='active' AND t.owner_workspace_id=$2 AND t.status='active'
            AND t.id IS DISTINCT FROM $3::uuid LIMIT 1`, [data.agentIds, workspaceId, teamId])).rowCount;
        if (elsewhere) fail(409, 'team_assignment_conflict', 'A team with this name exists, or an agent is already assigned to another team. Refresh and try again.');
        const clash = (await tx.query(`SELECT 1 FROM workforce_resources WHERE kind='team' AND owner_workspace_id=$1 AND status='active'
          AND lower(name)=lower($2) AND id IS DISTINCT FROM $3::uuid LIMIT 1`, [workspaceId, data.name, teamId])).rowCount;
        if (clash) fail(409, 'team_assignment_conflict', 'A team with this name exists, or an agent is already assigned to another team. Refresh and try again.');

        let current = assignment;
        if (previous) {
          if (previous.name !== data.name || previous.description !== data.description) {
            await tx.query(`UPDATE workforce_resources SET name=$2, description=$3, revision=revision+1, updated_at=clock_timestamp() WHERE id=$1`,
              [teamId, data.name, data.description]);
          } else {
            // The page's optimistic check is the resource revision, so every confirmed save advances it.
            await tx.query('UPDATE workforce_resources SET revision=revision+1, updated_at=clock_timestamp() WHERE id=$1', [teamId]);
          }
        } else {
          teamId = (await tx.query(`INSERT INTO workforce_resources(kind, owner_workspace_id, created_by_user_id, name, description)
            VALUES('team', $1, $2, $3, $4) RETURNING id`, [workspaceId, userId, data.name, data.description])).rows[0].id;
        }

        // Members: revoke those removed, add those new. History is kept; nothing is deleted.
        const wanted = new Set(data.agentIds);
        for (const id of currentAgents.filter((a) => !wanted.has(a))) {
          await tx.query(`UPDATE workforce_team_memberships SET state='revoked', revision=revision+1, revoked_at=clock_timestamp(),
            updated_at=clock_timestamp() WHERE team_id=$1 AND member_principal_id=$2 AND state='active'`, [teamId, id]);
        }
        for (const id of data.agentIds.filter((a) => !currentAgents.includes(a))) {
          await tx.query(`INSERT INTO workforce_team_memberships(team_id, member_principal_id, role, created_by_user_id)
            VALUES($1, $2, 'worker', $3)`, [teamId, id, userId]);
        }
        const membersChanged = !previous || currentAgents.length !== data.agentIds.length || data.agentIds.some((a) => !currentAgents.includes(a));

        if (!current) {
          // New team: the self-assignment, its initial approved member set, then both recorded checks.
          const resource = (await tx.query('SELECT revision FROM workforce_resources WHERE id=$1', [teamId])).rows[0];
          current = (await tx.query(`INSERT INTO workforce_workspace_assignments(resource_id, resource_kind, workspace_id,
              source_owner_workspace_id, resource_revision, created_by_user_id, policy, member_set_revision)
            VALUES($1,'team',$2,$2,$3,$4,$5,1) RETURNING *`, [teamId, workspaceId, resource.revision, userId, NONE])).rows[0];
          await captureMemberSet(tx, current, teamId, workspaceId, userId, { admit: false });
          current = (await tx.query(`UPDATE workforce_workspace_assignments SET state='accepted', revision=revision+1,
              source_approved_by_user_id=$2, source_approved_at=clock_timestamp(), target_accepted_by_user_id=$2,
              accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1 RETURNING *`, [current.id, userId])).rows[0];
        } else if (membersChanged) {
          await captureMemberSet(tx, current, teamId, workspaceId, userId, { admit: true });
        }

        // Projects: end those removed, add those new, on this assignment (ASN-02 / ASN-09).
        const currentProjects = (await tx.query(`SELECT project_id FROM workforce_project_participations
          WHERE assignment_id=$1 AND resource_id=$2 AND state='active'`, [current.id, teamId])).rows.map((r) => r.project_id);
        const wantedProjects = new Set(data.projectIds);
        for (const id of currentProjects.filter((p) => !wantedProjects.has(p))) {
          await tx.query(`UPDATE workforce_project_participations SET state='ended', revision=revision+1, ended_at=clock_timestamp(),
            ended_by_user_id=$3 WHERE assignment_id=$1 AND project_id=$2 AND state='active'`, [current.id, id, userId]);
        }
        for (const id of data.projectIds.filter((p) => !currentProjects.includes(p))) {
          await tx.query(`INSERT INTO workforce_project_participations(resource_id, resource_kind, project_id, target_kind,
              workspace_id, assignment_id, responsibility, policy, created_by_user_id)
            VALUES($1,'team',$2,'workspace',$3,$4,$5,$6,$7)`, [teamId, id, workspaceId, current.id, RESPONSIBILITY, NONE, userId]);
        }
      }
      await tx.query(`INSERT INTO workspace_audit(workspace_id,actor_user_id,action,target,metadata) VALUES($1,$2,$3,$4,$5::jsonb)`,
        [workspaceId, userId, archive ? 'team.archived' : previous ? 'team.updated' : 'team.created', `team:${teamId}`,
          JSON.stringify(archive ? { previous_version: Number(previous.revision) }
            : { name: data.name, project_ids: data.projectIds, agent_ids: data.agentIds, previous_version: previous ? Number(previous.revision) : null })]);
      return { id: teamId };
    });
  } catch (error) {
    if (error.code === '23505') fail(409, 'team_assignment_conflict', 'A team with this name exists, or an agent is already assigned to another team. Refresh and try again.');
    throw error;
  }
}

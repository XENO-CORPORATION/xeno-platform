/**
 * Divisions (XENO-WORKFORCE-01 DIV-01..DIV-10): operating units INSIDE a workspace -- the departments a company
 * reorganises, staffs and funds. This service reads and writes the EXISTING records (20260922120000): it adds no
 * permission engine, no roster and no wallet (DIV-10).
 *
 *   - any workspace may have divisions, a personal one included (D16); none exist until someone creates one (DIV-03);
 *   - a division may sit inside another of the same workspace (D15); the database refuses cycles and cross-workspace
 *     parents;
 *   - only a PERSON who administers the workspace manages its divisions. A head cannot widen its own division
 *     (DIV-06), so being head grants no management here;
 *   - the head is a principal, human or agent (DIV-06), and gets `editor` on the division itself -- the relation
 *     run admission's actsInDivision already reads (DIV-08). Nothing here grants a parent division's members a
 *     child: `division` is deliberately absent from authzReBAC's PARENT_INHERITS (D15);
 *   - archive is one-way and never a cascade (OWN-06): existing teams, projects and history keep their division.
 *
 * Projects get an owning division through workforce_project_divisions (DIV-04); agents through the existing
 * workforce_division_ownership on their definition (platformAgents.js).
 */
import { check, writeTuples } from '../utils/authzReBAC.js';
import { createHash, randomUUID } from 'node:crypto';
import { resolvePrincipal } from './agentIdentity.js';
import { ensurePersonalWorkspace as ensurePersonalRoot } from './personalWorkspace.js';

export class DivisionError extends Error { constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const notFound = () => new DivisionError('Division not found', 'division_not_found', 404);

/** The caller's personal workspace (personalWorkspace.ensurePersonalWorkspace, the one creator). */
export async function personalWorkspace(db, userId) {
  return String((await ensurePersonalRoot(db, userId)).id);
}

/** Which workspace a request means: the given one (when the caller can see it) or the caller's personal one. */
export async function workspaceFor(db, me, workspaceId) {
  if (!workspaceId) return personalWorkspace(db, me.id);
  if (!UUID.test(String(workspaceId))) throw new DivisionError('Workspace not found', 'workspace_not_found', 404);
  const v = await check(db, { object: `workspace:${workspaceId}`, relation: 'viewer', subject: `user:${me.id}` });
  if (!v.allowed) throw new DivisionError('Workspace not found', 'workspace_not_found', 404);
  return String(workspaceId);
}

export async function mayManage(db, me, workspaceId) {
  if (!me || me.kind !== 'human') return false;
  const v = await check(db, { object: `workspace:${workspaceId}`, relation: 'admin', subject: `user:${me.id}` });
  return v.allowed;
}
async function requireManage(db, me, workspaceId) {
  if (!(await mayManage(db, me, workspaceId))) throw new DivisionError('Only a workspace admin manages its divisions', 'not_allowed', 403);
}

const shape = (r, counts = {}) => ({
  id: String(r.id), workspaceId: String(r.workspace_id), parentId: r.parent_division_id ? String(r.parent_division_id) : null,
  key: r.key, name: r.name, lifecycle: r.lifecycle, revision: Number(r.revision),
  head: r.head_principal_id ? { id: String(r.head_principal_id), name: r.head_name || 'Someone', kind: r.head_is_agent ? 'agent' : 'human' } : null,
  createdAt: r.created_at, archivedAt: r.archived_at,
  agents: counts.agents || 0, projects: counts.projects || 0,
});
const SELECT = `SELECT d.*, COALESCE(u.display_name, u.username) AS head_name, (ai.user_id IS NOT NULL) AS head_is_agent
  FROM workforce_divisions d LEFT JOIN users u ON u.id = d.head_principal_id LEFT JOIN agent_identities ai ON ai.user_id = d.head_principal_id`;

export async function list(db, me, { workspaceId, archived = false } = {}) {
  const ws = await workspaceFor(db, me, workspaceId);
  const rows = (await db.query(`${SELECT} WHERE d.workspace_id = $1 ${archived ? '' : "AND d.lifecycle = 'active'"} ORDER BY d.name`, [ws])).rows;
  const agents = (await db.query(`SELECT o.division_id, count(*)::int AS n FROM workforce_division_ownership o JOIN workforce_divisions d ON d.id = o.division_id
    WHERE d.workspace_id = $1 AND o.resource_kind = 'agent' GROUP BY 1`, [ws])).rows;
  const projects = (await db.query(`SELECT pd.division_id, count(*)::int AS n FROM workforce_project_divisions pd JOIN workforce_divisions d ON d.id = pd.division_id
    JOIN chat_projects p ON p.id = pd.project_id WHERE d.workspace_id = $1 AND NOT p.is_archived GROUP BY 1`, [ws])).rows;
  const count = (rs, id) => (rs.find((x) => String(x.division_id) === String(id)) || { n: 0 }).n;
  return { workspaceId: ws, canManage: await mayManage(db, me, ws),
    divisions: rows.map((r) => shape(r, { agents: count(agents, r.id), projects: count(projects, r.id) })) };
}

async function row(db, id) {
  if (!UUID.test(String(id))) throw notFound();
  const r = (await db.query(`${SELECT} WHERE d.id = $1`, [id])).rows[0];
  if (!r) throw notFound();
  return r;
}
/** A division the caller may SEE: a viewer of its workspace. */
export async function readable(db, me, id) {
  const r = await row(db, id);
  const v = await check(db, { object: `workspace:${r.workspace_id}`, relation: 'viewer', subject: `user:${me.id}` });
  if (!v.allowed) throw notFound();   // someone else's reads as absent
  return r;
}

export async function get(db, me, id) {
  const r = await readable(db, me, id);
  const agents = (await db.query(`SELECT ai.public_id, COALESCE(u.display_name, u.username) AS name, ai.description FROM workforce_division_ownership o
    JOIN agent_identities ai ON ai.workforce_resource_id = o.resource_id JOIN users u ON u.id = ai.user_id
    WHERE o.division_id = $1 AND ai.status <> 'retired' ORDER BY 2`, [r.id])).rows.map((a) => ({ id: a.public_id, name: a.name, description: a.description }));
  const projects = (await db.query(`SELECT p.id, p.name FROM workforce_project_divisions pd JOIN chat_projects p ON p.id = pd.project_id
    WHERE pd.division_id = $1 AND NOT p.is_archived ORDER BY p.name`, [r.id])).rows.map((p) => ({ id: String(p.id), name: p.name }));
  const children = (await db.query(`${SELECT} WHERE d.parent_division_id = $1 AND d.lifecycle = 'active' ORDER BY d.name`, [r.id])).rows.map((c) => shape(c));
  const parent = r.parent_division_id ? shape(await row(db, r.parent_division_id)) : null;
  return { ...shape(r, { agents: agents.length, projects: projects.length }), canManage: await mayManage(db, me, r.workspace_id),
    agentsList: agents, projectsList: projects, children, parent };
}

const keyOf = (name) => (String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').replace(/^[^a-z]+/, '') || 'division').slice(0, 56);

export async function create(db, me, { workspaceId, name, parentId } = {}) {
  const ws = await workspaceFor(db, me, workspaceId);
  await requireManage(db, me, ws);
  const label = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 200);
  if (!label) throw new DivisionError('Give the division a name', 'name_required');
  if (parentId) { const p = await row(db, parentId); if (String(p.workspace_id) !== ws) throw notFound(); if (p.lifecycle !== 'active') throw new DivisionError('That division is archived', 'division_archived', 409); }
  let key = keyOf(label);
  for (let i = 2; (await db.query('SELECT 1 FROM workforce_divisions WHERE workspace_id = $1 AND key = $2', [ws, key])).rowCount; i++) key = `${keyOf(label).slice(0, 52)}-${i}`;
  const made = (await db.query(`INSERT INTO workforce_divisions (workspace_id, parent_division_id, key, name, created_by_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [ws, parentId || null, key, label, me.id])).rows[0];
  return get(db, me, made.id);
}

export async function update(db, me, id, { name, parentId, headId, reason } = {}) {
  const r = await row(db, id);
  await requireManage(db, me, r.workspace_id);
  if (r.lifecycle !== 'active') throw new DivisionError('An archived division cannot be changed', 'division_archived', 409);
  const next = { name: r.name, parent: r.parent_division_id, head: r.head_principal_id };
  if (name !== undefined) { const l = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 200); if (!l) throw new DivisionError('Give the division a name', 'name_required'); next.name = l; }
  if (parentId !== undefined) {
    if (parentId) { const p = await row(db, parentId); if (String(p.workspace_id) !== String(r.workspace_id)) throw notFound(); if (p.lifecycle !== 'active') throw new DivisionError('That division is archived', 'division_archived', 409); }
    next.parent = parentId || null;
  }
  let headChanged = false;
  if (headId !== undefined) {
    if (headId) {
      if (!UUID.test(String(headId))) throw new DivisionError('That person or agent is not in this workspace', 'head_not_member');
      const p = await resolvePrincipal(db, headId);
      if (!p || !p.usable || !['human', 'agent'].includes(p.kind)) throw new DivisionError('That person or agent is not in this workspace', 'head_not_member');
      // a head must belong to the workspace: a member, or an agent owned by a member
      const who = p.kind === 'agent' ? p.owner.id : p.id;
      const v = await check(db, { object: `workspace:${r.workspace_id}`, relation: 'viewer', subject: `user:${who}` });
      if (!v.allowed) throw new DivisionError('That person or agent is not in this workspace', 'head_not_member');
    }
    headChanged = String(headId || '') !== String(r.head_principal_id || '');
    next.head = headId || null;
  }
  // LIFE-05/06: a new head is a DECISION -- who decided, under which authority, and why -- recorded once, immutably,
  // and the division row points at it (the database refuses a head change without one)
  let decision = null;
  if (headChanged) {
    decision = { actor: String(me.id), client: 'xeno-platform-divisions', op: randomUUID() };
    const why = String(reason || '').trim().slice(0, 2000) || null;
    await db.query(`INSERT INTO workforce_operations(actor_user_id, client_id, operation_id, request_hash, kind, subject_type, subject_id,
        deciding_principal_id, responsible_account_id, authority, rationale, workspace_id, division_id)
      VALUES ($1, $2, $3, $4, 'member.promote', 'division', $5, $1, $1, 'workspace admin', $6, $7, $5)`,
    [decision.actor, decision.client, decision.op, createHash('sha256').update(JSON.stringify({ division: r.id, head: next.head })).digest('hex'), r.id, why, r.workspace_id]);
  }
  try {
    await db.query(`UPDATE workforce_divisions SET name = $2, parent_division_id = $3, head_principal_id = $4, revision = revision + 1
      ${decision ? ', head_decision_actor_user_id = $5, head_decision_client_id = $6, head_decision_operation_id = $7' : ''} WHERE id = $1`,
    decision ? [r.id, next.name, next.parent, next.head, decision.actor, decision.client, decision.op] : [r.id, next.name, next.parent, next.head]);
  } catch (e) {
    if (e.code === '23514' && /cycle|deep/.test(e.message)) throw new DivisionError('A division cannot sit inside itself', 'division_cycle', 409);
    throw e;
  }
  if (headChanged) {
    // the head acts inside the division: `editor` on the division itself (DIV-06/08), and only there
    if (r.head_principal_id) await writeTuples(db, { deletes: [{ object: `division:${r.id}`, relation: 'editor', subject: `user:${r.head_principal_id}` }] });
    if (next.head) await writeTuples(db, { writes: [{ object: `division:${r.id}`, relation: 'editor', subject: `user:${next.head}` }] });
  }
  return get(db, me, r.id);
}

/** Archive: one-way (OWN-06). Its agents and projects keep it as their division; nothing new may join. */
export async function archive(db, me, id) {
  const r = await row(db, id);
  await requireManage(db, me, r.workspace_id);
  if (r.lifecycle === 'archived') return get(db, me, r.id);
  const kids = (await db.query(`SELECT count(*)::int AS n FROM workforce_divisions WHERE parent_division_id = $1 AND lifecycle = 'active'`, [r.id])).rows[0].n;
  if (kids) throw new DivisionError('Archive the divisions inside it first', 'division_has_children', 409);
  await db.query(`UPDATE workforce_divisions SET lifecycle = 'archived', archived_at = now(), revision = revision + 1 WHERE id = $1`, [r.id]);
  return get(db, me, r.id);
}

// ───────────── projects in divisions (DIV-04)

/** The owning division of a project, or null (workspace-level). */
export async function projectDivision(db, projectId) {
  const r = (await db.query(`SELECT d.id, d.name, d.lifecycle FROM workforce_project_divisions pd JOIN workforce_divisions d ON d.id = pd.division_id WHERE pd.project_id = $1`, [projectId])).rows[0];
  return r ? { id: String(r.id), name: r.name, lifecycle: r.lifecycle } : null;
}

/** Put a project in a division (or make it workspace-level with divisionId null). Needs project admin AND
 *  workspace admin: moving a project changes which agents may reach it. */
export async function setProjectDivision(db, me, projectId, divisionId) {
  if (!UUID.test(String(projectId))) throw new DivisionError('Project not found', 'project_not_found', 404);
  const p = (await db.query('SELECT id, workspace_id, owner_user_id FROM chat_projects WHERE id = $1 AND NOT is_archived', [projectId])).rows[0];
  if (!p) throw new DivisionError('Project not found', 'project_not_found', 404);
  const pv = await check(db, { object: `project:${projectId}`, relation: 'admin', subject: `user:${me.id}` });
  if (!pv.allowed) throw new DivisionError('Only a project admin can move it between divisions', 'not_allowed', 403);
  const ws = p.workspace_id ? String(p.workspace_id) : await personalWorkspace(db, p.owner_user_id);
  await requireManage(db, me, ws);
  const cur = (await db.query('SELECT division_id, revision FROM workforce_project_divisions WHERE project_id = $1', [projectId])).rows[0];
  if (!divisionId) {
    if (cur) await db.query('DELETE FROM workforce_project_divisions WHERE project_id = $1', [projectId]);
  } else {
    const d = await readable(db, me, divisionId);
    if (String(d.workspace_id) !== ws) throw new DivisionError('That division is in another workspace', 'division_other_workspace', 409);
    if (d.lifecycle !== 'active') throw new DivisionError('That division is archived', 'division_archived', 409);
    if (cur) await db.query('UPDATE workforce_project_divisions SET division_id = $2, revision = revision + 1 WHERE project_id = $1', [projectId, divisionId]);
    else await db.query('INSERT INTO workforce_project_divisions (project_id, division_id, created_by_user_id) VALUES ($1, $2, $3)', [projectId, divisionId, me.id]);
  }
  // DIV-08: agents whose division no longer matches lose the project at once
  const moved = await revokeAgentsOutsideDivision(db, projectId);
  return { projectId: String(projectId), division: await projectDivision(db, projectId), agentsRemoved: moved };
}

/** Agents given this project whose owning division now differs from the project's: their grant is removed. */
export async function revokeAgentsOutsideDivision(db, projectId) {
  const pd = await projectDivision(db, projectId);
  const rows = (await db.query(`SELECT r.subject_id, r.relation, o.division_id FROM relationship_tuples r
    JOIN agent_identities ai ON ai.user_id::text = r.subject_id
    LEFT JOIN workforce_division_ownership o ON o.resource_id = ai.workforce_resource_id
    WHERE r.object_type = 'project' AND r.object_id = $1 AND r.subject_type = 'user' AND ai.workforce_resource_id IS NOT NULL`, [String(projectId)])).rows;
  const out = rows.filter((x) => String(x.division_id || '') !== String(pd ? pd.id : ''));
  for (const x of out) await writeTuples(db, { deletes: [{ object: `project:${projectId}`, relation: x.relation, subject: `user:${x.subject_id}` }] });
  return out.length;
}

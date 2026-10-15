/**
 * Lending an agent (XENO-WORKFORCE-01 ASN-01/ASN-04, DIV-05). An agent has ONE owner and at most one owning division;
 * it may WORK in other places through assignments: separately offered, separately accepted, separately revocable,
 * and never moving ownership or who pays (ASN-01, DIV-05, DIV-07).
 *
 * Built on the EXISTING record, workforce_workspace_assignments (with its target_division_id), and its database
 * guard: an assignment is born `proposed`, the source side approves it (the owner's sharing), the target side
 * accepts it (the target workspace's admin), and it is revoked -- never deleted, never re-written (the guard refuses
 * both). When the person lending also administers the target, both checks are satisfied in one act and BOTH are
 * still recorded (ASN-04: "never one check standing in for two").
 *
 * What an accepted lend grants: the agent acts inside the target division (`editor` on it, the relation run
 * admission reads -- DIV-08), so it may be given that division's projects. Revoking removes that and every project
 * it held there.
 */
import { check, writeTuples } from '../utils/authzReBAC.js';
import { lockWorkspaceAuthority } from './workspaceOperationReceipts.js';
import * as divisions from './workforceDivisions.js';
import * as tasks from './xenoTasks.js';

export class LendError extends Error { constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POLICY = { schemaVersion: 1, mode: 'none', capabilities: [] };

const administers = async (db, userId, workspaceId) => (await check(db, { object: `workspace:${workspaceId}`, relation: 'admin', subject: `user:${userId}` })).allowed;

function shape(r) {
  return { id: String(r.id), state: r.state, workspace: { id: String(r.workspace_id), name: r.workspace_name },
    division: r.target_division_id ? { id: String(r.target_division_id), name: r.division_name } : null,
    agent: r.public_id ? { id: r.public_id, name: r.agent_name } : null,
    offeredAt: r.created_at, acceptedAt: r.accepted_at, revokedAt: r.revoked_at,
    waitingFor: r.state === 'proposed' ? 'target' : null };
}
const SELECT = `SELECT a.*, w.name AS workspace_name, d.name AS division_name, ai.public_id, COALESCE(u.display_name, u.username) AS agent_name, ai.user_id AS agent_user_id
  FROM workforce_workspace_assignments a JOIN workspaces w ON w.id = a.workspace_id
  LEFT JOIN workforce_divisions d ON d.id = a.target_division_id
  LEFT JOIN agent_identities ai ON ai.workforce_resource_id = a.resource_id
  LEFT JOIN users u ON u.id = ai.user_id`;

/** The places an agent is lent to (live and pending). */
export async function lendsOf(db, resourceId) {
  return (await db.query(`${SELECT} WHERE a.resource_id = $1 AND a.state IN ('proposed', 'accepted') ORDER BY a.created_at`, [resourceId])).rows.map(shape);
}

/** Offer the agent to a workspace, optionally a division inside it. `agent` is the owned row from platformAgents. */
export async function lend(db, me, agent, { workspaceId, divisionId } = {}) {
  let ws = workspaceId ? String(workspaceId) : null, div = null;
  if (divisionId) {
    const d = await divisions.readable(db, me, divisionId).catch(() => { throw new LendError('Division not found', 'division_not_found', 404); });
    if (d.lifecycle !== 'active') throw new LendError('That division is archived', 'division_archived', 409);
    if (ws && ws !== String(d.workspace_id)) throw new LendError('That division is not in that workspace', 'division_other_workspace', 409);
    ws = String(d.workspace_id); div = String(d.id);
  }
  if (!ws || !UUID.test(ws)) throw new LendError('Choose where to lend it', 'target_required');
  if (!(await check(db, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${me.id}` })).allowed) throw new LendError('Workspace not found', 'workspace_not_found', 404);
  if (agent.division_id && div === String(agent.division_id)) throw new LendError('It already works in that division — it is its own', 'already_own_division', 409);
  const res = (await db.query('SELECT id, revision, owner_user_id, owner_workspace_id, status FROM workforce_resources WHERE id = $1', [agent.workforce_resource_id])).rows[0];
  if (!res || res.status !== 'active') throw new LendError('This agent cannot be lent', 'agent_unavailable', 409);
  const live = (await db.query(`SELECT id FROM workforce_workspace_assignments WHERE resource_id = $1 AND workspace_id = $2 AND target_division_id IS NOT DISTINCT FROM $3 AND state IN ('proposed', 'accepted')`,
    [res.id, ws, div])).rows[0];
  if (live) throw new LendError('It is already lent there, or the offer is waiting', 'already_lent', 409);
  await lockWorkspaceAuthority(db, ws);
  const row = (await db.query(`INSERT INTO workforce_workspace_assignments (resource_id, resource_kind, workspace_id, source_owner_user_id, source_owner_workspace_id,
      resource_revision, created_by_user_id, policy, target_division_id) VALUES ($1, 'agent', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
  [res.id, ws, res.owner_user_id, res.owner_workspace_id, res.revision, me.id, POLICY, div])).rows[0];
  // the source side: the owner sharing it, recorded
  const accepts = await administers(db, me.id, ws);
  await db.query(`UPDATE workforce_workspace_assignments SET revision = revision + 1, source_approved_by_user_id = $2, source_approved_at = clock_timestamp(), updated_at = clock_timestamp()
    ${accepts ? ", state = 'accepted', target_accepted_by_user_id = $2, accepted_at = clock_timestamp()" : ''} WHERE id = $1`, [row.id, me.id]);
  await db.query(`INSERT INTO workspace_audit (workspace_id, actor_user_id, action, target, metadata) VALUES ($1, $2, 'workforce_resource_assigned', $3, $4)`,
    [ws, me.id, `workforce_assignment:${row.id}`, { schemaVersion: 1, resourceId: String(res.id), assignmentId: String(row.id), divisionId: div, state: accepts ? 'accepted' : 'proposed', via: 'agents.lend' }]);
  if (accepts && div) await grant(db, agent.id, div);
  return one(db, row.id);
}

async function one(db, id) { const r = (await db.query(`${SELECT} WHERE a.id = $1`, [id])).rows[0]; return r ? shape(r) : null; }
const grant = (db, agentUserId, div) => writeTuples(db, { writes: [{ object: `division:${div}`, relation: 'editor', subject: `agent:${agentUserId}` }] });

async function readableAssignment(db, me, id) {
  if (!UUID.test(String(id))) throw new LendError('Offer not found', 'assignment_not_found', 404);
  const r = (await db.query(`${SELECT} WHERE a.id = $1 AND a.resource_kind = 'agent'`, [id])).rows[0];
  if (!r) throw new LendError('Offer not found', 'assignment_not_found', 404);
  return r;
}

/** Offers waiting for this person's decision: agents offered to a workspace they administer. */
export async function inbox(db, me) {
  const rows = (await db.query(`${SELECT} WHERE a.state = 'proposed' AND a.resource_kind = 'agent' ORDER BY a.created_at DESC LIMIT 200`)).rows;
  const out = []; for (const r of rows) if (await administers(db, me.id, r.workspace_id)) out.push({ ...shape(r), from: await ownerName(db, r) });
  return out;
}
const ownerName = async (db, r) => ((await db.query('SELECT COALESCE(display_name, username) AS n FROM users WHERE id = $1', [r.source_owner_user_id])).rows[0] || { n: 'Someone' }).n;

/** The target side: an admin of the target workspace accepts (or declines) the offer. */
export async function decide(db, me, id, accept) {
  const r = await readableAssignment(db, me, id);
  if (!(await administers(db, me.id, r.workspace_id))) throw new LendError('Only an admin of that workspace can accept it', 'not_allowed', 403);
  if (r.state !== 'proposed') throw new LendError('That offer was already decided', 'already_decided', 409);
  await lockWorkspaceAuthority(db, r.workspace_id);
  if (accept) {
    try {
      await db.query(`UPDATE workforce_workspace_assignments SET revision = revision + 1, state = 'accepted', target_accepted_by_user_id = $2, accepted_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1`, [r.id, me.id]);
    } catch (e) {
      if (e.code === '23514') throw new LendError('The agent changed since it was offered. Ask for a new offer.', 'offer_stale', 409);
      throw e;
    }
    if (r.target_division_id && r.agent_user_id) await grant(db, r.agent_user_id, r.target_division_id);
  } else {
    await db.query(`UPDATE workforce_workspace_assignments SET revision = revision + 1, state = 'revoked', revoked_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1`, [r.id]);
  }
  await db.query(`INSERT INTO workspace_audit (workspace_id, actor_user_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)`,
    [r.workspace_id, me.id, accept ? 'workforce_assignment_accepted' : 'workforce_assignment_declined', `workforce_assignment:${r.id}`, { schemaVersion: 1, assignmentId: String(r.id) }]);
  return one(db, r.id);
}

/** End a lend -- the owner or the target's admin. The agent stops acting there and loses that division's projects. */
export async function revoke(db, me, id) {
  const r = await readableAssignment(db, me, id);
  const owner = String(r.source_owner_user_id || '') === String(me.id);
  if (!owner && !(await administers(db, me.id, r.workspace_id))) throw new LendError('Offer not found', 'assignment_not_found', 404);
  if (r.state === 'revoked') return one(db, r.id);
  await db.query(`UPDATE workforce_workspace_assignments SET revision = revision + 1, state = 'revoked', revoked_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1`, [r.id]);
  if (r.target_division_id && r.agent_user_id) {
    // still inside it if it OWNS that division, or holds another live lend there
    const own = (await db.query('SELECT 1 FROM workforce_division_ownership WHERE resource_id = $1 AND division_id = $2', [r.resource_id, r.target_division_id])).rowCount;
    const other = (await db.query(`SELECT 1 FROM workforce_workspace_assignments WHERE resource_id = $1 AND target_division_id = $2 AND state = 'accepted' AND id <> $3`, [r.resource_id, r.target_division_id, r.id])).rowCount;
    if (!own && !other) {
      await writeTuples(db, { deletes: [{ object: `division:${r.target_division_id}`, relation: 'editor', subject: `agent:${r.agent_user_id}` }] });
      for (const p of await tasks.listTaskProjects(db, { id: r.agent_user_id })) {
        const pd = await divisions.projectDivision(db, p.id);
        if (pd && pd.id === String(r.target_division_id)) {
          await db.query(`DELETE FROM relationship_tuples WHERE object_type = 'project' AND object_id = $1 AND subject_type = 'user' AND subject_id = $2`, [String(p.id), String(r.agent_user_id)]);
        }
      }
    }
  }
  await db.query(`INSERT INTO workspace_audit (workspace_id, actor_user_id, action, target, metadata) VALUES ($1, $2, 'workforce_assignment_revoked', $3, $4)`,
    [r.workspace_id, me.id, `workforce_assignment:${r.id}`, { schemaVersion: 1, assignmentId: String(r.id) }]);
  return one(db, r.id);
}

/** Divisions this agent works in: its own, plus every accepted lend to a division. */
export async function workingDivisions(db, resourceId) {
  return (await db.query(`SELECT division_id::text AS id FROM workforce_division_ownership WHERE resource_id = $1
    UNION SELECT target_division_id::text FROM workforce_workspace_assignments WHERE resource_id = $1 AND state = 'accepted' AND target_division_id IS NOT NULL`, [resourceId])).rows.map((x) => x.id);
}

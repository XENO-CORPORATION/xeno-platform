/**
 * agentAccess.js — who may do what with a platform agent, and who answers for it.
 *
 * XENO-WORKFORCE-01 OWN-01/OWN-05 and MKT-01, the way GitHub Apps and Google service accounts settled it:
 *
 *   OWNERSHIP      the agent's definition, personal or COMPANY (workforce_resources). A company agent belongs to
 *                  the workspace and survives the person who made it.
 *   ACCOUNTABLE    one human (agent_identities.owner_user_id). For a company agent they must administer its
 *                  workspace; when they stop, the agent PAUSES (resolvePrincipal: `needs_owner`) -- never deleted --
 *                  until a workspace admin takes it over. Handing it to another admin is one recorded act.
 *   FOUR RIGHTS    relations on `agent:<user id>`: viewer (see) < runner (run: credentials, cloud runs) < editor
 *                  (change it); exporter (take the definition out) is separate and never implied. The accountable
 *                  human and the workspace's admins hold all four. Granted per member, revocable.
 *
 * Moving an agent between owners (person <-> company, company <-> company) is the existing two-sided, reviewed,
 * audited ownership transfer (workforceOwnershipTransfer.js). When it is accepted, the accepting admin becomes
 * accountable in the same flow (`completeTransferAccountability`).
 */
import { check, writeTuples, listObjectTuples } from '../utils/authzReBAC.js';

export const RIGHTS = ['viewer', 'runner', 'editor', 'exporter'];
const RANK = { viewer: 1, runner: 2, editor: 3 };   // exporter is outside the ladder
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AccessError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'AccessError'; this.code = code; this.status = status; }
}

/** The agent's ownership facts, by its internal user id. */
export async function ownershipOf(db, agentUserId) {
  const r = (await db.query(`SELECT ai.user_id, ai.public_id, ai.owner_user_id, ai.status, wr.id AS resource_id,
      wr.owner_workspace_id, wr.owner_user_id AS resource_owner_user_id, w.name AS workspace_name, w.workspace_type,
      COALESCE(o.display_name, o.username) AS accountable_name
    FROM agent_identities ai LEFT JOIN workforce_resources wr ON wr.id = ai.workforce_resource_id
    LEFT JOIN workspaces w ON w.id = wr.owner_workspace_id LEFT JOIN users o ON o.id = ai.owner_user_id
    WHERE ai.user_id = $1`, [agentUserId])).rows[0];
  return r || null;
}

async function isWorkspaceAdmin(db, workspaceId, userId) {
  if (!workspaceId || !userId) return false;
  const w = (await db.query(`SELECT owner_user_id, status FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  if (!w || w.status !== 'active') return false;
  if (String(w.owner_user_id) === String(userId)) return true;
  const v = await check(db, { object: `workspace:${workspaceId}`, relation: 'admin', subject: `user:${userId}` });
  return v.allowed;
}

/**
 * Does `userId` hold `right` on the agent? The accountable human and (for a company agent) workspace admins hold
 * everything; others hold what they were granted. `runner` implies `viewer`, `editor` implies both; `exporter`
 * is only ever granted directly.
 */
export async function holds(db, userId, agentUserId, right) {
  const o = await ownershipOf(db, agentUserId);
  if (!o || o.status === 'retired') return false;
  if (String(o.owner_user_id) === String(userId)) return true;
  if (o.owner_workspace_id && await isWorkspaceAdmin(db, o.owner_workspace_id, userId)) return true;
  const tuples = (await listObjectTuples(db, `agent:${agentUserId}`)).filter((t) => t.subject === `user:${userId}`);
  if (right === 'exporter') return tuples.some((t) => t.relation === 'exporter');
  const want = RANK[right];
  return tuples.some((t) => RANK[t.relation] >= want);
}

/** Rights summary for one person on one agent, for the UI. */
export async function rightsOf(db, userId, agentUserId) {
  const out = {};
  for (const r of RIGHTS) out[r] = await holds(db, userId, agentUserId, r);
  const o = await ownershipOf(db, agentUserId);
  out.manage = !!o && (String(o.owner_user_id) === String(userId) || (o.owner_workspace_id && await isWorkspaceAdmin(db, o.owner_workspace_id, userId)));
  return out;
}

/** Who has access, for the Access section: the accountable human, the admins, and granted members. */
export async function accessList(db, manager, agentUserId) {
  const o = await requireManage(db, manager, agentUserId);
  const grants = (await listObjectTuples(db, `agent:${agentUserId}`)).filter((t) => RIGHTS.includes(t.relation) && t.subject.startsWith('user:'));
  const ids = [...new Set(grants.map((t) => t.subject.slice(5)))];
  const names = ids.length ? (await db.query(`SELECT id, COALESCE(display_name, username) AS name, username FROM users WHERE id = ANY($1::uuid[])`, [ids])).rows : [];
  const people = ids.map((id) => {
    const u = names.find((x) => String(x.id) === id) || {};
    return { userId: id, name: u.name || 'Someone', handle: u.username || null, rights: grants.filter((t) => t.subject === `user:${id}`).map((t) => t.relation) };
  });
  const history = (await db.query(`SELECT c.reason, c.note, c.created_at, COALESCE(f.display_name, f.username) AS from_name,
      COALESCE(t.display_name, t.username) AS to_name, COALESCE(d.display_name, d.username) AS by_name
    FROM agent_accountability_changes c LEFT JOIN users f ON f.id = c.from_user_id JOIN users t ON t.id = c.to_user_id
    LEFT JOIN users d ON d.id = c.decided_by_user_id WHERE c.agent_user_id = $1 ORDER BY c.created_at DESC LIMIT 20`, [agentUserId])).rows;
  return {
    owner: o.owner_workspace_id ? { kind: 'company', workspaceId: String(o.owner_workspace_id), name: o.workspace_name } : { kind: 'personal' },
    accountable: { userId: String(o.owner_user_id), name: o.accountable_name },
    people,
    history: history.map((h) => ({ reason: h.reason, note: h.note, at: h.created_at, from: h.from_name, to: h.to_name, by: h.by_name })),
  };
}

async function requireManage(db, me, agentUserId) {
  if (!me || me.kind !== 'human') throw new AccessError('Only a person manages access', 'not_allowed', 403);
  const o = await ownershipOf(db, agentUserId);
  if (!o || o.status === 'retired') throw new AccessError('Agent not found', 'agent_not_found', 404);
  const can = String(o.owner_user_id) === String(me.id) || (o.owner_workspace_id && await isWorkspaceAdmin(db, o.owner_workspace_id, me.id));
  if (!can) {
    // someone who can see it is told why; anyone else reads it as absent
    if (await holds(db, me.id, agentUserId, 'viewer')) throw new AccessError('Only its owner or a workspace admin can do that', 'not_allowed', 403);
    throw new AccessError('Agent not found', 'agent_not_found', 404);
  }
  return o;
}

/** Grant or revoke one right for one member. Only for company agents: a personal agent has only its owner. */
export async function setRight(db, manager, agentUserId, { userId, right, grant }) {
  const o = await requireManage(db, manager, agentUserId);
  if (!RIGHTS.includes(right)) throw new AccessError('right is viewer, runner, editor or exporter', 'invalid_right');
  if (!UUID.test(String(userId || ''))) throw new AccessError('Choose a person', 'invalid_member');
  if (!o.owner_workspace_id) throw new AccessError('A personal agent is only yours. Move it to a company workspace to share it.', 'personal_agent', 409);
  const member = await check(db, { object: `workspace:${o.owner_workspace_id}`, relation: 'viewer', subject: `user:${userId}` });
  const kind = (await db.query(`SELECT 1 FROM agent_identities WHERE user_id = $1`, [userId])).rowCount ? 'agent' : 'human';
  if (kind !== 'human') throw new AccessError('Rights on an agent are for people', 'invalid_member');
  if (grant && !member.allowed) throw new AccessError('They are not a member of this workspace', 'not_a_member', 409);
  const tuple = { object: `agent:${agentUserId}`, relation: right, subject: `user:${userId}` };
  await writeTuples(db, grant ? { writes: [tuple] } : { deletes: [tuple] });
  await db.query(`INSERT INTO agent_access_changes (agent_user_id, member_user_id, access_right, granted, decided_by_user_id)
    VALUES ($1, $2, $3, $4, $5)`, [agentUserId, userId, right, !!grant, manager.id]);
  return accessList(db, manager, agentUserId);
}

/**
 * Take over a company agent, or hand it to another admin. The new accountable human must administer the owning
 * workspace; the caller must too (or be the current accountable human handing it on). Recorded.
 */
export async function setAccountable(db, me, agentUserId, { toUserId, note } = {}) {
  if (!me || me.kind !== 'human') throw new AccessError('Only a person takes responsibility for an agent', 'not_allowed', 403);
  const o = await ownershipOf(db, agentUserId);
  if (!o || o.status === 'retired') throw new AccessError('Agent not found', 'agent_not_found', 404);
  if (!o.owner_workspace_id) throw new AccessError('A personal agent answers to its owner. Move it to a company workspace first.', 'personal_agent', 409);
  const target = toUserId ? String(toUserId) : String(me.id);
  if (!UUID.test(target)) throw new AccessError('Choose a person', 'invalid_member');
  const iAmAdmin = await isWorkspaceAdmin(db, o.owner_workspace_id, me.id);
  const iAmAccountable = String(o.owner_user_id) === String(me.id);
  if (!iAmAdmin && !iAmAccountable) throw new AccessError('Agent not found', 'agent_not_found', 404);
  if (!(await isWorkspaceAdmin(db, o.owner_workspace_id, target))) throw new AccessError('Only an admin of its workspace can be accountable for a company agent', 'not_an_admin', 409);
  if (String(o.owner_user_id) === target) return accessList(db, me, agentUserId);
  if (note !== undefined && String(note).length > 1000) throw new AccessError('The note is longer than 1,000 characters', 'note_too_long');
  await db.query('UPDATE agent_identities SET owner_user_id = $2 WHERE user_id = $1', [agentUserId, target]);
  await db.query(`INSERT INTO agent_accountability_changes (agent_user_id, from_user_id, to_user_id, workspace_id, reason, note, decided_by_user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`, [agentUserId, o.owner_user_id, target, o.owner_workspace_id, target === String(me.id) ? 'takeover' : 'handover', note ? String(note) : null, me.id]);
  return accessList(db, me, agentUserId);
}

/** After an ownership transfer of the agent's definition is accepted: the accepting admin becomes accountable. */
export async function completeTransferAccountability(db, { resourceId, acceptedByUserId, toWorkspaceId, toUserId }) {
  const ai = (await db.query('SELECT user_id, owner_user_id FROM agent_identities WHERE workforce_resource_id = $1', [resourceId])).rows[0];
  if (!ai) return null;   // a definition with no principal (a team, or an agent never run) has nobody to re-point
  const next = toUserId ? String(toUserId) : String(acceptedByUserId);
  if (String(ai.owner_user_id) === next) return ai.user_id;
  await db.query('UPDATE agent_identities SET owner_user_id = $2 WHERE user_id = $1', [ai.user_id, next]);
  await db.query(`INSERT INTO agent_accountability_changes (agent_user_id, from_user_id, to_user_id, workspace_id, reason, decided_by_user_id)
    VALUES ($1, $2, $3, $4, 'transfer', $5)`, [ai.user_id, ai.owner_user_id, next, toWorkspaceId || null, acceptedByUserId]);
  return ai.user_id;
}

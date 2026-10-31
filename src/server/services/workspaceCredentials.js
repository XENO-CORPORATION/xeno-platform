/**
 * Workspace agent credentials (XENO WORKSPACE AGENT SURFACE - SPEC.md P2, approved by the owner 2026-10-20:
 * "yes to all"). Widens what exists; builds no second OAuth, grant store or identity:
 *
 *   OAuth      the Tasks RFC 7591 + consent flow, on the 'xeno-workspace' audience (utils/oidcProvider.js)
 *   identity   the person's per-app agt_ agent (xenoTasks.mcpAgentFor / boundAgentFor), never the person
 *   grants     relationship_tuples capability:<name>@<workspace> grantee user:<agent> — the §8.11 D-3 store
 *   headless   xwk_ keys: the same scopes and grants, one workspace, a REQUIRED expiry
 *   audit      the existing metadata-only mcp_calls log (one connection per sign-in or key)
 *
 * What a call may do = the capability's scope ∈ the credential's scopes
 *                      ∩ a grant of that capability in the acting workspace
 *                      ∩ the person's own rights (the services check those, against the owner).
 * Missing scope or grant → 403. A revoked sign-in or key → 401 on the very next call.
 *
 * Step-up (owner decision §5 Q2): an `irreversible` capability, and spend above the lower of the team's budget and
 * EUR 50, need a FRESH sign-in (auth_time within STEP_UP_WINDOW_SEC). A headless key cannot step up, so it is refused.
 */
import crypto from 'node:crypto';
import { CATALOGUE } from '../capabilities/catalogue.js';
import { WORKSPACE_SCOPES } from '../capabilities/scopes.js';
import { writeTuples, check } from '../utils/authzReBAC.js';
import { scopedCapability } from './servicePrincipalGate.js';
import { personalWorkspace } from './workforceDivisions.js';
import { mcpAgentFor } from './xenoTasks.js';
import { budgetOf } from './divisionAgentBudget.js';

export const STEP_UP_WINDOW_SEC = 10 * 60;
export const STEP_UP_EUR = 50;
export const CREDITS_PER_EUR = 100;            // 1 credit = EUR 0.01 (utils/creditCosts.js)
export const MAX_KEY_DAYS = 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WorkspaceCredentialError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'WorkspaceCredentialError'; this.code = code; this.status = status; this.statusCode = status; }
}

/** The capabilities a scope set reaches (by declaration), never more. */
export const capabilitiesForScopes = (scopes) => CATALOGUE.filter((c) => [].concat(scopes || []).includes(c.scope)).map((c) => c.name);

/** Grant `names` to `agentId` in `workspaceId` (adds; never removes). */
export async function grant(db, agentId, workspaceId, names) {
  if (!UUID.test(String(workspaceId))) throw new WorkspaceCredentialError('Workspace not found', 'workspace_not_found', 404);
  const known = new Set(CATALOGUE.map((c) => c.name));
  const bad = names.filter((n) => !known.has(n));
  if (bad.length) throw new WorkspaceCredentialError(`Unknown capabilit${bad.length > 1 ? 'ies' : 'y'}: ${bad.join(', ')}`, 'unknown_capability');
  await writeTuples(db, { writes: names.map((n) => ({ object: `capability:${scopedCapability(n, String(workspaceId).toLowerCase())}`, relation: 'grantee', subject: `user:${agentId}` })) });
}

/** Take grants back. With no `names`, every grant this agent holds in that workspace. */
export async function revokeGrants(db, agentId, workspaceId, names = null) {
  const ws = String(workspaceId).toLowerCase();
  const r = names
    ? await db.query(`DELETE FROM relationship_tuples WHERE object_type = 'capability' AND object_id = ANY($1::text[]) AND relation = 'grantee' AND subject_type = 'user' AND subject_id = $2`, [names.map((n) => scopedCapability(n, ws)), String(agentId)])
    : await db.query(`DELETE FROM relationship_tuples WHERE object_type = 'capability' AND object_id LIKE $1 AND relation = 'grantee' AND subject_type = 'user' AND subject_id = $2`, [`%@${ws}`, String(agentId)]);
  return r.rowCount;
}

export async function listGrants(db, agentId) {
  const { rows } = await db.query(`SELECT object_id FROM relationship_tuples WHERE object_type = 'capability' AND relation = 'grantee' AND subject_type = 'user' AND subject_id = $1 ORDER BY object_id`, [String(agentId)]);
  return rows.map((r) => { const at = r.object_id.lastIndexOf('@'); return { capability: r.object_id.slice(0, at), workspaceId: r.object_id.slice(at + 1) }; }).filter((g) => g.workspaceId && UUID.test(g.workspaceId));
}

export async function hasGrant(db, agentId, capability, workspaceId) {
  if (!UUID.test(String(workspaceId || ''))) return false;
  return (await db.query(`SELECT 1 FROM relationship_tuples WHERE object_type = 'capability' AND object_id = $1 AND relation = 'grantee' AND subject_type = 'user' AND subject_id = $2 LIMIT 1`,
    [scopedCapability(capability, String(workspaceId).toLowerCase()), String(agentId)])).rows.length > 0;
}

/** May this person hand capabilities in `workspaceId` to an agent? Only someone who can edit there. */
export async function assertCanGrantIn(db, ownerId, workspaceId) {
  if (!UUID.test(String(workspaceId))) throw new WorkspaceCredentialError('Workspace not found', 'workspace_not_found', 404);
  if (String(workspaceId) === String(await personalWorkspace(db, ownerId))) return;
  const ok = (await check(db, { object: `workspace:${workspaceId}`, relation: 'editor', subject: `user:${ownerId}` })).allowed;
  if (!ok) throw new WorkspaceCredentialError('You can only grant in a workspace you can edit', 'not_allowed', 403);
}

/**
 * Step-up rule (§5 Q2). Returns null when the call may go ahead, or the reason it needs a fresh sign-in.
 *   - an `irreversible` capability: always
 *   - spend: when the SERVER-DERIVED cost (serverCostCredits — what the service will hold) is above the lower of
 *     the team's (division) budget left and EUR 50. A spending capability whose cost the server cannot derive is
 *     treated as above the limit (fail closed). A caller-stated cost is never consulted.
 */
export function stepUpReason(cap, { serverCredits = null, teamLeftCredits = null } = {}) {
  if (cap.class === 'irreversible') return 'irreversible';
  if (cap.cost.model === 'quoted' || cap.cost.model === 'metered') {
    if (serverCredits == null || !Number.isFinite(Number(serverCredits))) return 'spend';
    const limit = Math.min(STEP_UP_EUR * CREDITS_PER_EUR, teamLeftCredits == null ? Infinity : Number(teamLeftCredits));
    if (Number(serverCredits) > limit) return 'spend';
  }
  return null;
}

/**
 * What the platform will hold for this call, in credits, derived from ITS OWN price tables — never from the
 * arguments' own statement of cost. null = cannot be derived (the caller then steps up). Injectable for tests.
 */
export async function serverCostCredits(db, cap, args = {}, actor = null, { mediaModels = null } = {}) {
  const m = /^studio\.(image|video)\.generate$/.exec(cap.name);
  if (m) {
    const list = mediaModels ? await mediaModels(db, actor, m[1]) : await (await import('./agentMedia.js')).mediaModels(db, actor, m[1]);
    const models = (list && list.models) || [];
    const chosen = args.model ? models.filter((x) => x.id === args.model) : models;
    const prices = chosen.map((x) => Number(x.maxCredits)).filter(Number.isFinite);
    return prices.length ? Math.max(...prices) : null;
  }
  return null;
}

/** The team's (division) agent budget left, in credits, or null when it has none. */
export async function teamLeftCredits(db, agentUserId) {
  const r = (await db.query(`SELECT o.division_id FROM agent_identities ai JOIN workforce_division_ownership o ON o.resource_id = ai.workforce_resource_id WHERE ai.user_id = $1`, [agentUserId])).rows[0];
  if (!r || !r.division_id) return null;
  const b = await budgetOf(db, r.division_id);
  return b ? b.view.leftCredits : null;
}

/** The whole step-up decision for one call: server cost and team budget, then the rule. */
export async function stepUpFor(db, cap, args, actor, deps = {}) {
  if (cap.class === 'irreversible') return 'irreversible';
  if (cap.cost.model !== 'quoted' && cap.cost.model !== 'metered') return null;
  const serverCredits = await serverCostCredits(db, cap, args, actor, deps).catch(() => null);
  const left = deps.teamLeftCredits !== undefined ? deps.teamLeftCredits : await teamLeftCredits(db, actor.id).catch(() => null);
  return stepUpReason(cap, { serverCredits, teamLeftCredits: left });
}
export const isFresh = (authTimeSec, now = Date.now()) => Number.isFinite(Number(authTimeSec)) && now / 1000 - Number(authTimeSec) <= STEP_UP_WINDOW_SEC;

// ───────────────────────────── headless xwk_ keys

const sha = (k) => crypto.createHash('sha256').update(k).digest('hex');
const viewKey = (r) => ({ id: String(r.id), name: r.name, prefix: r.key_prefix, agentId: String(r.agent_user_id), workspaceId: String(r.workspace_id), scopes: r.scopes, expiresAt: r.expires_at, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at || null });

/** Make a key. The key is returned ONCE. Its agent is granted exactly what its scopes reach in its workspace. */
export async function createKey(db, ownerId, { name, scopes, workspaceId = null, expiresInDays }) {
  const label = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);
  if (!label) throw new WorkspaceCredentialError('name is required', 'invalid_name');
  const sc = [...new Set([].concat(scopes || []).map(String))];
  if (!sc.length || sc.some((s) => !WORKSPACE_SCOPES.includes(s))) throw new WorkspaceCredentialError(`scopes must be a non-empty subset of: ${WORKSPACE_SCOPES.join(' ')}`, 'invalid_scope');
  const days = Number(expiresInDays);
  if (!Number.isInteger(days) || days < 1 || days > MAX_KEY_DAYS) throw new WorkspaceCredentialError(`expiresInDays is required: a whole number from 1 to ${MAX_KEY_DAYS}`, 'invalid_expiry');
  const ws = workspaceId || await personalWorkspace(db, ownerId);
  await assertCanGrantIn(db, ownerId, ws);
  const agentId = await mcpAgentFor(db, ownerId, `Key: ${label}`);
  const key = `xwk_${crypto.randomBytes(30).toString('base64url')}`;
  const row = (await db.query(`INSERT INTO workspace_agent_keys (key_sha256, key_prefix, name, owner_user_id, agent_user_id, workspace_id, scopes, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(days => $8)) RETURNING *`, [sha(key), key.slice(0, 12), label, ownerId, agentId, ws, sc, days])).rows[0];
  await grant(db, agentId, ws, capabilitiesForScopes(sc));
  return { key, credential: viewKey(row) };
}

export async function listKeys(db, ownerId) {
  return (await db.query('SELECT * FROM workspace_agent_keys WHERE owner_user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC', [ownerId])).rows.map(viewKey);
}

/** Revoke a key: refused on its next call, and its grants taken back. */
export async function revokeKey(db, ownerId, id) {
  if (!UUID.test(String(id || ''))) throw new WorkspaceCredentialError('Key not found', 'not_found', 404);
  const row = (await db.query('UPDATE workspace_agent_keys SET revoked_at = now() WHERE id = $1 AND owner_user_id = $2 AND revoked_at IS NULL RETURNING *', [id, ownerId])).rows[0];
  if (!row) throw new WorkspaceCredentialError('Key not found', 'not_found', 404);
  await revokeGrants(db, row.agent_user_id, row.workspace_id);
  await db.query(`UPDATE mcp_connections SET revoked_at = now() WHERE owner_user_id = $1 AND client_id = $2 AND revoked_at IS NULL`, [ownerId, `key:${row.id}`]);
  return { id: String(row.id), revoked: true };
}

/**
 * A key for ONE automation run (services/xenoWorkflow.js): the same xwk_ key and the same gates, minted for an agent
 * that ALREADY holds its grants (the workflow's own agent, granted when a person enabled it), living minutes rather
 * than days, and revoked when the run ends. It grants nothing itself, so revoking it takes nothing away from the
 * workflow. A headless key cannot step up, so an irreversible capability or spend above the threshold is refused.
 */
export async function createRunKey(db, { ownerId, agentId, workspaceId, scopes, label, minutes = 15 }) {
  const sc = [...new Set([].concat(scopes || []).map(String))];
  if (!sc.length || sc.some((s) => !WORKSPACE_SCOPES.includes(s))) throw new WorkspaceCredentialError('A run key needs at least one workspace scope', 'invalid_scope');
  const m = Number(minutes);
  if (!Number.isInteger(m) || m < 1 || m > 60) throw new WorkspaceCredentialError('A run key lives 1 to 60 minutes', 'invalid_expiry');
  const key = `xwk_${crypto.randomBytes(30).toString('base64url')}`;
  const row = (await db.query(`INSERT INTO workspace_agent_keys (key_sha256, key_prefix, name, owner_user_id, agent_user_id, workspace_id, scopes, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(mins => $8)) RETURNING id`, [sha(key), key.slice(0, 12), String(label || 'Automation run').slice(0, 80), ownerId, agentId, workspaceId, sc, m])).rows[0];
  return { key, id: String(row.id) };
}

/** Keep a live run key alive: its expiry moves to `minutes` from now (1..60). Never revives a revoked or lapsed key.
 *  Returns false when the key is gone, so its holder can stop. (Cloud Shell renews while its connection is open.) */
export async function renewRunKey(db, id, minutes = 60) {
  const m = Number(minutes);
  if (!Number.isInteger(m) || m < 1 || m > 60) throw new WorkspaceCredentialError('A run key lives 1 to 60 minutes', 'invalid_expiry');
  return (await db.query(`UPDATE workspace_agent_keys SET expires_at = now() + make_interval(mins => $2)
    WHERE id = $1 AND revoked_at IS NULL AND expires_at > now() RETURNING id`, [id, m])).rows.length > 0;
}

/** End a run key: refused on its next call. Grants stay with the workflow's agent. */
export async function revokeRunKey(db, id) {
  await db.query('UPDATE workspace_agent_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
}

/** The live key behind a raw xwk_ string, or null (unknown, expired or revoked). */
export async function resolveKey(db, raw) {
  if (!/^xwk_[A-Za-z0-9_-]{30,60}$/.test(String(raw || ''))) return null;
  const row = (await db.query('SELECT * FROM workspace_agent_keys WHERE key_sha256 = $1 AND revoked_at IS NULL AND expires_at > now()', [sha(raw)])).rows[0];
  if (!row) return null;
  await db.query('UPDATE workspace_agent_keys SET last_used_at = now() WHERE id = $1', [row.id]);
  return row;
}

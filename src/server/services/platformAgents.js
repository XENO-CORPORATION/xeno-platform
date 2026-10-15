/**
 * Platform agents: an agent a person creates on XENO and then BECOMES from any tool — a Spawn profile, an agent
 * CLI over XENO MCP. One service, used by /api/agents and the Dev › MCP screens.
 *
 *   - Each agent has a stable opaque id `agt_<32 hex>` (agent_identities.public_id). Tools store that, never a
 *     name, so a rename does not break a binding.
 *   - A credential is an xtk_ token minted for ONE agent, short-lived by default (1 hour, at most 365 days),
 *     shown once. A launcher mints a fresh one per launch; nothing long-lived has to sit inside a sandbox.
 *   - What the agent may reach is what the person gave it: the projects shared with it (Tasks today).
 *   - Only the person who owns the agent manages it. An agent never manages agents.
 */
import { createAgent } from './agentIdentity.js';
import * as tasks from './xenoTasks.js';

export class AgentError extends Error { constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; } }

const PUBLIC_ID = /^agt_[0-9a-f]{32}$/;
const MAX_HOURS = 365 * 24;

function person(me) {
  if (!me || me.kind !== 'human') throw new AgentError('Only a person manages agents', 'not_allowed', 403);
}
const shape = (r) => ({ id: r.public_id, userId: String(r.id), name: r.name, username: r.username, description: r.description || '', createdAt: r.created_at, status: r.status || 'active' });

async function owned(db, me, publicId) {
  person(me);
  if (!PUBLIC_ID.test(String(publicId || ''))) throw new AgentError('Agent not found', 'agent_not_found', 404);
  const r = (await db.query(`SELECT u.id, u.username, COALESCE(u.display_name, u.username) AS name, ai.public_id, ai.description, ai.created_at, ai.status
    FROM agent_identities ai JOIN users u ON u.id = ai.user_id WHERE ai.public_id = $1 AND ai.owner_user_id = $2 AND ai.status <> 'retired'`, [publicId, me.id])).rows[0];
  if (!r) throw new AgentError('Agent not found', 'agent_not_found', 404);   // someone else's agent reads as absent
  return r;
}

async function credentials(db, agentUserId) {
  return (await db.query(`SELECT id, token_prefix, scopes, label, expires_at, last_used_at, created_at FROM task_agent_tokens
    WHERE agent_user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [agentUserId])).rows
    .map((k) => ({ id: k.id, hint: `xtk_${k.token_prefix}_…`, scopes: k.scopes, label: k.label, expiresAt: k.expires_at, lastUsedAt: k.last_used_at, createdAt: k.created_at }));
}

async function full(db, r) {
  const projects = (await tasks.listTaskProjects(db, { id: r.id })).map((p) => ({ id: p.id, name: p.name, access: p.canEdit ? 'editor' : 'viewer' }));
  const connections = (await db.query(`SELECT id, client_name, created_at, last_used_at FROM mcp_connections WHERE agent_user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`, [r.id])).rows
    .map((c) => ({ id: String(c.id), client: c.client_name, createdAt: c.created_at, lastUsedAt: c.last_used_at }));
  return { ...shape(r), projects, credentials: await credentials(db, r.id), connections };
}

/** The agents a person owns, made on the platform (not the per-app agents an OAuth sign-in creates). */
export async function list(db, me) {
  person(me);
  const rows = (await db.query(`SELECT u.id, u.username, COALESCE(u.display_name, u.username) AS name, ai.public_id, ai.description, ai.created_at, ai.status
    FROM agent_identities ai JOIN users u ON u.id = ai.user_id WHERE ai.owner_user_id = $1 AND ai.agent_origin = 'platform' AND ai.status <> 'retired' ORDER BY ai.created_at`, [me.id])).rows;
  const out = []; for (const r of rows) out.push(await full(db, r));
  return out;
}
export async function get(db, me, publicId) { return full(db, await owned(db, me, publicId)); }

export async function create(db, me, { name, description } = {}) {
  person(me);
  const label = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
  if (!label) throw new AgentError('Give the agent a name', 'name_required');
  const desc = String(description || '').trim();
  if (desc.length > 500) throw new AgentError('The description is longer than 500 characters', 'description_too_long');
  const owner = (await db.query('SELECT id, username FROM users WHERE id = $1', [me.id])).rows[0];
  let made;
  try {
    made = await createAgent(db, { id: owner.id, kind: 'human', handle: owner.username },
      { name: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent', displayName: label, agentRole: 'other', agentOrigin: 'platform' });
  } catch (e) { throw new AgentError(e.message || 'Could not create the agent', e.code || 'agent_create_failed', e.statusCode || 400); }
  const row = (await db.query('SELECT id FROM users WHERE username = $1', [made.agent.handle])).rows[0];
  await db.query('UPDATE api_keys SET is_active = false WHERE user_id = $1', [row.id]);   // it acts only through its own credentials
  await db.query('UPDATE agent_identities SET description = $2 WHERE user_id = $1', [row.id, desc]);
  const pid = (await db.query('SELECT public_id FROM agent_identities WHERE user_id = $1', [row.id])).rows[0].public_id;
  return get(db, me, pid);
}

export async function update(db, me, publicId, { name, description } = {}) {
  const r = await owned(db, me, publicId);
  if (name !== undefined) {
    const label = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
    if (!label) throw new AgentError('Give the agent a name', 'name_required');
    await db.query('UPDATE users SET display_name = $2 WHERE id = $1', [r.id, label]);
  }
  if (description !== undefined) {
    const desc = String(description || '').trim();
    if (desc.length > 500) throw new AgentError('The description is longer than 500 characters', 'description_too_long');
    await db.query('UPDATE agent_identities SET description = $2 WHERE user_id = $1', [r.id, desc]);
  }
  return get(db, me, publicId);
}

/** Delete (retire): every credential and connection dies with it, so nothing bound to it keeps working. */
export async function remove(db, me, publicId) {
  const r = await owned(db, me, publicId);
  await db.query('UPDATE task_agent_tokens SET revoked_at = now() WHERE agent_user_id = $1 AND revoked_at IS NULL', [r.id]);
  await db.query('UPDATE mcp_connections SET revoked_at = now() WHERE agent_user_id = $1 AND revoked_at IS NULL', [r.id]);
  // retired, not erased: the tasks and comments it wrote keep their author, and resolvePrincipal refuses a retired agent
  await db.query(`UPDATE agent_identities SET status = 'retired' WHERE user_id = $1`, [r.id]);
  await db.query(`DELETE FROM relationship_tuples WHERE subject_type = 'user' AND subject_id = $1`, [String(r.id)]);
  return { id: publicId, deleted: true };
}

/** A credential for this agent; the secret is shown once. Default 1 hour: a launcher mints one per launch. */
export async function mintCredential(db, me, publicId, { scopes, label, ttlHours } = {}) {
  const r = await owned(db, me, publicId);
  const h = ttlHours === undefined ? 1 : Number(ttlHours);
  if (!Number.isFinite(h) || h <= 0 || h > MAX_HOURS) throw new AgentError(`ttlHours is between a minute and ${MAX_HOURS} hours`, 'invalid_ttl');
  const out = await tasks.mintAgentToken(db, me, { agentId: r.id, scopes, label: label || 'Agent credential', days: 1 });
  // mintAgentToken counts in days; set the real expiry here
  const exp = (await db.query(`UPDATE task_agent_tokens SET expires_at = now() + ($2 || ' minutes')::interval WHERE id = $1 RETURNING expires_at`, [out.id, String(Math.max(1, Math.round(h * 60)))])).rows[0].expires_at;
  return { id: out.id, token: out.token, scopes: out.scopes, expiresAt: exp, agent: { id: publicId, name: r.name } };
}
export async function revokeCredential(db, me, publicId, credentialId) {
  const r = await owned(db, me, publicId);
  const x = await db.query('UPDATE task_agent_tokens SET revoked_at = now() WHERE id::text = $1 AND agent_user_id = $2 AND revoked_at IS NULL', [String(credentialId), r.id]);
  if (!x.rowCount) throw new AgentError('Credential not found', 'credential_not_found', 404);
  return { revoked: true };
}

export async function addProject(db, me, publicId, projectId, access = 'editor') {
  const r = await owned(db, me, publicId);
  await tasks.addAgentProject(db, me, r.id, projectId, access);
  return get(db, me, publicId);
}
export async function removeProject(db, me, publicId, projectId) {
  const r = await owned(db, me, publicId);
  await tasks.removeAgentProject(db, me, r.id, projectId);
  return get(db, me, publicId);
}

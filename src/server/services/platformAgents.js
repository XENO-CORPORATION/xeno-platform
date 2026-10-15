/**
 * Platform agents: one agent = its DEFINITION (a workforce resource, kind 'agent': owner, versions, owning division)
 * linked to its PRINCIPAL (agent_identities: the account that signs in, holds credentials and is named on work).
 * XENO-WORKFORCE-01 OWN-02 keeps the two distinct; agent_identities.workforce_resource_id is the edge between them.
 *
 *   - Creating an agent creates BOTH through the existing commands: the definition via createWorkforceResource
 *     (receipt, idempotency, owner-management authority), the principal via createAgent (owner, cap), then links
 *     them. One transaction: there is never a principal without a definition or the reverse.
 *   - Each agent has a stable opaque id `agt_<32 hex>` (agent_identities.public_id). Tools (Spawn, CLIs) store that.
 *   - Instructions are VERSIONED (OWN-03): an edit is reviseAgentDefinition, a new immutable version; nothing
 *     running is moved.
 *   - DIVISION (DIV-04/08): an agent has at most one owning division, on its definition
 *     (workforce_division_ownership). It may only be given projects in the SAME division -- or, with no division,
 *     only workspace-level projects. The server refuses the rest; moving the agent revokes projects that no longer
 *     match. Owning a division also grants `editor` on it, the relation run admission reads.
 *   - A credential is an xtk_ token for ONE agent, 1 hour by default, shown once.
 *   - Only the person who owns the agent manages it. An agent never manages agents.
 */
import { randomUUID } from 'node:crypto';
import { createAgent, SYSTEM_AGENT_ORIGINS } from './agentIdentity.js';
import { createWorkforceResource } from './workforceResources.js';
import { reviseAgentDefinition } from './workforceAgentRevision.js';
import { writeTuples, check } from '../utils/authzReBAC.js';
import * as tasks from './xenoTasks.js';
import * as divisions from './workforceDivisions.js';

export class AgentError extends Error { constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; } }

const PUBLIC_ID = /^agt_[0-9a-f]{32}$/;
const MAX_HOURS = 365 * 24;
const CLIENT = 'xeno-platform-agents';

function person(me) {
  if (!me || me.kind !== 'human') throw new AgentError('Only a person manages agents', 'not_allowed', 403);
}
const asAgentError = (e, fallback) => {
  if (e instanceof AgentError) return e;
  if (e instanceof divisions.DivisionError || e instanceof tasks.TaskError) return new AgentError(e.message, e.code, e.status);
  const code = e && e.code, reason = e && e.details && e.details.reason;
  if (code === 'denied') return new AgentError('You cannot do that for this owner', reason || 'not_allowed', 403);
  if (code === 'conflict') return new AgentError('Someone changed this agent at the same time. Reload and try again.', reason || 'conflict', 409);
  if (code === 'bad_input') return new AgentError('That is not a valid agent definition', reason || 'bad_input', 400);
  if (e && e.name === 'AgentIdentityError') return new AgentError(e.message, e.code, e.statusCode || 400);
  console.error('[agents]', fallback, e && (e.code || ''), e && e.details ? JSON.stringify(e.details) : '', e && e.message, e && e.stack);
  return new AgentError(fallback, 'agent_failed', 500);
};

const ROW = `SELECT u.id, u.username, COALESCE(u.display_name, u.username) AS name, ai.public_id, ai.description, ai.created_at, ai.status,
    ai.workforce_resource_id, ai.agent_origin, r.owner_workspace_id, r.owner_user_id AS r_owner_user,
    o.division_id, d.name AS division_name, d.lifecycle AS division_lifecycle, d.workspace_id AS division_workspace
  FROM agent_identities ai JOIN users u ON u.id = ai.user_id
  LEFT JOIN workforce_resources r ON r.id = ai.workforce_resource_id
  LEFT JOIN workforce_division_ownership o ON o.resource_id = ai.workforce_resource_id
  LEFT JOIN workforce_divisions d ON d.id = o.division_id`;

async function owned(db, me, publicId) {
  person(me);
  if (!PUBLIC_ID.test(String(publicId || ''))) throw new AgentError('Agent not found', 'agent_not_found', 404);
  const r = (await db.query(`${ROW} WHERE ai.public_id = $1 AND ai.owner_user_id = $2 AND ai.status <> 'retired'`, [publicId, me.id])).rows[0];
  if (!r) throw new AgentError('Agent not found', 'agent_not_found', 404);   // someone else's reads as absent
  if (!r.workforce_resource_id) await adopt(db, me, r);                       // a pre-link agent gets its definition now
  return r.workforce_resource_id ? r : (await db.query(`${ROW} WHERE ai.public_id = $1`, [publicId])).rows[0];
}

async function credentials(db, agentUserId) {
  return (await db.query(`SELECT id, token_prefix, scopes, label, expires_at, last_used_at, created_at FROM task_agent_tokens
    WHERE agent_user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [agentUserId])).rows
    .map((k) => ({ id: k.id, hint: `xtk_${k.token_prefix}_…`, scopes: k.scopes, label: k.label, expiresAt: k.expires_at, lastUsedAt: k.last_used_at, createdAt: k.created_at }));
}
async function versions(db, resourceId) {
  if (!resourceId) return [];
  return (await db.query(`SELECT v.version, v.content, v.content_hash, v.created_at, COALESCE(u.display_name, u.username) AS by_name
    FROM workforce_agent_versions v LEFT JOIN users u ON u.id = v.created_by_user_id WHERE v.resource_id = $1 ORDER BY v.version DESC LIMIT 50`, [resourceId])).rows
    .map((v) => ({ version: v.version, hash: v.content_hash, instructions: (v.content && v.content.instructions) || '', createdAt: v.created_at, by: v.by_name || null }));
}

async function full(db, r) {
  const projects = (await tasks.listTaskProjects(db, { id: r.id })).map((p) => ({ id: p.id, name: p.name, access: p.canEdit ? 'editor' : 'viewer' }));
  for (const p of projects) p.division = await divisions.projectDivision(db, p.id);
  const connections = (await db.query(`SELECT id, client_name, created_at, last_used_at FROM mcp_connections WHERE agent_user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`, [r.id])).rows
    .map((c) => ({ id: String(c.id), client: c.client_name, createdAt: c.created_at, lastUsedAt: c.last_used_at }));
  const vs = await versions(db, r.workforce_resource_id);
  const ws = r.owner_workspace_id || (r.r_owner_user ? await divisions.personalWorkspace(db, r.r_owner_user) : null);
  const w = ws ? (await db.query('SELECT id, name, workspace_type FROM workspaces WHERE id = $1', [ws])).rows[0] : null;
  return {
    id: r.public_id, userId: String(r.id), definitionId: r.workforce_resource_id ? String(r.workforce_resource_id) : null,
    name: r.name, username: r.username, description: r.description || '', createdAt: r.created_at, status: r.status || 'active',
    workspace: w ? { id: String(w.id), name: w.name, personal: w.workspace_type === 'personal' } : null,
    division: r.division_id ? { id: String(r.division_id), name: r.division_name, archived: r.division_lifecycle !== 'active' } : null,
    instructions: vs[0] ? vs[0].instructions : '', version: vs[0] ? vs[0].version : null, versions: vs,
    projects, credentials: await credentials(db, r.id), connections,
    webhook: ((await db.query('SELECT url FROM task_agent_webhooks WHERE agent_user_id = $1', [r.id])).rows[0] || {}).url || null,
  };
}

/** The agents a person owns and manages here: every non-retired agent except the per-app ones an OAuth sign-in
 *  makes on its own (those are listed in Dev › MCP as connections). */
export async function list(db, me, { divisionId } = {}) {
  person(me);
  const byDivision = divisionId && divisionId !== 'none';
  const rows = (await db.query(`${ROW} WHERE ai.owner_user_id = $1 AND ai.status <> 'retired' AND COALESCE(ai.agent_origin, '') <> ALL($2::text[])
    ${divisionId === 'none' ? 'AND o.division_id IS NULL' : byDivision ? 'AND o.division_id = $3' : ''} ORDER BY ai.created_at`,
    byDivision ? [me.id, SYSTEM_AGENT_ORIGINS, divisionId] : [me.id, SYSTEM_AGENT_ORIGINS])).rows;
  const out = []; for (const r of rows) out.push(await full(db, r));
  return out;
}
export async function get(db, me, publicId) { return full(db, await owned(db, me, publicId)); }

const ctx = (me) => ({ actorUserId: String(me.id), clientId: CLIENT });
const defOf = (instructions) => ({ schemaVersion: 1, instructions: String(instructions || ''), skills: [], requestedCapabilities: [], provenance: { source: 'authored' } });

/** Make the workforce definition for an existing principal that predates the link (Tasks agents, earlier
 *  platform agents). Idempotent: the operation id is derived from the principal, so a retry replays. */
async function adopt(db, me, r) {
  const opId = uuidFrom(`adopt:${r.id}`);
  let made;
  try {
    made = await createWorkforceResource(db, ctx(me), { operationId: opId, owner: { type: 'user', id: String(me.id) }, kind: 'agent',
      name: String(r.name).slice(0, 200), description: String(r.description || ''), definition: defOf('') });
  } catch (e) { throw asAgentError(e, 'The agent could not be set up'); }
  const rid = made && made.resource && made.resource.id;
  if (!rid) throw new AgentError('The agent could not be set up', 'agent_failed', 500);
  await db.query(`UPDATE agent_identities SET workforce_resource_id = $2, workforce_resource_kind = 'agent' WHERE user_id = $1 AND workforce_resource_id IS NULL`, [r.id, rid]);
  r.workforce_resource_id = rid;
}
function uuidFrom(s) {
  // a stable v4-shaped id from a string, so an adoption retried after a lost response finds its own receipt
  let h = 0n; for (const c of s) h = (h * 1099511628211n + BigInt(c.codePointAt(0))) & ((1n << 128n) - 1n);
  const x = h.toString(16).padStart(32, '0').split('');
  x[12] = '4'; x[16] = '89ab'[parseInt(x[16], 16) % 4];
  const t = x.join(''); return `${t.slice(0, 8)}-${t.slice(8, 12)}-${t.slice(12, 16)}-${t.slice(16, 20)}-${t.slice(20)}`;
}

/** The agent's account handle is `<slug>.<owner>` and must fit 32 characters (handleRoutes). It is an internal
 *  account name, never how the agent is shown (its display name is) or addressed (its agt_ id is), so it is
 *  short, from the name, with a random tail so two agents with the same name never collide. */
function handleSlug(label, ownerHandle) {
  const room = Math.max(4, 32 - String(ownerHandle || '').length - 1);
  const tail = randomUUID().replace(/-/g, '').slice(0, 4);
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, Math.max(1, room - 5)).replace(/-+$/, '') || 'a';
  return `${base}-${tail}`.replace(/^[^a-z0-9]+/, 'a');
}
export async function create(db, me, { name, description, instructions, divisionId } = {}) {
  person(me);
  const label = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
  if (!label) throw new AgentError('Give the agent a name', 'name_required');
  const desc = String(description || '').trim();
  if (desc.length > 500) throw new AgentError('The description is longer than 500 characters', 'description_too_long');
  if (String(instructions || '').length > 32768) throw new AgentError('The instructions are longer than 32,768 characters', 'instructions_too_long');
  if (divisionId) await requireDivisionUsable(db, me, divisionId);
  // the definition first, through the workforce command (its receipt is the creation audit)
  let def;
  try {
    def = await createWorkforceResource(db, ctx(me), { operationId: randomUUID(), owner: { type: 'user', id: String(me.id) }, kind: 'agent',
      name: label, description: desc, definition: defOf(instructions) });
  } catch (e) { throw asAgentError(e, 'The agent could not be created'); }
  const rid = def.resource.id;
  // then the principal, linked to it. If that fails, the definition just made is archived: never a definition
  // with no one to run it.
  const owner = (await db.query('SELECT id, username FROM users WHERE id = $1', [me.id])).rows[0];
  let made;
  try {
    made = await createAgent(db, { id: owner.id, kind: 'human', handle: owner.username },
      { name: handleSlug(label, owner.username), displayName: label, agentRole: 'other', agentOrigin: 'platform' });
  } catch (e) {
    await db.query(`UPDATE workforce_resources SET status = 'archived', revision = revision + 1 WHERE id = $1 AND status = 'active'`, [rid]).catch(() => {});
    throw asAgentError(e, 'The agent could not be created');
  }
  const row = (await db.query('SELECT id FROM users WHERE username = $1', [made.agent.handle])).rows[0];
  await db.query('UPDATE api_keys SET is_active = false WHERE user_id = $1', [row.id]);   // it acts only through its own credentials
  await db.query(`UPDATE agent_identities SET description = $2, workforce_resource_id = $3, workforce_resource_kind = 'agent' WHERE user_id = $1`, [row.id, desc, rid]);
  const pid = (await db.query('SELECT public_id FROM agent_identities WHERE user_id = $1', [row.id])).rows[0].public_id;
  if (divisionId) await setDivision(db, me, pid, divisionId);
  return get(db, me, pid);
}

export async function update(db, me, publicId, { name, description, instructions } = {}) {
  const r = await owned(db, me, publicId);
  if (name !== undefined) {
    const label = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
    if (!label) throw new AgentError('Give the agent a name', 'name_required');
    await db.query('UPDATE users SET display_name = $2 WHERE id = $1', [r.id, label]);
    await db.query('UPDATE workforce_resources SET name = $2, revision = revision + 1 WHERE id = $1', [r.workforce_resource_id, label]);
  }
  if (description !== undefined) {
    const desc = String(description || '').trim();
    if (desc.length > 500) throw new AgentError('The description is longer than 500 characters', 'description_too_long');
    await db.query('UPDATE agent_identities SET description = $2 WHERE user_id = $1', [r.id, desc]);
    await db.query('UPDATE workforce_resources SET description = $2, revision = revision + 1 WHERE id = $1', [r.workforce_resource_id, desc]);
  }
  if (instructions !== undefined) {
    const cur = (await db.query('SELECT max(version)::int AS v FROM workforce_agent_versions WHERE resource_id = $1', [r.workforce_resource_id])).rows[0].v;
    if (String(instructions || '').length > 32768) throw new AgentError('The instructions are longer than 32,768 characters', 'instructions_too_long');
    const last = (await db.query('SELECT content FROM workforce_agent_versions WHERE resource_id = $1 AND version = $2', [r.workforce_resource_id, cur])).rows[0];
    if (!last || (last.content.instructions || '') !== String(instructions || '')) {
      try {
        await reviseAgentDefinition(db, ctx(me), { operationId: randomUUID(), resourceId: String(r.workforce_resource_id), baseVersion: cur,
          definition: { schemaVersion: 1, instructions: String(instructions || ''), secretReferences: last ? last.content.secretReferences || [] : [], skills: last ? last.content.skills || [] : [], requestedCapabilities: last ? last.content.requestedCapabilities || [] : [] } });
      } catch (e) { throw asAgentError(e, 'The instructions could not be saved'); }
    }
  }
  return get(db, me, publicId);
}

/** Delete (retire): every credential, connection and grant dies with it; its definition is archived. History
 *  keeps its author. */
export async function remove(db, me, publicId) {
  const r = await owned(db, me, publicId);
  await db.query('UPDATE task_agent_tokens SET revoked_at = now() WHERE agent_user_id = $1 AND revoked_at IS NULL', [r.id]);
  await db.query('UPDATE mcp_connections SET revoked_at = now() WHERE agent_user_id = $1 AND revoked_at IS NULL', [r.id]);
  await db.query(`UPDATE agent_identities SET status = 'retired' WHERE user_id = $1`, [r.id]);
  await db.query(`DELETE FROM relationship_tuples WHERE subject_type IN ('user', 'agent') AND subject_id = $1`, [String(r.id)]);
  if (r.workforce_resource_id) await db.query(`UPDATE workforce_resources SET status = 'archived', revision = revision + 1 WHERE id = $1 AND status = 'active'`, [r.workforce_resource_id]);
  return { id: publicId, deleted: true };
}

export async function mintCredential(db, me, publicId, { scopes, label, ttlHours } = {}) {
  const r = await owned(db, me, publicId);
  const h = ttlHours === undefined ? 1 : Number(ttlHours);
  if (!Number.isFinite(h) || h <= 0 || h > MAX_HOURS) throw new AgentError(`ttlHours is between a minute and ${MAX_HOURS} hours`, 'invalid_ttl');
  const out = await tasks.mintAgentToken(db, me, { agentId: r.id, scopes, label: label || 'Agent credential', days: 1 });
  const exp = (await db.query(`UPDATE task_agent_tokens SET expires_at = now() + ($2 || ' minutes')::interval WHERE id = $1 RETURNING expires_at`, [out.id, String(Math.max(1, Math.round(h * 60)))])).rows[0].expires_at;
  return { id: out.id, token: out.token, scopes: out.scopes, expiresAt: exp, agent: { id: publicId, name: r.name } };
}
/** Where the agent hears about new work: a signed webhook (or none: it pulls its event feed). The signing secret
 *  is shown once. */
export async function setWebhook(db, me, publicId, url) {
  const r = await owned(db, me, publicId);
  try { return await tasks.setAgentWebhook(db, me, { agentId: r.id, url: url || null }); } catch (e) { throw asAgentError(e, 'The webhook could not be saved'); }
}
export async function revokeCredential(db, me, publicId, credentialId) {
  const r = await owned(db, me, publicId);
  const x = await db.query('UPDATE task_agent_tokens SET revoked_at = now() WHERE id::text = $1 AND agent_user_id = $2 AND revoked_at IS NULL', [String(credentialId), r.id]);
  if (!x.rowCount) throw new AgentError('Credential not found', 'credential_not_found', 404);
  return { revoked: true };
}

// ───────────── division (DIV-04 / DIV-08)

async function requireDivisionUsable(db, me, divisionId) {
  const d = await divisions.readable(db, me, divisionId).catch((e) => { throw asAgentError(e); });
  if (d.lifecycle !== 'active') throw new AgentError('That division is archived', 'division_archived', 409);
  if (!(await divisions.mayManage(db, me, d.workspace_id))) throw new AgentError('Only a workspace admin puts agents in its divisions', 'not_allowed', 403);
  return d;
}

/** Put the agent in a division (or none). Its projects outside the new division are removed at once. */
export async function setDivision(db, me, publicId, divisionId) {
  const r = await owned(db, me, publicId);
  const cur = r.division_id ? String(r.division_id) : null;
  if (String(divisionId || '') === String(cur || '')) return get(db, me, publicId);
  if (divisionId) {
    const d = await requireDivisionUsable(db, me, divisionId);
    const ws = r.owner_workspace_id || await divisions.personalWorkspace(db, r.r_owner_user);
    if (String(d.workspace_id) !== String(ws)) throw new AgentError('An agent can only join a division of its own workspace', 'division_other_workspace', 409);
    const row = (await db.query('SELECT revision FROM workforce_division_ownership WHERE resource_id = $1', [r.workforce_resource_id])).rows[0];
    if (row) await db.query('UPDATE workforce_division_ownership SET division_id = $2, revision = revision + 1 WHERE resource_id = $1', [r.workforce_resource_id, divisionId]);
    else await db.query(`INSERT INTO workforce_division_ownership (resource_id, resource_kind, division_id, created_by_user_id) VALUES ($1, 'agent', $2, $3)`, [r.workforce_resource_id, divisionId, me.id]);
    // the funding scope follows ownership only when it was never chosen separately (D17: a default, not a fusion)
    await db.query(`UPDATE workforce_division_funding SET division_id = $2, revision = revision + 1 WHERE resource_id = $1 AND division_id IS DISTINCT FROM $2 AND division_id = $3`,
      [r.workforce_resource_id, divisionId, cur]);
  } else if (cur) {
    await db.query('DELETE FROM workforce_division_funding WHERE resource_id = $1 AND division_id = $2', [r.workforce_resource_id, cur]);
    await db.query('DELETE FROM workforce_division_ownership WHERE resource_id = $1', [r.workforce_resource_id]);
  }
  // DIV-08: it acts inside its division -- and no longer inside the one it left
  if (cur) await writeTuples(db, { deletes: [{ object: `division:${cur}`, relation: 'editor', subject: `agent:${r.id}` }] });
  if (divisionId) await writeTuples(db, { writes: [{ object: `division:${divisionId}`, relation: 'editor', subject: `agent:${r.id}` }] });
  // and every project outside it is taken away
  for (const p of await tasks.listTaskProjects(db, { id: r.id })) {
    const pd = await divisions.projectDivision(db, p.id);
    if (String(pd ? pd.id : '') !== String(divisionId || '')) await tasks.removeAgentProject(db, me, r.id, p.id).catch(() => {});
  }
  return get(db, me, publicId);
}

/** Give the agent a project: only one in its own division (or, with no division, a workspace-level one). */
export async function addProject(db, me, publicId, projectId, access = 'editor') {
  const r = await owned(db, me, publicId);
  const pd = await divisions.projectDivision(db, projectId);
  const mine = r.division_id ? String(r.division_id) : null;
  if (String(pd ? pd.id : '') !== String(mine || '')) {
    throw new AgentError(pd ? `That project is in ${pd.name}. Put the agent in ${pd.name} first, or move the project.`
      : `That project is not in a division, and ${r.name} works in ${r.division_name}. Move the project into ${r.division_name} first.`,
    'division_mismatch', 409);
  }
  try { await tasks.addAgentProject(db, me, r.id, projectId, access); } catch (e) { throw asAgentError(e); }
  return get(db, me, publicId);
}
export async function removeProject(db, me, publicId, projectId) {
  const r = await owned(db, me, publicId);
  try { await tasks.removeAgentProject(db, me, r.id, projectId); } catch (e) { throw asAgentError(e); }
  return get(db, me, publicId);
}

/** Projects this person could give the agent, each marked with whether its division matches. */
export async function projectChoices(db, me, publicId) {
  const r = await owned(db, me, publicId);
  const mine = r.division_id ? String(r.division_id) : null;
  const out = [];
  for (const p of await tasks.listTaskProjects(db, { id: me.id })) {
    const admin = (await check(db, { object: `project:${p.id}`, relation: 'admin', subject: `user:${me.id}` })).allowed;
    const pd = await divisions.projectDivision(db, p.id);
    out.push({ id: p.id, name: p.name, division: pd, canGive: admin && String(pd ? pd.id : '') === String(mine || ''), admin });
  }
  return out;
}

/**
 * XENO Message = XENO Comms, reached SERVER-TO-SERVER from the workspace (owner, 2026-10-23: "for message we already
 * have xeno comms … that will power this"). The platform stores NO messages: every message, member, receipt and
 * thread lives in Comms. What lives here is the AUTHORITY Comms does not have — who belongs to a workspace, a
 * division, a team or a project — and the links between platform principals and Comms rows.
 *
 * Identity. Each call carries a 60-second assertion the platform signs with its own OIDC key (/api/oauth2/jwks):
 *
 *   aud        'xeno-comms'                  refused by every platform API (none accepts that audience)
 *   typ        'xeno-comms-assertion+jwt'
 *   sub        the acting member — a person OR an agent (agents are Comms members in their own right, kind=agent)
 *   xeno_scope { workspace, key, title, members_sha256 } when the call opens a workspace channel
 *
 * Comms already verifies a bearer by asking the platform (XENO_COMMS_PLATFORM_AUTH_VALIDATE_URL), so Comms points
 * that at GET /api/comms/identity (routes/commsIdentityRoutes.js → `identityFor` below), which verifies the
 * assertion, spends its jti once, and answers the member's kind, owner and the signed scope. No second credential
 * exists and nothing here can leak one.
 *
 * Scoping (XENO-WORKFORCE-01 §8.11): a channel is ONE workspace scope. Its audience is computed from the platform's
 * own authority on every open (`audienceOf`), the caller must be in it, and Comms is told to make the channel's
 * membership exactly that audience (POST /v1/platform/scoped-conversations, bound to the assertion by digest). A
 * person removed from a team is removed from its channel the next time anyone opens it — and every read and write
 * through the workspace re-checks the audience BEFORE Comms is called, so they lose it here at once.
 *
 * Fail closed: without XENO_COMMS_API_URL every call answers `message_not_configured`.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getSigningKey, jwks } from '../utils/oidcProvider.js';
import { issuer } from '../config/hosts.js';
import { check, ROLE_RANK } from '../utils/authzReBAC.js';
import { ensurePersonalWorkspace } from './personalWorkspace.js';
import { resolvePrincipal } from './agentIdentity.js';
import { delegateWork, HandoffError } from './chatHandoff.js';

export class MessageError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'MessageError'; this.code = code; this.status = status; }
}

export const ASSERTION_AUDIENCE = 'xeno-comms';
export const ASSERTION_TYP = 'xeno-comms-assertion+jwt';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_KEY = /^(workspace|(division|team|project):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const MAX_AUDIENCE = 1000;

/** Where Comms' REST lives, or null when this platform is not wired to it. Read at call time (tests set it). */
export function commsApiBase() {
  const raw = String(process.env.XENO_COMMS_API_URL || '').trim().replace(/\/+$/, '');
  return raw || null;
}
/** The Comms realtime gateway (Phoenix), e.g. wss://comms-gateway.xenostudio.ai/socket. Optional. */
export function commsGatewayUrl() {
  const raw = String(process.env.XENO_COMMS_GATEWAY_URL || '').trim().replace(/\/+$/, '');
  return /^wss?:\/\//.test(raw) ? raw : null;
}

// ─────────────────────────────────────────── the assertion, both directions

/** The canonical member digest. Comms computes the identical string (server/api/src/http.rs scoped_member_digest). */
export function memberDigest(members) {
  const lines = members.map((m) => [m.subject, m.kind, m.ownerSubject || '', m.displayName, m.handle || ''].join('\t')).sort();
  return crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

export async function mintAssertion(db, { subject, workspaceId = null, scope = null }) {
  const key = await getSigningKey(db);
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: String(subject), jti: crypto.randomUUID(), ...(workspaceId ? { xeno_workspace: String(workspaceId) } : {}), ...(scope ? { xeno_scope: scope } : {}) };
  return jwt.sign({ ...claims, iat: now, exp: now + 60 }, key.privatePem, { algorithm: 'ES256', keyid: key.kid, issuer: issuer(), audience: ASSERTION_AUDIENCE, header: { typ: ASSERTION_TYP, kid: key.kid, alg: 'ES256' } });
}

/** Is this bearer one of our Comms assertions? (Only the header is read; nothing is trusted from it.) */
export function isCommsAssertion(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[0], 'base64url').toString()).typ === ASSERTION_TYP; } catch { return false; }
}

/**
 * Verify an assertion Comms received and answer what Comms needs to know about the member. Each assertion is
 * accepted ONCE: Comms verifies once per request, so a replayed bearer is refused here.
 */
export async function identityFor(db, token) {
  let claims = null;
  const hdr = (() => { try { return JSON.parse(Buffer.from(String(token).split('.')[0], 'base64url').toString()); } catch { return null; } })();
  if (!hdr || hdr.typ !== ASSERTION_TYP || hdr.alg !== 'ES256') return null;
  for (const k of (await jwks(db)).keys) {
    if (hdr.kid && k.kid && k.kid !== hdr.kid) continue;
    try { claims = jwt.verify(token, crypto.createPublicKey({ key: k, format: 'jwk' }), { algorithms: ['ES256'], audience: ASSERTION_AUDIENCE, issuer: issuer() }); break; } catch { claims = null; }
  }
  if (!claims || typeof claims.exp !== 'number' || typeof claims.iat !== 'number' || claims.exp - claims.iat > 60 || !UUID.test(String(claims.jti || ''))) return null;
  const spent = await db.query(`INSERT INTO comms_assertion_uses (jti, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT (jti) DO NOTHING RETURNING jti`, [claims.jti, claims.exp + 60]);
  if (!spent.rows.length) return null;   // replayed
  if (Math.random() < 0.02) db.query('DELETE FROM comms_assertion_uses WHERE expires_at < now()').catch(() => {});
  if (!UUID.test(String(claims.sub || ''))) return null;
  const p = await resolvePrincipal(db, claims.sub);
  if (!p || !p.usable || p.kind === 'service') return null;
  const user = { id: String(p.id), username: p.handle || null, displayName: p.displayName || p.handle || 'Member', kind: p.kind, ...(p.kind === 'agent' ? { ownerId: String(p.owner.id) } : {}) };
  const s = claims.xeno_scope;
  const scope = s && typeof s === 'object' && UUID.test(String(s.workspace || '')) && SCOPE_KEY.test(String(s.key || '')) && /^[0-9a-f]{64}$/.test(String(s.members_sha256 || ''))
    ? { workspaceId: String(s.workspace), key: String(s.key), title: String(s.title || '').slice(0, 120) || 'Channel', membersSha256: String(s.members_sha256) } : null;
  return { success: true, user, ...(scope ? { scope } : {}) };
}

// ─────────────────────────────────────────── who the caller is, and which workspace

async function principalOf(db, actor) {
  if (!actor || !actor.id) throw new MessageError('No caller', 'not_allowed', 401);
  const p = await resolvePrincipal(db, actor.id);
  if (!p || !p.usable) throw new MessageError('This account cannot use Message right now', 'not_allowed', 403);
  if (p.kind === 'service') throw new MessageError('A service account is not a member of a workspace', 'not_allowed', 403);
  return p;
}

export async function workspaceFor(db, actor, workspaceId) {
  const me = await principalOf(db, actor);
  let ws = workspaceId ? String(workspaceId) : null;
  if (ws && !UUID.test(ws)) throw new MessageError('Invalid workspace id', 'invalid_workspace');
  if (!ws) {
    if (me.kind === 'agent') throw new MessageError('Name the workspace', 'invalid_workspace');
    ws = String((await ensurePersonalWorkspace(db, me.id)).id);
  }
  if (!(await check(db, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${me.id}` })).allowed) throw new MessageError('You are not a member of that workspace', 'not_a_member', 403);
  const row = (await db.query('SELECT id, name FROM workspaces WHERE id = $1', [ws])).rows[0];
  if (!row) throw new MessageError('You are not a member of that workspace', 'not_a_member', 403);
  return { me, workspaceId: ws, workspaceName: row.name };
}

// ─────────────────────────────────────────── scopes and their audiences (the platform's authority)

const ROLES = Object.keys(ROLE_RANK);
async function tupleSubjects(db, object) {
  const [type, id] = object.split(':');
  return (await db.query(`SELECT DISTINCT subject_id FROM relationship_tuples WHERE object_type = $1 AND object_id = $2 AND subject_type = 'user' AND relation = ANY($3)`, [type, id, ROLES])).rows.map((r) => r.subject_id).filter((x) => UUID.test(x));
}

/** The object a scope key names, if it belongs to this workspace (someone else's reads as absent). */
async function scopeObject(db, ws, key) {
  if (!SCOPE_KEY.test(String(key || ''))) throw new MessageError('Unknown channel', 'channel_not_found', 404);
  if (key === 'workspace') return { kind: 'workspace', id: ws, title: null };
  const [kind, id] = key.split(':');
  const row = kind === 'division' ? (await db.query(`SELECT name FROM workforce_divisions WHERE id = $1 AND workspace_id = $2 AND lifecycle = 'active'`, [id, ws])).rows[0]
    : kind === 'team' ? (await db.query(`SELECT name FROM workforce_resources WHERE id = $1 AND kind = 'team' AND owner_workspace_id = $2 AND status = 'active'`, [id, ws])).rows[0]
      : (await db.query(`SELECT name FROM chat_projects WHERE id = $1 AND workspace_id = $2 AND NOT is_archived`, [id, ws])).rows[0];
  if (!row) throw new MessageError('Unknown channel', 'channel_not_found', 404);
  return { kind, id, title: row.name };
}

const viewerOf = async (db, object, userId) => (await check(db, { object, relation: 'viewer', subject: `user:${userId}` })).allowed;

/**
 * Who belongs to a scope, right now, from the platform's own records:
 *   workspace, division   every member of the workspace (a division is visible to its workspace)
 *   project               everyone who can see the project
 *   team                  the team's active members, plus the workspace's admins
 * An agent is included only while usable and only with its owner in the same audience (Comms keeps an agent owned
 * by a member).
 */
export async function audienceOf(db, ws, key) {
  const o = await scopeObject(db, ws, key);
  const wsCandidates = await tupleSubjects(db, `workspace:${ws}`);
  const owner = (await db.query('SELECT owner_user_id FROM workspaces WHERE id = $1', [ws])).rows[0];
  if (owner && owner.owner_user_id) wsCandidates.push(String(owner.owner_user_id));
  let ids = [];
  if (o.kind === 'workspace' || o.kind === 'division') {
    for (const u of new Set(wsCandidates)) if (await viewerOf(db, `workspace:${ws}`, u)) ids.push(u);
  } else if (o.kind === 'project') {
    for (const u of new Set([...wsCandidates, ...(await tupleSubjects(db, `project:${o.id}`))])) if (await viewerOf(db, `project:${o.id}`, u)) ids.push(u);
  } else {
    const members = (await db.query(`SELECT member_principal_id FROM workforce_team_memberships WHERE team_id = $1 AND state = 'active' AND member_principal_id IS NOT NULL`, [o.id])).rows.map((r) => String(r.member_principal_id));
    const admins = [];
    for (const u of new Set(wsCandidates)) if ((await check(db, { object: `workspace:${ws}`, relation: 'admin', subject: `user:${u}` })).allowed) admins.push(u);
    for (const u of new Set([...members, ...admins])) {
      const isAgent = (await db.query('SELECT 1 FROM agent_identities WHERE user_id = $1', [u])).rows.length > 0;
      if (isAgent || await viewerOf(db, `workspace:${ws}`, u)) ids.push(u);
    }
  }
  ids = [...new Set(ids)].slice(0, MAX_AUDIENCE * 2);
  const people = [];
  for (const id of ids) {
    const p = await resolvePrincipal(db, id);
    if (!p || !p.usable || p.kind === 'service') continue;
    people.push(p);
  }
  const inAudience = new Set(people.filter((p) => p.kind === 'human').map((p) => String(p.id)));
  const members = people.filter((p) => p.kind === 'human' || inAudience.has(String(p.owner.id))).slice(0, MAX_AUDIENCE).map((p) => ({
    subject: String(p.id), kind: p.kind, ...(p.kind === 'agent' ? { ownerSubject: String(p.owner.id) } : {}),
    displayName: String(p.displayName || p.handle || 'Member').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120).trim() || 'Member',
    ...(p.handle ? { handle: String(p.handle).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64) } : {}),
  }));
  return { scope: o, members };
}

const titleFor = (o, wsName) => (o.kind === 'workspace' ? (wsName || 'Workspace') : o.title).slice(0, 120);

/** Every scope in this workspace the caller belongs to. */
async function scopesFor(db, me, ws) {
  const out = [{ key: 'workspace', kind: 'workspace', id: ws }];
  for (const d of (await db.query(`SELECT id, name FROM workforce_divisions WHERE workspace_id = $1 AND lifecycle = 'active' ORDER BY name`, [ws])).rows) out.push({ key: `division:${d.id}`, kind: 'division', id: String(d.id), title: d.name });
  const isAdmin = me.kind === 'human' && (await check(db, { object: `workspace:${ws}`, relation: 'admin', subject: `user:${me.id}` })).allowed;
  for (const t of (await db.query(`SELECT r.id, r.name, EXISTS (SELECT 1 FROM workforce_team_memberships m WHERE m.team_id = r.id AND m.state = 'active' AND m.member_principal_id = $2) AS mine
      FROM workforce_resources r WHERE r.kind = 'team' AND r.owner_workspace_id = $1 AND r.status = 'active' ORDER BY r.name`, [ws, me.id])).rows) {
    if (t.mine || isAdmin) out.push({ key: `team:${t.id}`, kind: 'team', id: String(t.id), title: t.name });
  }
  for (const p of (await db.query(`SELECT id, name FROM chat_projects WHERE workspace_id = $1 AND NOT is_archived ORDER BY name`, [ws])).rows) {
    if (await viewerOf(db, `project:${p.id}`, me.id)) out.push({ key: `project:${p.id}`, kind: 'project', id: String(p.id), title: p.name });
  }
  return out;
}

/** The scoping gate every channel read and write passes BEFORE Comms is called. */
async function requireScope(db, ctx, key) {
  const a = await audienceOf(db, ctx.workspaceId, key);
  if (!a.members.some((m) => m.subject === String(ctx.me.id))) throw new MessageError('You are not a member of that channel', 'not_in_channel', 403);
  return a;
}

// ─────────────────────────────────────────── the one HTTP path to Comms

async function rawCall(db, principalId, method, path, { json, deviceId, scope, workspaceId, fetchImpl = globalThis.fetch } = {}) {
  const base = commsApiBase();
  if (!base) throw new MessageError('Message is not set up on this server yet', 'message_not_configured', 503);
  const token = await mintAssertion(db, { subject: principalId, workspaceId, scope });
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  if (deviceId) headers['x-xeno-device-id'] = String(deviceId);
  let body;
  if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  let res;
  try { res = await fetchImpl(base + path, { method, headers, body, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new MessageError('XENO Comms did not answer', 'comms_unreachable', 502); }
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = (data && (typeof data.message === 'string' ? data.message : data.error && (data.error.message || data.error))) || `XENO Comms answered ${res.status}`;
    const code = res.status === 401 ? 'comms_refused_assertion' : res.status === 403 ? 'comms_forbidden' : res.status === 404 ? 'comms_not_found' : res.status === 429 ? 'comms_rate_limited' : 'comms_error';
    throw new MessageError(String(msg).slice(0, 300), code, res.status === 401 || res.status === 403 ? 403 : res.status === 404 ? 404 : res.status === 429 ? 429 : 502);
  }
  return data;
}

const memberRow = async (db, id) => (await db.query('SELECT comms_user_id, comms_device_id FROM comms_members WHERE platform_user_id = $1', [id])).rows[0] || null;
async function saveMember(db, platformUserId, commsUserId, deviceId = null) {
  await db.query(`INSERT INTO comms_members (platform_user_id, comms_user_id, comms_device_id) VALUES ($1,$2,$3)
    ON CONFLICT (platform_user_id) DO UPDATE SET comms_user_id = EXCLUDED.comms_user_id, comms_device_id = COALESCE(EXCLUDED.comms_device_id, comms_members.comms_device_id), updated_at = now()`, [platformUserId, commsUserId, deviceId]);
}

/** Make `p` a Comms member with this workspace's device. An agent's owner joins first (Comms owns agents by owner). */
async function ensureMember(db, p, opts = {}) {
  const row = await memberRow(db, p.id);
  if (row && row.comms_device_id) return row;
  if (p.kind === 'agent') await ensureMember(db, await resolvePrincipal(db, p.owner.id), opts);
  const d = await rawCall(db, p.id, 'POST', '/v1/devices/register', { json: { kind: 'embed', label: 'XENO workspace', displayName: String(p.displayName || p.handle || 'Member').slice(0, 120) }, fetchImpl: opts.fetchImpl });
  if (!d || !d.user || !UUID.test(String(d.user.id)) || !d.device || !UUID.test(String(d.device.id))) throw new MessageError('XENO Comms did not register this member', 'comms_error', 502);
  await saveMember(db, p.id, d.user.id, d.device.id);
  return { comms_user_id: d.user.id, comms_device_id: d.device.id };
}

/** One call to Comms as member `p`. A revoked device is re-registered once. */
async function call(db, p, method, path, opts = {}) {
  let m = await ensureMember(db, p, opts);
  try { return await rawCall(db, p.id, method, path, { ...opts, deviceId: m.comms_device_id }); }
  catch (e) {
    if (!(e instanceof MessageError) || e.code !== 'comms_refused_assertion') throw e;
    await db.query('UPDATE comms_members SET comms_device_id = NULL, updated_at = now() WHERE platform_user_id = $1', [p.id]);
    m = await ensureMember(db, p, opts);
    return rawCall(db, p.id, method, path, { ...opts, deviceId: m.comms_device_id });
  }
}

// ─────────────────────────────────────────── shapes

const nameMap = async (db, commsIds) => {
  const ids = [...new Set(commsIds.filter((x) => UUID.test(String(x || ''))))];
  if (!ids.length) return new Map();
  const rows = (await db.query(`SELECT m.comms_user_id, u.id, COALESCE(u.display_name, u.username) AS name, (ai.user_id IS NOT NULL) AS agent
    FROM comms_members m JOIN users u ON u.id = m.platform_user_id LEFT JOIN agent_identities ai ON ai.user_id = u.id WHERE m.comms_user_id = ANY($1::uuid[])`, [ids])).rows;
  return new Map(rows.map((r) => [String(r.comms_user_id), { id: String(r.id), name: r.name || 'Member', kind: r.agent ? 'agent' : 'human' }]));
};
const messageOf = (m, names) => ({
  id: String(m.id), author: names.get(String(m.senderUserId)) || { id: null, name: 'Someone', kind: 'human' },
  text: m.deletedAt ? '' : String(m.body || ''), encrypted: !m.body && !!m.encryptedPayload, deleted: !!m.deletedAt,
  replyTo: m.replyToMessageId ? String(m.replyToMessageId) : null, createdAt: m.createdAt || null, editedAt: m.editedAt || null,
});

// ─────────────────────────────────────────── operations (REST, MCP and the screen all call these)

export async function status(db, actor, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace);
  return { configured: !!commsApiBase(), realtime: !!commsGatewayUrl(), workspaceId: ctx.workspaceId };
}

/** Channels the caller belongs to (one per scope, created on first open) and their direct messages here. */
export async function listConversations(db, actor, { workspace, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace);
  const scopes = await scopesFor(db, ctx.me, ctx.workspaceId);
  const linked = new Map((await db.query('SELECT scope_key, comms_conversation_id, title FROM comms_channels WHERE workspace_id = $1', [ctx.workspaceId])).rows.map((r) => [r.scope_key, r]));
  let comms = [];
  if (commsApiBase()) comms = (await call(db, ctx.me, 'GET', '/v1/conversations', { fetchImpl })) || [];
  const byId = new Map((Array.isArray(comms) ? comms : []).map((c) => [String(c.id), c]));
  const unread = (c) => !!(c && c.lastMessageId && c.lastMessageId !== c.lastReadMessageId);
  const channels = scopes.map((s) => {
    const l = linked.get(s.key), c = l && byId.get(String(l.comms_conversation_id));
    return { key: s.key, kind: s.kind, title: titleFor(s, ctx.workspaceName), conversationId: l ? String(l.comms_conversation_id) : null, lastMessageAt: c ? c.lastMessageAt || null : null, unread: unread(c) };
  });
  const dms = [];
  for (const r of (await db.query(`SELECT d.comms_conversation_id, CASE WHEN d.user_low = $1 THEN d.user_high ELSE d.user_low END AS other
      FROM comms_direct_messages d WHERE d.user_low = $1 OR d.user_high = $1`, [ctx.me.id])).rows) {
    if (!(await viewerOf(db, `workspace:${ctx.workspaceId}`, r.other))) continue;   // only co-members of THIS workspace
    const c = byId.get(String(r.comms_conversation_id));
    if (!c) continue;   // left or archived in Comms
    const o = await resolvePrincipal(db, r.other);
    dms.push({ conversationId: String(r.comms_conversation_id), with: { id: String(r.other), name: (o && (o.displayName || o.handle)) || 'Member', kind: o ? o.kind : 'human' }, lastMessageAt: c.lastMessageAt || null, unread: unread(c) });
  }
  return { configured: !!commsApiBase(), channels, dms };
}

/** Find or create the channel for a scope and make Comms' membership exactly its audience. */
export async function openChannel(db, actor, { workspace, key, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace);
  const a = await requireScope(db, ctx, key);
  const title = titleFor(a.scope, ctx.workspaceName);
  const scope = { workspace: ctx.workspaceId, key, title, members_sha256: memberDigest(a.members) };
  const r = await call(db, ctx.me, 'POST', '/v1/platform/scoped-conversations', { json: { members: a.members }, scope, workspaceId: ctx.workspaceId, fetchImpl });
  if (!r || !r.conversation || !UUID.test(String(r.conversation.id))) throw new MessageError('XENO Comms did not open the channel', 'comms_error', 502);
  for (const m of Array.isArray(r.members) ? r.members : []) if (UUID.test(String(m.subject)) && UUID.test(String(m.userId))) await saveMember(db, m.subject, m.userId);
  await db.query(`INSERT INTO comms_channels (workspace_id, scope_key, comms_conversation_id, title, member_count) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (workspace_id, scope_key) DO UPDATE SET comms_conversation_id = EXCLUDED.comms_conversation_id, title = EXCLUDED.title, member_count = EXCLUDED.member_count, synced_at = now()`,
  [ctx.workspaceId, key, r.conversation.id, title, a.members.length]);
  return { ctx, channel: { key, kind: a.scope.kind, title, conversationId: String(r.conversation.id), members: a.members.length } };
}

/** Resolve what a read/write names — a channel scope key or a direct message — and gate it. */
async function target(db, actor, { workspace, key, conversationId, fetchImpl }) {
  if (key) { const o = await openChannel(db, actor, { workspace, key, fetchImpl }); return { ctx: o.ctx, conversationId: o.channel.conversationId, channel: o.channel }; }
  const ctx = await workspaceFor(db, actor, workspace);
  if (!UUID.test(String(conversationId || ''))) throw new MessageError('Unknown conversation', 'conversation_not_found', 404);
  const d = (await db.query('SELECT user_low, user_high FROM comms_direct_messages WHERE comms_conversation_id = $1', [conversationId])).rows[0];
  if (!d || ![String(d.user_low), String(d.user_high)].includes(String(ctx.me.id))) throw new MessageError('Unknown conversation', 'conversation_not_found', 404);
  const other = String(d.user_low) === String(ctx.me.id) ? d.user_high : d.user_low;
  if (!(await viewerOf(db, `workspace:${ctx.workspaceId}`, other))) throw new MessageError('That person is not in this workspace', 'not_a_member', 403);
  return { ctx, conversationId: String(conversationId), channel: null };
}

/** Messages, oldest first. `thread` = a message id: that message and its replies. Otherwise top-level messages with reply counts. */
export async function readMessages(db, actor, { workspace, key, conversationId, thread, fetchImpl } = {}) {
  const t = await target(db, actor, { workspace, key, conversationId, fetchImpl });
  const raw = (await call(db, t.ctx.me, 'GET', `/v1/conversations/${t.conversationId}/messages?limit=100`, { fetchImpl })) || [];
  const list = (Array.isArray(raw) ? raw : []).slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const names = await nameMap(db, list.map((m) => m.senderUserId));
  const msgs = list.map((m) => messageOf(m, names));
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const rootOf = (m) => { let x = m, n = 0; while (x.replyTo && byId.has(x.replyTo) && n++ < 50) x = byId.get(x.replyTo); return x.id; };
  if (thread) {
    if (!byId.has(String(thread))) throw new MessageError('That thread is not in this conversation', 'thread_not_found', 404);
    const root = rootOf(byId.get(String(thread)));
    return { conversationId: t.conversationId, channel: t.channel, parent: byId.get(root), messages: msgs.filter((m) => m.id !== root && rootOf(m) === root) };
  }
  const counts = new Map();
  for (const m of msgs) if (m.replyTo) { const r = rootOf(m); counts.set(r, (counts.get(r) || 0) + 1); }
  return { conversationId: t.conversationId, channel: t.channel, messages: msgs.filter((m) => !m.replyTo || !byId.has(m.replyTo)).map((m) => ({ ...m, replies: counts.get(m.id) || 0 })) };
}

const asText = (s) => { const v = String(s ?? '').trim(); if (!v) throw new MessageError('Write something first', 'invalid_text'); if (v.length > 8000) throw new MessageError('A message is at most 8,000 characters', 'invalid_text'); return v; };

export async function postMessage(db, actor, { workspace, key, conversationId, text, replyTo, clientMessageId, fetchImpl } = {}) {
  const t = await target(db, actor, { workspace, key, conversationId, fetchImpl });
  if (replyTo && !UUID.test(String(replyTo))) throw new MessageError('Invalid reply', 'invalid_reply');
  const body = { kind: 'text', body: asText(text), ...(replyTo ? { replyToMessageId: String(replyTo) } : {}), clientMessageId: UUID.test(String(clientMessageId || '')) ? String(clientMessageId) : crypto.randomUUID() };
  const m = await call(db, t.ctx.me, 'POST', `/v1/conversations/${t.conversationId}/messages`, { json: body, fetchImpl });
  return { conversationId: t.conversationId, message: messageOf(m || {}, await nameMap(db, [m && m.senderUserId])) };
}

/** A direct message with a co-member of this workspace (never anyone outside it). */
export async function openDirect(db, actor, { workspace, userId, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace);
  if (ctx.me.kind !== 'human') throw new MessageError('Only a person starts a direct message', 'person_required', 403);
  if (!UUID.test(String(userId || '')) || String(userId) === String(ctx.me.id)) throw new MessageError('Choose someone else', 'invalid_member');
  if (!(await viewerOf(db, `workspace:${ctx.workspaceId}`, userId))) throw new MessageError('That person is not in this workspace', 'not_a_member', 403);
  const other = await resolvePrincipal(db, userId);
  if (!other || !other.usable || other.kind !== 'human') throw new MessageError('That person cannot be messaged', 'invalid_member');
  const [low, high] = [String(ctx.me.id), String(userId)].sort();
  const have = (await db.query('SELECT comms_conversation_id FROM comms_direct_messages WHERE user_low = $1 AND user_high = $2', [low, high])).rows[0];
  if (have) return { conversationId: String(have.comms_conversation_id), with: { id: String(userId), name: other.displayName || other.handle || 'Member' } };
  await ensureMember(db, ctx.me, { fetchImpl });
  let peer = await memberRow(db, userId);
  if (!peer) { await openChannel(db, actor, { workspace: ctx.workspaceId, key: 'workspace', fetchImpl }); peer = await memberRow(db, userId); }   // the workspace channel makes every member a Comms user
  if (!peer) throw new MessageError('That person is not in XENO Comms yet', 'comms_not_found', 404);
  const c = await call(db, ctx.me, 'POST', '/v1/conversations/dm', { json: { participantUserIds: [peer.comms_user_id], e2ee: 'none' }, fetchImpl });
  if (!c || !UUID.test(String(c.id))) throw new MessageError('XENO Comms did not open the conversation', 'comms_error', 502);
  await db.query('INSERT INTO comms_direct_messages (user_low, user_high, comms_conversation_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [low, high, c.id]);
  return { conversationId: String(c.id), with: { id: String(userId), name: other.displayName || other.handle || 'Member' } };
}

/**
 * `@agent` on a message: the chat's own hand-off (a task filed where the channel lives, delegated to the agent, run
 * when the person may run it), then a reply in the message's thread saying where the work went.
 */
export async function handOff(db, actor, { workspace, key, conversationId, messageId, agentId, prompt, run = true, fetchImpl } = {}, opts = {}) {
  const t = await target(db, actor, { workspace, key, conversationId, fetchImpl });
  if (t.ctx.me.kind !== 'human') throw new MessageError('Only a person hands work to an agent', 'person_required', 403);
  const text = String(prompt || '').trim();
  if (!text) throw new MessageError('Write what the agent should do', 'prompt_required');
  if (text.length > 20000) throw new MessageError('The prompt is longer than 20,000 characters', 'prompt_too_long');
  if (messageId && !UUID.test(String(messageId))) throw new MessageError('Invalid message', 'invalid_message');
  // the message's real address (prototypes/xeno-workspace/address.js): /workspace/social/spaces/message/<scope>/t/<id>
  const where = `/workspace/social/spaces/message/${key ? key.replace(':', '/') : `dm/${t.conversationId}`}${messageId ? `/t/${messageId}` : ''}`;
  const label = t.channel ? `#${t.channel.title}` : 'a direct message';
  const project = key && key.startsWith('project:') ? key.slice(8) : null;
  let out;
  try {
    out = await delegateWork(db, { id: t.ctx.me.id, kind: 'human' }, { agentId, text, body: `${text}\n\n— Handed off from ${label} in XENO Message (${where}).`,
      task: { source: 'manual', sourceRef: `comms:${t.conversationId}${messageId ? ':' + messageId : ''}`, ...(project ? { projectId: project } : {}) }, run }, opts);
  } catch (e) { if (e instanceof HandoffError || (e && e.code && e.status)) throw new MessageError(e.message, e.code || 'handoff_failed', e.status || 400); throw e; }
  const note = out.delegated ? `Handed to ${out.agent.name} as ${out.task.key}${out.run ? ' — running' : out.runNote ? ` — ${out.runNote}` : ''}` : `Not handed to ${out.agent.name}: ${out.reason}`;
  await call(db, t.ctx.me, 'POST', `/v1/conversations/${t.conversationId}/messages`, { json: { kind: 'text', body: note, ...(messageId ? { replyToMessageId: String(messageId) } : {}), clientMessageId: crypto.randomUUID() }, fetchImpl }).catch(() => null);
  return { handoff: out, note };
}

/** What the browser needs to join the Comms realtime gateway as this member: a fresh single-use assertion. */
export async function realtimeTicket(db, actor, { workspace, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace);
  const url = commsGatewayUrl();
  if (!url || !commsApiBase()) return { realtime: false };
  const m = await ensureMember(db, ctx.me, { fetchImpl });
  return { realtime: true, url, token: await mintAssertion(db, { subject: ctx.me.id, workspaceId: ctx.workspaceId }), deviceId: String(m.comms_device_id), userId: String(m.comms_user_id) };
}

/** Co-members of this workspace a person can message directly (for the New message dialog). */
export async function directory(db, actor, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace);
  const a = await audienceOf(db, ctx.workspaceId, 'workspace');
  return { people: a.members.filter((m) => m.kind === 'human' && m.subject !== String(ctx.me.id)).map((m) => ({ id: m.subject, name: m.displayName, handle: m.handle || null })),
    agents: a.members.filter((m) => m.kind === 'agent').map((m) => ({ id: m.subject, name: m.displayName })) };
}

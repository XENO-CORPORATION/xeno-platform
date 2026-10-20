/**
 * XENO Publish = XENO Post (post.xenosystem.ai), reached SERVER-TO-SERVER from the workspace.
 *
 * The workspace never holds a xeno-post credential. Each call carries a 60-second assertion the platform signs with
 * its own OIDC key (the one at /api/oauth2/jwks): `sub` is the person's XENO account id — the same id xeno-post
 * already stores as `users.xenoAccountId` when they sign in with XENO — so xeno-post resolves the person through the
 * link it already has and applies THEIR membership in its workspace. There is no second link and nothing to leak.
 *
 *   aud            'xeno-post'            refused by every platform API (none accepts that audience)
 *   typ            'xeno-post-assertion+jwt'
 *   xeno_workspace the XENO workspace the call is made for
 *   post_workspace the xeno-post workspace it maps to (publish_workspace_links)
 *   act            { sub: <agent user id> } when an agent acts for its owner
 *
 * Ownership (XENO-WORKFORCE-01 §8.11): the WORKSPACE owns its Publish link; any member reads, editors write drafts,
 * admins link the workspace and connect channels. Publishing reaches an audience and cannot be taken back, so
 * publish-now and retract need a person and `confirm: true`, and an agent's schedule is a request a person confirms.
 *
 * Fail closed: without XENO_POST_API_URL every call answers `publish_not_configured`; a workspace with no link
 * answers `publish_not_linked`. Nothing here ever invents a channel, a post or a number.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getSigningKey } from '../utils/oidcProvider.js';
import { issuer } from '../config/hosts.js';
import { check } from '../utils/authzReBAC.js';
import { ensurePersonalWorkspace } from './personalWorkspace.js';
import { getAuthorizedLibraryFile } from './libraryAssets.js';
import { localLibraryPath } from './storageObjects.js';

export class PublishError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'PublishError'; this.code = code; this.status = status; }
}

export const ASSERTION_AUDIENCE = 'xeno-post';
export const ASSERTION_TYP = 'xeno-post-assertion+jwt';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POST_ID = /^[A-Za-z0-9_-]{1,200}$/;

/** Where xeno-post's REST lives, or null when this platform is not wired to it. Read at call time (tests set it). */
export function postApiBase() {
  const raw = String(process.env.XENO_POST_API_URL || '').trim().replace(/\/+$/, '');
  return raw || null;
}

/** The 60-second assertion for one call. */
export async function mintAssertion(db, { userId, agentId = null, workspaceId, postWorkspaceId }) {
  const key = await getSigningKey(db);
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: String(userId), xeno_workspace: String(workspaceId), post_workspace: String(postWorkspaceId), jti: crypto.randomUUID(), ...(agentId ? { act: { sub: String(agentId) } } : {}) };
  return jwt.sign({ ...claims, iat: now, exp: now + 60 }, key.privatePem, { algorithm: 'ES256', keyid: key.kid, issuer: issuer(), audience: ASSERTION_AUDIENCE, header: { typ: ASSERTION_TYP, kid: key.kid, alg: 'ES256' } });
}

// ─────────────────────────────────────────── who may do what, in which workspace

const RANK = { viewer: 1, editor: 3, admin: 4 };
/** The person behind a call: an agent acts for its owner and never above them. */
async function personOf(db, actor) {
  if (!actor || !actor.id) throw new PublishError('No caller', 'not_allowed', 401);
  if (actor.kind !== 'agent') return { userId: String(actor.id), agentId: null };
  const r = (await db.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [actor.id])).rows[0];
  if (!r || !r.owner_user_id) throw new PublishError('This agent has no owner', 'no_owner', 403);
  return { userId: String(r.owner_user_id), agentId: String(actor.id) };
}

/** Resolve the XENO workspace (default: the person's Personal one) and check the person holds `need` in it. */
export async function workspaceFor(db, actor, workspaceId, need = 'viewer') {
  const who = await personOf(db, actor);
  let ws = workspaceId ? String(workspaceId) : null;
  if (ws && !UUID.test(ws)) throw new PublishError('Invalid workspace id', 'invalid_workspace');
  if (!ws) ws = String((await ensurePersonalWorkspace(db, who.userId)).id);
  const r = await check(db, { object: `workspace:${ws}`, relation: need, subject: `user:${who.userId}` });
  if (!r.allowed) {
    const member = need === 'viewer' ? false : (await check(db, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${who.userId}` })).allowed;
    if (!member) throw new PublishError('You are not a member of that workspace', 'not_a_member', 403);
    throw new PublishError(need === 'admin' ? 'Only a workspace admin can do that' : 'Only editors and admins can do that', need === 'admin' ? 'admin_required' : 'editor_required', 403);
  }
  return { ...who, workspaceId: ws };
}

export async function getLink(db, workspaceId) {
  return (await db.query('SELECT workspace_id, post_workspace_id, linked_by_user_id, linked_at FROM publish_workspace_links WHERE workspace_id = $1', [workspaceId])).rows[0] || null;
}

// ─────────────────────────────────────────── the one HTTP path to xeno-post

/** One call to xeno-post as `ctx`. `fetchImpl` is injectable for tests. */
export async function callPost(db, ctx, method, path, { json, form, fetchImpl = globalThis.fetch } = {}) {
  const base = postApiBase();
  if (!base) throw new PublishError('Publishing is not set up on this server yet', 'publish_not_configured', 503);
  const link = ctx.link || await getLink(db, ctx.workspaceId);
  if (!link) throw new PublishError('This workspace is not linked to XENO Post yet. An admin links it in Publish.', 'publish_not_linked', 409);
  const token = await mintAssertion(db, { userId: ctx.userId, agentId: ctx.agentId, workspaceId: ctx.workspaceId, postWorkspaceId: link.post_workspace_id });
  const url = base + path.replace(':wid', encodeURIComponent(link.post_workspace_id));
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  let body;
  if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  else if (form) body = form;   // FormData sets its own boundary; never a JSON content type on an empty body (xeno-post 500s)
  let res;
  try { res = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new PublishError('XENO Post did not answer', 'post_unreachable', 502); }
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = (data && (typeof data.message === 'string' ? data.message : data.error && data.error.message)) || `XENO Post answered ${res.status}`;
    const code = res.status === 401 ? 'post_refused_assertion' : res.status === 403 ? 'post_forbidden' : res.status === 404 ? 'post_not_found' : 'post_error';
    throw new PublishError(String(msg).slice(0, 300), code, res.status === 401 || res.status === 403 ? 403 : res.status === 404 ? 404 : 502);
  }
  return data;
}

// ─────────────────────────────────────────── operations (REST, MCP and the screen all call these)

const asText = (s, max) => { const t = String(s ?? '').trim(); if (!t) throw new PublishError('Text is required', 'invalid_text'); if (t.length > max) throw new PublishError(`Text is longer than ${max} characters`, 'invalid_text'); return t; };
const asIds = (xs, what) => { if (!Array.isArray(xs) || !xs.length || xs.length > 30 || xs.some((x) => !POST_ID.test(String(x)))) throw new PublishError(`Choose at least one ${what}`, 'invalid_' + what); return xs.map(String); };
const asPostId = (id) => { if (!POST_ID.test(String(id || ''))) throw new PublishError('Invalid post id', 'invalid_post'); return String(id); };
const asFuture = (when) => { const t = when instanceof Date ? when.getTime() : Date.parse(String(when || '')); if (!Number.isFinite(t)) throw new PublishError('Pick a date and time', 'invalid_time'); if (t < Date.now() + 60_000) throw new PublishError('Pick a time at least a minute from now', 'time_in_past'); return new Date(t).toISOString(); };

export async function status(db, actor, { workspace } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  const link = await getLink(db, ctx.workspaceId);
  return { configured: !!postApiBase(), linked: !!link, workspaceId: ctx.workspaceId, postWorkspaceId: link ? link.post_workspace_id : null, linkedAt: link ? link.linked_at : null };
}

export async function linkWorkspace(db, actor, { workspace, postWorkspaceId, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'admin');
  if (ctx.agentId) throw new PublishError('A person links a workspace', 'person_required', 403);
  const pw = asPostId(postWorkspaceId);
  // prove the person really is a member of that xeno-post workspace before saving it
  await callPost(db, { ...ctx, link: { post_workspace_id: pw } }, 'GET', '/workspaces/:wid/channels', { fetchImpl });
  await db.query(`INSERT INTO publish_workspace_links (workspace_id, post_workspace_id, linked_by_user_id) VALUES ($1,$2,$3)
    ON CONFLICT (workspace_id) DO UPDATE SET post_workspace_id = EXCLUDED.post_workspace_id, linked_by_user_id = EXCLUDED.linked_by_user_id, linked_at = now()`, [ctx.workspaceId, pw, ctx.userId]);
  return status(db, actor, { workspace: ctx.workspaceId });
}

const channelOf = (c) => ({ id: String(c.id), platform: String(c.platform || ''), name: String(c.displayName || c.name || c.handle || c.platform || 'Channel'), handle: c.handle ? String(c.handle) : null, status: String(c.status || 'unknown') });
export async function listChannels(db, actor, { workspace, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  const d = await callPost(db, ctx, 'GET', '/workspaces/:wid/channels', { fetchImpl });
  return { channels: (Array.isArray(d) ? d : (d && (d.items || d.channels)) || []).map(channelOf) };
}

/** Where a person goes to connect a channel — xeno-post owns the platform OAuth; only admins are sent. */
export async function connectChannelUrl(db, actor, { workspace, platform, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'admin');
  if (ctx.agentId) throw new PublishError('A person connects a channel', 'person_required', 403);
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(String(platform || ''))) throw new PublishError('Unknown platform', 'invalid_platform');
  const d = await callPost(db, ctx, 'GET', `/workspaces/:wid/channels/connect/${platform}`, { fetchImpl });
  const url = d && (d.url || d.authorizeUrl);
  if (!url || !/^https:\/\//.test(String(url))) throw new PublishError('XENO Post did not return a sign-in address', 'post_error', 502);
  return { url: String(url) };
}

const postOf = (p) => ({
  id: String(p.id), state: String(p.state || 'draft'),
  text: ((p.content || []).find((b) => b && b.type === 'text') || {}).text || '',
  media: (p.content || []).filter((b) => b && (b.type === 'image' || b.type === 'video')).length,
  scheduledFor: p.scheduledFor || null, createdAt: p.createdAt || null,
  targets: (p.targets || []).map((t) => ({ channelId: String(t.channelId || ''), state: String(t.state || ''), permalink: t.permalink || null })),
});

export async function listPosts(db, actor, { workspace, state, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  const q = state && /^[a-z_]{3,20}$/.test(state) ? `?state=${state}&limit=100` : '?limit=100';
  const d = await callPost(db, ctx, 'GET', '/workspaces/:wid/posts' + q, { fetchImpl });
  const pending = (await db.query(`SELECT id, post_id, scheduled_for, requested_by_user_id, created_at FROM publish_confirmations WHERE workspace_id = $1 AND state = 'pending' ORDER BY created_at`, [ctx.workspaceId])).rows;
  const proposed = new Map(pending.map((r) => [r.post_id, r]));
  return { posts: (Array.isArray(d) ? d : (d && (d.items || d.posts)) || []).map(postOf).map((p) => (proposed.has(p.id) ? { ...p, proposedFor: proposed.get(p.id).scheduled_for, confirmationId: proposed.get(p.id).id } : p)) };
}

/** Put Storage files into xeno-post's media library; returns content blocks. Only files the person can read. */
async function mediaBlocks(db, ctx, assetIds = [], fetchImpl) {
  if (!assetIds.length) return [];
  if (assetIds.length > 10) throw new PublishError('At most 10 files on one post', 'too_many_media');
  const out = [];
  for (const id of assetIds) {
    const f = await getAuthorizedLibraryFile(db, { id: ctx.userId, type: 'user' }, String(id));
    if (!f || !f.ingestion_safe) throw new PublishError('A chosen file is not in your Storage, or is still being checked', 'media_not_found', 404);
    if (!/^(image|video)\//.test(String(f.mime_type))) throw new PublishError('Only images and videos can go on a post', 'media_type');
    const disk = await localLibraryPath(db, f);
    if (!disk) throw new PublishError('That file could not be read right now', 'media_unavailable', 502);
    const { readFile } = await import('node:fs/promises');
    const form = new FormData();
    form.append('file', new Blob([await readFile(disk)], { type: f.mime_type }), f.original_name || f.filename || 'file');
    const a = await callPost(db, ctx, 'POST', '/workspaces/:wid/media', { form, fetchImpl });
    if (!a || !a.id || !a.url) throw new PublishError('XENO Post did not keep the file', 'post_error', 502);
    out.push({ type: String(f.mime_type).startsWith('video/') ? 'video' : 'image', mediaId: String(a.id), url: String(a.url) });
  }
  return out;
}

/** A draft. Never publishes: it has no time. `request_key` makes a retry return the same post (xeno-post clientReference). */
export async function createDraft(db, actor, { workspace, text, channelIds, media = [], requestKey, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  const body = { content: [{ type: 'text', text: asText(text, 10_000) }, ...(await mediaBlocks(db, ctx, media, fetchImpl))], channelIds: asIds(channelIds, 'channel') };
  if (requestKey) body.clientReference = `xeno:${ctx.workspaceId}:${String(requestKey).slice(0, 120)}`;
  return { post: postOf(await callPost(db, ctx, 'POST', '/workspaces/:wid/posts', { json: body, fetchImpl })) };
}

/**
 * Schedule a post. A PERSON's schedule goes to xeno-post (its own approval policies still apply there). An AGENT's
 * is recorded as a proposal a person confirms, because a scheduled post reaches an audience by itself.
 */
export async function schedulePost(db, actor, { workspace, postId, at, proposeOnly = false, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  const id = asPostId(postId), when = asFuture(at);
  if (ctx.agentId || proposeOnly) {
    await callPost(db, ctx, 'GET', `/workspaces/:wid/posts/${id}`, { fetchImpl });   // it must exist and be theirs to see
    const r = await db.query(`INSERT INTO publish_confirmations (workspace_id, post_id, scheduled_for, requested_by_user_id) VALUES ($1,$2,$3,$4)
      ON CONFLICT (workspace_id, post_id) WHERE state = 'pending' DO UPDATE SET scheduled_for = EXCLUDED.scheduled_for RETURNING id, scheduled_for`, [ctx.workspaceId, id, when, ctx.agentId || ctx.userId]);
    return { scheduled: false, needsConfirmation: true, confirmationId: r.rows[0].id, proposedFor: r.rows[0].scheduled_for };
  }
  const p = await callPost(db, ctx, 'PATCH', `/workspaces/:wid/posts/${id}`, { json: { scheduledFor: when }, fetchImpl });
  return { scheduled: true, post: postOf(p) };
}

/** The Publish approvals queue: xeno-post's own approval requests plus agents' proposed times. */
export async function listApprovals(db, actor, { workspace, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  const d = await callPost(db, ctx, 'GET', '/workspaces/:wid/approvals?status=pending', { fetchImpl });
  const reqs = (Array.isArray(d) ? d : (d && (d.items || d.requests)) || []).map((a) => ({ kind: 'approval', id: String(a.id), postId: String(a.postId || ''), text: a.post ? postOf(a.post).text : '', requestedAt: a.createdAt || null }));
  const props = (await db.query(`SELECT id, post_id, scheduled_for, created_at FROM publish_confirmations WHERE workspace_id = $1 AND state = 'pending' ORDER BY created_at`, [ctx.workspaceId])).rows
    .map((r) => ({ kind: 'proposal', id: String(r.id), postId: r.post_id, proposedFor: r.scheduled_for, requestedAt: r.created_at }));
  return { items: [...props, ...reqs] };
}

const needPerson = (ctx, confirm, what) => {
  if (ctx.agentId) throw new PublishError(`Only a person can ${what}: it reaches an audience and cannot be taken back`, 'person_required', 403);
  if (confirm !== true) throw new PublishError(`Confirm to ${what}`, 'confirmation_required', 428);
};

/** A person decides an approval request (xeno-post's) or an agent's proposed time (ours). */
export async function decideApproval(db, actor, { workspace, kind, id, approve, confirm, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor');
  if (approve) needPerson(ctx, confirm, 'approve publishing');
  else if (ctx.agentId) throw new PublishError('Only a person decides approvals', 'person_required', 403);
  if (kind === 'proposal') {
    if (!UUID.test(String(id || ''))) throw new PublishError('Invalid proposal', 'invalid_proposal');
    const r = (await db.query(`SELECT id, post_id, scheduled_for FROM publish_confirmations WHERE id = $1 AND workspace_id = $2 AND state = 'pending'`, [id, ctx.workspaceId])).rows[0];
    if (!r) throw new PublishError('That proposal is no longer waiting', 'not_found', 404);
    if (approve) await callPost(db, ctx, 'PATCH', `/workspaces/:wid/posts/${asPostId(r.post_id)}`, { json: { scheduledFor: asFuture(r.scheduled_for) }, fetchImpl });
    await db.query(`UPDATE publish_confirmations SET state = $1, decided_by_user_id = $2, decided_at = now() WHERE id = $3`, [approve ? 'confirmed' : 'declined', ctx.userId, r.id]);
    return { decided: approve ? 'confirmed' : 'declined' };
  }
  const rid = asPostId(id);
  await callPost(db, ctx, 'POST', `/workspaces/:wid/approvals/${rid}/${approve ? 'approve' : 'reject'}`, { json: {}, fetchImpl });
  return { decided: approve ? 'approved' : 'rejected' };
}

export async function publishNow(db, actor, { workspace, postId, confirm, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor'); needPerson(ctx, confirm, 'publish');
  return { post: postOf(await callPost(db, ctx, 'POST', `/workspaces/:wid/posts/${asPostId(postId)}/publish-now`, { fetchImpl })) };
}

export async function retractPost(db, actor, { workspace, postId, confirm, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'editor'); needPerson(ctx, confirm, 'retract a post');
  return { post: postOf(await callPost(db, ctx, 'POST', `/workspaces/:wid/posts/${asPostId(postId)}/retract`, { fetchImpl })) };
}

export async function listInbox(db, actor, { workspace, fetchImpl } = {}) {
  const ctx = await workspaceFor(db, actor, workspace, 'viewer');
  const d = await callPost(db, ctx, 'GET', '/workspaces/:wid/conversations?limit=50', { fetchImpl });
  return { conversations: (Array.isArray(d) ? d : (d && (d.items || d.conversations)) || []).map((c) => ({ id: String(c.id), channelId: String(c.channelId || ''), from: String((c.contact && (c.contact.displayName || c.contact.handle)) || c.title || 'Someone'), snippet: String(c.lastMessagePreview || c.snippet || '').slice(0, 280), at: c.lastMessageAt || c.updatedAt || null, unread: !!c.unread })) };
}

/**
 * XENO Mail, reached SERVER-TO-SERVER from the workspace's Mail area (Office › Mail). The platform is a FRONT-END:
 * mail lives in xeno-mail (apps/mail-core). Nothing here stores a message, a body or a mail credential.
 *
 * Same shape as services/xenoPost.js. Each call carries a 60-second assertion the platform signs with its own OIDC key
 * (/api/oauth2/jwks); mail-core verifies it (xeno-mail apps/mail-core/src/platform-assertion.ts):
 *
 *   aud            'xeno-mail'              refused by every platform API (none accepts that audience)
 *   typ            'xeno-mail-assertion+jwt'
 *   sub            the person's XENO account id — mail-core keys its `user.id` on the same id
 *   xeno_workspace the XENO workspace the call is made from
 *   act            { sub: <agent user id> } when an agent acts for its owner
 *   mail_address   which of the person's OWN addresses this workspace uses (mail_workspace_mailboxes). mail-core binds
 *                  that connection or refuses — it never falls back (xeno-mail PR #4). Absent = their default mailbox.
 *
 * The mailbox belongs to the PERSON, not the workspace: an agent reads its owner's mail and nobody else's. Calls reach
 * mail-core's capability surface (POST /api/capabilities/<name>, body { args }) — the one code path its own agents and
 * UI use, so there is no second mail API to drift.
 *
 * Sending reaches a stranger and cannot be recalled, so it needs a PERSON and `confirm: true`. An agent's send is saved
 * as a DRAFT (its id recorded in mail_agent_drafts) for the person to review; mail-core refuses an agent's send
 * independently, so a bug here cannot become agent-sent mail.
 *
 * Mail → work: a thread becomes a XENO Task, a private support ticket, or a contact in XENO Customers.
 *
 * Fail closed: without XENO_MAIL_API_URL every call answers `mail_not_configured`.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getSigningKey } from '../utils/oidcProvider.js';
import { issuer } from '../config/hosts.js';
import { check } from '../utils/authzReBAC.js';
import { ensurePersonalWorkspace } from './personalWorkspace.js';
import { createTask } from './xenoTasks.js';
import { createTicket } from './supportTickets.js';
import * as Customers from './customers.js';

export class MailError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'MailError'; this.code = code; this.status = status; }
}

export const ASSERTION_AUDIENCE = 'xeno-mail';
export const ASSERTION_TYP = 'xeno-mail-assertion+jwt';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THREAD_ID = /^[A-Za-z0-9_.:@<>+=-]{1,300}$/;
const LABEL_ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const EMAIL = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;
export const FOLDERS = ['inbox', 'starred', 'sent', 'draft', 'archive', 'spam', 'bin'];

export function mailApiBase() {
  const raw = String(process.env.XENO_MAIL_API_URL || '').trim().replace(/\/+$/, '');
  return raw || null;
}

export async function mintAssertion(db, { userId, agentId = null, workspaceId, address = null }) {
  const key = await getSigningKey(db);
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: String(userId), xeno_workspace: String(workspaceId), jti: crypto.randomUUID(),
    ...(agentId ? { act: { sub: String(agentId) } } : {}),
    ...(address ? { mail_address: String(address) } : {}),
  };
  return jwt.sign({ ...claims, iat: now, exp: now + 60 }, key.privatePem, { algorithm: 'ES256', keyid: key.kid, issuer: issuer(), audience: ASSERTION_AUDIENCE, header: { typ: ASSERTION_TYP, kid: key.kid, alg: 'ES256' } });
}

async function personOf(db, actor) {
  if (!actor || !actor.id) throw new MailError('No caller', 'not_allowed', 401);
  if (actor.kind !== 'agent') return { userId: String(actor.id), agentId: null };
  const r = (await db.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [actor.id])).rows[0];
  if (!r || !r.owner_user_id) throw new MailError('This agent has no owner', 'no_owner', 403);
  return { userId: String(r.owner_user_id), agentId: String(actor.id) };
}

/** The person (and agent) behind the call, in a workspace they belong to (default: Personal), with its mailbox. */
export async function contextFor(db, actor, workspaceId, need = 'viewer') {
  const who = await personOf(db, actor);
  let ws = workspaceId ? String(workspaceId) : null;
  if (ws && !UUID.test(ws)) throw new MailError('Invalid workspace id', 'invalid_workspace');
  if (!ws) ws = String((await ensurePersonalWorkspace(db, who.userId)).id);
  const r = await check(db, { object: `workspace:${ws}`, relation: need, subject: `user:${who.userId}` });
  if (!r.allowed) {
    const member = need === 'viewer' ? false : (await check(db, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${who.userId}` })).allowed;
    if (!member) throw new MailError('You are not a member of that workspace', 'not_a_member', 403);
    throw new MailError('Only editors and admins can do that', 'editor_required', 403);
  }
  const m = (await db.query('SELECT address FROM mail_workspace_mailboxes WHERE workspace_id = $1 AND user_id = $2', [ws, who.userId])).rows[0];
  return { ...who, workspaceId: ws, address: m ? m.address : null, actor };
}

const ERROR_MAP = { denied: ['mail_refused', 403], not_found: ['mail_not_found', 404], bad_input: ['mail_bad_input', 400], conflict: ['mail_conflict', 409], unavailable: ['mail_unavailable', 502], timeout: ['mail_unavailable', 504], internal: ['mail_error', 502] };

/** One capability call to mail-core as `ctx`. Returns the §8 envelope's data or throws MailError. */
export async function callMail(db, ctx, name, args = {}, { fetchImpl = globalThis.fetch } = {}) {
  const base = mailApiBase();
  if (!base) throw new MailError('Mail is not set up on this server yet', 'mail_not_configured', 503);
  const token = await mintAssertion(db, ctx);
  let res;
  try { res = await fetchImpl(`${base}/api/capabilities/${encodeURIComponent(name)}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ args }), signal: AbortSignal.timeout(15_000) }); }
  catch { throw new MailError('XENO Mail did not answer', 'mail_unreachable', 502); }
  const text = await res.text();
  let env = null; try { env = text ? JSON.parse(text) : null; } catch { env = null; }
  if (env && env.ok === true) return env.data;
  const e = env && env.error ? env.error : { code: res.ok ? 'internal' : 'unavailable', message: `XENO Mail answered ${res.status}` };
  const [code, status] = ERROR_MAP[e.code] || ['mail_error', 502];
  throw new MailError(String(e.message || 'Mail failed').slice(0, 300), code, status);
}

const asThread = (id) => { if (!THREAD_ID.test(String(id || ''))) throw new MailError('Invalid thread id', 'invalid_thread'); return String(id); };
const asThreads = (xs) => { if (!Array.isArray(xs) || !xs.length || xs.length > 100) throw new MailError('Choose at least one thread', 'invalid_thread'); return xs.map(asThread); };
const asDraft = (id) => { if (!THREAD_ID.test(String(id || ''))) throw new MailError('Invalid draft id', 'invalid_draft'); return String(id); };
const asAddrs = (xs, what, required) => {
  const list = (Array.isArray(xs) ? xs : String(xs || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
  if (required && !list.length) throw new MailError(`Add at least one ${what} address`, 'invalid_recipients');
  if (list.length > 50 || list.some((a) => !EMAIL.test(a))) throw new MailError(`A ${what} address is not valid`, 'invalid_recipients');
  return list;
};
/** mail-core files threads under label IDS (mail.label.list); a name that is not an id changes nothing there. */
const asLabelIds = (xs) => {
  const list = (Array.isArray(xs) ? xs : []).map((s) => String(s).trim()).filter(Boolean);
  if (list.length > 20 || list.some((l) => !LABEL_ID.test(l))) throw new MailError('A label id is not valid', 'invalid_label');
  return list;
};
const personOnly = (ctx, what) => { if (ctx.agentId) throw new MailError(`Only a person can ${what}`, 'person_required', 403); };

// ─────────────────────────────────────────── operations (REST, MCP and the screen all call these)

export async function status(db, actor, { workspace, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  const base = { workspaceId: ctx.workspaceId, mappedAddress: ctx.address };
  if (!mailApiBase()) return { configured: false, connected: false, ...base };
  try {
    const s = await callMail(db, ctx, 'mail.app.status', {}, { fetchImpl });
    const pending = (await db.query('SELECT count(*)::int n FROM mail_agent_drafts WHERE user_id = $1 AND workspace_id = $2', [ctx.userId, ctx.workspaceId])).rows[0].n;
    return { configured: true, connected: true, ...base, mailbox: (s && s.mailbox) || null, agentDrafts: pending };
  } catch (e) {
    if (e instanceof MailError && (e.code === 'mail_not_found' || e.code === 'mail_refused')) return { configured: true, connected: false, ...base, reason: e.message };
    throw e;
  }
}

/**
 * Which of the person's own addresses this workspace uses. Verified by asking mail-core for that mailbox AS the
 * person: mail-core binds only a connection the person owns, so an address that is not theirs is refused before it
 * is stored. A person's act — an agent cannot re-point its owner's mail.
 */
export async function setMailbox(db, actor, { workspace, address, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  personOnly(ctx, 'choose which mailbox a workspace uses');
  const a = String(address || '').trim().toLowerCase();
  if (!EMAIL.test(a) || a.length > 320) throw new MailError('That is not an email address', 'invalid_address');
  try { await callMail(db, { ...ctx, address: a }, 'mail.app.status', {}, { fetchImpl }); }
  catch (e) { if (e instanceof MailError && e.code === 'mail_not_found') throw new MailError(`You have no XENO Mail mailbox at ${a}`, 'mailbox_not_yours', 404); throw e; }
  await db.query(`INSERT INTO mail_workspace_mailboxes (workspace_id, user_id, address) VALUES ($1,$2,$3)
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET address = EXCLUDED.address, updated_at = now()`, [ctx.workspaceId, ctx.userId, a]);
  return { workspaceId: ctx.workspaceId, mappedAddress: a };
}

export async function clearMailbox(db, actor, { workspace } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  personOnly(ctx, 'choose which mailbox a workspace uses');
  await db.query('DELETE FROM mail_workspace_mailboxes WHERE workspace_id = $1 AND user_id = $2', [ctx.workspaceId, ctx.userId]);
  return { workspaceId: ctx.workspaceId, mappedAddress: null };
}

export async function listThreads(db, actor, { workspace, folder = 'inbox', q, labelId, limit, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  let f = 'inbox';
  if (labelId) { const [l] = asLabelIds([labelId]); f = l; }
  else if (folder && FOLDERS.includes(String(folder))) f = String(folder);
  const query = q ? String(q).slice(0, 300) : undefined;
  const d = await callMail(db, ctx, 'mail.thread.search', { folder: f, ...(query ? { query } : {}), limit: Math.min(Math.max(Number(limit) || 30, 1), 50) }, { fetchImpl });
  return { folder: labelId ? null : f, labelId: labelId || null, query: query || null, threads: (d && d.threads) || [] };
}

export async function getThread(db, actor, { workspace, threadId, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  return { thread: await callMail(db, ctx, 'mail.thread.get', { thread_id: asThread(threadId) }, { fetchImpl }) };
}

export async function markRead(db, actor, { workspace, threadIds, unread = false, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  return { result: await callMail(db, ctx, 'mail.thread.mark_read', { thread_ids: asThreads(threadIds), unread: !!unread }, { fetchImpl }) };
}

export async function starThreads(db, actor, { workspace, threadIds, starred = true, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  return { result: await callMail(db, ctx, 'mail.thread.star', { thread_ids: asThreads(threadIds), starred: starred !== false }, { fetchImpl }) };
}

export async function labelThreads(db, actor, { workspace, threadIds, add, remove, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  const a = asLabelIds(add), r = asLabelIds(remove);
  if (!a.length && !r.length) throw new MailError('Choose a label to add or remove', 'invalid_label');
  return { result: await callMail(db, ctx, 'mail.thread.label', { thread_ids: asThreads(threadIds), add: a, remove: r }, { fetchImpl }) };
}

export async function archiveThreads(db, actor, { workspace, threadIds, undo = false, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  return { result: await callMail(db, ctx, undo ? 'mail.thread.unarchive' : 'mail.thread.archive', { thread_ids: asThreads(threadIds) }, { fetchImpl }) };
}

export async function listLabels(db, actor, { workspace, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  const d = await callMail(db, ctx, 'mail.label.list', {}, { fetchImpl });
  const raw = (d && (d.labels || d)) || [];
  return { labels: (Array.isArray(raw) ? raw : []).filter((l) => l && l.id && l.name).map((l) => ({ id: String(l.id), name: String(l.name), color: l.color || null })) };
}

export async function createLabel(db, actor, { workspace, name, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  const n = String(name || '').trim();
  if (!n || n.length > 60) throw new MailError('Name the label (up to 60 characters)', 'invalid_label');
  const d = await callMail(db, ctx, 'mail.label.create', { name: n }, { fetchImpl });
  return { label: { id: String(d.id), name: String(d.name), color: d.color || null } };
}

// ─────────────────────────────────────────── drafts and sending

async function rememberAgentDraft(db, ctx, draftId) {
  if (!ctx.agentId || !draftId) return;
  await db.query(`INSERT INTO mail_agent_drafts (user_id, draft_id, agent_id, workspace_id, address) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (user_id, draft_id) DO UPDATE SET agent_id = EXCLUDED.agent_id, workspace_id = EXCLUDED.workspace_id, created_at = now()`,
  [ctx.userId, String(draftId), ctx.agentId, ctx.workspaceId, ctx.address]);
}
const forgetDraft = (db, ctx, draftId) => db.query('DELETE FROM mail_agent_drafts WHERE user_id = $1 AND draft_id = $2', [ctx.userId, String(draftId)]);

/** Drafts in the mailbox; the ones an agent wrote for this person are marked, so the person reviews them. */
export async function listDrafts(db, actor, { workspace, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  const d = await callMail(db, ctx, 'mail.draft.list', { limit: 50 }, { fetchImpl });
  const drafts = (d && d.drafts) || [];
  const marks = new Map((await db.query(`SELECT d.draft_id, d.agent_id, coalesce(u.display_name, u.username) AS agent_name
    FROM mail_agent_drafts d LEFT JOIN users u ON u.id = d.agent_id WHERE d.user_id = $1`, [ctx.userId])).rows.map((r) => [r.draft_id, r]));
  return { drafts: drafts.map((x) => { const m = marks.get(String(x.draft_id)); return { ...x, byAgent: m ? { id: m.agent_id, name: m.agent_name } : null }; }) };
}

export async function getDraft(db, actor, { workspace, draftId, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  const draft = await callMail(db, ctx, 'mail.draft.get', { draft_id: asDraft(draftId) }, { fetchImpl });
  const m = (await db.query(`SELECT d.agent_id, coalesce(u.display_name, u.username) AS agent_name FROM mail_agent_drafts d LEFT JOIN users u ON u.id = d.agent_id
    WHERE d.user_id = $1 AND d.draft_id = $2`, [ctx.userId, String(draftId)])).rows[0];
  return { draft: { ...draft, byAgent: m ? { id: m.agent_id, name: m.agent_name } : null } };
}

/** Discarding a draft cannot be undone, so it is a person's act (mail-core refuses an agent too). */
export async function deleteDraft(db, actor, { workspace, draftId, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  personOnly(ctx, 'discard a draft');
  const id = asDraft(draftId);
  const result = await callMail(db, ctx, 'mail.draft.delete', { draft_id: id }, { fetchImpl });
  await forgetDraft(db, ctx, id);
  return { result };
}

/**
 * Compose, reply or send. A person with `confirm: true` sends; anyone else saves a draft — nothing leaves the system.
 * `draftId` updates that draft (save) or is consumed by the send. The send is irreversible, so the screen arms it first.
 */
export async function compose(db, actor, { workspace, to, cc, bcc, subject, body, threadId, draftId, send = false, confirm = false, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  const msg = { to: asAddrs(to, 'recipient', true), cc: asAddrs(cc, 'cc', false), bcc: asAddrs(bcc, 'bcc', false), subject: String(subject || '').slice(0, 500), body: String(body || '') };
  if (!msg.body.trim()) throw new MailError('Write a message first', 'invalid_body');
  if (msg.body.length > 200_000) throw new MailError('That message is too long', 'invalid_body');
  const did = draftId ? asDraft(draftId) : null;
  const save = async () => {
    const draft = await callMail(db, ctx, 'mail.draft.save', { ...(did ? { draft_id: did } : {}), to: msg.to, cc: msg.cc, bcc: msg.bcc, subject: msg.subject, body: msg.body }, { fetchImpl });
    await rememberAgentDraft(db, ctx, (draft && draft.draft_id) || did);
    return draft;
  };
  if (send) {
    if (ctx.agentId) return { sent: false, draft: await save(), proposal: true, message: 'Saved as a draft: only a person can send mail. Ask them to review it in Mail.' };
    if (confirm !== true) throw new MailError('Sending cannot be undone. Confirm to send.', 'confirm_required', 428);
    const result = await callMail(db, ctx, 'mail.message.send', { ...msg, ...(threadId ? { thread_id: asThread(threadId) } : {}), ...(did ? { draft_id: did } : {}) }, { fetchImpl });
    if (did) await forgetDraft(db, ctx, did);
    return { sent: true, result };
  }
  return { sent: false, draft: await save() };
}

// ─────────────────────────────────────────── mail → work

/** The thread's first message, read through mail-core — mail → work never trusts text the client sent. */
async function firstMessage(db, ctx, threadId, fetchImpl) {
  const t = await callMail(db, ctx, 'mail.thread.get', { thread_id: asThread(threadId) }, { fetchImpl });
  const m = (t && t.messages && t.messages[0]) || null;
  if (!m) throw new MailError('That thread has no messages', 'mail_not_found', 404);
  return { thread: t, m: { ...m, from: m.from || { name: '', email: '' } } };
}

export async function toTask(db, actor, { workspace, threadId, projectId, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace, 'editor');
  const { m } = await firstMessage(db, ctx, threadId, fetchImpl);
  const body = `From ${m.from.name ? m.from.name + ' <' + m.from.email + '>' : m.from.email}\n\n${String(m.text || '').slice(0, 8000)}`;
  const task = await createTask(db, actor, { title: (m.subject || '(no subject)').slice(0, 200), body, projectId: projectId || null, source: 'mail', sourceRef: `mail:${threadId}`, labels: ['mail'] });
  return { task };
}

export async function toTicket(db, actor, { workspace, threadId, kind = 'other', fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace);
  const { m } = await firstMessage(db, ctx, threadId, fetchImpl);
  const ticket = await createTicket(db, actor, { kind, title: (m.subject || '(no subject)').slice(0, 200), body: `Forwarded from mail — ${m.from.email}\n\n${String(m.text || '').slice(0, 8000)}`, workspaceId: ctx.workspaceId });
  return { ticket };
}

/**
 * The sender becomes a contact in XENO Customers (services/customers.js) — the workspace's ONE contact store — and the
 * thread is logged on its timeline as an `email` activity (a draft when an agent does it). An existing address reuses
 * that contact.
 */
export async function toContact(db, actor, { workspace, threadId, fetchImpl } = {}) {
  const ctx = await contextFor(db, actor, workspace, 'editor');
  const { m } = await firstMessage(db, ctx, threadId, fetchImpl);
  const email = String(m.from.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) throw new MailError('That sender has no usable address', 'invalid_recipients');
  let contact, created = true;
  try { contact = await Customers.createContact(db, actor, { workspace: ctx.workspaceId, name: String(m.from.name || email).slice(0, 200), email }); }
  catch (e) {
    if (!(e instanceof Customers.CustomersError) || e.code !== 'duplicate_contact') throw e;
    created = false;
    contact = (await Customers.listContacts(db, actor, { workspace: ctx.workspaceId, q: email })).find((c) => String(c.id) === String(e.existingId) || String(c.email || '').toLowerCase() === email);
    if (!contact) throw e;
  }
  const activity = await Customers.addActivity(db, actor, contact.id, { workspace: ctx.workspaceId, kind: 'email', body: `Mail: ${m.subject || '(no subject)'}\n\n${String(m.text || '').slice(0, 4000)}` });
  return { contact, created, activity };
}

/**
 * XENO support — the Help ▸ Contact support lane (XENO REPORT - SPEC; XENO FORUM - SPEC §12).
 *
 * A support ticket is PRIVATE by default and belongs to the person who asked (the requester). It is never a private
 * Forum thread: the Forum is public by design. The requester alone may make it public, which posts it to the Forum's
 * Help space and links the two.
 *
 * READERS, and only these:
 *   - the requester (an agent asking for its owner reads its owner's tickets);
 *   - XENO staff: a HUMAN whose effective role is moderator or admin;
 *   - the support agent the ticket is delegated to.
 * Anyone else is told the ticket does not exist (404), never that it is private.
 *
 * What the requester sees is filtered on the SERVER: internal notes, internal files and unsent agent drafts are
 * never in their reply, whatever the screen asks for.
 *
 * AGENTS PROPOSE, HUMANS RATIFY. A support agent's reply is stored as a draft (state 'draft', agent_drafted). It
 * reaches the customer only when a human staff member ratifies it, and the ratification is recorded on the message.
 * The table holds the same rule as a CHECK, so no code path can send an agent's words unratified.
 *
 * WRITE-BACK: every public reply, status change, merge and fix is recorded on the ticket and lands in the
 * requester's notifications (and, when SUPPORT_EMAILS is exactly "true", their mail). Engineering work is a XENO
 * Tasks task (xenoTasks.createTask) — there is no second tracker — and when that task is done the requester is told.
 */
import { createThread } from './forumWrite.js';
import * as xenoTasks from './xenoTasks.js';
import { sendEmail } from './emailService.js';
import { siteOrigin } from '../config/hosts.js';

export class SupportError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'SupportError'; this.code = code; this.statusCode = status; }
}

export const KINDS = ['bug', 'feature', 'billing', 'account', 'other'];
export const STATUSES = ['new', 'triaged', 'waiting_on_customer', 'resolved', 'closed'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUS_WORDS = { new: 'New', triaged: 'Being looked at', waiting_on_customer: 'Waiting on you', resolved: 'Resolved', closed: 'Closed' };
/** Service-level targets, hours: [first response, resolution]. */
export const SLA_HOURS = { urgent: [1, 8], high: [4, 24], normal: [24, 72], low: [72, 168] };
/** Allowed moves for staff. The requester may only close, or reopen something resolved. */
const MOVES = {
  new: ['triaged', 'waiting_on_customer', 'resolved', 'closed'],
  triaged: ['waiting_on_customer', 'resolved', 'closed'],
  waiting_on_customer: ['triaged', 'resolved', 'closed'],
  resolved: ['triaged', 'closed'],
  closed: ['triaged'],
};
/** Rate limits per requester, per hour. A burst is refused, never queued. */
export const LIMITS = { tickets: 10, messages: 60 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kindOf = (u) => (u.kind === 'agent' ? 'agent' : u.kind === 'service' ? 'service' : 'human');
/** Staff is a HUMAN with an effective role of moderator or admin. An agent is never staff, whatever its role says. */
export const isStaff = (u) => !!u && kindOf(u) === 'human' && ['admin', 'moderator'].includes(u.role);
const keyOf = (t) => `T-${t.number}`;
const urlOf = (t) => `${siteOrigin()}/workspace/support/${keyOf(t)}`;
const text = (v, field, max, required = true) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new SupportError(`${field} is required`, `${field}_required`);
  if (s.length > max) throw new SupportError(`${field} is longer than ${max} characters`, `${field}_too_long`);
  return s;
};
const oneOf = (v, list, field, dflt) => {
  if (v == null || v === '') return dflt;
  if (!list.includes(v)) throw new SupportError(`Unknown ${field}`, `invalid_${field}`);
  return v;
};

/** The person an actor asks FOR: a person themselves, an agent its owner. */
async function requesterFor(db, user) {
  if (!user || !user.id) throw new SupportError('Sign in first', 'not_signed_in', 401);
  if (kindOf(user) === 'service') throw new SupportError('A service account cannot ask for support', 'service_cannot_ask', 403);
  if (kindOf(user) !== 'agent') return String(user.id);
  const r = (await db.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [user.id])).rows[0];
  if (!r || !r.owner_user_id) throw new SupportError('This agent has no owner to ask for', 'no_owner', 403);
  return String(r.owner_user_id);
}

/** Who this caller is to this ticket: 'requester', 'staff', 'agent' (its delegate), or null. */
export async function standing(db, user, t) {
  if (!user || !t) return null;
  if (isStaff(user)) return 'staff';
  if (kindOf(user) === 'agent' && t.delegate_agent_id && String(t.delegate_agent_id) === String(user.id)) return 'agent';
  if (kindOf(user) === 'service') return null;
  const asker = await requesterFor(db, user).catch(() => null);
  if (asker && String(t.requester_id) === asker) return 'requester';
  return null;
}

const SELECT = `SELECT t.*, ft.short_id AS thread_short_id, ft.slug AS thread_slug, tk.number AS task_number, tk.status AS task_status,
    m.number AS merged_into_number, COALESCE(ru.display_name, ru.username) AS requester_name, ru.email AS requester_email,
    COALESCE(au.display_name, au.username) AS assignee_name, COALESCE(du.display_name, du.username) AS delegate_name
  FROM support_tickets t
  LEFT JOIN forum_threads ft ON ft.id = t.thread_id LEFT JOIN tasks tk ON tk.id = t.task_id LEFT JOIN support_tickets m ON m.id = t.merged_into_id
  LEFT JOIN users ru ON ru.id = t.requester_id LEFT JOIN users au ON au.id = t.assignee_id LEFT JOIN users du ON du.id = t.delegate_agent_id`;

export function parseKey(key) {
  const m = /^T-(\d{1,12})$/i.exec(String(key || '').trim());
  return m ? Number(m[1]) : null;
}
async function load(db, key) {
  const n = parseKey(key);
  if (!n) return null;
  return (await db.query(`${SELECT} WHERE t.number = $1`, [n])).rows[0] || null;
}
async function readable(db, user, key) {
  const t = await load(db, key), who = await standing(db, user, t);
  if (!who) throw new SupportError('Ticket not found', 'ticket_not_found', 404);
  return { t, who };
}

function shape(t, who, extra = {}) {
  const inner = who !== 'requester';
  const breach = (due, done) => (!done && due && new Date(due).getTime() < Date.now());
  return {
    key: keyOf(t), number: Number(t.number), kind: t.kind, title: t.title, body: t.body, status: t.status, statusLabel: STATUS_WORDS[t.status],
    priority: t.priority, createdAt: t.created_at, updatedAt: t.updated_at, resolvedAt: t.resolved_at, closedAt: t.closed_at,
    url: `/workspace/support/${keyOf(t)}`,
    thread: t.thread_short_id ? { shortId: t.thread_short_id, url: `/forum/t/${t.thread_short_id}/${t.thread_slug}` } : null,
    mergedInto: t.merged_into_number ? `T-${t.merged_into_number}` : null,
    sla: {
      firstResponseDueAt: t.first_response_due_at, firstRespondedAt: t.first_responded_at, resolutionDueAt: t.resolution_due_at,
      firstResponseBreached: breach(t.first_response_due_at, t.first_responded_at), resolutionBreached: breach(t.resolution_due_at, t.resolved_at || t.closed_at),
    },
    // the requester is told THAT engineering is on it and when it is done; staff see the task itself
    engineering: t.task_number ? (inner ? { task: `T-${t.task_number}`, status: t.task_status } : { status: t.task_status === 'done' ? 'fixed' : 'in progress' }) : null,
    ...(inner ? {
      requester: { id: t.requester_id, name: t.requester_name },
      assignee: t.assignee_id ? { id: t.assignee_id, name: t.assignee_name } : null,
      delegate: t.delegate_agent_id ? { id: t.delegate_agent_id, name: t.delegate_name, kind: 'agent' } : null,
      workspaceId: t.workspace_id,
    } : {}),
    you: who,
    ...extra,
  };
}

async function notify(db, t, actor, kind, detail) {
  if (!t.requester_id || String(t.requester_id) === String(actor && actor.id)) return;
  await db.query(`INSERT INTO user_notifications (user_id, source, kind, ref, title, detail, actor_id, actor_kind) VALUES ($1, 'support', $2, $3, $4, $5, $6, $7)`,
    [t.requester_id, kind, `support/${keyOf(t)}`, `${keyOf(t)} · ${t.title}`.slice(0, 400), String(detail || '').slice(0, 1000), actor && actor.id ? actor.id : null, actor && actor.id ? kindOf(actor) : null]);
  await mail(db, t, kind, detail);
}

/** OFF unless SUPPORT_EMAILS is exactly "true": mailing customers is a switch somebody throws. */
export function emailsEnabled(env = process.env) { return String(env.SUPPORT_EMAILS ?? '').trim().toLowerCase() === 'true'; }
async function mail(db, t, kind, detail) {
  if (!emailsEnabled()) return;
  try {
    const u = (await db.query('SELECT email, COALESCE(display_name, username) AS name FROM users WHERE id = $1', [t.requester_id])).rows[0];
    if (!u || !u.email) return;
    await sendEmail(db, 'support_update', u.email, { displayName: u.name, ticketKey: keyOf(t), ticketTitle: t.title, ticketUrl: urlOf(t), update: kind === 'support_status' ? 'Your request changed status' : 'XENO support replied', excerpt: String(detail || '').slice(0, 600) }, t.requester_id);
  } catch (e) { console.error('[Support] mail failed:', e && e.message); }
}

async function within(db, sql, params, limit, what) {
  const n = Number((await db.query(sql, params)).rows[0].n);
  if (n >= limit) throw new SupportError(`Too many ${what} in the last hour. Try again later.`, 'rate_limited', 429);
}

async function attach(db, user, t, messageId, fileIds, internal) {
  const ids = [...new Set([].concat(fileIds || []).map(String))].slice(0, 10);
  for (const id of ids) {
    if (!UUID.test(id)) throw new SupportError('An attachment is not a file id', 'invalid_attachment');
    // a file is attached only by someone who owns it in Storage; it is referenced, never copied
    const f = (await db.query('SELECT id FROM user_files WHERE id = $1 AND (owner_user_id = $2 OR user_id = $2) AND deleted_at IS NULL', [id, user.id])).rows[0];
    if (!f) throw new SupportError('That file is not in your Storage', 'attachment_not_found', 404);
    await db.query('INSERT INTO support_attachments (ticket_id, message_id, file_id, added_by, internal) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (ticket_id, file_id) DO NOTHING', [t.id, messageId, id, user.id, !!internal]);
  }
}

// ───────────────────────────── the requester's side

export async function createTicket(db, user, { kind, title, body, workspaceId, attachments } = {}) {
  const requester = await requesterFor(db, user);
  await within(db, `SELECT count(*)::int AS n FROM support_tickets WHERE requester_id = $1 AND created_at > now() - interval '1 hour'`, [requester], LIMITS.tickets, 'support requests');
  const k = oneOf(kind, KINDS, 'kind', 'other');
  const [fr, rs] = SLA_HOURS.normal;
  const t = (await db.query(
    `INSERT INTO support_tickets (requester_id, workspace_id, kind, title, body, first_response_due_at, resolution_due_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6), now() + make_interval(hours => $7)) RETURNING *`,
    [requester, workspaceId && UUID.test(String(workspaceId)) ? workspaceId : null, k, text(title, 'title', 200), text(body, 'body', 20000, false), fr, rs])).rows[0];
  if (attachments && [].concat(attachments).length) await attach(db, { id: requester }, t, null, attachments, false);
  await (await import('./xenoWorkflow.js')).onSupportTicket(db, t, { actorId: user.id });   // Dev › Automate (never throws)
  if (kindOf(user) === 'agent') await db.query(`INSERT INTO support_messages (ticket_id, author_id, author_kind, kind, visibility, body) VALUES ($1,$2,'agent','system','internal',$3)`, [t.id, user.id, 'Raised by an agent on its owner’s behalf']);
  return getTicket(db, user, keyOf(t));
}

/** A person's own tickets; for staff and agents, the queue (listQueue). */
export async function listMine(db, user) {
  const requester = await requesterFor(db, user);
  return (await db.query(`${SELECT} WHERE t.requester_id = $1 ORDER BY t.updated_at DESC LIMIT 200`, [requester])).rows.map((t) => shape(t, 'requester'));
}

export async function getTicket(db, user, key) {
  const { t, who } = await readable(db, user, key);
  const inner = who !== 'requester';
  const msgs = (await db.query(
    `SELECT s.*, COALESCE(u.display_name, u.username) AS author_name, COALESCE(r.display_name, r.username) AS ratified_name
       FROM support_messages s LEFT JOIN users u ON u.id = s.author_id LEFT JOIN users r ON r.id = s.ratified_by
      WHERE s.ticket_id = $1 ${inner ? "AND s.state <> 'discarded'" : "AND s.visibility = 'public' AND s.state = 'sent'"}
      ORDER BY s.created_at, s.id`, [t.id])).rows;
  const files = (await db.query(
    `SELECT a.id, a.file_id, a.message_id, a.internal, a.created_at, f.original_name, f.mime_type, f.file_size
       FROM support_attachments a JOIN user_files f ON f.id = a.file_id WHERE a.ticket_id = $1 ${inner ? '' : 'AND NOT a.internal'} ORDER BY a.created_at`, [t.id])).rows;
  return shape(t, who, {
    messages: msgs.map((m) => ({
      id: m.id, kind: m.kind, body: m.body, createdAt: m.created_at,
      author: { kind: m.author_kind, name: m.author_kind === 'agent' && !inner ? 'XENO support' : m.author_name || null, requester: String(m.author_id || '') === String(t.requester_id) },
      ...(inner ? { visibility: m.visibility, state: m.state, agentDrafted: m.agent_drafted, ratifiedBy: m.ratified_by ? { id: m.ratified_by, name: m.ratified_name } : null } : {}),
    })),
    attachments: files.map((f) => ({ id: f.id, fileId: f.file_id, messageId: f.message_id, name: f.original_name, type: f.mime_type, size: Number(f.file_size || 0), ...(inner ? { internal: f.internal } : {}) })),
  });
}

/**
 * Add to the conversation.
 *   requester            → a public message; a waiting or resolved ticket goes back to XENO (triaged)
 *   staff                → a public reply (the customer is told), or `internal: true` for a note they never see
 *   agent (the delegate) → a DRAFT, or an internal note. Never a sent reply.
 */
export async function reply(db, user, key, { body, internal = false, attachments } = {}) {
  const { t, who } = await readable(db, user, key);
  if (t.status === 'closed' && who === 'requester') throw new SupportError('This request is closed. Open a new one.', 'ticket_closed', 409);
  if (t.merged_into_id) throw new SupportError(`This request was merged into T-${t.merged_into_number}`, 'ticket_merged', 409);
  const words = text(body, 'body', 20000);
  if (who === 'requester') {
    await within(db, `SELECT count(*)::int AS n FROM support_messages WHERE author_id = $1 AND created_at > now() - interval '1 hour'`, [user.id], LIMITS.messages, 'messages');
    if (internal) throw new SupportError('Notes are for XENO staff', 'not_allowed', 403);
  }
  const agent = who === 'agent', note = !!internal && who !== 'requester';
  const m = (await db.query(
    `INSERT INTO support_messages (ticket_id, author_id, author_kind, kind, visibility, state, agent_drafted, body) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [t.id, user.id, kindOf(user), note ? 'note' : 'reply', note ? 'internal' : 'public', agent && !note ? 'draft' : 'sent', agent && !note, words])).rows[0];
  if (attachments) await attach(db, user, t, m.id, attachments, note || (agent && !note));
  if (who === 'requester') {
    await db.query(`UPDATE support_tickets SET updated_at = now(), status = CASE WHEN status IN ('waiting_on_customer', 'resolved') THEN 'triaged' ELSE status END, resolved_at = CASE WHEN status = 'resolved' THEN NULL ELSE resolved_at END WHERE id = $1`, [t.id]);
  } else if (who === 'staff' && !note) {
    await sentByStaff(db, t, user, words);
  } else await db.query('UPDATE support_tickets SET updated_at = now() WHERE id = $1', [t.id]);
  return { id: m.id, state: m.state, visibility: m.visibility };
}

async function sentByStaff(db, t, user, words) {
  await db.query(`UPDATE support_tickets SET updated_at = now(), first_responded_at = COALESCE(first_responded_at, now()), status = CASE WHEN status = 'new' THEN 'triaged' ELSE status END WHERE id = $1`, [t.id]);
  await notify(db, t, user, 'support_reply', words);
}

/** A human member of staff sends an agent's draft — as written, or as they edited it. The ratification is recorded. */
export async function ratifyDraft(db, user, key, messageId, { body } = {}) {
  const { t, who } = await readable(db, user, key);
  if (who !== 'staff') throw new SupportError('Only XENO staff can send a drafted reply', 'human_ratification_required', 403);
  const d = (await db.query(`SELECT * FROM support_messages WHERE id = $1 AND ticket_id = $2`, [String(messageId || ''), t.id])).rows[0];
  if (!d || d.state !== 'draft') throw new SupportError('That draft is not waiting to be sent', 'draft_not_found', 404);
  const words = body == null || body === '' ? d.body : text(body, 'body', 20000);
  await db.query(`UPDATE support_messages SET state = 'sent', body = $2, ratified_by = $3, ratified_at = now(), created_at = now() WHERE id = $1`, [d.id, words, user.id]);
  await db.query('UPDATE support_attachments SET internal = FALSE WHERE message_id = $1', [d.id]);
  await sentByStaff(db, t, user, words);
  return getTicket(db, user, key);
}

export async function discardDraft(db, user, key, messageId) {
  const { t, who } = await readable(db, user, key);
  if (who !== 'staff' && who !== 'agent') throw new SupportError('Ticket not found', 'ticket_not_found', 404);
  const r = await db.query(`UPDATE support_messages SET state = 'discarded' WHERE id = $1 AND ticket_id = $2 AND state = 'draft' ${who === 'agent' ? 'AND author_id = $3' : ''} RETURNING id`, who === 'agent' ? [String(messageId || ''), t.id, user.id] : [String(messageId || ''), t.id]);
  if (!r.rows.length) throw new SupportError('That draft is not waiting to be sent', 'draft_not_found', 404);
  return { discarded: true };
}

/** Move a ticket on. Staff: any allowed move. The requester: close it, or reopen it while it is resolved. */
export async function setStatus(db, user, key, { status, note } = {}) {
  const { t, who } = await readable(db, user, key);
  if (!STATUSES.includes(status)) throw new SupportError('Unknown status', 'invalid_status');
  if (status === t.status) return getTicket(db, user, key);
  if (who === 'agent') throw new SupportError('An agent can triage a request; a person moves it on', 'not_allowed', 403);
  if (who === 'requester' && !(status === 'closed' || (status === 'triaged' && t.status === 'resolved'))) throw new SupportError('XENO moves your request on. You can close it, or reopen it once it is resolved.', 'not_allowed', 403);
  if (!(MOVES[t.status] || []).includes(status)) throw new SupportError(`A ${t.status} request cannot move to ${status}`, 'invalid_move', 409);
  await db.query(`UPDATE support_tickets SET status = $2, updated_at = now(),
      resolved_at = CASE WHEN $2 = 'resolved' THEN now() WHEN $2 = 'triaged' THEN NULL ELSE resolved_at END,
      closed_at = CASE WHEN $2 = 'closed' THEN now() WHEN $2 = 'triaged' THEN NULL ELSE closed_at END WHERE id = $1`, [t.id, status]);
  const line = `${STATUS_WORDS[status]}${note ? ` — ${text(note, 'note', 2000, false)}` : ''}`;
  await db.query(`INSERT INTO support_messages (ticket_id, author_id, author_kind, kind, body) VALUES ($1,$2,$3,'status',$4)`, [t.id, user.id, kindOf(user), line]);
  if (who === 'staff') await notify(db, t, user, 'support_status', line);
  return getTicket(db, user, key);
}

/** Triage: kind and priority (the SLA follows priority, from when the ticket was raised). Staff or the delegate agent. */
export async function triage(db, user, key, { kind, priority } = {}) {
  const { t, who } = await readable(db, user, key);
  if (who === 'requester') throw new SupportError('XENO triages requests', 'not_allowed', 403);
  const k = oneOf(kind, KINDS, 'kind', t.kind), p = oneOf(priority, PRIORITIES, 'priority', t.priority);
  const [fr, rs] = SLA_HOURS[p];
  await db.query(`UPDATE support_tickets SET kind = $2, priority = $3, updated_at = now(), status = CASE WHEN status = 'new' THEN 'triaged' ELSE status END,
      first_response_due_at = created_at + make_interval(hours => $4), resolution_due_at = created_at + make_interval(hours => $5) WHERE id = $1`, [t.id, k, p, fr, rs]);
  if (k !== t.kind || p !== t.priority) await db.query(`INSERT INTO support_messages (ticket_id, author_id, author_kind, kind, visibility, body) VALUES ($1,$2,$3,'system','internal',$4)`, [t.id, user.id, kindOf(user), `Triaged: ${k}, ${p} priority`]);
  return getTicket(db, user, key);
}

/** Staff assign a human staff member, and/or delegate to a support agent (which may only draft). */
export async function assign(db, user, key, { assigneeId, delegateAgentId } = {}) {
  const { t, who } = await readable(db, user, key);
  if (who !== 'staff') throw new SupportError('Only XENO staff assign requests', 'not_allowed', 403);
  const patch = {};
  if (assigneeId !== undefined) {
    if (assigneeId) {
      const u = (await db.query(`SELECT u.id, u.role, (ai.user_id IS NOT NULL) AS is_agent FROM users u LEFT JOIN agent_identities ai ON ai.user_id = u.id WHERE u.id = $1`, [String(assigneeId)])).rows[0];
      if (!u || u.is_agent || !['admin', 'moderator'].includes(u.role)) throw new SupportError('A request is assigned to a person on XENO staff', 'assignee_not_staff', 409);
    }
    patch.assignee_id = assigneeId || null;
  }
  if (delegateAgentId !== undefined) {
    if (delegateAgentId && !(await db.query('SELECT 1 FROM agent_identities WHERE user_id = $1', [String(delegateAgentId)])).rows.length) throw new SupportError('A request is delegated to an agent', 'delegate_not_agent', 409);
    patch.delegate_agent_id = delegateAgentId || null;
  }
  const cols = Object.keys(patch);
  if (cols.length) await db.query(`UPDATE support_tickets SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [t.id, ...cols.map((c) => patch[c])]);
  return getTicket(db, user, key);
}

/** Merge a duplicate into another request: it closes, both record it, and the requester is pointed at the survivor. */
export async function merge(db, user, key, { into } = {}) {
  const { t, who } = await readable(db, user, key);
  if (who !== 'staff') throw new SupportError('Only XENO staff merge requests', 'not_allowed', 403);
  const target = await load(db, into);
  if (!target) throw new SupportError('The request to merge into was not found', 'ticket_not_found', 404);
  if (String(target.id) === String(t.id)) throw new SupportError('A request cannot be merged into itself', 'merge_self', 409);
  if (target.merged_into_id) throw new SupportError(`T-${target.number} was itself merged; merge into T-${target.merged_into_number}`, 'merge_chain', 409);
  await db.query(`UPDATE support_tickets SET merged_into_id = $2, status = 'closed', closed_at = now(), updated_at = now() WHERE id = $1`, [t.id, target.id]);
  await db.query(`INSERT INTO support_messages (ticket_id, author_id, author_kind, kind, body) VALUES ($1,$2,'human','status',$3)`, [t.id, user.id, `Merged into ${keyOf(target)}`]);
  await db.query(`INSERT INTO support_messages (ticket_id, author_id, author_kind, kind, visibility, body) VALUES ($1,$2,'human','system','internal',$3)`, [target.id, user.id, `${keyOf(t)} was merged into this request`]);
  await notify(db, t, user, 'support_status', `Merged into ${keyOf(target)}`);
  return getTicket(db, user, key);
}

/** Engineering work goes to XENO Tasks: raise a task from the request, or link an existing one by key. */
export async function linkTask(db, user, key, { taskKey, projectId } = {}) {
  const { t, who } = await readable(db, user, key);
  if (who !== 'staff') throw new SupportError('Only XENO staff link engineering work', 'not_allowed', 403);
  let task;
  if (taskKey) task = await xenoTasks.getTask(db, user, taskKey);
  else task = await xenoTasks.createTask(db, user, { title: `${keyOf(t)} · ${t.title}`.slice(0, 300), body: `From support request ${keyOf(t)} (${t.kind}).\n\n${t.body || ''}`.slice(0, 50000), kind: t.kind === 'feature' ? 'feature' : t.kind === 'bug' ? 'bug' : 'task', projectId: projectId || null, sourceRef: `support:${keyOf(t)}` });
  await db.query('UPDATE support_tickets SET task_id = $2, updated_at = now() WHERE id = $1', [t.id, task.id]);
  await db.query(`INSERT INTO support_messages (ticket_id, author_id, author_kind, kind, visibility, body) VALUES ($1,$2,'human','system','internal',$3)`, [t.id, user.id, `Linked to task ${task.key}`]);
  await notify(db, t, user, 'support_status', 'Our engineers are working on this');
  return getTicket(db, user, key);
}

/**
 * The fix written back: called when a XENO Tasks task is done. Every open request linked to it records the fix,
 * moves to resolved and tells its requester. Idempotent: a request already resolved or closed is left alone.
 */
export async function taskDone(db, taskId, actor = null) {
  const rows = (await db.query(`SELECT * FROM support_tickets WHERE task_id = $1 AND status NOT IN ('resolved', 'closed')`, [taskId])).rows;
  for (const t of rows) {
    await db.query(`UPDATE support_tickets SET status = 'resolved', resolved_at = now(), updated_at = now() WHERE id = $1`, [t.id]);
    await db.query(`INSERT INTO support_messages (ticket_id, author_id, author_kind, kind, body) VALUES ($1,$2,$3,'status',$4)`, [t.id, actor && actor.id ? actor.id : null, actor && actor.id ? kindOf(actor) : 'service', 'Resolved — the fix is done. Reply if anything is still wrong.']);
    await notify(db, t, actor || {}, 'support_status', 'Resolved — the fix is done');
  }
  return rows.length;
}

/** The requester, and only the requester, makes a request public: a Forum Help thread, linked both ways. */
export async function publish(db, user, key) {
  const { t, who } = await readable(db, user, key);
  if (who !== 'requester' || kindOf(user) !== 'human') throw new SupportError('Only the person who asked can make it public', 'not_allowed', 403);
  if (t.thread_id) throw new SupportError('This request is already public', 'already_public', 409);
  const thread = await createThread(db, user, { space: 'help', title: t.title, body: t.body || t.title, tags: [`kind:${t.kind}`] });
  await db.query('UPDATE support_tickets SET thread_id = (SELECT id FROM forum_threads WHERE short_id = $2), updated_at = now() WHERE id = $1', [t.id, thread.shortId]);
  return getTicket(db, user, key);
}

// ───────────────────────────── XENO's side

/** The queue: staff see every request; a support agent sees the ones delegated to it. */
export async function listQueue(db, user, { status, kind, priority, assignee, q, breached } = {}) {
  const params = [], where = [];
  if (isStaff(user)) { /* every request */ } else if (kindOf(user) === 'agent') { params.push(user.id); where.push(`t.delegate_agent_id = $${params.length}`); }
  else throw new SupportError('Only XENO staff and support agents see the queue', 'not_allowed', 403);
  if (status === 'open') where.push(`t.status NOT IN ('resolved', 'closed')`);
  else if (status) { oneOf(status, STATUSES, 'status'); params.push(status); where.push(`t.status = $${params.length}`); }
  if (kind) { oneOf(kind, KINDS, 'kind'); params.push(kind); where.push(`t.kind = $${params.length}`); }
  if (priority) { oneOf(priority, PRIORITIES, 'priority'); params.push(priority); where.push(`t.priority = $${params.length}`); }
  if (assignee === 'me') { params.push(user.id); where.push(`t.assignee_id = $${params.length}`); } else if (assignee === 'none') where.push('t.assignee_id IS NULL');
  if (breached) where.push(`((t.first_responded_at IS NULL AND t.first_response_due_at < now()) OR (t.resolved_at IS NULL AND t.closed_at IS NULL AND t.resolution_due_at < now()))`);
  if (q) { params.push(`%${String(q).slice(0, 100).replace(/[%_\\]/g, (c) => '\\' + c)}%`); where.push(`(t.title ILIKE $${params.length} OR t.body ILIKE $${params.length})`); }
  const rows = (await db.query(`${SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT 300`, params)).rows;
  return rows.map((t) => shape(t, isStaff(user) ? 'staff' : 'agent'));
}

export async function listMacros(db, user) {
  if (!isStaff(user) && kindOf(user) !== 'agent') throw new SupportError('Saved replies are for XENO staff', 'not_allowed', 403);
  return (await db.query('SELECT id, title, body, updated_at FROM support_macros ORDER BY title LIMIT 500')).rows.map((m) => ({ id: m.id, title: m.title, body: m.body, updatedAt: m.updated_at }));
}
export async function saveMacro(db, user, { id, title, body } = {}) {
  if (!isStaff(user)) throw new SupportError('Saved replies are for XENO staff', 'not_allowed', 403);
  const tt = text(title, 'title', 120), bb = text(body, 'body', 20000);
  if (id) {
    const r = await db.query('UPDATE support_macros SET title = $2, body = $3, updated_at = now() WHERE id = $1 RETURNING id', [String(id), tt, bb]);
    if (!r.rows.length) throw new SupportError('Saved reply not found', 'macro_not_found', 404);
    return { id: r.rows[0].id, title: tt, body: bb };
  }
  return { id: (await db.query('INSERT INTO support_macros (title, body, created_by) VALUES ($1,$2,$3) RETURNING id', [tt, bb, user.id])).rows[0].id, title: tt, body: bb };
}
export async function deleteMacro(db, user, id) {
  if (!isStaff(user)) throw new SupportError('Saved replies are for XENO staff', 'not_allowed', 403);
  await db.query('DELETE FROM support_macros WHERE id = $1', [String(id)]);
  return { deleted: true };
}

// the fix written back: Tasks calls this when a linked task is done (a hook, so Tasks never imports support mail)
xenoTasks.onTaskDone(taskDone);

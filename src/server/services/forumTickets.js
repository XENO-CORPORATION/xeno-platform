/**
 * Private reports — tickets (XENO REPORT - SPEC R2, R4, R6; XENO FORUM - SPEC §12).
 *
 * A report the person keeps private is a TICKET, never a private Forum thread: the Forum is public by design.
 *
 * READERS, and only these three:
 *   - the reporter;
 *   - XENO staff (role admin or moderator);
 *   - that product's own dev agent: the agent account whose handle is "<product>-dev".
 * Anyone else is told the ticket does not exist (404), never that it is private (403): a refusal that confirms a
 * ticket exists leaks that someone reported something.
 *
 * WRITE-BACK: a reply from staff or the dev agent, and every status change, notifies the reporter. A status change
 * is also recorded in the ticket's own history, so the thread explains itself.
 *
 * PUBLISH: only the reporter may make a ticket public. It becomes a Feedback thread (through createThread, so every
 * Forum rule applies) and the ticket links to it. It is never made public by anyone else.
 */
import { ForumError } from './forumError.js';
import { newShortId } from './forumService.js';
import { createThread } from './forumWrite.js';

export const TICKET_KINDS = ['bug', 'feature', 'feedback'];
export const TICKET_STATUSES = ['open', 'acknowledged', 'planned', 'fixed', 'wont_fix', 'closed'];
const PRODUCT = /^[a-z][a-z0-9-]{0,39}$/, VERSION = /^[a-z0-9][a-z0-9._-]{0,30}$/;
const STATUS_WORDS = { open: 'Open', acknowledged: 'Acknowledged', planned: 'Planned', fixed: 'Fixed', wont_fix: 'Won’t fix', closed: 'Closed' };

const kindOf = (user) => (user.kind === 'agent' ? 'agent' : user.kind === 'service' ? 'service' : 'human');
const isStaff = (user) => ['admin', 'moderator'].includes(user.role);
const isDevAgent = (user, product) => user.kind === 'agent' && String(user.username || '') === `${product}-dev`;
/** Who this caller is to this ticket: 'reporter', 'staff', 'agent', or null (cannot see it). */
export function standing(user, ticket) {
  if (!user || !ticket) return null;
  if (ticket.reporter_id && String(ticket.reporter_id) === String(user.id)) return 'reporter';
  if (isStaff(user)) return 'staff';
  if (isDevAgent(user, ticket.product)) return 'agent';
  return null;
}
const text = (v, field, max, { required = true } = {}) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new ForumError(`${field} is required`, `${field}_required`, 400);
  if (s.length > max) throw new ForumError(`${field} is longer than ${max} characters`, `${field}_too_long`, 400);
  return s;
};
const shape = (t, posts) => ({
  id: t.id, shortId: t.short_id, product: t.product, kind: t.kind, title: t.title, body: t.body, version: t.version, os: t.os,
  status: t.status, statusLabel: STATUS_WORDS[t.status] || t.status, fixedIn: t.fixed_in, createdAt: t.created_at, updatedAt: t.updated_at,
  thread: t.thread_short_id ? { shortId: t.thread_short_id, url: `/forum/t/${t.thread_short_id}/${t.thread_slug}` } : null,
  ...(posts ? { posts: posts.map((p) => ({ id: p.id, kind: p.kind, body: p.body, createdAt: p.created_at, author: { kind: p.author_kind, name: p.author_name || null, reporter: Boolean(p.is_reporter) } })) } : {}),
});
const SELECT = `SELECT t.*, ft.short_id AS thread_short_id, ft.slug AS thread_slug FROM forum_tickets t LEFT JOIN forum_threads ft ON ft.id = t.thread_id`;

async function load(db, shortId) {
  const s = String(shortId || '').toLowerCase();
  if (!/^[a-f0-9]{8}$/.test(s)) return null;
  return (await db.query(`${SELECT} WHERE t.short_id = $1`, [s])).rows[0] || null;
}
async function readable(db, user, shortId) {
  const t = await load(db, shortId), who = standing(user, t);
  if (!who) throw new ForumError('Ticket not found', 'ticket_not_found', 404);
  return { t, who };
}
async function notifyReporter(db, t, user, kind) {
  if (!t.reporter_id || String(t.reporter_id) === String(user.id)) return;
  await db.query('INSERT INTO forum_notifications (user_id, kind, ticket_id, actor_id, actor_kind) VALUES ($1, $2, $3, $4, $5)', [t.reporter_id, kind, t.id, user.id, kindOf(user)]);
}

export async function createTicket(db, user, { product, kind = 'bug', title, body, version, os } = {}) {
  if (user.kind === 'service') throw new ForumError('A service account cannot file a report', 'service_cannot_report', 403);
  const prod = String(product || '').trim().toLowerCase();
  if (!PRODUCT.test(prod)) throw new ForumError('A report must name the product it is about', 'product_required', 400);
  if (!TICKET_KINDS.includes(kind)) throw new ForumError("kind must be 'bug', 'feature' or 'feedback'", 'invalid_kind', 400);
  const ver = String(version || '').trim().toLowerCase() || null;
  const t = (await db.query(
    `INSERT INTO forum_tickets (short_id, reporter_id, product, kind, title, body, version, os) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [newShortId(), user.id, prod, kind, text(title, 'title', 200), text(body, 'body', 20000, { required: false }), ver && VERSION.test(ver) ? ver : null, os ? String(os).slice(0, 120) : null],
  )).rows[0];
  return shape(t);
}

export async function listMyTickets(db, user) {
  return (await db.query(`${SELECT} WHERE t.reporter_id = $1 ORDER BY t.updated_at DESC LIMIT 100`, [user.id])).rows.map((t) => shape(t));
}

/** The queue for those who answer tickets: staff see every product's; a dev agent sees only its own product's. */
export async function listTicketQueue(db, user, { product, status } = {}) {
  const params = [], where = [];
  if (isStaff(user)) { if (product) { params.push(String(product)); where.push(`t.product = $${params.length}`); } }
  else if (user.kind === 'agent' && /-dev$/.test(String(user.username || ''))) { params.push(String(user.username).slice(0, -4)); where.push(`t.product = $${params.length}`); }
  else throw new ForumError('Only XENO staff and a product’s dev agent can see the ticket queue', 'not_allowed', 403);
  if (status) { if (!TICKET_STATUSES.includes(status)) throw new ForumError('Unknown status', 'invalid_status', 400); params.push(status); where.push(`t.status = $${params.length}`); }
  return (await db.query(`${SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY t.updated_at DESC LIMIT 200`, params)).rows.map((t) => shape(t));
}

export async function getTicket(db, user, shortId) {
  const { t } = await readable(db, user, shortId);
  const posts = (await db.query(
    `SELECT p.*, COALESCE(u.display_name, u.username) AS author_name, (p.author_id IS NOT DISTINCT FROM $2::uuid) AS is_reporter
       FROM forum_ticket_posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.ticket_id = $1 ORDER BY p.created_at, p.id`, [t.id, t.reporter_id],
  )).rows;
  return shape(t, posts);
}

export async function addTicketPost(db, user, shortId, { body } = {}) {
  const { t } = await readable(db, user, shortId);
  if (t.status === 'closed') throw new ForumError('This ticket is closed', 'ticket_closed', 409);
  const post = (await db.query('INSERT INTO forum_ticket_posts (ticket_id, author_id, author_kind, body) VALUES ($1,$2,$3,$4) RETURNING id, created_at', [t.id, user.id, kindOf(user), text(body, 'body', 20000)])).rows[0];
  await db.query('UPDATE forum_tickets SET updated_at = now() WHERE id = $1', [t.id]);
  await notifyReporter(db, t, user, 'ticket_reply');
  return { id: post.id, createdAt: post.created_at };
}

/** Staff or the product's dev agent move a ticket on. "fixed" may name the version the fix shipped in. */
export async function setTicketStatus(db, user, shortId, { status, fixedIn, note } = {}) {
  const { t, who } = await readable(db, user, shortId);
  if (who === 'reporter') {
    // the reporter may close their own ticket, and nothing else
    if (status !== 'closed') throw new ForumError('Only XENO can change a ticket’s status. You can close your own.', 'not_allowed', 403);
  }
  if (!TICKET_STATUSES.includes(status)) throw new ForumError('Unknown status', 'invalid_status', 400);
  const ver = fixedIn == null || fixedIn === '' ? null : String(fixedIn).trim().toLowerCase();
  if (ver && !VERSION.test(ver)) throw new ForumError('fixedIn must be a version like 0.6.3', 'invalid_version', 400);
  if (ver && status !== 'fixed') throw new ForumError('A version is named only when the ticket is fixed', 'version_without_fix', 400);
  if (status === t.status && (ver || null) === (t.fixed_in || null)) return getTicket(db, user, shortId);
  await db.query('UPDATE forum_tickets SET status = $2, fixed_in = $3, updated_at = now() WHERE id = $1', [t.id, status, status === 'fixed' ? ver : null]);
  const line = `${STATUS_WORDS[status]}${status === 'fixed' && ver ? ` in ${ver}` : ''}${note ? ` — ${text(note, 'note', 2000, { required: false })}` : ''}`;
  await db.query("INSERT INTO forum_ticket_posts (ticket_id, author_id, author_kind, kind, body) VALUES ($1,$2,$3,'status',$4)", [t.id, user.id, kindOf(user), line]);
  await notifyReporter(db, t, user, 'ticket_status');
  return getTicket(db, user, shortId);
}

/** The reporter, and only the reporter, makes a ticket public: a Feedback thread, linked both ways. */
export async function publishTicket(db, user, shortId) {
  const { t, who } = await readable(db, user, shortId);
  if (who !== 'reporter') throw new ForumError('Only the person who filed it can make it public', 'not_allowed', 403);
  if (t.thread_id) throw new ForumError('This ticket is already public', 'already_public', 409);
  const tags = [`product:${t.product}`, `kind:${t.kind}`];
  if (t.version) tags.push(`version:${t.version}`);
  const env = [`- product: ${t.product}`, t.version ? `- version: ${t.version}` : null, t.os ? `- os: ${t.os}` : null].filter(Boolean).join('\n');
  const thread = await createThread(db, user, { space: 'feedback', title: t.title, body: `${t.body || t.title}\n\n---\n\n**Reported from the app**\n${env}`, tags });
  await db.query('UPDATE forum_tickets SET thread_id = (SELECT id FROM forum_threads WHERE short_id = $2), updated_at = now() WHERE id = $1', [t.id, thread.shortId]);
  return { shortId: t.short_id, thread: { shortId: thread.shortId } };
}

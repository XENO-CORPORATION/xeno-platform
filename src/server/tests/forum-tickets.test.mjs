/**
 * Private reports — tickets (services/forumTickets.js), against a real Postgres.
 *
 *   - a private report is a ticket, not a Forum thread; a public one carries its kind
 *   - only the reporter, XENO staff and that product's dev agent can read it; anyone else gets "not found"
 *   - replies and status changes notify the reporter; a status change is recorded in the ticket's history
 *   - "fixed" may name the version; the reporter may only close their own
 *   - only the reporter can make it public, once; it becomes a Feedback thread linked to the ticket
 *
 *   node src/server/tests/forum-tickets.test.mjs   (DATABASE_URL = a disposable database)
 */
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { seedForum } from '../database/seeds/forum-seed.js';
import * as tickets from '../services/forumTickets.js';
import { submitReport } from '../services/forumWrite.js';
import { listNotifications } from '../services/forumNotify.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const refused = async (fn, code) => { try { await fn(); return false; } catch (e) { return !code || e.code === code; } };

async function main() {
  await runAllMigrations(pool);
  await seedForum(pool).catch(() => {});
  const mk = async (name, role = 'user') => { const m = `${name}-${Date.now()}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at,role) VALUES($1,$2,'x',$1,TRUE,NOW(),$3) RETURNING id`, [m, `${m}@example.test`, role])).rows[0].id; };
  const ids = { ada: await mk('tk-ada'), bob: await mk('tk-bob'), mod: await mk('tk-mod', 'moderator') };
  const ada = { id: ids.ada, kind: 'human', role: 'user', username: 'ada' };
  const bob = { id: ids.bob, kind: 'human', role: 'user', username: 'bob' };
  const staff = { id: ids.mod, kind: 'human', role: 'moderator', username: 'mod' };
  const pixelDev = { id: ids.bob, kind: 'agent', role: 'user', username: 'pixel-dev' };   // the identity check reads kind + handle
  const motionDev = { id: ids.bob, kind: 'agent', role: 'user', username: 'motion-dev' };
  const service = { id: ids.bob, kind: 'service', role: 'user', username: 'svc' };
  try {
    const threadsBefore = Number((await pool.query('SELECT count(*)::int AS n FROM forum_threads')).rows[0].n);
    const t = await tickets.createTicket(ada, ada.id ? pool : pool, {}).catch(() => null);
    check(t === null, 'a ticket must name its product');
    const tk = await tickets.createTicket(pool, ada, { product: 'pixel', kind: 'feature', title: 'Layer groups <b>please</b>', body: 'I want to fold layers.', version: '0.6.3', os: 'Windows 11' });
    check(/^[a-f0-9]{8}$/.test(tk.shortId) && tk.kind === 'feature' && tk.status === 'open' && tk.thread === null, 'a private report is a ticket with its kind, open, and no thread');
    check(Number((await pool.query('SELECT count(*)::int AS n FROM forum_threads')).rows[0].n) === threadsBefore, 'and nothing was posted to the public Forum');
    check(await refused(() => tickets.createTicket(pool, ada, { product: 'pixel', kind: 'rant', title: 'x' }), 'invalid_kind'), 'an unknown kind is refused');
    check(await refused(() => tickets.createTicket(pool, service, { product: 'pixel', title: 'x' }), 'service_cannot_report'), 'a service account cannot file a report');

    // readers
    check((await tickets.getTicket(pool, ada, tk.shortId)).title === 'Layer groups <b>please</b>', 'the reporter can read it');
    check((await tickets.getTicket(pool, staff, tk.shortId)).shortId === tk.shortId, 'XENO staff can read it');
    check((await tickets.getTicket(pool, pixelDev, tk.shortId)).shortId === tk.shortId, 'the product’s own dev agent can read it');
    check(await refused(() => tickets.getTicket(pool, bob, tk.shortId), 'ticket_not_found'), 'another person is told it does not exist, not that it is private');
    check(await refused(() => tickets.getTicket(pool, motionDev, tk.shortId), 'ticket_not_found'), 'another product’s dev agent cannot read it');
    check(await refused(() => tickets.addTicketPost(pool, bob, tk.shortId, { body: 'hi' }), 'ticket_not_found'), 'another person cannot reply to it');
    check((await tickets.listMyTickets(pool, ada)).map((x) => x.shortId).join() === tk.shortId && (await tickets.listMyTickets(pool, bob)).length === 0, 'each person’s list holds only their own tickets');
    check((await tickets.listTicketQueue(pool, pixelDev)).some((x) => x.shortId === tk.shortId) && !(await tickets.listTicketQueue(pool, motionDev)).some((x) => x.shortId === tk.shortId), 'a dev agent’s queue holds its own product’s tickets only');
    check(await refused(() => tickets.listTicketQueue(pool, bob), 'not_allowed'), 'a person cannot see the queue');

    // write-back
    await tickets.addTicketPost(pool, pixelDev, tk.shortId, { body: 'Thanks — looking at it.' });
    let n = await listNotifications(pool, ids.ada);
    check(n[0] && n[0].kind === 'ticket_reply' && n[0].ticket && n[0].ticket.shortId === tk.shortId && n[0].actor && n[0].actor.kind === 'agent', 'a reply from the dev agent lands in the reporter’s notifications, naming the ticket');
    await tickets.addTicketPost(pool, ada, tk.shortId, { body: 'Also on 0.6.2.' });
    check((await listNotifications(pool, ids.ada)).length === n.length, 'the reporter is not notified of their own reply');
    check(await refused(() => tickets.setTicketStatus(pool, staff, tk.shortId, { status: 'planned', fixedIn: '0.7.0' }), 'version_without_fix'), 'a version is named only with "fixed"');
    check(await refused(() => tickets.setTicketStatus(pool, ada, tk.shortId, { status: 'fixed' }), 'not_allowed'), 'the reporter cannot mark their own ticket fixed');
    const fixed = await tickets.setTicketStatus(pool, staff, tk.shortId, { status: 'fixed', fixedIn: '0.7.0', note: 'Layer groups shipped.' });
    check(fixed.status === 'fixed' && fixed.fixedIn === '0.7.0' && fixed.posts.at(-1).kind === 'status' && fixed.posts.at(-1).body === 'Fixed in 0.7.0 — Layer groups shipped.', 'marking it fixed names the version and records it in the ticket’s history');
    n = await listNotifications(pool, ids.ada);
    check(n[0].kind === 'ticket_status' && n[0].ticket.status === 'fixed' && n[0].ticket.fixedIn === '0.7.0', 'the reporter is told it was fixed, and in which version');
    check(fixed.posts.map((p) => p.author.reporter).join() === 'false,true,false', 'the history says which posts are the reporter’s');

    // publish
    check(await refused(() => tickets.publishTicket(pool, staff, tk.shortId), 'not_allowed') && await refused(() => tickets.publishTicket(pool, pixelDev, tk.shortId), 'not_allowed'), 'neither staff nor the dev agent can make it public');
    const pub = await tickets.publishTicket(pool, ada, tk.shortId);
    const th = (await pool.query('SELECT t.title, s.slug FROM forum_threads t JOIN forum_spaces s ON s.id = t.space_id WHERE t.short_id = $1', [pub.thread.shortId])).rows[0];
    check(th && th.slug === 'feedback' && th.title === 'Layer groups <b>please</b>' && (await tickets.getTicket(pool, ada, tk.shortId)).thread.shortId === pub.thread.shortId, 'the reporter makes it public: a Feedback thread, linked to the ticket');
    const tags = (await pool.query('SELECT concat_ws(chr(58), tg.namespace, tg.value) AS slug FROM forum_thread_tags x JOIN forum_tags tg ON tg.id = x.tag_id JOIN forum_threads t ON t.id = x.thread_id WHERE t.short_id = $1 ORDER BY 1', [pub.thread.shortId])).rows.map((r) => r.slug).join();
    check(/kind:feature/.test(tags) && /product:pixel/.test(tags), `the thread carries the ticket’s kind and product (${tags})`);
    check(await refused(() => tickets.publishTicket(pool, ada, tk.shortId), 'already_public'), 'it cannot be made public twice');

    // close
    const closed = await tickets.setTicketStatus(pool, ada, tk.shortId, { status: 'closed' });
    check(closed.status === 'closed' && await refused(() => tickets.addTicketPost(pool, pixelDev, tk.shortId, { body: 'more' }), 'ticket_closed'), 'the reporter can close their own ticket, and a closed one takes no replies');

    // a public report carries its kind
    const pubR = await submitReport(pool, ada, { product: 'motion', kind: 'feedback', title: 'The timeline feels great on a big screen', body: 'Just saying.' });
    const ptags = (await pool.query('SELECT concat_ws(chr(58), tg.namespace, tg.value) AS slug FROM forum_thread_tags x JOIN forum_tags tg ON tg.id = x.tag_id JOIN forum_threads t ON t.id = x.thread_id WHERE t.short_id = $1', [pubR.shortId])).rows.map((r) => r.slug);
    check(ptags.includes('kind:feedback') && !ptags.includes('kind:bug'), 'a public report is tagged with its kind, not always as a bug');
    check(await refused(() => submitReport(pool, ada, { product: 'motion', kind: 'rant', title: 'x' }), 'invalid_kind'), 'a public report with an unknown kind is refused');

    console.log(`forum-tickets: ${passed} checks passed`);
  } finally {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [Object.values(ids)]).catch(() => {});
    await pool.end();
  }
}
main().catch((error) => { console.error(error.message || error); process.exit(1); });

/**
 * The fix written back, votes taken back, hidden replies marked — against a real Postgres.
 *
 *   node src/server/tests/forum-writeback.test.mjs   (DATABASE_URL = a disposable database)
 */
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { seedForum } from '../database/seeds/forum-seed.js';
import { createPost, castVote, removeVote, myVotes, moderate, markThreadFixed } from '../services/forumWrite.js';
import { getThreadByShortId, listThreads } from '../services/forumService.js';
import * as tickets from '../services/forumTickets.js';
import { listNotifications } from '../services/forumNotify.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };

async function main() {
  await runAllMigrations(pool);
  await seedForum(pool).catch(() => {});
  const mk = async (name, role = 'user') => { const m = `${name}-${Date.now()}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at,role) VALUES($1,$2,'x',$1,TRUE,NOW(),$3) RETURNING id`, [m, `${m}@example.test`, role])).rows[0].id; };
  const ids = { ada: await mk('wb-ada'), bob: await mk('wb-bob'), mod: await mk('wb-mod', 'moderator'), cyd: await mk('wb-cyd') };
  const ada = { id: ids.ada, kind: 'human', role: 'user', username: 'ada' }, bob = { id: ids.bob, kind: 'human', role: 'user', username: 'bob' }, mod = { id: ids.mod, kind: 'human', role: 'moderator', username: 'mod' };
  try {
    // a private report made public, then fixed on the public side
    const tk = await tickets.createTicket(pool, ada, { product: 'canvas', kind: 'bug', title: 'Canvas freezes on a big PSD', body: 'It hangs.' });
    const pub = await tickets.publishTicket(pool, ada, tk.shortId);
    const before = (await listNotifications(pool, ids.ada)).length;
    await markThreadFixed(pool, mod, pub.thread.shortId, { version: '0.40.1', note: 'Large files decode off the main thread now.' });
    const t = await getThreadByShortId(pool, pub.thread.shortId);
    check(t.fixedIn === '0.40.1' && !!t.fixedAt, 'a fixed thread says which release fixed it');
    check((await listThreads(pool, { limit: 100 })).find((x) => x.shortId === pub.thread.shortId)?.fixedIn === '0.40.1', 'and so does the thread list');
    const linked = await tickets.getTicket(pool, ada, tk.shortId);
    check(linked.status === 'fixed' && linked.fixedIn === '0.40.1' && linked.posts.at(-1).body === 'Fixed in 0.40.1', 'the private ticket it came from moves to fixed with the same version, recorded in its history');
    const n = await listNotifications(pool, ids.ada);
    check(n.length > before && n.some((x) => x.kind === 'ticket_status' && x.ticket && x.ticket.shortId === tk.shortId) && n.some((x) => x.kind === 'answer'), 'the reporter is told on both: the thread and the ticket');

    // a ticket marked fixed by staff writes the fix onto its public thread
    const tk2 = await tickets.createTicket(pool, ada, { product: 'canvas', kind: 'bug', title: 'Pen tool hangs on a long path', body: 'Hangs.' });
    const pub2 = await tickets.publishTicket(pool, ada, tk2.shortId);
    await tickets.setTicketStatus(pool, mod, tk2.shortId, { status: 'fixed', fixedIn: '0.40.2' });
    check((await getThreadByShortId(pool, pub2.thread.shortId)).fixedIn === '0.40.2', 'a public ticket fixed by staff shows the fix on its public thread too');

    // votes: taken back, and the reader's own vote is known
    const reply = await createPost(pool, bob, pub.thread.shortId, { body: 'Confirmed, works in 0.40.1.' });
    await castVote(pool, ada, { targetType: 'post', targetId: reply.id, value: 1 });
    let mine = await myVotes(pool, ids.ada, [reply.id]);
    const scoreOf = async () => Number((await pool.query('SELECT score FROM forum_posts WHERE id = $1', [reply.id])).rows[0].score);
    check(mine[reply.id] === 1 && (await scoreOf()) > 0, 'a person’s own vote is known, and counted');
    check(Object.keys(await myVotes(pool, ids.bob, [reply.id])).length === 0, 'another person’s votes are not theirs');
    const cyd = { id: ids.cyd, kind: 'human', role: 'user', username: 'cyd' };
    await castVote(pool, cyd, { targetType: 'post', targetId: reply.id, value: 1 });
    const both = await scoreOf();
    const r = await removeVote(pool, ada, { targetType: 'post', targetId: reply.id });
    check(r.removed && (await scoreOf()) < both && (await scoreOf()) > 0 && !(await myVotes(pool, ids.ada, [reply.id]))[reply.id] && (await myVotes(pool, ids.cyd, [reply.id]))[reply.id] === 1, 'a vote can be taken back: the count drops, and another person’s vote stays');
    check((await removeVote(pool, ada, { targetType: 'post', targetId: reply.id })).removed === false, 'taking back a vote that is not there is not an error');

    // a hidden reply leaves a marker, without its words or author
    await moderate(pool, mod, { action: 'hide', targetType: 'post', targetId: reply.id, reason: 'spam' });
    const after = await getThreadByShortId(pool, pub.thread.shortId);
    check(!after.posts.some((p) => p.id === reply.id) && after.hiddenReplies.length === 1 && !('body' in after.hiddenReplies[0]) && !('author' in after.hiddenReplies[0]), 'a hidden reply is gone from the posts and leaves only a marker: its place, no words, no author');

    console.log(`forum-writeback: ${passed} checks passed`);
  } finally {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [Object.values(ids)]).catch(() => {});
    await pool.end();
  }
}
main().catch((error) => { console.error(error.message || error); process.exit(1); });

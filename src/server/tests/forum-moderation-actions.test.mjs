/**
 * Moderation actions and the public log (forumWrite.moderate / resolveFlag, forumService.listModerationLog),
 * against a real Postgres.
 *
 *   node src/server/tests/forum-moderation-actions.test.mjs   (DATABASE_URL = a disposable database)
 */
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { seedForum } from '../database/seeds/forum-seed.js';
import { createThread, createPost, raiseFlag, resolveFlag, moderate } from '../services/forumWrite.js';
import { listModerationLog } from '../services/forumService.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const refused = async (fn, code) => { try { await fn(); return false; } catch (e) { if (code && e.code !== code) console.log('    (got', e.code, ')'); return !code || e.code === code; } };

async function main() {
  await runAllMigrations(pool);
  await seedForum(pool).catch(() => {});
  const mk = async (name, role = 'user') => { const m = `${name}-${Date.now()}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at,role) VALUES($1,$2,'x',$1,TRUE,NOW(),$3) RETURNING id`, [m, `${m}@example.test`, role])).rows[0].id; };
  const ids = { ada: await mk('mo-ada'), bob: await mk('mo-bob'), cyd: await mk('mo-cyd'), mod: await mk('mo-mod', 'moderator') };
  const ada = { id: ids.ada, kind: 'human', role: 'user', username: 'ada' }, bob = { id: ids.bob, kind: 'human', role: 'user', username: 'bob' };
  const cyd = { id: ids.cyd, kind: 'human', role: 'user', username: 'cyd' }, mod = { id: ids.mod, kind: 'human', role: 'moderator', username: 'Mod Erator' };
  const space = (await pool.query("SELECT slug FROM forum_spaces WHERE status = 'active' AND slug <> 'feedback' ORDER BY slug LIMIT 1")).rows[0].slug;
  const tid = async (sid) => (await pool.query('SELECT id, status, duplicate_of, locked_by FROM forum_threads WHERE short_id = $1', [sid])).rows[0];
  try {
    const t1 = await createThread(pool, ada, { space, title: 'How do I export layers as separate files?', body: 'Asking for a friend with many layers.' });
    const t2 = await createThread(pool, bob, { space, title: 'Export each layer to its own file', body: 'Same question, different words.' });
    const reply = await createPost(pool, bob, t1.shortId, { body: 'Buy cheap pills at example dot com' });
    const log0 = (await listModerationLog(pool)).length;

    // flags from three people on one post → one decision, one row
    for (const u of [ada, cyd, bob]) await raiseFlag(pool, u, { targetType: 'post', targetId: reply.id, reason: 'spam' }).catch(() => {});
    const flag = (await pool.query("SELECT id FROM forum_flags WHERE target_id = $1 AND status = 'open' LIMIT 1", [reply.id])).rows[0];
    check(await refused(() => resolveFlag(pool, ada, flag.id, { action: 'hide' }), 'insufficient_reputation'), 'a person without the moderator capability cannot act on a flag');
    check(await refused(() => resolveFlag(pool, mod, flag.id, { action: 'nuke' }), 'invalid_action'), 'an unknown action is refused, never treated as a dismissal');
    const hid = await resolveFlag(pool, mod, flag.id, { action: 'hide', note: 'spam link' });
    check(hid.action === 'hide' && hid.resolved >= 2, `hiding resolves every open flag on that post (${hid.resolved})`);
    check((await pool.query('SELECT status FROM forum_posts WHERE id = $1', [reply.id])).rows[0].status === 'hidden', 'the post is hidden');
    let log = await listModerationLog(pool);
    check(log.length === log0 + 1 && log[0].outcome === 'hidden' && log[0].what === 'post' && /^mo-mod-/.test(log[0].moderator) && log[0].reason === 'spam', 'the public log shows one row: hidden, by which moderator, for what reason');
    check(!JSON.stringify(log[0]).includes('pills') && !JSON.stringify(log[0]).includes(ids.ada) && !JSON.stringify(log[0]).includes(ids.cyd), 'the log carries neither the removed words nor who reported it');

    // restore: a later decision is a new row, and the first one still says what happened
    await moderate(pool, mod, { action: 'restore', targetType: 'post', targetId: reply.id, note: 'false positive' });
    log = await listModerationLog(pool);
    check(log[0].outcome === 'restored' && log[1].outcome === 'hidden', 'restoring adds a row; the earlier "hidden" is not rewritten');
    check(await refused(() => moderate(pool, mod, { action: 'restore', targetType: 'post', targetId: reply.id }), 'not_hidden'), 'restoring a post that is not hidden is refused');

    // lock and unlock
    check(await refused(() => moderate(pool, mod, { action: 'lock', targetType: 'post', targetId: reply.id }), 'invalid_target'), 'lock applies to a thread, not a post');
    const thread1 = await tid(t1.shortId);
    check(await refused(() => moderate(pool, ada, { action: 'lock', targetType: 'thread', targetId: thread1.id }), 'insufficient_reputation') && (await tid(t1.shortId)).status === 'open', 'a person without the moderator capability cannot act directly either');
    await moderate(pool, mod, { action: 'lock', targetType: 'thread', targetId: thread1.id, reason: 'off_topic' });
    const locked = await tid(t1.shortId);
    check(locked.status === 'locked' && locked.locked_by === ids.mod, 'locking records who locked it');
    check(await refused(() => createPost(pool, cyd, t1.shortId, { body: 'one more' }), 'thread_locked'), 'a locked thread takes no new posts');
    check(await refused(() => moderate(pool, mod, { action: 'lock', targetType: 'thread', targetId: thread1.id }), 'already_locked'), 'locking twice is refused');
    await moderate(pool, mod, { action: 'unlock', targetType: 'thread', targetId: thread1.id });
    check((await tid(t1.shortId)).status === 'open' && (await createPost(pool, cyd, t1.shortId, { body: 'Thanks for reopening.' })).id, 'unlocking reopens it for posts');
    log = await listModerationLog(pool);
    check(log[0].outcome === 'unlocked' && log[1].outcome === 'locked', 'lock and unlock are both in the log');

    // duplicate
    const thread2 = await tid(t2.shortId);
    check(await refused(() => moderate(pool, mod, { action: 'duplicate', targetType: 'thread', targetId: thread2.id, duplicateOf: t2.shortId }), 'duplicate_of_self'), 'a thread cannot duplicate itself');
    check(await refused(() => moderate(pool, mod, { action: 'duplicate', targetType: 'thread', targetId: thread2.id, duplicateOf: 'ffffffff' }), 'duplicate_target_not_found'), 'the thread it duplicates must exist');
    await moderate(pool, mod, { action: 'duplicate', targetType: 'thread', targetId: thread2.id, duplicateOf: t1.shortId });
    const dup = await tid(t2.shortId);
    check(dup.status === 'duplicate' && dup.duplicate_of === thread1.id, 'marking a duplicate points it at the original');
    log = await listModerationLog(pool);
    check(log[0].outcome === 'duplicate' && log[0].reason === 'duplicate' && log[0].duplicateOf && log[0].duplicateOf.shortId === t1.shortId, 'the log says which thread it duplicates');
    const t3 = await createThread(pool, cyd, { space, title: 'Separate file per layer when exporting', body: 'Third copy.' });
    const thread3 = await tid(t3.shortId);
    check(await refused(() => moderate(pool, mod, { action: 'duplicate', targetType: 'thread', targetId: thread3.id, duplicateOf: t2.shortId }), 'duplicate_chain'), 'a duplicate of a duplicate is refused: point at the original');

    // a dismissed flag never reaches the log
    await raiseFlag(pool, cyd, { targetType: 'thread', targetId: thread1.id, reason: 'abuse' });
    const f2 = (await pool.query("SELECT id FROM forum_flags WHERE target_id = $1 AND status = 'open' LIMIT 1", [thread1.id])).rows[0];
    const before = (await listModerationLog(pool)).length;
    await resolveFlag(pool, mod, f2.id, { action: 'dismiss' });
    check((await listModerationLog(pool)).length === before && (await tid(t1.shortId)).status === 'open', 'a dismissed flag changes nothing and is not in the public log');

    console.log(`forum-moderation-actions: ${passed} checks passed`);
  } finally {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [Object.values(ids)]).catch(() => {});
    await pool.end();
  }
}
main().catch((error) => { console.error(error.message || error); process.exit(1); });

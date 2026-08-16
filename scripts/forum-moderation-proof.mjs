#!/usr/bin/env node
/**
 * §5 Functional gate — "a flag raised by a user APPEARS IN A QUEUE a moderator
 * can act on, and the action appears in a PUBLIC LOG."
 *
 * Three links, and this codebase has already shipped the first one broken:
 * `forum_flags` was write-only for weeks — flags went into a table nothing could
 * read, so "Report" was a button with no observable effect. That was fixed. This
 * proves the whole chain, because a queue you can read and an action you cannot
 * take is the same feature failing one link further along.
 *
 *   raise  →  the flag is in the moderator's queue, and ONLY a moderator's
 *   act    →  the resolution sticks, and the content state changes
 *   log    →  the action is publicly visible
 *   🔴 and the public log names the ACTION, never the REPORTER
 *
 * That last one is a privacy property, not a nicety. `§11` requires the log
 * because "if the thesis is openness, moderation is where it is tested" — but a
 * public log that names who flagged you converts moderation into a pillory and
 * guarantees nobody flags anything twice.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *
 *   • Dry-run by DEFAULT; `--confirm` required.
 *   • 🔴 NOTHING IS EVER COMMITTED — one transaction, always rolled back.
 */

import crypto from 'crypto';
import pg from 'pg';

const CONFIRM = process.argv.includes('--confirm');

let failures = 0;
const pass = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures += 1; };

let CLIENT = null;

/**
 * A throw is a result too — name it, do not let it kill the run.
 *
 * 🔴 IN A TRANSACTION, CATCHING IS NOT ENOUGH. A failed statement puts Postgres
 * into `25P02 current transaction is aborted`, and every later query — including
 * the assertions that would have explained what happened — dies with the same
 * unhelpful message. The first version of this proof reported one real failure
 * and then a stack trace, which is how a proof turns its own finding into noise.
 *
 * Each fallible step runs inside a SAVEPOINT, rolled back on failure, so the
 * transaction survives and the remaining checks still mean something.
 */
async function step(label, fn) {
  const sp = `sp_${crypto.randomBytes(4).toString('hex')}`;
  await CLIENT.query(`SAVEPOINT ${sp}`);
  try {
    const out = await fn();
    await CLIENT.query(`RELEASE SAVEPOINT ${sp}`);
    return out;
  } catch (err) {
    await CLIENT.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    fail(`${label} — threw instead: ${err.message}`);
    return null;
  }
}

/** Same protection for a call that is EXPECTED to throw. */
async function expectThrow(fn) {
  const sp = `sp_${crypto.randomBytes(4).toString('hex')}`;
  await CLIENT.query(`SAVEPOINT ${sp}`);
  try {
    await fn();
    await CLIENT.query(`RELEASE SAVEPOINT ${sp}`);
    return null;
  } catch (err) {
    await CLIENT.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    return err;
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function service(name) {
  const dir = process.env.FORUM_SERVICE_DIR;
  const candidates = dir
    ? [new URL(`${dir.replace(/\/$/, '')}/${name}`, 'file:///').href]
    : [`../src/server/services/${name}`, `../services/${name}`];
  for (const p of candidates) {
    try { return await import(p); } catch (err) {
      if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    }
  }
  throw new Error(`cannot locate ${name} in either layout`);
}

async function cloneUser(client, sourceId, label, role = 'user') {
  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' ORDER BY ordinal_position`,
  );
  const names = cols.map((c) => c.column_name);
  const uniq = crypto.randomBytes(4).toString('hex');
  const select = names.map((n) => {
    if (n === 'id') return 'gen_random_uuid() AS id';
    if (n === 'email') return `'mod-${uniq}@example.invalid' AS email`;
    if (['handle', 'username', 'display_name'].includes(n)) return `'${label}${uniq}' AS ${n}`;
    if (n === 'created_at') return "(NOW() - INTERVAL '72 hours') AS created_at";
    if (n === 'role') return `'${role}' AS role`;
    return `"${n}"`;
  }).join(', ');
  const { rows } = await client.query(
    `INSERT INTO users (${names.map((n) => `"${n}"`).join(', ')})
     SELECT ${select} FROM users WHERE id = $1 RETURNING id`,
    [sourceId],
  );
  return rows[0].id;
}

const client = await pool.connect();
let began = false;

try {
  const { rows: admins } = await client.query(
    "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1",
  );
  if (!admins.length) throw new Error('no admin account');

  if (!CONFIRM) {
    console.log('DRY RUN — would open a transaction, raise a flag, read the queue as a');
    console.log('moderator and as a non-moderator, resolve it, read the public log, and');
    console.log('ROLL BACK. Nothing is committed. Re-run with --confirm.');
    process.exit(0);
  }

  await client.query('BEGIN');
  began = true;
  CLIENT = client;

  const write = await service('forumWrite.js');
  const svc = await service('forumService.js');
  const ident = await service('agentIdentity.js');

  const actorOf = async (id) => {
    const p = await ident.resolvePrincipal(client, id);
    return { id: p.id, username: p.handle, display_name: p.displayName, role: p.role, kind: p.kind, owner: p.owner };
  };

  const reporterId = await cloneUser(client, admins[0].id, 'modrep');
  const reporter = await actorOf(reporterId);
  const plainId = await cloneUser(client, admins[0].id, 'modplain');
  const plain = await actorOf(plainId);
  const modId = await cloneUser(client, admins[0].id, 'modmod', 'moderator');
  const moderator = await actorOf(modId);
  console.log(`reporter: ${reporter.username} | plain: ${plain.username} | moderator: ${moderator.username} (role=${moderator.role})\n`);

  const thread = await write.createThread(client, plain, {
    space: 'help',
    title: 'Moderation proof — content that will be flagged',
    body: 'Written by the moderation proof. This transaction is rolled back.',
  });
  const threadId = await svc.getThreadIdByShortId(client, thread.shortId);

  // ── 1. raise ─────────────────────────────────────────────────────────────
  console.log('1. a user raises a flag:');
  await step('raiseFlag must succeed', () => write.raiseFlag(client, reporter, {
    targetType: 'thread', targetId: threadId, reason: 'spam', detail: 'Proof flag.',
  }));
  const { rows: raised } = await client.query(
    "SELECT id, status FROM forum_flags WHERE target_id = $1 AND target_type = 'thread'", [threadId],
  );
  if (!raised.length) fail('no flag row — the flag went nowhere');
  else pass(`flag raised (status=${raised[0].status})`);

  // ── 2. the queue, and who may read it ────────────────────────────────────
  console.log('\n2. the queue a moderator can act on:');
  const refusedQueue = await expectThrow(() => write.listFlags(client, plain, { status: 'open' }));
  if (!refusedQueue) fail('an ordinary user could read the moderation queue — flags name people');
  else pass(`a non-moderator is refused (${refusedQueue.code})`);

  const queue = await step('a moderator must be able to read the queue',
    () => write.listFlags(client, moderator, { status: 'open' }));
  const mine = (queue || []).find((f) => f.id === raised[0]?.id);
  if (!queue) { /* already failed */ }
  else if (!mine) fail(`the flag is NOT in the moderator's queue (${queue.length} open flags) — "Report" is a button with no effect`);
  else pass(`the flag appears in the queue, with its thread (${mine.thread?.shortId || mine.threadShortId || 'thread linked'})`);

  // ── 3. act ───────────────────────────────────────────────────────────────
  console.log('\n3. the moderator acts:');
  const resolved = await step('resolveFlag must succeed',
    () => write.resolveFlag(client, moderator, raised[0].id, { action: 'action', note: 'Proof resolution.' }));
  if (resolved) pass(`resolveFlag returned (resolved=${resolved.resolved}, action=${resolved.action})`);

  const { rows: afterFlag } = await client.query(
    'SELECT status, resolution, resolved_by FROM forum_flags WHERE id = $1', [raised[0].id],
  );
  if (afterFlag[0]?.status !== 'actioned') fail(`flag status is "${afterFlag[0]?.status}", expected actioned`);
  else pass('the flag is marked actioned');
  if (!afterFlag[0]?.resolved_by) fail('resolved_by is null — the log cannot say who decided');
  else pass('resolved_by recorded');

  const { rows: afterThread } = await client.query(
    'SELECT status FROM forum_threads WHERE id = $1', [threadId],
  );
  if (afterThread[0]?.status !== 'locked') fail(`the actioned thread is "${afterThread[0]?.status}", expected locked`);
  else pass('the content state changed — the action had an effect');

  // Acting twice must be refused, or two moderators double-punish one item.
  const twice = await expectThrow(() => write.resolveFlag(client, moderator, raised[0].id, { action: 'dismiss' }));
  if (!twice) fail('the same flag was resolved twice');
  else if (twice.code !== 'flag_already_resolved') fail(`second resolve failed as ${twice.code}`);
  else pass('resolving an already-resolved flag is refused');

  // ── 4. the public log ────────────────────────────────────────────────────
  console.log('\n4. the public moderation log:');
  const log = await step('the log must be readable', () => svc.listModerationLog(client, { limit: 50 }));
  const entry = (log || []).find((e) => JSON.stringify(e).includes(thread.shortId));
  if (!log) { /* already failed */ }
  else if (!entry) fail(`the action is ABSENT from the public log (${log.length} entries) — §11 requires moderation be visible`);
  else pass('the action appears in the public log');

  if (entry) {
    // 🔴 The action, never the accusation.
    const blob = JSON.stringify(entry);
    if (blob.includes(reporter.username)) {
      fail('the public log names the REPORTER — this turns moderation into a pillory and nobody flags twice');
    } else pass('the log does NOT name the reporter');

    if (!blob.includes(moderator.username) && !blob.includes(moderator.display_name || ' ')) {
      fail('the log does not name the moderator either — an anonymous decision is not accountability');
    } else pass('it DOES name the moderator — decisions are attributable');
  }
} finally {
  if (began) {
    await client.query('ROLLBACK').catch(() => {});
    console.log('\nROLLED BACK — no user, thread, flag or moderation entry was committed.');
  }
  client.release();
  await pool.end();
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('Flag → queue → action → public log: the chain closes, and the log names the action, not the accuser.');

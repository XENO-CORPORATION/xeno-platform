#!/usr/bin/env node
/**
 * §5 Functional gate — "a user can correct and remove their own content;
 * account deletion removes it."
 *
 * This is the GDPR path, and it has never run against real content: the Forum
 * has nine seeded threads and no user posts. Every other never-run path this
 * week has held a real defect, and this one is the legally material one.
 *
 * ── THE PROPERTY THAT MATTERS IS FINDABILITY, NOT A COLUMN ──────────────────
 *
 * "Removed" does not mean a `status` flag flipped. It means the words are gone
 * from what anyone — a reader, a search, an agent — can retrieve. So this
 * searches for a distinctive phrase from the erased text and asserts the corpus
 * no longer returns it. A test that checks `status = 'deleted'` would pass on an
 * implementation that leaves the body in the full-text index.
 *
 * ── AND THE HALF THAT IS NOT ERASURE ────────────────────────────────────────
 *
 * 🔴 Other people's posts must SURVIVE. Erasing them on one person's request
 * destroys third-party data, which is a different violation of the same law.
 * The subject's own words go; the thread other people built stays.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *
 *   • Dry-run by DEFAULT; `--confirm` required.
 *   • 🔴 NOTHING IS EVER COMMITTED — one transaction, always rolled back.
 *     `eraseSubject` runs its own BEGIN/COMMIT, so it is driven through a shim
 *     that remaps transaction control to SAVEPOINT/RELEASE. Nothing else is
 *     substituted: it is the real erasure, on real tables.
 */

import crypto from 'crypto';
import pg from 'pg';

const CONFIRM = process.argv.includes('--confirm');
const MARK = `zqx${crypto.randomBytes(4).toString('hex')}`; // a phrase nothing else contains

let failures = 0;
const pass = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures += 1; };

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let CLIENT = null;

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

/** Makes `eraseSubject`'s own BEGIN/COMMIT nest inside ours. */
function savepointShim(client) {
  const SP = 'erasure_proof_sp';
  const route = (text, params) => {
    if (typeof text === 'string') {
      const t = text.trim().toUpperCase();
      if (t === 'BEGIN') return client.query(`SAVEPOINT ${SP}`);
      if (t === 'COMMIT') return client.query(`RELEASE SAVEPOINT ${SP}`);
      if (t === 'ROLLBACK') return client.query(`ROLLBACK TO SAVEPOINT ${SP}`);
    }
    return client.query(text, params);
  };
  return { query: route, connect: async () => ({ query: route, release: () => {} }) };
}

async function service(name, dirHint = 'services') {
  const dir = process.env.FORUM_SERVICE_DIR;
  const candidates = dir
    ? [new URL(`${dir.replace(/\/$/, '')}/${name}`, 'file:///').href,
       new URL(`${dir.replace(/\/services$/, '')}/utils/${name}`, 'file:///').href]
    : [`../src/server/${dirHint}/${name}`, `../${dirHint}/${name}`];
  for (const p of candidates) {
    try { return await import(p); } catch (err) {
      if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    }
  }
  throw new Error(`cannot locate ${name}`);
}

async function cloneUser(client, sourceId, label) {
  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' ORDER BY ordinal_position`,
  );
  const names = cols.map((c) => c.column_name);
  const uniq = crypto.randomBytes(4).toString('hex');
  const select = names.map((n) => {
    if (n === 'id') return 'gen_random_uuid() AS id';
    if (n === 'email') return `'era-${uniq}@example.invalid' AS email`;
    if (['handle', 'username', 'display_name'].includes(n)) return `'${label}${uniq}' AS ${n}`;
    if (n === 'created_at') return "(NOW() - INTERVAL '72 hours') AS created_at";
    if (n === 'role') return "'user' AS role";
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
    console.log('DRY RUN — would open a transaction, create a subject + a bystander with');
    console.log('real threads and posts, edit, delete, erase the subject, and ROLL BACK.');
    console.log('Nothing is committed even with --confirm. Re-run with --confirm.');
    process.exit(0);
  }

  await client.query('BEGIN');
  began = true;
  CLIENT = client;

  const write = await service('forumWrite.js');
  const svc = await service('forumService.js');
  const ident = await service('agentIdentity.js');
  const gdpr = await service('gdprErasure.js', 'utils');

  const actorOf = async (id) => {
    const p = await ident.resolvePrincipal(client, id);
    return { id: p.id, username: p.handle, display_name: p.displayName, role: p.role, kind: p.kind, owner: p.owner };
  };

  const subjectId = await cloneUser(client, admins[0].id, 'erasubj');
  const subject = await actorOf(subjectId);
  const otherId = await cloneUser(client, admins[0].id, 'eraother');
  const other = await actorOf(otherId);
  console.log(`subject: ${subject.username} | bystander: ${other.username} | marker: ${MARK}\n`);

  const thread = await write.createThread(client, subject, {
    space: 'help',
    title: `Erasure proof ${MARK} in the title`,
    body: `My body contains ${MARK} and my phone number.`,
  });
  const threadId = await svc.getThreadIdByShortId(client, thread.shortId);
  const theirPost = await write.createPost(client, other, thread.shortId, {
    body: 'A bystander answer that must SURVIVE erasure of somebody else.',
  });
  const myPost = await write.createPost(client, subject, thread.shortId, {
    body: `A second post of mine, also containing ${MARK}.`,
  });

  // ── 1. correct your own words ────────────────────────────────────────────
  console.log('1. correct — editing your own post:');
  const edited = await step('editPost must succeed for the author',
    () => write.editPost(client, subject, myPost.id, { body: `Corrected, still ${MARK}.` }));
  if (edited) pass('the author edited their post');

  const { rows: ed } = await client.query(
    'SELECT body, edited_at FROM forum_posts WHERE id = $1', [myPost.id],
  );
  if (!/Corrected/.test(ed[0]?.body || '')) fail('the body did not change');
  else pass('the body changed');
  if (!ed[0]?.edited_at) fail('edited_at is null — an edit with no trail is indistinguishable from the original');
  else pass('edited_at stamped — the edit is visible as an edit');

  const notYours = await expectThrow(() => write.editPost(client, other, myPost.id, { body: 'hijack' }));
  if (!notYours) fail("a bystander edited somebody else's post");
  else pass(`a bystander cannot edit it (${notYours.code})`);

  // ── 2. remove your own words ─────────────────────────────────────────────
  console.log('\n2. remove — deleting your own post:');
  const before = await client.query('SELECT post_count FROM forum_threads WHERE id = $1', [threadId]);
  await step('deletePost must succeed', () => write.deletePost(client, subject, myPost.id));

  const { rows: del } = await client.query(
    'SELECT status, body FROM forum_posts WHERE id = $1', [myPost.id],
  );
  if (del[0]?.status !== 'deleted') fail(`status is "${del[0]?.status}", expected deleted`);
  else pass('the post is marked deleted');
  if (del[0]?.body) fail(`the body SURVIVED deletion: "${String(del[0].body).slice(0, 40)}"`);
  else pass('the body is blanked, not merely hidden');

  const after = await client.query('SELECT post_count FROM forum_threads WHERE id = $1', [threadId]);
  if (after.rows[0].post_count >= before.rows[0].post_count) {
    fail(`post_count did not drop (${before.rows[0].post_count} → ${after.rows[0].post_count}) — the thread claims replies that are gone`);
  } else pass(`post_count recomputed (${before.rows[0].post_count} → ${after.rows[0].post_count})`);

  const readBack = await svc.getThreadByShortId(client, thread.shortId);
  if ((readBack.posts || []).some((p) => p.id === myPost.id)) fail('the deleted post is still served to readers');
  else pass('it is gone from what a reader receives');

  // ── 3. it was findable, so that erasure means something ─────────────────
  console.log('\n3. before erasure — the words are findable:');
  const found = await svc.searchThreads(client, MARK, 10);
  if (!found.length) fail(`search cannot find "${MARK}" even before erasure — the later assertion would prove nothing`);
  else pass(`search finds the thread by its marker (${found.length} hit)`);

  // ── 4. account deletion ──────────────────────────────────────────────────
  console.log('\n4. erase the subject:');
  const result = await step('eraseSubject must succeed',
    () => gdpr.eraseSubject(savepointShim(client), subjectId));
  if (result) pass(`erased (posts=${result.postsErased}, threads=${result.threadsErased})`);

  const { rows: who } = await client.query(
    'SELECT username, email, display_name, is_active FROM users WHERE id = $1', [subjectId],
  );
  if (!/^erased_/.test(who[0]?.username || '')) fail(`the byline survives: "${who[0]?.username}"`);
  else pass('the identity is tombstoned');
  if (who[0]?.is_active) fail('the erased account is still active');
  else pass('and deactivated');

  const { rows: t } = await client.query(
    'SELECT title, answer_post_id, status FROM forum_threads WHERE id = $1', [threadId],
  );
  if (t[0]?.title.includes(MARK)) fail(`the TITLE still contains the subject's words: "${t[0].title}"`);
  else pass("the subject's thread title is removed");

  const { rows: mine } = await client.query(
    "SELECT COUNT(*)::int AS n FROM forum_posts WHERE author_id = $1 AND body <> ''", [subjectId],
  );
  if (mine[0].n) fail(`${mine[0].n} of the subject's post bodies survived`);
  else pass('every post body of theirs is blank');

  // 🔴 The other half: third-party content must NOT be destroyed.
  const { rows: theirs } = await client.query(
    'SELECT status, body FROM forum_posts WHERE id = $1', [theirPost.id],
  );
  if (theirs[0]?.status !== 'visible' || !theirs[0]?.body) {
    fail("the BYSTANDER's post was destroyed — erasing one person's data must not erase another's");
  } else pass("the bystander's post is untouched — third-party data survives");

  // 🔴 And the property that actually matters.
  const stillFound = await svc.searchThreads(client, MARK, 10);
  if (stillFound.length) {
    fail(`search STILL returns the erased words (${stillFound.length} hit) — "removed" that stays findable is not removed`);
  } else pass('search no longer returns the erased words — gone from the index, not just flagged');
} finally {
  if (began) {
    await client.query('ROLLBACK').catch(() => {});
    console.log('\nROLLED BACK — no user, thread, post or erasure was committed.');
  }
  client.release();
  await pool.end();
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('Correct, remove, erase: the subject\'s words are gone and findable by nobody; the bystander\'s remain.');

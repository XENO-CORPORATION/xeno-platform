#!/usr/bin/env node
/**
 * Loop D push half — prove it END TO END, against the real database, with a
 * real HTTP receiver.
 *
 * ── WHY THIS AND NOT A UNIT TEST ────────────────────────────────────────────
 *
 * Because the thing being proven is a JOIN between two subsystems that had
 * never been connected: a predicate sweep, and a delivery engine with zero
 * producers. Every piece already passed its own tests while nothing pushed
 * anything anywhere. A mocked `dispatchWebhookEvent` would assert that this file
 * calls a function — the least likely part to be wrong, and exactly the
 * assertion that stayed green through all eleven of this ecosystem's
 * unreachable features.
 *
 * So: a real webhook row, a real listening socket, the real sweep, the real
 * delivery engine, and an assertion that BYTES ARRIVED with a valid signature.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *
 *   • Dry-run by DEFAULT. `--confirm` is required to write anything.
 *   • The receiver binds 127.0.0.1 — nothing leaves the host.
 *   • It REFUSES to run against a subscriber that already has a predicate,
 *     rather than overwriting somebody's real subscription.
 *   • 🔴 NOTHING IS EVER COMMITTED. Everything happens inside one transaction
 *     that always rolls back, so no fixture is ever visible to a reader.
 *
 * ── WHY THE TRANSACTION SHIM, AND WHAT IT DOES NOT FAKE ─────────────────────
 *
 * The live corpus is nine threads, every one `resolved`, none in a feedback
 * space. An empty digest is therefore the CORRECT answer for every possible
 * predicate today — so the delivery path cannot be exercised without content
 * that does not exist.
 *
 * Publishing a fixture thread to prove a point would put it on a permanent,
 * public Record for as long as the proof took, and the Forum's whole thesis is
 * that the Record is permanent. So the sweep runs against a shim whose ONLY
 * behaviour is to translate its `BEGIN`/`COMMIT` into `SAVEPOINT`/`RELEASE`
 * inside an outer transaction that always rolls back.
 *
 * Nothing else is substituted. The sweep, the predicate, `getDigest`, the
 * delivery engine, the HMAC and the socket are the real ones — and the HTTP
 * request is genuinely sent, which is the assertion that matters.
 */

import http from 'http';
import crypto from 'crypto';
import pg from 'pg';

const CONFIRM = process.argv.includes('--confirm');
const EVENT = 'forum.digest';

let failures = 0;
const pass = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures += 1; };

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/**
 * The repo and the running container do not agree on where the server lives:
 * here it is `src/server/services/`, in the image it is `/app/services/`.
 * Try both rather than hardcoding one and discovering the other at 3am.
 */
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

/**
 * Makes the sweep's own transaction nest inside ours.
 *
 * The sweep calls `db.connect()`, `BEGIN`, … `COMMIT`. Against a pool that is
 * fine; inside an outer transaction its COMMIT would commit our fixtures.
 * SAVEPOINT/RELEASE is exactly equivalent nesting, and it is the only thing
 * this shim changes — every other statement passes straight through to the
 * same client.
 */
function savepointShim(client) {
  const SP = 'forum_push_proof_sp';
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

/** A real socket. If nothing arrives here, nothing was pushed. */
async function receiver() {
  const got = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      got.push({ headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { got, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

const rx = await receiver();
console.log(`receiver listening on 127.0.0.1:${rx.port}\n`);

const client = await pool.connect();
let began = false;

try {
  const { rows: users } = await client.query(
    "SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1",
  );
  if (!users.length) throw new Error('no admin account to own the test webhook');
  const subscriberId = users[0].id;
  console.log(`subscriber: ${users[0].email}`);

  const { rows: existing } = await client.query(
    'SELECT 1 FROM forum_subscriptions WHERE user_id = $1 AND predicate IS NOT NULL',
    [subscriberId],
  );
  if (existing.length) {
    console.log('\nREFUSING: that account already has a real predicate. Overwriting it would');
    console.log('destroy a live subscription to prove a point. Pick another account.');
    process.exit(2);
  }

  if (!CONFIRM) {
    console.log('\nDRY RUN — would open a transaction, seed one open thread + a webhook +');
    console.log('a predicate, run three sweeps, assert, and ROLL BACK. Nothing is committed');
    console.log('even with --confirm. Re-run with --confirm to execute.');
    process.exit(0);
  }

  await client.query('BEGIN');
  began = true;

  // ── fixtures, all inside the transaction ─────────────────────────────────
  const { rows: spaces } = await client.query('SELECT id, slug FROM forum_spaces ORDER BY created_at LIMIT 1');
  if (!spaces.length) throw new Error('no forum space exists');

  const shortId = crypto.randomBytes(4).toString('hex');
  await client.query(
    `INSERT INTO forum_threads
       (short_id, space_id, slug, title, author_id, author_kind, status,
        post_count, last_activity_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'human', 'open',
             0, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days', NOW())`,
    [shortId, spaces[0].id, `push-proof-${shortId}`, 'Push proof — an open, unanswered thread', subscriberId],
  );
  console.log(`seeded:     one open thread (${shortId}) in space "${spaces[0].slug}" — never committed`);

  const secret = crypto.randomBytes(32).toString('hex');
  const { rows: wh } = await client.query(
    `INSERT INTO webhooks (user_id, url, secret, events, is_active)
     VALUES ($1, $2, $3, ARRAY[$4], true) RETURNING id`,
    [subscriberId, `http://127.0.0.1:${rx.port}/hook`, secret, EVENT],
  );
  console.log(`webhook:    ${wh[0].id}`);

  const { setPredicate } = await service('forumService.js');
  // No tags: the predicate matches the whole corpus, so the assertion is about
  // delivery rather than about whether a particular tag happens to exist.
  await setPredicate(client, subscriberId, { max_per_hour: 4 });

  const { pushPendingDigests } = await service('forumWebhookPush.js');
  const db = savepointShim(client);

  // ── sweep 1: a due subscriber with a live endpoint ───────────────────────
  console.log('\nsweep 1 — a due subscriber with a live endpoint:');
  const r1 = await pushPendingDigests(db, { limit: 25 });
  console.log(`  sweep result: ${JSON.stringify(r1)}`);

  if (r1.pushed !== 1) fail(`expected exactly 1 push, got ${r1.pushed} (empty=${r1.empty}, noEndpoint=${r1.noEndpoint}, failed=${r1.failed})`);
  else pass('the sweep reported one push');

  // Delivery is fire-and-forget by design — the engine owns retries. Wait for
  // the socket; do not assume it.
  const deadline = Date.now() + 15000;
  while (!rx.got.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));

  if (!rx.got.length) {
    fail('NOTHING ARRIVED at the receiver — the sweep reported a push that never left the process');
  } else {
    pass(`a real request arrived (${rx.got[0].body.length} bytes)`);

    const sig = rx.got[0].headers['x-webhook-signature'];
    const expect = `sha256=${crypto.createHmac('sha256', secret).update(rx.got[0].body).digest('hex')}`;
    if (sig !== expect) fail(`HMAC mismatch — a receiver could not authenticate this push (${sig})`);
    else pass('HMAC-SHA256 signature verifies against the registered secret');

    let payload = null;
    try { payload = JSON.parse(rx.got[0].body); } catch { /* handled below */ }
    // The delivery engine wraps every event as
    // `{ event, payload, timestamp, deliveryId }` — so a receiver reads
    // `body.payload.digest`, and `body.event` tells it which kind it is. Worth
    // asserting rather than assuming: this envelope is now part of the Loop D
    // contract that a dev agent's endpoint has to parse.
    if (payload?.event !== EVENT) fail(`envelope event is "${payload?.event}", expected "${EVENT}"`);
    else pass(`envelope declares event "${EVENT}"`);

    const digest = payload?.payload?.digest;

    if (!digest) {
      fail(`the payload carries no digest — keys: ${payload ? Object.keys(payload).join(',') : 'unparseable'}`);
    } else if (!digest.sections) {
      fail('the digest has no sections — a feed, not a digest (§3.2)');
    } else {
      const counts = ['rising', 'waiting', 'shipped'].map((k) => `${k}=${digest.sections[k]?.length ?? 0}`);
      pass(`it is a DIGEST, aggregated and pre-ranked (${counts.join(' ')})`);

      const cited = [...(digest.sections.waiting || []), ...(digest.sections.rising || [])]
        .filter((t) => typeof t.url === 'string' && t.url.startsWith('/forum/t/'));
      if (!cited.length) fail('no citable thread URLs in the digest — an agent has nothing to hand a human (§6.1)');
      else pass(`${cited.length} citable thread URL(s) — an agent can answer with a link`);

      const seeded = (digest.sections.waiting || []).some((t) => t.shortId === shortId);
      if (!seeded) fail('the seeded open thread is missing from `waiting` — the digest is not reading the corpus');
      else pass('the seeded open thread appears in `waiting`');
    }
  }

  // ── the two cursors are independent ──────────────────────────────────────
  const { rows: cur } = await client.query(
    'SELECT last_push_at, last_digest_at FROM forum_subscriptions WHERE user_id = $1 AND predicate IS NOT NULL',
    [subscriberId],
  );
  if (!cur[0]?.last_push_at) fail('last_push_at did not advance — the next sweep would push the same window again');
  else pass('last_push_at advanced');

  if (cur[0]?.last_digest_at) {
    fail('the PUSH advanced last_digest_at — it consumed the pull channel\'s window, and the agent\'s next poll would silently return nothing');
  } else {
    pass('last_digest_at untouched — push and pull keep separate clocks');
  }

  // ── max_per_hour is a real constraint, not a declared one ────────────────
  console.log('\nsweep 2 — immediately again (max_per_hour=4 ⇒ one per 15 min):');
  const before = rx.got.length;
  const r2 = await pushPendingDigests(db, { limit: 25 });
  console.log(`  sweep result: ${JSON.stringify(r2)}`);

  if (r2.due !== 0) fail(`the subscriber was still due ${r2.due} — max_per_hour is decoration`);
  else pass('not due — the declared appetite is enforced by the server');

  await new Promise((r) => setTimeout(r, 1500));
  if (rx.got.length !== before) fail(`a second request arrived ${rx.got.length - before} time(s) despite the rate limit`);
  else pass('no second delivery');

  // ── a pure-pull subscriber must not have its window burned ───────────────
  //
  // ⚠️ WHAT THIS ACTUALLY PROVES, precisely: that a subscriber without an
  // active endpoint is never CLAIMED, so its cursor cannot move. It does NOT
  // exercise the `!matched` guard in the sweep — mutation-checking showed that
  // deleting that guard changes nothing here, because the claim filter already
  // excluded the row. The guard covers a claim/dispatch race and is uncovered.
  console.log('\nsweep 3 — endpoint deactivated, cursor reset (never claimed at all):');
  await client.query('UPDATE webhooks SET is_active = false WHERE id = $1', [wh[0].id]);
  await client.query('UPDATE forum_subscriptions SET last_push_at = NULL WHERE user_id = $1', [subscriberId]);

  const r3 = await pushPendingDigests(db, { limit: 25 });
  console.log(`  sweep result: ${JSON.stringify(r3)}`);

  const { rows: after } = await client.query(
    'SELECT last_push_at FROM forum_subscriptions WHERE user_id = $1 AND predicate IS NOT NULL',
    [subscriberId],
  );
  if (after[0]?.last_push_at) {
    fail('a subscriber with no active endpoint had its cursor advanced — its next poll would be missing everything in that window');
  } else {
    pass('cursor untouched for a subscriber with no endpoint');
  }

  // ── an empty digest is never pushed ──────────────────────────────────────
  console.log('\nsweep 4 — endpoint restored, but nothing to report:');
  await client.query('UPDATE webhooks SET is_active = true WHERE id = $1', [wh[0].id]);
  await client.query(`UPDATE forum_threads SET status = 'resolved' WHERE short_id = $1`, [shortId]);
  const before4 = rx.got.length;

  const r4 = await pushPendingDigests(db, { limit: 25 });
  console.log(`  sweep result: ${JSON.stringify(r4)}`);

  if (r4.empty !== 1) fail(`expected the digest to be recognised as empty, got ${JSON.stringify(r4)}`);
  else pass('an empty digest is recognised');

  await new Promise((r) => setTimeout(r, 1000));
  if (rx.got.length !== before4) fail('an EMPTY digest was pushed — an agent that receives "nothing happened" on a schedule learns to ignore the channel');
  else pass('nothing was sent — silence is the correct message');
} finally {
  if (began) {
    await client.query('ROLLBACK').catch(() => {});
    console.log('\nROLLED BACK — no thread, webhook or subscription was ever committed.');
  }
  client.release();
  await rx.close();
  await pool.end();
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('Loop D push half: a real digest left the process, signed, and arrived.');

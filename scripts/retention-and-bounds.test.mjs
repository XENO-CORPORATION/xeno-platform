/**
 * RETENTION, AND THE ONE FAILURE MODE IT MUST NEVER HAVE.
 *
 * Four tables added for the download funnel and the version floor grow one row
 * per user action and had no end. That is a scheduled outage, not a slow leak:
 * the first symptom is a full disk on the box that also runs the database, so
 * the site is down rather than slow.
 *
 * 🔴 But a retention system's own failure mode is worse than the problem it
 * solves. "Delete rows older than N" where N silently becomes 0 deletes the
 * table. Most of what follows asserts that CANNOT happen — a malformed override
 * keeps the default, an off policy stays off, and the one table holding legal
 * evidence is not pruned at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { POLICIES, describeRetention, sweepRetention } =
  await import('../src/server/services/dataRetention.js');

const svc = readFileSync('src/server/services/dataRetention.js', 'utf8');
const route = readFileSync('src/server/routes/productDownloadRoutes.js', 'utf8');
const index = readFileSync('src/server/index.js', 'utf8');

/* ── 1 · The evidence table is not pruned ────────────────────────────────── */

test('🔴 checkout_consents is NOT pruned by default', () => {
  /* It is the evidence a customer waived a statutory right. Delete it and we
   * cannot rebut "I never agreed", and the burden is ours. */
  const p = POLICIES.find((x) => x.table === 'checkout_consents');
  assert.ok(p, 'the consent policy is gone');
  assert.equal(p.days, null, 'consents now have a retention period set by default — that destroys legal evidence');
  assert.ok(/lawyer|Steuerberater/i.test(p.why), 'the reason no longer says whose decision the period is');
});

test('download_intent_events is not double-clocked', () => {
  /* It cascades with download_intents, which the funnel sweeper prunes. A second
   * policy on the same rows is two clocks disagreeing, and the earlier one wins
   * silently. */
  const p = POLICIES.find((x) => x.table === 'download_intent_events');
  assert.equal(p.days, null, 'events are now pruned here AND by cascade — two clocks on one set of rows');
});

test('the security audit outlives a year', () => {
  /* The questions a grant answers arrive late: a chargeback months later, a
   * licence dispute, a leaked build. */
  const p = POLICIES.find((x) => x.table === 'download_grants');
  assert.ok(p.days >= 366, `grants are kept only ${p.days} days — shorter than the questions that ask about them`);
});

/* ── 2 · A retention system must never delete everything ─────────────────── */

test('🔴 a malformed override keeps the DEFAULT, never zero', () => {
  /* Reading "abc" as 0 deletes the table on the next sweep. The failure mode of
   * a retention system must never be "delete everything". */
  const original = process.env.GRANT_RETENTION_DAYS;
  try {
    for (const bad of ['abc', '', '0', '-5', 'null', 'NaN']) {
      process.env.GRANT_RETENTION_DAYS = bad;
      const d = describeRetention().find((x) => x.table === 'download_grants').days;
      assert.ok(d >= 366, `GRANT_RETENTION_DAYS="${bad}" resolved to ${d} — a bad value must keep the default`);
    }
  } finally {
    if (original === undefined) delete process.env.GRANT_RETENTION_DAYS;
    else process.env.GRANT_RETENTION_DAYS = original;
  }
});

test('a valid override is honoured', () => {
  const original = process.env.GRANT_RETENTION_DAYS;
  try {
    process.env.GRANT_RETENTION_DAYS = '500';
    assert.equal(describeRetention().find((x) => x.table === 'download_grants').days, 500);
  } finally {
    if (original === undefined) delete process.env.GRANT_RETENTION_DAYS;
    else process.env.GRANT_RETENTION_DAYS = original;
  }
});

test('a null policy is never swept, whatever the SQL would be', async () => {
  /* Behavioural: run the sweep against a pool that records every statement and
   * assert the untouched tables are never named. A structural check could not
   * see a `continue` removed. */
  const seen = [];
  const pool = { async query(sql) { seen.push(sql); return { rowCount: 0 }; } };
  await sweepRetention(pool);
  const joined = seen.join(' ');
  assert.ok(!/checkout_consents/.test(joined), 'the sweep touched checkout_consents — that is legal evidence');
  assert.ok(!/download_intent_events/.test(joined), 'the sweep touched download_intent_events, which cascades');
  assert.ok(/download_grants/.test(joined), 'the sweep no longer prunes grants at all');
});

test('deletes are BOUNDED per run', () => {
  /* An unbounded DELETE on a table that grew for months takes a long lock and
   * stalls every other write. A capped delete just runs again. */
  assert.ok(/LIMIT 5000/.test(svc), 'the delete is unbounded — one sweep could lock the table for minutes');
});

test('the sweep can never take down the server', async () => {
  /* It runs in the boot path beside the other sweepers. Hygiene must not be able
   * to stop the process starting. */
  const exploding = { async query() { throw new Error('db down'); } };
  const r = await sweepRetention(exploding);
  assert.deepEqual(r, {}, 'a failing retention sweep now propagates into boot');
});

test('the sweep is actually scheduled AND run at boot', () => {
  /* A sweeper nobody runs is the same bug as no sweeper. A restart with no boot
   * call leaves a backlog unswept until the first interval fires. */
  const live = index.split('\n').filter((l) => !l.trim().startsWith('//'));
  assert.ok(live.some((l) => l.includes('setInterval(sweepRet')), 'retention is never scheduled');
  assert.ok(live.some((l) => l.includes('sweepRet();')), 'retention never runs at boot');
});

/* ── 3 · The authority path is bounded per ACCOUNT ───────────────────────── */

test('grant minting is capped per ACCOUNT, not only per IP', () => {
  /* The global limiter is per-IP, and this endpoint produces the permission to
   * take a binary. A compromised paid account can mint from anywhere. */
  assert.ok(route.includes('GRANT_HOURLY_CAP'), 'there is no per-account cap on grant minting');
  assert.ok(route.includes('grant_rate_limited'), 'the cap has no machine-readable refusal code');
  assert.ok(/status\(429\)/.test(route), 'the cap does not answer 429');
});

test('the cap is measured against the AUDIT table, not new state', () => {
  /* Counting from the table we already write means the limit cannot drift from
   * what actually happened, and needs no extra store to keep consistent. */
  const i = route.indexOf('GRANT_HOURLY_CAP');
  const block = route.slice(i, i + 900);
  assert.ok(/FROM download_grants/.test(block), 'the cap counts something other than the grants actually issued');
});

test('🔴 the cap runs AFTER the entitlement check and fails OPEN', () => {
  /* Order: a caller who has not paid must be refused 403, not 429 — the two say
   * very different things and 429 implies "come back later", which is false.
   *
   * Direction: the entitlement has already passed, so the caller HAS paid.
   * Refusing them because we could not read a count would punish a customer for
   * our database. */
  /* Two separate questions, asserted separately. This required the cap to be
   * INLINE between the entitlement check and the mint, and went red when the cap
   * was extracted into a helper shared by both minting paths — better code,
   * failing gate.
   *
   * (a) ORDER at the call site. */
  const ent = route.indexOf("assertEntitlement(req.db, userId, 'canDownload')");
  const cap = route.indexOf('await enforceGrantCap(req, userId)');
  const mint = route.indexOf('const grant = mintDownloadGrant(');
  assert.ok(ent > -1 && cap > -1 && mint > -1, 'the mint path changed shape — re-verify the ordering');
  assert.ok(ent < cap, 'the cap runs before the entitlement check — an unpaid caller would get 429, not 403');
  assert.ok(cap < mint, 'the cap runs after the grant is minted, which is not a cap');

  /* (b) DIRECTION inside the helper. */
  const helper = route.slice(route.indexOf('async function enforceGrantCap('), route.indexOf('async function auditGrant('));
  assert.ok(/catch \(e\)/.test(helper) && /allowing/.test(helper),
    'the cap fails closed — a database hiccup would refuse a paying customer');
  assert.ok(/return null;/.test(helper), 'the cap no longer has an allow path');
});

test('🔴 BOTH minting paths are capped AND audited', () => {
  /* The gap this replaces: the download route had a cap and an audit, and the
   * UPDATER route minted the SAME authority — a grant that opens an installer —
   * with neither. Two doors to one permission where only one is watched is not a
   * weaker control; the attacker uses the other door.
   *
   * Asserted per PATH, because a file-level "is there a cap" passed the entire
   * time one path had none. */
  const paths = [
    ["grantRouter.post('/grant'", 'the download mint'],
    ["updateGrantRouter.get('/:slug/grant'", 'the updater mint'],
  ];
  for (const [marker, label] of paths) {
    const i = route.indexOf(marker);
    assert.ok(i > -1, `${label} is gone`);
    const end = route.indexOf(String.fromCharCode(10) + '});', i);
    const body = route.slice(i, end > -1 ? end : i + 4000);
    assert.ok(body.includes('enforceGrantCap'), `${label} is not rate-capped — an unwatched door to the same authority`);
    assert.ok(/auditGrant\(/.test(body), `${label} writes no audit row`);
  }
});

test('the cap is generous enough not to catch real people', () => {
  /* Three machines, a reinstall, a suite of apps. A limit that catches that is a
   * support ticket wearing a security costume. */
  const m = route.match(/GRANT_HOURLY_CAP \|\| (\d+)/);
  assert.ok(m, 'the cap default is gone');
  assert.ok(Number(m[1]) >= 30, `the hourly cap is ${m[1]} — low enough to catch a normal reinstall`);
});

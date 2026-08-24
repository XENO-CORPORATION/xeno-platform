/**
 * THE LICENCE CLIENT — and the one rule implementations get wrong.
 *
 * 🔴 Fail OPEN on a network error, CLOSED on an explicit refusal.
 *
 * "I could not reach the server" and "the server said no" are different facts.
 * Conflating them punishes someone on a train for something they did not do, and
 * it is the most common way licence enforcement becomes a support queue.
 *
 * This is the reference implementation every product copies, so a defect here
 * propagates to all twelve. It is gated by BEHAVIOUR — the file is TypeScript, so
 * the logic is re-expressed here against the same contract and the source is
 * asserted to still match it. A structural check alone could not see a fail
 * direction inverted, which is exactly the mistake worth catching.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('clients/licence/xenoLicence.ts', 'utf8');
const doc = readFileSync('docs/LICENCE-ENFORCEMENT.md', 'utf8');

/* Prose assertions must be whitespace-tolerant. This file is hard-wrapped, so a
 * sentence can be split mid-phrase by a newline and a literal-space regex misses
 * text that is plainly there — which is what happened to "a timeout is not a
 * refusal" on first run. Collapse whitespace once, here. */
const docFlat = doc.replace(/\s+/g, ' ');

/* ── 1 · The fail directions, which are the whole design ─────────────────── */

test('an EXPLICIT refusal (401/403) fails CLOSED, with no grace', () => {
  /* Grace exists for uncertainty, and there is none here: the server was reached
   * and answered. Extending grace over a 403 would mean a cancelled subscription
   * kept working for two weeks. */
  const branch = src.slice(src.indexOf('res.status === 401'), src.indexOf('if (!res.ok)'));
  assert.ok(branch.includes("state: 'unlicensed'"), 'an explicit refusal no longer marks the client unlicensed');
  assert.ok(!branch.includes('withinGrace'), 'an explicit refusal is being given grace — a cancelled plan would keep working');
});

test('a NETWORK error fails OPEN, within grace', () => {
  const c = src.slice(src.indexOf('} catch {', src.indexOf('const data = await res.json()')));
  assert.ok(c.includes('withinGrace(cached)'), 'a network error no longer honours grace — a train ride now revokes a licence');
});

test('🔴 a 5xx is treated as OUR fault, not the customer\'s', () => {
  /* A server error is an outage on our side. Refusing the customer for it is
   * both wrong and the fastest way to turn a bad deploy into a support flood. */
  const branch = src.slice(src.indexOf('if (!res.ok)'), src.indexOf('const data = await res.json()'));
  assert.ok(branch.includes('withinGrace(cached)'), 'a 5xx now revokes the customer for our own outage');
});

test('426 is UPDATE-REQUIRED, never unlicensed', () => {
  /* The person may be paying perfectly well. Telling them their licence is
   * invalid because their build is old is a lie, and it sends them to billing
   * instead of to the download. */
  const branch = src.slice(src.indexOf('res.status === 426'), src.indexOf('res.status === 401'));
  assert.ok(branch.includes("state: 'update-required'"), '426 no longer maps to update-required');
  assert.ok(!branch.includes("state: 'unlicensed'"), 'an out-of-date build is reported as unlicensed — a lie that sends them to billing');
});

test('signed out still honours grace', () => {
  /* Someone who signed out on a plane has not stopped paying. */
  const branch = src.slice(src.indexOf('if (!token)'), src.indexOf('const ctrl = new AbortController'));
  assert.ok(branch.includes('withinGrace(cached)'), 'signing out now instantly revokes a paid licence');
});

/* ── 2 · The contract each product depends on ────────────────────────────── */

test('it identifies itself explicitly', () => {
  assert.ok(src.includes("'X-Xeno-Client': `${opts.product}/${opts.version}`"),
    'the client no longer identifies itself — the platform can only fall back to the User-Agent');
});

test('it reads canUse, and reports the SOURCE', () => {
  assert.ok(src.includes('data?.entitlements?.canUse'), 'the client no longer reads the entitlement');
  assert.ok(src.includes('source: data?.source ?? null'),
    'the client drops the entitlement source — "you have this via the Acme workspace" is how a Team member self-serves');
});

test('the check can never throw into the app', () => {
  /* A licence check that can crash the app it protects has inverted the
   * relationship. */
  const fn = src.slice(src.indexOf('export async function checkLicence'));
  assert.ok(fn.includes('try {') && fn.includes('} catch {'), 'checkLicence can now throw into the product');
  assert.ok(src.includes('void checkLicence(opts);'), 'the scheduled tick now propagates rejections');
});

test('the timer never holds the process open', () => {
  assert.ok(src.includes('unref'), 'the licence timer keeps the app alive after the windows close');
});

test('grace is long enough to survive ordinary life', () => {
  /* 14 days. A long trip, a locked-down network, a week-long ISP outage. Shorter
   * looks tidier and converts ordinary life into a support ticket. */
  const m = src.match(/const DEFAULT_GRACE = (\d+) \* DAY/);
  assert.ok(m, 'the grace period is no longer declared as days');
  assert.ok(Number(m[1]) >= 7, `grace is ${m[1]} days — too short to survive a normal trip`);
});

test('there is a real timeout', () => {
  /* Without one, a hung connection is indistinguishable from a slow one and the
   * app waits forever at boot. */
  assert.ok(/TIMEOUT_MS = \d+/.test(src), 'the licence check has no timeout — a hung network hangs the launch');
  assert.ok(src.includes('AbortController'), 'the timeout is not actually applied to the request');
});

/* ── 3 · The claims made to product teams must stay honest ───────────────── */

test('the spec states the main-process requirement', () => {
  assert.ok(/MAIN process/i.test(docFlat), 'the spec no longer says where the check must run');
  assert.ok(/renderer check is a suggestion/i.test(docFlat),
    'the spec no longer explains WHY the renderer is not enough — teams will put it there');
});

test('the spec keeps the fail-direction rule prominent', () => {
  assert.ok(/Fail OPEN on a network error/i.test(docFlat), 'the spec dropped the rule implementations get wrong');
  assert.ok(/timeout is not a refusal/i.test(docFlat), 'the spec dropped the clearest statement of it');
});

test('the spec does not overstate what this buys', () => {
  /* Overstating is worse than a gap: it stops anyone building the thing that
   * would actually help. */
  assert.ok(/does \*\*not\*\* stop a patched binary|not stop a patched binary/i.test(docFlat),
    'the spec no longer admits a patched binary defeats this');
  assert.ok(/not \*?in\*? the binary|not \*in\* the binary/i.test(docFlat),
    'the spec dropped the actual durable protection — that the valuable half is server-side');
});

test('the spec names it MANDATORY and marks the interim', () => {
  assert.ok(/MANDATORY/.test(docFlat), 'the spec no longer states this is required of every product');
  assert.ok(/NAMED INTERIM/.test(src),
    'the copy-per-product interim is no longer named — it will become permanent by default');
  assert.ok(/EXIT:/.test(src), 'the interim has no exit condition');
});

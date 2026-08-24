/**
 * REVOKING A BUILD THAT NEVER AGREED TO BE REVOKED.
 *
 * An installer shipped before licence enforcement existed has no check compiled
 * into it. Nothing deployed can make that binary refuse itself. But it is only
 * worth running because of what it can REACH, and that is all on our side — so
 * the enforceable question is "can we stop answering it?", and these gates hold
 * the answer.
 *
 * 🔴 This is also the most dangerous control in the platform. A wrong floor
 * locks out every user of a product at once, instantly, with no client-side
 * recourse. So roughly half of what follows asserts the ways it must NOT fire.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  identifyClient, compareVersions, evaluateClient, invalidatePolicyCache, loadPolicies,
} = await import('../src/server/services/clientVersion.js');

const read = (f) => readFileSync(f, 'utf8');
const mw = read('src/server/middleware/requireSupportedClient.js');
const svc = read('src/server/services/clientVersion.js');
const index = read('src/server/index.js');
const migration = read('src/server/database/migrations/20260824160000-client-version-policy.sql');

const req = (headers) => ({ headers, path: '/api/x' });
const policy = (o) => new Map([['hub', { product: 'hub', min_supported: null, min_recommended: null, message: null, enforced_at: null, ...o }]]);

/* ── 1 · Identifying a build that never agreed to identify itself ────────── */

test('an OLD Electron build is identified from its User-Agent alone', () => {
  /* The whole reason this control is retroactive. Electron appends the app name
   * and version by default, so a build from before any of this existed is still
   * attributable. */
  const id = identifyClient(req({
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Electron/31.0.0 XENO-HUB/0.9.0',
  }));
  assert.deepEqual({ p: id?.product, v: id?.version, s: id?.source }, { p: 'hub', v: '0.9.0', s: 'user-agent' });
});

test('a leading-token Node client is identified too', () => {
  /* Observed in production: XenoCode/0.2.0, XenoHarbor/0.2.0. Neither shape is
   * privileged — Electron puts the token last, simple clients put it first. */
  assert.equal(identifyClient(req({ 'user-agent': 'XenoCode/0.2.0' }))?.product, 'agent-cli');
  assert.equal(identifyClient(req({ 'user-agent': 'XenoHarbor/0.2.0' }))?.product, 'harbor');
});

test('the explicit header wins when present', () => {
  const id = identifyClient(req({ 'x-xeno-client': 'xeno-pixel/1.2.3', 'user-agent': 'XENO-HUB/0.9.0' }));
  assert.deepEqual({ p: id.product, v: id.version, s: id.source }, { p: 'pixel', v: '1.2.3', s: 'header' });
});

test('🔴 a NON-XENO client is never identified as a product', () => {
  /* If `curl/8.4.0` or a bare `node` resolved to a product, a floor set for one
   * product would refuse every script and integration in the estate. */
  for (const ua of ['curl/8.4.0', 'node', 'python-requests/2.32.5', 'Mozilla/5.0 Chrome/126', 'python-httpx/0.28.1']) {
    assert.equal(identifyClient(req({ 'user-agent': ua })), null, `${ua} was identified as a XENO product`);
  }
});

/* ── 2 · Version comparison ──────────────────────────────────────────────── */

test('versions compare numerically, not lexically', () => {
  assert.ok(compareVersions('0.9.0', '0.11.0') < 0, '0.9.0 sorted above 0.11.0 — string comparison');
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('1.2', '1.2.0') === 0, 'missing segments should read as zero');
});

test('🔴 a prerelease sorts BELOW its release', () => {
  /* Without this a floor of "0.1.0" admits every 0.1.0-beta build it was written
   * to exclude — and betas are exactly the builds a floor is usually raised
   * against. */
  assert.ok(compareVersions('0.1.0-beta.2', '0.1.0') < 0);
  assert.ok(compareVersions('0.1.0', '0.1.0-beta.2') > 0);
  assert.ok(compareVersions('0.1.0-beta.1', '0.1.0-beta.2') < 0);
});

/* ── 3 · When it fires ───────────────────────────────────────────────────── */

test('a build below the floor is refused', () => {
  const v = evaluateClient({ product: 'hub', version: '0.9.0' }, policy({ min_supported: '0.11.0' }));
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'unsupported');
  assert.equal(v.minSupported, '0.11.0');
});

test('a build at or above the floor is served', () => {
  for (const version of ['0.11.0', '0.11.5', '1.0.0']) {
    assert.equal(evaluateClient({ product: 'hub', version }, policy({ min_supported: '0.11.0' })).ok, true);
  }
});

/* ── 4 · The ways it must NOT fire — the dangerous half ──────────────────── */

test('🔴 NO policy means NO floor', () => {
  /* The default for every product. A table that defaulted to enforcing would
   * have locked out every user of every product the moment it was added. */
  assert.equal(evaluateClient({ product: 'hub', version: '0.0.1' }, new Map()).ok, true);
  assert.ok(/min_supported\s+TEXT,/.test(migration) && !/min_supported\s+TEXT\s+NOT NULL/.test(migration),
    'min_supported is NOT NULL — every product now has a floor by default');
});

test('🔴 an UNIDENTIFIED caller is always served', () => {
  /* There is nothing to compare. Refusing would break curl, the SDKs and every
   * integration, to catch a case the account gate already covers. */
  assert.equal(evaluateClient(null, policy({ min_supported: '99.0.0' })).ok, true);
});

test('a floor with a future enforced_at is PUBLISHED, not enforced', () => {
  /* The difference between a deprecation and an outage: a policy can be
   * announced before it bites. */
  const future = new Date(Date.now() + 86_400_000);
  const v = evaluateClient({ product: 'hub', version: '0.1.0' },
    policy({ min_supported: '0.11.0', enforced_at: future.toISOString() }));
  assert.equal(v.ok, true, 'a future-dated floor is already refusing people');
});

test('min_recommended WARNS, it does not refuse', () => {
  /* "You should update" and "you may not continue" are different statements.
   * Collapsing them removes the only warning anyone gets before a floor moves. */
  const v = evaluateClient({ product: 'hub', version: '0.9.0' }, policy({ min_recommended: '0.11.0' }));
  assert.equal(v.ok, true);
  assert.equal(v.outdated, true);
});

test('🔴 the policy lookup fails OPEN', async () => {
  /* Opposite direction to the entitlement gate, deliberately. This is a
   * DEPRECATION control: if the table is unreadable, the honest response is to
   * keep serving, because the alternative is locking out everyone over a
   * database hiccup. Payment is enforced separately and fails closed. */
  invalidatePolicyCache();
  const exploding = { async query() { throw new Error('db down'); } };
  const p = await loadPolicies(exploding);
  assert.equal(p.size, 0, 'a failed policy load produced floors out of nowhere');
  assert.equal(evaluateClient({ product: 'hub', version: '0.0.1' }, p).ok, true);
});

test('the middleware fails OPEN on an unexpected throw', () => {
  const tail = mw.slice(mw.indexOf('} catch (e) {'));
  assert.ok(tail.includes('return next();'),
    'a throw in the version middleware now becomes a site-wide outage');
});

/* ── 5 · 🔴 The remedy must stay reachable ───────────────────────────────── */

test('a refused client can still reach the thing it is told to do', () => {
  /* A control that refuses an action must never also refuse the remedy it names.
   * A floor that blocked the update feed would brick the app permanently: the
   * user is told to update, the app asks where the update is, and we refuse to
   * say. */
  for (const path of ['/api/updates', '/api/downloads', '/api/client-policy', '/api/health', '/api/ready', '/api/auth/logout']) {
    assert.ok(mw.includes(`'${path}'`), `${path} is not exempt — a refused client cannot unblock itself`);
  }
  assert.ok(mw.includes('const exempt ='), 'the exemption check is gone');
});

test('the refusal NAMES the remedy', () => {
  assert.ok(mw.includes('client_upgrade_required'), 'the refusal lost its machine-readable code');
  assert.ok(mw.includes('update: `/product/${identity.product}/download`'),
    'the refusal does not tell the client where to get the new build');
  assert.ok(mw.includes('426'), 'the refusal is no longer 426 Upgrade Required');
});

/* ── 6 · Blast radius must be measurable ─────────────────────────────────── */

test('every refusal is recorded', () => {
  /* "How many people did we just lock out, and on which builds?" is unanswerable
   * at exactly the moment it is most urgent. */
  assert.ok(mw.includes('INSERT INTO client_version_refusals'), 'refusals are not recorded');
  const ins = mw.indexOf('INSERT INTO client_version_refusals');
  assert.ok(mw.slice(Math.max(0, ins - 300), ins).includes('try {'),
    'a failing audit write can now break the response');
});

test('the gate is mounted on /api only, behind the rate limiter', () => {
  const live = index.split('\n').filter((l) => !l.trim().startsWith('//'));
  const gate = live.findIndex((l) => l.includes('requireSupportedClient)'));
  const limiter = live.findIndex((l) => l.includes("app.use('/api/', globalLimiter)"));
  assert.ok(gate > -1, 'the version gate is not mounted');
  assert.ok(limiter > -1 && limiter < gate,
    'the gate runs before the rate limiter — a refused client could spend more than any other caller');
  assert.ok(!live.some((l) => /app\.use\(\s*requireSupportedClient/.test(l)),
    'the gate is mounted globally — a refused client cannot even read the marketing site');
});

test('the self-check endpoint is reachable without auth', () => {
  /* A client that has just been refused must be able to ask why and what to do,
   * including one whose auth broke because it is too old. */
  const routes = read('src/server/routes/clientPolicyRoutes.js');
  assert.ok(!routes.includes('authMiddleware'),
    'the deprecation notice requires a session — hidden from exactly the builds that need it');
});

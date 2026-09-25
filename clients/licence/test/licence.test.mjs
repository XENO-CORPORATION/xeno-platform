/**
 * @xenosystem/licence — BEHAVIOUR, against the BUILT package and a real HTTP server.
 *
 * The copied reference client was gated by grepping its own source. That could see a string,
 * never a fail direction: it would have passed a client that inverted "network error" and
 * "refusal". So every case here runs the shipped `dist/` over a real socket, including the ones
 * that must NOT lock anybody out.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const esm = await import('../dist/index.js');
const cjs = createRequire(import.meta.url)('../dist/index.cjs');

/* ── a scriptable platform ───────────────────────────────────────────────── */
let route = {};      // path -> (req) => ({ status, body }) | 'hang' | 'reset'
const seen = [];
const server = http.createServer((req, res) => {
  seen.push({ path: req.url, headers: req.headers });
  const h = route[req.url];
  const r = h ? h(req) : { status: 404, body: '<html>not here</html>', html: true };
  if (r === 'hang') return;                      // never answers: the timeout must fire
  if (r === 'reset') return req.socket.destroy(); // a dropped connection
  res.writeHead(r.status, { 'content-type': r.html ? 'text/html' : 'application/json' });
  res.end(r.html ? r.body : JSON.stringify(r.body));
});
let base;
before(async () => { await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.closeAllConnections?.(); server.close(); });

const DAY = 86_400_000;
function opts(o = {}) {
  const store = { value: o.cache ?? null, writes: 0 };
  return {
    store,
    o: {
      product: 'canvas', version: '0.40.0', apiBase: base, timeoutMs: 300,
      getToken: () => ('token' in o ? o.token : 'tok'),
      readCache: () => store.value,
      writeCache: (l) => { store.value = l; store.writes += 1; },
      ...o.extra,
    },
  };
}
const ENT = '/api/billing/entitlements';
const POLICY = '/api/client-policy';
const granted = (extra = {}) => ({ status: 200, body: { success: true, plan: 'pro', source: 'personal', entitlements: { canUse: true, canDownload: true }, product: { slug: 'canvas', access: 'paid-plan', allowed: true, reason: 'plan' }, ...extra } });
const reset = () => { route = {}; seen.length = 0; };

/* ── 1 · the verdict ─────────────────────────────────────────────────────── */

test('allowed for this product → licensed, and cached', async () => {
  reset(); route[ENT] = () => granted();
  const { o, store } = opts();
  const l = await esm.checkLicence(o);
  assert.equal(l.state, 'licensed');
  assert.equal(l.plan, 'pro');
  assert.equal(store.writes, 1, 'a verified licence was not cached — grace would never apply');
});

test('🔴 the PRODUCT verdict wins over the global canUse', async () => {
  /* A free account: canUse true (it may call our servers), Canvas refused (paid-plan). */
  reset();
  route[ENT] = () => ({ status: 200, body: { plan: 'free', entitlements: { canUse: true, canDownload: false }, product: { slug: 'canvas', access: 'paid-plan', allowed: false, reason: 'plan_required', message: 'XENO Canvas needs an active XENO plan.' } } });
  const l = await esm.checkLicence(opts().o);
  assert.equal(l.state, 'unlicensed', 'a free account opened a paid-plan product because canUse was read');
  assert.equal(l.reason, 'plan_required');
  assert.equal(l.message, 'XENO Canvas needs an active XENO plan.', 'the server\'s instruction did not reach the door');
});

test('a verdict for ANOTHER product is ignored — only this slug counts', async () => {
  reset();
  route[ENT] = () => ({ status: 200, body: { entitlements: { canUse: false }, product: { slug: 'pixel', allowed: true } } });
  assert.equal((await esm.checkLicence(opts().o)).state, 'unlicensed');
});

test('a server that predates per-product access falls back to canUse', async () => {
  reset(); route[ENT] = () => ({ status: 200, body: { plan: 'pro', entitlements: { canUse: true } } });
  assert.equal((await esm.checkLicence(opts().o)).state, 'licensed');
});

/* ── 2 · fail direction ──────────────────────────────────────────────────── */

test('🔴 an explicit 403 fails CLOSED even inside grace', async () => {
  reset(); route[ENT] = () => ({ status: 403, body: { error: 'plan_upgrade_required' } });
  const { o, store } = opts({ cache: { state: 'licensed', plan: 'pro', source: null, checkedAt: Date.now() } });
  const l = await esm.checkLicence(o);
  assert.equal(l.state, 'unlicensed', 'a refusal was given grace — a cancelled plan keeps working');
  assert.equal(store.value.state, 'unlicensed', 'the refusal was not persisted');
});

test('🔴 a network error fails OPEN within grace', async () => {
  reset(); route[ENT] = () => 'reset';
  const { o } = opts({ cache: { state: 'licensed', plan: 'pro', source: null, checkedAt: Date.now() - 3 * DAY } });
  assert.equal((await esm.checkLicence(o)).state, 'licensed', 'a dropped connection revoked a valid licence');
});

test('🔴 a hung server times out and fails OPEN within grace', async () => {
  reset(); route[ENT] = () => 'hang';
  const { o } = opts({ cache: { state: 'licensed', plan: 'pro', source: null, checkedAt: Date.now() - DAY } });
  const t0 = Date.now();
  const l = await esm.checkLicence(o);
  assert.equal(l.state, 'licensed');
  assert.ok(Date.now() - t0 < 3000, 'the timeout did not fire — a hung server hangs the app\'s door');
});

test('🔴 a 5xx is OUR outage — fails OPEN within grace', async () => {
  reset(); route[ENT] = () => ({ status: 503, body: {} });
  const { o } = opts({ cache: { state: 'licensed', plan: 'pro', source: null, checkedAt: Date.now() - DAY } });
  assert.equal((await esm.checkLicence(o)).state, 'licensed');
});

test('grace RUNS OUT — 15 days unreachable is expired-offline, not unlicensed', async () => {
  reset(); route[ENT] = () => 'reset';
  const { o } = opts({ cache: { state: 'licensed', plan: 'pro', source: null, checkedAt: Date.now() - 15 * DAY } });
  assert.equal((await esm.checkLicence(o)).state, 'expired-offline');
});

test('unreachable with nothing cached is unlicensed (never "licensed by default")', async () => {
  reset(); route[ENT] = () => 'reset';
  const l = await esm.checkLicence(opts().o);
  assert.equal(l.state, 'unlicensed');
});

/* ── 3 · update-required ─────────────────────────────────────────────────── */

test('426 from entitlements is UPDATE-REQUIRED, never unlicensed', async () => {
  reset();
  route[ENT] = () => ({ status: 426, body: { error: { code: 'client_upgrade_required', minSupported: '0.41.0', message: 'Update XENO Canvas to continue.' } } });
  const l = await esm.checkLicence(opts({ cache: { state: 'licensed', plan: 'pro', source: 'personal', checkedAt: Date.now() } }).o);
  assert.equal(l.state, 'update-required');
  assert.equal(l.minSupported, '0.41.0');
  assert.equal(l.message, 'Update XENO Canvas to continue.');
  assert.equal(l.plan, 'pro', 'update-required threw away what we know about their plan');
});

test('🔴 SIGNED OUT and below the floor → update-required, before any sign-in is offered', async () => {
  reset(); route[POLICY] = () => ({ status: 200, body: { identified: true, supported: false, minSupported: '0.41.0', message: 'Update to continue.' } });
  const l = await esm.checkLicence(opts({ token: null }).o);
  assert.equal(l.state, 'update-required', 'a too-old build was offered a sign-in the server will refuse');
  assert.equal(l.minSupported, '0.41.0');
});

test('signed out and supported → unlicensed/unauthenticated (the door shows sign-in)', async () => {
  reset(); route[POLICY] = () => ({ status: 200, body: { identified: true, supported: true } });
  const l = await esm.checkLicence(opts({ token: null }).o);
  assert.equal(l.state, 'unlicensed');
  assert.equal(l.reason, 'unauthenticated');
});

test('signed out, policy unreachable → still just asks for sign-in (no invented update)', async () => {
  reset(); route[POLICY] = () => 'reset';
  assert.equal((await esm.checkLicence(opts({ token: null }).o)).reason, 'unauthenticated');
});

test('signed out keeps grace — signing out on a plane does not stop a paid plan', async () => {
  reset(); route[POLICY] = () => ({ status: 200, body: { supported: true } });
  const { o } = opts({ token: null, cache: { state: 'licensed', plan: 'pro', source: null, checkedAt: Date.now() - DAY } });
  assert.equal((await esm.checkLicence(o)).state, 'licensed');
});

/* ── 4 · identity on the wire ────────────────────────────────────────────── */

test('every request names the product and version', async () => {
  reset(); route[ENT] = () => granted(); route[POLICY] = () => ({ status: 200, body: { supported: true } });
  await esm.checkLicence(opts().o);
  await esm.checkLicence(opts({ token: null }).o);
  assert.equal(seen.length, 2);
  for (const s of seen) {
    assert.equal(s.headers['x-xeno-client'], 'canvas/0.40.0', `${s.path} did not identify the build`);
    assert.equal(s.headers['x-xeno-surface'], 'xeno-canvas');
  }
  assert.equal(seen[0].headers.authorization, 'Bearer tok');
  assert.equal(seen[1].headers.authorization, undefined, 'the policy check leaked a token to an unauthenticated endpoint');
});

test('xenoClientHeaders is what a product puts on its OWN token requests', () => {
  assert.deepEqual(esm.xenoClientHeaders('canvas', '0.40.0'), { 'X-Xeno-Client': 'canvas/0.40.0', 'X-Xeno-Surface': 'xeno-canvas' });
});

test('🔴 the default origin is the PLATFORM, not the inference gateway', () => {
  /* api.xenostudio.ai answers /api/billing/entitlements with its own 401 and /api/client-policy
   * with an HTML 404 — measured 2026-09-25. Defaulting there read a refusal from a server that
   * never looked at the account. */
  assert.equal(esm.DEFAULT_API_BASE, 'https://xenostudio.ai');
});

/* ── 5 · it can never hurt the app it protects ───────────────────────────── */

test('throwing callbacks never escape', async () => {
  reset(); route[ENT] = () => granted();
  const boom = () => { throw new Error('disk'); };
  const l = await esm.checkLicence({ ...opts().o, readCache: boom, writeCache: boom, getToken: () => 'tok' });
  assert.equal(l.state, 'licensed');
  const l2 = await esm.checkLicence({ ...opts().o, getToken: boom, readCache: boom });
  assert.equal(typeof l2.state, 'string');
});

test('startLicence reports every result, refresh() re-checks, stop() silences it', async () => {
  reset(); route[ENT] = () => granted();
  const got = [];
  const { o } = opts();
  const handle = esm.startLicence({ ...o, onChange: (l) => got.push(l.state), intervalMs: 60_000 });
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(got, ['licensed']);
  route[ENT] = () => ({ status: 403, body: {} });
  assert.equal((await handle.refresh()).state, 'unlicensed');
  assert.deepEqual(got, ['licensed', 'unlicensed']);
  handle.stop();
  await handle.refresh();
  assert.equal(got.length, 2, 'a stopped check kept reporting');
});

test('the CJS build is the same code', async () => {
  reset(); route[ENT] = () => ({ status: 403, body: {} });
  assert.equal((await cjs.checkLicence(opts().o)).state, 'unlicensed');
  assert.equal(cjs.DEFAULT_API_BASE, esm.DEFAULT_API_BASE);
});

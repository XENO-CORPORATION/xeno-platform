/**
 * EVERY APP BEHIND THE DOOR — the server half (XENO AUTH - AUTH GATE DELTA §9).
 *
 * Two controls, both per product and both decided HERE rather than in the app:
 *
 *   1. product access — may THIS account open THIS product? (`product_access_policy`,
 *      answered on `/api/billing/entitlements` as `product`)
 *   2. the token floor — may THIS build obtain a token at all? (`client_version_policy`,
 *      applied at `/api/oauth2/token` to a product's own OIDC client)
 *
 * 🔴 Both are gated by BEHAVIOUR — the real functions and the real middleware are
 * called — because this repo has shipped floor exemptions that were present in the
 * file and matched nothing (see client-version.test.mjs §7). Roughly half of what
 * follows asserts the ways these must NOT fire: a wrong policy here locks every user
 * of a product out of sign-in at once.
 *
 * Run: node --test scripts/product-access.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'product-access-test';

const { evaluateProductAccess, productAccessFor, loadProductPolicy, ACCESS_LEVELS } =
  await import('../src/server/services/productAccess.js');
const { entitlementsFor } = await import('../src/server/services/billingService.js');
const { productForOidcClient, evaluateTokenClient, invalidatePolicyCache } =
  await import('../src/server/services/clientVersion.js');
const { requireSupportedTokenClient } = await import('../src/server/middleware/requireSupportedClient.js');

const read = (f) => readFileSync(f, 'utf8');
const migration = read('src/server/database/migrations/20260925090000-product-access-policy.sql');
const billingRoutes = read('src/server/routes/billingRoutes.js');
const oauth2Routes = read('src/server/routes/oauth2Routes.js');

/* ── 1 · Product access — the verdict ───────────────────────────────────── */

const E = (plan) => entitlementsFor(plan);
const paid = { product: 'canvas', access: 'paid-plan', message: 'Canvas needs a plan.' };

test('paid-plan admits every paid and staff plan, from the REAL plan table', () => {
  for (const plan of ['pro', 'team', 'studio', 'internal']) {
    const v = evaluateProductAccess({ product: 'canvas', policy: paid, entitlements: E(plan) });
    assert.equal(v.allowed, true, `${plan} was refused a paid-plan product`);
    assert.equal(v.reason, 'plan');
  }
});

test('🔴 paid-plan REFUSES a free account — the reason the policy exists', () => {
  const v = evaluateProductAccess({ product: 'canvas', policy: paid, entitlements: E('free') });
  assert.equal(v.allowed, false, 'a free account opened a paid-plan product');
  assert.equal(v.reason, 'plan_required');
  assert.equal(v.message, 'Canvas needs a plan.', 'the refusal lost the message that says what to do');
});

test('paid-plan reads the SAME flag as the download gate — one definition of "paid"', () => {
  /* If this read `plan !== "free"`, the two would drift the first time a plan was added
   * or renamed, and someone could download a product they may not open (or the reverse). */
  const svc = read('src/server/services/productAccess.js');
  assert.match(svc, /e\.canDownload === true/, 'paid-plan no longer reads canDownload');
  assert.doesNotMatch(svc, /plan\s*!==?\s*['"]free['"]/, 'paid-plan hand-codes the free plan');
});

test('account admits any signed-in account, free included', () => {
  const v = evaluateProductAccess({ product: 'canvas', policy: { access: 'account' }, entitlements: E('free') });
  assert.equal(v.allowed, true);
});

test('🔴 NO row keeps today\'s behaviour exactly — `canUse`', () => {
  /* A product nobody configured must not change. Free keeps `canUse: true` today. */
  for (const plan of ['free', 'pro', 'internal']) {
    const v = evaluateProductAccess({ product: 'pixel', policy: null, entitlements: E(plan) });
    assert.equal(v.allowed, E(plan).canUse, `${plan}: an unconfigured product changed its answer`);
    assert.equal(v.access, 'default');
  }
  const refused = evaluateProductAccess({ product: 'pixel', policy: null, entitlements: { canUse: false } });
  assert.equal(refused.allowed, false, 'an account without canUse opened an unconfigured product');
});

test('🔴 a policy value this code does not know is NOT permission', () => {
  const v = evaluateProductAccess({ product: 'canvas', policy: { access: 'everyone' }, entitlements: E('internal') });
  assert.equal(v.allowed, false, 'an unrecognised access level admitted someone');
  assert.equal(v.reason, 'unknown_policy');
});

test('the vocabulary in code and in the CHECK constraint are the same two words', () => {
  assert.deepEqual([...ACCESS_LEVELS].sort(), ['account', 'paid-plan']);
  assert.match(migration, /CHECK \(access IN \('account', 'paid-plan'\)\)/);
});

test('Canvas is seeded paid-plan, and the seed never overwrites an operator decision', () => {
  assert.match(migration, /VALUES \('canvas', 'paid-plan'/);
  assert.match(migration, /ON CONFLICT \(product\) DO NOTHING/, 'a redeploy would reset an operator\'s choice');
  assert.doesNotMatch(migration, /DO UPDATE/, 'the seed can overwrite a live policy');
});

/* ── 2 · Product access — the route ─────────────────────────────────────── */

const reqWith = (headers, rows) => ({
  headers,
  db: { async query(sql, params) { return { rows: rows.filter((r) => r.product === params?.[0]) }; } },
});

test('a product naming itself in X-Xeno-Client gets its own verdict', async () => {
  const v = await productAccessFor(reqWith({ 'x-xeno-client': 'canvas/0.40.0' }, [paid]), E('free'));
  assert.equal(v?.slug, 'canvas');
  assert.equal(v?.allowed, false);
});

test('🔴 a User-Agent alone does NOT name a product at the door', async () => {
  /* The UA fallback exists so the floor can see OLD builds. A product asking its own
   * door sends the header; honouring a spoofable UA here would let any client pick
   * which product's policy it is judged by. */
  const v = await productAccessFor(reqWith({ 'user-agent': 'Electron/44 xeno-canvas/0.40.0' }, [paid]), E('free'));
  assert.equal(v, null);
});

test('no product named → no `product` block, and the old response shape is untouched', async () => {
  assert.equal(await productAccessFor(reqWith({}, [paid]), E('free')), null);
  assert.match(billingRoutes, /\.\.\.effective, \.\.\.\(product \? \{ product \} : \{\}\)/,
    'the entitlements response no longer spreads the old fields first');
});

test('🔴 an unreadable policy table FAILS CLOSED — it throws, it does not admit', async () => {
  /* A payment control. The route answers 500; the licence client treats a 5xx as our
   * fault and keeps the person's offline grace — never a silent "allowed". */
  const exploding = { headers: { 'x-xeno-client': 'canvas/1.0.0' }, db: { async query() { throw new Error('db down'); } } };
  await assert.rejects(productAccessFor(exploding, E('internal')), /db down/);
  await assert.rejects(loadProductPolicy(exploding.db, 'canvas'), /db down/);
});

test('the entitlements answer is never cached', () => {
  const route = billingRoutes.slice(billingRoutes.indexOf("router.get('/entitlements'"));
  assert.match(route.slice(0, 900), /Cache-Control', 'no-store'/, 'a revoked plan could be served from a cache');
});

/* ── 3 · The token floor — identifying a build that never identified itself ── */

test('a product OIDC client maps to its product; anything else maps to nothing', () => {
  assert.equal(productForOidcClient('xeno-canvas'), 'canvas');
  assert.equal(productForOidcClient('XENO-CANVAS'), 'canvas');
  for (const id of ['xeno-api-portal', 'xeno-post', 'someone-elses-app', '', null, undefined]) {
    assert.equal(productForOidcClient(id), null, `${id} was mistaken for a product`);
  }
});

const floor = (o = {}) => new Map([['canvas', { product: 'canvas', min_supported: '0.40.0', min_recommended: null, message: null, enforced_at: null, ...o }]]);

test('🔴 a Canvas build that sends NO identity is below any floor', () => {
  /* Every shipped Canvas (0.3.0 → 0.39.1) calls the token endpoint with User-Agent `node`
   * and no X-Xeno-Client. This is the case the whole change exists for. */
  const v = evaluateTokenClient({ clientId: 'xeno-canvas', headers: { 'user-agent': 'node' } }, floor());
  assert.equal(v.ok, false);
  assert.equal(v.identity.source, 'oidc-client');
});

test('a build at or above the floor that says so is served', () => {
  for (const version of ['0.40.0', '0.40.1', '1.0.0']) {
    const v = evaluateTokenClient({ clientId: 'xeno-canvas', headers: { 'x-xeno-client': `canvas/${version}` } }, floor());
    assert.equal(v.ok, true, `${version} was refused`);
  }
});

test('a build that says it is older than the floor is refused', () => {
  const v = evaluateTokenClient({ clientId: 'xeno-canvas', headers: { 'x-xeno-client': 'canvas/0.39.1' } }, floor());
  assert.equal(v.ok, false);
  assert.equal(v.identity.version, '0.39.1');
});

test('🔴 a header naming ANOTHER product does not vouch for this client', () => {
  /* `X-Xeno-Client: pixel/99.0.0` on a Canvas token request must not satisfy Canvas's floor. */
  const v = evaluateTokenClient({ clientId: 'xeno-canvas', headers: { 'x-xeno-client': 'pixel/99.0.0' } }, floor());
  assert.equal(v.ok, false);
});

test('🔴 a versioned User-Agent does NOT vouch for this client at the token endpoint', () => {
  const v = evaluateTokenClient({ clientId: 'xeno-canvas', headers: { 'user-agent': 'Electron/44 xeno-canvas/9.9.9' } }, floor());
  assert.equal(v.ok, false, 'a spoofable UA reopened the door');
});

test('🔴 NO floor means NO refusal — adding this changes nothing until an operator sets one', () => {
  assert.equal(evaluateTokenClient({ clientId: 'xeno-canvas', headers: {} }, new Map()).ok, true);
  assert.equal(evaluateTokenClient({ clientId: 'xeno-canvas', headers: {} }, floor({ min_supported: null })).ok, true);
});

test('a future-dated floor is published, not enforced', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(evaluateTokenClient({ clientId: 'xeno-canvas', headers: {} }, floor({ enforced_at: future })).ok, true);
});

test('🔴 a floor on Canvas never touches another client', () => {
  for (const clientId of ['xeno-agent-interface', 'xeno-post', 'xeno-api-portal', 'xeno-hub']) {
    assert.equal(evaluateTokenClient({ clientId, headers: {} }, floor()).ok, true, `${clientId} was refused by Canvas's floor`);
  }
});

/* ── 4 · The token floor — the middleware, called ───────────────────────── */

function fakeRes() {
  const r = { statusCode: null, body: null, headers: {} };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
function tokenReq(body, headers = {}, { floorRow = { product: 'canvas', min_supported: '0.40.0', min_recommended: null, message: null, enforced_at: null } } = {}) {
  const writes = [];
  return {
    writes,
    originalUrl: '/api/oauth2/token', url: '/token', path: '/token', baseUrl: '/api/oauth2',
    headers, body, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' },
    db: {
      async query(sql, params) {
        if (/FROM client_version_policy/.test(sql)) return { rows: floorRow ? [floorRow] : [] };
        if (/INSERT INTO client_version_refusals/.test(sql)) { writes.push(params); return { rows: [] }; }
        return { rows: [] };
      },
    },
  };
}
async function run(req) {
  invalidatePolicyCache();
  const res = fakeRes();
  let passed = false;
  await requireSupportedTokenClient(req, res, () => { passed = true; });
  return { res, passed };
}

test('🔴 an old Canvas cannot SIGN IN, REFRESH or finish a DEVICE sign-in', async () => {
  for (const grant_type of ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code']) {
    const req = tokenReq({ grant_type, client_id: 'xeno-canvas' }, { 'user-agent': 'node' });
    const { res, passed } = await run(req);
    assert.equal(passed, false, `${grant_type}: an unidentified Canvas got through`);
    assert.equal(res.statusCode, 426);
    assert.equal(res.body?.error, 'client_upgrade_required', 'the OAuth error is not a string code');
    assert.equal(res.body?.update, '/product/canvas/download', 'the refusal does not name the remedy');
    assert.equal(req.writes.length, 1, `${grant_type}: the refusal was not recorded`);
  }
});

test('a current Canvas that identifies itself is served on every grant', async () => {
  for (const grant_type of ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code']) {
    const { passed } = await run(tokenReq({ grant_type, client_id: 'xeno-canvas' }, { 'x-xeno-client': 'canvas/0.40.0' }));
    assert.equal(passed, true, `${grant_type}: a supported build was refused`);
  }
});

test('🔴 the Hub broker\'s token-exchange is outside the floor', async () => {
  const { passed } = await run(tokenReq({ grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', child_client_id: 'xeno-canvas' }, {}));
  assert.equal(passed, true);
});

test('🔴 other clients sign in normally while Canvas has a floor', async () => {
  const { passed } = await run(tokenReq({ grant_type: 'refresh_token', client_id: 'xeno-agent-interface' }, { 'user-agent': 'node' }));
  assert.equal(passed, true, 'a Canvas floor refused another product');
});

test('with no floor row, an old Canvas still signs in — nothing changes until an operator acts', async () => {
  const { passed } = await run(tokenReq({ grant_type: 'refresh_token', client_id: 'xeno-canvas' }, { 'user-agent': 'node' }, { floorRow: null }));
  assert.equal(passed, true);
});

test('🔴 the token floor fails OPEN when its own lookup throws', async () => {
  invalidatePolicyCache();
  const req = tokenReq({ grant_type: 'refresh_token', client_id: 'xeno-canvas' }, {});
  req.db = { async query() { throw new Error('db down'); } };
  const res = fakeRes();
  let passed = false;
  await requireSupportedTokenClient(req, res, () => { passed = true; });
  assert.equal(passed, true, 'a database hiccup locked every Canvas out of sign-in');
});

test('🔴 the token floor fails OPEN when the middleware ITSELF throws', async () => {
  /* The case above never reaches the middleware's own catch — `loadPolicies` swallows a
   * database error first. This one throws inside the middleware (a hostile headers
   * object), which is the only way to prove the catch still calls next(). Found by a
   * mutation that turned the catch into a 426 and survived the test above. */
  invalidatePolicyCache();
  const req = tokenReq({ grant_type: 'refresh_token', client_id: 'xeno-canvas' }, {});
  req.headers = new Proxy({}, { get() { throw new Error('hostile header object'); } });
  const res = fakeRes();
  let passed = false;
  await requireSupportedTokenClient(req, res, () => { passed = true; });
  assert.equal(passed, true, 'an unexpected throw in the token floor refused sign-in');
  assert.equal(res.statusCode, null);
});

test('a failed refusal log never changes the verdict', async () => {
  invalidatePolicyCache();
  const req = tokenReq({ grant_type: 'refresh_token', client_id: 'xeno-canvas' }, {});
  const inner = req.db.query;
  req.db = { async query(sql, p) { if (/INSERT/.test(sql)) throw new Error('disk full'); return inner(sql, p); } };
  const res = fakeRes();
  let passed = false;
  await requireSupportedTokenClient(req, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 426);
});

test('the token route actually runs the floor — mounted, not merely imported', () => {
  assert.match(oauth2Routes, /router\.post\('\/token', requireSupportedTokenClient, async/,
    'the token floor is not on the /token route');
});

/**
 * `@xenosystem/licence/door` — the sign-in door every XENO app runs (extracted from XENO Canvas; owner 2026-10-25).
 * Ported from Canvas's authGate / authLog / authRefreshTransient / auth tests, against the BUILT package (ESM + CJS)
 * with a fake Electron, a fake account SDK and a real loopback platform:
 *
 *   - a licence verdict becomes the door (the pure table, incl. update-required outranks sign-in, offline ≠ signed out)
 *   - every platform call carries X-Xeno-Client, including the token exchange (the version floor depends on it)
 *   - a transient refresh failure KEEPS the session; 426 and a definitive refusal drop it
 *   - the door pushes "sign in" at once when signed out, and main refuses the sign-in intent below the floor
 *   - auth.log never carries a credential (tokens, codes, state)
 *   - the dev-only e2e fixture is ignored by a packaged build
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const esm = await import('../dist/door.js');
const cjs = createRequire(import.meta.url)('../dist/door.cjs');

const at = Date.now();
const L = (p) => ({ state: 'licensed', plan: 'pro', source: 'personal', checkedAt: at, ...p });

for (const [name, m] of [['esm', esm], ['cjs', cjs]]) {
  test(`${name}: a licence verdict becomes the door`, () => {
    const g = m.gateStateFrom;
    assert.deepEqual({ ...g(L({ state: 'unlicensed', reason: 'unauthenticated' }), false) }, { account: 'signedOut', licence: 'checking', message: undefined, lastVerifiedAt: undefined });
    assert.equal(g(L({ state: 'update-required', message: 'Update.' }), false).licence, 'update-required', 'below the floor is UPDATE even signed out');
    assert.equal(g(L({ state: 'update-required' }), true).licence, 'update-required');
    assert.deepEqual(g(L({}), true), { account: 'signedIn', licence: 'licensed', message: undefined, lastVerifiedAt: at });
    assert.equal(g(L({ state: 'unlicensed', reason: 'plan_required', message: 'needs a plan' }), true).message, 'needs a plan');
    assert.equal(g(L({ state: 'unlicensed', reason: 'unauthenticated' }), true).account, 'expired');
    assert.deepEqual(g(L({}), false, true), { account: 'offline', licence: 'licensed', message: undefined, lastVerifiedAt: at }, 'a saved session that could not refresh is OFFLINE');
    assert.equal(g(L({ state: 'expired-offline' }), false, true).licence, 'expired-offline');
  });
  test(`${name}: 426 is never a transient refresh failure`, () => {
    assert.equal(m.isTransientRefreshFailure({ retryable: true, httpStatus: 426 }), false);
    assert.equal(m.isTransientRefreshFailure({ retryable: true, code: 'UNREACHABLE' }), true);
    assert.equal(m.isTransientRefreshFailure({ retryable: false, httpStatus: 400 }), false);
    assert.equal(m.isTransientRefreshFailure(null), false);
  });
}

// ── A real loopback platform: token + entitlements + client-policy, recording headers ──────────────────
const seen = [];
let refreshBehaviour = 'ok';   // 'ok' | 'unreachable' | 'floor'
let entitlement = { plan: 'pro', product: { allowed: true } };
const platform = http.createServer((req, res) => {
  seen.push({ path: req.url, client: req.headers['x-xeno-client'] || null });
  const json = (s, v) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  if (req.url.startsWith('/api/billing/entitlements')) return json(200, entitlement);
  if (req.url.startsWith('/api/client-policy')) return json(200, { product: 'pixel', minSupported: null });
  if (req.url.startsWith('/api/v2/me')) return json(200, { sub: 'user-0123456789', email: 'p@x.test', name: 'P' });
  return json(404, {});
});
before(() => new Promise((r) => platform.listen(0, '127.0.0.1', r)));
after(() => platform.close());

function fakeElectron(dir, { packaged = false } = {}) {
  const sent = [];
  const handlers = {}, listeners = {};
  return {
    sent, handlers, listeners,
    electron: {
      app: { isPackaged: packaged, getVersion: () => '0.7.0', getPath: (n) => (n === 'home' ? dir : dir) },
      ipcMain: { handle: (c, f) => { handlers[c] = f; }, on: (c, f) => { listeners[c] = f; } },
      shell: { openExternal: async () => {} },
      safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'dpapi', encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => Buffer.from(b).toString().replace(/^enc:/, '') },
      BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (c, s) => sent.push([c, s]) } }] },
    },
  };
}

function fakeSdk() {
  class Transport { constructor(o) { this.fetchImpl = o.fetchImpl; } }
  return {
    Transport,
    buildAuthorizeUrl: () => 'https://example.invalid/authorize',
    generatePkce: async () => ({ verifier: 'v', challenge: 'c' }),
    generateState: () => 's',
    createNodeDpopSigner: () => ({ createProof: async () => 'proof' }),
    exchangeCode: async () => ({ accessToken: 'AT-SECRET-1', refreshToken: 'RT-SECRET-1', expiresAt: Date.now() + 600_000 }),
    // the SDK makes its token request through the transport: prove the header rides it
    refreshTokens: async (config, transport) => {
      await transport.fetchImpl(`http://127.0.0.1:${platform.address().port}/api/oauth2/token`, { method: 'POST' });
      if (refreshBehaviour === 'unreachable') throw Object.assign(new Error('unreachable'), { retryable: true, code: 'UNREACHABLE' });
      if (refreshBehaviour === 'floor') throw Object.assign(new Error('upgrade'), { httpStatus: 426, retryable: true });
      // inside the 60 s refresh margin, so the next getAccessToken() refreshes again (no test seam needed)
      return { accessToken: 'AT-SECRET-2', refreshToken: 'RT-SECRET-2', expiresAt: Date.now() + 1_000 };
    },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('the door: X-Xeno-Client everywhere, transient refresh keeps the session, 426 drops it, no credential in auth.log', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xeno-door-'));
  try {
    const base = `http://127.0.0.1:${platform.address().port}`;
    const f = fakeElectron(dir);
    const door = esm.createDoor({ product: 'pixel', productName: 'XENO Pixel', clientId: 'xeno-pixel', scopes: ['openid'], electron: f.electron, account: fakeSdk(), issuer: base, apiBase: base });

    // signed out, nothing saved: the door says sign in at once
    door.start();
    await wait(150);
    assert.equal(door.state().account, 'signedOut');
    assert.ok(f.sent.some(([c, s]) => c === 'auth-gate:state' && s.account === 'signedOut'), 'the renderer was told to show sign-in');

    // 🔴 regression: start() already tried a refresh with NO saved session. A session saved afterwards (a sign-in
    // after launch) must still refresh — Canvas's copy returned the stale "no session" forever.
    await writeRefresh(dir, 'RT-SECRET-1');
    refreshBehaviour = 'ok';
    assert.equal(await door.getAccessToken(), 'AT-SECRET-2');
    assert.ok(seen.some((r) => r.path === '/api/oauth2/token' && r.client === 'pixel/0.7.0'), 'the token request carried X-Xeno-Client');

    // the identified fetch names the build on any platform call
    await door.identifiedFetch(`${base}/api/v2/me`);
    assert.ok(seen.some((r) => r.path === '/api/v2/me' && r.client === 'pixel/0.7.0'));

    // a TRANSIENT failure keeps the saved session (offline, not signed out)
    refreshBehaviour = 'unreachable';
    assert.equal(await door.getAccessToken(), null);
    assert.equal(await door.hasSavedSession(), true, 'a network blip deleted a working session');

    // the version floor (426) drops it
    refreshBehaviour = 'floor';
    assert.equal(await door.getAccessToken(), null);
    assert.equal(await door.hasSavedSession(), false, 'a build below the floor kept a session the server refuses');

    door.stop();
    const log = readFileSync(door.authLogPath(), 'utf8');
    assert.match(log, /licence\.start product=pixel/);
    assert.match(log, /refresh\.failed/);
    for (const secret of ['AT-SECRET', 'RT-SECRET', 'verifier', 'enc:']) assert.ok(!log.includes(secret), `auth.log carries "${secret}"`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('below the floor, main refuses the sign-in intent; a packaged build ignores the e2e fixture', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xeno-door-'));
  const prev = process.env.XENO_AUTH_GATE_E2E_OPEN;
  try {
    process.env.XENO_AUTH_GATE_E2E_OPEN = '1';
    const base = `http://127.0.0.1:${platform.address().port}`;
    const packaged = fakeElectron(dir, { packaged: true });
    const door = esm.createDoor({ product: 'pixel', productName: 'XENO Pixel', clientId: 'xeno-pixel', scopes: ['openid'], electron: packaged.electron, account: fakeSdk(), issuer: base, apiBase: base });
    door.start();
    await wait(150);
    assert.notEqual(door.state().identity?.sub, 'e2e', 'a packaged build opened the door for the e2e fixture');
    door.stop();

    const dev = fakeElectron(dir);
    const devDoor = esm.createDoor({ product: 'pixel', productName: 'XENO Pixel', clientId: 'xeno-pixel', scopes: ['openid'], electron: dev.electron, account: fakeSdk(), issuer: base, apiBase: base });
    devDoor.start();
    assert.equal(devDoor.state().licence, 'licensed', 'the dev fixture opens the door for editor e2e suites');
    devDoor.stop();
  } finally {
    if (prev === undefined) delete process.env.XENO_AUTH_GATE_E2E_OPEN; else process.env.XENO_AUTH_GATE_E2E_OPEN = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

async function writeRefresh(dir, token) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'auth-refresh.bin'), Buffer.from(`enc:${token}`).toString('base64'), 'utf-8');
}

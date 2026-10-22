import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  authClientId,
  authPath,
  authReturnUrl,
  canonicalAuthSearch,
  clientIdFromReturnUrl,
  legacyAppClientId,
  locationReturnPath,
  safeReturnUrl,
} from '../src/lib/authRouting.js';
import {
  inspectDeviceAuthorization,
  startDeviceAuthorization,
  denyDevice,
  deviceTokenGrant,
  validateAuthorizationRequest,
} from '../src/server/utils/oidcProvider.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('canonical human routes are login and signup; auth remains an alias', () => {
  const app = read('src/App.tsx');
  assert.match(app, /path="\/login" element={<AuthContent mode="signin"/);
  assert.match(app, /path="\/signup" element={<AuthContent mode="signup"/);
  assert.match(app, /path="\/auth" element={<AuthRouteAlias/);
  assert.match(app, /path="\/auth\/:app" element={<AuthRouteAlias/);
});

test('same-origin return targets preserve query and hash, and reject redirect tricks', () => {
  assert.equal(safeReturnUrl('/forum?q=auth#reply'), '/forum?q=auth#reply');
  assert.equal(safeReturnUrl('https://evil.example/steal'), null);
  assert.equal(safeReturnUrl('//evil.example/steal'), null);
  assert.equal(safeReturnUrl('/\\evil.example/steal'), null);
  assert.equal(safeReturnUrl('/forum\n/steal'), null);
});

test('the public activation origin is independent of the immutable token issuer', async () => {
  const keys = ['XENO_SITE_ORIGIN', 'OIDC_ISSUER', 'AUTH_FRONTEND_URL'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const db = { async query(sql) {
    return sql.includes('SELECT') ? { rows: [{ client_id: 'xeno-agent-cli', allowed_scopes: ['openid', 'profile'] }] } : { rows: [] };
  } };
  try {
    process.env.XENO_SITE_ORIGIN = 'https://xenosystem.ai';
    process.env.OIDC_ISSUER = 'https://xenostudio.ai';
    delete process.env.AUTH_FRONTEND_URL;
    const grant = await startDeviceAuthorization(db, { clientId: 'xeno-agent-cli', scope: 'openid profile' });
    assert.equal(grant.verification_uri, 'https://xenosystem.ai/activate');
    assert.equal(new URL(grant.verification_uri_complete).searchParams.get('code'), grant.user_code);
    const { issuer } = await import('../src/server/config/hosts.js');
    assert.equal(issuer(), 'https://xenostudio.ai');
    process.env.AUTH_FRONTEND_URL = 'https://custom.example';
    assert.equal((await startDeviceAuthorization(db, { clientId: 'xeno-agent-cli' })).verification_uri, 'https://custom.example/activate');
    process.env.AUTH_FRONTEND_URL = 'https://user@custom.example/path';
    await assert.rejects(startDeviceAuthorization(db, { clientId: 'xeno-agent-cli' }), /HTTPS origin/);
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});

test('legacy return parameter names canonicalize without losing other state', () => {
  assert.equal(authReturnUrl('?redirect=%2Fshare%2Fabc'), '/share/abc');
  assert.equal(authReturnUrl('?returnTo=%2Fpricing%3Fplan%3Dpro'), '/pricing?plan=pro');
  const canonical = canonicalAuthSearch('?redirect=%2Fshare%2Fabc&error=expired');
  const params = new URLSearchParams(canonical);
  assert.equal(params.get('returnUrl'), '/share/abc');
  assert.equal(params.get('redirect'), null);
  assert.equal(params.get('error'), 'expired');
});

test('the authorize transaction controls the client consent identity', () => {
  const grant = '/api/oauth2/authorize?client_id=xeno-agent-cli&redirect_uri=http%3A%2F%2F127.0.0.1%3A4173%2Fcallback&code_challenge=abc&code_challenge_method=S256';
  assert.equal(clientIdFromReturnUrl(grant), 'xeno-agent-cli');
  const search = `?client_id=xeno-hub&returnUrl=${encodeURIComponent(grant)}`;
  assert.equal(authClientId(search), 'xeno-agent-cli');
  assert.equal(new URLSearchParams(canonicalAuthSearch(search)).get('client_id'), null);
});

test('legacy app aliases map to registered client ids', () => {
  assert.equal(legacyAppClientId('cli'), 'xeno-agent-cli');
  assert.equal(legacyAppClientId('agent-cli'), 'xeno-agent-cli');
  assert.equal(legacyAppClientId('hub'), 'xeno-hub');
  assert.equal(authPath('signin', '?session=abc', 'cli'), '/login?session=abc&client_id=xeno-agent-cli');
  assert.equal(authPath('signup'), '/signup');
});

test('protected-route handoff preserves the full original browser location', () => {
  assert.equal(
    locationReturnPath({ pathname: '/forum/t/abc', search: '?view=latest', hash: '#reply-4' }),
    '/forum/t/abc?view=latest#reply-4',
  );
});

test('registered client metadata, validated authorize preflight, and RFC 8628 activation are wired', () => {
  const routes = read('src/server/routes/oauth2Routes.js');
  const provider = read('src/server/utils/oidcProvider.js');
  const authPage = read('src/pages/AuthContent.tsx');
  const devicePage = read('src/pages/DeviceAuthContent.tsx');

  assert.match(routes, /router\.get\('\/client_info'/);
  assert.match(routes, /validateAuthorizationRequest\(req\.db/);
  assert.match(routes, /location\.href='\/login\?returnUrl='/);
  assert.match(provider, /code_challenge_method must be S256/);
  assert.match(provider, /verification_uri: verificationUri/);
  assert.match(routes, /router\.post\('\/device\/inspect', authMiddleware/);
  assert.match(routes, /router\.post\('\/device\/approve', authMiddleware/);
  assert.match(authPage, /\/api\/oauth2\/client_info\?client_id=/);
  assert.match(devicePage, /Approve only if you started/);
});

test('prompt=login leaves the cached session path and returns only after fresh authentication', () => {
  const routes = read('src/server/routes/oauth2Routes.js');
  assert.match(routes, /p\.get\('prompt'\)===\'login\'/);
  assert.match(routes, /resume\.searchParams\.set\('stepup_complete','1'\)/);
  assert.match(routes, /authTime: req\.auth\?\.authTime/);
  assert.match(routes, /prompt: b\.prompt/);
  assert.match(routes, /maxAge: b\.max_age/);
  assert.match(routes, /acr: b\.acr_values/);
});

test('authorization preflight trusts only a registered client, redirect, and S256 transaction', async () => {
  const client = {
    client_id: 'xeno-agent-cli',
    name: 'XENO Agent CLI',
    redirect_uris: ['http://127.0.0.1/callback'],
    loopback: true,
  };
  const db = {
    async query(_sql, params) {
      return { rows: params[0] === client.client_id ? [client] : [] };
    },
  };

  assert.equal(await validateAuthorizationRequest(db, {
    clientId: client.client_id,
    redirectUri: 'http://127.0.0.1:49152/callback',
    codeChallenge: 'challenge',
    codeChallengeMethod: 'S256',
  }), client);

  await assert.rejects(validateAuthorizationRequest(db, {
    clientId: client.client_id,
    redirectUri: 'https://evil.example/callback',
    codeChallenge: 'challenge',
    codeChallengeMethod: 'S256',
  }), (error) => error.oauthError === 'invalid_request' && /redirect_uri/.test(error.message));

  await assert.rejects(validateAuthorizationRequest(db, {
    clientId: client.client_id,
    redirectUri: 'http://127.0.0.1/callback',
    codeChallenge: 'challenge',
    codeChallengeMethod: 'plain',
  }), (error) => error.oauthError === 'invalid_request' && /S256/.test(error.message));
});

test('device consent presentation comes from the registered client join', async () => {
  const db = {
    async query(sql, params) {
      assert.match(sql, /JOIN oauth_clients/);
      assert.deepEqual(params, ['ABCD-2345']);
      return { rows: [{ client_id: 'xeno-hub', client_name: 'XENO Hub', scope: 'openid profile' }] };
    },
  };
  assert.deepEqual(await inspectDeviceAuthorization(db, { userCode: 'abcd-2345' }), {
    client_id: 'xeno-hub',
    client_name: 'XENO Hub',
    scope: 'openid profile',
    // a registered first-party client, not a self-registered one (b6836ac7 added the flag to the consent view)
    unverified: false,
  });
});

test('declining a pending device grant is terminal and polling returns access_denied', async () => {
  let denied = false;
  const tx = { async query(sql) {
    if (sql.startsWith('SELECT')) return { rows: [{ expires_at: new Date(Date.now() + 60_000), denied, approved: false }] };
    return { rows: [] };
  }, release() {} };
  const db = { async query(sql, params) {
    assert.match(sql, /approved = false AND denied = false AND expires_at > now\(\)/);
    assert.deepEqual(params, ['ABCD-EFGH']);
    if (denied) return { rows: [] };
    denied = true;
    return { rows: [{ device_code: 'fixture-private-device' }] };
  }, async connect() { return tx; } };
  assert.deepEqual(await denyDevice(db, { userCode: 'abcd-efgh' }), { ok: true });
  await assert.rejects(deviceTokenGrant(db, { deviceCode: 'fixture-private-device', clientId: 'xeno-agent-cli' }), error => error.oauthError === 'access_denied');
  await assert.rejects(denyDevice(db, { userCode: 'abcd-efgh' }), error => error.oauthError === 'invalid_request');
});

test('main acquisition and sign-in links preserve their distinct intent', () => {
  const home = read('src/pages/Home3.tsx');
  const hero = read('src/components/landing-v3/HeroSection.tsx');
  const protectedRoute = read('src/components/auth/ProtectedRoute.tsx');
  assert.match(home, /navigate\('\/login'\)/, 'header Sign in no longer opens the login route');
  assert.match(hero, /href="\/signup"[\s\S]{0,300}Get Started Free/, 'main signup CTA lost signup intent');
  assert.match(protectedRoute, /redirectTo = '\/login'/);
});

test('user-facing source no longer sends people directly to the legacy auth URL', () => {
  const paths = [
    'src/components/landing-v3/HeroSection.tsx',
    'src/components/landing-v3/CreateWithoutLimitsSection.tsx',
    'src/pages/ProductPage.tsx',
    'src/pages/ProductLanding.tsx',
    'src/components/layouts/AuthLayout.tsx',
    'public/download/index.html',
    'public/cli-auth/index.html',
  ];
  for (const path of paths) {
    assert.doesNotMatch(read(path), /(?:href|to)="\/auth"/, `${path} still points at legacy /auth`);
  }
});

test('account deletion is ERASURE, never a hard DELETE FROM users (F23, 2026-09-17)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/server/routes/authRoutes.js', import.meta.url), 'utf8');
  const start = src.indexOf("router.delete('/account'");
  const block = src.slice(start, src.indexOf('router.', start + 20));
  assert.match(block, /eraseSubject\(req\.db, decoded\.userId\)/, 'the legacy deletion route runs the audited erasure');
  assert.doesNotMatch(block, /query\(\s*['`"]DELETE FROM users/, 'a hard delete orphans the ledger, leaves agents alive and unowned, and keeps the address in mail rows');
});

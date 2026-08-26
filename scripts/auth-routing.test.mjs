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
  assert.match(provider, /verification_uri: `\$\{iss\}\/activate`/);
  assert.match(routes, /router\.post\('\/device\/inspect', authMiddleware/);
  assert.match(routes, /router\.post\('\/device\/approve', authMiddleware/);
  assert.match(authPage, /\/api\/oauth2\/client_info\?client_id=/);
  assert.match(devicePage, /Approve only if you started/);
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
  });
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
    'src/components/landing-v2/Header.tsx',
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

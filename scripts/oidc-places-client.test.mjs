import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient } from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';
import { validateAuthorizationRequest } from '../src/server/utils/oidcProvider.js';
import { productForOidcClient } from '../src/server/services/clientVersion.js';
import { pathScopedOriginAllowed } from '../src/server/config/hosts.js';

// XENO Places: a static browser SPA at places.xenosystem.ai. Public client (no secret), PKCE-S256, one exact redirect,
// the smallest authority /api/places needs, and CORS for its origin on its own paths only.
const CB = ['https://places.xenosystem.ai/auth/callback'];
const ORIGIN = 'https://places.xenosystem.ai';
const client = FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-places');
const row = { client_id: 'xeno-places', loopback: false, redirect_uris: redirectsForClient(client), allowed_scopes: scopesForClient('xeno-places') };
const db = { query: async () => ({ rows: [row] }) };
const authorize = (redirectUri, method = 'S256') => validateAuthorizationRequest(db, {
  clientId: 'xeno-places', redirectUri, codeChallenge: 'challenge', codeChallengeMethod: method,
});

test('xeno-places is a public web client with ONE exact-match redirect', () => {
  assert.ok(client, 'xeno-places is not seeded');
  assert.equal(client.loopback, false);
  assert.equal(client.secret, undefined, 'a public client must not be seeded a secret');
  assert.deepEqual(redirectsForClient(client), CB);
});

test('the seed upserts it with a NULL secret, its redirect and its authority', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const r = calls.find((q) => q.params?.[0] === 'xeno-places');
  assert.ok(r, 'migration never upserted xeno-places');
  assert.match(r.sql, /VALUES \(\$1, NULL, \$2/);
  assert.deepEqual(r.params[2], CB);
  assert.deepEqual(r.params[3], scopesForClient('xeno-places'));
  assert.equal(r.params[5], false);
});

test('authority is identity + workforce:read, and nothing that spends or bills', () => {
  assert.deepEqual(scopesForClient('xeno-places'), ['openid', 'profile', 'email', 'workforce:read']);
});

test('accepts exactly its callback with S256, nothing near it, and never plain PKCE', async () => {
  await assert.doesNotReject(authorize(CB[0]));
  for (const uri of ['http://places.xenosystem.ai/auth/callback', 'https://places.xenosystem.ai/auth/callback/x',
    'https://places.xenosystem.ai.evil.example/auth/callback', 'http://localhost:5173/auth/callback']) {
    await assert.rejects(authorize(uri), /redirect_uri mismatch/, uri);
  }
  await assert.rejects(authorize(CB[0], 'plain'));
});

test('the version floor reaches it as product "places"', () => {
  assert.equal(productForOidcClient('xeno-places'), 'places');
});

test('CORS: the Places origin is allowed on /api/oauth2 and /api/places only', () => {
  for (const p of ['/api/oauth2/token', '/api/oauth2/userinfo', '/api/places', '/api/places/ops/places.list', '/api/places?x=1']) {
    assert.equal(pathScopedOriginAllowed(ORIGIN, p), true, p);
  }
  for (const p of ['/api/auth/me', '/api/billing/checkout', '/api/placesX', '/api/oauth2x', '/', '/api/library']) {
    assert.equal(pathScopedOriginAllowed(ORIGIN, p), false, p);
  }
  assert.equal(pathScopedOriginAllowed('https://evil.example', '/api/places'), false);
  const index = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
  assert.match(index, /pathScopedOriginAllowed\(origin, req\.originalUrl\)/, 'the CORS gate must consult the path-scoped list');
});

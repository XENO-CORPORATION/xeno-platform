import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient, assertLoopbackRedirects,
} from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';
import { validateAuthorizationRequest } from '../src/server/utils/oidcProvider.js';
import { productForOidcClient } from '../src/server/services/clientVersion.js';

const SPAWN_CB = ['http://127.0.0.1/auth/callback', 'http://[::1]/auth/callback'];
const spawn = () => FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-spawn');
const db = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });
const authorize = (row, redirectUri) => validateAuthorizationRequest(db(row), {
  clientId: row.client_id, redirectUri, codeChallenge: 'challenge', codeChallengeMethod: 'S256',
});

test('xeno-spawn is a first-party public loopback client registered at /auth/callback', () => {
  const c = spawn();
  assert.ok(c, 'xeno-spawn is not seeded');
  assert.equal(c.loopback, true);
  assert.equal(c.secret, undefined, 'a public client must not be seeded a secret');
  assert.deepEqual(redirectsForClient(c), SPAWN_CB);
});

test('the seed writes the spawn row with its own loopback paths, not the /callback default', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const row = calls.find((q) => q.params?.[0] === 'xeno-spawn');
  assert.ok(row, 'migration never upserted xeno-spawn');
  assert.match(row.sql, /VALUES \(\$1, NULL, \$2/);
  assert.deepEqual(row.params[2], SPAWN_CB);
  assert.deepEqual(row.params[3], scopesForClient('xeno-spawn'));
  assert.equal(row.params[4], 'xeno-spawn');
  assert.equal(row.params[5], true);
  // Every other loopback client is unchanged: still the canonical /callback pair.
  const pixel = calls.find((q) => q.params?.[0] === 'xeno-pixel');
  assert.deepEqual(pixel.params[2], ['http://127.0.0.1/callback', 'http://[::1]/callback']);
});

test('spawn authority is identity + credits read + gateway inference, and nothing more', () => {
  assert.deepEqual(scopesForClient('xeno-spawn'),
    ['openid', 'profile', 'email', 'inference:run', 'ledger:read', 'ledger:spend']);
});

test('any 127.0.0.1 / [::1] port matches /auth/callback; other hosts, paths and schemes do not', async () => {
  const row = { client_id: 'xeno-spawn', loopback: true, redirect_uris: SPAWN_CB, allowed_scopes: scopesForClient('xeno-spawn') };
  for (const uri of [
    'http://127.0.0.1:7340/auth/callback', 'http://127.0.0.1:51823/auth/callback',
    'http://[::1]:7340/auth/callback', 'http://127.0.0.1/auth/callback',
  ]) {
    await assert.doesNotReject(authorize(row, uri), uri);
  }
  for (const uri of [
    'http://localhost:7340/auth/callback', 'http://192.168.1.10:7340/auth/callback',
    'http://evil.example:7340/auth/callback', 'https://127.0.0.1:7340/auth/callback',
    'http://127.0.0.1:7340/callback', 'http://127.0.0.1:7340/auth/callback/extra',
    'http://127.0.0.1.evil.example:7340/auth/callback',
  ]) {
    await assert.rejects(authorize(row, uri), /redirect_uri mismatch/, uri);
  }
});

test('a loopback client cannot be seeded a non-loopback redirect', () => {
  for (const bad of [
    ['http://localhost/auth/callback'], ['https://127.0.0.1/auth/callback'],
    ['http://127.0.0.1:7340/auth/callback'], ['http://evil.example/auth/callback'], [],
  ]) {
    assert.throws(() => assertLoopbackRedirects('x', bad), /loopback client x/);
  }
});

test('the version floor can reach xeno-spawn builds through their client_id', () => {
  assert.equal(productForOidcClient('xeno-spawn'), 'spawn');
});

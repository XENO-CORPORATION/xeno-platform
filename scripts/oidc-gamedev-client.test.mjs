import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient } from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';
import { validateAuthorizationRequest } from '../src/server/utils/oidcProvider.js';
import { productForOidcClient } from '../src/server/services/clientVersion.js';

// XENO GameDev, set up the Workshop's way (owner, 2026-11-03: "Yes, like Workshop"): the hosted BFF at
// gamedev.xenosystem.ai (exact-match) and the studio's own service on the owner's PC (loopback, like
// xeno-spawn). Separate ids so either can be revoked without touching the other.
const HOSTED_CB = ['https://gamedev.xenosystem.ai/auth/callback'];
const LOCAL_CB = ['http://127.0.0.1/auth/callback', 'http://[::1]/auth/callback'];
const client = (id) => FIRST_PARTY_CLIENTS.find((c) => c.id === id);
const db = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });
const row = (id) => ({ client_id: id, loopback: client(id).loopback, redirect_uris: redirectsForClient(client(id)), allowed_scopes: scopesForClient(id) });
const authorize = (id, redirectUri) => validateAuthorizationRequest(db(row(id)), {
  clientId: id, redirectUri, codeChallenge: 'challenge', codeChallengeMethod: 'S256',
});

test('the hosted studio is a public web client with ONE exact-match redirect', () => {
  const c = client('xeno-gamedev');
  assert.ok(c, 'xeno-gamedev is not seeded');
  assert.equal(c.loopback, false);
  assert.equal(c.secret, undefined, 'a public client must not be seeded a secret');
  assert.deepEqual(redirectsForClient(c), HOSTED_CB);
});

test('the local studio is a loopback client at /auth/callback, the xeno-spawn shape', () => {
  const c = client('xeno-gamedev-local');
  assert.ok(c, 'xeno-gamedev-local is not seeded');
  assert.equal(c.loopback, true);
  assert.equal(c.secret, undefined);
  assert.deepEqual(redirectsForClient(c), LOCAL_CB);
});

test('the seed writes both rows with their own redirects, authority and loopback flag', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  for (const [id, cb, loopback] of [['xeno-gamedev', HOSTED_CB, false], ['xeno-gamedev-local', LOCAL_CB, true]]) {
    const r = calls.find((q) => q.params?.[0] === id);
    assert.ok(r, `migration never upserted ${id}`);
    assert.match(r.sql, /VALUES \(\$1, NULL, \$2/);
    assert.deepEqual(r.params[2], cb);
    assert.deepEqual(r.params[3], scopesForClient(id));
    assert.equal(r.params[5], loopback);
  }
});

test('gamedev authority is identity + credits + gateway inference + its own project storage, and nothing more', () => {
  for (const id of ['xeno-gamedev', 'xeno-gamedev-local']) {
    assert.deepEqual(scopesForClient(id), ['openid', 'profile', 'email', 'inference:run', 'ledger:read', 'ledger:spend', 'storage:read', 'storage:write']);
  }
});

test('the hosted client accepts exactly its callback and nothing near it', async () => {
  await assert.doesNotReject(authorize('xeno-gamedev', HOSTED_CB[0]));
  for (const uri of [
    'http://gamedev.xenosystem.ai/auth/callback', 'https://gamedev.xenosystem.ai/auth/callback/x',
    'https://evil.example/auth/callback', 'https://gamedev.xenosystem.ai.evil.example/auth/callback',
    'http://127.0.0.1:7341/auth/callback',
  ]) await assert.rejects(authorize('xeno-gamedev', uri), /redirect_uri mismatch/, uri);
});

test('the local client accepts any loopback port at /auth/callback; never localhost, the hosted URL, or another path', async () => {
  for (const uri of ['http://127.0.0.1:7341/auth/callback', 'http://[::1]:7341/auth/callback', 'http://127.0.0.1:61000/auth/callback']) {
    await assert.doesNotReject(authorize('xeno-gamedev-local', uri), uri);
  }
  for (const uri of ['http://localhost:7341/auth/callback', 'https://gamedev.xenosystem.ai/auth/callback', 'http://127.0.0.1:7341/callback']) {
    await assert.rejects(authorize('xeno-gamedev-local', uri), /redirect_uri mismatch/, uri);
  }
});

test('the version floor reaches both gamedev clients as ONE product', () => {
  assert.equal(productForOidcClient('xeno-gamedev'), 'gamedev');
  assert.equal(productForOidcClient('xeno-gamedev-local'), 'gamedev');
});

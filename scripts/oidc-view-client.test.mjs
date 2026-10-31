// XENO View desktop (xeno-view): the same registration contract as xeno-storage's and xeno-corpus's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient } from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';
import { productForOidcClient, identifyClient } from '../src/server/services/clientVersion.js';

const view = () => FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-view');

test('xeno-view is a first-party public loopback client on the canonical /callback pair', () => {
  const c = view();
  assert.ok(c, 'xeno-view is not seeded');
  assert.equal(c.loopback, true);
  assert.equal(c.secret, undefined, 'a public desktop client must not be seeded a secret');
  assert.deepEqual(redirectsForClient(c), ['http://127.0.0.1/callback', 'http://[::1]/callback']);
});

test('the seed upserts xeno-view with its checked-in authority', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const row = calls.find((q) => q.params?.[0] === 'xeno-view');
  assert.ok(row, 'migration never upserted xeno-view');
  assert.deepEqual(row.params[3], scopesForClient('xeno-view'));
  assert.equal(row.params[5], true);
});

test('view authority holds what the app asks for: identity, inference and credits for AI Restyle', () => {
  const held = new Set(scopesForClient('xeno-view'));
  for (const scope of ['openid', 'profile', 'email', 'ledger', 'inference:run']) assert.ok(held.has(scope), `xeno-view cannot hold ${scope}`);
});

test('the version floor and the door reach xeno-view builds', () => {
  assert.equal(productForOidcClient('xeno-view'), 'view');
  if (typeof identifyClient === 'function') {
    const id = identifyClient({ headers: { 'x-xeno-client': 'xeno-view/0.2.0 (win32; x64)' } });
    assert.equal(id?.product, 'view', JSON.stringify(id));
  }
});

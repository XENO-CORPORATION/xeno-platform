import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient } from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';
import { productForOidcClient, identifyClient } from '../src/server/services/clientVersion.js';

const storage = () => FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-storage');

test('xeno-storage is a first-party public loopback client on the canonical /callback pair', () => {
  const c = storage();
  assert.ok(c, 'xeno-storage is not seeded');
  assert.equal(c.loopback, true);
  assert.equal(c.secret, undefined, 'a public desktop client must not be seeded a secret');
  assert.deepEqual(redirectsForClient(c), ['http://127.0.0.1/callback', 'http://[::1]/callback']);
});

test('the seed upserts xeno-storage with its checked-in authority', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const row = calls.find((q) => q.params?.[0] === 'xeno-storage');
  assert.ok(row, 'migration never upserted xeno-storage');
  assert.deepEqual(row.params[3], scopesForClient('xeno-storage'));
  assert.equal(row.params[5], true);
});

test('storage authority is the product set plus team:read, and never team or billing management', () => {
  const s = scopesForClient('xeno-storage');
  for (const need of ['openid', 'projects:read', 'projects:write', 'sync:use', 'team:read']) assert.ok(s.includes(need), need);
  for (const never of ['team:manage', 'billing:manage', 'workforce:manage', 'broker:exchange', 'marketplace:payout']) assert.ok(!s.includes(never), never);
});

test('the version floor and the door reach xeno-storage builds', () => {
  assert.equal(productForOidcClient('xeno-storage'), 'storage');
  if (typeof identifyClient === 'function') {
    const id = identifyClient({ headers: { 'x-xeno-client': 'xeno-storage/0.1.0 (win32; x64)' } });
    assert.equal(id?.product, 'storage', JSON.stringify(id));
  }
});

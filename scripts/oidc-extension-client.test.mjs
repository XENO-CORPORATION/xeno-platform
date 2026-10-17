import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient } from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient, OIDC_SCOPES } from '../src/server/config/oidcAuthorityPolicy.js';
import { productForOidcClient } from '../src/server/services/clientVersion.js';

const ext = () => FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-extension');

test('xeno-extension is a first-party public client with NO redirect (device grant only)', () => {
  const c = ext();
  assert.ok(c, 'xeno-extension is not seeded');
  assert.equal(c.loopback, false);
  assert.equal(c.secret, undefined, 'a public client must not be seeded a secret');
  assert.deepEqual(redirectsForClient(c), [], 'no redirect: an authorization-code flow cannot be completed by this client');
});

test('the seed upserts xeno-extension with its checked-in authority', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const row = calls.find((q) => q.params?.[0] === 'xeno-extension');
  assert.ok(row, 'migration never upserted xeno-extension');
  assert.deepEqual(row.params[3], scopesForClient('xeno-extension'));
  assert.deepEqual(row.params[2], []);
});

test('extension authority: its model loop and browser:connect, nothing that manages people or money', () => {
  const s = scopesForClient('xeno-extension');
  for (const need of ['openid', 'inference:run', 'ledger:read', 'ledger:spend', 'browser:connect']) assert.ok(s.includes(need), need);
  for (const never of ['team:manage', 'billing:manage', 'workforce:manage', 'broker:exchange', 'projects:write', 'marketplace:payout']) assert.ok(!s.includes(never), never);
  assert.ok(OIDC_SCOPES.includes('browser:connect'), 'browser:connect is a known scope');
});

test('only the extension may hold browser:connect', () => {
  const holders = FIRST_PARTY_CLIENTS.map((c) => c.id).filter((id) => (scopesForClient(id) || []).includes('browser:connect'));
  assert.deepEqual(holders, ['xeno-extension']);
});

test('the version floor and the door reach xeno-extension builds', () => {
  assert.equal(productForOidcClient('xeno-extension'), 'extension');
});

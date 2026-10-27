// XENO Corpus desktop (xeno-corpus/desktop) — the same registration contract as xeno-storage's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient } from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';
import { productForOidcClient, identifyClient } from '../src/server/services/clientVersion.js';

const corpus = () => FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-corpus');

test('xeno-corpus is a first-party public loopback client on the canonical /callback pair', () => {
  const c = corpus();
  assert.ok(c, 'xeno-corpus is not seeded');
  assert.equal(c.loopback, true);
  assert.equal(c.secret, undefined, 'a public desktop client must not be seeded a secret');
  assert.deepEqual(redirectsForClient(c), ['http://127.0.0.1/callback', 'http://[::1]/callback']);
});

test('the seed upserts xeno-corpus with its checked-in authority', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const row = calls.find((q) => q.params?.[0] === 'xeno-corpus');
  assert.ok(row, 'migration never upserted xeno-corpus');
  assert.deepEqual(row.params[3], scopesForClient('xeno-corpus'));
  assert.equal(row.params[5], true);
});

test('corpus authority is identity only: no inference, ledger, projects, team or billing', () => {
  assert.deepEqual([...scopesForClient('xeno-corpus')].sort(), ['email', 'openid', 'profile']);
});

test('the version floor and the door reach xeno-corpus builds', () => {
  assert.equal(productForOidcClient('xeno-corpus'), 'corpus');
  if (typeof identifyClient === 'function') {
    const id = identifyClient({ headers: { 'x-xeno-client': 'xeno-corpus/0.1.0 (win32; x64)' } });
    assert.equal(id?.product, 'corpus', JSON.stringify(id));
  }
});

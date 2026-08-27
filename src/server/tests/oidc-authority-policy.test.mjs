import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAuthorityPolicy, CLIENT_AUTHORITY, OIDC_SCOPES } from '../config/oidcAuthorityPolicy.js';
import { discovery } from '../utils/oidcProvider.js';

test('first-party authority matrix is closed over the advertised scope registry', () => {
  assert.equal(assertAuthorityPolicy(), true);
  const advertised = new Set(OIDC_SCOPES);
  for (const scopes of Object.values(CLIENT_AUTHORITY)) {
    for (const scope of scopes) assert.equal(advertised.has(scope), true);
  }
});

test('drawing and media apps cannot receive billing, payout, team-admin, or global-logout authority', () => {
  for (const clientId of ['xeno-pixel', 'xeno-motion', 'xeno-sound', 'xeno-canvas', 'xeno-browser']) {
    const scopes = new Set(CLIENT_AUTHORITY[clientId]);
    for (const forbidden of ['billing:manage', 'marketplace:payout', 'team:manage', 'account:logout']) {
      assert.equal(scopes.has(forbidden), false, `${clientId} unexpectedly has ${forbidden}`);
    }
  }
});

test('only the web payout surface can request marketplace payout authority', () => {
  const holders = Object.entries(CLIENT_AUTHORITY)
    .filter(([, scopes]) => scopes.includes('marketplace:payout'))
    .map(([clientId]) => clientId);
  assert.deepEqual(holders, ['xeno-web']);
});

test('discovery advertises the fresh-auth ACR and security-critical token claims', () => {
  const metadata = discovery();
  assert.deepEqual(metadata.acr_values_supported, ['urn:xeno:acr:fresh']);
  for (const claim of ['auth_time', 'sid', 'cnf', 'act', 'auth_epoch']) {
    assert.equal(metadata.claims_supported.includes(claim), true, `missing discovery claim ${claim}`);
  }
});

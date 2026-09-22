import assert from 'node:assert/strict';
import test from 'node:test';
import { CLIENT_AUTHORITY, OIDC_SCOPES, assertAuthorityPolicy, scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';

test('workforce authority is explicit and limited to designated clients', () => {
  assert.equal(assertAuthorityPolicy(), true);
  const permitted = ['xeno-hub', 'xeno-shell', 'xeno-anima', 'xeno-agent-cli', 'xeno-agent-interface', 'xeno-web'];
  for (const scope of ['workforce:read', 'workforce:manage']) {
    assert.ok(OIDC_SCOPES.includes(scope));
    assert.deepEqual(Object.entries(CLIENT_AUTHORITY).filter(([,scopes]) => scopes.includes(scope)).map(([id]) => id).sort(), permitted.slice().sort());
  }
});
test('workforce ceilings do not add funding or payout to agent clients', () => {
  for (const id of ['xeno-shell', 'xeno-anima', 'xeno-agent-cli', 'xeno-agent-interface']) {
    for (const scope of ['billing:manage', 'marketplace:payout', 'account:logout']) assert.ok(!scopesForClient(id).includes(scope));
  }
  assert.equal(scopesForClient('invented-workforce-client'), null);
  const copy = scopesForClient('xeno-agent-cli');
  copy.push('marketplace:payout');
  assert.ok(!scopesForClient('xeno-agent-cli').includes('marketplace:payout'));
});

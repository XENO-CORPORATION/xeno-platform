import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { FIRST_PARTY_CLIENTS } from '../src/server/database/migrate-oidc-clients.js';
import { CLIENT_AUTHORITY, OIDC_SCOPES, scopesForClient, assertAuthorityPolicy } from '../src/server/config/oidcAuthorityPolicy.js';
import { validateAuthorizationRequest } from '../src/server/utils/oidcProvider.js';

const agent = () => FIRST_PARTY_CLIENTS.find((client) => client.id === 'xeno-agent-interface');
const db = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });

const AGENT_REQUESTED_SCOPES = [
  'openid', 'profile', 'email', 'offline_access',
  'team:read', 'team:manage', 'collaboration:use',
  'workforce:read', 'workforce:manage',
];

test('the Agent is a first-party public loopback client', () => {
  const client = agent();
  assert.deepEqual(client, { id: 'xeno-agent-interface', name: 'XENO Agent', loopback: true });
  assert.deepEqual(scopesForClient(client.id), scopesForClient('xeno-shell'));
  assert.equal(client.secret, undefined, 'the migration must not invent a client secret');
  assert.equal(CLIENT_AUTHORITY[client.id].includes('openid'), true);
  assert.doesNotThrow(assertAuthorityPolicy);
});

test('the migration contract registers exactly the canonical loopback callbacks', () => {
  const client = agent();
  const migration = readFileSync(new URL('../src/server/database/migrate-oidc-clients.js', import.meta.url), 'utf8');
  assert.match(migration, /const LOOPBACK_CB = \['http:\/\/127\.0\.0\.1\/callback', 'http:\/\/\[::1\]\/callback'\];/);
  const redirects = client.loopback
    ? ['http://127.0.0.1/callback', 'http://[::1]/callback']
    : client.redirects;
  assert.deepEqual(redirects, ['http://127.0.0.1/callback', 'http://[::1]/callback']);
});

test('arbitrary loopback ports are accepted only for /callback', async () => {
  const row = { client_id: agent().id, loopback: true, redirect_uris: ['http://127.0.0.1/callback', 'http://[::1]/callback'], allowed_scopes: scopesForClient(agent().id) };
  for (const host of ['127.0.0.1', '[::1]']) {
    await assert.doesNotReject(validateAuthorizationRequest(db(row), {
      clientId: row.client_id, redirectUri: `http://${host}:43127/callback`, codeChallenge: 'challenge', codeChallengeMethod: 'S256',
    }));
  }
  for (const redirectUri of ['http://127.0.0.1:43127/', 'http://127.0.0.1:43127/callback/extra', 'http://192.168.1.10:43127/callback', 'https://127.0.0.1:43127/callback']) {
    await assert.rejects(validateAuthorizationRequest(db(row), {
      clientId: row.client_id, redirectUri, codeChallenge: 'challenge', codeChallengeMethod: 'S256',
    }), /redirect_uri mismatch/);
  }
});

test('Agent scopes are downscoped by the existing authority policy, not widened', () => {
  const allowed = new Set(scopesForClient(agent().id));
  const granted = AGENT_REQUESTED_SCOPES.filter((scope) => allowed.has(scope));
  assert.deepEqual(granted, ['openid', 'profile', 'email']);
  // team/workforce scopes are not in the checked-in authority policy yet;
  // silently granting them here would weaken validation and invent authority.
  assert.ok(!OIDC_SCOPES.includes('offline_access'));
  assert.ok(!OIDC_SCOPES.includes('workforce:read'));
  assert.ok(!OIDC_SCOPES.includes('workforce:manage'));
});

test('unknown clients remain rejected and PKCE remains mandatory', async () => {
  await assert.rejects(validateAuthorizationRequest(db(null), {
    clientId: 'not-a-registered-client', redirectUri: 'http://127.0.0.1:43127/callback', codeChallenge: 'challenge', codeChallengeMethod: 'S256',
  }), /unknown client/);
  const row = { client_id: agent().id, loopback: true, redirect_uris: ['http://127.0.0.1/callback'], allowed_scopes: scopesForClient(agent().id) };
  await assert.rejects(validateAuthorizationRequest(db(row), {
    clientId: row.client_id, redirectUri: 'http://127.0.0.1:43127/callback', codeChallenge: '', codeChallengeMethod: 'S256',
  }), /code_challenge required/);
  await assert.rejects(validateAuthorizationRequest(db(row), {
    clientId: row.client_id, redirectUri: 'http://127.0.0.1:43127/callback', codeChallenge: 'challenge', codeChallengeMethod: 'plain',
  }), /S256/);
});

test('migration is idempotent by contract and cannot seed a secret', () => {
  const migration = requireMigrationText();
  assert.match(migration, /ON CONFLICT \(client_id\) DO UPDATE/);
  assert.match(migration, /VALUES \(\$1, NULL, \$2/);
  assert.doesNotMatch(migration, /xeno-agent-interface[^\n]*client_secret/i);
});

function requireMigrationText() {
  return readFileSync(new URL('../src/server/database/migrate-oidc-clients.js', import.meta.url), 'utf8');
}

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
  // The Agent's authority is the shared agent-surface authority (xeno-shell's) plus EXACTLY
  // one deliberate addition: `collaboration:use`, granted by 18eac82 (2026-09-22, "live
  // conversation collaboration") because the Agent joins live conversations and Shell does
  // not. This asserted plain equality with xeno-shell and went red on that commit: correct
  // code, stale test. Asserting the difference keeps the property this was guarding -- no
  // authority the agent surfaces do not already hold, apart from that one named scope.
  const shell = new Set(scopesForClient('xeno-shell'));
  const own = scopesForClient(client.id);
  assert.ok([...shell].every((scope) => own.includes(scope)), 'the Agent lost authority the agent surfaces hold');
  assert.deepEqual(own.filter((scope) => !shell.has(scope)), ['collaboration:use'],
    'the Agent holds authority beyond the agent surfaces other than the one deliberate addition');
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
  // What the Agent requests versus what its checked-in row allows. Two of these were added
  // deliberately and are now granted: `workforce:read`/`workforce:manage` (3cbd89a,
  // 2026-09-22 -- the workforce service layer, which gives every agent surface the
  // workforce authority) and `collaboration:use` (18eac82). This test used to assert those
  // scopes did not EXIST, which was the state before either commit and went red on the
  // first: correct policy, stale test.
  assert.deepEqual(granted, ['openid', 'profile', 'email', 'collaboration:use', 'workforce:read', 'workforce:manage']);
  // The property this guards is unchanged: a request is DOWNSCOPED, never honoured beyond
  // the row. The Agent asks for team administration and refresh -- neither is in its row,
  // so neither is granted, however it asks.
  for (const scope of ['team:read', 'team:manage', 'offline_access']) {
    assert.ok(!allowed.has(scope), `the Agent is granted ${scope}, which its authority row does not carry`);
  }
  assert.ok(!OIDC_SCOPES.includes('offline_access'), 'offline_access is not a scope this provider issues');
  // A workforce grant cannot become a spend or payout grant: those stay on their own scopes.
  for (const scope of ['billing:manage', 'marketplace:payout', 'broker:exchange']) {
    assert.ok(!allowed.has(scope), `the Agent holds ${scope}`);
  }
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

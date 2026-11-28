// XENO Corpus CLI and hosted corpora (xeno-corpus docs/specs/2026-11-28-corpus-remote-1.md §3, D241): a first-party
// device-grant / loopback client whose tokens name 'xeno-corpus', and self-registered MCP clients that ask for corpus:*
// alone. The desktop's own 'xeno-corpus' client is unchanged: its tokens stay the platform's.
//   node --test scripts/oidc-corpus-cli-client.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient } from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient, CLIENT_AUTHORITY } from '../src/server/config/oidcAuthorityPolicy.js';
import { CORPUS_AUDIENCE, CORPUS_SCOPES, DYNAMIC_SCOPES, ACCESS_TOKEN_AUDIENCE, registerDynamicClient, verifyCorpusAccessToken } from '../src/server/utils/oidcProvider.js';

const byId = (id) => FIRST_PARTY_CLIENTS.find((c) => c.id === id);

test('xeno-corpus-cli is a first-party public loopback client on the canonical /callback pair, on the xeno-corpus audience', () => {
  const c = byId('xeno-corpus-cli');
  assert.ok(c, 'xeno-corpus-cli is not seeded');
  assert.equal(c.loopback, true, 'loopback: device grant on a terminal, PKCE on a desktop');
  assert.equal(c.secret, undefined, 'a public client must not be seeded a secret');
  assert.equal(c.audience, CORPUS_AUDIENCE);
  assert.equal(CORPUS_AUDIENCE, 'xeno-corpus');
  assert.deepEqual(redirectsForClient(c), ['http://127.0.0.1/callback', 'http://[::1]/callback']);
});

test('the seed upserts it with its checked-in authority and the xeno-corpus audience, and the desktop client keeps the platform one', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const cli = calls.find((q) => q.params?.[0] === 'xeno-corpus-cli');
  assert.ok(cli, 'the seed never upserted xeno-corpus-cli');
  assert.deepEqual(cli.params[3], scopesForClient('xeno-corpus-cli'));
  assert.equal(cli.params[6], 'xeno-corpus', 'access_audience comes from the seed, not a hand-edited row');
  const desktop = calls.find((q) => q.params?.[0] === 'xeno-corpus');
  assert.equal(desktop.params[6], ACCESS_TOKEN_AUDIENCE, 'the desktop app spends credits through the platform API: its audience stays xeno-api');
});

test('its authority is identity plus corpus:read and corpus:write, nothing that spends or reads files', () => {
  assert.deepEqual([...scopesForClient('xeno-corpus-cli')].sort(), ['corpus:read', 'corpus:write', 'email', 'openid', 'profile']);
  assert.deepEqual([...CORPUS_SCOPES].sort(), ['corpus:read', 'corpus:write']);
  const holders = Object.entries(CLIENT_AUTHORITY).filter(([, s]) => s.some((x) => CORPUS_SCOPES.includes(x))).map(([id]) => id);
  assert.deepEqual(holders, ['xeno-corpus-cli'], 'no other first-party client carries a hosted-corpus scope');
});

function fakeDb() {
  const inserts = [];
  return {
    inserts,
    query: async (sql, params) => {
      if (/INSERT INTO oauth_clients/.test(sql)) { inserts.push(params); return { rows: [] }; }
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
      return { rows: [] };
    },
  };
}
const meta = (scope) => ({ client_name: 'Claude Code', redirect_uris: ['http://127.0.0.1:43127/callback'], scope });

test('a self-registered MCP client that asks for corpus:* alone gets the xeno-corpus audience', async () => {
  assert.ok(CORPUS_SCOPES.every((s) => DYNAMIC_SCOPES.includes(s)), 'corpus scopes are registrable');
  const db = fakeDb();
  const r = await registerDynamicClient(db, meta('corpus:read corpus:write'), { from: '127.0.0.1' });
  assert.equal(r.scope, 'corpus:read corpus:write');
  const [params] = db.inserts;
  assert.equal(params[4], 'xeno-corpus', 'its tokens name the hosted Corpus');
  assert.equal(params[6], 'xeno_corpus_mcp');
});

test('corpus:* mixed with another area is refused: one token, one server', async () => {
  for (const scope of ['corpus:read tasks:read', 'corpus:write depot:read']) {
    await assert.rejects(registerDynamicClient(fakeDb(), meta(scope), { from: '127.0.0.1' }), (e) => e.oauthError === 'invalid_client_metadata', scope);
  }
});

test('verifyCorpusAccessToken ignores a token for any other audience', async () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const forPlatform = `${b64({ alg: 'ES256', kid: 'k1', typ: 'at+jwt' })}.${b64({ aud: 'xeno-api', typ: 'at+jwt', sub: 'u' })}.sig`;
  assert.equal(await verifyCorpusAccessToken(fakeDb(), forPlatform), null);
});

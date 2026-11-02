import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient } from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';
import { validateAuthorizationRequest } from '../src/server/utils/oidcProvider.js';

// XENO Motion in the browser at motion.xenosystem.ai (owner 2026-10-31/11-02; xeno-motion
// docs/decisions/0001-motion-on-the-web.md). Same shape as tools.: the platform's host sign-in, a
// first-party public client with ONE exact-match redirect, identity only, ending in a browser session.
const CB = ['https://motion.xenosystem.ai/api/auth/host/callback'];
const client = FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-motion-web');
const db = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });
const row = { client_id: 'xeno-motion-web', loopback: false, redirect_uris: client ? redirectsForClient(client) : [], allowed_scopes: scopesForClient('xeno-motion-web') };
const authorize = (redirectUri) => validateAuthorizationRequest(db(row), {
  clientId: 'xeno-motion-web', redirectUri, codeChallenge: 'challenge', codeChallengeMethod: 'S256',
});

test('motion web is a public web client with ONE exact-match redirect', () => {
  assert.ok(client, 'xeno-motion-web is not seeded');
  assert.equal(client.loopback, false);
  assert.equal(client.secret, undefined, 'a public client must not be seeded a secret');
  assert.deepEqual(redirectsForClient(client), CB);
});

test('it asks for identity only — the sign-in becomes a browser session, the token is revoked', () => {
  assert.deepEqual([...scopesForClient('xeno-motion-web')].sort(), ['email', 'openid', 'profile']);
});

test('the host sign-in maps motion.xenosystem.ai to it, and tools. is untouched', () => {
  // Read from the source: importing authRoutes.js loads the whole server.
  const src = readFileSync(new URL('../src/server/routes/authRoutes.js', import.meta.url), 'utf8');
  const map = src.slice(src.indexOf('export const HOST_SIGNIN_CLIENTS'), src.indexOf('});', src.indexOf('export const HOST_SIGNIN_CLIENTS')));
  assert.match(map, /'motion\.xenosystem\.ai': 'xeno-motion-web'/);
  assert.match(map, /'tools\.xenosystem\.ai': 'xeno-tools-web'/);
});

test('only its exact callback is accepted', async () => {
  await assert.doesNotReject(authorize(CB[0]));
  for (const bad of ['https://motion.xenosystem.ai/api/auth/host/callback/', 'https://evil.example/api/auth/host/callback',
    'https://motion.xenosystem.ai.evil.example/api/auth/host/callback', 'http://motion.xenosystem.ai/api/auth/host/callback']) {
    await assert.rejects(authorize(bad), undefined, `accepted ${bad}`);
  }
});

test('the seed writes the row with its redirect and identity authority', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const r = calls.find((q) => q.params?.[0] === 'xeno-motion-web');
  assert.ok(r, 'the seed did not write xeno-motion-web');
  assert.ok(JSON.stringify(r.params).includes(CB[0]), 'the seeded row lacks the callback');
});

test('nginx serves motion. from the mounted release, gated, with the backend for /api/', () => {
  const conf = readFileSync(new URL('../nginx/default.conf', import.meta.url), 'utf8');
  const block = conf.slice(conf.indexOf('server_name motion.xenosystem.ai;'));
  const body = block.slice(0, block.indexOf('\n}\n'));
  assert.match(body, /root \/usr\/share\/nginx\/motion\/current;/);
  assert.match(body, /location \/api\/ \{[\s\S]*?proxy_pass http:\/\/\$backend_upstream;/);
  assert.match(body, /location \/ \{[\s\S]*?auth_request \/__site_gate;[\s\S]*?try_files \/web\.html =404;/);
  assert.match(body, /location = \/coming-soon\.html \{\s*root \/usr\/share\/nginx\/html;/);
  const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(compose, /\/srv\/xeno-motion-web:\/usr\/share\/nginx\/motion:ro/);
});

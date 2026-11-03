import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient } from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';
import { validateAuthorizationRequest } from '../src/server/utils/oidcProvider.js';
import { identifyClient, evaluateClient } from '../src/server/services/clientVersion.js';

// XENO Creator in the browser at creator.xenosystem.ai (owner 2026-11-03: "bring it live at creator.xenosystem.ai the
// same way workshop.xenosystem.ai and motion.xenosystem.ai is"). The motion. shape: the platform's host sign-in, a
// first-party public client with ONE exact-match redirect, identity only, ending in a browser session.
const CB = ['https://creator.xenosystem.ai/api/auth/host/callback'];
const client = FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-creator-web');
const db = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });
const row = { client_id: 'xeno-creator-web', loopback: false, redirect_uris: client ? redirectsForClient(client) : [], allowed_scopes: scopesForClient('xeno-creator-web') };
const authorize = (redirectUri) => validateAuthorizationRequest(db(row), {
  clientId: 'xeno-creator-web', redirectUri, codeChallenge: 'challenge', codeChallengeMethod: 'S256',
});

test('creator web is a public web client with ONE exact-match redirect', () => {
  assert.ok(client, 'xeno-creator-web is not seeded');
  assert.equal(client.loopback, false);
  assert.equal(client.secret, undefined, 'a public client must not be seeded a secret');
  assert.deepEqual(redirectsForClient(client), CB);
});

test('it asks for identity only — the sign-in becomes a browser session, the token is revoked', () => {
  assert.deepEqual([...scopesForClient('xeno-creator-web')].sort(), ['email', 'openid', 'profile']);
});

test('the host sign-in maps creator.xenosystem.ai to it, and tools./motion. are untouched', () => {
  // Read from the source: importing authRoutes.js loads the whole server.
  const src = readFileSync(new URL('../src/server/routes/authRoutes.js', import.meta.url), 'utf8');
  const map = src.slice(src.indexOf('export const HOST_SIGNIN_CLIENTS'), src.indexOf('});', src.indexOf('export const HOST_SIGNIN_CLIENTS')));
  assert.match(map, /'creator\.xenosystem\.ai': 'xeno-creator-web'/);
  assert.match(map, /'motion\.xenosystem\.ai': 'xeno-motion-web'/);
  assert.match(map, /'tools\.xenosystem\.ai': 'xeno-tools-web'/);
});

test('only its exact callback is accepted', async () => {
  await assert.doesNotReject(authorize(CB[0]));
  for (const bad of ['https://creator.xenosystem.ai/api/auth/host/callback/', 'https://evil.example/api/auth/host/callback',
    'https://creator.xenosystem.ai.evil.example/api/auth/host/callback', 'http://creator.xenosystem.ai/api/auth/host/callback',
    'https://motion.xenosystem.ai/api/auth/host/callback']) {
    await assert.rejects(authorize(bad), undefined, `accepted ${bad}`);
  }
});

test('the seed writes the row with its redirect and identity authority', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const r = calls.find((q) => q.params?.[0] === 'xeno-creator-web');
  assert.ok(r, 'the seed did not write xeno-creator-web');
  assert.ok(JSON.stringify(r.params).includes(CB[0]), 'the seeded row lacks the callback');
});

test('the licence door identifies the web build as creator, and no floor row means it is served', () => {
  const id = identifyClient({ headers: { 'x-xeno-client': 'creator/0.1.0' } });
  assert.deepEqual({ product: id?.product, version: id?.version }, { product: 'creator', version: '0.1.0' });
  assert.equal(identifyClient({ headers: { 'user-agent': 'Mozilla/5.0 XENO-Creator/0.1.0' } })?.product, 'creator');
  assert.equal(evaluateClient(id, new Map()).ok, true);
});

test('nginx serves creator. from the mounted release, gated, with the backend for /api/', () => {
  const conf = readFileSync(new URL('../nginx/default.conf', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const block = conf.slice(conf.indexOf('server_name creator.xenosystem.ai;'));
  const body = block.slice(0, block.indexOf('\n}\n'));
  assert.match(body, /root \/usr\/share\/nginx\/creator\/current;/);
  assert.match(body, /index index\.html;/);
  assert.match(body, /location \/api\/ \{[\s\S]*?proxy_pass http:\/\/\$backend_upstream;/);
  assert.match(body, /location \/ \{[\s\S]*?auth_request \/__site_gate;[\s\S]*?try_files \/index\.html =404;/);
  assert.match(body, /location = \/coming-soon\.html \{\s*root \/usr\/share\/nginx\/html;/);
  assert.match(body, /location \^~ \/assets\/ \{[\s\S]*?immutable/);
  assert.match(body, /location = \/favicon\.svg \{[\s\S]*?no-cache/);
  assert.match(body, /location = \/favicon\.png \{[\s\S]*?no-cache/);
  assert.match(body, /X-Robots-Tag "noindex, nofollow, noarchive"/);
  const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(compose, /\/srv\/xeno-creator-web:\/usr\/share\/nginx\/creator:ro/);
});

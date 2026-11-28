import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient } from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';
import { validateAuthorizationRequest } from '../src/server/utils/oidcProvider.js';
import { productPage, PRODUCT_SCRIPTS } from './vite-workspace.mjs';

// XENO Depot's web page (xeno-depot docs/design/0006-web-ui.md, routing option A): Depot's Worker on depot.xenosystem.ai
// sends every page path to the platform's depot-web origin. The host sign-in is a first-party public client with ONE
// exact-match redirect on depot.xenosystem.ai, identity only; Depot is called with a token from the browser session
// (POST /api/auth/depot-token, proven against real Postgres in src/server/tests/depot-authority.test.mjs §9).
const CB = ['https://depot.xenosystem.ai/api/auth/host/callback'];
const client = FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-depot-web');
const db = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });
const row = { client_id: 'xeno-depot-web', loopback: false, redirect_uris: client ? redirectsForClient(client) : [], allowed_scopes: scopesForClient('xeno-depot-web') };
const authorize = (redirectUri) => validateAuthorizationRequest(db(row), { clientId: 'xeno-depot-web', redirectUri, codeChallenge: 'challenge', codeChallengeMethod: 'S256' });
const conf = readFileSync(new URL('../nginx/default.conf', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const block = (() => { const b = conf.slice(conf.indexOf('server_name depot-web.xenosystem.ai;')); return b.slice(0, b.indexOf('\n}\n')); })();

test('depot web is a public web client with ONE exact-match redirect, identity only, separate from the CLI', () => {
  assert.ok(client, 'xeno-depot-web is not seeded');
  assert.equal(client.loopback, false);
  assert.equal(client.secret, undefined, 'a public client must not be seeded a secret');
  assert.equal(client.audience, undefined, 'its sign-in token is the platform\'s, never a Depot one');
  assert.deepEqual(redirectsForClient(client), CB);
  assert.deepEqual([...scopesForClient('xeno-depot-web')].sort(), ['email', 'openid', 'profile']);
  assert.ok(FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-depot-cli'), 'the CLI keeps its own client');
});

test('the host sign-in maps depot.xenosystem.ai to it, and the other hosts are untouched', () => {
  const src = readFileSync(new URL('../src/server/routes/authRoutes.js', import.meta.url), 'utf8');
  const map = src.slice(src.indexOf('export const HOST_SIGNIN_CLIENTS'), src.indexOf('});', src.indexOf('export const HOST_SIGNIN_CLIENTS')));
  assert.match(map, /'depot\.xenosystem\.ai': 'xeno-depot-web'/);
  assert.doesNotMatch(map, /depot-web\.xenosystem\.ai/, 'the origin name is never a sign-in host: Host is pinned to depot.');
  for (const [h, c] of [['tools', 'xeno-tools-web'], ['tasks', 'xeno-tasks-web'], ['chat', 'xeno-chat-web'], ['storage', 'xeno-storage-web']]) assert.match(map, new RegExp(`'${h}\\.xenosystem\\.ai': '${c}'`));
});

test('only its exact callback is accepted', async () => {
  await assert.doesNotReject(authorize(CB[0]));
  for (const bad of ['https://depot.xenosystem.ai/api/auth/host/callback/', 'https://depot-web.xenosystem.ai/api/auth/host/callback',
    'https://depot.xenosystem.ai.evil.example/api/auth/host/callback', 'http://depot.xenosystem.ai/api/auth/host/callback',
    'https://storage.xenosystem.ai/api/auth/host/callback']) {
    await assert.rejects(authorize(bad), undefined, `accepted ${bad}`);
  }
});

test('the seed writes the row with its redirect', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const r = calls.find((q) => q.params?.[0] === 'xeno-depot-web');
  assert.ok(r, 'the seed did not write xeno-depot-web');
  assert.ok(JSON.stringify(r.params).includes(CB[0]));
});

test('nginx: the origin pins Host to depot., refuses Depot\'s API, and serves the gated page', () => {
  assert.ok(block.length > 200, 'no depot-web server block');
  // every request to the backend names depot.xenosystem.ai, whatever the caller said
  const backendHops = [...block.matchAll(/proxy_pass http:\/\/\$backend_upstream[^;]*;([\s\S]*?)\n    }/g)];
  assert.equal(backendHops.length, 2, 'the API and the gate check');
  for (const [, rest] of backendHops) {
    assert.match(rest, /proxy_set_header Host depot\.xenosystem\.ai;/);
    assert.match(rest, /proxy_set_header X-Forwarded-Host "";/);
  }
  assert.doesNotMatch(block, /proxy_set_header Host \$host/, 'Host is never taken from the request');
  for (const p of ['location \\^~ \\/api\\/v1\\/ \\{ return 404; \\}', 'location = \\/api\\/v1 \\{ return 404; \\}', 'location \\^~ \\/mcp \\{ return 404; \\}']) assert.match(block, new RegExp(p));
  assert.ok(block.indexOf('location ^~ /api/v1/') < block.indexOf('location ^~ /api/ {'), 'Depot\'s API is refused before the platform API is proxied');
  assert.match(block, /location \^~ \/api\/ \{[\s\S]*?proxy_pass http:\/\/\$backend_upstream;/);
  for (const m of block.matchAll(/\n    location (\/[a-z]+\/?) \{/g)) assert.fail(`plain prefix ${m[1]} loses to the page regex: make it ^~`);
  assert.match(block, /location ~ "\^\/\[\^\.\]\*\$" \{\s*auth_request \/__site_gate;\s*error_page 401 = \/coming-soon\.html;\s*try_files \/workspace\/depot\.html =404;/);
  assert.match(block, /location \^~ \/workspace\/ \{[\s\S]*?auth_request \/__site_gate;/);
  assert.match(block, /location = \/login \{ return 302 \/api\/auth\/host\/start\?return=\$arg_returnUrl; \}/);
  assert.match(block, /absolute_redirect off;/, 'relative redirects, so the Worker serves them under depot.');
  assert.match(block, /add_header X-Robots-Tag "noindex, nofollow, noarchive" always;/);
  const gate = readFileSync(new URL('../public/coming-soon.html', import.meta.url), 'utf8');
  assert.match(gate, /\(chat\|tasks\|storage\|depot\|tools\|motion\|creator\)/, 'the gate page asks xenosystem.ai silently on depot. too');
});

test('the Depot page is the workspace page with only Depot\'s scripts', () => {
  const html = readFileSync(new URL('../prototypes/xeno-workspace/index.html', import.meta.url), 'utf8');
  const out = productPage(html, 'depot');
  assert.equal(out.kept, PRODUCT_SCRIPTS.depot.length); assert.ok(out.dropped > 0);
  assert.match(out.html, /<html lang="en" data-product="depot">/);
  assert.ok(PRODUCT_SCRIPTS.depot.includes('platform-depot.js'));
  for (const s of ['platform-chat.js', 'platform-tasks.js', 'platform-storage.js']) assert.ok(!PRODUCT_SCRIPTS.depot.includes(s), s);
  // the token is kept in memory: the page never writes it to storage
  const page = readFileSync(new URL('../prototypes/xeno-workspace/platform-depot.js', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.match(page, /\/api\/auth\/depot-token/);
});

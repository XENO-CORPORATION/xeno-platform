import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient } from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';
import { validateAuthorizationRequest } from '../src/server/utils/oidcProvider.js';
import { productPage, PRODUCT_SCRIPTS } from './vite-workspace.mjs';

// XENO Tasks on its own host, tasks.xenosystem.ai (owner, 2026-11-21: "a full viewport render for the tasks alone,
// with a header, fast"). The tools. shape: the platform's host sign-in, a first-party public client with ONE
// exact-match redirect, identity only, ending in a browser session; the page is the workspace's own Tasks.
const CB = ['https://tasks.xenosystem.ai/api/auth/host/callback'];
const client = FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-tasks-web');
const db = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });
const row = { client_id: 'xeno-tasks-web', loopback: false, redirect_uris: client ? redirectsForClient(client) : [], allowed_scopes: scopesForClient('xeno-tasks-web') };
const authorize = (redirectUri) => validateAuthorizationRequest(db(row), { clientId: 'xeno-tasks-web', redirectUri, codeChallenge: 'challenge', codeChallengeMethod: 'S256' });

test('tasks web is a public web client with ONE exact-match redirect', () => {
  assert.ok(client, 'xeno-tasks-web is not seeded');
  assert.equal(client.loopback, false);
  assert.equal(client.secret, undefined, 'a public client must not be seeded a secret');
  assert.deepEqual(redirectsForClient(client), CB);
});

test('it asks for identity only: the sign-in becomes a browser session, the token is revoked', () => {
  assert.deepEqual([...scopesForClient('xeno-tasks-web')].sort(), ['email', 'openid', 'profile']);
});

test('the host sign-in maps tasks.xenosystem.ai to it, and the other hosts are untouched', () => {
  const src = readFileSync(new URL('../src/server/routes/authRoutes.js', import.meta.url), 'utf8');
  const map = src.slice(src.indexOf('export const HOST_SIGNIN_CLIENTS'), src.indexOf('});', src.indexOf('export const HOST_SIGNIN_CLIENTS')));
  assert.match(map, /'tasks\.xenosystem\.ai': 'xeno-tasks-web'/);
  for (const [h, c] of [['tools', 'xeno-tools-web'], ['motion', 'xeno-motion-web'], ['creator', 'xeno-creator-web']]) assert.match(map, new RegExp(`'${h}\\.xenosystem\\.ai': '${c}'`));
});

test('only its exact callback is accepted', async () => {
  await assert.doesNotReject(authorize(CB[0]));
  for (const bad of ['https://tasks.xenosystem.ai/api/auth/host/callback/', 'https://evil.example/api/auth/host/callback',
    'https://tasks.xenosystem.ai.evil.example/api/auth/host/callback', 'http://tasks.xenosystem.ai/api/auth/host/callback',
    'https://task.xenosystem.ai/api/auth/host/callback', 'https://tools.xenosystem.ai/api/auth/host/callback']) {
    await assert.rejects(authorize(bad), undefined, `accepted ${bad}`);
  }
});

test('the seed writes the row with its redirect and identity authority', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const r = calls.find((q) => q.params?.[0] === 'xeno-tasks-web');
  assert.ok(r, 'the seed did not write xeno-tasks-web');
  assert.ok(JSON.stringify(r.params).includes(CB[0]), 'the seeded row lacks the callback');
});

test('nginx serves tasks. from the workspace’s tasks.html, gated, with stamped files kept and the API proxied', () => {
  const conf = readFileSync(new URL('../nginx/default.conf', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const block = conf.slice(conf.indexOf('server_name tasks.xenosystem.ai;'));
  const body = block.slice(0, block.indexOf('\n}\n'));
  // ^~ on /api/ and /auth/: the page rule is a regex for every extensionless path, and a regex beats a plain prefix
  assert.match(body, /location \^~ \/api\/ \{[\s\S]*?proxy_pass http:\/\/\$backend_upstream;/);
  for (const m of body.matchAll(/\n    location (\/[a-z]+\/) \{/g)) assert.fail(`plain prefix ${m[1]} loses to the page regex: make it ^~`);
  assert.match(body, /location ~ "\^\/\[\^\.\]\*\$" \{[\s\S]*?auth_request \/__site_gate;[\s\S]*?error_page 401 = \/coming-soon\.html;[\s\S]*?try_files \/workspace\/tasks\.html =404;[\s\S]*?no-cache/);
  assert.match(body, /location \^~ \/workspace\/ \{[\s\S]*?auth_request \/__site_gate;[\s\S]*?Cache-Control \$tasks_asset_cache/);
  assert.match(conf, /map \$arg_v \$tasks_asset_cache \{\s*""\s+"no-cache";\s*default "public, max-age=31536000, immutable";/);
  assert.match(body, /location = \/login \{ return 302 \/api\/auth\/host\/start\?return=\$arg_returnUrl; \}/);
  assert.match(body, /X-Robots-Tag "noindex, nofollow, noarchive"/);
  // every root file the gate page and the workspace page ask for is served here (coming-soon.html: /favicon-v2.svg)
  const gate = readFileSync(new URL('../public/coming-soon.html', import.meta.url), 'utf8');
  const rootFiles = [...new Set([...gate.matchAll(/(?:src|href)="(\/[^"/]+\.[a-z0-9]+)"/g)].map((m) => m[1]).concat('/favicon.svg'))];
  const fav = /location ~ \^\/favicon\(-v2\)\?\\\.svg\$ \{/.test(body);
  for (const f of rootFiles) assert.ok(/^\/favicon(-v2)?\.svg$/.test(f) && fav, `${f} is linked at the root but the Tasks host does not serve it`);
  const typo = conf.slice(conf.indexOf('server_name task.xenosystem.ai;'));
  assert.match(typo.slice(0, typo.indexOf('\n}\n')), /return 301 https:\/\/tasks\.xenosystem\.ai\$request_uri;/);
});

test('the Tasks page is the workspace page with only Tasks’ scripts, and a script it lists must exist', () => {
  const html = readFileSync(new URL('../prototypes/xeno-workspace/index.html', import.meta.url), 'utf8');
  const out = productPage(html, 'tasks');
  assert.equal(out.kept, PRODUCT_SCRIPTS.tasks.length);
  assert.ok(out.dropped > 0, 'it drops the scripts Tasks does not need');
  assert.match(out.html, /<html lang="en" data-product="tasks">/);
  const loaded = [...out.html.matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]);
  assert.deepEqual(loaded.sort(), [...PRODUCT_SCRIPTS.tasks].sort());
  assert.throws(() => productPage(html.replace('<script src="platform-tasks.js"></script>', ''), 'tasks'), /lists \d+ scripts but index\.html has \d+/);
  assert.throws(() => productPage(html, 'nothing'), /no script list/);
});

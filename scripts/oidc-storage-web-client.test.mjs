import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient } from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';
import { validateAuthorizationRequest } from '../src/server/utils/oidcProvider.js';
import { productPage, PRODUCT_SCRIPTS } from './vite-workspace.mjs';

// XENO Storage on its own host, storage.xenosystem.ai (owner, 2026-11-21: "the same for storage.xenosystem.ai … that
// drive-like interface … under our XENO system logic for his account"). The tasks. shape: the host sign-in as a
// first-party public client with ONE exact-match redirect, identity only; the page is the workspace's own Storage.
const CB = ['https://storage.xenosystem.ai/api/auth/host/callback'];
const client = FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-storage-web');
const db = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });
const row = { client_id: 'xeno-storage-web', loopback: false, redirect_uris: client ? redirectsForClient(client) : [], allowed_scopes: scopesForClient('xeno-storage-web') };
const authorize = (redirectUri) => validateAuthorizationRequest(db(row), { clientId: 'xeno-storage-web', redirectUri, codeChallenge: 'challenge', codeChallengeMethod: 'S256' });
const conf = readFileSync(new URL('../nginx/default.conf', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const block = (() => { const b = conf.slice(conf.indexOf('server_name storage.xenosystem.ai;')); return b.slice(0, b.indexOf('\n}\n')); })();

test('storage web is a public web client with ONE exact-match redirect, identity only, separate from the desktop app', () => {
  assert.ok(client, 'xeno-storage-web is not seeded');
  assert.equal(client.loopback, false);
  assert.equal(client.secret, undefined, 'a public client must not be seeded a secret');
  assert.deepEqual(redirectsForClient(client), CB);
  assert.deepEqual([...scopesForClient('xeno-storage-web')].sort(), ['email', 'openid', 'profile']);
  const desktop = FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-storage');
  assert.ok(desktop && desktop.loopback === true, 'the desktop app keeps its own loopback client');
});

test('the host sign-in maps storage.xenosystem.ai to it, and the other hosts are untouched', () => {
  const src = readFileSync(new URL('../src/server/routes/authRoutes.js', import.meta.url), 'utf8');
  const map = src.slice(src.indexOf('export const HOST_SIGNIN_CLIENTS'), src.indexOf('});', src.indexOf('export const HOST_SIGNIN_CLIENTS')));
  assert.match(map, /'storage\.xenosystem\.ai': 'xeno-storage-web'/);
  for (const [h, c] of [['tools', 'xeno-tools-web'], ['tasks', 'xeno-tasks-web'], ['chat', 'xeno-chat-web'], ['motion', 'xeno-motion-web']]) assert.match(map, new RegExp(`'${h}\\.xenosystem\\.ai': '${c}'`));
});

test('only its exact callback is accepted', async () => {
  await assert.doesNotReject(authorize(CB[0]));
  for (const bad of ['https://storage.xenosystem.ai/api/auth/host/callback/', 'https://evil.example/api/auth/host/callback',
    'https://storage.xenosystem.ai.evil.example/api/auth/host/callback', 'http://storage.xenosystem.ai/api/auth/host/callback',
    'https://chat.xenosystem.ai/api/auth/host/callback']) {
    await assert.rejects(authorize(bad), undefined, `accepted ${bad}`);
  }
});

test('the seed writes the row with its redirect', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const r = calls.find((q) => q.params?.[0] === 'xeno-storage-web');
  assert.ok(r, 'the seed did not write xeno-storage-web');
  assert.ok(JSON.stringify(r.params).includes(CB[0]));
});

test('nginx: the Storage page on its host, gated; /api/ is ^~; the old redirect is gone', () => {
  assert.ok(!/return 302 https:\/\/xenosystem\.ai\/workspace\/corpo\/apps\/storage/.test(block), 'the old redirect is gone');
  assert.match(block, /location \^~ \/api\/ \{[\s\S]*?proxy_pass http:\/\/\$backend_upstream;/);
  for (const m of block.matchAll(/\n    location (\/[a-z]+\/?) \{/g)) assert.fail(`plain prefix ${m[1]} loses to the page regex: make it ^~`);
  assert.match(block, /location ~ "\^\/\[\^\.\]\*\$" \{\s*auth_request \/__site_gate;\s*error_page 401 = \/coming-soon\.html;\s*try_files \/workspace\/storage\.html =404;/);
  assert.match(block, /location \^~ \/workspace\/ \{[\s\S]*?auth_request \/__site_gate;/);
  assert.match(block, /location = \/login \{ return 302 \/api\/auth\/host\/start\?return=\$arg_returnUrl; \}/);
  assert.match(block, /location = \/health/);
  const gate = readFileSync(new URL('../public/coming-soon.html', import.meta.url), 'utf8');
  assert.match(gate, /\^\(chat\|tasks\|storage\|depot\|tools\|motion\|creator\)\\\.\(xenosystem\\\.ai\|localhost\)\$/, 'the gate page asks xenosystem.ai silently on this host too');
  for (const [, f] of gate.matchAll(/(?:src|href)="(\/[^"/]+\.([a-z0-9]+))"/g)) assert.ok(block.includes('favicon') || !f.includes('favicon'), `${f} is linked at the root but this host does not serve it`);
});

test('the Storage page is the workspace page with only Storage\'s scripts', () => {
  const html = readFileSync(new URL('../prototypes/xeno-workspace/index.html', import.meta.url), 'utf8');
  const out = productPage(html, 'storage');
  assert.equal(out.kept, PRODUCT_SCRIPTS.storage.length); assert.ok(out.dropped > 0);
  assert.match(out.html, /<html lang="en" data-product="storage">/);
  for (const s of ['platform-storage.js', 'platform-storage-uploads.js']) assert.ok(PRODUCT_SCRIPTS.storage.includes(s), s);
  assert.ok(!PRODUCT_SCRIPTS.storage.includes('platform-chat.js') && !PRODUCT_SCRIPTS.storage.includes('platform-tasks.js'));
  // the upload panel must load before the page that hands it files (the drop handler calls into it)
  assert.ok(PRODUCT_SCRIPTS.storage.indexOf('platform-storage-uploads.js') < PRODUCT_SCRIPTS.storage.indexOf('platform-storage.js'));
});

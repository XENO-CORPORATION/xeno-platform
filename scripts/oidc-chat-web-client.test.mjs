import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIRST_PARTY_CLIENTS, migrateOidcClients, redirectsForClient } from '../src/server/database/migrate-oidc-clients.js';
import { scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';
import { validateAuthorizationRequest } from '../src/server/utils/oidcProvider.js';
import { productPage, PRODUCT_SCRIPTS } from './vite-workspace.mjs';

// XENO Chat on its own host, chat.xenosystem.ai (owner, 2026-11-22: "a dedicated chat … full screen … its own thing,
// like the Gemini web app"). The tasks. shape: the host sign-in as a first-party public client with ONE exact-match
// redirect, identity only; the page is the workspace's own chat, and /chat/… is the platform's chat app inside it.
const CB = ['https://chat.xenosystem.ai/api/auth/host/callback'];
const client = FIRST_PARTY_CLIENTS.find((c) => c.id === 'xeno-chat-web');
const db = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });
const row = { client_id: 'xeno-chat-web', loopback: false, redirect_uris: client ? redirectsForClient(client) : [], allowed_scopes: scopesForClient('xeno-chat-web') };
const authorize = (redirectUri) => validateAuthorizationRequest(db(row), { clientId: 'xeno-chat-web', redirectUri, codeChallenge: 'challenge', codeChallengeMethod: 'S256' });
const conf = readFileSync(new URL('../nginx/default.conf', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const block = (() => { const b = conf.slice(conf.indexOf('server_name chat.xenosystem.ai;')); return b.slice(0, b.indexOf('\n}\n')); })();

test('chat web is a public web client with ONE exact-match redirect, identity only', () => {
  assert.ok(client, 'xeno-chat-web is not seeded');
  assert.equal(client.loopback, false);
  assert.equal(client.secret, undefined, 'a public client must not be seeded a secret');
  assert.deepEqual(redirectsForClient(client), CB);
  assert.deepEqual([...scopesForClient('xeno-chat-web')].sort(), ['email', 'openid', 'profile']);
});

test('the host sign-in maps chat.xenosystem.ai to it, and the other hosts are untouched', () => {
  const src = readFileSync(new URL('../src/server/routes/authRoutes.js', import.meta.url), 'utf8');
  const map = src.slice(src.indexOf('export const HOST_SIGNIN_CLIENTS'), src.indexOf('});', src.indexOf('export const HOST_SIGNIN_CLIENTS')));
  assert.match(map, /'chat\.xenosystem\.ai': 'xeno-chat-web'/);
  for (const [h, c] of [['tools', 'xeno-tools-web'], ['tasks', 'xeno-tasks-web'], ['motion', 'xeno-motion-web']]) assert.match(map, new RegExp(`'${h}\\.xenosystem\\.ai': '${c}'`));
});

test('only its exact callback is accepted', async () => {
  await assert.doesNotReject(authorize(CB[0]));
  for (const bad of ['https://chat.xenosystem.ai/api/auth/host/callback/', 'https://evil.example/api/auth/host/callback',
    'https://chat.xenosystem.ai.evil.example/api/auth/host/callback', 'http://chat.xenosystem.ai/api/auth/host/callback',
    'https://tasks.xenosystem.ai/api/auth/host/callback']) {
    await assert.rejects(authorize(bad), undefined, `accepted ${bad}`);
  }
});

test('the seed writes the row with its redirect', async () => {
  const calls = [];
  await migrateOidcClients({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const r = calls.find((q) => q.params?.[0] === 'xeno-chat-web');
  assert.ok(r, 'the seed did not write xeno-chat-web');
  assert.ok(JSON.stringify(r.params).includes(CB[0]));
});

test('nginx: the chat page and the chat app on one origin, gated; /api/ is ^~; nothing reaches the main site\'s redirect', () => {
  assert.ok(!/return 302 https:\/\/xenosystem\.ai\/workspace\/apps\/chat/.test(block), 'the old redirect is gone');
  assert.match(block, /location \^~ \/api\/ \{[\s\S]*?proxy_pass http:\/\/\$backend_upstream;/);
  for (const m of block.matchAll(/\n    location (\/[a-z]+\/?) \{/g)) assert.fail(`plain prefix ${m[1]} loses to the page regex: make it ^~`);
  assert.match(block, /location ~ \^\/chat\(\/\|\$\) \{\s*auth_request \/__site_gate;\s*error_page 401 = \/coming-soon\.html;\s*try_files \/index\.html =404;/);
  assert.match(block, /location ~ "\^\/\(\(c\|projects\|library\|images\)\(\/\[\^\.\]\*\)\?\)\?\$" \{\s*auth_request \/__site_gate;\s*error_page 401 = \/coming-soon\.html;\s*try_files \/workspace\/chat\.html =404;/);
  assert.match(block, /location = \/env-config\.js \{[^}]*no-store/);
  assert.match(block, /location \^~ \/workspace\/ \{[\s\S]*?auth_request \/__site_gate;/);
  assert.match(block, /location = \/login \{ return 302 \/api\/auth\/host\/start\?return=\$arg_returnUrl; \}/);
  // every root file the gate page links is served here (it links /favicon-v2.svg)
  const gate = readFileSync(new URL('../public/coming-soon.html', import.meta.url), 'utf8');
  for (const [, f] of gate.matchAll(/(?:src|href)="(\/[^"/]+\.([a-z0-9]+))"/g)) assert.match(block, new RegExp(`\\\\.\\((?:[a-z0-9]+\\|)*${f.split('.').pop()}(?:\\|[a-z0-9]+)*\\)\\$`), `${f} is linked at the root but this host does not serve it`);
});

test('the chat page is the workspace page with only the chat\'s scripts', () => {
  const html = readFileSync(new URL('../prototypes/xeno-workspace/index.html', import.meta.url), 'utf8');
  const out = productPage(html, 'chat');
  assert.equal(out.kept, PRODUCT_SCRIPTS.chat.length); assert.ok(out.dropped > 0);
  assert.match(out.html, /<html lang="en" data-product="chat">/);
  assert.ok(PRODUCT_SCRIPTS.chat.includes('platform-chat.js') && !PRODUCT_SCRIPTS.chat.includes('platform-tasks.js'));
});

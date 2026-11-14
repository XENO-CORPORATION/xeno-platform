/** remote.xenosystem.ai: the host that holds a linked device's keys (xeno-agent-interface decision 0006). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pathScopedOriginAllowed } from '../src/server/config/hosts.js';
import { scopesForClient } from '../src/server/config/oidcAuthorityPolicy.js';

const nginx = readFileSync(new URL('../nginx/default.conf', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = nginx.indexOf('server_name remote.xenosystem.ai;');
const block = nginx.slice(start, nginx.indexOf('# storage.xenosystem.ai:', start));

test('the host exists and sits outside the site gate, because a phone has no gate pass', () => {
  assert.ok(start > 0);
  assert.doesNotMatch(block, /auth_request/);
});

test('🔴 every location that sets its own headers still carries the policy, because nginx drops inherited ones', () => {
  const page = block.slice(block.indexOf('location / {'));
  assert.match(page, /Content-Security-Policy/);
  assert.match(block.slice(0, block.indexOf('location = /health')), /Content-Security-Policy/);
  for (const section of [page, block.slice(block.indexOf('location ^~ /assets/'), block.indexOf('location / {'))]) assert.match(section, /X-Robots-Tag/);
});

test('🔴 only our own scripts run, and the page can reach only the issuer', () => {
  for (const policy of block.match(/Content-Security-Policy "[^"]+"/g)) {
    assert.match(policy, /default-src 'none'/);
    assert.match(policy, /script-src 'self';/);
    assert.match(policy, /connect-src https:\/\/xenosystem\.ai wss:\/\/xenosystem\.ai;/);
    // the workspace shows the page in a frame (decision 0006, 2026-11-14): its two hosts and nothing else, never a wildcard
    assert.match(policy, /frame-ancestors https:\/\/xenosystem\.ai https:\/\/www\.xenosystem\.ai"$/);
  }
});

test('the page takes no address on the main site, where it would share an origin', () => {
  assert.match(nginx, /location \^~ \/remote-web\/ \{ return 404; \}/);
});

test('🔴 its origin reaches sign-in and the relay, and no other route', () => {
  const origin = 'https://remote.xenosystem.ai';
  assert.equal(pathScopedOriginAllowed(origin, '/api/oauth2/token'), true);
  assert.equal(pathScopedOriginAllowed(origin, '/api/v2/remote/installations'), true);
  for (const path of ['/api/auth/me', '/api/ai/chat', '/api/v2/browser/installations', '/api/library']) assert.equal(pathScopedOriginAllowed(origin, path), false, path);
});

test('🔴 its sign-in can do nothing but reach the relay', () => {
  const scopes = scopesForClient('xeno-remote-web');
  assert.ok(scopes.includes('remote:connect'));
  assert.deepEqual(scopes.filter((scope) => /inference|ledger|storage|projects|workforce/.test(scope)), []);
});

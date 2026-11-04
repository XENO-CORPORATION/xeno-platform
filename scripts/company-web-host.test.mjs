// XENO Company's dashboard at /company (nginx/default.conf): behind the site gate, on the main site, never indexed, and its
// build comes from the mounted release rather than this image.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const conf = readFileSync(new URL('../nginx/default.conf', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const block = (head) => { const i = conf.indexOf(head); assert.ok(i >= 0, `no ${head}`); return conf.slice(i, conf.indexOf('\n    }\n', i)); };

test('it is on the main site, not a new origin', () => {
  const main = conf.slice(0, conf.indexOf('server_name usercontent.'));
  assert.ok(main.includes('location ^~ /company/ {'));
  assert.ok(!/server_name company\./.test(conf));
});

test('the page is behind the gate, where a rewrite can\'t skip it', () => {
  const app = block('location = /__company_app {');
  assert.match(app, /internal;/);
  assert.match(app, /auth_request \/__site_gate;/);
  assert.match(app, /error_page 401 = \/coming-soon\.html;/);
  // rewrite runs before access checks, so nothing may reach the file except through that location
  assert.match(block('location ^~ /company/ {'), /rewrite \^ \/__company_app last;/);
});

test('every address on it says noindex', () => {
  for (const head of ['location = /__company_app {', 'location ^~ /company/assets/ {', 'location = /company/favicon.svg {']) {
    assert.match(block(head), /add_header X-Robots-Tag "noindex, nofollow, noarchive" always;/, head);
  }
});

test('only hashed assets are cached for good, and the page is never', () => {
  assert.match(block('location ^~ /company/assets/ {'), /immutable/);
  assert.match(block('location = /__company_app {'), /Cache-Control "no-cache"/);
});

test('the build is mounted read-only from the published release', () => {
  assert.match(compose, /- \/srv\/xeno-company-web:\/usr\/share\/nginx\/company:ro/);
  assert.ok(conf.includes('alias /usr/share/nginx/company/current/index.html;'));
});

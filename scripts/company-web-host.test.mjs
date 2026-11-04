// XENO Company lives in the workspace. /company only sends people there, and serves nothing of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const conf = readFileSync(new URL('../nginx/default.conf', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');

test('/company and everything under it goes to the workspace page', () => {
  assert.match(conf, /location = \/company \{ return 301 \/workspace\/corpo\/spaces\/company; \}/);
  assert.match(conf, /location \^~ \/company\/ \{ return 301 \/workspace\/corpo\/spaces\/company; \}/);
});

test('no second build of it is served', () => {
  assert.ok(!conf.includes('/usr/share/nginx/company'));
  assert.ok(!compose.includes('xeno-company-web'));
});

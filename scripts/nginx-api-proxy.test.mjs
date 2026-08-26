/**
 * /api/ is REST. Forcing Connection: upgrade on every request is a latent
 * 502 (nginx copied the /ws hop-by-hop header onto chat / tokenize / piston).
 * proxy_connect_timeout 600s is also wrong: after a crash that is ten minutes
 * of "is the process listening?", not upload time.
 *
 * Source-only. Extract the location bodies so a comment cannot satisfy this.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONF = readFileSync(join(ROOT, 'nginx', 'default.conf'), 'utf8');

function locationBody(pathLit) {
  const needle = `location ${pathLit}`;
  const start = CONF.indexOf(needle);
  if (start === -1) return '';
  const from = CONF.slice(start);
  const brace = from.indexOf('{');
  if (brace === -1) return '';
  let depth = 0;
  for (let i = brace; i < from.length; i++) {
    if (from[i] === '{') depth++;
    else if (from[i] === '}') {
      depth--;
      if (depth === 0) return from.slice(brace + 1, i);
    }
  }
  return '';
}

function uncommented(src) {
  return src.replace(/#[^\n]*/g, '');
}

test('location /api/ does not force Connection: upgrade on REST', () => {
  const body = locationBody('/api/');
  assert.ok(body, 'location /api/ is missing');
  const live = uncommented(body);
  assert.doesNotMatch(
    live,
    /proxy_set_header\s+Upgrade/i,
    '/api/ still sets Upgrade — that belongs on /ws',
  );
  assert.doesNotMatch(
    live,
    /proxy_set_header\s+Connection\s+['"]upgrade['"]/i,
    '/api/ still forces Connection: upgrade on every REST request',
  );
});

test('location /api/ connect timeout is short; send/read stay long for uploads', () => {
  const live = uncommented(locationBody('/api/'));
  const connect = live.match(/proxy_connect_timeout\s+(\d+)s/);
  assert.ok(connect, 'proxy_connect_timeout is missing from /api/');
  assert.ok(
    Number(connect[1]) <= 10,
    `proxy_connect_timeout ${connect[1]}s — after a crash this held a refused backend`,
  );
  assert.match(live, /proxy_send_timeout\s+600s/, 'send timeout must stay 600s for uploads');
  assert.match(live, /proxy_read_timeout\s+600s/, 'read timeout must stay 600s for uploads');
});

test('location /ws still upgrades — REST-only /api/ must not steal that', () => {
  const live = uncommented(locationBody('/ws'));
  assert.ok(live, 'location /ws is missing');
  assert.match(live, /proxy_set_header\s+Upgrade\s+\$http_upgrade/, '/ws lost Upgrade');
  assert.match(
    live,
    /proxy_set_header\s+Connection\s+['"]upgrade['"]/,
    '/ws lost Connection upgrade',
  );
});

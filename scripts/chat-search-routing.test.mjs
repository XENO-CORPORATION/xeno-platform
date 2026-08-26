import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');

test('all production XENO Search routes use the compose service DNS name', () => {
  assert.match(server, /http:\/\/xeno-search:8000\/api\/xeno-search-internal/);
  assert.match(server, /http:\/\/xeno-search:8000\/api\/v2\/engine\/dynamic-search/);
  assert.doesNotMatch(server, /http:\/\/xeno-search-service:8000/);
});

test('search compose variables match the service configuration contract', () => {
  const service = compose.slice(compose.indexOf('\n  xeno-search:'), compose.indexOf('\n  xenorun:'));
  assert.match(service, /BRAVE_SEARCH_API_KEY=/);
  assert.match(service, /SEMANTIC_SEARCH_ENABLED=true/);
  assert.match(service, /SEARCH_ENGINES=duckduckgo,brave/);
  assert.doesNotMatch(service, /\n\s+- BRAVE_API_KEY=/);
  assert.doesNotMatch(service, /\n\s+- ENABLE_SEMANTIC_SEARCH=/);
});

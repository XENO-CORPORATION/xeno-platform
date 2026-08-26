import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url), 'utf8');

test('all production XENO Search routes use the compose service DNS name', () => {
  assert.match(server, /http:\/\/xeno-search:8000\/api\/xeno-search-internal/);
  assert.match(server, /http:\/\/xeno-search:8000\/api\/v2\/engine\/dynamic-search/);
  assert.doesNotMatch(server, /http:\/\/xeno-search-service:8000/);
});

test('search compose variables match the service configuration contract', () => {
  const service = compose.slice(compose.indexOf('\n  xeno-search:'), compose.indexOf('\n  xenorun:'));
  assert.match(service, /BRAVE_SEARCH_API_KEY=/);
  assert.match(service, /SEMANTIC_SEARCH_ENABLED=true/);
  assert.match(service, /SEARCH_ENGINES=\["duckduckgo","brave"\]/);
  assert.doesNotMatch(service, /SEARCH_ENGINES=duckduckgo,brave/);
  assert.doesNotMatch(service, /\n\s+- BRAVE_API_KEY=/);
  assert.doesNotMatch(service, /\n\s+- ENABLE_SEMANTIC_SEARCH=/);
});

test('Research mode uses the authenticated, provider-isolated XENO Search route', () => {
  assert.match(chat, /fetch\('\/api\/xeno-search'/);
  assert.match(chat, /withAuthHeaders\(\{ 'Content-Type': 'application\/json' \}\)/);
  assert.match(chat, /data\.sources \|\| data\.results/);
  assert.doesNotMatch(chat, /performProviderSearch/);
  assert.doesNotMatch(chat, /const \[searchProvider,/);
});

test('Research errors stay visible instead of deleting their placeholder first', () => {
  const errorBranch = chat.indexOf('if (xenoData.error)');
  const emptyBranch = chat.indexOf('if (hasSearchSources)', errorBranch);
  assert.ok(errorBranch >= 0 && emptyBranch > errorBranch);
  assert.match(chat.slice(errorBranch, emptyBranch), /isError: true/);
  assert.doesNotMatch(chat.slice(errorBranch, emptyBranch), /filter\(msg => msg\.id !== searchResultsMessageId\)/);
});

test('single-line language-fenced code remains executable in both answer renderers', () => {
  const executableFenceBranches = chat.match(/if \(match \|\| codeString\.includes\("\\n"\)\)/g) || [];
  assert.equal(executableFenceBranches.length, 2);
  assert.doesNotMatch(chat, /if \(codeString\.includes\("\\n"\)\)/);
});

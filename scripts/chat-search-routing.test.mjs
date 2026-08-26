import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url), 'utf8');
const searchChat = readFileSync(new URL('../src/components/playground/Chat/SearchChatInterface.tsx', import.meta.url), 'utf8');

test('all production XENO Search routes use the compose service DNS name', () => {
  assert.match(server, /http:\/\/xeno-search:8000\/api\/xeno-search-internal/);
  assert.match(server, /http:\/\/xeno-search:8000\/api\/v2\/engine\/dynamic-search/);
  assert.match(server, /api\/v2\/engine\/\$\{provider\}-search/);
  assert.doesNotMatch(server, /http:\/\/xeno-search-service:8000/);
});

test('search compose variables match the service configuration contract', () => {
  const service = compose.slice(compose.indexOf('\n  xeno-search:'), compose.indexOf('\n  xenorun:'));
  assert.match(service, /BRAVE_SEARCH_API_KEY=/);
  assert.match(service, /GOOGLE_CX=\$\{GOOGLE_SEARCH_CX:-\}/);
  assert.match(service, /SEMANTIC_SEARCH_ENABLED=true/);
  assert.match(service, /SEARCH_ENGINES=\["duckduckgo","brave"\]/);
  assert.doesNotMatch(service, /SEARCH_ENGINES=duckduckgo,brave/);
  assert.doesNotMatch(service, /\n\s+- BRAVE_API_KEY=/);
  assert.doesNotMatch(service, /\n\s+- ENABLE_SEMANTIC_SEARCH=/);
});

test('standalone Search sends authenticated requests through platform proxies', () => {
  assert.match(searchChat, /localStorage\.getItem\('xenoos_auth_token'\)/);
  assert.match(searchChat, /Authorization: `Bearer \$\{token\}`/);
  assert.match(searchChat, /endpoint = '\/api\/v2\/engine\/google-search'/);
  assert.match(searchChat, /endpoint = '\/api\/v2\/engine\/brave-search'/);
  assert.match(searchChat, /chatComplete\(/);
  assert.doesNotMatch(searchChat, /fetch\('\/api\/ai\/chat'/);
});

test('standalone Search keeps provider failures visible', () => {
  assert.match(searchChat, /const \[searchError, setSearchError\]/);
  assert.match(searchChat, /Search failed: \$\{searchFailure\}/);
  assert.doesNotMatch(searchChat, /catch \(error\) \{\s*console\.error\('Search error:', error\);\s*return \[\];/);
});

test('Search history fetches conversation detail before restoring a hard-reloaded chat', () => {
  assert.match(searchChat, /const detail = await chatService\.getConversation\(conversation\.id\)/);
  assert.match(searchChat, /setMessages\(loadedMessages\)/);
  assert.match(searchChat, /setSearchResults\(lastResultMessage\?\.searchResults \|\| \[\]\)/);
  assert.match(searchChat, /setSelectedModel\(restoredModel\)/);
  assert.doesNotMatch(searchChat, /const loadConversation = \(conversation: SearchConversation\) => \{\s*setMessages\(conversation\.messages\)/);
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

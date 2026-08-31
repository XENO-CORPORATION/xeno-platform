import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url), 'utf8');
const searchChat = readFileSync(new URL('../src/components/playground/Chat/SearchChatInterface.tsx', import.meta.url), 'utf8');
const webContext = readFileSync(new URL('../src/services/webContextService.ts', import.meta.url), 'utf8');

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

test('Search history stays inside the viewport and is keyboard accessible', () => {
  assert.match(searchChat, /isHistoryOpen\s*\?\s*'calc\(100% - 320px\)'/);
  assert.match(searchChat, /role="button"/);
  assert.match(searchChat, /tabIndex=\{0\}/);
  assert.match(searchChat, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(searchChat, /aria-label=\{`Open search conversation: \$\{conv\.title\}`\}/);
});

test('Research mode uses the canonical XENO Web Context service', () => {
  assert.match(chat, /webContextService\.searchAndFetch/);
  assert.match(webContext, /mode: 'research'/);
  assert.match(webContext, /\/api\/chat\/web-context\/stream/);
  assert.match(webContext, /parseWebJobProgress/);
  assert.doesNotMatch(chat, /fetch\('\/api\/xeno-search'/);
  assert.doesNotMatch(chat, /xenoSearchService|WebSocketProgress/);
});

test('Research errors stay visible instead of deleting their placeholder first', () => {
  assert.match(chat, /Web research failed: \$\{message\}/);
  assert.match(chat, /isLoading: false, isError: !cancelled/);
  assert.match(chat, /Research cancelled\./);
  assert.match(chat, /No public sources were found for this query\. No model answer was generated\./);
});

test('single-line language-fenced code remains executable in both answer renderers', () => {
  const executableFenceBranches = chat.match(/if \(match \|\| codeString\.includes\("\\n"\)\)/g) || [];
  assert.equal(executableFenceBranches.length, 2);
  assert.doesNotMatch(chat, /if \(codeString\.includes\("\\n"\)\)/);
});

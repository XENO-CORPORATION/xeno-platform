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
  assert.match(searchChat, /getAccessToken\(\)/);
  assert.doesNotMatch(searchChat, /localStorage\.(?:getItem|setItem)\([^)]*xenoos_auth_token/);
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

test('single-line language-fenced code remains executable in every answer renderer', () => {
  /* Every markdown `code()` branch in this file must use the executable form. This asserted a
   COUNT of 2 named after "both answer renderers", and the second one was never an answer
   renderer: it was the collapsible THOUGHT box (`message.hasThinking`), deleted on 2026-09-18 when
   a reasoning model with no trace stopped getting a box explaining the absence. So the count went
   to 1 and this suite has been red on main since — over a renderer that is correctly gone.
   Pin the INVARIANT instead: one executable-fence branch per markdown code branch, however many
   renderers exist. Measured 2026-09-19: 1 and 1, with 0 of the broken single-check form. */
  const executableFenceBranches = chat.match(/if \(match \|\| codeString\.includes\("\\n"\)\)/g) || [];
  const markdownCodeBranches = chat.match(/if \(!inline\) \{/g) || [];
  assert.ok(markdownCodeBranches.length >= 1,
    'no markdown code branch found — this assertion has drifted from the file and proves nothing');
  assert.equal(executableFenceBranches.length, markdownCodeBranches.length,
    `every markdown code branch must keep one-line fenced code executable: ${executableFenceBranches.length} `
    + `executable branch(es) for ${markdownCodeBranches.length} code branch(es)`);
  assert.doesNotMatch(chat, /if \(codeString\.includes\("\\n"\)\)/);
});

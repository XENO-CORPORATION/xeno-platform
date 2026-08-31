import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const chat = read('../src/components/playground/Chat/ChatWithLLM.tsx');
const chatService = read('../src/services/chatService.ts');
const route = read('../src/server/routes/chatRoutes.js');
const index = read('../src/server/index.js');
const migration = read('../src/server/database/migrations/20260831120000-chat-web-context-receipts.sql');

test('Research and retry use only the canonical Web Context Chat seam', () => {
  assert.match(chat, /webContextService\.searchAndFetch/);
  assert.match(chat, /BEGIN_UNTRUSTED_WEB_EVIDENCE bytes=/);
  assert.match(chat, /webContextReceiptId/);
  assert.doesNotMatch(chat, /\/api\/xeno-search|xenoSearchService|\/ws\/deep-search|\/api\/v2\/engine\/topic-search/);
  assert.match(chat, /depth: isXenoDeepMode \? 'deep' : 'quick'/);
  assert.match(chat, /applyWebContextProgress/);
  assert.match(chat, /researchController\.abort|setAbortController\(researchController\)/);
  assert.match(route, /router\.post\('\/web-context\/stream', requireActivated/);
});

test('user persistence is awaited before Web Context starts and assistant persistence is acknowledged', () => {
  assert.match(chat, /const persistedUserMessage = await chatService\.addMessage/);
  assert.match(chat, /if \(isXenoSearchEnabled\) return/);
  assert.match(chat, /const persistedAssistantMessage = await chatService\.addMessage/);
  assert.match(chat, /isPersistenceError: true/);
  assert.match(chatService, /Failed to add message:[\s\S]*throw error/);
});

test('server owns evidence, consumes a one-time receipt, and detaches it on edit', () => {
  assert.match(route, /router\.post\('\/web-context\/search', requireActivated/);
  assert.match(route, /client_search_context_forbidden/);
  assert.match(route, /consumed_message_id IS NULL AND expires_at > NOW\(\)/);
  assert.match(route, /user_message_id = \([\s\S]*ORDER BY message_index DESC LIMIT 1/);
  assert.match(route, /FOR UPDATE/);
  assert.match(route, /UPDATE chat_web_context_receipts SET consumed_message_id=\$2/);
  assert.match(route, /updates\.push\('search_context = NULL'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS chat_web_context_receipts/);
  assert.match(migration, /search_context->>'schema' = 'xeno\.chat\.web-context\.v1'/);
});

test('Web Context endpoint has the generation limiter and never logs the query', () => {
  assert.match(index, /app\.use\('\/api\/chat\/web-context', generationLimiter\)/);
  const routeBlock = route.slice(route.indexOf("router.post('/web-context/search'"), route.indexOf('// DATABASE INITIALIZATION'));
  assert.doesNotMatch(routeBlock, /console\.(?:log|warn)[\s\S]{0,200}\bquery\b/);
});

test('Research streaming validates first, forwards canonical progress, and aborts upstream on disconnect', () => {
  const stream = route.slice(route.indexOf("router.post('/web-context/stream'"), route.indexOf('// DATABASE INITIALIZATION'));
  assert.match(stream, /resolveWebContextTurn\(req, res\)[\s\S]*Content-Type', 'text\/event-stream/);
  assert.match(stream, /onProgress: \(progress\) => \{ writeEvent\('progress', progress\); \}/);
  assert.match(stream, /writeEvent\('result'/);
  assert.match(stream, /writeEvent\('error'/);
  assert.match(stream, /req\.once\('aborted', abort\)/);
  assert.match(stream, /res\.once\('close'/);
  const adapter = read('../src/server/services/chatWebContext.js');
  assert.match(adapter, /cancelOnAbort: true/);
  assert.match(adapter, /cancelOnTimeout: true/);
  assert.match(adapter, /new WebContextClient/);
});

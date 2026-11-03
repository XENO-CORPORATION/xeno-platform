/**
 * The streamed chat route must notice when the person leaves.
 *
 * It listened only to `req` 'close'. Express has already read the body by the time the route runs,
 * and Node emits the request's 'close' then, so a listener added afterwards never fires. On
 * production (2026-11-03, both chat loops) a dropped connection left its credit holds reserved until
 * the 15-minute sweep and the turn kept calling the model. The first test pins that Node behaviour so
 * nobody "simplifies" back to `req`; the others pin the route's wiring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const route = await readFile(new URL('../src/server/routes/aiRoutes.js', import.meta.url), 'utf8');
const streamHandler = route.slice(route.indexOf("router.post('/chat/stream'"));

test('🔴 after the body is read, only res "close" reports a client that left', async () => {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* read the body, as express.json does */ }
    await new Promise((resolve) => setTimeout(resolve, 20));
    req.on('close', () => seen.push('req'));
    res.on('close', () => seen.push(res.writableEnded ? 'res-ended' : 'res-gone'));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const timer = setInterval(() => res.write('data: x\n\n'), 20);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', body: '{"a":1}', signal: controller.signal });
  await res.body.getReader().read();
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 300));
  server.close();
  assert.deepEqual(seen, ['res-gone']);
});

test('the stream route treats res "close" as the person leaving', () => {
  assert.match(streamHandler, /res\.on\('close', resolveOnDisconnect\)/);
  // A normal end also closes the response; the handler must ignore that one.
  assert.match(streamHandler, /const resolveOnDisconnect = \(\) => \{\s*if \(res\.writableEnded\) return;/);
});

test('a full client buffer stops waiting when the person leaves', () => {
  const send = streamHandler.slice(streamHandler.indexOf('const send = async'), streamHandler.indexOf('KEEPALIVE'));
  assert.match(send, /res\.once\('close', done\)/);
  assert.doesNotMatch(send, /req\.once\('close'/);
});

test('🔴 no new credit hold is placed for a person who has left', () => {
  const meterFor = streamHandler.slice(streamHandler.indexOf('const meterFor = async'), streamHandler.indexOf('const resolveAllMeters'));
  assert.match(meterFor, /if \(clientGone\) throw clientGoneError\(\);\s*const next =/);
  // A hold placed while the person was leaving is resolved at once, not left to the sweep.
  assert.match(meterFor, /meters\.push\(next\);[\s\S]*if \(clientGone\) \{\s*await settleBestEffort\(\)/);
});

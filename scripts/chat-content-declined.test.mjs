/**
 * A model that REFUSES a message must surface as a clear decline, not "Invalid response format".
 *
 * ## The live failure this pins (2026-09-26)
 *
 * A user sent a message the provider would not answer. The upstream stream closed normally with
 * `finish_reason: "content_filter"` and NO content, so `/api/ai/chat/stream` shaped it into a blank
 * successful `result` frame. The client, expecting text, threw its own
 * "Invalid response format from server when reasoning was expected" — an error about our JSON, for a
 * refusal about the message. Reproduced against the live gateway: `claude-opus-5-5-medium`, the same
 * message, returned 0 output tokens with `finish_reason: "content_filter"` every time.
 *
 * The fix is a pure decision (`isContentDeclined`) the route calls before it sends the result frame,
 * so a declined turn emits `{type:'error', error:'content_declined', message: …}` — which the client
 * already turns into a readable message with a retry — and billing still resolves first (0 output
 * tokens ⇒ the hold is voided, nothing charged).
 *
 * Mutation-checked: each break below fails a named case, and there is a green control.
 *   - drop the `hasText`/`hasImage` guard  -> "a real answer is never a decline" fails
 *   - widen the finish set (e.g. add 'stop') -> "an ordinary empty stop is not a decline" fails
 *   - stop calling the helper in the route  -> the reachability test fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isContentDeclined, DECLINED_FINISH_REASONS } from '../src/server/utils/xenoChat.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE = readFileSync(join(ROOT, 'src', 'server', 'routes', 'aiRoutes.js'), 'utf8').replace(/\r\n/g, '\n');

test('a refusal with no output IS a decline', () => {
  assert.equal(isContentDeclined('content_filter', { hasText: false, hasImage: false }), true);
  assert.equal(isContentDeclined('refusal', { hasText: false, hasImage: false }), true);
});

test('a real answer is never a decline, even if a fragment carried a filter flag', () => {
  assert.equal(isContentDeclined('content_filter', { hasText: true, hasImage: false }), false);
  assert.equal(isContentDeclined('content_filter', { hasText: false, hasImage: true }), false);
});

test('an ordinary empty stop is NOT a decline — only a refusal reason is', () => {
  assert.equal(isContentDeclined('stop', { hasText: false, hasImage: false }), false);
  assert.equal(isContentDeclined('tool_calls', { hasText: false, hasImage: false }), false);
  assert.equal(isContentDeclined(null, { hasText: false, hasImage: false }), false);
  assert.equal(isContentDeclined(undefined, {}), false);
});

test('the declared refusal reasons are exactly the two the gateway emits', () => {
  assert.deepEqual([...DECLINED_FINISH_REASONS].sort(), ['content_filter', 'refusal']);
});

test('the stream route REACHES the decline: it captures the finish reason and calls the helper before the result frame', () => {
  // captures the reason off each chunk
  assert.match(ROUTE, /lastFinishReason = finish/);
  // calls the pure decision with both real answer signals
  assert.match(ROUTE, /isContentDeclined\(lastFinishReason, \{ hasText: Boolean\(assembledText\.trim\(\)\), hasImage: imagesMade\.length > 0 \}\)/);
  // and does so BEFORE building/sending the result frame (order is the whole point)
  const declineAt = ROUTE.indexOf('isContentDeclined(lastFinishReason');
  const resultAt = ROUTE.indexOf("await send({\n    type: 'result',");
  assert.ok(declineAt > 0 && resultAt > 0 && declineAt < resultAt, 'the decline branch must precede the result frame');
  // the error it emits is the distinct code the client can act on
  assert.match(ROUTE, /error: 'content_declined'/);
});

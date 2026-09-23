import assert from 'node:assert/strict';
import test from 'node:test';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { webhookRetryDelay, MAX_WEBHOOK_RETRY_DELAY_MS } from '../src/server/services/webhookRetryPolicy.js';
import { WebhookDeliveryWorker } from '../src/server/services/webhookDelivery.js';
import { safeRequest } from '../src/server/utils/safeEndpoint.js';

test('bounded HTTP transport exposes Retry-After without exposing other response headers', async t => {
  t.mock.method(https, 'request', (_options, receive) => {
    const request = new EventEmitter(); request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter(); response.statusCode = 429; response.destroy = () => {};
      response.headers = { 'retry-after': '120', 'set-cookie': 'PRIVATE_RESPONSE_COOKIE', authorization: 'PRIVATE_RESPONSE_AUTH' };
      receive(response); response.emit('data', Buffer.from('{}')); response.emit('end');
    });
    return request;
  });
  assert.deepEqual(await safeRequest('https://example.test/fixture'), { status: 429, body: '{}', retryAfter: '120' });
});

test('receiver delay never shortens exponential backoff and supports HTTP dates', () => {
  const now = Date.parse('Sat, 05 Sep 2026 12:00:00 GMT');
  assert.equal(webhookRetryDelay(1), 30000);
  assert.equal(webhookRetryDelay(1, '1', now), 30000);
  assert.equal(webhookRetryDelay(1, '120', now), 120000);
  assert.equal(webhookRetryDelay(1, 'Sat, 05 Sep 2026 12:03:00 GMT', now), 180000);
  assert.equal(webhookRetryDelay(1, 'Sat, 05 Sep 2026 11:00:00 GMT', now), 30000);
});
test('malformed fields use fallback; excessive valid delays refuse rather than wrap or shorten', () => {
  for (const value of [undefined, '', '-1', '1e3', '1.5', 'private-token', ['120'], 'Sunday nonsense']) assert.equal(webhookRetryDelay(1, value), 30000);
  assert.equal(webhookRetryDelay(1, '999999999999999999999999999999999'), null);
  assert.equal(webhookRetryDelay(1, String(Math.floor(MAX_WEBHOOK_RETRY_DELAY_MS / 1000) + 1)), null);
});
test('queue worker passes receiver scheduling to its settlement method', async () => {
  for (const [status, retryAfter, expectedState, expectedDelay] of [[429, '120', 'queued', 120000], [503, '120', 'queued', 120000], [429, '99999999999999', 'failed', 0], [204, '99999999999999', 'delivered', 0]]) {
    let settlement;
    const db = { query: async () => ({ rows: [{ url: 'https://example.test/hook', secret: null }] }) };
    const worker = new WebhookDeliveryWorker(db, { transport: async () => ({ status, body: '', retryAfter }) });
    worker.claim = async () => ({ id: 'fixture', event: 'fixture', payload: {}, attempt: 1, max_attempts: 5, created_at: '2026-09-05T12:00:00Z' });
    worker.settle = async (_delivery, value) => { settlement = value; return true; };
    await worker.tick(); worker.close();
    assert.equal(settlement.state, expectedState); assert.equal(settlement.delayMs, expectedDelay);
    if (expectedState === 'failed') assert.equal(settlement.code, 'delivery_retry_after_out_of_range');
    assert.equal(worker.active.size, 0);
  }
});

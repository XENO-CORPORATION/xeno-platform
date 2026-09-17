/**
 * A gateway 4xx is the CALLER's mistake and keeps its status; only an
 * unexplained failure is a 500.
 *
 * Dogfooding 2026-09-17: `POST /api/ai/chat` with a model id that does not
 * exist answered `500 "AI generation failed"` while the gateway had said
 * `404 model_not_found` with a sentence. The customer was told the platform
 * broke.
 *
 * Mutations: return null for 404 in classifyUpstreamError -> the first test
 * fails. Forward the raw provider body -> "never the raw body" fails. Drop the
 * classifier call from the JSON route -> the wiring test fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyUpstreamError } from '../src/server/utils/xenoChat.js';

const gatewayError = (status, body) => {
  const e = new Error(`XENO API error: ${status} - ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  e.status = status;
  return e;
};

test('an unknown model is a 404 with the provider sentence, not a 500', () => {
  const r = classifyUpstreamError(gatewayError(404, { error: { message: 'The model `gpt-4o-mini` does not exist or you do not have access to it.', type: 'invalid_request_error', code: 'model_not_found' } }));
  assert.deepEqual(r, { status: 404, body: { error: 'model_not_found', message: 'The model `gpt-4o-mini` does not exist or you do not have access to it.' } });
});

test('400 / 413 / 422 / 429 keep their status; a missing sentence gets a safe default', () => {
  assert.equal(classifyUpstreamError(gatewayError(400, { error: { message: 'max_tokens too large', code: 'invalid_request_error' } })).status, 400);
  assert.equal(classifyUpstreamError(gatewayError(413, 'payload too large')).status, 413);
  assert.deepEqual(classifyUpstreamError(gatewayError(422, '')).body, { error: 'invalid_request', message: 'The inference request was rejected.' });
  assert.deepEqual(classifyUpstreamError(gatewayError(429, { error: { message: 'slow down' } })).body, { error: 'rate_limited', message: 'slow down' });
});

test('our credential being refused is 503 and blames us; a provider 5xx is 502; unknown shapes stay null', () => {
  const ours = classifyUpstreamError(gatewayError(401, { error: { message: 'invalid api key sk-live-XXXX' } }));
  assert.equal(ours.status, 503);
  assert.ok(!ours.body.message.includes('sk-live'), 'never the provider detail for our own credential');
  assert.equal(classifyUpstreamError(gatewayError(502, 'bad gateway')).status, 502);
  assert.equal(classifyUpstreamError(gatewayError(500, { error: { message: 'internal' } })).body.error, 'upstream_error');
  assert.equal(classifyUpstreamError(new Error('ECONNRESET')), null, 'a non-HTTP failure is not classified');
  assert.equal(classifyUpstreamError(gatewayError(302, '')), null);
});

test('never the raw body: only a bounded message and a slug-shaped code pass through', () => {
  const r = classifyUpstreamError(gatewayError(400, { error: { message: 'x'.repeat(401), code: 'DROP TABLE; --', internal_trace: 'secret' } }));
  assert.equal(r.body.error, 'invalid_request', 'a non-slug code is replaced');
  assert.equal(r.body.message, 'The inference request was rejected.', 'an oversized message is replaced');
  assert.ok(!('internal_trace' in r.body));
});

test('both chat routes use the classifier', () => {
  const src = readFileSync(new URL('../src/server/routes/aiRoutes.js', import.meta.url), 'utf8');
  const jsonCatch = src.slice(src.indexOf("console.error(`[AI Chat] Error (path=${inferencePath}"), src.indexOf("return res.status(500).json({ error: 'AI generation failed', model });", src.indexOf("console.error(`[AI Chat] Error (path=${inferencePath}")));
  assert.match(jsonCatch, /classifyUpstreamError\(error\)/, 'the JSON route classifies before falling back to 500');
  const streamCatch = src.slice(src.indexOf("console.error('[chat/stream] upstream failed'"), src.indexOf('endStream();', src.indexOf("console.error('[chat/stream] upstream failed'")));
  assert.match(streamCatch, /classifyUpstreamError\(error\)/, 'the stream classifies its in-band error');
});

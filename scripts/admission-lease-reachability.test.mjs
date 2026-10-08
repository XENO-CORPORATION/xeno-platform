/**
 * admission-lease-reachability.test.mjs — every metered chat call hands the provider the ceiling its reservation
 * covers, and never the ceiling that was requested.
 *
 * Why a source gate: a call site that sends the requested ceiling under-reserves silently. The provider can then
 * produce more than the hold covers, and settlement is bounded by the balance rather than by the reservation, so
 * nothing fails at the time and the difference is charged to nobody. The pricing rule itself is pinned in
 * admission-lease.test.mjs; the database behaviour is pinned in admission-lease-database.test.mjs.
 *
 * Mutation checks (each verified to fail the named assertion):
 *   - restore `max_tokens` (the request) in the non-streaming chat run  -> "the non-streaming chat route ..."
 *   - drop the per-call grant from the streaming tool loop              -> "the streaming route ..."
 *   - restore `max_tokens: 4096` in the scheduled worker run            -> "no chat run closure ..."
 *   - remove the capped headers or their cross-origin exposure          -> "a capped reply says so ..."
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Line endings are normalised: a Windows checkout with core.autocrlf writes CRLF, and every pattern below is LF.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const meter = read('src/server/utils/inferenceMeter.js');
const routes = read('src/server/routes/aiRoutes.js');
const index = read('src/server/index.js');
const worker = read('src/server/workers/chatScheduledWorker.js');

test('both chat meters reserve on the lease, so the reservation is the granted ceiling', () => {
  const leased = meter.match(/lease: \{ model, inputTokens: estInputTokens, requestedOutputTokens: maxTokens \}/g) ?? [];
  assert.equal(leased.length, 2, 'the non-streaming and the streaming meter both reserve as a lease');
});

test('the non-streaming meter runs the provider with the ceiling the hold covers', () => {
  assert.match(meter, /result = await run\(\{ maxOutputTokens: admitted\.grantedOutputTokens \}\);/);
});

test('the streaming meter reports its granted ceiling to the route before the stream opens', () => {
  assert.match(meter, /\.\.\.admitted,\n\s+get settled\(\)/);
});

test('the non-streaming chat route sends the granted ceiling upstream', () => {
  assert.match(routes, /run: \(\{ maxOutputTokens \}\) => callXenoApi\(model, messages, temperature, maxOutputTokens,/);
});

test('the streaming route sends each upstream call its own granted ceiling, plain path and tool loop alike', () => {
  assert.match(routes, /async function\* streamOneCall\(\{ messages: callMessages, tools, signal, maxOutputTokens \}\) \{/);
  assert.match(routes, /max_tokens: maxOutputTokens,\n\s+signal,/);
  assert.match(routes, /messages: finalMessages, tools: \[\], signal: upstreamAbort\.signal,\n\s+maxOutputTokens: meter\.grantedOutputTokens,/);
  assert.match(routes, /const callMeter = await meterFor\(index\);/);
  assert.match(routes, /messages: loopMessages, tools, signal: upstreamAbort\.signal,\n\s+maxOutputTokens: callMeter\.grantedOutputTokens,/);
});

test('the prompt-refinement and model-call paths send the granted ceiling upstream', () => {
  assert.match(index, /run: \(\{ maxOutputTokens \}\) => xenoChatCompletion\(\{ model: selectedModelId, messages: apiMessages, max_tokens: maxOutputTokens \}\)/);
  assert.match(index, /run: async \(\{ maxOutputTokens \}\) => \{\n\s+\/\/[^\n]*\n\s+payload\.max_tokens = maxOutputTokens;/);
});

test('the scheduled chat worker sends the granted ceiling upstream', () => {
  assert.match(worker, /run: \(\{ maxOutputTokens \}\) => Promise\.race\(\[/);
  assert.match(worker, /max_tokens: maxOutputTokens,/);
});

test('no chat run closure sends the requested ceiling upstream', () => {
  assert.doesNotMatch(routes, /run: \(\) => callXenoApi\(model, messages, temperature, max_tokens/);
  assert.doesNotMatch(index, /run: \(\) => xenoChatCompletion\(\{ model: selectedModelId, messages: apiMessages \}\)/);
  assert.doesNotMatch(worker, /max_tokens: 4096/);
});

test('a capped reply says so in headers, set before any body, and browsers can read them', () => {
  assert.match(routes, /function setAdmissionHeaders\(res, admitted\) \{/);
  assert.match(routes, /if \(metered\.capped\) setAdmissionHeaders\(res, metered\);/);
  assert.match(routes, /if \(meter\.capped\) setAdmissionHeaders\(res, meter\);/);
  assert.match(index, /exposedHeaders: \['X-Xeno-Max-Output-Granted', 'X-Xeno-Max-Output-Requested'\]/);
});

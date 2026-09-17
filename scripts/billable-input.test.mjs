/**
 * The customer pays for the tokens THEY sent — never for a route's harness prompt.
 *
 * Dogfooding 2026-09-17 (F14): a six-word prompt billed 642 input tokens; ~630 of
 * them were a harness prompt the caller never wrote. OpenAI / Anthropic / OpenRouter
 * bill exactly the request. This pins the rule in utils/billableInput.js.
 *
 * Mutations: return `reported` unconditionally -> test 1 fails. Drop HEADROOM ->
 * "a legitimately longer provider count is never under-billed" fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callerInputTokens, billableInputTokens } from '../src/server/utils/billableInput.js';

const SIX_WORDS = [{ role: 'user', content: 'Reply with the single word OK' }];

test('a harness prompt the caller never sent is not billed to them', () => {
  const caller = callerInputTokens(SIX_WORDS);
  assert.ok(caller >= 8 && caller <= 20, `six words tokenize to ~11, got ${caller}`);
  const billed = billableInputTokens(642, caller, 'xai');
  assert.ok(billed < 60, `642 reported for an ~11-token request bills at most ~47, got ${billed}`);
  assert.ok(billed >= caller, 'and never less than what they actually sent');
});

test('a legitimately longer provider count is never under-billed', () => {
  // Claude counts ~12% more than tiktoken; with 30% headroom a 1000-token tiktoken
  // request reported as 1200 by Anthropic is billed in full.
  assert.equal(billableInputTokens(1200, 1000, 'anthropic'), 1200);
  assert.equal(billableInputTokens(1300, 1000, 'google'), 1300);
  // Reported below the cap is always billed as reported (the cap only cuts overhead).
  assert.equal(billableInputTokens(12, 11, 'xai'), 12);
  assert.equal(billableInputTokens(0, 11, 'xai'), 0);
});

test('unknown caller count = bill as reported (fail toward the customer paying, never toward free)', () => {
  assert.equal(billableInputTokens(642, null, 'xai'), 642);
  assert.equal(billableInputTokens(642, undefined, 'xai'), 642);
  assert.equal(billableInputTokens('642', NaN, 'xai'), 642);
});

test('callerInputTokens counts what the request carries: text, names, tool calls, images', () => {
  const plain = callerInputTokens([{ role: 'user', content: 'hello' }]);
  const withTool = callerInputTokens([{ role: 'user', content: 'hello' }, { role: 'assistant', tool_calls: [{ id: 'x', function: { name: 'search', arguments: '{"q":"weather"}' } }] }]);
  const withImage = callerInputTokens([{ role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'image_url', image_url: { url: 'data:...' } }] }]);
  assert.ok(withTool > plain, 'tool calls are the caller\'s tokens');
  assert.ok(withImage >= plain + 1200, 'an image is ~1200 prompt tokens');
  assert.equal(callerInputTokens([]), 0);
  assert.equal(callerInputTokens(null), 0);
});

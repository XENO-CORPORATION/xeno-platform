import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { reasoningCapabilityForModel, reasoningEffortForModel } from '../src/server/lib/chatModelCapabilities.js';

const TOGGLEABLE = [
  'grok-4.6',
  'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.4',
];
const FIXED = [
  'grok-4.6-high-fast', 'grok-4.5-high-fast', 'grok-4.6-minimal',
  'grok-4.20-0309-reasoning', 'gpt-5.4-thinking', 'gpt-5.5-thinking',
  'claude-sonnet-4-6-thinking',
];
const DISABLED = [
  'llama3.1-8B', 'grok-4.5', 'grok-build-0.1', 'grok-build', 'grok-4.3',
  'grok-4.20-0309-non-reasoning', 'grok-4.20-multi-agent-0309', 'grok-3-mini-fast',
  'grok-3-mini', 'grok-composer-2.5-fast', 'gpt-5.4-pro', 'gpt-5.5-pro',
  'gpt-5.4-t-mini', 'gemini-3-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-agent',
  'gemini-3.1-flash-image', 'gemini-pro-agent', 'claude-sonnet-4-6', 'composer-2.5',
  'mimo-v2.5-free', 'big-pickle', 'x-preview-f-free', 'hy3-free', 'laguna-s-2.1-free',
  'composer-2.5-fast', 'deepseek-v4-flash', 'nemotron-3.5-lightning-free',
];

test('the full live text catalog has an explicit truthful reasoning contract', () => {
  for (const id of TOGGLEABLE) assert.equal(reasoningCapabilityForModel(id), 'toggleable', id);
  for (const id of FIXED) assert.equal(reasoningCapabilityForModel(id), 'alwaysOn', id);
  for (const id of DISABLED) assert.equal(reasoningCapabilityForModel(id), 'disabled', id);
  assert.equal(TOGGLEABLE.length + FIXED.length + DISABLED.length, 42);
});

test('only toggleable models receive the preferred reasoning_effort field', () => {
  for (const id of TOGGLEABLE) assert.equal(reasoningEffortForModel(id, true), 'high', id);
  for (const id of [...FIXED, ...DISABLED]) assert.equal(reasoningEffortForModel(id, true), null, id);
  assert.equal(reasoningEffortForModel('grok-4.6', false), null);
});

test('provider-prefixed legacy IDs resolve through the same contract', () => {
  assert.equal(reasoningCapabilityForModel('x-ai/grok-4.6'), 'toggleable');
  assert.equal(reasoningCapabilityForModel('anthropic/claude-sonnet-4-6-thinking'), 'alwaysOn');
  assert.equal(reasoningCapabilityForModel('openai/o3-mini'), 'alwaysOn');
});

test('the chat route sends the preferred field and catalog uses the shared contract', () => {
  const server = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
  assert.match(server, /reasoningCapabilityForModel\(id\)/);
  assert.match(server, /bodyPayload\.reasoning_effort = reasoningEffort/);
  assert.doesNotMatch(server, /function isReasoningCapableModel/);
});

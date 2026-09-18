/**
 * Reasoning effort — the levels the gateway proves exist, offered per model, sent as the
 * gateway models them. Replaces the composer's on/off brain toggle (2026-09-19), which meant
 * "send effort=medium" and knew nothing about the suffixed ids the catalogue carries.
 *
 *   node --test scripts/chat-reasoning-effort.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEffortFamilies, effortOptionsFor, splitEffort } from '../src/server/utils/reasoningEffortFamilies.js';
import { effortOptionFor, requestShapeFor, effortLabel } from '../src/components/playground/Chat/chatReasoningEffort.ts';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// the live gateway's shape on 2026-09-19
const IDS = [
  'claude-sonnet-5', 'claude-sonnet-5-low', 'claude-sonnet-5-medium', 'claude-sonnet-5-high', 'claude-sonnet-5-xhigh', 'claude-sonnet-5-max',
  'grok-4.6', 'grok-4.6-low',
  'gpt-5.5',
  'gemini-3-pro', 'gemini-3-pro-low', 'gemini-3-pro-high',
  'devin/deepseek-v4-1-flash-high', 'devin/deepseek-v4-1-flash-max',
  'grok-4.6-high-fast', 'deepseek-reasoner', 'gpt-4.1',
];

test('families: one per base id, a level per suffixed variant, auto first when the bare id exists — max included', () => {
  const f = buildEffortFamilies(IDS);
  assert.deepEqual(f.get('claude-sonnet-5').map((o) => o.effort), ['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(f.get('gemini-3-pro').map((o) => o.effort), ['auto', 'low', 'high']);
  assert.deepEqual(f.get('devin/deepseek-v4-1-flash').map((o) => o.effort), ['high', 'max'], 'two variants and no bare id is still a family');
  assert.equal(f.get('grok-4.6-high-fast'), undefined, '`-fast` is a model name, not a level');
  assert.equal(splitEffort('grok-4.6-high-fast'), null);
  assert.deepEqual(splitEffort('claude-sonnet-5-max'), { baseId: 'claude-sonnet-5', effort: 'max' });
});

test('options per model: suffixed ids win, the toggleable set adds the parameter levels, fixed and plain models offer nothing', () => {
  const f = buildEffortFamilies(IDS);
  const claude = effortOptionsFor('claude-sonnet-5', f, 'disabled');
  assert.equal(claude.length, 6);
  assert.ok(claude.every((o) => o.via === 'id'), 'every Claude level is a catalogue id');
  const grok = effortOptionsFor('grok-4.6', f, 'toggleable');
  assert.deepEqual(grok.map((o) => `${o.effort}:${o.via}`), ['auto:id', 'low:id', 'medium:param', 'high:param'], 'the catalogue id for low, the parameter for the rest');
  const gpt = effortOptionsFor('gpt-5.5', f, 'toggleable');
  assert.deepEqual(gpt.map((o) => o.effort), ['auto', 'low', 'medium', 'high']);
  assert.deepEqual(effortOptionsFor('deepseek-reasoner', f, 'alwaysOn'), [], 'a fixed-reasoning model has nothing to choose');
  assert.deepEqual(effortOptionsFor('gpt-4.1', f, 'disabled'), [], 'a non-reasoning model with no variants has nothing to choose');
});

test('client: the option in force is the remembered level if the model still offers it, else auto', () => {
  const model = { id: 'claude-sonnet-5', efforts: [{ effort: 'auto', modelId: 'claude-sonnet-5', via: 'id' }, { effort: 'high', modelId: 'claude-sonnet-5-high', via: 'id' }] };
  assert.equal(effortOptionFor(model, {}).effort, 'auto');
  assert.equal(effortOptionFor(model, { 'claude-sonnet-5': 'high' }).effort, 'high');
  assert.equal(effortOptionFor(model, { 'claude-sonnet-5': 'max' }).effort, 'auto', 'a level the model no longer offers falls back, never sends a nonexistent id');
  assert.equal(effortOptionFor({ id: 'gpt-4.1' }, { 'gpt-4.1': 'high' }).effort, 'auto');
});

test('client: the request shape — suffixed id for `id`, bare id + parameter for `param`, auto sends neither', () => {
  assert.deepEqual(requestShapeFor('claude-sonnet-5', { effort: 'high', modelId: 'claude-sonnet-5-high', via: 'id' }), { modelId: 'claude-sonnet-5-high', reasons: true });
  assert.deepEqual(requestShapeFor('grok-4.6', { effort: 'medium', modelId: 'grok-4.6', via: 'param' }), { modelId: 'grok-4.6', reasoningEffort: 'medium', reasons: true });
  assert.deepEqual(requestShapeFor('grok-4.6', { effort: 'auto', modelId: 'grok-4.6', via: 'id' }), { modelId: 'grok-4.6', reasons: false });
  assert.deepEqual(requestShapeFor('claude-sonnet-5', { effort: 'none', modelId: 'claude-sonnet-5-none', via: 'id' }), { modelId: 'claude-sonnet-5-none', reasons: false }, '`none` selects the id and expects no thought');
  assert.equal(effortLabel('xhigh'), 'X-High');
});

test('reachability: the brain toggle is gone, the control is mounted, the level rides the request end to end', () => {
  const chat = src('../src/components/playground/Chat/ChatWithLLM.tsx');
  assert.equal(chat.includes('setIsReasonToggled'), false, 'the on/off toggle no longer exists');
  assert.match(chat, /<ChatEffortControl model=\{selectedModel\} value=\{selectedEffort\} onChange=\{chooseEffort\}/, 'the control sits where the toggle was');
  assert.match(chat, /const effortShape = requestShapeFor\(baseModelId, effortOptionFor\(currentModel, effortPrefs\)\);/, 'the send path derives id + parameter from the chosen option');
  assert.match(chat, /let actualModelIdForApi = taskArg !== 'image' \? effortShape\.modelId : baseModelId;/, 'a suffixed id is what gets sent');
  assert.match(chat, /reasoningEffort: taskArg !== 'image' \? effortShape\.reasoningEffort : undefined,/, 'the parameter rides the payload');
  const stream = src('../src/components/playground/Chat/chatStream.ts');
  assert.match(stream, /reasoningEffort: payload\.reasoningEffort,/, 'and the stream body carries it');
  const ai = src('../src/server/routes/aiRoutes.js');
  assert.match(ai, /reasoningEffort: requestedEffort/, 'the stream route reads it');
  assert.match(ai, /reasoning: \{ effort: \['low', 'medium', 'high'\]\.includes\(requestedEffort\) \? requestedEffort : 'medium' \}/, 'and sends the chosen level, never a bare medium');
  const index = src('../src/server/index.js');
  assert.match(index, /const efforts = effortOptionsFor\(String\(model\.id\), effortFamilies, supportsReasoning\);/, '/api/models attaches the levels per model');
  assert.match(index, /\.\.\.\(efforts\.length \? \{ efforts \} : \{\}\),/);
  const control = src('../src/components/playground/Chat/ChatEffortControl.tsx');
  assert.match(control, /from '@xenosystem\/agent-conversation\/components\/agent\/composer\/EffortCells'/, 'the cells COME from the conversation package (D7d), not a copy');
  assert.match(control, /if \(options\.length < 2\) return null;/, 'nothing to choose → nothing rendered');
  const css = src('../src/components/playground/Chat/chat-theme.css');
  assert.match(css, /\.chat-effort\.xa-dock \{ padding: 0; container-type: normal; \}/);
});

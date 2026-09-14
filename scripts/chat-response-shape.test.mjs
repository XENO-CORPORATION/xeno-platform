/**
 * Shaping the model's completion into the response the client expects.
 *
 * ## Why this module exists
 *
 * Measured 2026-09-14: the chat client reads 13 fields off the response, and
 * `/api/ai/chat/stream` produced 5. Four of the missing ones — `answer`, `thinking`,
 * `reasoningProcessed`, `modelIdUsed` — were built by ~190 lines living only inside
 * `/api/chat/generate`, so no second route could serve a chat turn without the client
 * losing reasoning display, thinking panes and model attribution.
 *
 * 🔴 The code was MOVED VERBATIM, not retyped. Every branch is model-specific handling:
 * Qwen and DeepSeek-R1 emit reasoning in a separate field, sometimes with the answer
 * duplicated inside it, sometimes with an empty content field and the answer trailing the
 * thinking after a blank line. Retyping is how a subtle case silently stops working — and
 * the failure is invisible, because the turn still answers, it just shows the wrong half.
 *
 * ⚠️ Two things went wrong while extracting it, both worth knowing:
 *   - the "obvious" end of the block is INSIDE an if/else chain, so a naive cut produces
 *     unbalanced braces (it did)
 *   - the first equivalence corpus used `qwen/qwen3-max`, whose reasoning capability is
 *     `disabled` — so it never entered the branch it was meant to exercise and a mutation
 *     removing the final cleaner passed. A corpus that does not reach the code proves nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeChatResponse } from '../src/server/utils/chatResponseShape.js';
import { reasoningCapabilityForModel } from '../src/server/lib/chatModelCapabilities.js';

const completion = (content, reasoning) => ({
  choices: [{ message: { content, ...(reasoning ? { reasoning } : {}) } }],
});
const NL = String.fromCharCode(10);

/** A model that actually reports reasoning separately — see the corpus lesson above. */
const REASONING_MODEL = 'deepseek/deepseek-r1';

test('the fixture model really does provide separate reasoning', () => {
  // Guards the corpus itself: if this flips to `disabled`, every reasoning test below
  // silently stops exercising the branch it claims to cover.
  assert.notEqual(
    reasoningCapabilityForModel(REASONING_MODEL), 'disabled',
    'the reasoning tests need a model whose capability is not "disabled", or they pass vacuously',
  );
});

test('a plain turn returns text and says reasoning was not processed', () => {
  const out = shapeChatResponse({
    data: completion('Hello'), outputText: 'Hello',
    selectedModelId: 'openai/gpt-5.5', effectiveReasoningState: false,
  });
  assert.equal(out.text, 'Hello');
  assert.equal(out.reasoningProcessed, false);
  assert.equal(out.modelIdUsed, 'openai/gpt-5.5', 'the client shows which model answered');
});

test('🔴 separate reasoning becomes answer + thinking', () => {
  const out = shapeChatResponse({
    data: completion('Paris', 'Weighing the options'), outputText: 'Paris',
    selectedModelId: REASONING_MODEL, effectiveReasoningState: true,
  });
  assert.equal(out.answer, 'Paris');
  assert.equal(out.thinking, 'Weighing the options');
  assert.equal(out.reasoningProcessed, true,
    'the client renders a thinking pane off this flag — false hides reasoning the model did');
});

test('🔴 an answer duplicated inside the thinking field is de-duplicated', () => {
  // A real Qwen/R1 shape: the reasoning field ends by restating the answer.
  const out = shapeChatResponse({
    data: completion('Paris', 'Reasoning about capitals' + NL + NL + 'Paris'),
    outputText: 'Paris', selectedModelId: REASONING_MODEL, effectiveReasoningState: true,
  });
  assert.equal(out.answer, 'Paris');
  assert.ok(!out.thinking.endsWith('Paris'),
    'the thinking pane must not repeat the answer back at the user');
});

test('🔴 an empty content field recovers the answer from the thinking', () => {
  // The other real R1 shape: content is empty and the answer trails the reasoning.
  const out = shapeChatResponse({
    data: completion('', 'Considering options' + NL + NL + 'The final answer'),
    outputText: '', selectedModelId: REASONING_MODEL, effectiveReasoningState: true,
  });
  assert.equal(out.answer, 'The final answer',
    'without this the user sees an empty reply while the answer sits in the thinking field');
  assert.equal(out.thinking, 'Considering options');
});

test('a model on the exclusion list is treated as non-reasoning', () => {
  for (const model of ['anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat-v3-0324:free']) {
    const out = shapeChatResponse({
      data: completion('Direct answer'), outputText: 'Direct answer',
      selectedModelId: model, effectiveReasoningState: true,
    });
    assert.equal(out.reasoningProcessed, false, `${model} must not be asked to emit markers`);
    assert.equal(out.text, 'Direct answer');
  }
});

test('empty everything does not throw or produce undefined fields', () => {
  const out = shapeChatResponse({
    data: completion('', ''), outputText: '', reasoningContent: '',
    selectedModelId: REASONING_MODEL, effectiveReasoningState: true,
  });
  assert.ok(typeof out === 'object' && out !== null);
  assert.ok('reasoningProcessed' in out, 'the flag must always be present for the client');
});

test('the shape is always one of the two documented forms', () => {
  const cases = [
    { data: completion('a'), outputText: 'a', selectedModelId: 'openai/gpt-5.5', effectiveReasoningState: false },
    { data: completion('a', 'b'), outputText: 'a', selectedModelId: REASONING_MODEL, effectiveReasoningState: true },
    { data: completion(''), outputText: '', selectedModelId: 'openai/gpt-5.5', effectiveReasoningState: true },
  ];
  for (const args of cases) {
    const out = shapeChatResponse(args);
    const hasAnswerForm = 'answer' in out && 'thinking' in out;
    const hasTextForm = 'text' in out;
    assert.ok(hasAnswerForm || hasTextForm,
      'every path must yield either {answer,thinking} or {text} — the client reads both and ' +
      'a third shape renders as an empty reply');
    assert.equal(typeof out.modelIdUsed, 'string', 'model attribution is never optional');
  }
});

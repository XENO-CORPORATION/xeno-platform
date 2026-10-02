/**
 * ask_user, end to end through every pure layer: the tool, the loop that ENDS the turn on it, the
 * stored-turn validator, the stream parser, the client turn record, and the answer round trip.
 *
 * ## Why (2026-10-02)
 * A tutoring conversation had the model write every quiz question as "A) … B) …" prose and the person
 * typing "B" thirty times. The model now calls ask_user; the turn ends on the question (nothing is held
 * open while the person decides — the platform runs several replicas, so an in-request wait could not
 * work); the composer shows a panel; the answer is the next message.
 *
 * Found on the way, and pinned here: the stream parser DROPPED every run_code event (code_start /
 * code_result / code_error) since the code block shipped on 2026-09-27, so a run never showed while it
 * ran and was never saved — the turn record is built from exactly those events.
 *
 * Mutation-checked:
 *   - drop `case 'ask_user'` / the code cases from readStreamedTurn      -> "the parser forwards" fails
 *   - re-call the model after a question instead of ending the turn      -> "ends the turn" fails
 *   - let a second question through                                     -> "one question per turn" fails
 *   - remove the question branch from the validator                     -> "the validator" fails
 *   - let a question step fall through toToolCall to web_search         -> "rail row" fails
 *   - accept a typed reply that merely starts with "A." as a choice      -> "own words" fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { streamToolLoop } from '../src/server/utils/chatToolLoop.js';
import { ASK_USER_TOOL, parseAskUserArguments } from '../src/server/utils/chatAskUserTool.js';
import { RUN_CODE_TOOL } from '../src/server/utils/chatCodeTool.js';
import { normalizeTurnRecord } from '../src/server/utils/chatTurnRecord.js';
import { readStreamedTurn } from '../src/components/playground/Chat/chatStream.ts';
import { formatAnswer, readAnswer, questionHistoryNote, pendingQuestion, questionOutcome } from '../src/components/playground/Chat/chatQuestion.ts';

const askCall = (id, args) => ({ id, function: { name: 'ask_user', arguments: JSON.stringify(args) } });
const codeCall = (id) => ({ id, function: { name: 'run_code', arguments: JSON.stringify({ language: 'python', code: 'print(1)' }) } });
const Q = { question: 'Which storage fits?', options: ['One EBS volume over NFS', 'Instance Store + rsync', 'Amazon EFS', 'EBS Multi-Attach io2'] };

function scriptedModel(perCall) {
  let call = 0;
  const fn = () => {
    const events = perCall[Math.min(call, perCall.length - 1)];
    call += 1;
    return (async function* () { for (const e of events) yield e; })();
  };
  fn.calls = () => call;
  return fn;
}
const drain = async (gen) => { const out = []; for await (const e of gen) out.push(e); return out; };

// ─── the tool ────────────────────────────────────────────────────────────────────────────────────

test('the argument parser accepts a real call, strips self-written letters, and refuses junk', () => {
  assert.deepEqual(parseAskUserArguments(JSON.stringify(Q)), { ok: true, question: Q.question, options: Q.options, multiple: false });
  const lettered = parseAskUserArguments(JSON.stringify({ question: 'Pick', options: ['A) Use EFS', 'B. Use EBS', '(3) Use S3'] }));
  assert.deepEqual(lettered.options, ['Use EFS', 'Use EBS', 'Use S3'], 'the panel letters them; a model-written prefix would read "A. A) Use EFS"');
  assert.equal(parseAskUserArguments(JSON.stringify({ question: 'Pick', options: ['only one'] })).ok, false, 'fewer than 2 options');
  assert.equal(parseAskUserArguments(JSON.stringify({ question: '', options: ['a', 'b'] })).ok, false, 'no question');
  assert.equal(parseAskUserArguments(JSON.stringify({ question: 'Pick', options: ['same', 'Same'] })).ok, false, 'duplicates');
  assert.equal(parseAskUserArguments('{not json').ok, false);
  assert.equal(parseAskUserArguments(JSON.stringify({ question: 'Pick', options: ['a', 'b'], multiple: true })).multiple, true);
  assert.equal(ASK_USER_TOOL.function.name, 'ask_user');
});

// ─── the loop ENDS the turn on a question ────────────────────────────────────────────────────────

test('🔴 a question ends the turn: no further model call, the question is announced and on complete', async () => {
  const streamModel = scriptedModel([
    [{ type: 'delta', text: 'Here is the scenario.' }, { type: 'tool_calls', toolCalls: [askCall('q1', Q)] }],
    [{ type: 'delta', text: 'SHOULD NEVER BE CALLED' }],
  ]);
  const events = await drain(streamToolLoop({ messages: [{ role: 'user', content: 'quiz me' }], surface: 'chat', turnId: 't', streamModel, runSearch: async () => ({}), tools: [ASK_USER_TOOL] }));
  assert.equal(streamModel.calls(), 1, 'the model is not re-called after asking');
  const asked = events.find((e) => e.type === 'ask_user');
  assert.deepEqual({ q: asked?.question, o: asked?.options, id: asked?.toolCallId }, { q: Q.question, o: Q.options, id: 'q1' });
  const complete = events.find((e) => e.type === 'complete');
  assert.equal(complete?.question?.question, Q.question, 'complete carries the question');
  assert.ok(!events.some((e) => e.type === 'delta' && e.text.includes('SHOULD NEVER')));
});

test('other tools in the same batch still run before the turn ends', async () => {
  let ran = 0;
  const runCode = async () => { ran += 1; return { status: 'success', exitCode: 0, stdout: '1\n', stderr: '', savedFiles: [], skippedFiles: [], outputFilesTruncated: false }; };
  const streamModel = scriptedModel([[{ type: 'tool_calls', toolCalls: [codeCall('c1'), askCall('q1', Q)] }]]);
  const events = await drain(streamToolLoop({ messages: [{ role: 'user', content: 'x' }], surface: 'chat', turnId: 't', streamModel, runCode, runSearch: async () => ({}), tools: [RUN_CODE_TOOL, ASK_USER_TOOL] }));
  assert.equal(ran, 1);
  const order = events.map((e) => e.type).filter((t) => ['code_result', 'ask_user', 'complete'].includes(t));
  assert.deepEqual(order, ['code_result', 'ask_user', 'complete']);
});

test('one question per turn — a second is refused, never queued', async () => {
  const seen = [];
  const streamModel = (o) => { seen.push(o.messages); return (async function* () { yield { type: 'tool_calls', toolCalls: [askCall('q1', Q), askCall('q2', { question: 'Another?', options: ['x', 'y'] })] }; })(); };
  const events = await drain(streamToolLoop({ messages: [{ role: 'user', content: 'x' }], surface: 'chat', turnId: 't', streamModel, runSearch: async () => ({}), tools: [ASK_USER_TOOL] }));
  assert.equal(events.filter((e) => e.type === 'ask_user').length, 1);
  assert.equal(events.find((e) => e.type === 'ask_user').question, Q.question, 'the FIRST question wins');
});

test('a malformed question is a tool result the model can correct; the loop continues', async () => {
  const streamModel = scriptedModel([
    [{ type: 'tool_calls', toolCalls: [askCall('bad', { question: 'Pick', options: ['only one'] })] }],
    [{ type: 'delta', text: 'Asking in prose instead.' }],
  ]);
  const events = await drain(streamToolLoop({ messages: [{ role: 'user', content: 'x' }], surface: 'chat', turnId: 't', streamModel, runSearch: async () => ({}), tools: [ASK_USER_TOOL] }));
  assert.equal(streamModel.calls(), 2, 're-called after the error');
  assert.ok(!events.some((e) => e.type === 'ask_user'));
});

test('ask_user is only honoured when OFFERED — an unoffered call is an unknown tool', async () => {
  const streamModel = scriptedModel([[{ type: 'tool_calls', toolCalls: [askCall('q1', Q)] }], [{ type: 'delta', text: 'ok' }]]);
  const events = await drain(streamToolLoop({ messages: [{ role: 'user', content: 'x' }], surface: 'chat', turnId: 't', streamModel, runSearch: async () => ({}), tools: [] }));
  assert.ok(!events.some((e) => e.type === 'ask_user'), 'a client that did not declare the panel never gets a question');
});

// ─── the stored-turn validator ───────────────────────────────────────────────────────────────────

test('the validator stores a question step and refuses a malformed one', () => {
  const turn = (step) => ({ schema: 'xeno.chat.turn.v1', startedAt: 1, steps: [{ id: 'question-1', kind: 'question', startedAt: 2, ...step }] });
  const ok = normalizeTurnRecord(turn({ question: Q.question, options: Q.options, multiple: false, toolCallId: 'q1' }));
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual(ok.turn.steps[0], { id: 'question-1', kind: 'question', question: Q.question, options: Q.options, multiple: false, startedAt: 2, toolCallId: 'q1' });
  assert.equal(normalizeTurnRecord(turn({ question: Q.question, options: ['one'] })).ok, false, 'too few options');
  assert.equal(normalizeTurnRecord(turn({ question: '', options: Q.options })).ok, false, 'empty question');
  assert.equal(normalizeTurnRecord(turn({ question: Q.question, options: Q.options, multiple: 'yes' })).ok, false, 'multiple must be boolean');
});

// ─── the stream parser forwards code_* and ask_user ──────────────────────────────────────────────

test('🔴 the parser forwards run_code events and the question (they were dropped since 2026-09-27)', async () => {
  const frames = [
    { type: 'code_start', index: 0, language: 'python', code: 'print(1)' },
    { type: 'code_result', index: 0, status: 'success', exitCode: 0, stdout: '1\n', stderr: '' },
    { type: 'code_error', index: 1, message: 'nope' },
    { type: 'ask_user', toolCallId: 'q1', question: Q.question, options: Q.options, multiple: false },
    { type: 'result', response: 'x' },
    { type: 'done' },
  ];
  const body = new ReadableStream({ start(c) { for (const f of frames) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(f)}\n\n`)); c.close(); } });
  const seen = [];
  await readStreamedTurn(new Response(body), (e) => seen.push(e.type));
  assert.deepEqual(seen, ['code_start', 'code_result', 'code_error', 'ask_user']);
});

// ─── the answer round trip ───────────────────────────────────────────────────────────────────────

const step = { id: 'question-1', kind: 'question', question: Q.question, options: Q.options, multiple: false, startedAt: 1 };

test('an answer is written in one form and read back exactly', () => {
  const text = formatAnswer(step, [2], 'EFS is the shared, elastic one');
  assert.equal(text, 'C. Amazon EFS\n\nWhy: EFS is the shared, elastic one');
  assert.deepEqual(readAnswer(step, text), { picked: [2], reason: 'EFS is the shared, elastic one', ownWords: false });
  const multi = { ...step, multiple: true };
  assert.deepEqual(readAnswer(multi, formatAnswer(multi, [3, 0])).picked, [0, 3], 'select-all keeps the panel order');
});

test('🔴 a typed reply is "own words" — even one that starts with "A."', () => {
  assert.equal(readAnswer(step, 'I think EFS').ownWords, true);
  assert.equal(readAnswer(step, 'A. but honestly any of them').ownWords, true, 'a choice line must be the EXACT option text');
  assert.equal(readAnswer(step, 'A. One EBS volume over NFS\nC. Amazon EFS').ownWords, true, 'two picks on a single-choice question');
});

test('the model sees the question it asked in later turns', () => {
  const note = questionHistoryNote(step);
  assert.match(note, /ask_user tool: Which storage fits\?/);
  assert.match(note, /^C\. Amazon EFS$/m);
});

test('pending: only while the last message is a finished reply that asked; the next message answers it', () => {
  const ai = { id: 'a1', sender: 'ai', turn: { steps: [step] } };
  assert.equal(pendingQuestion([{ id: 'u1', sender: 'user' }, ai])?.messageId, 'a1');
  assert.equal(pendingQuestion([ai, { id: 'u2', sender: 'user', text: 'C. Amazon EFS' }]), null);
  assert.equal(pendingQuestion([{ ...ai, isStreaming: true }]), null, 'not while streaming');
  assert.equal(pendingQuestion([{ ...ai, isError: true }]), null, 'not on an error turn');
  assert.deepEqual(questionOutcome([ai, { id: 'u2', sender: 'user', text: 'C. Amazon EFS' }], 'a1', step).picked, [2]);
  assert.equal(questionOutcome([ai], 'a1', step), null, 'still waiting');
});

// ─── the client turn record ──────────────────────────────────────────────────────────────────────

const vite = await createServer({ appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
try {
  const T = await vite.ssrLoadModule('/src/components/playground/Chat/chatTurnTranscript.ts');

  test('the ask_user event becomes ONE question step, restores from storage, and draws as an ask_user row', () => {
    let rec = T.newTurnRecord(1);
    rec = T.applyTurnEvent(rec, { type: 'ask_user', toolCallId: 'q1', question: Q.question, options: Q.options, multiple: false }, 5);
    rec = T.applyTurnEvent(rec, { type: 'ask_user', question: 'again?', options: ['x', 'y'] }, 6);
    const questions = rec.steps.filter((s) => s.kind === 'question');
    assert.equal(questions.length, 1, 'a repeat event never adds a second question');
    assert.equal(T.turnQuestion(rec)?.question, Q.question);
    const restored = T.normalizeStoredTurn(JSON.parse(JSON.stringify(T.closeTurnRecord(rec, 9))));
    assert.deepEqual(T.turnQuestion(restored)?.options, Q.options, 'survives a reload');
    const msg = T.toTranscriptMessage({ id: 'm', turn: restored, streaming: false });
    assert.equal(msg.toolCalls[0].toolName, 'ask_user', 'never the web_search fall-through');
    assert.equal(msg.toolCalls[0].params.question, Q.question);
  });
} finally {
  await vite.close();
}

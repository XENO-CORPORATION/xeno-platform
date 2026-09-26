/**
 * The tool loop DISPATCHES run_code, feeds its result back to the model, streams UI events, and
 * enforces the per-turn budget (CHAT-CODE-EXECUTION-SPEC.md §5). Pure: a scripted model + a stub
 * executor, so it runs in CI with no database, no xenorun, no Docker.
 *
 * Mutation-checked: remove the run_code branch in streamToolLoop and "dispatches run_code" fails
 * (no code_start/code_result, and run_code comes back as unknown tool); break the budget guard and
 * "enforces the budget" fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { streamToolLoop } from '../src/server/utils/chatToolLoop.js';
import { RUN_CODE_TOOL, CHAT_CODE_BUDGET, parseCodeArguments } from '../src/server/utils/chatCodeTool.js';

const codeCall = (id, language, code) => ({ id, function: { name: 'run_code', arguments: JSON.stringify({ language, code }) } });

// A model driven by a script: each entry is the events for one upstream call.
function scriptedModel(perCall) {
  let call = 0;
  return () => {
    const events = perCall[Math.min(call, perCall.length - 1)];
    call += 1;
    return (async function* () { for (const e of events) yield e; })();
  };
}

async function drain(gen) {
  const events = [];
  for await (const e of gen) events.push(e);
  return events;
}

test('the arg parser accepts a real call and rejects junk (pure)', () => {
  assert.deepEqual(parseCodeArguments(JSON.stringify({ language: 'python', code: 'print(1)' })), { ok: true, language: 'python', code: 'print(1)' });
  assert.equal(parseCodeArguments('{not json').ok, false);
  assert.equal(parseCodeArguments(JSON.stringify({ language: 'brainfuck', code: 'x' })).ok, false);
  assert.equal(parseCodeArguments(JSON.stringify({ language: 'python', code: '   ' })).ok, false);
});

test('streamToolLoop dispatches run_code, streams events, and feeds the result back', async () => {
  const seen = [];
  const runCode = async (args) => {
    seen.push(args);
    return { status: 'success', exitCode: 0, stdout: 'hello\n', stderr: '', savedFiles: [{ path: 'out.txt', size: 6 }], skippedFiles: [], outputFilesTruncated: false };
  };
  const streamModel = scriptedModel([
    [{ type: 'tool_calls', toolCalls: [codeCall('c1', 'python', "open('out.txt','w').write('hello'); print('hello')")] }],
    [{ type: 'delta', text: 'Done — wrote out.txt.' }],
  ]);

  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'make a file' }],
    surface: 'chat',
    turnId: 't1',
    streamModel,
    runCode,
    tools: [RUN_CODE_TOOL],
  }));

  const start = events.find((e) => e.type === 'code_start');
  const result = events.find((e) => e.type === 'code_result');
  const complete = events.find((e) => e.type === 'complete');
  assert.equal(seen.length, 1, 'runCode was invoked exactly once');
  assert.deepEqual({ language: seen[0].language }, { language: 'python' });
  assert.ok(start && start.language === 'python', 'a code_start was streamed with the language');
  assert.ok(result && result.result.status === 'success' && result.result.savedFiles[0].path === 'out.txt', 'a code_result carried the run outcome');
  assert.ok(events.some((e) => e.type === 'delta' && e.text.includes('Done')), 'the final answer streamed after the tool');
  assert.equal(complete.codeRuns, 1, 'the complete event counts the run');
});

test('streamToolLoop enforces the per-turn code budget', async () => {
  const overBudget = CHAT_CODE_BUDGET + 1;
  const runCode = async () => ({ status: 'success', exitCode: 0, stdout: '', stderr: '', savedFiles: [], skippedFiles: [], outputFilesTruncated: false });
  const calls = Array.from({ length: overBudget }, (_, i) => codeCall(`c${i}`, 'python', `print(${i})`));
  const streamModel = scriptedModel([
    [{ type: 'tool_calls', toolCalls: calls }],
    [{ type: 'delta', text: 'stopping.' }],
  ]);

  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'loop' }],
    surface: 'chat',
    turnId: 't2',
    streamModel,
    runCode,
    tools: [RUN_CODE_TOOL],
  }));

  const starts = events.filter((e) => e.type === 'code_start').length;
  assert.equal(starts, CHAT_CODE_BUDGET, `only ${CHAT_CODE_BUDGET} runs execute; the ${overBudget}th is refused`);
});

test('a run_code failure is a result, not a fatal turn', async () => {
  const runCode = async () => { throw new Error('engine exploded'); };
  const streamModel = scriptedModel([
    [{ type: 'tool_calls', toolCalls: [codeCall('c1', 'python', 'print(1)')] }],
    [{ type: 'delta', text: 'the run failed, here is why.' }],
  ]);

  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'run' }],
    surface: 'chat',
    turnId: 't3',
    streamModel,
    runCode,
    tools: [RUN_CODE_TOOL],
  }));

  assert.ok(events.some((e) => e.type === 'code_error'), 'a code_error was streamed');
  assert.ok(events.some((e) => e.type === 'delta' && e.text.includes('failed')), 'the turn still produced an answer');
  assert.ok(events.some((e) => e.type === 'complete'), 'the turn completed');
});

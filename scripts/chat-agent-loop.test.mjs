/**
 * The chat turn on the XENO Agent loop must be indistinguishable from the old loop.
 *
 * Every scenario runs the same scripted model and tools through `streamToolLoop` and
 * `streamAgentToolLoop`, then compares three things: the events the client draws, the billed model
 * calls (requestId, tools offered, how many messages were sent), and what each tool was asked to do.
 * A difference in any of them is a behaviour change the person or the ledger would see.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { streamToolLoop, WEB_SEARCH_TOOL, budgetFor } from '../src/server/utils/chatToolLoop.js';
import { streamAgentToolLoop, chatTurnLoop } from '../src/server/utils/chatAgentLoop.js';
import { RUN_CODE_TOOL } from '../src/server/utils/chatCodeTool.js';
import { ASK_USER_TOOL } from '../src/server/utils/chatAskUserTool.js';
import { GENERATE_IMAGE_TOOL } from '../src/server/utils/chatImageTool.js';

const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

/** Runs one scripted turn through a loop and records everything observable. */
async function run(loop, { script, tools, surface = 'chat', extra = {} }) {
  const calls = [];
  const work = [];
  let step = 0;
  const streamModel = async function* ({ messages, tools: offered, requestId }) {
    calls.push({ requestId, tools: (offered || []).map((t) => t.function.name).join(','), messages: messages.length, last: messages.at(-1)?.role });
    const events = typeof script[step] === 'function' ? script[step]() : (script[step] || [{ type: 'delta', text: 'done' }, { type: 'usage', usage }]);
    step += 1;
    for (const event of events) yield event;
  };
  const events = [];
  for await (const event of loop({
    messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
    surface,
    turnId: 'turn-1',
    streamModel,
    tools,
    runSearch: async ({ query }) => { work.push(`search:${query}`); return { sources: [{ title: query, url: `https://example.com/${query}`, snippet: 's' }] }; },
    runCode: async ({ code }) => { work.push(`code:${code}`); return { stdout: 'ok', exitCode: 0 }; },
    runProject: async (args) => { work.push(`project:${JSON.stringify(args)}`); return { files: ['a.md'] }; },
    ...extra,
  })) events.push(event);
  return { calls, work, events: events.map(({ usage: _ignored, ...rest }) => rest) };
}

async function same(scenario) {
  const before = await run(streamToolLoop, scenario);
  const after = await run(streamAgentToolLoop, scenario);
  assert.deepEqual(after.calls, before.calls, 'billed model calls differ');
  assert.deepEqual(after.work, before.work, 'tool work differs');
  assert.deepEqual(after.events, before.events, 'client events differ');
  return after;
}

test('a turn with no tool call: one billed call, same answer', async () => {
  const result = await same({ tools: [WEB_SEARCH_TOOL], script: [[{ type: 'delta', text: 'Hello' }, { type: 'usage', usage }]] });
  assert.equal(result.calls.length, 1);
});

test('a search, then an answer from it', async () => {
  const result = await same({
    tools: [WEB_SEARCH_TOOL],
    script: [[{ type: 'delta', text: 'Let me check.' }, { type: 'tool_calls', toolCalls: [call('c1', 'web_search', { query: 'xeno' })] }, { type: 'usage', usage }]],
  });
  assert.deepEqual(result.calls.map((c) => c.requestId), ['turn-1:0', 'turn-1:1']);
});

test('🔴 the search budget is still enforced by the server, and the turn still ends in an answer', async () => {
  const budget = budgetFor('chat').maxSearches;
  const searchForever = Array.from({ length: budget + 4 }, (_, i) => [{ type: 'tool_calls', toolCalls: [call(`c${i}`, 'web_search', { query: `q${i}` })] }]);
  const result = await same({ tools: [WEB_SEARCH_TOOL], script: searchForever });
  assert.equal(result.work.length, budget);
  assert.equal(result.calls.at(-1).requestId, 'turn-1:final');
});

test('two tools in one reply run in the order the model asked for them', async () => {
  await same({
    tools: [WEB_SEARCH_TOOL, RUN_CODE_TOOL],
    script: [[{ type: 'tool_calls', toolCalls: [call('a', 'run_code', { language: 'python', code: 'print(1)' }), call('b', 'web_search', { query: 'second' })] }]],
  });
});

test('ask_user ends the turn at the question, with no further billed call', async () => {
  const result = await same({
    tools: [ASK_USER_TOOL],
    script: [[{ type: 'tool_calls', toolCalls: [call('q', 'ask_user', { question: 'Which one?', options: ['A', 'B'] })] }]],
  });
  assert.equal(result.calls.length, 1);
  assert.equal(result.events.at(-2).type, 'ask_user');
});

test('an image proposal ends the turn and charges nothing', async () => {
  const result = await same({
    tools: [GENERATE_IMAGE_TOOL],
    script: [[{ type: 'tool_calls', toolCalls: [call('i', 'generate_image', { prompt: 'a cat', aspect_ratio: '1:1' })] }]],
    extra: { proposeImage: async ({ prompt }) => ({ id: 'gen_1', prompt }) },
  });
  assert.equal(result.calls.length, 1);
  assert.equal(result.events.some((e) => e.type === 'generation_proposal'), true);
});

test('a project read goes through the same bounded reader', async () => {
  await same({
    tools: [{ type: 'function', function: { name: 'read_project', description: 'Read the project.', parameters: { type: 'object', properties: { section: { type: 'string' } } } } }],
    script: [[{ type: 'tool_calls', toolCalls: [call('p', 'read_project', { section: 'files' })] }]],
  });
});

test('a tool the turn was not offered is answered, never run', async () => {
  await same({
    tools: [WEB_SEARCH_TOOL],
    script: [[{ type: 'tool_calls', toolCalls: [call('x', 'delete_everything', {})] }]],
  });
});

test('🔴 only the exact value turns the XENO Agent on; everything else keeps today\'s loop', () => {
  assert.equal(chatTurnLoop({ CHAT_AGENT_RUNTIME: 'xeno-agent' }), streamAgentToolLoop);
  for (const value of [undefined, '', 'Xeno-Agent', 'xeno-agent ', 'true', '1', 'on']) {
    assert.equal(chatTurnLoop({ CHAT_AGENT_RUNTIME: value }), streamToolLoop, String(value));
  }
});

test('the route asks the switch, not either loop directly', async () => {
  const { readFile } = await import('node:fs/promises');
  const route = await readFile(new URL('../src/server/routes/aiRoutes.js', import.meta.url), 'utf8');
  assert.match(route, /chatTurnLoop\(process\.env, userId\)\(\{/);
  assert.doesNotMatch(route, /streamToolLoop\(\{|streamAgentToolLoop\(\{/);
});

test('the setting reaches the backend container', async () => {
  const { readFile } = await import('node:fs/promises');
  const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(compose, /- CHAT_AGENT_RUNTIME=\$\{CHAT_AGENT_RUNTIME:-\}/);
});

test('🔴 a canary list keeps everyone else on today\'s loop', () => {
  const env = { CHAT_AGENT_RUNTIME: 'xeno-agent', CHAT_AGENT_RUNTIME_USERS: ' u-1, u-2 ' };
  assert.equal(chatTurnLoop(env, 'u-1'), streamAgentToolLoop);
  assert.equal(chatTurnLoop(env, 'u-3'), streamToolLoop);
  assert.equal(chatTurnLoop(env, null), streamToolLoop);
  assert.equal(chatTurnLoop({ CHAT_AGENT_RUNTIME: 'off', CHAT_AGENT_RUNTIME_USERS: 'u-1' }, 'u-1'), streamToolLoop);
});

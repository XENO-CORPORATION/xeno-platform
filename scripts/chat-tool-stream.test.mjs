/**
 * The STREAMING tool loop, executed — and the fragment accumulator under it.
 *
 * ## What this is for
 *
 * v1 of the tool loop buffered: a 10-search Chat turn showed the user nothing until the
 * final answer, so a working turn was indistinguishable from a hang. The fix follows what
 * Anthropic, OpenAI and Gemini all do (checked 2026-09-14) — the search runs inside ONE
 * streamed response and its phases are typed events in the same stream as the text:
 *
 *   Anthropic  server_tool_use (query streams as input_json_delta) -> pause ->
 *              web_search_tool_result -> text with citations
 *   OpenAI     output_item.added(web_search_call) -> in_progress -> searching ->
 *              completed, citations as separate annotation events
 *   Gemini     text, then groundingChunks + groundingSupports mapping spans to sources
 *
 * The invariant all three encode, and the one these tests pin: **the query is visible
 * before the search runs.** That is what makes a wait legible rather than a freeze.
 *
 * ## 🔴 The bug class this file exists to prevent
 *
 * A streamed tool call arrives as FRAGMENTS — `{"que` then `ry":"…"}` — and only `index`
 * is present on every one. Parsing a fragment throws, and the obvious reading of that
 * throw is "the model sent malformed arguments". It did not; the arguments had not
 * finished arriving. That mistake produces a search that fails INTERMITTENTLY, depending
 * purely on where the network split the payload, and it would look exactly like the
 * fabrication defect from 2026-09-13 to anyone reading the transcript.
 *
 * Mutation-checked 2026-09-14, each failing alone with a green control:
 *   key the accumulator on `id` instead of `index`     -> interleaved/parallel test fails
 *   parse arguments on each fragment                   -> fragment test fails
 *   yield search_start AFTER awaiting runSearch        -> ordering test fails
 *   keep only the last usage instead of summing        -> usage test fails
 *   drop the per-iteration requestId                   -> requestId test fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  streamToolLoop,
  TOOL_BUDGETS,
  addUsage,
  iterationPlan,
  budgetFor,
} from '../src/server/utils/chatToolLoop.js';
import { ToolCallAccumulator } from '../src/server/utils/streamingToolCalls.js';

/** Build an async iterable from a fixed list of events — one fake upstream call. */
const streamOf = (events) => (async function* gen() {
  for (const e of events) yield e;
}());

/**
 * A model that emits one assembled web_search call.
 *
 * ⚠️ This is the loop's input, which is ALREADY assembled — the accumulator sits one layer
 * below, between the SSE parser and the loop, and is tested directly above. Faking split
 * fragments here would test nothing, since the loop never sees them.
 */
const searchCallStream = (query, { id = 'call_1' } = {}) => streamOf([
  {
    type: 'tool_calls',
    toolCalls: [{
      id,
      type: 'function',
      function: { name: 'web_search', arguments: JSON.stringify({ query }) },
    }],
  },
]);

/** A model that answers in two text deltas. */
const answerStream = (text) => streamOf([
  { type: 'delta', text: text.slice(0, 3) },
  { type: 'delta', text: text.slice(3) },
  { type: 'usage', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
]);

const sources = (n = 2) => ({
  sources: Array.from({ length: n }, (_, i) => ({
    title: `Result ${i}`, url: `https://example.com/${i}`, snippet: 's',
  })),
});

/** Drain a loop into a list of events. */
const drain = async (iterable) => {
  const out = [];
  for await (const e of iterable) out.push(e);
  return out;
};

// ─── The accumulator ──────────────────────────────────────────────────────────────────

test('🔴 arguments split across fragments are joined, not parsed early', () => {
  const acc = new ToolCallAccumulator();
  // Exactly how a provider streams it: name first, then the JSON a few chars at a time.
  acc.push([{ index: 0, id: 'call_a', function: { name: 'web_search', arguments: '' } }]);
  acc.push([{ index: 0, function: { arguments: '{"que' } }]);
  acc.push([{ index: 0, function: { arguments: 'ry":"xeno' } }]);
  acc.push([{ index: 0, function: { arguments: ' platform"}' } }]);

  const [call] = acc.finish();
  assert.equal(call.id, 'call_a');
  assert.equal(call.function.name, 'web_search');
  assert.deepEqual(
    JSON.parse(call.function.arguments), { query: 'xeno platform' },
    'the joined arguments must parse — parsing any single fragment would have thrown, and ' +
    'treating that throw as "malformed arguments" makes search fail intermittently based ' +
    'on where the network split the payload',
  );
});

test('🔴 parallel calls streamed INTERLEAVED stay separate', () => {
  const acc = new ToolCallAccumulator();
  // Two calls, fragments alternating — keying on anything but `index` splices them.
  acc.push([{ index: 0, id: 'a', function: { name: 'web_search', arguments: '{"query":"' } }]);
  acc.push([{ index: 1, id: 'b', function: { name: 'web_search', arguments: '{"query":"' } }]);
  acc.push([{ index: 0, function: { arguments: 'first"}' } }]);
  acc.push([{ index: 1, function: { arguments: 'second"}' } }]);

  const calls = acc.finish();
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0].function.arguments).query, 'first');
  assert.equal(JSON.parse(calls[1].function.arguments).query, 'second');
});

test('a fragment carrying only arguments never blanks the name set earlier', () => {
  const acc = new ToolCallAccumulator();
  acc.push([{ index: 0, id: 'a', function: { name: 'web_search', arguments: '' } }]);
  acc.push([{ index: 0, function: { arguments: '{"query":"q"}' } }]);
  assert.equal(acc.finish()[0].function.name, 'web_search', 'the name must survive later fragments');
});

test('index 0 is a real index, not a falsy value', () => {
  const acc = new ToolCallAccumulator();
  acc.push([{ index: 0, id: 'a', function: { name: 'web_search', arguments: '{}' } }]);
  acc.push([{ index: 0, function: { arguments: '' } }]);
  assert.equal(acc.finish().length, 1, 'index 0 must not be treated as "no index" and split in two');
});

// ─── The streaming loop ───────────────────────────────────────────────────────────────

test('🔴 the query reaches the client BEFORE the search runs', async () => {
  /*
   * ⚠️ This has to DISCRIMINATE, and the obvious version does not.
   *
   * A first draft consumed until `search_start` with a `runSearch` that throws, and
   * asserted the event arrived. That passes under BOTH orderings: breaking out of the
   * iteration stops consumption either way, so it proved nothing about which came first.
   *
   * A generator only advances when its consumer asks for the next value, so the honest
   * probe is a search that BLOCKS: hold `runSearch` open, and assert the event is already
   * in hand while the search is still running. If `search_start` were yielded after the
   * await, this deadlocks — which is the failure we want, because it is exactly what the
   * user experiences as a hang.
   */
  let releaseSearch;
  const searchStarted = new Promise((resolve) => { releaseSearch = resolve; });
  let searchResolved = false;

  let calls = 0;
  const loop = streamToolLoop({
    messages: [{ role: 'user', content: 'what happened today' }],
    surface: 'chat',
    turnId: 't1',
    streamModel: () => (++calls === 1 ? searchCallStream('today news') : answerStream('answer')),
    runSearch: async () => {
      await searchStarted;          // stays pending until the assertion below releases it
      searchResolved = true;
      return sources();
    },
  });

  let start = null;
  for await (const event of loop) {
    if (event.type !== 'search_start') continue;
    start = event;
    break;
  }

  assert.equal(start?.query, 'today news', 'the query must be emitted, and carry the real query');
  assert.equal(
    searchResolved, false,
    'search_start must reach the client while the search is STILL RUNNING. Emitting it ' +
    'after the await means the user stares at a silent pause for the whole search — the ' +
    'exact defect this streaming path exists to fix.',
  );
  releaseSearch();
});

test('text emitted before a tool call is forwarded immediately, not held back', async () => {
  let calls = 0;
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'q' }],
    surface: 'chat',
    turnId: 't2',
    streamModel: () => {
      calls += 1;
      if (calls === 1) {
        return streamOf([
          { type: 'delta', text: 'Let me check that. ' },
          { type: 'tool_calls', toolCalls: [{ id: 'c1', function: { name: 'web_search', arguments: '{"query":"q"}' } }] },
        ]);
      }
      return answerStream('Done');
    },
    runSearch: async () => sources(),
  }));

  const firstDelta = events.findIndex((e) => e.type === 'delta');
  const searchStart = events.findIndex((e) => e.type === 'search_start');
  assert.ok(firstDelta >= 0 && firstDelta < searchStart,
    'narration before a search ("Let me check that") is part of the answer and must reach ' +
    'the user as it is written, not after the search resolves');
});

test('sources ride back on the completion, and the turn reports what it did', async () => {
  let calls = 0;
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'q' }],
    surface: 'chat',
    turnId: 't3',
    streamModel: () => (++calls === 1 ? searchCallStream('q') : answerStream('answer')),
    runSearch: async () => sources(3),
  }));

  const result = events.find((e) => e.type === 'search_result');
  assert.equal(result.count, 3);
  assert.equal(result.sources.length, 3);
  assert.ok(result.sources[0].url, 'each source must carry a url to cite');

  const complete = events.at(-1);
  assert.equal(complete.type, 'complete');
  assert.equal(complete.searches, 1);
  assert.equal(complete.sources.length, 3);
  assert.equal(complete.cappedOut, false);
});

test('🔴 a failed search is an EVENT and a recovery, never a thrown turn', async () => {
  let calls = 0;
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'q' }],
    surface: 'chat',
    turnId: 't4',
    streamModel: () => (++calls === 1 ? searchCallStream('q') : answerStream('I could not verify that')),
    runSearch: async () => { const e = new Error('upstream down'); e.code = 'web_context_unavailable'; throw e; },
  }));

  const err = events.find((e) => e.type === 'search_error');
  assert.ok(err, 'the user must see that a search was attempted and failed');
  assert.equal(err.code, 'web_context_unavailable');
  const complete = events.at(-1);
  assert.equal(complete.type, 'complete', 'the turn must still complete — the user paid for it');
});

test('🔴 the server cap holds against a model that never stops asking', async () => {
  let calls = 0;
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'q' }],
    surface: 'chat',
    turnId: 't5',
    streamModel: () => { calls += 1; return searchCallStream(`q${calls}`); },
    runSearch: async () => sources(1),
  }));

  const complete = events.at(-1);
  assert.equal(complete.type, 'complete');
  assert.equal(
    complete.searches, TOOL_BUDGETS.chat.maxSearches,
    'the budget is the cap; a model that keeps calling must not exceed it',
  );
  assert.equal(complete.cappedOut, true, 'a turn that used its whole budget must say so');
});

test('🔴 every upstream call gets a distinct, deterministic requestId', async () => {
  const seen = [];
  let calls = 0;
  await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'q' }],
    surface: 'chat',
    turnId: 'turn-abc',
    streamModel: ({ requestId }) => {
      seen.push(requestId);
      return ++calls <= 2 ? searchCallStream(`q${calls}`) : answerStream('done');
    },
    runSearch: async () => sources(1),
  }));

  assert.equal(new Set(seen).size, seen.length,
    'holds derive from requestId and are idempotent on it — a repeat silently collides, ' +
    'so the second call would ride the first hold and under-bill');
  for (const id of seen) {
    assert.ok(id.startsWith('turn-abc:'), `${id} must derive from the turn id, so a retry re-uses its holds`);
  }
});

test('🔴 usage is SUMMED across calls, not overwritten', async () => {
  // Each upstream call bills separately. Keeping the last one reports an 11-call turn as
  // one — and usage is what the settle is computed from, so that is an under-BILL.
  const summed = addUsage(
    { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    { prompt_tokens: 20, completion_tokens: 7, total_tokens: 27 },
  );
  assert.equal(summed.prompt_tokens, 30);
  assert.equal(summed.completion_tokens, 12);
  assert.equal(summed.total_tokens, 42);
  assert.deepEqual(addUsage(null, { prompt_tokens: 3 }).prompt_tokens, 3, 'first usage seeds the total');
  assert.equal(addUsage({ prompt_tokens: 1 }, null).prompt_tokens, 1, 'a missing usage chunk changes nothing');
});

test('a turn with no tool call streams exactly one upstream call', async () => {
  let calls = 0;
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'hello' }],
    surface: 'chat',
    turnId: 't7',
    streamModel: () => { calls += 1; return answerStream('Hi there'); },
    runSearch: async () => { throw new Error('must not search'); },
  }));
  assert.equal(calls, 1, 'the no-regression case: an ordinary chat costs exactly one call');
  assert.equal(events.filter((e) => e.type === 'delta').length, 2);
  assert.equal(events.at(-1).searches, 0);
});

test('a surface with no budget never streams a tool', async () => {
  let offered = null;
  await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'q' }],
    surface: 'code',
    turnId: 't8',
    streamModel: ({ tools }) => { offered = tools; return answerStream('ok'); },
    runSearch: async () => sources(),
  }));
  assert.deepEqual(offered, [], 'code has no budget, so it must be offered no tool');
});

test('🔴 past the cap the tool STAYS DECLARED; the cap is reported, not enforced by withdrawal', () => {
  /*
   * Withdrawing the declaration was "structural" in theory and produced EMPTY answers in
   * production (2026-09-14): the reseller serving claude-opus-5 returns a bare stop when the
   * model calls a tool the request did not declare. The budget is enforced in the tool
   * result instead — see chat-tool-loop.test.mjs — so this pins only the two facts that
   * remain iterationPlan's job: the cap is REPORTED the moment it is reached, and the tool
   * list is never emptied.
   */
  const budget = budgetFor('chat');
  const tools = [{ type: 'function' }];
  assert.deepEqual(
    iterationPlan({ searches: budget.maxSearches, budget, tools }),
    { capReached: true, offerTools: tools },
    'reaching the cap must be reported, and the declaration must stay — an omitted tool list is the shape that returns nothing',
  );
  assert.equal(iterationPlan({ searches: 0, budget, tools }).offerTools, tools);
});

test('🔴 the streamed final call keeps the tool and nudges for an answer', async () => {
  let finalCall = null;
  let calls = 0;
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'q' }],
    surface: 'chat',
    turnId: 't9b',
    streamModel: ({ tools, messages, requestId }) => {
      if (requestId.endsWith(':final')) { finalCall = { tools, last: messages.at(-1) }; return answerStream('final answer'); }
      calls += 1;
      return searchCallStream(`q${calls}`);
    },
    runSearch: async () => sources(),
  }));
  assert.ok(finalCall, 'a model that never stops must reach the final call');
  assert.equal(finalCall.tools.length, 1, 'the final call must still declare the tool');
  assert.equal(finalCall.last.role, 'user');
  assert.match(finalCall.last.content, /budget .* used up/i);
  const complete = events.find((e) => e.type === 'complete');
  assert.equal(complete.cappedOut, true);
  assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join('').slice(-12), 'final answer', 'the turn ends in an answer');
});

test('Research streams the deep depth', async () => {
  let depth = null;
  let calls = 0;
  await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'q' }],
    surface: 'research',
    turnId: 't9',
    streamModel: () => (++calls === 1 ? searchCallStream('q') : answerStream('a')),
    runSearch: async (args) => { depth = args.depth; return sources(); },
  }));
  assert.equal(depth, 'deep', 'Research must select the deeper search budget');
});

test('🔴 search_result events carry the turn-wide source ids the model was given', async () => {
  let calls = 0;
  const found = [
    [{ title: 'one', url: 'https://one.test/' }, { title: 'two', url: 'https://two.test/' }],
    [{ title: 'two again', url: 'https://two.test/' }, { title: 'three', url: 'https://three.test/' }],
  ];
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'q' }],
    surface: 'research',
    turnId: 'cite',
    streamModel: () => {
      calls += 1;
      if (calls <= 2) return searchCallStream(`q${calls}`, { id: `c${calls}` });
      return answerStream('done [1][3]');
    },
    runSearch: async () => ({ sources: found[calls - 1] }),
  }));
  const results = events.filter((e) => e.type === 'search_result').map((e) => e.sources.map((s) => s.id));
  assert.deepEqual(results, [[1, 2], [2, 3]], 'one id per URL, first appearance wins, across searches');
  const complete = events.find((e) => e.type === 'complete');
  assert.deepEqual(complete.sources.map((s) => s.id), [1, 2, 3]);
});

test('🔴 reasoning streamed between the searches reaches the client — a searching turn thinks visibly', async () => {
  // measured on production 2026-09-18: grok-4.6 (which exposes its trace) showed a thought on a plain
  // turn and NOTHING on a turn that searched, because this loop forwarded delta/tool_calls/usage only
  let calls = 0;
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'really?' }],
    surface: 'chat',
    turnId: 'think',
    streamModel: () => {
      calls += 1;
      if (calls === 1) return streamOf([
        { type: 'reasoning', text: 'The user doubts the sources; ' },
        { type: 'reasoning', text: 'I should re-check them live.' },
        { type: 'delta', text: 'I\u2019ll check those claims against live sources.' },
        { type: 'tool_calls', toolCalls: [{ id: 'c1', function: { name: 'web_search', arguments: '{"query":"gaming september 2026"}' } }] },
      ]);
      return streamOf([
        { type: 'reasoning', text: 'Same coverage; answer plainly.' },
        { type: 'delta', text: 'Yes. A live search turns up the same coverage.' },
      ]);
    },
    runSearch: async () => sources(),
  }));
  const thought = events.filter((e) => e.type === 'reasoning').map((e) => e.text).join('');
  assert.equal(thought, 'The user doubts the sources; I should re-check them live.Same coverage; answer plainly.', 'every reasoning delta, from both iterations, is forwarded');
  const searchStart = events.findIndex((e) => e.type === 'search_start');
  const firstThought = events.findIndex((e) => e.type === 'reasoning');
  assert.ok(firstThought < searchStart, 'the thought before the search arrives before the search does');
});

test('narration before a search and the answer after it are two paragraphs, not one run-on sentence', async () => {
  let calls = 0;
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'really?' }],
    surface: 'chat',
    turnId: 'para',
    streamModel: () => {
      calls += 1;
      if (calls === 1) return streamOf([
        { type: 'delta', text: 'I\u2019ll check those claims against live sources.' },
        { type: 'tool_calls', toolCalls: [{ id: 'c1', function: { name: 'web_search', arguments: '{"query":"q"}' } }] },
      ]);
      return answerStream('Yes. A live search turns up the same coverage.');
    },
    runSearch: async () => sources(),
  }));
  const text = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
  assert.equal(text, 'I\u2019ll check those claims against live sources.\n\nYes. A live search turns up the same coverage.');
});

test('a turn that did NOT narrate gets no stray break before its answer', async () => {
  let calls = 0;
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'q' }],
    surface: 'chat',
    turnId: 'nobreak',
    streamModel: () => { calls += 1; return calls === 1 ? searchCallStream('q') : answerStream('Answer.'); },
    runSearch: async () => sources(),
  }));
  assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Answer.');
});

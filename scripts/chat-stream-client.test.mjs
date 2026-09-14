/**
 * The client SSE reader, executed against real byte boundaries.
 *
 * `/api/ai/chat/stream` was built, tested and reachable from NOTHING (declared @unwired on
 * 2026-09-14). This is the consumer. It is tested here rather than in a browser because the
 * two failures that matter are both about BYTES, not rendering:
 *
 *   1. a `data:` frame split across chunks
 *   2. a multi-byte UTF-8 character split across chunks
 *
 * Both produce *plausible* output — a missing word, a replacement character — rather than a
 * crash, so neither is caught by "does it render". They are caught by feeding the reader
 * chunk boundaries chosen to land in the worst possible place, which is what these do.
 *
 * The state reducer is tested beside it because "what is on screen right now" is the
 * question the streaming work exists to answer, and it is pure.
 *
 * Mutation-checked 2026-09-14, each failing alone with a green control:
 *   decode each chunk without { stream: true }   -> the UTF-8 split test fails
 *   parse per chunk instead of buffering lines   -> the split-frame test fails
 *   set activeSearch on search_result            -> the "visible during" test fails
 *   drop the dedupe in mergeSources              -> the dedupe test fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readChatStream,
  applyChatStreamEvent,
  initialChatStreamState,
} from '../src/components/playground/Chat/chatStream.ts';

/** A ReadableStream over exactly the byte chunks given — the boundaries are the test. */
const streamOfChunks = (chunks) => new ReadableStream({
  start(controller) {
    for (const chunk of chunks) {
      controller.enqueue(chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(chunk));
    }
    controller.close();
  },
});

const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

const collect = async (stream) => {
  const out = [];
  for await (const event of readChatStream(stream)) out.push(event);
  return out;
};

/** Fold a list of events through the reducer. */
const fold = (events) => events.reduce(applyChatStreamEvent, initialChatStreamState());

// ─── Byte-level parsing ───────────────────────────────────────────────────────────────

test('🔴 a frame SPLIT ACROSS CHUNKS is not dropped', async () => {
  const full = frame({ type: 'delta', text: 'hello world' });
  // Cut in the middle of the JSON — exactly what an arbitrary network boundary does.
  const cut = Math.floor(full.length / 2);
  const events = await collect(streamOfChunks([full.slice(0, cut), full.slice(cut)]));

  assert.deepEqual(
    events, [{ type: 'delta', text: 'hello world' }],
    'parsing per chunk drops a split frame — which shows up as MISSING WORDS in the ' +
    'answer, not as an error, so nothing surfaces it',
  );
});

test('🔴 a multi-byte character split across chunks survives', async () => {
  // "café ☕" — both é (2 bytes) and ☕ (3 bytes) are multi-byte.
  const full = frame({ type: 'delta', text: 'café ☕' });
  const bytes = new TextEncoder().encode(full);

  // Split INSIDE the ☕ sequence: find it, then cut one byte in.
  const coffee = new TextEncoder().encode('☕');
  let at = -1;
  for (let i = 0; i <= bytes.length - coffee.length; i += 1) {
    if (coffee.every((b, k) => bytes[i + k] === b)) { at = i; break; }
  }
  assert.ok(at > 0, 'fixture must actually contain the multi-byte sequence');

  const events = await collect(streamOfChunks([bytes.slice(0, at + 1), bytes.slice(at + 1)]));
  assert.equal(
    events[0].text, 'café ☕',
    'one TextDecoder with { stream: true } holds the partial sequence. Decoding each ' +
    'chunk independently yields U+FFFD for any character unlucky enough to land on a ' +
    'boundary — intermittent, and dependent purely on network timing',
  );
});

test('many frames in ONE chunk all arrive, in order', async () => {
  const events = await collect(streamOfChunks([
    frame({ type: 'delta', text: 'a' }) + frame({ type: 'delta', text: 'b' }) + frame({ type: 'delta', text: 'c' }),
  ]));
  assert.deepEqual(events.map((e) => e.text), ['a', 'b', 'c']);
});

test('the [DONE] sentinel and a done event both close the stream', async () => {
  const viaSentinel = await collect(streamOfChunks([frame({ type: 'delta', text: 'x' }), 'data: [DONE]\n\n']));
  assert.equal(viaSentinel.length, 1, 'the sentinel must not be yielded as an event');

  const viaDone = await collect(streamOfChunks([
    frame({ type: 'delta', text: 'x' }),
    frame({ type: 'done' }),
    frame({ type: 'delta', text: 'must not arrive' }),
  ]));
  assert.deepEqual(viaDone.map((e) => e.type), ['delta', 'done'], 'nothing is read past done');
});

test('an unparseable frame is skipped, never fatal', async () => {
  const events = await collect(streamOfChunks([
    'data: {not json\n\n',
    frame({ type: 'delta', text: 'still here' }),
  ]));
  assert.deepEqual(events, [{ type: 'delta', text: 'still here' }],
    'one bad frame must not abort a turn the user already paid for');
});

// ─── The visible state ────────────────────────────────────────────────────────────────

test('🔴 the query is VISIBLE while its search is running, and clears after', () => {
  const during = fold([
    { type: 'delta', text: 'Let me check. ' },
    { type: 'search_start', query: 'current xeno pricing', iteration: 1 },
  ]);
  assert.equal(
    during.activeSearch, 'current xeno pricing',
    'this is the whole point of streaming the loop: the user sees WHAT is being searched ' +
    'while it happens, instead of watching a silent pause',
  );
  assert.equal(during.text, 'Let me check. ', 'text written before the search is kept');

  const after = applyChatStreamEvent(during, {
    type: 'search_result', query: 'current xeno pricing', count: 3,
    sources: [{ url: 'https://a.test', title: 'A' }],
  });
  assert.equal(after.activeSearch, null, 'a finished search must stop showing as running');
  assert.deepEqual(after.searches, [{ query: 'current xeno pricing', count: 3 }]);
});

test('a failed search is recorded as failed, not silently dropped', () => {
  const state = fold([
    { type: 'search_start', query: 'q', iteration: 1 },
    { type: 'search_error', query: 'q', code: 'web_context_unavailable', message: 'could not complete' },
  ]);
  assert.equal(state.activeSearch, null, 'a failed search must not spin forever');
  assert.deepEqual(state.searches, [{ query: 'q', count: 0, failed: true }]);
  assert.equal(state.error, null, 'a failed SEARCH is not a failed TURN');
});

test('🔴 sources are deduped across searches, keeping first-seen order', () => {
  const state = fold([
    { type: 'search_result', query: 'a', count: 2, sources: [
      { url: 'https://one.test', title: 'One' }, { url: 'https://two.test', title: 'Two' },
    ] },
    { type: 'search_result', query: 'b', count: 2, sources: [
      { url: 'https://two.test', title: 'Two again' }, { url: 'https://three.test', title: 'Three' },
    ] },
  ]);
  assert.deepEqual(
    state.sources.map((s) => s.url),
    ['https://one.test', 'https://two.test', 'https://three.test'],
    'the same source legitimately appears across several searches in one turn; listing it ' +
    'twice reads as a bug in the citations',
  );
});

test('a mid-turn error KEEPS the text already written', () => {
  const state = fold([
    { type: 'delta', text: 'Here is what I found so far' },
    { type: 'error', error: 'inference_error', message: 'The inference stream failed.' },
  ]);
  assert.equal(state.text, 'Here is what I found so far',
    'a turn that failed halfway still wrote real words, and the user was billed for them');
  assert.equal(state.done, true, 'an error is terminal');
  assert.match(state.error, /failed/);
});

test('a truncated turn reports that it was capped', () => {
  const state = fold([{ type: 'tool_use', searches: 10, iterations: 11, cappedOut: true }]);
  assert.equal(state.cappedOut, true,
    'cappedOut is the only signal the answer may be incomplete — the UI needs it to say so');
});

test('usage and credits reach the state for the cost display', () => {
  const state = fold([{ type: 'usage', input: 100, output: 50, total: 150, creditsSettled: 0.4 }]);
  assert.deepEqual(state.usage, { input: 100, output: 50, total: 150, creditsSettled: 0.4 });
});

test('an ordinary chat turn produces no search furniture', () => {
  const state = fold([
    { type: 'delta', text: 'Hi ' }, { type: 'delta', text: 'there' }, { type: 'done' },
  ]);
  assert.equal(state.text, 'Hi there');
  assert.deepEqual(state.searches, [], 'no searches means nothing search-shaped on screen');
  assert.equal(state.activeSearch, null);
  assert.equal(state.cappedOut, false);
});

// ─── readGenerateResponse: one payload, two transports ────────────────────────────────

/**
 * 🔴 The contract that makes this safe to ship.
 *
 * `fetchAiResponse` has ~400 lines of downstream handling keyed off the shape of `data` —
 * reasoning, project sources, images, usage. If the streamed path returned anything even
 * slightly different, all of it would fork. So the rule is: streaming changes WHEN the
 * caller learns things, never WHAT it gets.
 *
 * Mutation-checked 2026-09-14:
 *   assume streaming instead of reading content-type -> the JSON-fallback test fails
 *   swallow the error frame instead of throwing      -> the in-band error test fails
 */
const sseResponse = (frames) => new Response(
  new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(new TextEncoder().encode(f));
      controller.close();
    },
  }),
  { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
);

const named = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

test('🔴 a JSON response is returned unchanged — an older backend keeps working', async () => {
  const { readGenerateResponse } = await import('../src/components/playground/Chat/chatStream.ts');
  const payload = { text: 'answer', usage: { total: 10 }, searchInfo: { sources: [] } };
  const response = new Response(JSON.stringify(payload), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  assert.deepEqual(
    await readGenerateResponse(response), payload,
    'the Accept header is a REQUEST, not a promise — a server that answers JSON must be ' +
    'handled by reading the RESPONSE content-type, never by assuming the request worked',
  );
});

test('🔴 a streamed turn returns the SAME object, after reporting progress', async () => {
  const { readGenerateResponse } = await import('../src/components/playground/Chat/chatStream.ts');
  const payload = {
    text: 'The answer',
    searchInfo: { sources: [{ url: 'https://a.test', title: 'A' }] },
    toolUse: { searches: 2, iterations: 3, cappedOut: false },
  };
  const response = sseResponse([
    named('search_start', { query: 'first query', iteration: 1 }),
    named('search_start', { query: 'second query', iteration: 2 }),
    named('result', payload),
    'data: [DONE]\n\n',
  ]);

  const seen = [];
  const data = await readGenerateResponse(response, (e) => seen.push(e.query));

  assert.deepEqual(data, payload, 'the terminal frame must carry the identical response object');
  assert.deepEqual(seen, ['first query', 'second query'],
    'each query must reach the UI while the turn is still running');
});

test('🔴 an in-band error THROWS, so the existing catch handles it', async () => {
  const { readGenerateResponse } = await import('../src/components/playground/Chat/chatStream.ts');
  const response = sseResponse([
    named('search_start', { query: 'q', iteration: 1 }),
    named('error', { code: 'generation_failed', message: 'Failed to generate chat response.' }),
    'data: [DONE]\n\n',
  ]);
  await assert.rejects(
    () => readGenerateResponse(response),
    /Failed to generate/,
    'a streamed failure arrives with HTTP 200 (the status was fixed when the first frame went ' +
    'out), so without throwing it would read as success with an empty body',
  );
});

test('a stream that ends with no result frame is an error, not silent success', async () => {
  const { readGenerateResponse } = await import('../src/components/playground/Chat/chatStream.ts');
  const response = sseResponse([named('search_start', { query: 'q', iteration: 1 })]);
  await assert.rejects(
    () => readGenerateResponse(response), /ended before an answer/,
    'a truncated stream must not resolve to undefined and render as a blank reply',
  );
});

test('a result frame split across chunks still parses', async () => {
  const { readGenerateResponse } = await import('../src/components/playground/Chat/chatStream.ts');
  const payload = { text: 'answer with a somewhat longer body so the split lands mid-JSON' };
  const full = named('result', payload);
  const cut = Math.floor(full.length / 2);
  const data = await readGenerateResponse(sseResponse([full.slice(0, cut), full.slice(cut), 'data: [DONE]\n\n']));
  assert.deepEqual(data, payload);
});

// ─── Task routing: which endpoint serves this turn ────────────────────────────────────

/**
 * 🔴 A wrong answer here sends an image generation to a route that cannot persist it.
 *
 * The two endpoints are not interchangeable. /api/ai/chat/stream serves a CHAT TURN — text,
 * tools, project grounding, citations. /api/chat/generate keeps `task: 'image'` and
 * `refine_image_prompt`, which are not chat turns: the image task writes a file, registers a
 * library item and logs credits before the chat path runs at all, and both return fields
 * (`libraryItemId`, `libraryContentUrl`, `refinedPromptText`) a chat turn cannot produce.
 *
 * Mutation-checked 2026-09-14:
 *   route image tasks to the stream endpoint  -> the image test fails
 *   drop projectId from streamRequestBody     -> the project test fails
 */
test('🔴 image tasks stay on the route that can persist them', async () => {
  const { endpointForTask, CHAT_GENERATE_ENDPOINT, CHAT_STREAM_ENDPOINT } =
    await import('../src/components/playground/Chat/chatStream.ts');

  assert.equal(endpointForTask('image'), CHAT_GENERATE_ENDPOINT,
    'image generation writes a file, registers a library item and logs credits — the ' +
    'streaming route does none of that and would drop the result on the floor');
  assert.equal(endpointForTask('refine_image_prompt'), CHAT_GENERATE_ENDPOINT,
    'refinement returns a PROMPT, not an assistant message');

  assert.equal(endpointForTask(undefined), CHAT_STREAM_ENDPOINT, 'an ordinary chat turn streams');
  assert.equal(endpointForTask(''), CHAT_STREAM_ENDPOINT, 'an empty task is still a chat turn');
});

test('🔴 the streaming request carries everything the turn needs', async () => {
  const { streamRequestBody } = await import('../src/components/playground/Chat/chatStream.ts');

  const body = streamRequestBody({
    selectedModelId: 'openai/gpt-5.5',
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    effectiveReasoningState: true,
    systemPrompt: 'You are XENO.',
    conversationId: 'c1',
    projectId: 'p1',
    chatSurface: 'research',
  });

  // The names differ because that route predates this client and also serves OpenAI-shaped
  // API callers. Translating in ONE place is what keeps two payload shapes out of the component.
  assert.equal(body.model, 'openai/gpt-5.5', 'the route takes `model`, not `selectedModelId`');
  assert.equal(body.reasoning, true, 'and `reasoning`, not `effectiveReasoningState`');

  // Each of these silently loses a capability if dropped.
  assert.equal(body.projectId, 'p1', 'without it a project turn loses its grounding AND its audit record');
  assert.equal(body.conversationId, 'c1', 'a project turn cannot be recorded without one');
  assert.equal(body.chatSurface, 'research', 'the surface is what picks the tool budget server-side');
  assert.ok(Array.isArray(body.messages), 'the parts[] shape travels as-is; the server converts it');
});

test('the streamed turn returns the SAME object shape as the JSON route', async () => {
  const { readStreamedTurn } = await import('../src/components/playground/Chat/chatStream.ts');

  const frames = [
    frame({ type: 'delta', text: 'Par' }),
    frame({ type: 'delta', text: 'is' }),
    frame({
      type: 'result',
      answer: 'Paris',
      thinking: 'considering',
      reasoningProcessed: true,
      modelIdUsed: 'deepseek/deepseek-r1',
      projectContextId: 'rec-1',
      usage: { total_tokens: 15 },
    }),
    'data: [DONE]\n\n',
  ];
  const response = new Response(
    new ReadableStream({
      start(c) { for (const f of frames) c.enqueue(new TextEncoder().encode(f)); c.close(); },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

  const seen = [];
  const data = await readStreamedTurn(response, (e) => seen.push(e.type));

  assert.equal(data.answer, 'Paris');
  assert.equal(data.reasoningProcessed, true);
  assert.equal(data.projectContextId, 'rec-1', 'project linkage must survive the transport');
  assert.ok(!('type' in data),
    'the frame discriminator must not leak into the payload — downstream reads a response ' +
    'object, not an event');
  assert.deepEqual(seen, ['delta', 'delta'], 'deltas reach the UI as they arrive');
});

test('🔴 a streamed error becomes a thrown Error, not a silent empty answer', async () => {
  const { readStreamedTurn } = await import('../src/components/playground/Chat/chatStream.ts');
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(frame({ type: 'delta', text: 'partial' })));
        c.enqueue(new TextEncoder().encode(frame({ type: 'error', error: 'inference_error', message: 'The inference stream failed.' })));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
  await assert.rejects(
    () => readStreamedTurn(response), /inference stream failed/,
    'a streamed failure arrives with HTTP 200 — the status was fixed when the first frame ' +
    'went out — so without throwing it reads as success with an empty body',
  );
});

/**
 * A streamed completion must assemble EXACTLY what a buffered one returns.
 *
 * ## Why that is the whole contract
 *
 * `/api/chat/generate` has ~130 lines of post-processing between the model call and its
 * response, and they read exactly two fields — `data.choices` and `data.usage` (measured in
 * the route, not assumed). So token streaming is safe there if, and only if, the streaming
 * call hands back the same shape a buffered call does.
 *
 * That is what makes this a two-line branch in the route instead of a rewrite, and it is why
 * the client was NOT migrated to `/api/ai/chat/stream`: doing that would have meant porting
 * the image-referral heuristic and the project-context path to chase a transport.
 *
 * 🔴 The failures this pins are all QUIET ones — they produce a plausible answer:
 *   - an in-band error frame closes the stream NORMALLY, so a failed generation would be
 *     assembled and reported as a success
 *   - a frame split across chunks drops words out of the middle of an answer
 *   - a multi-byte character split across chunks becomes U+FFFD, intermittently, depending
 *     only on network timing
 *   - `content: null` instead of `''` is rejected by providers when the message is replayed
 *     as history, which is what the tool loop does on every iteration
 *
 * Mutation-checked 2026-09-14, each failing alone with a green control:
 *   parse each chunk independently          -> the split-frame test fails
 *   new TextDecoder() per chunk             -> the multi-byte test fails
 *   ignore chunk.error                      -> the in-band error test fails
 *   return content: null when empty         -> the empty-content test fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { streamCompletion } from '../src/server/utils/streamingCompletion.js';

/** A fake upstream that replies with exactly the byte chunks given. */
const upstream = (chunks, { ok = true, status = 200, body = null } = {}) => async () => {
  if (!ok) return { ok, status, text: async () => body ?? '', body: null };
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (const c of chunks) {
          controller.enqueue(c instanceof Uint8Array ? c : new TextEncoder().encode(c));
        }
        controller.close();
      },
    }),
  };
};

const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (d) => frame({ choices: [{ delta: d }] });

/** Run streamCompletion against a fake fetch, collecting the deltas it emitted. */
async function run(chunks, options = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = upstream(chunks, options);
  const seen = [];
  try {
    const result = await streamCompletion({
      url: 'https://upstream.test/chat/completions',
      apiKey: 'k',
      payload: { model: 'm', messages: [] },
      onDelta: (t) => seen.push(t),
      ...options.args,
    });
    return { result, seen };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('🔴 the assembled shape matches a buffered response', async () => {
  const { result, seen } = await run([
    delta({ content: 'Hello' }),
    delta({ content: ' world' }),
    frame({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }),
    'data: [DONE]\n\n',
  ]);

  assert.deepEqual(result.choices, [{
    message: { role: 'assistant', content: 'Hello world' },
    finish_reason: 'stop',
  }], 'the ~130 lines of post-processing read data.choices — the shape must be identical');
  assert.deepEqual(result.usage, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    'usage drives the settle; losing it bills the reserved worst case');
  assert.deepEqual(seen, ['Hello', ' world'], 'each token must reach the client as it arrives');
});

test('🔴 a frame split across chunks is not dropped', async () => {
  const full = delta({ content: 'unbroken' });
  const cut = Math.floor(full.length / 2);
  const { result } = await run([full.slice(0, cut), full.slice(cut), 'data: [DONE]\n\n']);
  assert.equal(result.choices[0].message.content, 'unbroken',
    'parsing per chunk drops split frames, which reads as MISSING WORDS mid-answer');
});

test('🔴 a multi-byte character split across chunks survives', async () => {
  const full = delta({ content: 'café ☕' });
  const bytes = new TextEncoder().encode(full);
  const coffee = new TextEncoder().encode('☕');
  let at = -1;
  for (let i = 0; i <= bytes.length - coffee.length; i += 1) {
    if (coffee.every((b, k) => bytes[i + k] === b)) { at = i; break; }
  }
  assert.ok(at > 0, 'fixture must contain the multi-byte sequence');

  const { result } = await run([bytes.slice(0, at + 1), bytes.slice(at + 1), 'data: [DONE]\n\n']);
  assert.equal(result.choices[0].message.content, 'café ☕',
    'ONE decoder with { stream: true } holds the partial sequence across the boundary');
});

test('🔴 an in-band error THROWS instead of assembling a partial success', async () => {
  await assert.rejects(
    () => run([
      delta({ content: 'partial' }),
      frame({ error: { message: 'upstream exploded' } }),
      'data: [DONE]\n\n',
    ]).then((r) => r.result),
    /upstream exploded/,
    'an error frame closes the stream NORMALLY — without catching it we would assemble ' +
    '"partial", report success, and settle the credit hold for a failed generation',
  );
});

test('a non-200 upstream throws with its status', async () => {
  await assert.rejects(
    () => run([], { ok: false, status: 429, body: JSON.stringify({ error: { message: 'rate limited' } }) })
      .then((r) => r.result),
    (err) => err.status === 429 && /rate limited/.test(err.message),
  );
});

test('🔴 tool calls are accumulated and reported as tool_calls', async () => {
  const { result } = await run([
    delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: '{"que' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: 'ry":"x"}' } }] }),
    'data: [DONE]\n\n',
  ]);
  const message = result.choices[0].message;
  assert.equal(message.tool_calls.length, 1);
  assert.equal(message.tool_calls[0].function.name, 'web_search');
  assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments), { query: 'x' },
    'fragments must be joined, never parsed mid-stream');
  assert.equal(result.choices[0].finish_reason, 'tool_calls',
    'the loop branches on finish_reason/tool_calls to decide whether to keep going');
});

test('🔴 empty content is a STRING, never null', async () => {
  // The tool loop replays this message verbatim before its tool results; several providers
  // reject a null content there, which would fail the turn on the NEXT iteration.
  const { result } = await run([
    delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"query":"q"}' } }] }),
    'data: [DONE]\n\n',
  ]);
  assert.equal(result.choices[0].message.content, '',
    'a model that calls a tool without narrating produces no text — that must serialize as ""');
});

test('reasoning is captured separately from the answer', async () => {
  const seenReasoning = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = upstream([
    delta({ reasoning: 'weighing options' }),
    delta({ content: 'the answer' }),
    'data: [DONE]\n\n',
  ]);
  try {
    const result = await streamCompletion({
      url: 'https://upstream.test/chat/completions',
      apiKey: 'k',
      payload: { model: 'm', messages: [] },
      onReasoning: (t) => seenReasoning.push(t),
    });
    assert.equal(result.choices[0].message.content, 'the answer',
      'thinking must not be concatenated into the answer');
    assert.equal(result.choices[0].message.reasoning, 'weighing options');
    assert.deepEqual(seenReasoning, ['weighing options']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the request asks for usage, or the turn bills from an estimate', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return upstream(['data: [DONE]\n\n'])();
  };
  try {
    await streamCompletion({ url: 'https://u.test/c', apiKey: 'k', payload: { model: 'm', messages: [] } });
    assert.equal(sentBody.stream, true);
    assert.deepEqual(sentBody.stream_options, { include_usage: true },
      'without include_usage the final usage chunk never arrives and the meter charges the ' +
      'reserved worst case instead of actual cost');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an unparseable frame is skipped, never fatal', async () => {
  const { result } = await run([
    'data: {not json\n\n',
    delta({ content: 'survived' }),
    'data: [DONE]\n\n',
  ]);
  assert.equal(result.choices[0].message.content, 'survived');
});

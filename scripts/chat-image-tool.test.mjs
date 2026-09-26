/**
 * The chat's generate_image tool, executed.
 *
 * ChatGPT-style image generation (2026-09-26): the chat model decides to draw, writes the prompt
 * itself, and the image arrives as a step of the answer — replacing a keyword matcher in the browser
 * that sent the user's raw words to the image model. These tests pin the properties that decide
 * whether that is real or a declaration without an executor:
 *
 *   - the model's OWN prompt and aspect ratio reach the image service, not the user's message;
 *   - the shape is announced BEFORE the wait, so the chat can size its placeholder;
 *   - a failed image is a RESULT (for the model and the user), never a thrown turn;
 *   - billing is hold -> generate -> store -> settle, and a failure anywhere voids the hold;
 *   - Free output is watermarked, fail-closed;
 *   - the per-turn image budget is enforced by the server, not by asking nicely;
 *   - the tool is only declared where an executor exists.
 *
 * Mutation-checked: each assertion was made to fail by reverting the property it names.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamToolLoop, WEB_SEARCH_TOOL } from '../src/server/utils/chatToolLoop.js';
import {
  GENERATE_IMAGE_TOOL,
  CHAT_IMAGE_BUDGET,
  CHAT_IMAGE_CREDITS,
  CHAT_IMAGE_MODEL,
  parseImageArguments,
  createChatImageExecutor,
  storeChatImage,
  imageDimensions,
  base64FromImageItem,
  imageUsageFrom,
} from '../src/server/utils/chatImageTool.js';
import { normalizeTurnRecord, TURN_SCHEMA } from '../src/server/utils/chatTurnRecord.js';

const streamOf = (events) => (async function* gen() { for (const e of events) yield e; }());
const drain = async (it) => { const out = []; for await (const e of it) out.push(e); return out; };
const imageCall = (args, id = 'img_1') => streamOf([
  { type: 'tool_calls', toolCalls: [{ id, function: { name: 'generate_image', arguments: JSON.stringify(args) } }] },
  { type: 'usage', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
]);
const answer = (text) => streamOf([{ type: 'delta', text }, { type: 'usage', usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }]);
// a real 2x1 PNG, so the stored record carries real dimensions
const PNG_2x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwnwEIGAEAKHAEAMcNJ8gAAAAASUVORK5CYII=', 'base64');

test('the model writes the prompt and picks the shape — both reach the image service', async () => {
  const seen = [];
  let calls = 0;
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'draw me a fox' }],
    surface: 'chat',
    turnId: 't1',
    tools: [GENERATE_IMAGE_TOOL],
    streamModel: () => (++calls === 1
      ? imageCall({ prompt: 'A red fox in fresh snow at dawn, low sun, 35mm photo', aspect_ratio: '16:9', quality: 'high' })
      : answer('Here is your fox.')),
    runSearch: async () => { throw new Error('search must not run'); },
    runImage: async (args) => { seen.push(args); return { id: 'a1', contentUrl: '/api/library/assets/a1/content', model: CHAT_IMAGE_MODEL, aspectRatio: args.aspectRatio, prompt: args.prompt }; },
  }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].prompt, 'A red fox in fresh snow at dawn, low sun, 35mm photo', 'the MODEL\'s prompt, not the user\'s words');
  assert.equal(seen[0].aspectRatio, '16:9');
  const types = events.map((e) => e.type);
  assert.ok(types.indexOf('image_start') < types.indexOf('image_result'), 'image_start comes first');
  assert.equal(events.find((e) => e.type === 'image_result').image.id, 'a1');
  assert.equal(events.find((e) => e.type === 'complete').images, 1);
});

test('the shape is announced BEFORE the image exists, so the chat can size its placeholder', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let finished = false;
  let calls = 0;
  const loop = streamToolLoop({
    messages: [{ role: 'user', content: 'a tall poster' }],
    surface: 'chat', turnId: 't2', tools: [GENERATE_IMAGE_TOOL],
    streamModel: () => (++calls === 1 ? imageCall({ prompt: 'poster', aspect_ratio: '9:16' }) : answer('done')),
    runSearch: async () => ({ sources: [] }),
    runImage: async () => { await gate; finished = true; return { id: 'a2' }; },
  });
  let start = null;
  for await (const e of loop) { if (e.type === 'image_start') { start = e; break; } }
  assert.equal(start?.aspectRatio, '9:16');
  assert.equal(finished, false, 'image_start must reach the client while the image is still generating');
  release();
});

test('a failed image is a RESULT for the model and an event for the user — the turn still answers', async () => {
  let calls = 0;
  const upstream = [];
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'draw' }],
    surface: 'chat', turnId: 't3', tools: [GENERATE_IMAGE_TOOL],
    streamModel: ({ messages }) => { upstream.push(messages); return ++calls === 1 ? imageCall({ prompt: 'x' }) : answer('Sorry, that failed.'); },
    runSearch: async () => ({ sources: [] }),
    runImage: async () => { throw Object.assign(new Error('The image service returned an error.'), { code: 'image_upstream' }); },
  }));
  const failure = events.find((e) => e.type === 'image_error');
  assert.equal(failure?.code, 'image_upstream');
  const toolMsg = upstream[1].find((m) => m.role === 'tool');
  assert.match(toolMsg.content, /image generation failed/, 'the model is told the truth so it can say so');
  assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Sorry, that failed.');
});

test('the per-turn image budget is enforced by the server', async () => {
  let calls = 0;
  let drawn = 0;
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'draw ten' }],
    surface: 'chat', turnId: 't4', tools: [GENERATE_IMAGE_TOOL],
    streamModel: () => {
      calls += 1;
      if (calls === 1) {
        return streamOf([{ type: 'tool_calls', toolCalls: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, function: { name: 'generate_image', arguments: '{"prompt":"p"}' } })) }]);
      }
      return answer('ok');
    },
    runSearch: async () => ({ sources: [] }),
    runImage: async ({ index }) => { drawn += 1; return { id: `a${index}` }; },
  }));
  assert.equal(drawn, CHAT_IMAGE_BUDGET, `no more than ${CHAT_IMAGE_BUDGET} images per turn, however many the model asks for`);
  assert.equal(events.filter((e) => e.type === 'image_start').length, CHAT_IMAGE_BUDGET);
});

test('the image tool is only honoured where it was offered with an executor', async () => {
  let calls = 0;
  let drawn = 0;
  await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'draw' }],
    surface: 'chat', turnId: 't5', tools: [WEB_SEARCH_TOOL],   // not offered
    streamModel: () => (++calls === 1 ? imageCall({ prompt: 'p' }) : answer('ok')),
    runSearch: async () => ({ sources: [] }),
    runImage: async () => { drawn += 1; return { id: 'x' }; },
  }));
  assert.equal(drawn, 0, 'a tool that was not declared must not run');
});

test('search can be down while images are not: tools are offered independently', async () => {
  let offered = null;
  await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'hi' }],
    surface: 'chat', turnId: 't6', tools: [GENERATE_IMAGE_TOOL],
    streamModel: ({ tools }) => { offered = tools; return answer('hi'); },
    runSearch: async () => ({ sources: [] }),
    runImage: async () => ({ id: 'x' }),
  }));
  assert.deepEqual(offered.map((t) => t.function.name), ['generate_image']);
});

test('arguments: a bad aspect or quality falls back rather than failing; an empty prompt is refused', () => {
  assert.deepEqual(parseImageArguments('{"prompt":"a cat","aspect_ratio":"21:9","quality":"ultra"}'), { ok: true, prompt: 'a cat', aspectRatio: '1:1', quality: 'high', useLatestImage: false });
  assert.equal(parseImageArguments('{"prompt":"bluer","use_latest_image":true}').useLatestImage, true);
  assert.equal(parseImageArguments('{"prompt":"bluer","use_latest_image":"yes"}').useLatestImage, false, 'only a real boolean asks for an edit');
  assert.equal(parseImageArguments('{"prompt":"  "}').ok, false);
  assert.equal(parseImageArguments('{"prompt":').ok, false);
  assert.equal(parseImageArguments('[]').ok, false);
});

/** A fake meter with the real contract: hold, run, then settle for what was produced — or void. */
const fakeMeter = (log) => async (db, userId, opts) => {
  log.push(['hold', opts.requestId, opts.unitCostMicro, opts.model]);
  try {
    const result = await opts.run();
    log.push(['settle', result.data.length]);
    return { result, creditsCharged: (opts.unitCostMicro * result.data.length) / 1_000_000 };
  } catch (e) {
    log.push(['void']);
    throw e;
  }
};

test('billing: hold for one image, generate with the model\'s shape, store, then settle', async () => {
  const log = [];
  let sent = null;
  const run = createChatImageExecutor({
    db: {}, userId: 'u1', turnId: 'turn9',
    meter: fakeMeter(log),
    generate: async (payload) => { sent = payload; return { data: [{ b64_json: PNG_2x1.toString('base64') }] }; },
    resolveEntitlements: async () => ({ watermark: false }),
    watermark: async () => { throw new Error('must not watermark a paid account'); },
    store: async ({ buffer, aspectRatio }) => { log.push(['store', buffer.length, aspectRatio]); return { id: 'asset1', contentUrl: '/api/library/assets/asset1/content', width: 2, height: 1 }; },
    microPerCredit: 1_000_000,
  });
  const image = await run({ prompt: 'a fox', aspectRatio: '16:9', quality: 'high', index: 0 });
  assert.deepEqual(log.map((l) => l[0]), ['hold', 'store', 'settle'], 'stored INSIDE the metered run, settled after');
  assert.equal(log[0][1], 'turn9:image:0', 'deterministic per image of the turn');
  assert.equal(log[0][2], CHAT_IMAGE_CREDITS * 1_000_000);
  assert.equal(sent.model, CHAT_IMAGE_MODEL);
  assert.equal(sent.aspect_ratio, '16:9');
  assert.equal(sent.response_format, 'b64_json');
  assert.equal(image.id, 'asset1');
  assert.equal(image.creditsCharged, CHAT_IMAGE_CREDITS);
});

test('the image call\'s own tokens reach the result — as the gateway reported them, never guessed', async () => {
  const run = (usage) => createChatImageExecutor({
    db: {}, userId: 'u1', turnId: 'turnU',
    meter: fakeMeter([]),
    generate: async () => ({ data: [{ b64_json: PNG_2x1.toString('base64') }], ...(usage === undefined ? {} : { usage }) }),
    resolveEntitlements: async () => ({ watermark: false }),
    watermark: async (b) => b,
    store: async () => ({ id: 'asset1', contentUrl: '/api/library/assets/asset1/content' }),
    microPerCredit: 1_000_000,
  })({ prompt: 'a fox', aspectRatio: '1:1', quality: 'low', index: 0 });
  // the shape measured on the live gateway 2026-09-26
  const reported = await run({ input_tokens: 40, input_tokens_details: { text_tokens: 40 }, output_tokens: 515, total_tokens: 555 });
  assert.deepEqual(reported.usage, { input: 40, output: 515, total: 555 });
  assert.equal((await run(undefined)).usage, undefined, 'no usage from the gateway is no usage, not a zero');
  assert.equal(imageUsageFrom({ usage: { input_tokens: -1, output_tokens: 'x' } }), null, 'malformed usage is dropped');
  assert.deepEqual(imageUsageFrom({ usage: { input_tokens: 3, output_tokens: 4 } }), { input: 3, output: 4, total: 7 }, 'a missing total is the sum');
});

test('billing: a failed generation voids the hold — nothing is charged', async () => {
  const log = [];
  const run = createChatImageExecutor({
    db: {}, userId: 'u1', turnId: 't',
    meter: fakeMeter(log),
    generate: async () => ({ data: [] }),
    resolveEntitlements: async () => ({}),
    watermark: async (b) => b,
    store: async () => { throw new Error('must not store'); },
    microPerCredit: 1_000_000,
  });
  await assert.rejects(run({ prompt: 'x', aspectRatio: '1:1', quality: 'high', index: 0 }), /returned no image/);
  assert.deepEqual(log.map((l) => l[0]), ['hold', 'void']);
});

test('billing: a save failure also voids the hold — never charged for an image you cannot see', async () => {
  const log = [];
  const run = createChatImageExecutor({
    db: {}, userId: 'u1', turnId: 't',
    meter: fakeMeter(log),
    generate: async () => ({ data: [{ b64_json: PNG_2x1.toString('base64') }] }),
    resolveEntitlements: async () => ({}),
    watermark: async (b) => b,
    store: async () => { throw new Error('disk full'); },
    microPerCredit: 1_000_000,
  });
  await assert.rejects(run({ prompt: 'x', aspectRatio: '1:1', quality: 'high', index: 0 }), /disk full/);
  assert.deepEqual(log.map((l) => l[0]), ['hold', 'void']);
});

test('Free output is watermarked, fail-closed', async () => {
  const log = [];
  let stored = null;
  const marked = Buffer.from('marked');
  const run = createChatImageExecutor({
    db: {}, userId: 'u1', turnId: 't',
    meter: fakeMeter(log),
    generate: async () => ({ data: [{ b64_json: PNG_2x1.toString('base64') }] }),
    resolveEntitlements: async () => ({ watermark: true }),
    watermark: async () => marked,
    store: async ({ buffer }) => { stored = buffer; return { id: 'a' }; },
    microPerCredit: 1,
  });
  await run({ prompt: 'x', aspectRatio: '1:1', quality: 'high', index: 0 });
  assert.equal(stored, marked, 'the stored bytes are the watermarked ones');

  const failing = createChatImageExecutor({
    db: {}, userId: 'u1', turnId: 't2',
    meter: fakeMeter(log),
    generate: async () => ({ data: [{ b64_json: PNG_2x1.toString('base64') }] }),
    resolveEntitlements: async () => ({ watermark: true }),
    watermark: async () => { throw new Error('watermark failed'); },
    store: async () => { throw new Error('a clean image must never be stored for Free'); },
    microPerCredit: 1,
  });
  await assert.rejects(failing({ prompt: 'x', aspectRatio: '1:1', quality: 'high', index: 0 }), /watermark failed/);
});

test('storeChatImage writes the file, registers it with its real size, and cleans up on failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-image-'));
  try {
    let registered = null;
    const rec = await storeChatImage({
      db: {}, userId: 'u', uploadsDir: dir, buffer: PNG_2x1, prompt: 'p', model: 'm', aspectRatio: '16:9',
      register: async (db, row) => { registered = row; return { id: 'lib-1' }; },
    });
    assert.equal(rec.contentUrl, '/api/library/assets/lib-1/content');
    assert.deepEqual([rec.width, rec.height], [2, 1]);
    assert.equal(registered.metadata.source, 'chat-generation');
    assert.equal(registered.metadata.aspectRatio, '16:9');
    assert.equal(readdirSync(dir).length, 1);

    await assert.rejects(storeChatImage({
      db: {}, userId: 'u', uploadsDir: dir, buffer: PNG_2x1, prompt: 'p', model: 'm', aspectRatio: '1:1',
      register: async () => { throw new Error('db down'); },
    }), /db down/);
    assert.equal(readdirSync(dir).length, 1, 'a file whose registration failed is removed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('helpers: base64 from a gateway item, PNG dimensions', () => {
  assert.equal(base64FromImageItem({ b64_json: 'abc' }), 'abc');
  assert.equal(base64FromImageItem({ url: 'data:image/png;base64,xyz' }), 'xyz');
  assert.equal(base64FromImageItem({ url: 'https://evil.example/x.png' }), null, 'a hosted URL is never fetched');
  assert.deepEqual(imageDimensions(PNG_2x1), { width: 2, height: 1 });
});

test('the saved turn accepts an image step — and nothing it could not store honestly', () => {
  const base = { schema: TURN_SCHEMA, startedAt: 1, steps: [] };
  const ok = normalizeTurnRecord({ ...base, steps: [{ id: 'image-1', kind: 'image', prompt: 'a fox', aspectRatio: '16:9', startedAt: 2, endedAt: 3, assetId: '11111111-2222-4333-8444-555555555555', width: 1792, height: 1024 }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.turn.steps[0].kind, 'image');
  assert.equal(normalizeTurnRecord({ ...base, steps: [{ id: 'i', kind: 'image', prompt: 'x', aspectRatio: '21:9', startedAt: 2 }] }).ok, false, 'an unsupported ratio');
  assert.equal(normalizeTurnRecord({ ...base, steps: [{ id: 'i', kind: 'image', prompt: 'x', aspectRatio: '1:1', startedAt: 2, assetId: 'https://evil.example/x.png' }] }).ok, false, 'an asset id is an id, never a URL');
  assert.equal(normalizeTurnRecord({ ...base, steps: [{ id: 'i', kind: 'image', prompt: 'x', aspectRatio: '1:1', startedAt: 2, contentUrl: 'javascript:alert(1)' }] }).turn.steps[0].contentUrl, undefined, 'unknown fields are dropped');
});

test('an image step records which model drew it and its tokens — and only well-formed ones', () => {
  const base = { schema: TURN_SCHEMA, startedAt: 1, steps: [] };
  const step = { id: 'image-1', kind: 'image', prompt: 'a fox', aspectRatio: '1:1', startedAt: 2, endedAt: 3 };
  const ok = normalizeTurnRecord({ ...base, steps: [{ ...step, model: 'gpt-image-2.5-sunburst', usage: { input: 40, output: 515, total: 555, extra: 1 } }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.turn.steps[0].model, 'gpt-image-2.5-sunburst');
  assert.deepEqual(ok.turn.steps[0].usage, { input: 40, output: 515, total: 555 }, 'only the three counts are kept');
  assert.equal(normalizeTurnRecord({ ...base, steps: [{ ...step, model: '<script>' }] }).ok, false, 'a model is a model id');
  assert.equal(normalizeTurnRecord({ ...base, steps: [{ ...step, usage: { input: 1, output: -2, total: 3 } }] }).ok, false, 'token counts are non-negative integers');
  assert.equal(normalizeTurnRecord({ ...base, steps: [{ ...step, usage: 'lots' }] }).ok, false);
});

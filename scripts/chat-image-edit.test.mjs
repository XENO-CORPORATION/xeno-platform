/**
 * The chat's generate_image tool, EDITING — "make it blue", "same scene at night", "turn this photo
 * into a watercolour" (2026-09-26).
 *
 * ChatGPT's in-chat image generation is iterative, and a tool that could only start from nothing
 * makes the model re-describe the whole picture and get a different one. These tests pin what makes
 * editing safe and honest:
 *
 *   - the SERVER picks the image an edit starts from, from the conversation — the model can ask for
 *     "the latest image" and can never name bytes or a URL;
 *   - what the gateway would refuse (a type it rejects, bytes that are not a picture) never leaves;
 *   - an edit keeps its reference's shape, and that is the shape announced before the wait;
 *   - asking to edit with nothing to edit is a fresh image, not an error;
 *   - the instant preview is made from the DELIVERED bytes, so a Free account's preview carries its
 *     watermark, and a preview failure never costs the image or a second charge.
 *
 * Kept beside chat-image-tool.test.mjs rather than in it: that file pins generation and billing,
 * this one pins where an edit's starting point comes from.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { streamToolLoop } from '../src/server/utils/chatToolLoop.js';
import {
  GENERATE_IMAGE_TOOL,
  createChatImageExecutor,
  latestConversationImage,
  nearestAspect,
  makeImagePreview,
  imageResultPayload,
  imageDimensions,
} from '../src/server/utils/chatImageTool.js';

const PNG_2x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwnwEIGAEAKHAEAMcNJ8gAAAAASUVORK5CYII=', 'base64');
const PNG_B64 = PNG_2x1.toString('base64');
// A JPEG header only as far as its SOF0 marker: 30 wide, 40 tall.
const JPEG_30x40 = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x28, 0x00, 0x1e, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9, 0x00, 0x00, 0x00]);

const streamOf = (events) => (async function* gen() { for (const e of events) yield e; }());
const drain = async (it) => { const out = []; for await (const e of it) out.push(e); return out; };
const imageCall = (args) => streamOf([
  { type: 'tool_calls', toolCalls: [{ id: 'img_1', function: { name: 'generate_image', arguments: JSON.stringify(args) } }] },
]);
const answer = (text) => streamOf([{ type: 'delta', text }]);

const fakeMeter = (log) => async (db, userId, opts) => {
  log.push(['hold', opts.requestId]);
  try {
    const result = await opts.run();
    log.push(['settle', result.data.length]);
    return { result, creditsCharged: 10 };
  } catch (e) {
    log.push(['void']);
    throw e;
  }
};

test('the reference is the newest image in the conversation — the assistant\'s own included', () => {
  const conversation = [
    { role: 'user', parts: [{ type: 'text', text: 'draw a fox' }] },
    { role: 'model', parts: [{ type: 'text', text: 'Here it is.' }, { type: 'image', media_type: 'image/png', data: PNG_B64 }] },
    { role: 'user', parts: [{ type: 'text', text: 'make it blue' }] },
  ];
  const ref = latestConversationImage(conversation);
  assert.ok(ref, 'found — the conversion to provider messages drops an assistant\'s images, so this must read the raw parts');
  assert.equal(ref.dataUrl, `data:image/png;base64,${PNG_B64}`);
  assert.deepEqual([ref.width, ref.height], [2, 1], 'real pixels, read from the header');
});

test('a picture attached to THIS message wins over an older one', () => {
  const conversation = [
    { role: 'model', parts: [{ type: 'image', media_type: 'image/png', data: PNG_B64 }] },
    { role: 'user', parts: [{ type: 'image', media_type: 'image/jpeg', data: JPEG_30x40.toString('base64') }, { type: 'text', text: 'turn this into a watercolour' }] },
  ];
  const ref = latestConversationImage(conversation);
  assert.equal(ref?.mediaType, 'image/jpeg');
  assert.deepEqual([ref.width, ref.height], [30, 40]);
  assert.equal(ref.aspectRatio, '3:4');
});

test('nothing the gateway would refuse is ever forwarded', () => {
  assert.equal(latestConversationImage([{ role: 'user', parts: [{ type: 'image', media_type: 'image/svg+xml', data: PNG_B64 }] }]), null, 'an unsupported type');
  assert.equal(latestConversationImage([{ role: 'user', parts: [{ type: 'image', media_type: 'image/png', data: Buffer.from('not an image at all').toString('base64') }] }]), null, 'bytes that are not a picture');
  assert.equal(latestConversationImage([{ role: 'user', parts: [{ type: 'image', media_type: 'image/png', data: 'https://evil.example/x.png' }] }]), null, 'a URL is not image data');
  assert.equal(latestConversationImage([{ role: 'user', content: 'hi' }]), null, 'an OpenAI-shaped message has no parts');
  assert.equal(latestConversationImage(undefined), null);
});

test('nearestAspect: the supported ratio closest to the real shape, on a log scale', () => {
  assert.equal(nearestAspect(1792, 1024), '16:9');
  assert.equal(nearestAspect(1024, 1792), '9:16');
  assert.equal(nearestAspect(1024, 1024), '1:1');
  assert.equal(nearestAspect(1536, 1024), '3:2');
  assert.equal(nearestAspect(0, 10), '1:1', 'unreadable is square');
});

test('an edit announces its REFERENCE\'s shape, not the model\'s guess', async () => {
  let asked = null;
  let calls = 0;
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'make it blue' }],
    surface: 'chat', turnId: 'e1', tools: [GENERATE_IMAGE_TOOL],
    imageReference: { aspectRatio: '16:9' },
    streamModel: () => (++calls === 1 ? imageCall({ prompt: 'the same fox, blue', aspect_ratio: '1:1', use_latest_image: true }) : answer('Done.')),
    runSearch: async () => ({ sources: [] }),
    runImage: async (args) => { asked = args; return { id: 'a', edited: true }; },
  }));
  const start = events.find((e) => e.type === 'image_start');
  assert.equal(start.aspectRatio, '16:9', 'the placeholder must be the shape the picture will be');
  assert.equal(start.edit, true);
  assert.equal(asked.useReference, true);
  assert.equal(asked.aspectRatio, '16:9');
});

test('asking to edit with nothing to edit is a fresh image in the model\'s shape', async () => {
  let asked = null;
  let calls = 0;
  const events = await drain(streamToolLoop({
    messages: [{ role: 'user', content: 'make it blue' }],
    surface: 'chat', turnId: 'e2', tools: [GENERATE_IMAGE_TOOL],
    imageReference: null,
    streamModel: () => (++calls === 1 ? imageCall({ prompt: 'a blue fox', aspect_ratio: '4:3', use_latest_image: true }) : answer('Done.')),
    runSearch: async () => ({ sources: [] }),
    runImage: async (args) => { asked = args; return { id: 'a' }; },
  }));
  assert.equal(events.find((e) => e.type === 'image_start').aspectRatio, '4:3');
  assert.equal(asked.useReference, false);
});

const executor = ({ reference = null, watermark = false, sent, previewedFrom, makePreview, log = [] }) => createChatImageExecutor({
  db: {}, userId: 'u', turnId: 't', meter: fakeMeter(log),
  generate: async (payload) => { sent.payload = payload; return { data: [{ b64_json: PNG_B64 }] }; },
  resolveEntitlements: async () => ({ watermark }),
  watermark: async () => Buffer.from('watermarked-bytes'),
  store: async () => ({ id: 'a1', contentUrl: '/api/library/assets/a1/content' }),
  microPerCredit: 1,
  reference,
  makePreview: makePreview || (async (buffer) => { previewedFrom.buffer = buffer; return 'data:image/webp;base64,AAAA'; }),
});

test('the reference reaches the gateway only when asked for AND resolved', async () => {
  const ref = { dataUrl: `data:image/png;base64,${PNG_B64}`, aspectRatio: '16:9' };
  const sent = {};
  const previewedFrom = {};

  const edited = await executor({ reference: ref, sent, previewedFrom })({ prompt: 'bluer', aspectRatio: '16:9', quality: 'high', index: 0, useReference: true });
  assert.deepEqual(sent.payload.reference_images, [ref.dataUrl]);
  assert.equal(edited.edited, true);

  await executor({ reference: ref, sent, previewedFrom })({ prompt: 'new', aspectRatio: '1:1', quality: 'high', index: 0, useReference: false });
  assert.equal(sent.payload.reference_images, undefined, 'a fresh image never carries a reference');

  const unresolved = await executor({ reference: null, sent, previewedFrom })({ prompt: 'x', aspectRatio: '1:1', quality: 'high', index: 0, useReference: true });
  assert.equal(sent.payload.reference_images, undefined);
  assert.equal(unresolved.edited, false);
});

test('the preview is made from the DELIVERED bytes — a Free account never sees a clean image', async () => {
  const sent = {};
  const previewedFrom = {};
  const image = await executor({ watermark: true, sent, previewedFrom })({ prompt: 'x', aspectRatio: '1:1', quality: 'high', index: 0 });
  assert.equal(previewedFrom.buffer.toString(), 'watermarked-bytes');
  assert.equal(image.previewUrl, 'data:image/webp;base64,AAAA');
});

test('a preview failure costs the instant display, never the image or a second charge', async () => {
  const log = [];
  const image = await executor({ sent: {}, previewedFrom: {}, log, makePreview: async () => { throw new Error('libvips missing'); } })({ prompt: 'x', aspectRatio: '1:1', quality: 'high', index: 0 });
  assert.equal(image.id, 'a1');
  assert.equal(image.previewUrl, undefined);
  assert.deepEqual(log.map((l) => l[0]), ['hold', 'settle']);
});

test('makeImagePreview: a real WebP of the same picture, its longest side bounded', async () => {
  // sharp is the SERVER's dependency (src/server/package.json), resolved from there as the route does
  const sharp = createRequire(new URL('../src/server/package.json', import.meta.url))('sharp');
  // a real encoded picture (the header-only fixture above is enough for a parser, not for libvips)
  const wide = await sharp({ create: { width: 3584, height: 2048, channels: 3, background: { r: 40, g: 80, b: 160 } } }).png().toBuffer();
  const url = await makeImagePreview(wide);
  assert.match(url, /^data:image\/webp;base64,/);
  const bytes = Buffer.from(url.split(',')[1], 'base64');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.deepEqual(imageDimensions(bytes), { width: 1536, height: 878 }, 'same shape, longest side 1536 — and the header parser reads WebP');
  const small = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#000' } }).png().toBuffer();
  const smallDims = imageDimensions(Buffer.from((await makeImagePreview(small)).split(',')[1], 'base64'));
  assert.deepEqual(smallDims, { width: 640, height: 480 }, 'never enlarged');
});

test('the model is told when an image was an edit, and only then', () => {
  assert.equal(imageResultPayload({ prompt: 'p', aspectRatio: '1:1', model: 'm', edited: true }).edited_from, 'the latest image in the conversation');
  assert.equal(imageResultPayload({ prompt: 'p', aspectRatio: '1:1', model: 'm' }).edited_from, undefined);
});

test('the shape is stated in the PROMPT the image model reads — the gateway ignores aspect_ratio for these models', async () => {
  const { shapedPrompt } = await import('../src/server/utils/chatImageTool.js');
  assert.match(shapedPrompt('A lighthouse', '9:16'), /^Tall portrait image, 9:16 aspect ratio\. A lighthouse$/);
  assert.match(shapedPrompt('A road', '16:9'), /^Wide landscape image, 16:9/);
  assert.match(shapedPrompt('An icon', 'nonsense'), /^Square image, 1:1/, 'an unknown shape is square, never missing');
  const sent = {};
  await executor({ sent, previewedFrom: {} })({ prompt: 'A lighthouse', aspectRatio: '9:16', quality: 'high', index: 0 });
  assert.match(sent.payload.prompt, /^Tall portrait image, 9:16 aspect ratio\. A lighthouse$/, 'the executor sends the shaped prompt');
  assert.equal(sent.payload.aspect_ratio, '9:16', 'and still sends the parameter, for the day it is honoured');
});

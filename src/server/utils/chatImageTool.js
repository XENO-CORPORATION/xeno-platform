/**
 * `generate_image` — the chat's image tool: the model writes the prompt, the server makes the image.
 *
 * ## Why a TOOL, and not the keyword matcher it replaces
 *
 * Until 2026-09-26 the chat decided "is this an image request?" in the BROWSER, with regular
 * expressions run before any model saw the message. That had three consequences: the image
 * prompt was the user's raw words (a model only rewrote it for phrasings the regexes judged
 * vague), the chat model never knew an image existed, and nothing about the image was part of
 * the turn the model could talk about. ChatGPT's image generation — and OpenAI's own
 * `image_generation` tool — work the other way round: the mainline model decides to draw,
 * writes a revised prompt, and the image arrives as a step of the answer. This is that shape,
 * on our tool loop, beside `web_search`.
 *
 * ## The contract every other layer relies on
 *
 *   - The model supplies `prompt`, and may choose `aspect_ratio` and `quality`. Nothing else.
 *   - Generation goes through the XENO gateway (`/v1/images/generations`), never a vendor.
 *   - Billing is `meterMediaGeneration`: a hold for one image BEFORE the call, settled for what
 *     was produced, VOIDED on failure — so a failed image costs nothing, and a retried turn
 *     reuses its hold rather than charging twice.
 *   - The image is stored in the user's library BEFORE the turn reports it, so the saved message
 *     refers to a file that exists. A save failure is a failed generation (the hold is voided).
 *   - Free-plan output is watermarked, fail-closed: a watermark failure is a generation failure.
 *
 * Every function here is small and injected, so the tool loop and the tests exercise the SAME
 * rules the route runs.
 *
 * ## Editing, not only drawing
 *
 * "Make it blue", "same scene at night", "turn this photo into a watercolour" — ChatGPT's image
 * generation is iterative, and a tool that could only start from nothing would force the model to
 * re-describe the whole picture and get a different one. So the model may set `use_latest_image`,
 * and the server hands the gateway the conversation's most recent image as a reference
 * (`reference_images`): the one the user attached to THIS message if there is one, otherwise the
 * last image in the conversation. The server picks it — the model never supplies bytes or a URL —
 * and the picture keeps the reference's shape, which is announced before the wait like any other.
 *
 * ## Why the image travels twice
 *
 * A freshly stored library file is QUARANTINED until the ingestion worker has scanned it, and the
 * library refuses to serve it until then (423 / no signed link). That is correct and not bypassed
 * here. The turn therefore also carries a WebP preview of the same bytes, straight to the one
 * person who asked for it, so the image appears the moment it exists; the library copy is what a
 * reload, the viewer and every other surface read once the scan has passed.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getCreditCost } from './creditCosts.js';

/** The model the chat draws with. Sunburst is the quality tier; flare is the fast one. */
export const CHAT_IMAGE_MODEL = process.env.XENO_CHAT_IMAGE_MODEL || 'gpt-image-2.5-sunburst';

/**
 * The shapes the gateway accepts for the GPT image models (`resolveCodexDirectImageSize` in
 * xeno-api-proxy). `auto` is deliberately NOT offered to the model: the chat has to size its
 * placeholder before the image exists, and "auto" is the one answer that cannot be sized.
 */
export const CHAT_IMAGE_ASPECTS = Object.freeze(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']);
export const CHAT_IMAGE_QUALITIES = Object.freeze(['low', 'medium', 'high']);
export const CHAT_IMAGE_DEFAULT_ASPECT = '1:1';
export const CHAT_IMAGE_DEFAULT_QUALITY = 'high';

/** Images a single chat turn may generate. Each is a metered provider call. */
export const CHAT_IMAGE_BUDGET = 2;

/**
 * Credits per chat image, from the ONE price table (`creditCosts.js`) Image Studio reads too, so the
 * same model cannot cost two different amounts on two surfaces. 10 is what the chat already charged
 * (`gpt-image-2` fell through to the table's default) — the price does not change with this route.
 */
export const CHAT_IMAGE_CREDITS = getCreditCost('image', CHAT_IMAGE_MODEL);

/** Prompt length the gateway is sent. Long enough for a real brief; bounded so one call cannot carry a book. */
const MAX_PROMPT_CHARS = 4000;

/** What the gateway accepts as a reference: PNG, JPEG or WebP, at most 20 MB (`validateCodexReferenceImages`). */
const REFERENCE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

/** The longest side of the preview the turn carries. The models draw at most 2048 px; the chat shows ≤ 560. */
const PREVIEW_MAX_SIDE = 1536;

export const GENERATE_IMAGE_TOOL = Object.freeze({
  type: 'function',
  function: {
    name: 'generate_image',
    description:
      'Create an image and show it to the user in the chat. Use this whenever the user asks you to '
      + 'make, draw, generate, design or render an image, picture, illustration, photo, logo, poster, '
      + 'icon or artwork. Do not describe what you would draw instead of drawing it, and never claim '
      + 'to have made an image without calling this tool. Write `prompt` yourself as a full, concrete '
      + 'brief for an image model — subject, setting, composition and framing, lighting, style, colour '
      + 'palette, and anything that must or must not appear; spell out any lettering exactly. Expand a '
      + 'short request into a vivid one, but keep every detail the user asked for. Choose '
      + '`aspect_ratio` for the subject (16:9 for landscapes and wide scenes, 9:16 for phone '
      + 'wallpapers and tall subjects, 1:1 for icons, avatars and logos) unless the user named one. '
      + 'When the user wants to change, restyle or continue an image already in the conversation — '
      + 'one you made, or one they attached ("make it blue", "same but at night", "turn this photo '
      + 'into a watercolour") — set `use_latest_image` to true and write `prompt` as the change '
      + 'plus what must stay the same; the new image keeps that image\'s shape. For a new, unrelated '
      + 'image leave it false. After the image is made, reply briefly — one or two sentences about '
      + 'what you made; do not repeat the prompt.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The complete brief for the image model, in English, written by you.',
        },
        aspect_ratio: {
          type: 'string',
          enum: [...CHAT_IMAGE_ASPECTS],
          description: 'Width to height. Defaults to 1:1.',
        },
        quality: {
          type: 'string',
          enum: [...CHAT_IMAGE_QUALITIES],
          description: 'Rendering quality. Defaults to high; use low only when the user asks for a quick draft.',
        },
        use_latest_image: {
          type: 'boolean',
          description: 'True to edit or build on the most recent image in the conversation (the user\'s attachment in this message if any, otherwise the last image shown). Defaults to false.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
});

/**
 * Parse one generate_image call. A malformed call becomes a tool RESULT the model can read and
 * correct — the same rule as web_search — never a thrown turn.
 */
export function parseImageArguments(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'empty arguments' };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, error: 'arguments were not valid JSON' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'arguments must be an object' };
  const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
  if (!prompt) return { ok: false, error: 'prompt is required and must be a non-empty string' };
  // An aspect or quality outside the allowed set falls back to the default rather than failing:
  // the model meant "an image", and a wrong shape is not worth a lost turn.
  const aspectRatio = CHAT_IMAGE_ASPECTS.includes(parsed.aspect_ratio) ? parsed.aspect_ratio : CHAT_IMAGE_DEFAULT_ASPECT;
  const quality = CHAT_IMAGE_QUALITIES.includes(parsed.quality) ? parsed.quality : CHAT_IMAGE_DEFAULT_QUALITY;
  return { ok: true, prompt: prompt.slice(0, MAX_PROMPT_CHARS), aspectRatio, quality, useLatestImage: parsed.use_latest_image === true };
}

/**
 * The shape, stated in the words the image model reads.
 *
 * 🔴 Measured 2026-09-26 against the live gateway: for the GPT image models, `aspect_ratio` and
 * `size` are NOT honoured — every one of 1:1, 9:16, 4:3, 3:4, 3:2, 2:3 and seven pixel sizes came
 * back 1536x1024, and the gateway's own `size` field reported 1536x1024 even for a picture that was
 * 1254x1254. The shape is decided by the PROMPT: "Wide landscape image, 16:9" produced 1672x941,
 * "Tall portrait image, 9:16" 941x1672, "Square image" 1254x1254. So the shape is stated here, in
 * front of the model's brief, and the parameters are still sent for the day the gateway honours them.
 * Without this the placeholder the chat drew at 9:16 would be filled by a 3:2 picture.
 *
 * The size is stated too, and it is the size the model ACTUALLY draws at that ratio — measured the
 * same day, ratio + size for all seven, every one exact (1254x1254, 1672x941, 941x1672, 1448x1086,
 * 1086x1448, 1536x1024, 1024x1536). A size it does not draw is a size it ignores: asking for
 * 1792x1024 alongside "16:9" was the only combination that came back off-shape (1659x948).
 */
export const CHAT_IMAGE_SIZES = Object.freeze({
  '1:1': [1254, 1254],
  '16:9': [1672, 941],
  '9:16': [941, 1672],
  '4:3': [1448, 1086],
  '3:4': [1086, 1448],
  '3:2': [1536, 1024],
  '2:3': [1024, 1536],
});
const SHAPE_WORDS = Object.freeze({
  '1:1': 'Square image, 1:1 aspect ratio',
  '16:9': 'Wide landscape image, 16:9 aspect ratio',
  '9:16': 'Tall portrait image, 9:16 aspect ratio',
  '4:3': 'Landscape image, 4:3 aspect ratio',
  '3:4': 'Portrait image, 3:4 aspect ratio',
  '3:2': 'Landscape image, 3:2 aspect ratio',
  '2:3': 'Portrait image, 2:3 aspect ratio',
});
const SHAPE_PHRASES = Object.freeze(Object.fromEntries(Object.entries(SHAPE_WORDS).map(
  ([ratio, words]) => [ratio, `${words}, ${CHAT_IMAGE_SIZES[ratio][0]}x${CHAT_IMAGE_SIZES[ratio][1]} pixels.`],
)));

export const shapedPrompt = (prompt, aspectRatio) =>
  `${SHAPE_PHRASES[aspectRatio] || SHAPE_PHRASES[CHAT_IMAGE_DEFAULT_ASPECT]} ${prompt}`;

/** What the model is told after it drew — enough to talk about the image, never the bytes. */
export const imageResultPayload = ({ prompt, aspectRatio, model, edited = false }) => ({
  status: 'generated',
  shown_to_user: true,
  aspect_ratio: aspectRatio,
  model,
  prompt,
  ...(edited ? { edited_from: 'the latest image in the conversation' } : {}),
  instruction: 'The image is already displayed to the user above your reply. Do not paste a link or markdown image, and do not repeat the prompt.',
});

/**
 * The supported ratio closest to a picture's real shape (compared on a log scale, so 2:1 is as far
 * from 1:1 as 1:2 is). An edit keeps its reference's shape, and the placeholder has to be sized to
 * one of the ratios the chat can draw before the image exists.
 */
export function nearestAspect(width, height) {
  if (!(width > 0) || !(height > 0)) return CHAT_IMAGE_DEFAULT_ASPECT;
  const target = Math.log(width / height);
  let best = CHAT_IMAGE_DEFAULT_ASPECT;
  let bestDistance = Infinity;
  for (const aspect of CHAT_IMAGE_ASPECTS) {
    const [w, h] = aspect.split(':').map(Number);
    const distance = Math.abs(Math.log(w / h) - target);
    if (distance < bestDistance) { best = aspect; bestDistance = distance; }
  }
  return best;
}

/**
 * The image an edit starts from: the newest image part in the conversation, read from the client's
 * `{ role, parts[] }` messages BEFORE they are converted for the provider (conversion drops an
 * assistant's images). The current user message wins — "turn this into a watercolour" means the
 * picture attached to it — and otherwise the walk goes back through every turn, the user's and the
 * assistant's alike.
 *
 * Anything the gateway would refuse is skipped rather than sent: an unsupported type, an oversized
 * file, or bytes that are not an image at all. `null` when the conversation holds no usable image —
 * the model then gets a fresh generation, which is what it would have had without the flag.
 *
 * @returns {{ dataUrl: string, mediaType: string, width?: number, height?: number, aspectRatio: string } | null}
 */
export function latestConversationImage(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const parts = Array.isArray(list[i]?.parts) ? list[i].parts : [];
    for (let p = parts.length - 1; p >= 0; p -= 1) {
      const part = parts[p];
      if (part?.type !== 'image' || typeof part.data !== 'string' || !part.data) continue;
      const mediaType = String(part.media_type || '').toLowerCase();
      if (!REFERENCE_MEDIA_TYPES.has(mediaType)) continue;
      const data = part.data.replace(/^data:[^,]*,/, '');
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data)) continue;
      const buffer = Buffer.from(data, 'base64');
      if (buffer.length === 0 || buffer.length > MAX_REFERENCE_BYTES) continue;
      const dims = imageDimensions(buffer);
      if (!dims) continue; // not a picture we can read — never forward bytes we cannot identify
      return {
        dataUrl: `data:${mediaType === 'image/jpg' ? 'image/jpeg' : mediaType};base64,${data.replace(/[\r\n]/g, '')}`,
        mediaType,
        width: dims.width,
        height: dims.height,
        aspectRatio: nearestAspect(dims.width, dims.height),
      };
    }
  }
  return null;
}

/**
 * The preview the turn carries while the library copy is in quarantine: WebP, longest side ≤ 1536 px.
 * sharp is imported lazily so loading this module (and its tests) never loads libvips.
 */
export async function makeImagePreview(buffer) {
  const { default: sharp } = await import('sharp');
  const webp = await sharp(buffer)
    .resize({ width: PREVIEW_MAX_SIDE, height: PREVIEW_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();
  return `data:image/webp;base64,${webp.toString('base64')}`;
}

export const imageBudgetExhaustedPayload = (images) => ({
  error: 'image budget exhausted for this turn',
  imagesUsed: images,
  instruction: 'Do not call generate_image again this turn. Tell the user what you made, and offer to make another in their next message.',
});

/** Base64 out of a gateway image item: `{ b64_json }`, `{ url: 'data:…' }`. Hosted URLs are not fetched. */
/**
 * The image call's own token usage, as the gateway reports it — `{ input_tokens, output_tokens,
 * total_tokens }` (measured 2026-09-26: a 1:1 low-quality image was 24 in / 515 out). Absent or
 * malformed usage is `null`: shown as nothing, never as a guessed number.
 */
export function imageUsageFrom(response) {
  const usage = response?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  if (input === null && output === null) return null;
  return { input: input ?? 0, output: output ?? 0, total: count(usage.total_tokens) ?? (input ?? 0) + (output ?? 0) };
}

export function base64FromImageItem(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.b64_json === 'string' && item.b64_json) return item.b64_json;
  if (typeof item.url === 'string' && item.url.startsWith('data:image/')) return item.url.split(',')[1] || null;
  return null;
}

/** Pixel size of a PNG, JPEG or WebP from its header — the stored record carries real dimensions. */
export function imageDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) === 0x89504e47) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buffer.length) {
      if (buffer[i] !== 0xff) { i += 1; continue; }
      const marker = buffer[i + 1];
      const length = buffer.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buffer.readUInt16BE(i + 7), height: buffer.readUInt16BE(i + 5) };
      }
      i += 2 + length;
    }
  }
  return null;
}

/**
 * Build the executor the tool loop calls. Everything with a side effect is injected so the test
 * suite runs the real sequencing — meter, generate, watermark, store — against fakes.
 *
 * @param {object} deps
 * @param {object} deps.db                pg pool
 * @param {string} deps.userId
 * @param {string} deps.turnId            the turn's request seed; with the image index it keys the hold
 * @param {function} deps.meter           meterMediaGeneration(db, userId, opts)
 * @param {function} deps.generate        (payload) => gateway response `{ data: [...] }`
 * @param {function} deps.resolveEntitlements (db, userId) => { watermark?: boolean }
 * @param {function} deps.watermark       (buffer) => buffer
 * @param {function} deps.store           ({ buffer, prompt, model, aspectRatio }) => { id, contentUrl }
 * @param {object|null} [deps.reference]  latestConversationImage(...) for this turn — what an edit starts from
 * @param {function} [deps.makePreview]   (buffer) => data URL shown while the library copy is scanned
 * @returns {function} ({ prompt, aspectRatio, quality, index, useReference }) => stored image record
 */
export function createChatImageExecutor({ db, userId, turnId, meter, generate, resolveEntitlements, watermark, store, model = CHAT_IMAGE_MODEL, microPerCredit, reference = null, makePreview = null }) {
  return async ({ prompt, aspectRatio, quality, index, useReference = false }) => {
    const entitlement = await resolveEntitlements(db, userId).catch(() => null);
    // an edit only ever uses the reference the SERVER resolved; asking without one is a fresh image
    const edited = Boolean(useReference && reference?.dataUrl);
    let stored = null;
    let delivered = null;
    let usage = null;
    const metered = await meter(db, userId, {
      surface: 'chat',
      operation: 'image-generation',
      model,
      provider: 'xeno',
      // Deterministic per image of the turn: a retried turn reuses its hold (and is refused as a
      // duplicate rather than drawing twice), two images of one turn get two holds.
      requestId: `${turnId}:image:${index}`,
      unitCostMicro: CHAT_IMAGE_CREDITS * microPerCredit,
      count: 1,
      run: async () => {
        const response = await generate({
          model,
          // the shape in words is what the model obeys; the parameters below are kept for the gateway
          prompt: shapedPrompt(prompt, aspectRatio),
          n: 1,
          aspect_ratio: aspectRatio,
          quality,
          output_format: 'png',
          response_format: 'b64_json',
          ...(edited ? { reference_images: [reference.dataUrl] } : {}),
        });
        usage = imageUsageFrom(response);
        const b64 = base64FromImageItem(response?.data?.[0]);
        if (!b64) throw Object.assign(new Error('The image service returned no image.'), { code: 'image_empty' });
        let buffer = Buffer.from(b64, 'base64');
        // Free output is watermarked FAIL-CLOSED: a clean image must never reach a Free account.
        if (entitlement?.watermark) buffer = await watermark(buffer);
        // Stored INSIDE the metered run: a save failure voids the hold like any other failure,
        // so the user is never charged for an image they cannot see again.
        stored = await store({ buffer, prompt, model, aspectRatio });
        delivered = buffer;
        return { data: [stored] };
      },
    });
    // The preview is made from the DELIVERED bytes — after the watermark — so it can never show a
    // Free account a clean image. A preview failure costs nothing but the instant display: the
    // image is stored and billed, and the chat reads it from the library once it is scanned.
    let previewUrl;
    if (makePreview && delivered) {
      previewUrl = await makePreview(delivered).catch(() => undefined);
    }
    return {
      ...stored,
      prompt,
      aspectRatio,
      quality,
      model,
      edited,
      ...(usage ? { usage } : {}),
      ...(previewUrl ? { previewUrl } : {}),
      creditsCharged: metered.creditsCharged,
    };
  };
}

/**
 * Store a generated image in the account library. Same location and registration as the chat's
 * existing image path (`/api/chat/generate`, task `image`), so the library, its content route and
 * its access checks already know the file.
 */
export async function storeChatImage({ db, userId, uploadsDir, register, buffer, prompt, model, aspectRatio }) {
  const storedName = `${randomUUID()}-xeno-generated.png`;
  const storagePath = path.join(uploadsDir, storedName);
  await fs.promises.mkdir(uploadsDir, { recursive: true });
  await fs.promises.writeFile(storagePath, buffer);
  try {
    const dims = imageDimensions(buffer);
    const record = await register(db, {
      userId,
      filename: storedName,
      originalName: `XENO image ${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
      mimeType: 'image/png',
      fileSize: buffer.length,
      storagePath,
      metadata: { source: 'chat-generation', prompt, model, aspectRatio, ...(dims || {}) },
    });
    return {
      id: record.id,
      contentUrl: `/api/library/assets/${record.id}/content`,
      mimeType: 'image/png',
      ...(dims || {}),
    };
  } catch (error) {
    await fs.promises.unlink(storagePath).catch(() => {});
    throw error;
  }
}

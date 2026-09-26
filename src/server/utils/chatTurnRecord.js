/**
 * The turn record a client may store beside an assistant message — validated and BOUNDED.
 *
 * `chat_messages.turn` is presentational: the sequence of steps the person watched (searches,
 * their queries and result counts, the clock). It is not evidence — what was read and when
 * stays in the server-owned `search_context` receipt — so the client is allowed to write it,
 * and precisely because the client writes it, every field is checked and every list capped.
 * An invalid record is refused (400 `invalid_turn`), never silently trimmed into something
 * that looks stored.
 */

export const TURN_SCHEMA = 'xeno.chat.turn.v1';
export const TURN_LIMITS = Object.freeze({
  steps: 64,
  sourcesPerStep: 24,
  text: 512,
  url: 2048,
});

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const shortString = (value, max) => typeof value === 'string' && value.length <= max;
/** The aspect ratios the chat's generate_image tool can produce (chatImageTool.js). */
const IMAGE_ASPECTS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']);
/** An image step points at a library asset by id; nothing else may ride in the record. */
const LIBRARY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An `image` step: the chat's generate_image tool drew something (2026-09-26). It records the
 * prompt the MODEL wrote, the shape, and which library asset holds the file — never the bytes,
 * and never a URL the client could point anywhere: the content URL is rebuilt from the asset id.
 */
function normalizeImageStep(raw) {
  if (!shortString(raw.prompt, 4000)) return { ok: false, error: 'image step.prompt must be a string of at most 4000 characters' };
  if (!IMAGE_ASPECTS.has(raw.aspectRatio)) return { ok: false, error: 'image step.aspectRatio must be one of the supported ratios' };
  if (!isFiniteNumber(raw.startedAt) || raw.startedAt <= 0) return { ok: false, error: 'step.startedAt must be a timestamp' };
  if (raw.endedAt !== undefined && (!isFiniteNumber(raw.endedAt) || raw.endedAt < raw.startedAt)) {
    return { ok: false, error: 'step.endedAt must be a timestamp at or after its startedAt' };
  }
  if (raw.assetId !== undefined && (typeof raw.assetId !== 'string' || !LIBRARY_ID.test(raw.assetId))) {
    return { ok: false, error: 'image step.assetId must be a library asset id' };
  }
  if (raw.error !== undefined && !shortString(raw.error, TURN_LIMITS.text)) return { ok: false, error: 'step.error must be a short string' };
  for (const key of ['width', 'height']) {
    if (raw[key] !== undefined && (!Number.isInteger(raw[key]) || raw[key] <= 0 || raw[key] > 16384)) {
      return { ok: false, error: `image step.${key} must be a positive integer` };
    }
  }
  return {
    ok: true,
    step: {
      id: raw.id,
      kind: 'image',
      prompt: raw.prompt,
      aspectRatio: raw.aspectRatio,
      startedAt: raw.startedAt,
      ...(raw.endedAt !== undefined ? { endedAt: raw.endedAt } : {}),
      ...(raw.assetId !== undefined ? { assetId: raw.assetId } : {}),
      ...(raw.width !== undefined ? { width: raw.width, height: raw.height } : {}),
      ...(raw.error !== undefined ? { error: raw.error } : {}),
    },
  };
}

/**
 * @returns {{ ok: true, turn: object } | { ok: false, error: string }}
 */
export function normalizeTurnRecord(value) {
  if (value === undefined || value === null) return { ok: true, turn: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'turn must be an object' };
  if (value.schema !== TURN_SCHEMA) return { ok: false, error: `turn.schema must be ${TURN_SCHEMA}` };
  if (!isFiniteNumber(value.startedAt) || value.startedAt <= 0) return { ok: false, error: 'turn.startedAt must be a timestamp' };
  if (value.endedAt !== undefined && (!isFiniteNumber(value.endedAt) || value.endedAt < value.startedAt)) {
    return { ok: false, error: 'turn.endedAt must be a timestamp at or after startedAt' };
  }
  if (value.thinkingMs !== undefined && (!isFiniteNumber(value.thinkingMs) || value.thinkingMs < 0)) {
    return { ok: false, error: 'turn.thinkingMs must be a non-negative number' };
  }
  if (!Array.isArray(value.steps)) return { ok: false, error: 'turn.steps must be an array' };
  if (value.steps.length > TURN_LIMITS.steps) return { ok: false, error: `turn.steps may hold at most ${TURN_LIMITS.steps} steps` };

  const steps = [];
  const ids = new Set();
  for (const raw of value.steps) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'each step must be an object' };
    if (!shortString(raw.id, 128) || !raw.id || ids.has(raw.id)) return { ok: false, error: 'each step needs a unique id' };
    ids.add(raw.id);
    if (raw.kind === 'image') {
      const image = normalizeImageStep(raw);
      if (!image.ok) return image;
      steps.push(image.step);
      continue;
    }
    if (raw.kind !== 'search') return { ok: false, error: `unknown step kind: ${String(raw.kind).slice(0, 32)}` };
    if (!shortString(raw.query, TURN_LIMITS.text)) return { ok: false, error: 'step.query must be a short string' };
    if (!isFiniteNumber(raw.startedAt) || raw.startedAt <= 0) return { ok: false, error: 'step.startedAt must be a timestamp' };
    if (raw.endedAt !== undefined && (!isFiniteNumber(raw.endedAt) || raw.endedAt < raw.startedAt)) {
      return { ok: false, error: 'step.endedAt must be a timestamp at or after its startedAt' };
    }
    if (raw.count !== undefined && (!Number.isInteger(raw.count) || raw.count < 0)) return { ok: false, error: 'step.count must be a non-negative integer' };
    if (raw.error !== undefined && !shortString(raw.error, TURN_LIMITS.text)) return { ok: false, error: 'step.error must be a short string' };
    const sources = [];
    if (raw.sources !== undefined) {
      if (!Array.isArray(raw.sources) || raw.sources.length > TURN_LIMITS.sourcesPerStep) {
        return { ok: false, error: `step.sources may hold at most ${TURN_LIMITS.sourcesPerStep} sources` };
      }
      for (const source of raw.sources) {
        if (!source || typeof source !== 'object') return { ok: false, error: 'each source must be an object' };
        if (!shortString(source.url, TURN_LIMITS.url) || !/^https:\/\//.test(source.url)) return { ok: false, error: 'each source needs an https url' };
        if (source.title !== undefined && !shortString(source.title, TURN_LIMITS.text)) return { ok: false, error: 'source.title must be a short string' };
        sources.push({ url: source.url, ...(source.title ? { title: source.title } : {}) });
      }
    }
    steps.push({
      id: raw.id,
      kind: 'search',
      query: raw.query,
      startedAt: raw.startedAt,
      ...(raw.endedAt !== undefined ? { endedAt: raw.endedAt } : {}),
      ...(raw.count !== undefined ? { count: raw.count } : {}),
      ...(raw.error !== undefined ? { error: raw.error } : {}),
      ...(sources.length ? { sources } : {}),
    });
  }

  return {
    ok: true,
    turn: {
      schema: TURN_SCHEMA,
      startedAt: value.startedAt,
      ...(value.endedAt !== undefined ? { endedAt: value.endedAt } : {}),
      ...(value.thinkingMs !== undefined ? { thinkingMs: value.thinkingMs } : {}),
      steps,
    },
  };
}

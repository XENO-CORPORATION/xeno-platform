import { randomUUID } from 'node:crypto';
/**
 * xenoChat — the ONE server-side door to the XENO API for chat + the model catalog.
 *
 * The platform holds NO provider keys; all inference proxies to the private API
 * (api.xenostudio.ai) with XENO_API_KEY. The XENO API uses BARE model ids
 * ('gemini-3-flash', 'gpt-5.4', ...), so ids are normalized here — any legacy
 * 'company/model' (OpenRouter-style) prefix is stripped before the call.
 */
import { apiOrigin } from '../config/hosts.js';

export const XENO_API_BASE = (process.env.XENO_API_BASE_URL || `${apiOrigin()}/v1`).replace(/\/+$/, '');
export const XENO_API_KEY = process.env.XENO_API_KEY || '';

/** Normalize a model id to the XENO API's bare namespace (strip a leading 'company/'). */
export function normalizeXenoModelId(model) {
  if (!model || typeof model !== 'string') return model;
  return model.includes('/') ? model.split('/').slice(1).join('/') : model;
}

/** True when the XENO API key is configured (premium inference available). */
export function xenoApiConfigured() {
  return !!XENO_API_KEY;
}

/**
 * Call the XENO API's OpenAI-compatible /v1/chat/completions.
 * Returns the raw OpenAI-shaped JSON ({ choices:[{message:{content}}], usage, model }).
 * Throws Error with .http=503 if the key is unset, or a provider Error on non-2xx.
 */
/**
 * Turn a failed gateway call into what the CUSTOMER should see.
 *
 * Found by dogfooding 2026-09-17: a request for a model that does not exist came
 * back from the gateway as a clean `404 model_not_found` with a sentence, and the
 * platform answered `500 "AI generation failed"` — telling the user the platform
 * broke when they had mistyped a model id. A caller cannot fix what it is not told.
 *
 * The rule (OpenAI / Anthropic do the same): the caller's OWN mistake keeps its
 * status and the provider's sentence — 400 / 404 / 413 / 422 / 429. Our platform
 * credential being refused (401 / 403) is OUR fault and is reported as 503 with no
 * provider detail; a provider 5xx is a 502. Anything else stays a 500. Never the
 * raw body: it can carry provider internals, and a message is enough.
 */
/**
 * The finish reasons a provider uses when it REFUSES to answer rather than failing. The stream
 * closes normally with an empty body, so this is the only signal that a blank turn is a decline
 * and not a bug. `content_filter` is the OpenAI-shaped value; some resellers send `refusal`.
 */
export const DECLINED_FINISH_REASONS = new Set(['content_filter', 'refusal']);

/**
 * Did the model DECLINE — end a call on a refusal finish reason having produced nothing? A turn
 * with any answer text or any generated image is a real answer and is never a decline, even if a
 * later fragment carried a filter flag. Pure so it can be tested against the exact cases that
 * reach it, rather than asserting a regex over the route (mechanism, not outcome).
 */
export function isContentDeclined(finishReason, { hasText, hasImage } = {}) {
  if (hasText || hasImage) return false;
  return DECLINED_FINISH_REASONS.has(finishReason);
}

export function classifyUpstreamError(error) {
  const status = Number(error?.status);
  if (!Number.isInteger(status)) return null;
  let upstream = null;
  const m = typeof error?.message === 'string' ? error.message.match(/^XENO API error: \d+ - ([\s\S]*)$/) : null;
  if (m) { try { upstream = JSON.parse(m[1]); } catch { upstream = null; } }
  const detail = upstream?.error && typeof upstream.error === 'object' ? upstream.error : null;
  const message = typeof detail?.message === 'string' && detail.message.length <= 400 ? detail.message : null;
  const code = typeof detail?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(detail.code) ? detail.code : null;

  if ([400, 404, 413, 422].includes(status)) {
    return { status, body: { error: code || 'invalid_request', message: message || 'The inference request was rejected.' } };
  }
  if (status === 429) {
    return { status: 429, body: { error: 'rate_limited', message: message || 'The inference service is rate-limiting requests. Try again shortly.' } };
  }
  if (status === 401 || status === 403) {
    return { status: 503, body: { error: 'inference_unavailable', message: 'The inference service refused the platform credential. This is on us, not you.' } };
  }
  if (status >= 500) {
    return { status: 502, body: { error: 'upstream_error', message: 'The inference provider returned an error. Try again.' } };
  }
  return null;
}

export async function xenoChatCompletion({ model, messages, temperature, max_tokens, stream = false, extra = {}, headers = {} }) {
  if (!XENO_API_KEY) { const e = new Error('XENO_API_KEY not configured'); e.http = 503; throw e; }
  const response = await fetch(`${XENO_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${XENO_API_KEY}`, ...headers },
    body: JSON.stringify({ model: normalizeXenoModelId(model), messages, temperature, max_tokens, stream, ...extra }),
  });
  if (!response.ok) {
    const text = await response.text();
    const e = new Error(`XENO API error: ${response.status} - ${text}`);
    e.status = response.status;
    throw e;
  }
  return response.json();
}

/**
 * Streaming variant of the chat completion. Opens the upstream OpenAI-compatible
 * SSE stream and returns the raw fetch `Response` WITHOUT awaiting/consuming the
 * body — the caller reads `response.body` (a web ReadableStream) and relays the
 * chunks. Forces `stream:true` and `stream_options:{ include_usage:true }` so the
 * final upstream chunk carries token usage (needed to settle the credit hold).
 * Throws Error with .http=503 if the key is unset, or .status=<code> on non-2xx.
 */
export async function xenoChatCompletionStream({ model, messages, temperature, max_tokens, signal, extra = {}, headers = {} }) {
  if (!XENO_API_KEY) { const e = new Error('XENO_API_KEY not configured'); e.http = 503; throw e; }
  const response = await fetch(`${XENO_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${XENO_API_KEY}`,
      // per-call headers (an own-key grant, the surface); never able to replace the three above
      ...Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(authorization|content-type|accept)$/i.test(k))),
    },
    body: JSON.stringify({
      model: normalizeXenoModelId(model),
      messages,
      temperature,
      max_tokens,
      stream: true,
      stream_options: { include_usage: true },
      ...extra,
    }),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const e = new Error(`XENO API error: ${response.status} - ${text}`);
    e.status = response.status;
    throw e;
  }
  return response;
}

/**
 * One image from the gateway's `/v1/images/generations`, for the chat's `generate_image` tool.
 *
 * A direct call rather than the `xeno-ai` SDK the older routes use: the SDK aborts every request
 * at 60 s, and the GPT image models routinely take 20-60 s and can take longer, so the SDK would
 * void a generation the gateway was about to deliver — and the gateway would still bill it. The
 * deadline here is the gateway's own (its image timeout is 900 s), shortened to what a chat turn
 * can sensibly wait, and the caller's signal cancels it when the client leaves.
 */
export const CHAT_IMAGE_TIMEOUT_MS = 240_000;

export async function xenoImageGeneration(payload, { signal, timeoutMs = CHAT_IMAGE_TIMEOUT_MS, pollMs = 3000 } = {}) {
  if (!XENO_API_KEY) { const e = new Error('XENO_API_KEY not configured'); e.http = 503; throw e; }
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const auth = { Authorization: `Bearer ${XENO_API_KEY}` };
  const call = async (url, init = {}) => {
    try {
      return await fetch(url, { ...init, headers: { ...auth, ...(init.headers || {}) }, signal: combined });
    } catch (error) {
      if (deadline.aborted) { const e = new Error('The image took too long to generate.'); e.code = 'image_timeout'; throw e; }
      throw error;
    }
  };
  const fail = (status, text) => {
    // The provider's body stays server-side: it can carry vendor detail the user is not shown.
    const declined = status === 400 && /moderation|safety|content_policy/i.test(text);
    // The Codex-backed GPT image models answer 429 with this code when every login in the pool
    // has used its image allowance; callers fall back to another model instead of failing.
    const quota = status === 429 && /image_(generation_)?quota_exceeded/.test(text);
    const e = new Error(declined ? 'The image was declined by the content filter.'
      : quota ? 'The image model has used its generation quota for now.'
        : 'The image service returned an error.');
    e.status = status;
    e.code = declined ? 'image_declined' : quota ? 'image_quota' : 'image_upstream';
    e.detail = String(text).slice(0, 500);
    return e;
  };
  const body = JSON.stringify(payload);
  let response = await call(`${XENO_API_BASE}/images/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (response.ok) return response.json();
  const text = await response.text().catch(() => '');
  // Some models (Google's) only run as durable gateway jobs: submit with async + an idempotency
  // key, poll the job, then read its result.
  if (!(response.status === 400 && /async_execution_required/.test(text))) throw fail(response.status, text);
  response = await call(`${XENO_API_BASE}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ ...payload, async: true }),
  });
  if (!response.ok) throw fail(response.status, await response.text().catch(() => ''));
  let job = await response.json();
  const base = XENO_API_BASE.replace(/\/v1\/?$/, '');
  const jobUrl = job?.links?.self ? `${base}${job.links.self}` : `${XENO_API_BASE}/jobs/${encodeURIComponent(job.id)}`;
  while (!['succeeded', 'failed', 'cancelled', 'canceled', 'expired'].includes(job?.status)) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, pollMs);
      combined.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error(deadline.aborted ? 'The image took too long to generate.' : 'aborted'), { code: deadline.aborted ? 'image_timeout' : 'aborted' })); }, { once: true });
    });
    const poll = await call(jobUrl);
    if (!poll.ok) throw fail(poll.status, await poll.text().catch(() => ''));
    job = await poll.json();
  }
  if (job.status !== 'succeeded') throw fail(502, JSON.stringify(job.error || job.status));
  const resultRes = await call(job?.links?.result ? `${base}${job.links.result}` : `${jobUrl}/result`);
  if (!resultRes.ok) throw fail(resultRes.status, await resultRes.text().catch(() => ''));
  const result = await resultRes.json();
  // Normalise URL items to b64_json so every caller reads one shape.
  for (const item of result?.data || []) {
    if (!item.b64_json && item.url) {
      // A provider CDN URL: never send our gateway key to it.
      let img;
      try { img = await fetch(item.url, { signal: combined }); } catch (error) {
        if (deadline.aborted) throw Object.assign(new Error('The image took too long to generate.'), { code: 'image_timeout' });
        throw error;
      }
      if (!img.ok) throw fail(img.status, 'image download failed');
      item.b64_json = Buffer.from(await img.arrayBuffer()).toString('base64');
    }
  }
  return result;
}

/**
 * Fetch the XENO API model catalog and group it into the platform's UI shape
 * ({ success, companies: { CompanyName: Model[] } }). Groups by `owned_by`.
 */
export async function xenoModelCatalog() {
  if (!XENO_API_KEY) { const e = new Error('XENO_API_KEY not configured'); e.http = 503; throw e; }
  const response = await fetch(`${XENO_API_BASE}/models`, {
    headers: { Authorization: `Bearer ${XENO_API_KEY}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`XENO API models error: ${response.status}`);
  const data = await response.json();
  return data.data || [];
}

/** Prettify a bare model id for display ('gemini-3-flash' → 'Gemini 3 Flash'). */
export function prettyModelName(id = '') {
  return String(id)
    .split('/').pop()
    .split(/[-_]/)
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// Display names for the XENO API's `owned_by` provider slugs.
export const PROVIDER_LABELS = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', meta: 'Meta',
  mistral: 'Mistral', deepseek: 'DeepSeek', qwen: 'Alibaba', xai: 'xAI',
  moonshot: 'Moonshot', nvidia: 'NVIDIA', byteplus: 'BytePlus', zai: 'Z.AI',
  stockmark: 'Stockmark', xeno: 'XENO',
};

/**
 * billableInput — the customer pays for the tokens THEY sent, never for ours.
 *
 * Dogfooding 2026-09-17 (F14): a six-word prompt through api.xenostudio.ai came
 * back with `prompt_tokens: 642` — 512–640 of them cached. The route the gateway
 * took carries a ~630-token harness prompt the caller never wrote, and the meter
 * priced every one of them to the customer. OpenAI, Anthropic and OpenRouter bill
 * exactly the tokens in the request; an operator's own overhead is the operator's
 * cost. The provider's cache discount on that prefix makes it nearly free to us.
 *
 * The rule: billable input = min(what the provider reported, what the caller sent
 * × a tokenizer-variance margin + a small constant). "What the caller sent" is a
 * real tokenizer count (tiktoken cl100k), scaled by the provider's known ratio to
 * tiktoken (Claude ~+12%, Gemini ~+5%), with 30% headroom on top so a legitimately
 * longer provider count is never under-billed — only a count that could not have
 * come from the request is capped. Output tokens are untouched: reasoning tokens
 * are real compute and every lab bills them.
 *
 * Everything here is pure and synchronous so the two in-process meters and the
 * service-ledger settle all apply one rule.
 */
import { get_encoding } from 'tiktoken';

let encoder = null;
function enc() {
  // dqbd/tiktoken#35: each get_encoding() allocates a WASM instance; cache one.
  if (!encoder) encoder = get_encoding('cl100k_base');
  return encoder;
}

/** Provider tokenizer ÷ tiktoken, measured (routes/tokenizerRoutes.js keeps the same table). */
const PROVIDER_RATIO = {
  anthropic: 1.12, google: 1.05, deepseek: 1.02, openai: 1.0, meta: 1.03,
  mistral: 1.02, qwen: 1.05, xai: 1.03, 'x-ai': 1.03, byteplus: 1.05, xeno: 1.05,
};
const HEADROOM = 1.3;
const CONSTANT = 32;
/** Above this many chars a request is counted by chars/4 — WASM tokenizing a 1 MB prompt in the money path is not worth a few percent. */
const MAX_TOKENIZE_CHARS = 200_000;

/** Tokens in the caller's request, as the caller sent it. Images count as 1200 each (vision prompts really cost that). */
export function callerInputTokens(messages = []) {
  let text = '';
  let images = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (typeof m?.content === 'string') text += `${m.content}\n`;
    else if (Array.isArray(m?.content)) {
      for (const part of m.content) {
        if (part?.type === 'image_url') images += 1;
        else if (typeof part?.text === 'string') text += `${part.text}\n`;
      }
    }
    if (typeof m?.name === 'string') text += `${m.name}\n`;
    if (Array.isArray(m?.tool_calls)) text += `${JSON.stringify(m.tool_calls)}\n`;
  }
  const perMessage = (Array.isArray(messages) ? messages.length : 0) * 4;
  if (text.length > MAX_TOKENIZE_CHARS) return Math.ceil(text.length / 4) + perMessage + images * 1200;
  let count = 0;
  try { count = enc().encode(text).length; } catch { count = Math.ceil(text.length / 4); }
  return count + perMessage + images * 1200;
}

/**
 * The input tokens the customer is billed for.
 * @param reported   prompt_tokens as the provider reported them
 * @param caller     tokens the caller actually sent (callerInputTokens), or null when unknown
 * @param provider   the serving provider slug, for the tokenizer ratio
 */
export function billableInputTokens(reported, caller, provider = 'default') {
  const r = Number.isFinite(Number(reported)) ? Math.max(0, Math.floor(Number(reported))) : 0;
  if (caller == null || !Number.isFinite(Number(caller))) return r;
  const ratio = PROVIDER_RATIO[String(provider || '').toLowerCase()] || 1.05;
  const cap = Math.ceil(Math.max(0, Number(caller)) * ratio * HEADROOM) + CONSTANT;
  return Math.min(r, cap);
}

export default { callerInputTokens, billableInputTokens };

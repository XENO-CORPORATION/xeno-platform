/**
 * Credit costs for AI generation models.
 * Used by xenoRoutes to determine how many credits to deduct per request.
 */

const IMAGE_COSTS = {
  'fast': 5,
  'classic': 5,
  'flux-dev': 10,
  'ideogram': 10,
  'auto': 10,
  'flux-pro-plus': 20,
  'imagen3': 20,
  'seedream-4-5': 20,
  'imagen4': 30,
  'imagen4-ultra': 30,
  'flux-2-max': 30,
  'gpt-high': 25,
  'flux-kontext-high': 20,
};

const EDIT_COST = 10;
const VIDEO_COST = 100;
const AUDIO_COST = 40;

export function getCreditCost(type, model) {
  switch (type) {
    case 'image':
      return IMAGE_COSTS[model] || 10;
    case 'edit':
    case 'upscale':
      return EDIT_COST;
    case 'video':
      return VIDEO_COST;
    case 'audio':
      return AUDIO_COST;
    default:
      return 10;
  }
}

// ── Premium chat (LLM) token pricing ─────────────────────────────────────────
//
// Premium chat is token-metered (unlike the flat per-action image/video costs).
// Prices are MICRO-credits PER TOKEN (1 credit = 1_000_000 µcr = €0.01), so e.g.
// output 3200 µcr/tok = €0.032 per 1K output tokens. These carry a markup over
// provider COGS (the XENO margin) and are TUNABLE here — this is the single
// source of truth for premium chat cost + preview. byok/inhouse paths are NOT
// priced here (they cost XENO nothing → never metered).

const MICRO = 1_000_000;

// Per-token µcr, by capability tier. { input, output }.
const CHAT_TIERS = {
  'frontier-large': { input: 800, output: 3200 }, // opus / gpt-5.x-pro / gemini-pro / grok-4
  'frontier-mid':   { input: 200, output: 800 },  // sonnet / haiku / gpt-5-mini / flash / mistral-large
  'open':           { input: 60,  output: 240 },  // llama / deepseek / qwen / mistral-small via OpenRouter
  'default':        { input: 300, output: 1200 },
};

// Explicit per-model overrides (OpenRouter-style ids) win over tier heuristics.
const CHAT_MODEL_OVERRIDES = {
  // e.g. 'openai/gpt-5.4-pro': { input: 1000, output: 4000 },
};

/**
 * Classify a model id into a pricing tier (heuristic on the id). Order matters:
 * open-weight and mid markers are tested BEFORE the broad "large" patterns so e.g.
 * 'gpt-5.4-mini' resolves to mid, not large, and 'llama-4' to open.
 */
export function chatTier(modelId = '') {
  const id = String(modelId).toLowerCase();
  // Open-weight (served cheaply via OpenRouter, or run in-house).
  if (/llama|deepseek|qwen|mistral|tinyllama|-scout|-maverick/.test(id)) return 'open';
  // Mid proprietary (small/fast frontier). Hyphen-anchor mini/nano so 'geMINI' doesn't match.
  if (/-mini|-nano|flash|haiku|sonnet|gpt-4o|grok-4\.1-fast|grok-3/.test(id)) return 'frontier-mid';
  // Large frontier (flagship).
  if (/opus|gpt-5|gpt-4\.|pro|grok-4|-max\b|gemini-\d+(\.\d+)?-pro/.test(id)) return 'frontier-large';
  return 'default';
}

function chatRates(modelId) {
  return CHAT_MODEL_OVERRIDES[modelId] || CHAT_TIERS[chatTier(modelId)] || CHAT_TIERS.default;
}

/** Actual premium-chat cost in µcr from real token usage (used at settle time). */
export function getChatCostMicro(modelId, { inputTokens = 0, outputTokens = 0 } = {}) {
  const r = chatRates(modelId);
  return Math.max(0, Math.round(r.input * (inputTokens || 0) + r.output * (outputTokens || 0)));
}

/**
 * WORST-CASE premium-chat cost in µcr, used to place the pre-call hold. settleHoldV2
 * clamps the actual charge to the held amount, so the hold MUST be >= real cost or
 * we under-charge — hence we assume the full max_tokens are billed as output.
 */
export function estimateChatCostMicro(modelId, { inputTokens = 0, maxOutputTokens = 1024 } = {}) {
  const r = chatRates(modelId);
  // Pad the input estimate 25% — chars/4 is not a strict upper bound (code/CJK are
  // token-denser) and the hold must stay >= actual so settle never clamps to an
  // undercharge. Output is already worst-case (max_tokens).
  const est = r.input * Math.ceil((inputTokens || 0) * 1.25) + r.output * (maxOutputTokens || 1024);
  // Floor the hold at a small non-zero amount so a 402 fires for empty wallets.
  return Math.max(Math.round(est), Math.round(0.05 * MICRO)); // >= 0.05 credit
}

/** Cheap token estimate for prompt sizing (≈4 chars/token + a per-image constant). */
export function estimateMessageTokens(messages = []) {
  let chars = 0;
  let images = 0;
  for (const m of messages) {
    if (typeof m?.content === 'string') chars += m.content.length;
    else if (Array.isArray(m?.content)) {
      for (const part of m.content) {
        if (part?.type === 'image_url') images += 1;
        else chars += (part?.text?.length || 0);
      }
    }
  }
  // ~1200 tokens/image so vision prompts are not under-reserved (images cost real prompt tokens).
  return Math.ceil(chars / 4) + messages.length * 4 + images * 1200;
}

/**
 * Tokenizer Routes
 * Server-side token counting using tiktoken
 *
 * Note: tiktoken is OpenAI's tokenizer. Different models use different tokenizers:
 * - Claude typically uses ~8% more tokens than GPT-4 for the same text
 * - Gemini and other models vary as well
 * We apply adjustment factors to account for these differences.
 *
 * ── WASM encodings are bounded ────────────────────────────────────────────
 * dqbd/tiktoken#35: each `encoding_for_model()` / `get_encoding()` allocates
 * a WASM encoder that JS GC cannot free. ~188 allocations irrecoverably
 * crash the Node process (Connection reset → Cloudflare 502).
 * dqbd/tiktoken#69: `free()` then reuse of the SAME instance is also fatal.
 *
 * So we cache ONE encoding per family (max 3), never per modelId. On encode
 * failure we evict, free the stale instance, recreate, and retry once.
 */

import express from 'express';
import { encoding_for_model, get_encoding } from 'tiktoken';

const router = express.Router();

/** A conversation longer than this is estimated client-side, not loaded into WASM. */
const MAX_TOKENIZE_CHARS = 200_000;

const ENCODING_FAMILY = {
  GPT4: 'gpt-4',
  GPT35: 'gpt-3.5-turbo',
  CL100K: 'cl100k_base',
};

const encodingCache = new Map();

/**
 * Adjustment factors for different model families
 * These account for tokenizer differences vs tiktoken (OpenAI's tokenizer)
 * Values > 1.0 mean the model uses more tokens than tiktoken estimates
 */
const MODEL_ADJUSTMENT_FACTORS = {
  'anthropic': 1.12,  // Claude uses ~10-12% more tokens than tiktoken estimates
  'google': 1.05,     // Gemini uses ~5% more tokens
  'deepseek': 1.02,   // DeepSeek is closer to GPT
  'openai': 1.0,      // OpenAI is baseline (tiktoken is their tokenizer)
  'meta': 1.03,       // Llama models
  'mistral': 1.02,    // Mistral models
  'qwen': 1.05,       // Qwen models
  'x-ai': 1.03,       // Grok models
  'default': 1.05     // Conservative default
};

const getAdjustmentFactor = (modelId) => {
  const provider = String(modelId || '').split('/')[0]?.toLowerCase();
  return MODEL_ADJUSTMENT_FACTORS[provider] || MODEL_ADJUSTMENT_FACTORS['default'];
};

function encodingFamilyFor(modelId) {
  const id = String(modelId || '');
  if (id.includes('gpt-4') || id.includes('gpt-5')) return ENCODING_FAMILY.GPT4;
  if (id.includes('gpt-3.5')) return ENCODING_FAMILY.GPT35;
  return ENCODING_FAMILY.CL100K;
}

function createEncoding(family) {
  if (family === ENCODING_FAMILY.GPT4) return encoding_for_model('gpt-4');
  if (family === ENCODING_FAMILY.GPT35) return encoding_for_model('gpt-3.5-turbo');
  return get_encoding('cl100k_base');
}

function getEncodingForFamily(family) {
  const cached = encodingCache.get(family);
  if (cached) return cached;
  const encoding = createEncoding(family);
  encodingCache.set(family, encoding);
  return encoding;
}

function recreateEncoding(family) {
  const stale = encodingCache.get(family);
  encodingCache.delete(family);
  if (stale) {
    try {
      stale.free();
    } catch {
      // Already dead — creating a fresh instance is the recovery.
    }
  }
  return getEncodingForFamily(family);
}

function encodeText(family, text) {
  const encoding = getEncodingForFamily(family);
  try {
    return encoding.encode(text);
  } catch (error) {
    console.warn(`[Tokenizer] encode failed for ${family}, recreating:`, error.message);
    return recreateEncoding(family).encode(text);
  }
}

function charCountOf(value) {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) {
    return value.reduce((n, item) => n + (typeof item === 'string' ? item.length : 0), 0);
  }
  return 0;
}

function rejectIfTooLarge(res, chars) {
  if (chars <= MAX_TOKENIZE_CHARS) return false;
  res.status(413).json({
    success: false,
    error: 'Tokenize payload too large',
    code: 'tokenize_payload_too_large',
  });
  return true;
}

/**
 * POST /api/tokenize/count
 * Count tokens for given text(s)
 *
 * Body: {
 *   text: string | string[],  // Single text or array of texts
 *   modelId?: string          // Optional model ID for model-specific tokenization
 * }
 *
 * Response: {
 *   success: true,
 *   tokens: number | number[], // Token count(s)
 *   total: number              // Total tokens if array was provided
 * }
 */
router.post('/count', async (req, res) => {
  try {
    const { text, modelId = 'gpt-4' } = req.body;

    if (text === undefined || text === null) {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }

    if (rejectIfTooLarge(res, charCountOf(text))) return;

    const family = encodingFamilyFor(modelId);
    const adjustmentFactor = getAdjustmentFactor(modelId);

    if (Array.isArray(text)) {
      const tokenCounts = text.map(t => {
        if (typeof t !== 'string') return 0;
        const rawCount = encodeText(family, t).length;
        return Math.ceil(rawCount * adjustmentFactor);
      });

      return res.json({
        success: true,
        tokens: tokenCounts,
        total: tokenCounts.reduce((a, b) => a + b, 0),
        adjustmentFactor
      });
    }

    if (typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Text must be a string or array of strings'
      });
    }

    const rawTokenCount = encodeText(family, text).length;
    const tokenCount = Math.ceil(rawTokenCount * adjustmentFactor);

    return res.json({
      success: true,
      tokens: tokenCount,
      total: tokenCount,
      adjustmentFactor
    });

  } catch (error) {
    console.error('[Tokenizer] Error counting tokens:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/tokenize/messages
 * Count tokens for chat messages (accounts for message structure overhead)
 *
 * Body: {
 *   messages: Array<{ role: string, content: string }>,
 *   modelId?: string,
 *   systemPrompt?: string
 * }
 *
 * Response: {
 *   success: true,
 *   messageTokens: number[],   // Token count per message
 *   systemTokens: number,      // System prompt tokens
 *   total: number,             // Total tokens
 *   overhead: number           // Estimated overhead from message structure
 * }
 */
router.post('/messages', async (req, res) => {
  try {
    const { messages, modelId = 'gpt-4', systemPrompt = '' } = req.body;

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        success: false,
        error: 'Messages must be an array'
      });
    }

    const prompt = typeof systemPrompt === 'string' ? systemPrompt : '';
    const chars = messages.reduce((n, msg) => {
      const content = (msg && (msg.content || msg.text)) || '';
      return n + (typeof content === 'string' ? content.length : 0);
    }, 0) + prompt.length;
    if (rejectIfTooLarge(res, chars)) return;

    const family = encodingFamilyFor(modelId);
    const adjustmentFactor = getAdjustmentFactor(modelId);

    const messageTokens = messages.map(msg => {
      const content = (msg && (msg.content || msg.text)) || '';
      if (typeof content !== 'string' || content.length === 0) return 0;
      const rawCount = encodeText(family, content).length;
      return Math.ceil(rawCount * adjustmentFactor);
    });

    const rawSystemTokens = prompt ? encodeText(family, prompt).length : 0;
    const systemTokens = Math.ceil(rawSystemTokens * adjustmentFactor);

    const rawOverhead = messages.length * 4 + (prompt ? 4 : 0);
    const overhead = Math.ceil(rawOverhead * adjustmentFactor);

    const total = messageTokens.reduce((a, b) => a + b, 0) + systemTokens + overhead;

    return res.json({
      success: true,
      messageTokens,
      systemTokens,
      total,
      overhead,
      adjustmentFactor
    });

  } catch (error) {
    console.error('[Tokenizer] Error counting message tokens:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/tokenize/health
 * Health check for tokenizer service
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Tokenizer service is running',
    supportedEncodings: ['cl100k_base', 'p50k_base', 'r50k_base']
  });
});

export default router;

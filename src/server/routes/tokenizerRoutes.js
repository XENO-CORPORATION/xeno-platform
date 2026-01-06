/**
 * Tokenizer Routes
 * Server-side token counting using tiktoken
 *
 * Note: tiktoken is OpenAI's tokenizer. Different models use different tokenizers:
 * - Claude typically uses ~8% more tokens than GPT-4 for the same text
 * - Gemini and other models vary as well
 * We apply adjustment factors to account for these differences.
 */

import express from 'express';
import { encoding_for_model, get_encoding } from 'tiktoken';

const router = express.Router();

// Cache encodings for performance
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

/**
 * Get adjustment factor for a model
 */
const getAdjustmentFactor = (modelId) => {
  const provider = modelId.split('/')[0]?.toLowerCase();
  return MODEL_ADJUSTMENT_FACTORS[provider] || MODEL_ADJUSTMENT_FACTORS['default'];
};

/**
 * Get the appropriate encoding for a model
 * Falls back to cl100k_base (GPT-4/Claude compatible) for unknown models
 */
const getEncodingForModel = (modelId) => {
  // Check cache first
  if (encodingCache.has(modelId)) {
    return encodingCache.get(modelId);
  }

  let encoding;

  try {
    // Map model prefixes to tiktoken model names
    if (modelId.includes('gpt-4') || modelId.includes('gpt-5')) {
      encoding = encoding_for_model('gpt-4');
    } else if (modelId.includes('gpt-3.5')) {
      encoding = encoding_for_model('gpt-3.5-turbo');
    } else {
      // For Claude, Gemini, DeepSeek, etc. - use cl100k_base
      // This is the most widely compatible encoding
      encoding = get_encoding('cl100k_base');
    }
  } catch (error) {
    console.warn(`[Tokenizer] Could not get encoding for model ${modelId}, using cl100k_base:`, error.message);
    encoding = get_encoding('cl100k_base');
  }

  encodingCache.set(modelId, encoding);
  return encoding;
};

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

    const encoding = getEncodingForModel(modelId);

    // Get adjustment factor for this model
    const adjustmentFactor = getAdjustmentFactor(modelId);

    // Handle array of texts
    if (Array.isArray(text)) {
      const tokenCounts = text.map(t => {
        if (typeof t !== 'string') return 0;
        const rawCount = encoding.encode(t).length;
        return Math.ceil(rawCount * adjustmentFactor);
      });

      return res.json({
        success: true,
        tokens: tokenCounts,
        total: tokenCounts.reduce((a, b) => a + b, 0),
        adjustmentFactor
      });
    }

    // Handle single text
    if (typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Text must be a string or array of strings'
      });
    }

    const rawTokenCount = encoding.encode(text).length;
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

    const encoding = getEncodingForModel(modelId);

    // Get adjustment factor for this model
    const adjustmentFactor = getAdjustmentFactor(modelId);

    // Count tokens per message (with adjustment)
    const messageTokens = messages.map(msg => {
      const content = msg.content || msg.text || '';
      const rawCount = encoding.encode(content).length;
      return Math.ceil(rawCount * adjustmentFactor);
    });

    // Count system prompt tokens (with adjustment)
    const rawSystemTokens = systemPrompt ? encoding.encode(systemPrompt).length : 0;
    const systemTokens = Math.ceil(rawSystemTokens * adjustmentFactor);

    // Estimate overhead (role markers, message separators, etc.)
    // Approximately 4 tokens per message for structure (also adjusted)
    const rawOverhead = messages.length * 4 + (systemPrompt ? 4 : 0);
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

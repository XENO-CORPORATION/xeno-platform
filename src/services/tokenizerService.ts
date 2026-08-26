/**
 * Tokenizer Service
 * Frontend service for server-side token counting
 */

const API_BASE = '/api/tokenize';

// Cache for token counts to reduce API calls
const tokenCache = new Map<string, { tokens: number; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Generate a cache key for text
 */
const getCacheKey = (text: string, modelId: string): string => {
  // Use first 100 chars + length + model for cache key to avoid huge keys
  return `${text.slice(0, 100)}_${text.length}_${modelId}`;
};

/**
 * Get cached token count if available and not expired
 */
const getCachedTokens = (text: string, modelId: string): number | null => {
  const key = getCacheKey(text, modelId);
  const cached = tokenCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.tokens;
  }

  return null;
};

/**
 * Cache token count
 */
const setCachedTokens = (text: string, modelId: string, tokens: number): void => {
  const key = getCacheKey(text, modelId);
  tokenCache.set(key, { tokens, timestamp: Date.now() });

  // Limit cache size
  if (tokenCache.size > 1000) {
    const oldestKey = tokenCache.keys().next().value;
    if (oldestKey) tokenCache.delete(oldestKey);
  }
};

async function parseTokenizerJson(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Tokenizer API error: ${response.status}. Non-JSON response.`);
  }
}

/**
 * Count tokens for a single text string
 */
export const countTokens = async (text: string, modelId: string = 'gpt-4'): Promise<number> => {
  if (!text) return 0;

  // Check cache first
  const cached = getCachedTokens(text, modelId);
  if (cached !== null) {
    return cached;
  }

  try {
    const response = await fetch(`${API_BASE}/count`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, modelId }),
    });

    if (!response.ok) {
      throw new Error(`Tokenizer API error: ${response.status}`);
    }

    const data = await parseTokenizerJson(response);

    if (data.success) {
      setCachedTokens(text, modelId, data.tokens as number);
      return data.tokens as number;
    }

    throw new Error((typeof data.error === 'string' && data.error) || 'Unknown error');
  } catch (error) {
    console.warn('[TokenizerService] Error counting tokens, using estimate:', error);
    // Fallback to rough estimate if API fails
    return Math.ceil(text.length / 4);
  }
};

/**
 * Count tokens for multiple text strings (batch)
 */
export const countTokensBatch = async (texts: string[], modelId: string = 'gpt-4'): Promise<number[]> => {
  if (!texts || texts.length === 0) return [];

  // Check which texts need to be fetched
  const results: (number | null)[] = texts.map(t => getCachedTokens(t, modelId));
  const uncachedIndices = results.map((r, i) => r === null ? i : -1).filter(i => i !== -1);

  // If all cached, return immediately
  if (uncachedIndices.length === 0) {
    return results as number[];
  }

  // Fetch uncached texts
  const uncachedTexts = uncachedIndices.map(i => texts[i]);

  try {
    const response = await fetch(`${API_BASE}/count`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: uncachedTexts, modelId }),
    });

    if (!response.ok) {
      throw new Error(`Tokenizer API error: ${response.status}`);
    }

    const data = await parseTokenizerJson(response);

    if (data.success && Array.isArray(data.tokens)) {
      // Fill in the results and cache
      uncachedIndices.forEach((originalIndex, i) => {
        const tokenCount = (data.tokens as number[])[i];
        results[originalIndex] = tokenCount;
        setCachedTokens(texts[originalIndex], modelId, tokenCount);
      });

      return results as number[];
    }

    throw new Error((typeof data.error === 'string' && data.error) || 'Unknown error');
  } catch (error) {
    console.warn('[TokenizerService] Error counting batch tokens, using estimates:', error);
    // Fallback to rough estimates
    return texts.map(t => Math.ceil((t?.length || 0) / 4));
  }
};

/**
 * Count tokens for chat messages with structure overhead
 */
export const countMessageTokens = async (
  messages: Array<{ role?: string; sender?: string; content?: string; text?: string }>,
  modelId: string = 'gpt-4',
  systemPrompt: string = ''
): Promise<{
  messageTokens: number[];
  systemTokens: number;
  total: number;
  overhead: number;
}> => {
  if (!messages || messages.length === 0) {
    const systemTokens = systemPrompt ? await countTokens(systemPrompt, modelId) : 0;
    return {
      messageTokens: [],
      systemTokens,
      total: systemTokens + (systemPrompt ? 4 : 0),
      overhead: systemPrompt ? 4 : 0
    };
  }

  try {
    // Normalize message format
    const normalizedMessages = messages.map(msg => ({
      role: msg.role || msg.sender || 'user',
      content: msg.content || msg.text || ''
    }));

    const response = await fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: normalizedMessages,
        modelId,
        systemPrompt
      }),
    });

    if (!response.ok) {
      throw new Error(`Tokenizer API error: ${response.status}`);
    }

    const data = await parseTokenizerJson(response);

    if (data.success) {
      return {
        messageTokens: data.messageTokens as number[],
        systemTokens: data.systemTokens as number,
        total: data.total as number,
        overhead: data.overhead as number
      };
    }

    throw new Error((typeof data.error === 'string' && data.error) || 'Unknown error');
  } catch (error) {
    console.warn('[TokenizerService] Error counting message tokens, using estimates:', error);
    // Fallback to rough estimates
    const messageTokens = messages.map(msg => {
      const content = msg.content || msg.text || '';
      return Math.ceil(content.length / 4);
    });
    const systemTokens = Math.ceil((systemPrompt?.length || 0) / 4);
    const overhead = messages.length * 4 + (systemPrompt ? 4 : 0);

    return {
      messageTokens,
      systemTokens,
      total: messageTokens.reduce((a, b) => a + b, 0) + systemTokens + overhead,
      overhead
    };
  }
};

/**
 * Quick estimate (no API call) - for real-time typing
 * Use this for instant feedback, then update with real count
 */
export const estimateTokens = (text: string): number => {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
};

/**
 * Clear the token cache
 */
export const clearTokenCache = (): void => {
  tokenCache.clear();
};

export default {
  countTokens,
  countTokensBatch,
  countMessageTokens,
  estimateTokens,
  clearTokenCache
};

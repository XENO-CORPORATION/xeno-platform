/**
 * Vision Reference Service
 * Extracts style and character descriptions from images using Gemini Vision.
 *
 * The browser holds NO provider keys. Vision / image-understanding has no secure
 * backend route in this migration pass, so extraction fails gracefully — the
 * enhancePromptWith* wrappers below already fall back to the original prompt.
 */

// Cache for vision analysis results to avoid re-analyzing the same image
const analysisCache = new Map<string, { result: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

/**
 * Generate a cache key from image URL/data
 */
function getCacheKey(imageUrl: string, type: 'style' | 'character'): string {
  // Use first 100 chars of base64 + type as key (enough to identify unique images)
  const imageKey = imageUrl.length > 100 ? imageUrl.substring(0, 100) : imageUrl;
  return `${type}:${imageKey}`;
}

/**
 * Check cache for existing analysis
 */
function getFromCache(key: string): string | null {
  const cached = analysisCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('[VisionRef] Cache hit for:', key.substring(0, 30));
    return cached.result;
  }
  return null;
}

/**
 * Store analysis result in cache
 */
function setInCache(key: string, result: string): void {
  analysisCache.set(key, { result, timestamp: Date.now() });

  // Clean old cache entries
  for (const [k, v] of analysisCache.entries()) {
    if (Date.now() - v.timestamp > CACHE_TTL) {
      analysisCache.delete(k);
    }
  }
}

/**
 * Analyze image with Gemini using a specific prompt.
 *
 * Vision / image-understanding has no secure backend route in this migration pass,
 * and the browser must ship no provider keys, so this fails with a clear error.
 * Callers reach this only through enhancePromptWith* wrappers, which already catch
 * and fall back to the original prompt — so the user-visible flow degrades cleanly.
 */
async function analyzeWithPrompt(_imageBase64: string, _systemPrompt: string): Promise<string> {
  throw new Error(
    'Vision reference extraction (Gemini vision) is being migrated to the secure backend and is temporarily unavailable.'
  );
}

/**
 * Style extraction prompt - focuses on artistic style, colors, mood, lighting
 */
const STYLE_EXTRACTION_PROMPT = `You are analyzing an image to extract its artistic style for use as a style reference in AI image generation.

Describe ONLY the visual style characteristics in a comma-separated list. Include:
- Art style (e.g., photorealistic, anime, oil painting, watercolor, digital art, illustration)
- Color palette (e.g., warm tones, muted pastels, vibrant saturated colors, monochromatic)
- Lighting (e.g., soft diffused lighting, dramatic chiaroscuro, golden hour, neon glow)
- Mood/atmosphere (e.g., dreamy, gritty, ethereal, dark and moody, bright and cheerful)
- Texture/rendering (e.g., smooth gradients, textured brushstrokes, film grain, sharp details)
- Composition style (e.g., centered subject, rule of thirds, dynamic angles, minimalist)

Output ONLY the style descriptors as a comma-separated list, no explanations. Example output:
"digital illustration style, soft pastel colors, diffused lighting, dreamy ethereal atmosphere, smooth gradients, centered composition"`;

/**
 * Character extraction prompt - focuses on person/character appearance
 */
const CHARACTER_EXTRACTION_PROMPT = `You are analyzing an image to extract character/person details for use as a character reference in AI image generation.

Describe ONLY the character's physical appearance in a comma-separated list. Include:
- Gender and approximate age (e.g., young woman, middle-aged man, elderly person)
- Hair (color, length, style - e.g., long wavy blonde hair, short black hair with bangs)
- Face features (e.g., sharp jawline, round face, high cheekbones, freckles)
- Eye color and shape (e.g., large blue eyes, narrow brown eyes)
- Skin tone (e.g., fair skin, olive complexion, dark skin)
- Body type if visible (e.g., athletic build, slender, stocky)
- Distinctive features (e.g., beard, glasses, scar, tattoos, piercings)
- Current clothing/outfit (e.g., wearing a red dress, in a business suit)

Output ONLY the character descriptors as a comma-separated list, no explanations. Example output:
"young woman in her 20s, long wavy auburn hair, fair skin with freckles, bright green eyes, heart-shaped face, slender build, wearing a vintage floral dress"`;

export const visionReferenceService = {
  /**
   * Extract style description from an image
   * @param imageUrl Base64 image data or URL
   * @returns Comma-separated style descriptors
   */
  async extractStyleDescription(imageUrl: string): Promise<string> {
    const cacheKey = getCacheKey(imageUrl, 'style');
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
      console.log('[VisionRef] Extracting style from image...');
      const result = await analyzeWithPrompt(imageUrl, STYLE_EXTRACTION_PROMPT);
      setInCache(cacheKey, result);
      console.log('[VisionRef] Style extracted:', result.substring(0, 100) + '...');
      return result;
    } catch (error) {
      console.error('[VisionRef] Failed to extract style:', error);
      throw error;
    }
  },

  /**
   * Extract character description from an image
   * @param imageUrl Base64 image data or URL
   * @returns Comma-separated character descriptors
   */
  async extractCharacterDescription(imageUrl: string): Promise<string> {
    const cacheKey = getCacheKey(imageUrl, 'character');
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
      console.log('[VisionRef] Extracting character from image...');
      const result = await analyzeWithPrompt(imageUrl, CHARACTER_EXTRACTION_PROMPT);
      setInCache(cacheKey, result);
      console.log('[VisionRef] Character extracted:', result.substring(0, 100) + '...');
      return result;
    } catch (error) {
      console.error('[VisionRef] Failed to extract character:', error);
      throw error;
    }
  },

  /**
   * Enhance a prompt with style reference description
   * @param originalPrompt The user's original prompt
   * @param imageUrl Base64 image data or URL of style reference
   * @returns Enhanced prompt with style descriptors appended
   */
  async enhancePromptWithStyle(originalPrompt: string, imageUrl: string): Promise<string> {
    try {
      const styleDesc = await this.extractStyleDescription(imageUrl);
      // Append style to prompt in a natural way
      return `${originalPrompt}, in the style of: ${styleDesc}`;
    } catch (error) {
      console.error('[VisionRef] Failed to enhance with style, using original prompt:', error);
      return originalPrompt;
    }
  },

  /**
   * Enhance a prompt with character reference description
   * @param originalPrompt The user's original prompt
   * @param imageUrl Base64 image data or URL of character reference
   * @returns Enhanced prompt with character descriptors
   */
  async enhancePromptWithCharacter(originalPrompt: string, imageUrl: string): Promise<string> {
    try {
      const charDesc = await this.extractCharacterDescription(imageUrl);
      // Prepend character description to maintain subject focus
      return `${charDesc}, ${originalPrompt}`;
    } catch (error) {
      console.error('[VisionRef] Failed to enhance with character, using original prompt:', error);
      return originalPrompt;
    }
  },

  /**
   * Enhance prompt with both style and character references if provided
   * @param originalPrompt The user's original prompt
   * @param styleImageUrl Optional style reference image
   * @param characterImageUrl Optional character reference image
   * @returns Enhanced prompt
   */
  async enhancePrompt(
    originalPrompt: string,
    styleImageUrl?: string,
    characterImageUrl?: string
  ): Promise<string> {
    let enhancedPrompt = originalPrompt;

    // Apply character reference first (affects subject)
    if (characterImageUrl) {
      enhancedPrompt = await this.enhancePromptWithCharacter(enhancedPrompt, characterImageUrl);
    }

    // Apply style reference second (affects rendering)
    if (styleImageUrl) {
      enhancedPrompt = await this.enhancePromptWithStyle(enhancedPrompt, styleImageUrl);
    }

    return enhancedPrompt;
  },

  /**
   * Clear the analysis cache
   */
  clearCache(): void {
    analysisCache.clear();
    console.log('[VisionRef] Cache cleared');
  },

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: analysisCache.size,
      entries: Array.from(analysisCache.keys()).map(k => k.substring(0, 40) + '...'),
    };
  },
};

export default visionReferenceService;

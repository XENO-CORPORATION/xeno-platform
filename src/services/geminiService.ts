/**
 * Service for Gemini-backed text features.
 *
 * The browser holds NO provider keys. Text generation routes through the authed,
 * metered backend via chatComplete() (which proxies to api.xenostudio.ai — the only
 * place provider keys live). Vision / image-understanding has no secure backend route
 * in this migration pass, so those calls fail gracefully with a clear error instead
 * of shipping a key or calling Google directly from the browser.
 */
import { chatComplete } from './aiService';

/** Gemini text model, routed through the metered backend. */
const GEMINI_TEXT_MODEL = 'gpt-5.4-mini';

/**
 * Back-compat shim. Provider keys and SDK setup now live entirely in the backend,
 * so there is nothing to initialize in the browser. Retained (with its original
 * signature) so existing callers keep compiling; the optional apiKey argument is
 * ignored — the browser ships no provider keys.
 */
export function initializeGeminiSDK(_apiKey?: string): boolean {
  return true;
}

export interface GeneratedPromptResult {
  positivePrompt: string;
  negativePrompt: string;
}

/**
 * Analyzes an image and generates a detailed description using Gemini's vision
 * capabilities. Vision/image-understanding has no secure backend route in this
 * migration pass, so this fails with a clear error rather than shipping a key.
 * @param _imageBase64 Base64-encoded image data (can include data URL prefix)
 */
export async function analyzeImageWithGemini(_imageBase64: string): Promise<string> {
  throw new Error(
    'Image analysis (Gemini vision) is being migrated to the secure backend and is temporarily unavailable.'
  );
}

/**
 * Gets model-specific instructions for prompt generation
 */
function getModelSpecificInstructions(modelId: string): string {
  const modelInstructions: Record<string, string> = {
    'classic': 'Create a prompt specifically for Stable Diffusion 3.5. Use detailed descriptors, separate different concepts with commas, and add qualifiers like "highly detailed" or "photorealistic" where appropriate. Include style descriptors like "cinematic", "8k", "masterpiece", "artstation".',
    'flux-dev': 'Create a prompt for the Flux model that emphasizes visual consistency, clarity of composition, and artistic flair. Use clear simple language and focus on mood, lighting, and overall aesthetic.',
    'flux-pro-plus': 'Create a prompt for Flux Pro that emphasizes photorealistic details, lighting quality, and composition. Use professional photography terms and references to artists or styles.',
    'imagen4': 'Create a prompt for Google Imagen 4 that emphasizes natural language descriptions, clear subject details, and composition guidance. Focus on realistic photography or artistic style descriptions.',
    'fast': 'Create a prompt that focuses on photorealistic rendering, lighting effects, and accurate reflections. Use descriptive lighting terms and camera settings references.',
    'auto': 'Create a prompt that emphasizes clean design, professional illustrations, and specific style categories. Focus on visual design elements and composition.',
    'ideogram': 'Create a prompt for Ideogram that emphasizes typography, text integration, artistic illustrations, and visual design. Focus on creative elements with excellent text rendering capabilities.',
    'flux-2-max': 'Create a prompt for Flux 2 Max that emphasizes the highest quality output with photorealistic details, dramatic lighting, and cinematic composition.',
    'seedream-4-5': 'Create a prompt for Seedream that emphasizes artistic creativity with painterly styles, dreamlike atmospheres, and vibrant color palettes.',
    'gpt-high': 'Create a prompt with natural language descriptions focusing on clear subject details, composition, and mood. Be descriptive but conversational.',
  };

  return modelInstructions[modelId] || 'Create a detailed and creative prompt for an AI image generator, with clear descriptive terms and style references.';
}

/**
 * Test if Gemini text inference is working (through the metered backend).
 */
export async function testGeminiConnection(): Promise<boolean> {
  try {
    const result = await chatComplete({
      model: GEMINI_TEXT_MODEL,
      messages: [{ role: 'user', content: 'Hello world' }],
      path: 'premium',
    });
    return !!result.content;
  } catch (error) {
    console.error('[Gemini] Connection test failed:', error);
    return false;
  }
}

/**
 * Generates a creative image prompt using Gemini (via the metered backend),
 * tailored for specific models.
 */
export async function generateImagePrompt(modelId: string, theme?: string): Promise<GeneratedPromptResult> {
  const modelSpecificInstructions = getModelSpecificInstructions(modelId);

  const promptIdea = `${modelSpecificInstructions} ${theme ? `The theme should be about: ${theme}.` : ''}`;

  // Create a comprehensive prompt for Gemini that asks for both positive and negative prompts
  const promptForGemini = `
  As an AI image prompt engineer, I need you to create two parts:

  1. A POSITIVE PROMPT for an AI image generation model. ${promptIdea} Include details about style, lighting, composition, and mood. Make it visually interesting and unique.

  2. A NEGATIVE PROMPT that specifies what should NOT appear in the image. Consider common issues with AI generation such as distorted anatomy, extra limbs, poor composition, blurriness, or any undesirable elements related to the theme.

  Format your response like this:
  POSITIVE: [your positive prompt here]
  NEGATIVE: [your negative prompt here]
  `;

  try {
    const result = await chatComplete({
      model: GEMINI_TEXT_MODEL,
      messages: [{ role: 'user', content: promptForGemini }],
      path: 'premium',
    });
    const generatedText = result.content;

    // Parse the response to extract positive and negative prompts
    let positivePrompt = '';
    let negativePrompt = '';

    // Use regex without 's' flag for better compatibility
    const positiveMatch = generatedText.match(/POSITIVE:\s*([\s\S]*?)(?=NEGATIVE:|$)/i);
    const negativeMatch = generatedText.match(/NEGATIVE:\s*([\s\S]*?)(?=$)/i);

    if (positiveMatch && positiveMatch[1]) {
      positivePrompt = positiveMatch[1].trim();
    }

    if (negativeMatch && negativeMatch[1]) {
      negativePrompt = negativeMatch[1].trim();
    }

    // If we couldn't extract the prompts with the format, try to intelligently split the text
    if (!positivePrompt && !negativePrompt) {
      const lines = generatedText.split('\n').filter(line => line.trim());
      if (lines.length >= 2) {
        // Assume first half is positive, second half is negative
        const midpoint = Math.floor(lines.length / 2);
        positivePrompt = lines.slice(0, midpoint).join(' ');
        negativePrompt = lines.slice(midpoint).join(' ');
      } else {
        positivePrompt = generatedText.trim();
      }
    }

    // Cleanup: remove quotes if present
    positivePrompt = positivePrompt.replace(/^["']|["']$/g, '').trim();
    negativePrompt = negativePrompt.replace(/^["']|["']$/g, '').trim();

    return {
      positivePrompt,
      negativePrompt
    };
  } catch (error) {
    console.error('[Gemini] Error generating prompt:', error);
    throw error;
  }
}

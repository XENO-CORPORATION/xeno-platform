import { GoogleGenerativeAI } from '@google/generative-ai';

// Define the global types for TypeScript
declare global {
  interface Window {
    GEMINI_API_KEY?: string;
  }
}

// Initialize the Gemini API with the key from window (set in index.html)
let geminiInstance: GoogleGenerativeAI | null = null;

/**
 * Initialize the Gemini SDK with the API key.
 * Falls back to environment variables if the window variable is not available.
 */
export function initializeGemini(): GoogleGenerativeAI | null {
  if (geminiInstance) {
    return geminiInstance;
  }

  try {
    // Get API key from window (set in index.html) or use environment variable as fallback
    const apiKey = window.GEMINI_API_KEY || (import.meta.env.VITE_GEMINI_API_KEY as string | undefined);

    if (!apiKey) {
      console.warn('[Gemini] No API key found. Gemini features will remain disabled until a key is provided.');
      return null;
    }

    geminiInstance = new GoogleGenerativeAI(apiKey);
    console.log('[Gemini] SDK initialized successfully');
    return geminiInstance;
  } catch (error) {
    console.error('[Gemini] Error initializing SDK:', error);
    return null;
  }
}

/**
 * Get a Gemini model instance by name
 * @param modelName The model name to use, defaults to "gemini-pro"
 * @returns The Gemini model instance
 */
export function getGeminiModel(modelName: string = 'gemini-pro') {
  const genAI = initializeGemini();

  if (!genAI) {
    throw new Error('Gemini SDK is not configured. Please provide a Gemini API key to enable this feature.');
  }

  return genAI.getGenerativeModel({ model: modelName });
}

/**
 * Generate text using Gemini
 * @param prompt The text prompt to send to Gemini
 * @param modelName Optional model name, defaults to "gemini-pro"
 * @returns The generated text content
 */
export async function generateText(prompt: string, modelName?: string): Promise<string> {
  try {
    const model = getGeminiModel(modelName);
    const result = await model.generateContent(prompt);
    const response = result.response;
    return response.text();
  } catch (error) {
    console.error('[Gemini] Error generating text:', error);
    throw error;
  }
}

/**
 * Generate image from text using Gemini
 * @param prompt The text prompt to generate an image from
 * @param modelName Optional model name, defaults to "gemini-pro-vision"
 * @returns Promise with image data
 */
export async function generateImage(prompt: string, modelName: string = 'gemini-pro-vision') {
  try {
    console.log(`[Gemini] Generating image with prompt: "${prompt}" using model ${modelName}`);
    
    // This is a placeholder - the actual implementation depends on the specific Gemini image generation capabilities
    // You'll need to adapt this based on the Gemini API documentation for image generation
    const model = getGeminiModel(modelName);
    
    // Here we're mocking this since the current version may not have direct image generation
    console.log('[Gemini] Image generation requested via model:', modelName);
    
    // Return a placeholder or trigger your actual image generation logic
    return { success: true, prompt, model: modelName };
  } catch (error) {
    console.error('[Gemini] Error generating image:', error);
    throw error;
  }
}

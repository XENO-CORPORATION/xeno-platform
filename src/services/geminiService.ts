/**
 * Service for interacting with Google's Gemini API
 */
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { API_TOKENS } from '../config/apiConfig';

// Track SDK initialization state
let sdkInitialized = false;
let genAI: GoogleGenerativeAI | null = null;

/**
 * Initialize the Gemini SDK
 */
export function initializeGeminiSDK(apiKey?: string): boolean {
  try {
    // Use provided API key or fall back to config
    let key = apiKey || API_TOKENS.GEMINI_API_TOKEN;
    
    if (!key) {
      console.warn('[Gemini] No API key in config, using fallback key');
      // Fallback API key
      key = 'AIzaSyD8eHthLzcGmeJuhoCWSvBv-5jG1F56BYw';
    }
    
    genAI = new GoogleGenerativeAI(key);
    sdkInitialized = true;
    
    // Update API_TOKENS if a new key was provided
    if (apiKey) {
      API_TOKENS.GEMINI_API_TOKEN = apiKey;
    } else if (!API_TOKENS.GEMINI_API_TOKEN) {
      // Store the fallback key in API_TOKENS for future use
      API_TOKENS.GEMINI_API_TOKEN = key;
    }
    
    console.log('[Gemini] SDK initialized successfully');
    return true;
  } catch (error) {
    console.error('[Gemini] Failed to initialize SDK:', error);
    return false;
  }
}

// Initialize SDK when this module is imported
try {
  initializeGeminiSDK();
} catch (error) {
  console.error('[Gemini] Failed to load SDK on initial import:', error);
}

export interface GeneratedPromptResult {
  positivePrompt: string;
  negativePrompt: string;
}



/**
 * Analyzes an image and generates a detailed description using Gemini's vision capabilities
 * @param imageBase64 Base64-encoded image data (can include data URL prefix)
 * @returns Promise with the generated description
 */
export async function analyzeImageWithGemini(imageBase64: string): Promise<string> {
  // Make sure SDK is initialized
  if (!sdkInitialized || !genAI) {
    if (!initializeGeminiSDK()) {
      throw new Error('Gemini SDK not initialized');
    }
  }
  
  // Double-check that genAI is available after initialization
  if (!genAI) {
    throw new Error('Gemini SDK could not be initialized');
  }
  
  try {
    // Clean up base64 string if it has a data URL prefix
    let base64Image = imageBase64;
    if (base64Image.includes(',')) {
      base64Image = base64Image.split(',')[1];
    }
    
    // Use the Gemini 2.0 Flash model for vision tasks
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash",
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
        }
      ]
    });
    
    // Create content parts with the image
    const parts = [
      {
        inlineData: {
          data: base64Image,
          mimeType: "image/jpeg" // Adjust as needed based on input
        }
      }
    ];
    
    // Add system instruction to guide the response format and content
    const systemInstruction = 
      "Your sole job is to provide a detailed image description of the user's uploaded photo. " +
      "Nothing more. Include complete details about subjects, colors, style, composition, lighting, and mood. " +
      "Be specific and avoid placeholder text or generic descriptions.";
    
    // Generate content with the image
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: parts
        }
      ],
      generationConfig: {
        temperature: 0.2,
        topK: 32,
        topP: 0.95,
        maxOutputTokens: 800,
      },
      systemInstruction: systemInstruction,
    });
    
    // Return the generated text
    return result.response.text();
  } catch (error) {
    console.error('[Gemini] Error analyzing image:', error);
    throw error;
  }
}

/**
 * Gets model-specific instructions for prompt generation
 */
function getModelSpecificInstructions(modelId: string): string {
  const modelInstructions: Record<string, string> = {
    'stable-diffusion-xl': 'Create a prompt specifically for Stable Diffusion 3.5. Use detailed descriptors, separate different concepts with commas, and add qualifiers like "highly detailed" or "photorealistic" where appropriate. Include style descriptors that SD 3.5 recognizes like "cinematic", "8k", "masterpiece", "artstation".',
    'flux-dev': 'Create a prompt for the Flux model that emphasizes visual consistency, clarity of composition, and artistic flair. Use clear simple language and focus on mood, lighting, and overall aesthetic.',
    'flux-pro-1.1': 'Create a prompt for Flux Pro 1.1 that emphasizes photorealistic details, lighting quality, and composition. Use professional photography terms and references to artists or styles.',
    'fal-ai/imagen4/preview': 'Create a prompt for Google Imagen 4 Preview that emphasizes natural language descriptions, clear subject details, and composition guidance. Focus on realistic photography or artistic style descriptions.',
    'fal-ai/luma-photon/flash': 'Create a prompt for Luma Photon Flash that focuses on photorealistic rendering, lighting effects, and accurate reflections. Use descriptive lighting terms and camera settings references.',
    'fal-ai/recraft/v3/text-to-image': 'Create a prompt for Recraft V3 that emphasizes clean design, professional illustrations, and specific style categories. Focus on visual design elements and composition.',
    'fal-ai/ideogram/v3': 'Create a prompt for Ideogram V3 that emphasizes typography, text integration, artistic illustrations, and visual design. Focus on creative elements with excellent text rendering capabilities.',
    'fal-ai/ideogram/v2a/turbo': 'Create a prompt for Ideogram V2a Turbo optimized for fast generation with good typography and poster design capabilities. Use clear descriptions with style categories.'
  };

  return modelInstructions[modelId] || 'Create a detailed and creative prompt for an AI image generator, with clear descriptive terms and style references.';
}

/**
 * Test if Gemini API connection is working
 */
export async function testGeminiConnection(): Promise<boolean> {
  try {
    if (!sdkInitialized || !genAI) {
      if (!initializeGeminiSDK()) {
        return false;
      }
    }
    
    // At this point, genAI should be initialized, but add a check anyway
    if (!genAI) {
      console.error('[Gemini] SDK still not initialized after initialization attempt');
      return false;
    }
    
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent("Hello world");
    return result !== null;
  } catch (error) {
    console.error('[Gemini] Connection test failed:', error);
    return false;
  }
}

/**
 * Generates a creative image prompt using Google's Gemini API, tailored for specific models
 */
export async function generateImagePrompt(modelId: string, theme?: string): Promise<GeneratedPromptResult> {
  // Make sure SDK is initialized
  if (!sdkInitialized || !genAI) {
    if (!initializeGeminiSDK()) {
      throw new Error('Gemini SDK not initialized');
    }
  }
  
  // Double-check that genAI is available after initialization
  if (!genAI) {
    throw new Error('Gemini SDK could not be initialized');
  }
  
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
    // Use the SDK instead of direct API calls
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
        }
      ]
    });
    
    const result = await model.generateContent(promptForGemini);
    const generatedText = result.response.text();
    
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
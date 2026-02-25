import { OpenAI } from 'openai';

// Environment variables
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;

// Initialize OpenAI client
const openai = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY,
      dangerouslyAllowBrowser: true // Allow browser usage for frontend
    })
  : null;

// Type definitions for GPT Image 1
export interface ImageGenerationSettings {
  prompt: string;
  model?: string;
  n?: number;
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  output_format?: 'png' | 'jpeg' | 'webp';
  output_compression?: number;
  background?: 'transparent' | 'white';
  response_format?: 'url' | 'b64_json';
  // Legacy DALL-E parameters (not used with GPT Image 1)
  style?: 'vivid' | 'natural';
}

// Note: Image editing and variations not supported by GPT Image 1

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: Array<{
    type: 'input_text' | 'image_generation_call' | 'text';
    text?: string;
    id?: string;
    result?: string;
  }>;
}

export interface ResponsesApiSettings {
  model?: string;
  input?: Array<{
    type: 'input_text' | 'image_generation_call';
    text?: string;
    id?: string;
  }>;
  previous_response_id?: string;
  stream?: boolean;
  tools?: Array<{
    type: 'image_generation';
    partial_images?: number;
  }>;
}

export interface ImageGenerationResult {
  success: boolean;
  images?: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
  error?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface ConversationResult {
  success: boolean;
  response_id?: string;
  images?: Array<{
    id: string;
    result: string; // base64 encoded image
  }>;
  text_response?: string;
  error?: string;
}

export interface StreamImageCallback {
  onPartialImage?: (imageData: string, index: number) => void;
  onFinalImage?: (imageData: string) => void;
  onError?: (error: string) => void;
  onComplete?: () => void;
}

export interface ImageEditSettings {
  image: File;
  mask?: File;
  prompt: string;
  model?: string;
  n?: number;
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  response_format?: 'url' | 'b64_json';
}

export interface ImageVariationSettings {
  image: File;
  model?: string;
  n?: number;
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  response_format?: 'url' | 'b64_json';
}

// GPT Image 1 Service Class - Text-to-Image Generation Only
export class OpenAIImageService {
  private client: OpenAI | null;

  constructor() {
    if (!OPENAI_API_KEY) {
      console.warn('OpenAI API key not found. GPT Image 1 generation will not work.');
    }
    this.client = openai;
  }

  // Generate Images from Text Prompt using GPT Image 1 or DALL-E
  async generateImage(settings: ImageGenerationSettings): Promise<ImageGenerationResult> {
    if (!OPENAI_API_KEY) {
      return {
        success: false,
        error: 'OpenAI API key not configured'
      };
    }

    try {
      console.log('Generating image with model:', settings.model, settings);
      
      // Use Responses API for GPT Image models
      if (settings.model === 'gpt-image-1' || settings.model?.startsWith('gpt-4')) {
        return await this.generateWithResponsesAPI(settings);
      }
      
      // Use traditional Images API for DALL-E models
      const requestParams: any = {
        model: settings.model || 'dall-e-3',
        prompt: settings.prompt,
        response_format: settings.response_format || 'b64_json'
      };

      // Add parameters for DALL-E models
      if (settings.n && settings.n > 0) {
        requestParams.n = settings.n;
      }
      
      if (settings.size) {
        requestParams.size = settings.size;
      }

      if (settings.quality && settings.model === 'dall-e-3') {
        requestParams.quality = settings.quality;
      }

      if (settings.style && settings.model === 'dall-e-3') {
        requestParams.style = settings.style;
      }
      
      const result = await this.client.images.generate(requestParams);

      return {
        success: true,
        images: result.data?.map(img => ({
          url: img.url,
          b64_json: img.b64_json,
          revised_prompt: img.revised_prompt
        })) || []
      };
    } catch (error: any) {
      console.error('OpenAI image generation error:', error);
      return {
        success: false,
        error: error.message || 'Failed to generate image'
      };
    }
  }

  // Private method to handle GPT Image models using direct generation
  private async generateWithResponsesAPI(settings: ImageGenerationSettings): Promise<ImageGenerationResult> {
    try {
      console.log('Using GPT Image model for generation:', settings);
      
      // For GPT Image models, use them directly with the images API
      // The model 'gpt-image-1' is supported directly in the images.generate API
      const requestParams: any = {
        model: 'gpt-image-1',
        prompt: settings.prompt,
        size: settings.size || '1024x1024',
        n: settings.n || 1,
      };

      // Add GPT Image specific parameters
      if (settings.quality) {
        requestParams.quality = settings.quality;
      }

      if (settings.output_format) {
        requestParams.output_format = settings.output_format;
      }

      if (settings.output_compression !== undefined) {
        requestParams.output_compression = settings.output_compression;
      }

      if (settings.background) {
        requestParams.background = settings.background;
      }

      // GPT Image uses b64_json by default, don't include response_format
      const result = await this.client.images.generate(requestParams);

      return {
        success: true,
        images: result.data?.map(img => ({
          url: img.url,
          b64_json: img.b64_json,
          revised_prompt: img.revised_prompt
        })) || []
      };
    } catch (error: any) {
      console.error('GPT Image generation error:', error);
      return {
        success: false,
        error: error.message || 'Failed to generate image with GPT Image model'
      };
    }
  }

  // Note: GPT Image 1 only supports text-to-image generation
  // Image editing and variations are not available with this model

  // Conversational Image Generation using GPT-4o Mini + GPT Image 1
  async generateConversationalImage(
    userInput: string, 
    conversationHistory: ConversationMessage[] = [], 
    previousResponseId?: string
  ): Promise<ConversationResult> {
    if (!OPENAI_API_KEY) {
      return {
        success: false,
        error: 'OpenAI API key not configured'
      };
    }

    try {
      console.log('Generating conversational image with OpenAI Responses API');
      
      // Prepare the request
      const requestPayload: any = {
        model: 'gpt-4o-mini', // Use appropriate model for responses API
        tools: [{ type: 'image_generation' }]
      };

      if (previousResponseId) {
        // Simple follow-up using previous response ID
        requestPayload.previous_response_id = previousResponseId;
        requestPayload.input = [{ type: 'input_text', text: userInput }];
      } else {
        // New conversation or using full context
        const messages = conversationHistory.map(msg => ({
          role: msg.role,
          content: msg.content
        }));

        // Add current user input
        requestPayload.input = [{ type: 'input_text', text: userInput }];
      }

      const response = await this.client.chat.completions.create({
        ...requestPayload,
        messages: conversationHistory.length > 0 ? conversationHistory.map(msg => ({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        })) : [{ role: 'user', content: userInput }]
      });

      // Extract image generation results
      const images: Array<{ id: string; result: string }> = [];
      const textResponses: string[] = [];

      // Note: This is a simplified implementation
      // The actual Responses API might have different response structure
      if (response.choices && response.choices.length > 0) {
        const choice = response.choices[0];
        textResponses.push(choice.message?.content || '');
      }

      return {
        success: true,
        response_id: response.id,
        images,
        text_response: textResponses.join(' ')
      };
    } catch (error: any) {
      console.error('OpenAI conversational image generation error:', error);
      return {
        success: false,
        error: error.message || 'Failed to generate conversational image'
      };
    }
  }

  // 5. Stream Image Generation with Partial Updates
  async streamImageGeneration(
    prompt: string, 
    callback: StreamImageCallback,
    partialImageCount: number = 2
  ): Promise<void> {
    if (!OPENAI_API_KEY) {
      callback.onError?.('OpenAI API key not configured');
      return;
    }

    try {
      console.log('Starting streaming image generation with GPT Image');
      
      // For now, generate the image normally and provide feedback
      callback.onPartialImage?.('', 0); // Signal start
      
      const result = await this.generateImage({
        prompt,
        model: 'gpt-image-1',
        n: 1,
        size: '1024x1024'
      });

      if (result.success && result.images && result.images.length > 0) {
        const finalImage = result.images[0].b64_json;
        
        if (finalImage) {
          callback.onFinalImage?.(finalImage);
          callback.onComplete?.();
        } else {
          callback.onError?.('No image data received');
        }
      } else {
        callback.onError?.(result.error || 'Failed to generate image');
      }
    } catch (error: any) {
      console.error('OpenAI streaming image generation error:', error);
      callback.onError?.(error.message || 'Failed to stream image generation');
    }
  }

  // 6. Multi-turn Image Editing
  async editImageInConversation(
    imageId: string,
    editPrompt: string,
    conversationHistory: ConversationMessage[]
  ): Promise<ConversationResult> {
    if (!OPENAI_API_KEY) {
      return {
        success: false,
        error: 'OpenAI API key not configured'
      };
    }

    try {
      console.log('Editing image in conversation context');
      
      // Prepare input with image reference
      const input = [
        { type: 'input_text', text: editPrompt },
        { type: 'image_generation_call', id: imageId }
      ];

      // This would use the Responses API for multi-turn editing
      // Simplified implementation for now
      const response = await this.generateConversationalImage(
        editPrompt, 
        conversationHistory
      );

      return response;
    } catch (error: any) {
      console.error('OpenAI multi-turn editing error:', error);
      return {
        success: false,
        error: error.message || 'Failed to edit image in conversation'
      };
    }
  }

  // 7. Get Supported Models
  async getSupportedModels(): Promise<string[]> {
    try {
      const models = await this.client.models.list();
      return models.data
        .filter(model => model.id.includes('gpt-image'))
        .map(model => model.id);
    } catch (error) {
      console.error('Failed to fetch supported models:', error);
      return ['gpt-image-1']; // Default fallback
    }
  }

  // 8. Validate Image Input
  validateImageInput(image: File | string): boolean {
    if (typeof image === 'string') {
      // Validate base64 string
      try {
        atob(image);
        return true;
      } catch {
        return false;
      }
    } else {
      // Validate file
      const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
      return validTypes.includes(image.type) && image.size <= 4 * 1024 * 1024; // 4MB limit
    }
  }

  // 9. Convert Image to Base64
  async imageToBase64(image: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1]; // Remove data:image/...;base64, prefix
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(image);
    });
  }

  // 10. Create Image URL from Base64 with C2PA and Nested Data URI Support
  createImageUrl(base64Data: string, mimeType: string = 'image/png'): string {
    console.log('Creating image URL from data:', base64Data.substring(0, 100) + '...');
    
    // Handle the specific nested data URI issue from OpenAI GPT Image 1 with C2PA metadata
    if (base64Data.includes('data:image/svg+xml;base64,data:image/png;base64,')) {
      console.warn('⚠️ Detected malformed nested data URI with C2PA metadata - fixing...');
      console.log('🔍 Input data preview:', base64Data.substring(0, 200));
      const result = this.extractPngFromNestedDataUri(base64Data);
      console.log('🔄 Extraction result preview:', result.substring(0, 100));
      return result;
    }
    
    // Handle other nested patterns
    if (base64Data.includes('data:image/png;base64,') && base64Data.indexOf('data:') !== base64Data.lastIndexOf('data:')) {
      console.warn('⚠️ Detected nested data URI pattern - extracting inner PNG...');
      return this.extractPngFromNestedDataUri(base64Data);
    }
    
    // Check if the data is already a complete valid data URI
    if (base64Data.startsWith('data:') && !base64Data.includes('data:image/svg+xml;base64,data:image/')) {
      console.log('✅ Data is already a valid data URI');
      return base64Data;
    }
    
    // Clean up any existing data URI prefix
    let cleanBase64 = base64Data;
    if (base64Data.startsWith('data:')) {
      const parts = base64Data.split(',');
      if (parts.length > 1) {
        cleanBase64 = parts[1];
      }
    }
    
    // Validate base64 data
    if (!this.isValidBase64(cleanBase64)) {
      console.error('❌ Invalid base64 data provided');
      throw new Error('Invalid base64 data format');
    }
    
    // Create proper data URI
    const result = `data:${mimeType};base64,${cleanBase64}`;
    console.log('✅ Created data URI:', result.substring(0, 50) + '...');
    return result;
  }

  // Helper method to extract PNG data from nested data URI (handles C2PA metadata)
  private extractPngFromNestedDataUri(nestedDataUri: string): string {
    try {
      console.log('🔧 Extracting PNG from nested data URI...');
      console.log('📊 Input length:', nestedDataUri.length);
      console.log('📊 Input preview:', nestedDataUri.substring(0, 200));
      
      // Pattern 1: Direct extraction from the malformed structure
      // data:image/svg+xml;base64,data:image/png;base64,iVBORw0KGgoAAAA...
      const directPngMatch = nestedDataUri.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
      if (directPngMatch && directPngMatch[1]) {
        const pngBase64 = directPngMatch[1];
        console.log('🎯 Found PNG match, raw length:', pngBase64.length);
        console.log('🎯 PNG preview:', pngBase64.substring(0, 100));
        
        // Clean up any trailing data that might be part of C2PA metadata
        const cleanPngBase64 = pngBase64.split('data:')[0]; // Remove any nested data URI suffixes
        console.log('🧹 Cleaned PNG length:', cleanPngBase64.length);
        
        if (this.isValidBase64(cleanPngBase64)) {
          console.log('✅ Successfully extracted PNG data, size:', cleanPngBase64.length);
          const result = `data:image/png;base64,${cleanPngBase64}`;
          console.log('✅ Final result preview:', result.substring(0, 100));
          return result;
        } else {
          console.warn('❌ Extracted PNG data is not valid base64');
        }
      } else {
        console.warn('❌ No PNG match found in nested data URI');
      }
      
      // Pattern 2: Try to decode the outer SVG container
      if (nestedDataUri.startsWith('data:image/svg+xml;base64,')) {
        const outerBase64 = nestedDataUri.replace('data:image/svg+xml;base64,', '');
        try {
          // Attempt to decode the outer base64 (may contain the inner PNG data URI)
          const decoded = atob(outerBase64);
          
          // Look for embedded PNG data URI within the decoded content
          const innerPngMatch = decoded.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
          if (innerPngMatch && innerPngMatch[1]) {
            const extractedPngBase64 = innerPngMatch[1];
            console.log('✅ Extracted PNG from decoded SVG container, size:', extractedPngBase64.length);
            return `data:image/png;base64,${extractedPngBase64}`;
          }
        } catch (decodeError) {
          console.warn('⚠️ Failed to decode outer SVG base64:', decodeError);
        }
      }
      
      // Pattern 3: Handle C2PA metadata by splitting and finding valid PNG data
      if (nestedDataUri.includes('c2pa.')) {
        console.log('🔍 Detected C2PA metadata, attempting to extract image data...');
        
        // Split by common C2PA markers and find the PNG data
        const parts = nestedDataUri.split(/c2pa\.|signature|actions\.v2/);
        for (const part of parts) {
          const pngMatch = part.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
          if (pngMatch && pngMatch[1] && this.isValidBase64(pngMatch[1])) {
            console.log('✅ Extracted PNG data from C2PA metadata section');
            return `data:image/png;base64,${pngMatch[1]}`;
          }
        }
      }
      
      console.warn('⚠️ Could not extract PNG from nested data URI, returning fallback');
      
      // Last resort: try to extract any base64 PNG data we can find
      const anyPngMatch = nestedDataUri.match(/([A-Za-z0-9+/=]{100,})/);
      if (anyPngMatch && anyPngMatch[1] && this.isValidBase64(anyPngMatch[1])) {
        console.log('🔄 Using fallback PNG extraction');
        return `data:image/png;base64,${anyPngMatch[1]}`;
      }
      
      // If all else fails, return the original (may still cause issues but better than crashing)
      return nestedDataUri;
      
    } catch (error) {
      console.error('❌ Error extracting PNG from nested data URI:', error);
      return nestedDataUri;
    }
  }

  // Helper method to validate base64 format
  private isValidBase64(str: string): boolean {
    if (!str || typeof str !== 'string') return false;
    
    try {
      // Basic format check
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str)) return false;
      
      // Length should be multiple of 4
      if (str.length % 4 !== 0) return false;
      
      // Try to decode a small sample to verify it's actually valid base64
      const sample = str.substring(0, Math.min(100, str.length));
      atob(sample);
      
      return true;
    } catch {
      return false;
    }
  }

  // GPT Image 1 Edit Image (Note: GPT Image 1 supports image editing with multiple images and masks)
  async editImage(settings: ImageEditSettings): Promise<ImageGenerationResult> {
    if (!OPENAI_API_KEY) {
      return {
        success: false,
        error: 'OpenAI API key not configured'
      };
    }

    try {
      console.log('Editing image with GPT Image 1:', settings);
      
      // Prepare the image array (GPT Image 1 can accept multiple images)
      const images = [settings.image];
      
      const requestParams: any = {
        model: settings.model || 'gpt-image-1',
        image: images,
        prompt: settings.prompt,
        response_format: settings.response_format || 'b64_json'
      };

      // Add optional parameters
      if (settings.n && settings.n > 0) {
        requestParams.n = settings.n;
      }
      
      if (settings.size) {
        requestParams.size = settings.size;
      }

      // Add mask if provided
      if (settings.mask) {
        requestParams.mask = settings.mask;
      }
      
      const result = await this.client.images.edit(requestParams);

      return {
        success: true,
        images: result.data?.map((img: any) => ({
          url: img.url,
          b64_json: img.b64_json,
          revised_prompt: img.revised_prompt
        })) || []
      };
    } catch (error: any) {
      console.error('OpenAI image edit error:', error);
      return {
        success: false,
        error: error.message || 'Failed to edit image'
      };
    }
  }

  // Note: GPT Image 1 doesn't support variations in the traditional sense
  // Instead, you can generate multiple images with the same prompt
  async createVariations(settings: ImageVariationSettings): Promise<ImageGenerationResult> {
    if (!OPENAI_API_KEY) {
      return {
        success: false,
        error: 'OpenAI API key not configured'
      };
    }

    try {
      console.log('Creating variations using GPT Image 1 (via multi-image generation)');
      
      // Convert the uploaded image to base64 for use in prompt
      const imageBase64 = await this.imageToBase64(settings.image);
      
      // Use the reference image to generate similar variations
      const requestParams: any = {
        model: settings.model || 'gpt-image-1',
        image: [settings.image],
        prompt: "Create variations of this image while maintaining the same style and content",
        response_format: settings.response_format || 'b64_json'
      };

      // Add optional parameters
      if (settings.n && settings.n > 0) {
        requestParams.n = settings.n;
      }
      
      if (settings.size) {
        requestParams.size = settings.size;
      }
      
      const result = await this.client.images.edit(requestParams);

      return {
        success: true,
        images: result.data?.map((img: any) => ({
          url: img.url,
          b64_json: img.b64_json,
          revised_prompt: img.revised_prompt
        })) || []
      };
    } catch (error: any) {
      console.error('OpenAI image variations error:', error);
      return {
        success: false,
        error: error.message || 'Failed to create variations'
      };
    }
  }
}

// Export singleton instance
export const openaiImageService = new OpenAIImageService();
export default openaiImageService; 

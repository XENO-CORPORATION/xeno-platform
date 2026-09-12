import { BaseNodeProps } from '../BaseNode';

export interface ImageModelSettings {
  // Common settings
  modelId?: string; // To identify the model these settings are for
  prompt?: string; // The main text prompt
  negative_prompt?: string; // The negative prompt
  width?: number; // Image width
  height?: number; // Image height
  num_outputs?: number; // Number of images to generate (fal standard)
  seed?: number; // Seed for reproducibility (-1 or omit for random)
  guidance_scale?: number; // How strongly to adhere to the prompt (CFG)
  num_inference_steps?: number; // Number of diffusion steps

  // --- Deprecated / Alternate names (will be mapped) ---
  resolution?: string; // e.g., "1024x1024" - Prefer width/height
  steps?: number; // Prefer num_inference_steps
  guidance?: number; // Prefer guidance_scale
  numGenerations?: number; // Prefer num_outputs

  // --- Model Specific --- 
  style?: string; // Style prompts (e.g., for Recraft)
  output_format?: 'jpeg' | 'png'; // Fal output format
  image_size?: string; // Fal enum like "landscape_16_9"

  // Img2Img / Editing specific
  inputImage?: string; // Base64 or URL for input image
  image_url?: string; // Fal standard for input image URL
  strength?: number; // Img2Img strength

  // Fal-specific complex types (optional, define interfaces if used heavily)
  controlnet?: any; // Define ControlNet interface if needed
  ip_adapter?: any; // Define IPAdapter interface if needed
  loras?: any[]; // Define LoraWeight interface if needed

  // Gemini-specific (already present)
  // inputImage?: string; // base64 image data for image editing

  // Allow other properties potentially
  [key: string]: any;
}

// Represents a single generated image
export interface GeneratedImage {
  url: string;
  seed?: number;
  latency?: number; // Time taken for this specific image (if available)
  // Add other per-image metadata if needed (e.g., nsfw flag from fal)
  has_nsfw_concept?: boolean;
}

export interface ImageGenerationResponse {
  /** Present on the batch-oriented generation API. Legacy single-image adapters
   * omit it and expose `imageUrl`; callers must accept both during migration. */
  success?: boolean;
  error?: string; // Error message if success is false
  images?: GeneratedImage[]; // Array of generated images
  /** Compatibility field for the single-image model adapters. */
  imageUrl?: string;
  metadata?: { // Overall metadata for the generation batch
    generationTime?: number;
    promptTokens?: number;
    modelVersion?: string;
    // Include Fal input/output details if desired for debugging
    falInput?: Record<string, any>;
    falResult?: any; 
    // Add other relevant batch metadata
    [key: string]: any;
  };
}

export interface ImageModelInterface {
  // Model information
  name: string;
  description: string;
  supportedResolutions: string[]; // Consider changing this if width/height is preferred
  defaultSettings: ImageModelSettings;
  
  // Core functionality
  generateImage(prompt: string, settings: ImageModelSettings): Promise<ImageGenerationResponse>;
  
  // UI rendering
  renderModelSettings(
    settings: ImageModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element;
  
  // Optional capabilities
  supportsNegativePrompt?: boolean;
  supportsControlNet?: boolean;
  supportsInpainting?: boolean;
  supportsFaceEnhancement?: boolean;
  supportsUpscaling?: boolean;
  supportsSeed?: boolean;
  
  // Optional methods for specific capabilities
  enhanceImage?(imageUrl: string, settings: ImageModelSettings): Promise<ImageGenerationResponse>;
  upscaleImage?(imageUrl: string, scale: number): Promise<ImageGenerationResponse>;
}

export interface ImageModelProps extends BaseNodeProps {
  modelInterface: ImageModelInterface;
}

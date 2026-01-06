// Import statements first
import * as falImport from '@fal-ai/client';
import {
  ImageModelSettings,
  ImageGenerationResponse,
  GeneratedImage
} from '../components/nodes/image-models/ImageModelInterface';
import { visionReferenceService } from './visionReferenceService';
import imagen3Schema from '../components/playground/Generation/Google/iamgen3schema.json';
import imagen4Schema from '../components/playground/Generation/Google/imagen4schema.json';
import stableDiffusionV3MediumSchema from '../components/playground/Generation/StableDifussion/stable-diffusion-v3-medium.json';
import stableDiffusionV35LargeSchema from '../components/playground/Generation/StableDifussion/stable-diffusion-v35-large-schema.json';
import fluxProV11UltraSchema from '../components/playground/Generation/Flux/flux-pro-v11-ultra-schema.json';
import fluxDevSchema from '../components/playground/Generation/Flux/flux-dev-schema.json';
import lumaPhotonFlashSchema from '../components/playground/Generation/Luma/luma-photon-flash-schema.json';
import recraftV3Schema from '../components/playground/Generation/Recraft/recraft-v3-schema.json';
import ideogramV3Schema from '../components/playground/Generation/Ideogram/ideogram-v3-schema.json';
import ideogramV2aTurboSchema from '../components/playground/Generation/Ideogram/ideogram-v2a-turbo-schema.json';

// Get environment variables
const FAL_KEY = import.meta.env.VITE_FAL_KEY;

// Initialize the fal client properly
const { createFalClient } = falImport;
const fal = createFalClient({
  credentials: FAL_KEY,
});

console.log("Initialized Fal.ai client:", fal);

// Type definitions
interface ModelDefinition {
  provider: 'gemini' | 'fal';
  falModelId?: string;
  isImageToImage?: boolean;
  // Reference capability flags
  supportsStyleReference?: boolean;  // Native style reference support
  supportsCharacterReference?: boolean;  // Native character reference support
  supportsImageReference?: boolean;  // Image-to-image / image reference support
  defaultSettings: Partial<ImageModelSettings>;
  schema?: any;
}

// Type for the queue update callback - Using any due to typing issues
type QueueUpdateCallback = (update: any) => void;

if (!FAL_KEY) {
  console.warn('Fal AI key (VITE_FAL_KEY) is not set. Fal.ai models will not work.');
}

const modelRegistry: Record<string, ModelDefinition> = {
  'fal-ai/stable-diffusion-v3-medium': {
    provider: 'fal',
    falModelId: 'fal-ai/stable-diffusion-v3-medium',
    isImageToImage: false,
    schema: stableDiffusionV3MediumSchema,
    defaultSettings: {
      negative_prompt: '',
      num_outputs: 1,
      image_size: 'square_hd',
      guidance_scale: 5,
      num_inference_steps: 28,
      seed: undefined,
    },
  },
  'fal-ai/stable-diffusion-v35-large': {
    provider: 'fal',
    falModelId: 'fal-ai/stable-diffusion-v35-large',
    isImageToImage: false,
    schema: stableDiffusionV35LargeSchema,
    defaultSettings: {
      negative_prompt: '',
      num_outputs: 1,
      width: 1024,
      height: 1024,
      guidance_scale: 3.5,
      num_inference_steps: 28,
      seed: undefined,
    },
  },
  'fal-ai/flux-pro/v1.1-ultra': {
    provider: 'fal',
    falModelId: 'fal-ai/flux-pro/v1.1-ultra',
    isImageToImage: false,
    schema: fluxProV11UltraSchema,
    defaultSettings: {
      aspect_ratio: '16:9',
      num_outputs: 1,
      safety_tolerance: '2',
      output_format: 'jpeg',
      raw: false,
      seed: undefined,
    },
  },
  'fal-ai/flux/dev': {
    provider: 'fal',
    falModelId: 'fal-ai/flux/dev',
    isImageToImage: false,
    schema: fluxDevSchema,
    defaultSettings: {
      image_size: 'landscape_4_3',
      num_outputs: 1,
      guidance_scale: 3.5,
      num_inference_steps: 28,
      seed: undefined,
    },
  },
  'fal-ai/imagen3': {
    provider: 'fal',
    falModelId: 'fal-ai/imagen3',
    isImageToImage: false,
    schema: imagen3Schema,
    defaultSettings: {
      aspect_ratio: '1:1',
      num_images: 1,
      negative_prompt: '',
      seed: undefined,
    },
  },
  'fal-ai/imagen4/preview': {
    provider: 'fal',
    falModelId: 'fal-ai/imagen4/preview',
    isImageToImage: false,
    schema: imagen4Schema,
    defaultSettings: {
      aspect_ratio: '1:1',
      num_images: 1,
      negative_prompt: '',
      seed: undefined,
    },
  },
  'fal-ai/luma-photon/flash': {
    provider: 'fal',
    falModelId: 'fal-ai/luma-photon/flash',
    isImageToImage: false,
    supportsStyleReference: true,  // Native support
    supportsCharacterReference: true,  // Native support
    supportsImageReference: true,  // Native support
    schema: lumaPhotonFlashSchema,
    defaultSettings: {
      aspect_ratio: '1:1',
      num_outputs: 1,
      seed: undefined,
    },
  },
  'fal-ai/recraft/v3/text-to-image': {
    provider: 'fal',
    falModelId: 'fal-ai/recraft/v3/text-to-image',
    isImageToImage: false,
    schema: recraftV3Schema,
    defaultSettings: {
      image_size: 'square_hd',
      style: 'realistic_image',
      enable_safety_checker: false,
      colors: [],
      num_outputs: 1,
      seed: undefined,
    },
  },
  'fal-ai/ideogram/v3': {
    provider: 'fal',
    falModelId: 'fal-ai/ideogram/v3',
    isImageToImage: true, // Supports image reference through image_urls
    supportsStyleReference: true,  // Native support via image_urls
    supportsCharacterReference: false,  // Will use Vision-to-Prompt fallback
    supportsImageReference: true,  // Native support
    schema: ideogramV3Schema,
    defaultSettings: {
      image_size: 'square_hd',
      style: 'AUTO',
      expand_prompt: true,
      rendering_speed: 'BALANCED',
      num_images: 1,
      negative_prompt: '',
      seed: undefined,
    },
  },
  'fal-ai/ideogram/v2a/turbo': {
    provider: 'fal',
    falModelId: 'fal-ai/ideogram/v2a/turbo',
    isImageToImage: false, // V2a Turbo is text-to-image only
    schema: ideogramV2aTurboSchema,
    defaultSettings: {
      aspect_ratio: '1:1',
      style: 'auto',
      expand_prompt: true,
      num_outputs: 1,
      seed: undefined,
    },
  },
  // ByteDance Seedream Models
  'fal-ai/bytedance/seedream/v4.5/text-to-image': {
    provider: 'fal',
    falModelId: 'fal-ai/bytedance/seedream/v4.5/text-to-image',
    isImageToImage: false,
    defaultSettings: {
      image_size: 'square_hd',
      num_outputs: 1,
      seed: undefined,
    },
  },
  'fal-ai/bytedance/seedream/v4/text-to-image': {
    provider: 'fal',
    falModelId: 'fal-ai/bytedance/seedream/v4/text-to-image',
    isImageToImage: false,
    defaultSettings: {
      image_size: 'square_hd',
      num_outputs: 1,
      seed: undefined,
    },
  },
  // Alibaba Z-Image
  'fal-ai/z-image/turbo': {
    provider: 'fal',
    falModelId: 'fal-ai/z-image/turbo',
    isImageToImage: false,
    defaultSettings: {
      image_size: 'square_hd',
      num_outputs: 1,
      seed: undefined,
    },
  },
  // ============================================
  // IMAGE-TO-IMAGE MODELS
  // ============================================
  // Flux Dev Image-to-Image
  'fal-ai/flux/dev/image-to-image': {
    provider: 'fal',
    falModelId: 'fal-ai/flux/dev/image-to-image',
    isImageToImage: true,
    defaultSettings: {
      strength: 0.85,
      num_outputs: 1,
      guidance_scale: 3.5,
      num_inference_steps: 28,
      output_format: 'jpeg',
      seed: undefined,
    },
  },
  // Stable Diffusion V3 Medium Image-to-Image
  'fal-ai/stable-diffusion-v3-medium/image-to-image': {
    provider: 'fal',
    falModelId: 'fal-ai/stable-diffusion-v3-medium/image-to-image',
    isImageToImage: true,
    defaultSettings: {
      strength: 0.9,
      num_outputs: 1,
      guidance_scale: 5,
      num_inference_steps: 28,
      seed: undefined,
    },
  },
  // Recraft V3 Image-to-Image
  'fal-ai/recraft/v3/image-to-image': {
    provider: 'fal',
    falModelId: 'fal-ai/recraft/v3/image-to-image',
    isImageToImage: true,
    defaultSettings: {
      difference: 0.5,
      num_outputs: 1,
      seed: undefined,
    },
  },
};

function mapSettingsToFalInput(settings: ImageModelSettings, falModelId: string): Record<string, any> {
  const input: Record<string, any> = {};
  const modelDef = modelRegistry[falModelId];

  if (settings.prompt) input.prompt = settings.prompt;
  
  // Handle Google Imagen models specifically
  if (falModelId === 'fal-ai/imagen3' || falModelId === 'fal-ai/imagen4/preview') {
    // Supported aspect ratios for Imagen 3
    const supportedImagenRatios = ['1:1', '3:4', '4:3', '9:16', '16:9'];

    // For Imagen models, use aspect_ratio instead of width/height
    let aspectRatio = '1:1';
    if (settings.width && settings.height) {
      // Convert width/height to aspect ratio
      aspectRatio = getAspectRatioFromDimensions(settings.width, settings.height);
    } else if (settings.aspect_ratio) {
      aspectRatio = settings.aspect_ratio;
    } else {
      aspectRatio = modelDef?.defaultSettings.aspect_ratio ?? '1:1';
    }

    // Map to supported ratio or fallback
    if (!supportedImagenRatios.includes(aspectRatio)) {
      console.warn(`Aspect ratio ${aspectRatio} not supported by Imagen. Mapping to closest supported ratio.`);
      // Map unsupported ratios to closest supported ones
      if (aspectRatio === '2:3') aspectRatio = '3:4';
      else if (aspectRatio === '3:2') aspectRatio = '4:3';
      else if (aspectRatio === '21:9') aspectRatio = '16:9';
      else if (aspectRatio === '9:21') aspectRatio = '9:16';
      else aspectRatio = '1:1'; // Default fallback
    }
    input.aspect_ratio = aspectRatio;

    // Number of images (max 4 for Imagen)
    const numImages = settings.num_outputs ?? settings.numGenerations ?? modelDef?.defaultSettings.num_images ?? 1;
    input.num_images = Math.min(numImages, 4);

    // Seed (optional)
    if (settings.seed !== undefined && settings.seed !== -1) {
      input.seed = settings.seed;
    }

    // Negative prompt (only for Imagen 3)
    if (falModelId === 'fal-ai/imagen3' && settings.negative_prompt) {
      input.negative_prompt = settings.negative_prompt;
    }

    console.log("Mapped Imagen Input:", input);
    return input;
  }

  // Handle Stable Diffusion v3 Medium specifically
  if (falModelId === 'fal-ai/stable-diffusion-v3-medium') {
    // SD v3 Medium uses predefined image size enums
    if (settings.width && settings.height) {
      // Map common dimensions to SD v3 Medium enums
      const dimensionToEnum: Record<string, string> = {
        '1024x1024': 'square_hd',
        '1024x768': 'landscape_4_3',
        '768x1024': 'portrait_4_3',
        '1024x576': 'landscape_16_9',
        '576x1024': 'portrait_16_9',
        '512x512': 'square'
      };
      const key = `${settings.width}x${settings.height}`;
      input.image_size = dimensionToEnum[key] || 'square_hd';
    } else if (settings.image_size) {
      input.image_size = settings.image_size;
    } else {
      input.image_size = modelDef?.defaultSettings.image_size ?? 'square_hd';
    }
    
    // Standard SD v3 Medium settings (max 4 images)
    if (settings.negative_prompt) input.negative_prompt = settings.negative_prompt;
    const numImages = settings.num_outputs ?? settings.numGenerations ?? modelDef?.defaultSettings.num_outputs ?? 1;
    input.num_images = Math.min(numImages, 4);
    input.guidance_scale = settings.guidance_scale ?? settings.guidance ?? modelDef?.defaultSettings.guidance_scale ?? 5;
    input.num_inference_steps = settings.num_inference_steps ?? settings.steps ?? modelDef?.defaultSettings.num_inference_steps ?? 28;

    // Seed (optional) - don't send if -1
    if (settings.seed !== undefined && settings.seed !== -1) {
      input.seed = settings.seed;
    }
    if (settings.prompt_expansion !== undefined) input.prompt_expansion = settings.prompt_expansion;
    if (settings.enable_safety_checker !== undefined) input.enable_safety_checker = settings.enable_safety_checker;

    console.log("Mapped SD v3 Medium Input:", input);
    return input;
  }

  // Handle Stable Diffusion v3.5 Large specifically  
  if (falModelId === 'fal-ai/stable-diffusion-v35-large') {
    // SD v3.5 Large uses custom width/height or predefined enums
    if (settings.width && settings.height) {
      input.image_size = { width: settings.width, height: settings.height };
    } else if (settings.image_size) {
      input.image_size = settings.image_size;
    } else {
      input.image_size = { width: modelDef?.defaultSettings.width ?? 1024, height: modelDef?.defaultSettings.height ?? 1024 };
    }
    
    // Standard SD v3.5 Large settings (max 4 images)
    if (settings.negative_prompt) input.negative_prompt = settings.negative_prompt;
    const numImages = settings.num_outputs ?? settings.numGenerations ?? modelDef?.defaultSettings.num_outputs ?? 1;
    input.num_images = Math.min(numImages, 4);
    input.guidance_scale = settings.guidance_scale ?? settings.guidance ?? modelDef?.defaultSettings.guidance_scale ?? 3.5;
    input.num_inference_steps = settings.num_inference_steps ?? settings.steps ?? modelDef?.defaultSettings.num_inference_steps ?? 28;

    // Seed (optional) - don't send if -1
    if (settings.seed !== undefined && settings.seed !== -1) {
      input.seed = settings.seed;
    }
    if (settings.output_format) input.output_format = settings.output_format;
    if (settings.enable_safety_checker !== undefined) input.enable_safety_checker = settings.enable_safety_checker;

    // Advanced features for SD v3.5 Large
    if (settings.controlnet) input.controlnet = settings.controlnet;
    if (settings.ip_adapter) input.ip_adapter = settings.ip_adapter;
    if (settings.loras) input.loras = settings.loras;

    console.log("Mapped SD v3.5 Large Input:", input);
    return input;
  }

  // Handle Flux Pro v1.1-Ultra specifically
  if (falModelId === 'fal-ai/flux-pro/v1.1-ultra') {
    // Supported aspect ratios for Flux Pro v1.1-Ultra
    const supportedFluxUltraRatios = ['21:9', '16:9', '4:3', '3:4', '1:1', '9:16', '9:21'];

    // Flux Pro v1.1-Ultra uses aspect_ratio instead of image_size
    let aspectRatio = '16:9';
    if (settings.width && settings.height) {
      // Convert width/height to aspect ratio format
      aspectRatio = getAspectRatioFromDimensions(settings.width, settings.height);
    } else if (settings.aspect_ratio) {
      aspectRatio = settings.aspect_ratio;
    } else {
      aspectRatio = modelDef?.defaultSettings.aspect_ratio ?? '16:9';
    }

    // Map to supported ratio or fallback
    if (!supportedFluxUltraRatios.includes(aspectRatio)) {
      console.warn(`Aspect ratio ${aspectRatio} not supported by Flux Pro Ultra. Mapping to closest supported ratio.`);
      if (aspectRatio === '2:3') aspectRatio = '3:4';
      else if (aspectRatio === '3:2') aspectRatio = '4:3';
      else aspectRatio = '1:1';
    }
    input.aspect_ratio = aspectRatio;

    // Flux Pro v1.1-Ultra specific settings (max 4 images)
    const numImages = settings.num_outputs ?? settings.numGenerations ?? modelDef?.defaultSettings.num_outputs ?? 1;
    input.num_images = Math.min(numImages, 4);
    input.safety_tolerance = settings.safety_tolerance?.toString() ?? modelDef?.defaultSettings.safety_tolerance ?? '2';
    input.output_format = settings.output_format ?? modelDef?.defaultSettings.output_format ?? 'jpeg';
    input.raw = settings.raw ?? modelDef?.defaultSettings.raw ?? false;

    // Seed (optional) - don't send if -1
    if (settings.seed !== undefined && settings.seed !== -1) {
      input.seed = settings.seed;
    }
    if (settings.enable_safety_checker !== undefined) input.enable_safety_checker = settings.enable_safety_checker;

    console.log("Mapped Flux Pro v1.1-Ultra Input:", input);
    return input;
  }

  // Handle Flux Dev specifically
  if (falModelId === 'fal-ai/flux/dev') {
    // Flux Dev uses image_size similar to SD models
    if (settings.width && settings.height) {
      // Map common dimensions to Flux Dev enums or use custom size
      const dimensionToEnum: Record<string, string> = {
        '1024x1024': 'square_hd',
        '1024x768': 'landscape_4_3',
        '768x1024': 'portrait_4_3',
        '1024x576': 'landscape_16_9',
        '576x1024': 'portrait_16_9',
        '512x512': 'square'
      };
      const key = `${settings.width}x${settings.height}`;
      if (dimensionToEnum[key]) {
        input.image_size = dimensionToEnum[key];
      } else {
        // Use custom size object for non-standard dimensions
        input.image_size = { width: settings.width, height: settings.height };
      }
    } else if (settings.image_size) {
      input.image_size = settings.image_size;
    } else {
      input.image_size = modelDef?.defaultSettings.image_size ?? 'landscape_4_3';
    }
    
    // Flux Dev settings (max 4 images)
    const numImages = settings.num_outputs ?? settings.numGenerations ?? modelDef?.defaultSettings.num_outputs ?? 1;
    input.num_images = Math.min(numImages, 4);
    input.guidance_scale = settings.guidance_scale ?? settings.guidance ?? modelDef?.defaultSettings.guidance_scale ?? 3.5;
    input.num_inference_steps = settings.num_inference_steps ?? settings.steps ?? modelDef?.defaultSettings.num_inference_steps ?? 28;

    // Seed (optional) - don't send if -1
    if (settings.seed !== undefined && settings.seed !== -1) {
      input.seed = settings.seed;
    }
    if (settings.enable_safety_checker !== undefined) input.enable_safety_checker = settings.enable_safety_checker;

    console.log("Mapped Flux Dev Input:", input);
    return input;
  }

  // Handle Luma Photon Flash specifically
  if (falModelId === 'fal-ai/luma-photon/flash') {
    // Supported aspect ratios for Luma Photon Flash
    const supportedLumaRatios = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'];

    // Luma Photon Flash uses aspect_ratio instead of width/height
    let aspectRatio = '1:1';
    if (settings.width && settings.height) {
      // Convert width/height to aspect ratio format
      aspectRatio = getAspectRatioFromDimensions(settings.width, settings.height);
    } else if (settings.aspect_ratio) {
      aspectRatio = settings.aspect_ratio;
    } else {
      aspectRatio = modelDef?.defaultSettings.aspect_ratio ?? '1:1';
    }

    // Map to supported ratio or fallback
    if (!supportedLumaRatios.includes(aspectRatio)) {
      console.warn(`Aspect ratio ${aspectRatio} not supported by Luma Photon. Mapping to closest supported ratio.`);
      if (aspectRatio === '2:3') aspectRatio = '3:4';
      else if (aspectRatio === '3:2') aspectRatio = '4:3';
      else aspectRatio = '1:1';
    }
    input.aspect_ratio = aspectRatio;

    // Number of outputs (max 4)
    const numOutputs = settings.num_outputs ?? settings.numGenerations ?? modelDef?.defaultSettings.num_outputs ?? 1;
    input.num_outputs = Math.min(numOutputs, 4);

    // Seed (optional) - don't send if -1
    if (settings.seed !== undefined && settings.seed !== -1) {
      input.seed = settings.seed;
    }

    // Luma Photon native style/character reference support
    if (settings.style_reference_url) {
      input.style_reference_url = settings.style_reference_url;
      input.style_reference_weight = settings.style_reference_weight ?? 0.85;
      console.log('[Luma Photon] Using style reference:', settings.style_reference_url, 'weight:', input.style_reference_weight);
    }

    if (settings.character_reference_url) {
      input.character_reference_url = settings.character_reference_url;
      console.log('[Luma Photon] Using character reference:', settings.character_reference_url);
    }

    // Image reference for image-to-image
    if (settings.image_url && !settings.style_reference_url && !settings.character_reference_url) {
      input.image_reference_url = settings.image_url;
      input.image_reference_weight = settings.image_reference_weight ?? 0.85;
      console.log('[Luma Photon] Using image reference:', settings.image_url);
    }

    console.log("Mapped Luma Photon Flash Input:", input);
    return input;
  }

  // Handle Recraft V3 specifically
  if (falModelId === 'fal-ai/recraft/v3/text-to-image') {
    // Recraft V3 uses image_size (predefined enums or custom dimensions)
    if (settings.width && settings.height) {
      // Map common dimensions to Recraft V3 enums or use custom size
      const dimensionToEnum: Record<string, string> = {
        '1024x1024': 'square_hd',
        '512x512': 'square',
        '768x1024': 'portrait_4_3',
        '576x1024': 'portrait_16_9',
        '1024x768': 'landscape_4_3',
        '1024x576': 'landscape_16_9'
      };
      const key = `${settings.width}x${settings.height}`;
      if (dimensionToEnum[key]) {
        input.image_size = dimensionToEnum[key];
      } else {
        // Use custom size object for non-standard dimensions
        input.image_size = { width: settings.width, height: settings.height };
      }
    } else if (settings.image_size) {
      input.image_size = settings.image_size;
    } else {
      input.image_size = modelDef?.defaultSettings.image_size ?? 'square_hd';
    }
    
    // Recraft V3 specific settings (max 4 images)
    const numOutputs = settings.num_outputs ?? settings.numGenerations ?? modelDef?.defaultSettings.num_outputs ?? 1;
    input.num_outputs = Math.min(numOutputs, 4);
    input.style = settings.style ?? modelDef?.defaultSettings.style ?? 'realistic_image';
    input.enable_safety_checker = settings.enable_safety_checker ?? modelDef?.defaultSettings.enable_safety_checker ?? false;

    // Seed (optional) - don't send if -1
    if (settings.seed !== undefined && settings.seed !== -1) {
      input.seed = settings.seed;
    }

    // Handle colors array if provided
    if (settings.colors && Array.isArray(settings.colors)) {
      input.colors = settings.colors;
    } else {
      input.colors = modelDef?.defaultSettings.colors ?? [];
    }

    // Handle style_id if provided
    if (settings.style_id) {
      input.style_id = settings.style_id;
    }

    console.log("Mapped Recraft V3 Input:", input);
    return input;
  }

  // Handle Ideogram V3 specifically
  if (falModelId === 'fal-ai/ideogram/v3') {
    // Ideogram V3 uses image_size (predefined enums or custom dimensions)
    if (settings.width && settings.height) {
      // Map common dimensions to Ideogram V3 enums or use custom size
      const dimensionToEnum: Record<string, string> = {
        '1024x1024': 'square_hd',
        '512x512': 'square',
        '768x1024': 'portrait_4_3',
        '576x1024': 'portrait_16_9',
        '1024x768': 'landscape_4_3',
        '1024x576': 'landscape_16_9'
      };
      const key = `${settings.width}x${settings.height}`;
      if (dimensionToEnum[key]) {
        input.image_size = dimensionToEnum[key];
      } else {
        // Use custom size object for non-standard dimensions
        input.image_size = { width: settings.width, height: settings.height };
      }
    } else if (settings.image_size) {
      input.image_size = settings.image_size;
    } else {
      input.image_size = modelDef?.defaultSettings.image_size ?? 'square_hd';
    }
    
    // Ideogram V3 specific settings (max 4 images)
    const numImages = settings.num_outputs ?? settings.numGenerations ?? modelDef?.defaultSettings.num_images ?? 1;
    input.num_images = Math.min(numImages, 4);
    input.style = settings.style ?? modelDef?.defaultSettings.style ?? 'AUTO';
    input.expand_prompt = settings.expand_prompt ?? modelDef?.defaultSettings.expand_prompt ?? true;
    input.rendering_speed = settings.rendering_speed ?? modelDef?.defaultSettings.rendering_speed ?? 'BALANCED';
    input.negative_prompt = settings.negative_prompt ?? modelDef?.defaultSettings.negative_prompt ?? '';

    // Seed (optional) - don't send if -1
    if (settings.seed !== undefined && settings.seed !== -1) {
      input.seed = settings.seed;
    }

    // Handle style reference images (Ideogram V3 native support)
    // Priority: style_reference_url > image_urls > image_url
    if (settings.style_reference_url) {
      // Ideogram V3 uses image_urls for style references
      input.image_urls = [settings.style_reference_url];
      console.log('[Ideogram V3] Using style reference:', settings.style_reference_url);
    } else if (settings.image_urls && Array.isArray(settings.image_urls)) {
      input.image_urls = settings.image_urls;
    } else if (settings.image_url) {
      input.image_urls = [settings.image_url];
    }

    // Handle color palette
    if (settings.color_palette) {
      input.color_palette = settings.color_palette;
    }

    // Handle style codes
    if (settings.style_codes && Array.isArray(settings.style_codes)) {
      input.style_codes = settings.style_codes;
    }

    console.log("Mapped Ideogram V3 Input:", input);
    return input;
  }

  // Handle Ideogram V2a Turbo specifically
  if (falModelId === 'fal-ai/ideogram/v2a/turbo') {
    // Supported aspect ratios for Ideogram V2a Turbo
    const supportedIdeogramV2aRatios = ['10:16', '16:10', '9:16', '16:9', '4:3', '3:4', '1:1', '1:3', '3:1', '3:2', '2:3'];

    // Ideogram V2a Turbo uses aspect_ratio instead of width/height
    let aspectRatio = '1:1';
    if (settings.width && settings.height) {
      // Convert width/height to aspect ratio format
      aspectRatio = getAspectRatioFromDimensions(settings.width, settings.height);
    } else if (settings.aspect_ratio) {
      aspectRatio = settings.aspect_ratio;
    } else {
      aspectRatio = modelDef?.defaultSettings.aspect_ratio ?? '1:1';
    }

    // Map to supported ratio or fallback
    if (!supportedIdeogramV2aRatios.includes(aspectRatio)) {
      console.warn(`Aspect ratio ${aspectRatio} not supported by Ideogram V2a Turbo. Mapping to closest supported ratio.`);
      if (aspectRatio === '21:9') aspectRatio = '16:9';
      else if (aspectRatio === '9:21') aspectRatio = '9:16';
      else aspectRatio = '1:1';
    }
    input.aspect_ratio = aspectRatio;

    // Number of outputs (max 8 for Ideogram V2a)
    const numOutputs = settings.num_outputs ?? settings.numGenerations ?? modelDef?.defaultSettings.num_outputs ?? 1;
    input.num_outputs = Math.min(numOutputs, 8);

    // Ideogram V2a Turbo specific settings
    input.style = settings.style ?? modelDef?.defaultSettings.style ?? 'auto';
    input.expand_prompt = settings.expand_prompt ?? modelDef?.defaultSettings.expand_prompt ?? true;

    // Seed (optional) - don't send if -1
    if (settings.seed !== undefined && settings.seed !== -1) {
      input.seed = settings.seed;
    }

    console.log("Mapped Ideogram V2a Turbo Input:", input);
    return input;
  }

  // ============================================
  // IMAGE-TO-IMAGE MODEL HANDLERS
  // ============================================

  // Handle Flux Dev Image-to-Image
  if (falModelId === 'fal-ai/flux/dev/image-to-image') {
    // Required: image_url
    if (settings.image_url) {
      input.image_url = settings.image_url;
    } else if (settings.image_urls && settings.image_urls.length > 0) {
      input.image_url = settings.image_urls[0];
    }

    // Strength controls how much the output differs from input (0-1)
    input.strength = settings.strength ?? modelDef?.defaultSettings.strength ?? 0.85;
    const numImages = settings.num_outputs ?? settings.numGenerations ?? modelDef?.defaultSettings.num_outputs ?? 1;
    input.num_images = Math.min(numImages, 4);
    input.guidance_scale = settings.guidance_scale ?? modelDef?.defaultSettings.guidance_scale ?? 3.5;
    input.num_inference_steps = settings.num_inference_steps ?? modelDef?.defaultSettings.num_inference_steps ?? 28;
    input.output_format = settings.output_format ?? modelDef?.defaultSettings.output_format ?? 'jpeg';

    // Seed (optional) - don't send if -1
    if (settings.seed !== undefined && settings.seed !== -1) {
      input.seed = settings.seed;
    }
    if (settings.enable_safety_checker !== undefined) input.enable_safety_checker = settings.enable_safety_checker;

    console.log("Mapped Flux Dev Image-to-Image Input:", input);
    return input;
  }

  // Handle Stable Diffusion V3 Medium Image-to-Image
  if (falModelId === 'fal-ai/stable-diffusion-v3-medium/image-to-image') {
    // Required: image_url
    if (settings.image_url) {
      input.image_url = settings.image_url;
    } else if (settings.image_urls && settings.image_urls.length > 0) {
      input.image_url = settings.image_urls[0];
    }

    // Strength of the transformation (0-1)
    input.strength = settings.strength ?? modelDef?.defaultSettings.strength ?? 0.9;
    const numImages = settings.num_outputs ?? settings.numGenerations ?? modelDef?.defaultSettings.num_outputs ?? 1;
    input.num_images = Math.min(numImages, 4);
    input.guidance_scale = settings.guidance_scale ?? modelDef?.defaultSettings.guidance_scale ?? 5;
    input.num_inference_steps = settings.num_inference_steps ?? modelDef?.defaultSettings.num_inference_steps ?? 28;

    if (settings.negative_prompt) input.negative_prompt = settings.negative_prompt;
    // Seed (optional) - don't send if -1
    if (settings.seed !== undefined && settings.seed !== -1) {
      input.seed = settings.seed;
    }
    if (settings.enable_safety_checker !== undefined) input.enable_safety_checker = settings.enable_safety_checker;

    console.log("Mapped SD V3 Medium Image-to-Image Input:", input);
    return input;
  }

  // Handle Recraft V3 Image-to-Image
  if (falModelId === 'fal-ai/recraft/v3/image-to-image') {
    // Required: image_url
    if (settings.image_url) {
      input.image_url = settings.image_url;
    } else if (settings.image_urls && settings.image_urls.length > 0) {
      input.image_url = settings.image_urls[0];
    }

    // Difference controls how much the output differs from input (0-1)
    input.difference = settings.difference ?? settings.strength ?? modelDef?.defaultSettings.difference ?? 0.5;
    const numOutputs = settings.num_outputs ?? settings.numGenerations ?? modelDef?.defaultSettings.num_outputs ?? 1;
    input.n = Math.min(numOutputs, 4);

    // Seed (optional) - don't send if -1
    if (settings.seed !== undefined && settings.seed !== -1) {
      input.seed = settings.seed;
    }

    console.log("Mapped Recraft V3 Image-to-Image Input:", input);
    return input;
  }

  // Existing logic for other models (fallback)
  if (settings.negative_prompt) input.negative_prompt = settings.negative_prompt;
  const numImagesFallback = settings.num_outputs ?? settings.numGenerations ?? modelDef?.defaultSettings.num_outputs ?? 1;
  input.num_images = Math.min(numImagesFallback, 4);
  // Seed (optional) - don't send if -1
  if (settings.seed !== undefined && settings.seed !== -1) {
    input.seed = settings.seed;
  }
  input.guidance_scale = settings.guidance_scale ?? settings.guidance ?? modelDef?.defaultSettings.guidance_scale;
  input.num_inference_steps = settings.num_inference_steps ?? settings.steps ?? modelDef?.defaultSettings.num_inference_steps;

  if (settings.width && settings.height) {
      input.image_size = { width: settings.width, height: settings.height };
  } else if (settings.image_size) {
    input.image_size = settings.image_size;
  } else if (settings.resolution) {
    const parts = settings.resolution.toLowerCase().split('x');
    if (parts.length === 2) {
      const width = parseInt(parts[0], 10);
      const height = parseInt(parts[1], 10);
      if (!isNaN(width) && !isNaN(height)) {
          input.image_size = { width, height };
      } else {
        console.warn(`Could not parse resolution: ${settings.resolution}. Using default size.`);
        input.image_size = modelDef?.defaultSettings.image_size;
      }
    } else {
      console.warn(`Invalid resolution format: ${settings.resolution}. Using default size.`);
      input.image_size = modelDef?.defaultSettings.image_size;
    }
  } else {
    input.image_size = modelDef?.defaultSettings.image_size ?? ((modelDef?.defaultSettings.width && modelDef?.defaultSettings.height) ? { width: modelDef.defaultSettings.width, height: modelDef.defaultSettings.height } : undefined);
  }

  if (modelDef?.isImageToImage) {
    if (settings.image_url) {
      input.image_url = settings.image_url;
    } else if (settings.inputImage && settings.inputImage.startsWith('http')) {
      input.image_url = settings.inputImage;
    } else {
      console.error(`Model ${falModelId} requires an image_url, but none was provided.`);
    }
    if (settings.strength !== undefined) {
      input.strength = settings.strength;
    } else {
      input.strength = modelDef?.defaultSettings.strength;
    }
  }

  if (settings.output_format) input.output_format = settings.output_format;
  if (settings.controlnet) input.controlnet = settings.controlnet;
  if (settings.ip_adapter) input.ip_adapter = settings.ip_adapter;
  if (settings.loras) input.loras = settings.loras;

  console.log("Mapped Fal Input:", input);
  return input;
}

// Helper function to convert width/height to aspect ratio string
function getAspectRatioFromDimensions(width: number, height: number): string {
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  const ratioW = width / divisor;
  const ratioH = height / divisor;
  
  // Map common ratios to expected format
  const commonRatios: Record<string, string> = {
    '1:1': '1:1',
    '4:3': '4:3',
    '3:4': '3:4',
    '16:9': '16:9',
    '9:16': '9:16',
    '3:2': '3:2',
    '2:3': '2:3'
  };
  
  const ratioKey = `${ratioW}:${ratioH}`;
  return commonRatios[ratioKey] || ratioKey;
}

async function generateImage(
  modelId: string,
  settings: ImageModelSettings,
  onQueueUpdate?: QueueUpdateCallback
): Promise<ImageGenerationResponse> {
  const modelDefinition = modelRegistry[modelId];

  if (!modelDefinition) {
    console.error(`Model ${modelId} not found in registry.`);
    return { success: false, error: `Model ${modelId} not found.`, images: [] };
  }

  const mergedSettings: ImageModelSettings = {
    ...modelDefinition.defaultSettings,
    ...settings,
    modelId: modelId,
  };

  const startTime = Date.now();

  // Vision-to-Prompt fallback for models without native style/character reference support
  try {
    // Style reference fallback
    if (mergedSettings.style_reference_url && !modelDefinition.supportsStyleReference) {
      console.log(`[V2P] Model ${modelId} doesn't support native style reference, using Vision-to-Prompt...`);
      try {
        mergedSettings.prompt = await visionReferenceService.enhancePromptWithStyle(
          mergedSettings.prompt || '',
          mergedSettings.style_reference_url
        );
        console.log(`[V2P] Enhanced prompt with style: ${mergedSettings.prompt?.substring(0, 100)}...`);
      } catch (error) {
        console.warn('[V2P] Failed to enhance with style, using original prompt:', error);
      }
    }

    // Character reference fallback
    if (mergedSettings.character_reference_url && !modelDefinition.supportsCharacterReference) {
      console.log(`[V2P] Model ${modelId} doesn't support native character reference, using Vision-to-Prompt...`);
      try {
        mergedSettings.prompt = await visionReferenceService.enhancePromptWithCharacter(
          mergedSettings.prompt || '',
          mergedSettings.character_reference_url
        );
        console.log(`[V2P] Enhanced prompt with character: ${mergedSettings.prompt?.substring(0, 100)}...`);
      } catch (error) {
        console.warn('[V2P] Failed to enhance with character, using original prompt:', error);
      }
    }
  } catch (v2pError) {
    console.warn('[V2P] Vision-to-Prompt fallback failed:', v2pError);
  }

  try {
    if (modelDefinition.provider === 'fal') {
      if (!FAL_KEY) {
        return { success: false, error: "Fal AI key (VITE_FAL_KEY) is not configured.", images: [] };
      }
      if (!modelDefinition.falModelId) {
        return { success: false, error: `Fal model ID missing for ${modelId}.`, images: [] };
      }

      const falInput = mapSettingsToFalInput(mergedSettings, modelDefinition.falModelId);

      if (modelDefinition.isImageToImage && !falInput.image_url) {
        return { success: false, error: `Model ${modelId} requires an input image URL ('image_url').`, images: [] };
      }
      if (!falInput.prompt) {
        return { success: false, error: `Model ${modelId} requires a prompt.`, images: [] };
      }

      let result: any;
      if (onQueueUpdate) {
        // Revert back to original implementation
        // @ts-ignore - Suppress error due to potential typing issue
        result = await fal.subscribe(modelDefinition.falModelId, {
          input: falInput,
          logs: true,
          onQueueUpdate: (update: any) => { // Explicitly type 'update' as any
            onQueueUpdate(update); // Pass it to the user-provided callback
          },
        });
      } else {
        // Revert back to original implementation
        // @ts-ignore - Suppress error due to potential typing issue
        result = await fal.run(modelDefinition.falModelId, { input: falInput });
      }

      // Calculate generation time
      const generationTime = (Date.now() - startTime) / 1000;

      // Check for new response format with data property
      if (result?.data) {
        
        // Handle the new response format
        if (result.data.images && Array.isArray(result.data.images)) {
          const outputImages: GeneratedImage[] = result.data.images.map((img: any) => ({
            url: img.url || img.image_url,
            seed: result.data.seed || falInput.seed,
            has_nsfw_concept: img.has_nsfw_concept || false,
            latency: generationTime
          }));
          
          return {
            success: true,
            images: outputImages,
            metadata: {
              generationTime,
              requestId: result.requestId,
              modelVersion: modelDefinition.falModelId,
              falInput,
              falResult: result
            }
          };
        }
      }
      
      // Fall back to old format checking
      if (!result || !Array.isArray(result.images) || result.images.length === 0) {
        console.error('Invalid response structure from Fal.ai:', result);
        return {
          success: false,
          error: 'Received invalid response or no images from Fal.ai.',
          images: [],
          metadata: { falInput, falResult: result }
        };
      }

      const outputImages: GeneratedImage[] = result.images.map((img: any) => ({
        url: img.url,
        seed: result.seed,
        has_nsfw_concept: img.has_nsfw_concept,
        latency: generationTime
      }));

      return {
        success: true,
        images: outputImages,
        metadata: {
          generationTime,
          modelVersion: modelDefinition.falModelId,
          seed: result.seed,
          falInput: falInput,
          falResult: result,
        },
      };

    } else if (modelDefinition.provider === 'gemini') {
      console.log('Calling Gemini service with settings:', mergedSettings);
      // --- Placeholder for Gemini Integration ---
      // Assuming a function for Gemini image generation needs to be implemented/called from geminiService.ts
      // const geminiResponse = await <gemini_generation_function>(mergedSettings.prompt || '', mergedSettings);
      // return geminiResponse; 

      // Temporary response until Gemini path is implemented
      return {
        success: false,
        error: 'Gemini image generation not yet implemented in this service.',
        images: [],
        metadata: {
          generationTime: (Date.now() - startTime) / 1000,
        }
      }

    } else {
      return { success: false, error: `Unsupported provider: ${modelDefinition.provider}`, images: [] };
    }
  } catch (error: any) {
    console.error(`Error generating image with ${modelId}:`, error);
    const generationTime = (Date.now() - startTime) / 1000;
    return {
      success: false,
      error: error.message || 'An unknown error occurred',
      images: [],
      metadata: {
        generationTime,
        falInput: modelDefinition.provider === 'fal' ? mapSettingsToFalInput(mergedSettings, modelDefinition.falModelId!) : undefined,
        falResult: error.response?.data,
      }
    };
  }
}

// Export service object inline to avoid initialization issues
export default {
  generateImage,
  modelRegistry,
  getModelDefaults: (modelId: string): Partial<ImageModelSettings> | undefined => {
    return modelRegistry[modelId]?.defaultSettings;
  }
};
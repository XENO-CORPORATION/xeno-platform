import {
  ImageModelSettings,
  ImageGenerationResponse,
  GeneratedImage
} from '../components/nodes/image-models/ImageModelInterface';
import { visionReferenceService } from './visionReferenceService';
import { postXenoRequest } from './xenoProxyRequest';

interface ModelDefinition {
  provider: 'xeno' | 'gemini';
  xenoModelId?: string;
  isImageToImage?: boolean;
  supportsStyleReference?: boolean;
  supportsCharacterReference?: boolean;
  supportsImageReference?: boolean;
  defaultSettings: Partial<ImageModelSettings>;
  schema?: any;
}

type QueueUpdateCallback = (update: any) => void;

const modelRegistry: Record<string, ModelDefinition> = {
  'fal-ai/stable-diffusion-v3-medium': {
    provider: 'xeno',
    xenoModelId: 'classic',
    isImageToImage: false,
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
    provider: 'xeno',
    xenoModelId: 'classic',
    isImageToImage: false,
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
    provider: 'xeno',
    xenoModelId: 'flux-pro-plus',
    isImageToImage: false,
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
    provider: 'xeno',
    xenoModelId: 'flux-dev',
    isImageToImage: false,
    defaultSettings: {
      image_size: 'landscape_4_3',
      num_outputs: 1,
      guidance_scale: 3.5,
      num_inference_steps: 28,
      seed: undefined,
    },
  },
  'fal-ai/flux/schnell': {
    provider: 'xeno',
    xenoModelId: 'fast',
    isImageToImage: false,
    defaultSettings: {
      image_size: 'landscape_4_3',
      num_outputs: 1,
      seed: undefined,
    },
  },
  'fal-ai/imagen3': {
    provider: 'xeno',
    xenoModelId: 'imagen3',
    isImageToImage: false,
    defaultSettings: {
      aspect_ratio: '1:1',
      num_images: 1,
      negative_prompt: '',
      seed: undefined,
    },
  },
  'fal-ai/imagen4/preview': {
    provider: 'xeno',
    xenoModelId: 'imagen4',
    isImageToImage: false,
    defaultSettings: {
      aspect_ratio: '1:1',
      num_images: 1,
      negative_prompt: '',
      seed: undefined,
    },
  },
  'fal-ai/luma-photon/flash': {
    provider: 'xeno',
    xenoModelId: 'fast',
    isImageToImage: false,
    supportsStyleReference: true,
    supportsCharacterReference: true,
    supportsImageReference: true,
    defaultSettings: {
      aspect_ratio: '1:1',
      num_outputs: 1,
      seed: undefined,
    },
  },
  'fal-ai/recraft/v3/text-to-image': {
    provider: 'xeno',
    xenoModelId: 'auto',
    isImageToImage: false,
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
    provider: 'xeno',
    xenoModelId: 'ideogram',
    isImageToImage: true,
    supportsStyleReference: true,
    supportsCharacterReference: false,
    supportsImageReference: true,
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
    provider: 'xeno',
    xenoModelId: 'ideogram',
    isImageToImage: false,
    defaultSettings: {
      aspect_ratio: '1:1',
      style: 'auto',
      expand_prompt: true,
      num_outputs: 1,
      seed: undefined,
    },
  },
  'fal-ai/bytedance/seedream/v4.5/text-to-image': {
    provider: 'xeno',
    xenoModelId: 'seedream-4-5',
    isImageToImage: false,
    defaultSettings: {
      image_size: 'square_hd',
      num_outputs: 1,
      seed: undefined,
    },
  },
  'fal-ai/bytedance/seedream/v4/text-to-image': {
    provider: 'xeno',
    xenoModelId: 'auto',
    isImageToImage: false,
    defaultSettings: {
      image_size: 'square_hd',
      num_outputs: 1,
      seed: undefined,
    },
  },
  'fal-ai/z-image/turbo': {
    provider: 'xeno',
    xenoModelId: 'auto',
    isImageToImage: false,
    defaultSettings: {
      image_size: 'square_hd',
      num_outputs: 1,
      seed: undefined,
    },
  },
  'fal-ai/omnigen-v1': {
    provider: 'xeno',
    xenoModelId: 'auto',
    isImageToImage: false,
    defaultSettings: {
      num_outputs: 1,
      seed: undefined,
    },
  },
  'fal-ai/flux/dev/image-to-image': {
    provider: 'xeno',
    xenoModelId: 'flux-dev',
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
  'fal-ai/stable-diffusion-v3-medium/image-to-image': {
    provider: 'xeno',
    xenoModelId: 'classic',
    isImageToImage: true,
    defaultSettings: {
      strength: 0.9,
      num_outputs: 1,
      guidance_scale: 5,
      num_inference_steps: 28,
      seed: undefined,
    },
  },
  'fal-ai/recraft/v3/image-to-image': {
    provider: 'xeno',
    xenoModelId: 'auto',
    isImageToImage: true,
    defaultSettings: {
      difference: 0.5,
      num_outputs: 1,
      seed: undefined,
    },
  },
};

function mapSettingsToXenoInput(settings: ImageModelSettings, xenoModelId: string): Record<string, any> {
  const input: Record<string, any> = {};
  const modelDef = modelRegistry[Object.keys(modelRegistry).find(key => modelRegistry[key].xenoModelId === xenoModelId) || ''];

  if (settings.prompt) input.prompt = settings.prompt;

  if (settings.negative_prompt) input.negative_prompt = settings.negative_prompt;

  if (settings.width && settings.height) {
    input.width = settings.width;
    input.height = settings.height;
  } else if (settings.aspect_ratio) {
    const aspectToDimensions: Record<string, [number, number]> = {
      '1:1': [1024, 1024],
      '16:9': [1920, 1080],
      '9:16': [1080, 1920],
      '4:3': [1024, 768],
      '3:4': [768, 1024],
      '3:2': [1024, 683],
      '2:3': [683, 1024],
      '21:9': [2560, 1080],
      '9:21': [1080, 2560],
    };
    const [width, height] = aspectToDimensions[settings.aspect_ratio] || [1024, 1024];
    input.width = width;
    input.height = height;
  } else if (settings.image_size) {
    const sizeMap: Record<string, [number, number]> = {
      'square': [512, 512],
      'square_hd': [1024, 1024],
      'portrait_4_3': [768, 1024],
      'portrait_16_9': [576, 1024],
      'landscape_4_3': [1024, 768],
      'landscape_16_9': [1024, 576],
    };
    const [width, height] = sizeMap[settings.image_size] || [1024, 1024];
    input.width = width;
    input.height = height;
  }

  if (settings.guidance_scale !== undefined) {
    input.guidance_scale = settings.guidance_scale;
  } else if (settings.guidance !== undefined) {
    input.guidance_scale = settings.guidance;
  }

  if (settings.num_inference_steps !== undefined) {
    input.steps = settings.num_inference_steps;
  } else if (settings.steps !== undefined) {
    input.steps = settings.steps;
  }

  if (settings.seed !== undefined && settings.seed !== -1) {
    input.seed = settings.seed;
  }

  const numOutputs = settings.num_outputs ?? settings.numGenerations ?? settings.num_images ?? 1;
  input.n = Math.min(numOutputs, 4);

  return input;
}

function getAspectRatioFromDimensions(width: number, height: number): string {
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  const ratioW = width / divisor;
  const ratioH = height / divisor;

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

  try {
    if (mergedSettings.style_reference_url && !modelDefinition.supportsStyleReference) {
      try {
        mergedSettings.prompt = await visionReferenceService.enhancePromptWithStyle(
          mergedSettings.prompt || '',
          mergedSettings.style_reference_url
        );
      } catch (error) {
        console.warn('[V2P] Failed to enhance with style, using original prompt:', error);
      }
    }

    if (mergedSettings.character_reference_url && !modelDefinition.supportsCharacterReference) {
      try {
        mergedSettings.prompt = await visionReferenceService.enhancePromptWithCharacter(
          mergedSettings.prompt || '',
          mergedSettings.character_reference_url
        );
      } catch (error) {
        console.warn('[V2P] Failed to enhance with character, using original prompt:', error);
      }
    }
  } catch (v2pError) {
    console.warn('[V2P] Vision-to-Prompt fallback failed:', v2pError);
  }

  try {
    if (modelDefinition.provider === 'xeno') {
      if (!modelDefinition.xenoModelId) {
        return { success: false, error: `Xeno model ID missing for ${modelId}.`, images: [] };
      }

      const xenoInput = mapSettingsToXenoInput(mergedSettings, modelDefinition.xenoModelId);

      if (!xenoInput.prompt) {
        return { success: false, error: `Model ${modelId} requires a prompt.`, images: [] };
      }

      if (onQueueUpdate) {
        onQueueUpdate({ status: 'IN_PROGRESS' });
      }

      const result = await postXenoRequest('/images/generate', {
        ...xenoInput,
        model: modelDefinition.xenoModelId,
      });

      const generationTime = (Date.now() - startTime) / 1000;

      if (onQueueUpdate) {
        onQueueUpdate({ status: 'COMPLETED' });
      }

      if (!result || !result.data || result.data.length === 0) {
        console.error('Invalid response structure from Xeno AI:', result);
        return {
          success: false,
          error: 'Received invalid response or no images from Xeno AI.',
          images: [],
          metadata: { xenoInput, xenoResult: result }
        };
      }

      const outputImages: GeneratedImage[] = result.data.map((img: any) => ({
        url: img.url || img.b64_json,
        seed: xenoInput.seed,
        has_nsfw_concept: false,
        latency: generationTime
      }));

      return {
        success: true,
        images: outputImages,
        metadata: {
          generationTime,
          modelVersion: modelDefinition.xenoModelId,
          seed: xenoInput.seed,
          xenoInput: xenoInput,
          xenoResult: result,
        },
      };

    } else if (modelDefinition.provider === 'gemini') {
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

    if (onQueueUpdate) {
      onQueueUpdate({ status: 'FAILED', error: error.message });
    }

    return {
      success: false,
      error: error.message || 'An unknown error occurred',
      images: [],
      metadata: {
        generationTime,
        xenoInput: modelDefinition.provider === 'xeno' ? mapSettingsToXenoInput(mergedSettings, modelDefinition.xenoModelId!) : undefined,
        xenoResult: error.response?.data,
      }
    };
  }
}

export default {
  generateImage,
  modelRegistry,
  getModelDefaults: (modelId: string): Partial<ImageModelSettings> | undefined => {
    return modelRegistry[modelId]?.defaultSettings;
  }
};

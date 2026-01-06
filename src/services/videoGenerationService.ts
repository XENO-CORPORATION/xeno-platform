// Import statements first
import * as falImport from '@fal-ai/client';
import minimaxVideo01LiveSchema from '../components/playground/Generation/Minimax/minimax-video-01-live-schema.json';
import veo2Schema from '../components/playground/Generation/Google/veo2-schema.json';
import wanT2vSchema from '../components/playground/Generation/Wan/wan-t2v-schema.json';
import hunyuanVideoSchema from '../components/playground/Generation/Hunyuan/hunyuan-video-schema.json';
import lumaDreamMachineRay2Schema from '../components/playground/Generation/Luma/luma-dream-machine-ray-2-schema.json';
import pikaV22TextToVideoSchema from '../components/playground/Generation/Pika/pika-v2.2-text-to-video-schema.json';
import klingVideoV16ProImageToVideoSchema from '../components/playground/Generation/Kling/kling-video-v1.6-pro-image-to-video-schema.json';
import klingVideoV2MasterImageToVideoSchema from '../components/playground/Generation/Kling/kling-video-v2-master-image-to-video-schema.json';

// Video model interfaces
export interface VideoModelSettings {
  prompt: string;
  prompt_optimizer?: boolean;
  duration?: number | string;
  fps?: number;
  width?: number;
  height?: number;
  aspect_ratio?: string;
  seed?: number;
  num_outputs?: number;
  [key: string]: any; // Allow for model-specific settings
}

export interface GeneratedVideo {
  url: string;
  seed?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

export interface VideoGenerationResponse {
  success: boolean;
  error?: string;
  videos: GeneratedVideo[];
  metadata?: {
    generationTime?: number;
    modelVersion?: string;
    falInput?: Record<string, any>;
    falResult?: any;
    [key: string]: any;
  };
}

// Get environment variables
const FAL_KEY = import.meta.env.VITE_FAL_KEY;

// Initialize the fal client properly
const { createFalClient } = falImport;
const fal = createFalClient({
  credentials: FAL_KEY,
});

console.log("Initialized Fal.ai client for video generation:", fal);

interface VideoModelDefinition {
  provider: 'fal';
  falModelId: string;
  isTextToVideo?: boolean;
  isImageToVideo?: boolean;
  defaultSettings: Partial<VideoModelSettings>;
  schema?: any;
}

type QueueUpdateCallback = (update: any) => void;

if (!FAL_KEY) {
  console.warn('Fal AI key (VITE_FAL_KEY) is not set. Fal.ai video models will not work.');
}

const videoModelRegistry: Record<string, VideoModelDefinition> = {
  'fal-ai/minimax/video-01-live': {
    provider: 'fal',
    falModelId: 'fal-ai/minimax/video-01-live',
    isTextToVideo: true,
    isImageToVideo: false,
    schema: minimaxVideo01LiveSchema,
    defaultSettings: {
      prompt_optimizer: true,
      num_outputs: 1,
      seed: undefined,
    },
  },
  'fal-ai/veo2': {
    provider: 'fal',
    falModelId: 'fal-ai/veo2',
    isTextToVideo: true,
    isImageToVideo: false,
    schema: veo2Schema,
    defaultSettings: {
      duration: '5s',
      aspect_ratio: '16:9',
      num_outputs: 1,
    },
  },
  'fal-ai/wan-t2v': {
    provider: 'fal',
    falModelId: 'fal-ai/wan-t2v',
    isTextToVideo: true,
    isImageToVideo: false,
    schema: wanT2vSchema,
    defaultSettings: {
      aspect_ratio: '16:9',
      resolution: '720p',
      num_frames: 81,
      turbo_mode: false,
      frames_per_second: 16,
      enable_prompt_expansion: false,
      num_inference_steps: 30,
      negative_prompt: 'bright colors, overexposed, static, blurred details, subtitles, style, artwork, painting, picture, still, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, malformed limbs, fused fingers, still picture, cluttered background, three legs, many people in the background, walking backwards',
      enable_safety_checker: false,
      seed: undefined,
    },
  },
  'fal-ai/hunyuan-video': {
    provider: 'fal',
    falModelId: 'fal-ai/hunyuan-video',
    isTextToVideo: true,
    isImageToVideo: false,
    schema: hunyuanVideoSchema,
    defaultSettings: {
      aspect_ratio: '16:9',
      resolution: '720p',
      num_frames: '129',
      num_inference_steps: 30,
      pro_mode: false,
      enable_safety_checker: false,
      seed: undefined,
    },
  },
  'fal-ai/luma-dream-machine/ray-2': {
    provider: 'fal',
    falModelId: 'fal-ai/luma-dream-machine/ray-2',
    isTextToVideo: true,
    isImageToVideo: false,
    schema: lumaDreamMachineRay2Schema,
    defaultSettings: {
      aspect_ratio: '16:9',
      resolution: '540p',
      duration: '5s',
      loop: false,
    },
  },
  'fal-ai/pika/v2.2/text-to-video': {
    provider: 'fal',
    falModelId: 'fal-ai/pika/v2.2/text-to-video',
    isTextToVideo: true,
    isImageToVideo: false,
    schema: pikaV22TextToVideoSchema,
    defaultSettings: {
      duration: 5,
      aspect_ratio: '16:9',
      resolution: '720p',
      negative_prompt: '',
      seed: undefined,
    },
  },
  'fal-ai/kling-video/v1.6/pro/image-to-video': {
    provider: 'fal',
    falModelId: 'fal-ai/kling-video/v1.6/pro/image-to-video',
    isTextToVideo: false,
    isImageToVideo: true,
    schema: klingVideoV16ProImageToVideoSchema,
    defaultSettings: {
      duration: '5',
      aspect_ratio: '16:9',
      negative_prompt: 'blur, distort, and low quality',
      cfg_scale: 0.5,
      tail_image_url: undefined,
    },
  },
  'fal-ai/kling-video/v2/master/image-to-video': {
    provider: 'fal',
    falModelId: 'fal-ai/kling-video/v2/master/image-to-video',
    isTextToVideo: false,
    isImageToVideo: true,
    schema: klingVideoV2MasterImageToVideoSchema,
    defaultSettings: {
      duration: '5',
      aspect_ratio: '16:9',
      negative_prompt: 'blur, distort, and low quality',
      cfg_scale: 0.5,
    },
  },
};

function mapVideoSettingsToFalInput(settings: VideoModelSettings, falModelId: string): Record<string, any> {
  const input: Record<string, any> = {};
  const modelDef = videoModelRegistry[falModelId];

  if (settings.prompt) input.prompt = settings.prompt;
  
  // Handle Minimax Video 01 Live specifically
  if (falModelId === 'fal-ai/minimax/video-01-live') {
    // Minimax specific settings
    if (settings.prompt_optimizer !== undefined) {
      input.prompt_optimizer = settings.prompt_optimizer;
    } else {
      input.prompt_optimizer = modelDef?.defaultSettings.prompt_optimizer ?? true;
    }
    
    if (settings.seed !== undefined) {
      input.seed = settings.seed;
    }
    
    console.log("Mapped Minimax Video 01 Live Input:", input);
    return input;
  }

  // Handle Veo2 specifically
  if (falModelId === 'fal-ai/veo2') {
    // Veo2 specific settings
    if (settings.duration !== undefined) {
      input.duration = settings.duration;
    } else {
      input.duration = modelDef?.defaultSettings.duration ?? '5s';
    }
    
    if (settings.aspect_ratio !== undefined) {
      input.aspect_ratio = settings.aspect_ratio;
    } else {
      input.aspect_ratio = modelDef?.defaultSettings.aspect_ratio ?? '16:9';
    }
    
    console.log("Mapped Veo2 Input:", input);
    return input;
  }

  // Handle Wan-T2V specifically
  if (falModelId === 'fal-ai/wan-t2v') {
    // Map all Wan-T2V specific settings
    input.aspect_ratio = settings.aspect_ratio || modelDef?.defaultSettings.aspect_ratio || '16:9';
    input.resolution = settings.resolution || modelDef?.defaultSettings.resolution || '720p';
    input.num_frames = settings.num_frames || modelDef?.defaultSettings.num_frames || 81;
    input.turbo_mode = settings.turbo_mode !== undefined ? settings.turbo_mode : modelDef?.defaultSettings.turbo_mode || false;
    input.frames_per_second = settings.frames_per_second || modelDef?.defaultSettings.frames_per_second || 16;
    input.enable_prompt_expansion = settings.enable_prompt_expansion !== undefined ? settings.enable_prompt_expansion : modelDef?.defaultSettings.enable_prompt_expansion || false;
    input.num_inference_steps = settings.num_inference_steps || modelDef?.defaultSettings.num_inference_steps || 30;
    input.negative_prompt = settings.negative_prompt || modelDef?.defaultSettings.negative_prompt || '';
    input.enable_safety_checker = settings.enable_safety_checker !== undefined ? settings.enable_safety_checker : modelDef?.defaultSettings.enable_safety_checker || false;
    
    if (settings.seed !== undefined) {
      input.seed = settings.seed;
    }
    
    console.log("Mapped Wan-T2V Input:", input);
    return input;
  }

  // Handle Hunyuan Video specifically
  if (falModelId === 'fal-ai/hunyuan-video') {
    // Map all Hunyuan Video specific settings
    input.aspect_ratio = settings.aspect_ratio || modelDef?.defaultSettings.aspect_ratio || '16:9';
    input.resolution = settings.resolution || modelDef?.defaultSettings.resolution || '720p';
    input.num_frames = settings.num_frames || modelDef?.defaultSettings.num_frames || '129';
    input.num_inference_steps = settings.num_inference_steps || modelDef?.defaultSettings.num_inference_steps || 30;
    input.pro_mode = settings.pro_mode !== undefined ? settings.pro_mode : modelDef?.defaultSettings.pro_mode || false;
    input.enable_safety_checker = settings.enable_safety_checker !== undefined ? settings.enable_safety_checker : modelDef?.defaultSettings.enable_safety_checker || false;
    
    if (settings.seed !== undefined) {
      input.seed = settings.seed;
    }
    
    console.log("Mapped Hunyuan Video Input:", input);
    return input;
  }

  // Handle Luma Dream Machine Ray-2 specifically
  if (falModelId === 'fal-ai/luma-dream-machine/ray-2') {
    // Map all Luma Dream Machine Ray-2 specific settings
    input.aspect_ratio = settings.aspect_ratio || modelDef?.defaultSettings.aspect_ratio || '16:9';
    input.resolution = settings.resolution || modelDef?.defaultSettings.resolution || '540p';
    input.duration = settings.duration || modelDef?.defaultSettings.duration || '5s';
    input.loop = settings.loop !== undefined ? settings.loop : modelDef?.defaultSettings.loop || false;
    
    console.log("Mapped Luma Dream Machine Ray-2 Input:", input);
    return input;
  }

  // Handle Pika V2.2 Text to Video specifically
  if (falModelId === 'fal-ai/pika/v2.2/text-to-video') {
    // Map all Pika V2.2 Text to Video specific settings
    input.duration = settings.duration || modelDef?.defaultSettings.duration || 5;
    input.aspect_ratio = settings.aspect_ratio || modelDef?.defaultSettings.aspect_ratio || '16:9';
    input.resolution = settings.resolution || modelDef?.defaultSettings.resolution || '720p';
    input.negative_prompt = settings.negative_prompt || modelDef?.defaultSettings.negative_prompt || '';
    
    if (settings.seed !== undefined) {
      input.seed = settings.seed;
    }
    
    console.log("Mapped Pika V2.2 Text to Video Input:", input);
    return input;
  }

  // Handle Kling Video v1.6 Pro Image-to-Video specifically
  if (falModelId === 'fal-ai/kling-video/v1.6/pro/image-to-video') {
    // Map all Kling Video v1.6 Pro specific settings
    input.duration = settings.duration || modelDef?.defaultSettings.duration || '5';
    input.aspect_ratio = settings.aspect_ratio || modelDef?.defaultSettings.aspect_ratio || '16:9';
    input.negative_prompt = settings.negative_prompt || modelDef?.defaultSettings.negative_prompt || 'blur, distort, and low quality';
    input.cfg_scale = settings.cfg_scale !== undefined ? settings.cfg_scale : modelDef?.defaultSettings.cfg_scale || 0.5;
    
    // Required image_url for image-to-video
    if (settings.image_url) {
      input.image_url = settings.image_url;
    }
    
    // Optional tail_image_url for v1.6
    if (settings.tail_image_url) {
      input.tail_image_url = settings.tail_image_url;
    }
    
    console.log("Mapped Kling Video v1.6 Pro Image-to-Video Input:", input);
    return input;
  }

  // Handle Kling Video v2 Master Image-to-Video specifically
  if (falModelId === 'fal-ai/kling-video/v2/master/image-to-video') {
    // Map all Kling Video v2 Master specific settings
    input.duration = settings.duration || modelDef?.defaultSettings.duration || '5';
    input.aspect_ratio = settings.aspect_ratio || modelDef?.defaultSettings.aspect_ratio || '16:9';
    input.negative_prompt = settings.negative_prompt || modelDef?.defaultSettings.negative_prompt || 'blur, distort, and low quality';
    input.cfg_scale = settings.cfg_scale !== undefined ? settings.cfg_scale : modelDef?.defaultSettings.cfg_scale || 0.5;
    
    // Required image_url for image-to-video
    if (settings.image_url) {
      input.image_url = settings.image_url;
    }
    
    console.log("Mapped Kling Video v2 Master Image-to-Video Input:", input);
    return input;
  }

  // Default fallback for other models
  if (settings.seed !== undefined) input.seed = settings.seed;
  
  console.log("Mapped Video Input:", input);
  return input;
}

async function generateVideo(
  modelId: string,
  settings: VideoModelSettings,
  onQueueUpdate?: QueueUpdateCallback
): Promise<VideoGenerationResponse> {
  const modelDefinition = videoModelRegistry[modelId];

  if (!modelDefinition) {
    console.error(`Video model ${modelId} not found in registry.`);
    return { success: false, error: `Video model ${modelId} not found.`, videos: [] };
  }

  const mergedSettings: VideoModelSettings = {
    ...modelDefinition.defaultSettings,
    ...settings,
  };

  const startTime = Date.now();

  try {
    if (modelDefinition.provider === 'fal') {
      if (!FAL_KEY) {
        return { success: false, error: "Fal AI key (VITE_FAL_KEY) is not configured.", videos: [] };
      }
      if (!modelDefinition.falModelId) {
        return { success: false, error: `Fal model ID missing for ${modelId}.`, videos: [] };
      }

      const falInput = mapVideoSettingsToFalInput(mergedSettings, modelDefinition.falModelId);

      if (!falInput.prompt) {
        return { success: false, error: `Model ${modelId} requires a prompt.`, videos: [] };
      }

      let result: any;
      if (onQueueUpdate) {
        // @ts-ignore - Suppress error due to potential typing issue
        result = await fal.subscribe(modelDefinition.falModelId, {
          input: falInput,
          logs: true,
          onQueueUpdate: (update: any) => {
            onQueueUpdate(update);
          },
        });
      } else {
        // @ts-ignore - Suppress error due to potential typing issue
        result = await fal.run(modelDefinition.falModelId, { input: falInput });
      }

      // Calculate generation time
      const generationTime = (Date.now() - startTime) / 1000;

      // Check for new response format with data property
      if (result?.data) {
        // Handle the new response format for video
        if (result.data.video && result.data.video.url) {
          const outputVideos: GeneratedVideo[] = [{
            url: result.data.video.url,
            seed: result.data.seed || falInput.seed,
            duration: result.data.duration,
            metadata: result.data.metadata || {}
          }];
          
          return {
            success: true,
            videos: outputVideos,
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
      if (!result || !result.video || !result.video.url) {
        console.error('Invalid response structure from Fal.ai:', result);
        return {
          success: false,
          error: 'Received invalid response or no video from Fal.ai.',
          videos: [],
          metadata: { falInput, falResult: result }
        };
      }

      const outputVideos: GeneratedVideo[] = [{
        url: result.video.url,
        seed: result.seed,
        duration: result.duration,
        metadata: result.metadata || {}
      }];

      return {
        success: true,
        videos: outputVideos,
        metadata: {
          generationTime,
          modelVersion: modelDefinition.falModelId,
          seed: result.seed,
          falInput: falInput,
          falResult: result,
        },
      };
    }

    return { success: false, error: `Unsupported provider for model ${modelId}`, videos: [] };

  } catch (error) {
    console.error(`Error generating video with ${modelId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return {
      success: false,
      error: errorMessage,
      videos: [],
      metadata: { falInput: mapVideoSettingsToFalInput(mergedSettings, modelDefinition.falModelId), error: errorMessage }
    };
  }
}

function getVideoModelDefaults(modelId: string): Partial<VideoModelSettings> | null {
  const modelDef = videoModelRegistry[modelId];
  return modelDef ? modelDef.defaultSettings : null;
}

function getAvailableVideoModels(): string[] {
  return Object.keys(videoModelRegistry);
}

// Export the service object inline to avoid initialization issues
export default {
  modelRegistry: videoModelRegistry,
  generateVideo,
  getVideoModelDefaults,
  getAvailableVideoModels,
  mapVideoSettingsToFalInput
}; 
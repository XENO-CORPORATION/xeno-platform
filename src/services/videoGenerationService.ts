import { postXenoRequest } from './xenoProxyRequest';

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
  [key: string]: any;
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

interface VideoModelDefinition {
  provider: 'xeno';
  xenoModelId: string;
  isTextToVideo?: boolean;
  isImageToVideo?: boolean;
  defaultSettings: Partial<VideoModelSettings>;
}

type QueueUpdateCallback = (update: any) => void;

const videoModelRegistry: Record<string, VideoModelDefinition> = {
  'fal-ai/minimax/video-01-live': {
    provider: 'xeno',
    xenoModelId: 'fal-ai/minimax/video-01-live',
    isTextToVideo: true,
    isImageToVideo: false,
    defaultSettings: {
      prompt_optimizer: true,
      num_outputs: 1,
      seed: undefined,
    },
  },
  'fal-ai/veo2': {
    provider: 'xeno',
    xenoModelId: 'fal-ai/veo2',
    isTextToVideo: true,
    isImageToVideo: false,
    defaultSettings: {
      duration: '5s',
      aspect_ratio: '16:9',
      num_outputs: 1,
    },
  },
  'fal-ai/wan-t2v': {
    provider: 'xeno',
    xenoModelId: 'fal-ai/wan-t2v',
    isTextToVideo: true,
    isImageToVideo: false,
    defaultSettings: {
      aspect_ratio: '16:9',
      resolution: '720p',
      seed: undefined,
    },
  },
  'fal-ai/hunyuan-video': {
    provider: 'xeno',
    xenoModelId: 'fal-ai/hunyuan-video',
    isTextToVideo: true,
    isImageToVideo: false,
    defaultSettings: {
      aspect_ratio: '16:9',
      resolution: '720p',
      seed: undefined,
    },
  },
  'fal-ai/luma-dream-machine/ray-2': {
    provider: 'xeno',
    xenoModelId: 'fal-ai/luma-dream-machine/ray-2',
    isTextToVideo: true,
    isImageToVideo: false,
    defaultSettings: {
      aspect_ratio: '16:9',
      resolution: '540p',
      duration: '5s',
    },
  },
  'fal-ai/pika/v2.2/text-to-video': {
    provider: 'xeno',
    xenoModelId: 'fal-ai/pika/v2.2/text-to-video',
    isTextToVideo: true,
    isImageToVideo: false,
    defaultSettings: {
      duration: 5,
      aspect_ratio: '16:9',
      resolution: '720p',
      seed: undefined,
    },
  },
  'fal-ai/kling-video/v1.6/pro/image-to-video': {
    provider: 'xeno',
    xenoModelId: 'fal-ai/kling-video/v1.6/pro/image-to-video',
    isTextToVideo: false,
    isImageToVideo: true,
    defaultSettings: {
      duration: '5',
      aspect_ratio: '16:9',
    },
  },
  'fal-ai/kling-video/v2/master/image-to-video': {
    provider: 'xeno',
    xenoModelId: 'fal-ai/kling-video/v2/master/image-to-video',
    isTextToVideo: false,
    isImageToVideo: true,
    defaultSettings: {
      duration: '5',
      aspect_ratio: '16:9',
    },
  },
};

function mapVideoSettingsToXenoInput(settings: VideoModelSettings, xenoModelId: string): Record<string, any> {
  const input: Record<string, any> = {
    prompt: settings.prompt,
    model: xenoModelId,
  };

  if (settings.image_url) {
    input.image = settings.image_url;
  }

  if (settings.duration !== undefined) {
    const duration = typeof settings.duration === 'string'
      ? parseInt(settings.duration.replace(/[^0-9]/g, ''))
      : settings.duration;
    if (!isNaN(duration)) {
      input.duration = duration;
    }
  }

  if (settings.resolution) {
    input.resolution = settings.resolution;
  }

  if (settings.fps) {
    input.fps = settings.fps;
  }

  if (settings.aspect_ratio) {
    input.aspect_ratio = settings.aspect_ratio;
  }

  if (settings.seed !== undefined) {
    input.seed = settings.seed;
  }

  return input;
}

async function generateVideo(
  modelId: string,
  settings: VideoModelSettings,
  onQueueUpdate?: QueueUpdateCallback
): Promise<VideoGenerationResponse> {
  const modelDefinition = videoModelRegistry[modelId];

  if (!modelDefinition) {
    return { success: false, error: `Video model ${modelId} not found.`, videos: [] };
  }

  if (typeof settings.prompt !== 'string' || !settings.prompt.trim()) {
    return { success: false, error: 'Please enter a prompt.', videos: [] };
  }
  if (modelDefinition.isImageToVideo && !settings.image_url) {
    return { success: false, error: 'This model requires an input image.', videos: [] };
  }

  const mergedSettings: VideoModelSettings = {
    ...modelDefinition.defaultSettings,
    ...settings,
  };

  const startTime = Date.now();

  try {
    if (modelDefinition.provider === 'xeno') {
      if (!modelDefinition.xenoModelId) {
        return { success: false, error: `Xeno model ID missing for ${modelId}.`, videos: [] };
      }

      const xenoInput = mapVideoSettingsToXenoInput(mergedSettings, modelDefinition.xenoModelId);

      if (!xenoInput.prompt) {
        return { success: false, error: `Model ${modelId} requires a prompt.`, videos: [] };
      }

      const result = await postXenoRequest('/videos/generate', {
        ...xenoInput,
        wait: true,
        requestId: crypto.randomUUID(),
      });

      const generationTime = (Date.now() - startTime) / 1000;

      if (!result || !Array.isArray(result.data) || result.data.length === 0) {
        return {
          success: false,
          error: 'Received invalid response or no video from Xeno AI.',
          videos: [],
          metadata: { xenoInput, xenoResult: result }
        };
      }

      if (result.model && result.model !== modelDefinition.xenoModelId) {
        return { success: false, error: 'The provider returned a different model than requested. Contact support with the request record.', videos: [],
          metadata: { requestedModel: modelDefinition.xenoModelId, returnedModel: result.model } };
      }

      const videoData = result.data[0];
      if (!videoData || typeof videoData.url !== 'string' || !/^(https:\/\/|data:video\/)/i.test(videoData.url)) {
        return {
          success: false,
          error: 'No video URL in response from Xeno AI.',
          videos: [],
          metadata: { xenoInput, xenoResult: result }
        };
      }

      const outputVideos: GeneratedVideo[] = [{
        url: videoData.url,
        duration: videoData.duration,
        metadata: {
          thumbnail_url: videoData.thumbnail_url,
        }
      }];

      return {
        success: true,
        videos: outputVideos,
        metadata: {
          generationTime,
          modelVersion: result.model || modelDefinition.xenoModelId,
          xenoInput,
          xenoResult: result,
        },
      };
    }

    return { success: false, error: `Unsupported provider for model ${modelId}`, videos: [] };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return {
      success: false,
      error: errorMessage,
      videos: [],
      metadata: {
        xenoInput: mapVideoSettingsToXenoInput(mergedSettings, modelDefinition.xenoModelId),
        error: errorMessage
      }
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

export default {
  modelRegistry: videoModelRegistry,
  generateVideo,
  getVideoModelDefaults,
  getAvailableVideoModels,
  mapVideoSettingsToXenoInput
};

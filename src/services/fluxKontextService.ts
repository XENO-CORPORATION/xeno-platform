import { postXenoRequest } from './xenoProxyRequest';

interface FluxKontextTextToImageInput {
  prompt: string;
  num_images?: number;
  aspect_ratio?: '21:9' | '16:9' | '4:3' | '3:2' | '1:1' | '2:3' | '3:4' | '9:16' | '9:21';
  output_format?: 'jpeg' | 'png';
  sync_mode?: boolean;
  safety_tolerance?: '1' | '2' | '3' | '4' | '5' | '6';
  guidance_scale?: number;
  seed?: number;
}

interface FluxKontextMultiInput {
  prompt: string;
  image_urls: string[];
  num_images?: number;
  aspect_ratio?: '21:9' | '16:9' | '4:3' | '3:2' | '1:1' | '2:3' | '3:4' | '9:16' | '9:21';
  output_format?: 'jpeg' | 'png';
  sync_mode?: boolean;
  safety_tolerance?: '1' | '2' | '3' | '4' | '5' | '6';
  guidance_scale?: number;
  seed?: number;
}

interface FluxKontextImage {
  url: string;
  width: number;
  height: number;
  content_type?: string;
}

interface FluxKontextOutput {
  prompt: string;
  images: FluxKontextImage[];
  timings: Record<string, number>;
  has_nsfw_concepts: boolean[];
  seed: number;
}

interface QueueStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED';
  request_id: string;
  response_url?: string;
  status_url?: string;
  cancel_url?: string;
  logs?: Record<string, any>;
  metrics?: Record<string, any>;
  queue_position?: number;
}

export interface FluxKontextGenerationResult {
  success: boolean;
  images?: Array<{
    url: string;
    width: number;
    height: number;
    content_type?: string;
  }>;
  error?: string;
  metadata?: {
    prompt: string;
    seed: number;
    has_nsfw_concepts: boolean[];
    timings: Record<string, number>;
    generation_time: number;
    model_used: 'text-to-image' | 'multi';
    request_id: string;
  };
}

export interface FluxKontextQueueUpdate {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  queue_position?: number;
  logs?: any[];
  requestId: string;
}

class FluxKontextService {
  private aspectRatioToResolution(aspectRatio: string): { width: number; height: number } {
    const ratioMap: Record<string, { width: number; height: number }> = {
      '21:9': { width: 1344, height: 576 },
      '16:9': { width: 1344, height: 768 },
      '4:3': { width: 1024, height: 768 },
      '3:2': { width: 1216, height: 832 },
      '1:1': { width: 1024, height: 1024 },
      '2:3': { width: 832, height: 1216 },
      '3:4': { width: 768, height: 1024 },
      '9:16': { width: 768, height: 1344 },
      '9:21': { width: 576, height: 1344 },
    };
    return ratioMap[aspectRatio] || { width: 1024, height: 1024 };
  }

  async uploadImage(file: File): Promise<string> {
    throw new Error('Image upload is not supported. Use generateFromTextAndImageUrls with existing image URLs.');
  }

  async generateFromText(
    prompt: string,
    options: Partial<FluxKontextTextToImageInput> = {},
    onQueueUpdate?: (update: FluxKontextQueueUpdate) => void
  ): Promise<FluxKontextGenerationResult> {
    const startTime = Date.now();

    try {
      if (!prompt.trim()) {
        return {
          success: false,
          error: 'Prompt is required for image generation.',
        };
      }

      const aspectRatio = options.aspect_ratio || '1:1';
      const resolution = this.aspectRatioToResolution(aspectRatio);

      const response = await postXenoRequest('/images/generate', {
        model: 'flux-kontext-high',
        prompt: prompt.trim(),
        width: resolution.width,
        height: resolution.height,
        seed: options.seed,
      });

      const imageUrl = response.data[0]?.url;

      if (!imageUrl) {
        return {
          success: false,
          error: 'No image URL returned from Xeno API',
        };
      }

      return {
        success: true,
        images: [{
          url: imageUrl,
          width: resolution.width,
          height: resolution.height,
          content_type: 'image/jpeg',
        }],
        metadata: {
          prompt: prompt,
          seed: options.seed || 0,
          has_nsfw_concepts: [],
          timings: {},
          generation_time: (Date.now() - startTime) / 1000,
          model_used: 'text-to-image',
          request_id: `xeno-${Date.now()}`,
        },
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        metadata: {
          prompt,
          seed: 0,
          has_nsfw_concepts: [],
          timings: {},
          generation_time: (Date.now() - startTime) / 1000,
          model_used: 'text-to-image',
          request_id: 'failed',
        },
      };
    }
  }

  async generateFromTextAndImageUrls(
    prompt: string,
    imageUrls: string[],
    options: Partial<FluxKontextMultiInput> = {},
    onQueueUpdate?: (update: FluxKontextQueueUpdate) => void
  ): Promise<FluxKontextGenerationResult> {
    const startTime = Date.now();

    try {
      if (!prompt.trim()) {
        return {
          success: false,
          error: 'Prompt is required for image generation.',
        };
      }

      if (!imageUrls || imageUrls.length === 0) {
        return {
          success: false,
          error: 'At least one reference image URL is required for multi-modal generation.',
        };
      }

      const aspectRatio = options.aspect_ratio || '1:1';
      const resolution = this.aspectRatioToResolution(aspectRatio);

      const response = await postXenoRequest('/images/edit', {
        image: imageUrls[0],
        prompt: prompt.trim(),
        model: 'flux-kontext-high',
      });

      const imageUrl = response.data[0]?.url;

      if (!imageUrl) {
        return {
          success: false,
          error: 'No image URL returned from Xeno API',
        };
      }

      return {
        success: true,
        images: [{
          url: imageUrl,
          width: resolution.width,
          height: resolution.height,
          content_type: 'image/jpeg',
        }],
        metadata: {
          prompt: prompt,
          seed: options.seed || 0,
          has_nsfw_concepts: [],
          timings: {},
          generation_time: (Date.now() - startTime) / 1000,
          model_used: 'multi',
          request_id: `xeno-${Date.now()}`,
        },
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        metadata: {
          prompt,
          seed: 0,
          has_nsfw_concepts: [],
          timings: {},
          generation_time: (Date.now() - startTime) / 1000,
          model_used: 'multi',
          request_id: 'failed',
        },
      };
    }
  }

  async generateFromTextAndImages(
    prompt: string,
    imageFiles: File[],
    options: Partial<FluxKontextMultiInput> = {},
    onQueueUpdate?: (update: FluxKontextQueueUpdate) => void
  ): Promise<FluxKontextGenerationResult> {
    return {
      success: false,
      error: 'File upload is not supported. Use generateFromTextAndImageUrls with existing image URLs.',
    };
  }

  async cancelJob(requestId: string, endpoint: string): Promise<boolean> {
    return false;
  }
}

export const fluxKontextService = new FluxKontextService();
export default fluxKontextService;

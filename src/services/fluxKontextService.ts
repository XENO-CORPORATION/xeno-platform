// Flux Kontext Service for Production-Ready Image Generation
// Supports both text-to-image and multi/image-to-image capabilities

// Types based on the OpenAPI schemas
interface FluxKontextTextToImageInput {
  prompt: string;
  num_images?: number; // 1-4, default: 1
  aspect_ratio?: '21:9' | '16:9' | '4:3' | '3:2' | '1:1' | '2:3' | '3:4' | '9:16' | '9:21'; // default: '1:1'
  output_format?: 'jpeg' | 'png'; // default: 'jpeg'
  sync_mode?: boolean; // default: false
  safety_tolerance?: '1' | '2' | '3' | '4' | '5' | '6'; // default: '2'
  guidance_scale?: number; // 1-20, default: 3.5
  seed?: number;
}

interface FluxKontextMultiInput {
  prompt: string;
  image_urls: string[];
  num_images?: number; // 1-4, default: 1
  aspect_ratio?: '21:9' | '16:9' | '4:3' | '3:2' | '1:1' | '2:3' | '3:4' | '9:16' | '9:21';
  output_format?: 'jpeg' | 'png'; // default: 'jpeg'
  sync_mode?: boolean; // default: false
  safety_tolerance?: '1' | '2' | '3' | '4' | '5' | '6'; // default: '2'
  guidance_scale?: number; // 1-20, default: 3.5
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

// Get FAL key from environment
const FAL_KEY = import.meta.env.VITE_FAL_KEY;

if (!FAL_KEY) {
  console.warn('Fal AI key (VITE_FAL_KEY) is not set. Flux Kontext will not work.');
}

class FluxKontextService {
  private readonly baseUrl = this.getApiBaseUrl();
  private readonly textToImageEndpoint = 'fal-ai/flux-pro/kontext/max/text-to-image';
  private readonly multiEndpoint = 'fal-ai/flux-pro/kontext/max/multi';

  // Determine if we're in development mode
  private isDevelopment(): boolean {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  }

  // Get the appropriate API base URL (proxy in dev, direct in production)
  private getApiBaseUrl(): string {
    if (this.isDevelopment()) {
      // Use direct server endpoint to avoid proxy issues
      return 'http://localhost:4002/api/fal-direct';
    }
    // Direct FAL.ai API in production
    return 'https://queue.fal.run';
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // In development, the server handles auth. In production, use frontend key.
    if (!this.isDevelopment()) {
      if (!FAL_KEY) {
        throw new Error('FAL API key not configured');
      }
      headers['Authorization'] = `Key ${FAL_KEY}`;
    }
    
    return headers;
  }

  // Upload image to get URL for multi endpoint
  async uploadImage(file: File): Promise<string> {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('https://fal.run/fal-ai/imageutils/image-to-url', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${FAL_KEY}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Image upload failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result.url;
    } catch (error) {
      console.error('Error uploading image:', error);
      throw new Error('Failed to upload image for processing');
    }
  }

  // Submit job to queue
  private async submitJob(endpoint: string, input: FluxKontextTextToImageInput | FluxKontextMultiInput): Promise<QueueStatus> {
    const response = await fetch(`${this.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to submit job: ${response.status} ${response.statusText} - ${error}`);
    }

    return response.json();
  }

  // Poll job status using the provided status URL
  private async pollJobStatus(statusUrl: string): Promise<QueueStatus> {
    // Convert the full status URL to use our development proxy if needed
    let url = statusUrl;
    if (this.isDevelopment()) {
      // Replace https://queue.fal.run with our local proxy
      url = url.replace('https://queue.fal.run', this.baseUrl);
    }

    const response = await fetch(`${url}?logs=1`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get job status: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Get job result using the provided response URL
  private async getJobResult(responseUrl: string): Promise<FluxKontextOutput> {
    // Convert the full response URL to use our development proxy if needed
    let url = responseUrl;
    if (this.isDevelopment()) {
      // Replace https://queue.fal.run with our local proxy
      url = url.replace('https://queue.fal.run', this.baseUrl);
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get job result: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Cancel job
  async cancelJob(requestId: string, endpoint: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/${endpoint}/requests/${requestId}/cancel`, {
        method: 'PUT',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        console.error(`Failed to cancel job: ${response.status} ${response.statusText}`);
        return false;
      }

      const result = await response.json();
      return result.success || false;
    } catch (error) {
      console.error('Error canceling job:', error);
      return false;
    }
  }

  // Generate image from text prompt only
  async generateFromText(
    prompt: string,
    options: Partial<FluxKontextTextToImageInput> = {},
    onQueueUpdate?: (update: FluxKontextQueueUpdate) => void
  ): Promise<FluxKontextGenerationResult> {
    const startTime = Date.now();

    try {
      if (!FAL_KEY) {
        return {
          success: false,
          error: 'FAL API key not configured. Please set VITE_FAL_KEY environment variable.',
        };
      }

      if (!prompt.trim()) {
        return {
          success: false,
          error: 'Prompt is required for image generation.',
        };
      }

      // Prepare input with defaults
      const input: FluxKontextTextToImageInput = {
        prompt: prompt.trim(),
        num_images: options.num_images || 1,
        aspect_ratio: options.aspect_ratio || '1:1',
        output_format: options.output_format || 'jpeg',
        sync_mode: options.sync_mode || false,
        safety_tolerance: options.safety_tolerance || '2',
        guidance_scale: options.guidance_scale || 3.5,
        seed: options.seed,
      };

      console.log('Submitting Flux Kontext text-to-image job:', input);

      // Submit job
      const queueStatus = await this.submitJob(this.textToImageEndpoint, input);
      console.log('Job submitted:', queueStatus);

      // Notify queue status
      if (onQueueUpdate) {
        onQueueUpdate({
          status: queueStatus.status,
          queue_position: queueStatus.queue_position,
          requestId: queueStatus.request_id,
        });
      }

      // Poll for completion
      let currentStatus = queueStatus;
      const maxAttempts = 180; // 3 minutes with 1 second intervals
      let attempts = 0;

      while (currentStatus.status !== 'COMPLETED' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        try {
          currentStatus = await this.pollJobStatus(queueStatus.status_url!);
          
          if (onQueueUpdate) {
            onQueueUpdate({
              status: currentStatus.status,
              queue_position: currentStatus.queue_position,
              logs: currentStatus.logs ? Object.values(currentStatus.logs) : undefined,
              requestId: queueStatus.request_id,
            });
          }
        } catch (pollError) {
          console.error('Error polling job status:', pollError);
          // Continue polling unless we've exceeded max attempts
        }
        
        attempts++;
      }

      if (currentStatus.status !== 'COMPLETED') {
        return {
          success: false,
          error: `Job timed out or failed. Status: ${currentStatus.status}`,
          metadata: {
            prompt,
            seed: input.seed || 0,
            has_nsfw_concepts: [],
            timings: {},
            generation_time: (Date.now() - startTime) / 1000,
            model_used: 'text-to-image',
            request_id: queueStatus.request_id,
          },
        };
      }

      // Get final result
      const result = await this.getJobResult(queueStatus.response_url!);
      
      return {
        success: true,
        images: result.images,
        metadata: {
          prompt: result.prompt,
          seed: result.seed,
          has_nsfw_concepts: result.has_nsfw_concepts,
          timings: result.timings,
          generation_time: (Date.now() - startTime) / 1000,
          model_used: 'text-to-image',
          request_id: queueStatus.request_id,
        },
      };

    } catch (error) {
      console.error('Error in Flux Kontext text-to-image generation:', error);
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

  // Generate image from text prompt + reference image URLs (for latest generated images)
  async generateFromTextAndImageUrls(
    prompt: string,
    imageUrls: string[],
    options: Partial<FluxKontextMultiInput> = {},
    onQueueUpdate?: (update: FluxKontextQueueUpdate) => void
  ): Promise<FluxKontextGenerationResult> {
    const startTime = Date.now();

    try {
      if (!FAL_KEY) {
        return {
          success: false,
          error: 'FAL API key not configured. Please set VITE_FAL_KEY environment variable.',
        };
      }

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

      // Prepare input with defaults
      const input: FluxKontextMultiInput = {
        prompt: prompt.trim(),
        image_urls: imageUrls,
        num_images: options.num_images || 1,
        aspect_ratio: options.aspect_ratio,
        output_format: options.output_format || 'jpeg',
        sync_mode: options.sync_mode || false,
        safety_tolerance: options.safety_tolerance || '2',
        guidance_scale: options.guidance_scale || 3.5,
        seed: options.seed,
      };

      console.log('Submitting Flux Kontext multi job with URLs:', input);

      // Submit job
      const queueStatus = await this.submitJob(this.multiEndpoint, input);
      console.log('Job submitted:', queueStatus);

      // Notify queue status
      if (onQueueUpdate) {
        onQueueUpdate({
          status: queueStatus.status,
          queue_position: queueStatus.queue_position,
          requestId: queueStatus.request_id,
        });
      }

      // Poll for completion
      let currentStatus = queueStatus;
      const maxAttempts = 180; // 3 minutes with 1 second intervals
      let attempts = 0;

      while (currentStatus.status !== 'COMPLETED' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        try {
          currentStatus = await this.pollJobStatus(queueStatus.status_url!);
          
          if (onQueueUpdate) {
            onQueueUpdate({
              status: currentStatus.status,
              queue_position: currentStatus.queue_position,
              logs: currentStatus.logs ? Object.values(currentStatus.logs) : undefined,
              requestId: queueStatus.request_id,
            });
          }
        } catch (pollError) {
          console.error('Error polling job status:', pollError);
        }
        
        attempts++;
      }

      if (currentStatus.status !== 'COMPLETED') {
        return {
          success: false,
          error: `Job timed out or failed. Status: ${currentStatus.status}`,
          metadata: {
            prompt,
            seed: input.seed || 0,
            has_nsfw_concepts: [],
            timings: {},
            generation_time: (Date.now() - startTime) / 1000,
            model_used: 'multi',
            request_id: queueStatus.request_id,
          },
        };
      }

      // Get final result
      const result = await this.getJobResult(queueStatus.response_url!);
      
      return {
        success: true,
        images: result.images,
        metadata: {
          prompt: result.prompt,
          seed: result.seed,
          has_nsfw_concepts: result.has_nsfw_concepts,
          timings: result.timings,
          generation_time: (Date.now() - startTime) / 1000,
          model_used: 'multi',
          request_id: queueStatus.request_id,
        },
      };

    } catch (error) {
      console.error('Error in Flux Kontext multi generation with URLs:', error);
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

  // Generate image from text prompt + reference images
  async generateFromTextAndImages(
    prompt: string,
    imageFiles: File[],
    options: Partial<FluxKontextMultiInput> = {},
    onQueueUpdate?: (update: FluxKontextQueueUpdate) => void
  ): Promise<FluxKontextGenerationResult> {
    const startTime = Date.now();

    try {
      if (!FAL_KEY) {
        return {
          success: false,
          error: 'FAL API key not configured. Please set VITE_FAL_KEY environment variable.',
        };
      }

      if (!prompt.trim()) {
        return {
          success: false,
          error: 'Prompt is required for image generation.',
        };
      }

      if (!imageFiles || imageFiles.length === 0) {
        return {
          success: false,
          error: 'At least one reference image is required for multi-modal generation.',
        };
      }

      // Upload images to get URLs
      const imageUrls: string[] = [];
      for (const file of imageFiles) {
        try {
          const url = await this.uploadImage(file);
          imageUrls.push(url);
        } catch (uploadError) {
          console.error('Failed to upload image:', file.name, uploadError);
          return {
            success: false,
            error: `Failed to upload image: ${file.name}`,
          };
        }
      }

      // Prepare input with defaults
      const input: FluxKontextMultiInput = {
        prompt: prompt.trim(),
        image_urls: imageUrls,
        num_images: options.num_images || 1,
        aspect_ratio: options.aspect_ratio,
        output_format: options.output_format || 'jpeg',
        sync_mode: options.sync_mode || false,
        safety_tolerance: options.safety_tolerance || '2',
        guidance_scale: options.guidance_scale || 3.5,
        seed: options.seed,
      };

      console.log('Submitting Flux Kontext multi job:', input);

      // Submit job
      const queueStatus = await this.submitJob(this.multiEndpoint, input);
      console.log('Job submitted:', queueStatus);

      // Notify queue status
      if (onQueueUpdate) {
        onQueueUpdate({
          status: queueStatus.status,
          queue_position: queueStatus.queue_position,
          requestId: queueStatus.request_id,
        });
      }

      // Poll for completion
      let currentStatus = queueStatus;
      const maxAttempts = 180; // 3 minutes with 1 second intervals
      let attempts = 0;

      while (currentStatus.status !== 'COMPLETED' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        try {
          currentStatus = await this.pollJobStatus(queueStatus.status_url!);
          
          if (onQueueUpdate) {
            onQueueUpdate({
              status: currentStatus.status,
              queue_position: currentStatus.queue_position,
              logs: currentStatus.logs ? Object.values(currentStatus.logs) : undefined,
              requestId: queueStatus.request_id,
            });
          }
        } catch (pollError) {
          console.error('Error polling job status:', pollError);
        }
        
        attempts++;
      }

      if (currentStatus.status !== 'COMPLETED') {
        return {
          success: false,
          error: `Job timed out or failed. Status: ${currentStatus.status}`,
          metadata: {
            prompt,
            seed: input.seed || 0,
            has_nsfw_concepts: [],
            timings: {},
            generation_time: (Date.now() - startTime) / 1000,
            model_used: 'multi',
            request_id: queueStatus.request_id,
          },
        };
      }

      // Get final result
      const result = await this.getJobResult(queueStatus.response_url!);
      
      return {
        success: true,
        images: result.images,
        metadata: {
          prompt: result.prompt,
          seed: result.seed,
          has_nsfw_concepts: result.has_nsfw_concepts,
          timings: result.timings,
          generation_time: (Date.now() - startTime) / 1000,
          model_used: 'multi',
          request_id: queueStatus.request_id,
        },
      };

    } catch (error) {
      console.error('Error in Flux Kontext multi generation:', error);
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
}

// Export singleton instance
export const fluxKontextService = new FluxKontextService();
export default fluxKontextService; 
interface IOPaintModel {
  name: string;
  displayName: string;
  type: 'erase' | 'inpaint' | 'outpaint';
  description: string;
  gpuRequired: boolean;
}

interface IOPaintRequest {
  image: File;
  mask?: File;
  model: string;
  prompt?: string;
  negativePrompt?: string;
  strength?: number;
  guidanceScale?: number;
  steps?: number;
  seed?: number;
}

interface IOPaintResponse {
  processedImage: Blob;
  metadata: {
    model: string;
    processingTime: number;
    imageSize: { width: number; height: number };
  };
}

interface IOPaintServerInfo {
  isOnline: boolean;
  models: string[];
  version?: string;
  deviceInfo?: {
    device: string;
    gpuAvailable: boolean;
    gpuName?: string;
  };
}

class IOPaintError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string
  ) {
    super(message);
    this.name = 'IOPaintError';
  }
}

class IOPaintService {
  private baseUrl: string;
  private timeout: number;
  
  constructor(baseUrl: string = process.env.REACT_APP_IOPAINT_SERVER_URL || 'http://localhost:8080') {
    this.baseUrl = baseUrl;
    this.timeout = 120000; // 2 minutes for image processing
  }

  // Check if IOPaint server is available and get server info
  async getServerInfo(): Promise<IOPaintServerInfo> {
    try {
      const healthResponse = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(5000), // 5 second timeout for health check
      });

      if (!healthResponse.ok) {
        return { isOnline: false, models: [] };
      }

      // Try to get available models
      let models: string[] = [];
      let deviceInfo = undefined;
      
      try {
        const modelsResponse = await fetch(`${this.baseUrl}/api/v1/models`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        });
        
        if (modelsResponse.ok) {
          const modelsData = await modelsResponse.json();
          models = Array.isArray(modelsData) ? modelsData : Object.keys(modelsData);
        }
      } catch (error) {
        console.warn('Could not fetch models list:', error);
        // Fallback to common models
        models = ['lama', 'stable-diffusion-inpainting', 'brushnet'];
      }

      // Try to get device info
      try {
        const deviceResponse = await fetch(`${this.baseUrl}/api/v1/device`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        });
        
        if (deviceResponse.ok) {
          deviceInfo = await deviceResponse.json();
        }
      } catch (error) {
        console.warn('Could not fetch device info:', error);
      }

      return {
        isOnline: true,
        models,
        deviceInfo,
      };
    } catch (error) {
      console.error('Server health check failed:', error);
      return { isOnline: false, models: [] };
    }
  }

  // Simple health check
  async healthCheck(): Promise<boolean> {
    try {
      const serverInfo = await this.getServerInfo();
      return serverInfo.isOnline;
    } catch {
      return false;
    }
  }

  // Get available models
  async getModels(): Promise<IOPaintModel[]> {
    const serverInfo = await this.getServerInfo();
    
    // Map model names to display information
    const modelMap: Record<string, Omit<IOPaintModel, 'name'>> = {
      'lama': {
        displayName: 'LaMa (Fast)',
        type: 'erase',
        description: 'Fast object removal, good for simple inpainting tasks',
        gpuRequired: false,
      },
      'stable-diffusion-inpainting': {
        displayName: 'Stable Diffusion Inpainting',
        type: 'inpaint',
        description: 'High-quality inpainting with prompt support',
        gpuRequired: true,
      },
      'brushnet': {
        displayName: 'BrushNet',
        type: 'inpaint',
        description: 'Advanced inpainting with brush guidance',
        gpuRequired: true,
      },
      'sd-xl-inpainting': {
        displayName: 'Stable Diffusion XL Inpainting',
        type: 'inpaint',
        description: 'Highest quality inpainting, slower processing',
        gpuRequired: true,
      },
    };

    return serverInfo.models.map(modelName => ({
      name: modelName,
      ...modelMap[modelName] || {
        displayName: modelName,
        type: 'inpaint' as const,
        description: 'Unknown model',
        gpuRequired: true,
      },
    }));
  }

  // Validate image file
  private validateImage(file: File): void {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const maxSize = 10 * 1024 * 1024; // 10MB
    
    if (!validTypes.includes(file.type)) {
      throw new IOPaintError('Invalid image format. Please use JPEG, PNG, or WebP.');
    }
    
    if (file.size > maxSize) {
      throw new IOPaintError('Image too large. Maximum size is 10MB.');
    }
  }

  // Process image for inpainting
  async inpaint(request: IOPaintRequest): Promise<IOPaintResponse> {
    // Validate inputs
    this.validateImage(request.image);
    if (request.mask) {
      this.validateImage(request.mask);
    }

    const formData = new FormData();
    
    formData.append('image', request.image, 'image.png');
    if (request.mask) {
      formData.append('mask', request.mask, 'mask.png');
    }
    formData.append('model', request.model);
    
    // Add optional parameters
    if (request.prompt) formData.append('prompt', request.prompt);
    if (request.negativePrompt) formData.append('negative_prompt', request.negativePrompt);
    if (request.strength !== undefined) formData.append('strength', request.strength.toString());
    if (request.guidanceScale !== undefined) formData.append('guidance_scale', request.guidanceScale.toString());
    if (request.steps !== undefined) formData.append('steps', request.steps.toString());
    if (request.seed !== undefined) formData.append('seed', request.seed.toString());

    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/api/v1/inpaint`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
        headers: {
          // Don't set Content-Type, let browser set it with boundary for FormData
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `IOPaint API error: ${response.status}`;
        
        try {
          const errorText = await response.text();
          errorMessage += ` - ${errorText}`;
        } catch {
          errorMessage += ` - ${response.statusText}`;
        }
        
        throw new IOPaintError(errorMessage, response.status);
      }

      const processedImage = await response.blob();
      const processingTime = Date.now() - startTime;
      
      // Extract metadata from response headers
      const metadata = {
        model: response.headers.get('X-Model-Used') || request.model,
        processingTime,
        imageSize: {
          width: Number(response.headers.get('X-Image-Width')) || 0,
          height: Number(response.headers.get('X-Image-Height')) || 0,
        },
      };

      return { processedImage, metadata };
    } catch (error) {
      if (error instanceof IOPaintError) {
        throw error;
      }
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new IOPaintError('Request timed out. Image processing is taking too long.');
      }
      
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new IOPaintError('Cannot connect to IOPaint server. Please check if the server is running.');
      }
      
      throw new IOPaintError(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Batch process multiple images
  async batchInpaint(requests: IOPaintRequest[], onProgress?: (completed: number, total: number) => void): Promise<IOPaintResponse[]> {
    const results: IOPaintResponse[] = [];
    
    for (let i = 0; i < requests.length; i++) {
      try {
        const result = await this.inpaint(requests[i]);
        results.push(result);
        
        if (onProgress) {
          onProgress(i + 1, requests.length);
        }
      } catch (error) {
        console.error(`Batch processing failed for image ${i + 1}:`, error);
        throw error; // Re-throw to stop batch processing on error
      }
    }
    
    return results;
  }

  // Generate mask automatically using SAM (Segment Anything Model) if available
  async generateMask(image: File, points: Array<{x: number, y: number, type: 'positive' | 'negative'}>): Promise<Blob> {
    this.validateImage(image);
    
    const formData = new FormData();
    formData.append('image', image, 'image.png');
    formData.append('points', JSON.stringify(points));

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/sam`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new IOPaintError('Segment Anything Model (SAM) is not available on this server.');
        }
        throw new IOPaintError(`Failed to generate mask: ${response.status} - ${response.statusText}`);
      }

      return response.blob();
    } catch (error) {
      if (error instanceof IOPaintError) {
        throw error;
      }
      throw new IOPaintError(`Mask generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Outpainting - extend image beyond its borders
  async outpaint(image: File, direction: 'top' | 'bottom' | 'left' | 'right' | 'all', pixels: number, model: string = 'stable-diffusion-inpainting'): Promise<IOPaintResponse> {
    this.validateImage(image);
    
    const formData = new FormData();
    formData.append('image', image, 'image.png');
    formData.append('direction', direction);
    formData.append('pixels', pixels.toString());
    formData.append('model', model);

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/outpaint`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new IOPaintError('Outpainting is not available on this server.');
        }
        throw new IOPaintError(`Outpainting failed: ${response.status} - ${response.statusText}`);
      }

      const processedImage = await response.blob();
      
      const metadata = {
        model,
        processingTime: 0, // Not provided by outpaint endpoint
        imageSize: {
          width: 0, // Not provided by outpaint endpoint
          height: 0,
        },
      };

      return { processedImage, metadata };
    } catch (error) {
      if (error instanceof IOPaintError) {
        throw error;
      }
      throw new IOPaintError(`Outpainting failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Helper method to resize image if needed
  async resizeImage(
    file: File,
    maxWidth: number = 1024,
    maxHeight: number = 1024,
    quality: number = 0.9
  ): Promise<File> {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      const img = new Image();
      
      img.onload = () => {
        // Calculate new dimensions
        let { width, height } = img;
        
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }
        
        // Resize image
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to file
        canvas.toBlob((blob) => {
          if (blob) {
            const resizedFile = new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now(),
            });
            resolve(resizedFile);
          } else {
            reject(new Error('Failed to resize image'));
          }
        }, file.type, quality);
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  }
}

// Utility functions
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      const backoffDelay = delay * Math.pow(2, i);
      console.warn(`Attempt ${i + 1} failed, retrying in ${backoffDelay}ms:`, error);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }
  throw new Error('Max retries exceeded');
};

// Create singleton instance
export const iopaintService = new IOPaintService();

// Export types
export type { 
  IOPaintModel, 
  IOPaintRequest, 
  IOPaintResponse, 
  IOPaintServerInfo 
};

export { IOPaintError };

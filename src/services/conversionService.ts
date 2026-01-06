/**
 * File Conversion Service
 * Handles file upload and conversion operations
 */

// Use API_BASE_URL for all requests - nginx now supports large file uploads
const DEFAULT_DEV_API_BASE = 'http://localhost:8081';
const rawApiBase =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? DEFAULT_DEV_API_BASE : '');
const API_BASE_URL = rawApiBase ? rawApiBase.replace(/\/$/, '') : '';

export interface ConversionFile {
  id: string;
  originalName: string;
  filename: string;
  path: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
}

export interface ConversionRequest {
  fileId: string;
  outputFormat: string;
  settings?: {
    quality?: number;
    resolution?: string;
    compression?: string;
    colorSpace?: string;
    bitDepth?: number;
    codec?: string;
  };
}

export interface ConversionResult {
  id: string;
  fileId: string;
  outputFormat: string;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  startedAt: string;
  estimatedCompletion?: string;
  completedAt?: string;
  outputFile?: {
    id: string;
    name: string;
    size: number;
    downloadUrl: string;
  };
  error?: string;
}

export interface SupportedFormats {
  [key: string]: {
    input: string[];
    output: string[];
    settings: {
      [key: string]: {
        min?: number;
        max?: number;
        default?: number | string;
        options?: string[];
      };
    };
  };
}

class ConversionService {
  private userId: string;

  constructor(userId: string = 'default-user') {
    this.userId = userId;
  }

  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'x-user-id': this.userId,
    };
  }

  /**
   * Upload files for conversion with progress tracking
   */
  async uploadFiles(
    files: FileList | FormData, 
    onProgress?: (progress: number) => void
  ): Promise<{ success: boolean; data?: { files: ConversionFile[] }; error?: string }> {
    return new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        
        // Track upload progress
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable && onProgress) {
            const percentComplete = (e.loaded / e.total) * 100;
            onProgress(percentComplete);
          }
        });
        
        // Handle completion
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
              resolve(response);
            } catch (error) {
              resolve({
                success: false,
                error: 'Failed to parse response',
              });
            }
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText);
              resolve({
                success: false,
                error: errorData.message || `HTTP error! status: ${xhr.status}`,
              });
            } catch {
              resolve({
                success: false,
                error: `HTTP error! status: ${xhr.status}`,
              });
            }
          }
        });
        
        // Handle errors
        xhr.addEventListener('error', () => {
          resolve({
            success: false,
            error: 'Network error occurred',
          });
        });
        
        xhr.addEventListener('abort', () => {
          resolve({
            success: false,
            error: 'Upload aborted',
          });
        });
        
        // Prepare form data
        let formData: FormData;
        if (files instanceof FormData) {
          formData = files;
        } else {
          formData = new FormData();
          for (let i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
          }
        }
        
        // Send request through nginx proxy (now supports large files)
        xhr.open('POST', `${API_BASE_URL}/api/conversion/upload`);
        xhr.setRequestHeader('x-user-id', this.userId);
        xhr.send(formData);
        
      } catch (error) {
        console.error('Upload files error:', error);
        resolve({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });
  }

  /**
   * Start file conversion
   */
  async convertFile(request: ConversionRequest): Promise<{ success: boolean; data?: ConversionResult; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/conversion/convert`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Convert file error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get conversion status
   */
  async getConversionStatus(conversionId: string): Promise<{ success: boolean; data?: ConversionResult; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/conversion/status/${conversionId}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get conversion status error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get supported conversion formats
   */
  async getSupportedFormats(): Promise<{ success: boolean; data?: SupportedFormats; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/conversion/formats`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get supported formats error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Download converted file
   */
  async downloadConvertedFile(conversionId: string, filename: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/conversion/download/${conversionId}`, {
        headers: {
          'x-user-id': this.userId,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download converted file error:', error);
      alert(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get conversion history
   */
  async getConversionHistory(page: number = 1, limit: number = 50): Promise<{
    success: boolean;
    data?: {
      conversions: any[];
      count: number;
      limit: number;
      offset: number;
    };
    error?: string;
  }> {
    try {
      const offset = (page - 1) * limit;
      const response = await fetch(
        `${API_BASE_URL}/api/conversion/history?limit=${limit}&offset=${offset}`,
        {
          headers: {
            'x-user-id': this.userId,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get conversion history error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Delete a conversion
   */
  async deleteConversion(conversionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/conversion/${conversionId}`, {
        method: 'DELETE',
        headers: {
          'x-user-id': this.userId,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Delete conversion error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get user storage usage
   */
  async getStorageUsage(): Promise<{
    success: boolean;
    data?: {
      totalFiles: number;
      totalSize: number;
      limit: number;
      percentage: number;
      available: number;
    };
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/conversion/storage`, {
        headers: {
          'x-user-id': this.userId,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get storage usage error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Start batch conversion for multiple files
   */
  async convertBatch(fileIds: string[], outputFormat: string, settings?: any): Promise<{
    success: boolean;
    data?: {
      conversions: any[];
      total: number;
      successful: number;
      failed: number;
      errors?: any[];
    };
    error?: string;
    message?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/conversion/batch`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ fileIds, outputFormat, settings }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Batch convert error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export default ConversionService;

// Video processing engine for VideoStudio

import { VideoFile, VideoEditOperation, VideoStudioSettings } from './types';

export class VideoEngine {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private videoElement: HTMLVideoElement;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d')!;
    this.videoElement = document.createElement('video');
    this.videoElement.crossOrigin = 'anonymous';
  }

  /**
   * Load video file
   */
  async loadVideo(videoFile: VideoFile): Promise<void> {
    return new Promise((resolve, reject) => {
      this.videoElement.onloadedmetadata = () => {
        this.canvas.width = this.videoElement.videoWidth;
        this.canvas.height = this.videoElement.videoHeight;
        resolve();
      };
      
      this.videoElement.onerror = () => {
        reject(new Error('Failed to load video'));
      };
      
      this.videoElement.src = videoFile.url;
    });
  }

  /**
   * Extract frame at specific time
   */
  async extractFrame(timeInSeconds: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.videoElement.currentTime = timeInSeconds;
      
      this.videoElement.onseeked = () => {
        try {
          this.context.drawImage(
            this.videoElement,
            0, 0,
            this.canvas.width,
            this.canvas.height
          );
          
          const dataURL = this.canvas.toDataURL('image/jpeg', 0.8);
          resolve(dataURL);
        } catch (error) {
          reject(error);
        }
      };
    });
  }

  /**
   * Generate video thumbnail
   */
  async generateThumbnail(videoFile: VideoFile): Promise<string> {
    await this.loadVideo(videoFile);
    return this.extractFrame(videoFile.duration * 0.1); // 10% into the video
  }

  /**
   * Apply video filter
   */
  applyFilter(filterType: string, intensity: number = 1): void {
    const imageData = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imageData.data;

    switch (filterType) {
      case 'grayscale':
        for (let i = 0; i < data.length; i += 4) {
          const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          data[i] = data[i + 1] = data[i + 2] = gray * intensity + data[i] * (1 - intensity);
        }
        break;
        
      case 'sepia':
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          
          data[i] = Math.min(255, (r * 0.393) + (g * 0.769) + (b * 0.189)) * intensity + r * (1 - intensity);
          data[i + 1] = Math.min(255, (r * 0.349) + (g * 0.686) + (b * 0.168)) * intensity + g * (1 - intensity);
          data[i + 2] = Math.min(255, (r * 0.272) + (g * 0.534) + (b * 0.131)) * intensity + b * (1 - intensity);
        }
        break;
        
      case 'brightness':
        for (let i = 0; i < data.length; i += 4) {
          data[i] = Math.min(255, Math.max(0, data[i] + (intensity - 1) * 100));
          data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + (intensity - 1) * 100));
          data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + (intensity - 1) * 100));
        }
        break;
    }

    this.context.putImageData(imageData, 0, 0);
  }

  /**
   * Crop video frame
   */
  cropFrame(x: number, y: number, width: number, height: number): void {
    const imageData = this.context.getImageData(x, y, width, height);
    this.canvas.width = width;
    this.canvas.height = height;
    this.context.putImageData(imageData, 0, 0);
  }

  /**
   * Get current frame as data URL
   */
  getCurrentFrame(): string {
    return this.canvas.toDataURL('image/jpeg', 0.9);
  }

  /**
   * Get video metadata
   */
  getVideoMetadata(): {
    width: number;
    height: number;
    duration: number;
    currentTime: number;
  } {
    return {
      width: this.videoElement.videoWidth,
      height: this.videoElement.videoHeight,
      duration: this.videoElement.duration,
      currentTime: this.videoElement.currentTime
    };
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.videoElement.src = '';
    this.videoElement.load();
  }
}
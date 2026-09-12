// TensorFlow.js DeepLab v3 Segmentation Engine - Production Ready with Enhanced Object Detection
// Based on Google's DeepLab v3 semantic segmentation model

// Type declarations for WebGPU (may not be available in all TypeScript versions)
declare global {
  interface Navigator {
    gpu?: {
      requestAdapter(): Promise<any>;
    };
  }
}

export interface SegmentationPoint {
  x: number;
  y: number;
  type: 1 | 0; // 1 for positive, 0 for negative
  id: string;
}

export interface SegmentationMask {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  score: number;
  backend: string;
}

export interface DeepLabConfig {  
  modelType: 'pascal' | 'cityscapes' | 'ade20k';
  threshold: number;
  enableDebugLogs: boolean;
  fallbackToSimpleSegmentation: boolean;
  modelSize?: string;
}

// Enhanced Simple segmentation with edge detection for when TensorFlow.js fails
class SimpleSegmentationEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
  }

  processImage(imageData: ImageData): void {
    this.imageData = imageData;
    this.canvas.width = imageData.width;
    this.canvas.height = imageData.height;
    this.ctx.putImageData(imageData, 0, 0);
  }

  generateEnhancedMask(point: { x: number; y: number }): SegmentationMask | null {
    if (!this.imageData) return null;

    const { width, height, data } = this.imageData;
    
    // Create RGBA mask data (4 bytes per pixel) for ImageData compatibility
    const mask = new Uint8ClampedArray(width * height * 4);
    
    // Enhanced segmentation using edge-aware flood fill
    const targetColor = this.getPixelColor(Math.floor(point.x), Math.floor(point.y));
    if (!targetColor) return null;

    // Calculate edge map using Sobel operator for better boundary detection
    const edgeMap = this.calculateEdgeMap(data, width, height);
    
    const visited = new Set<string>();
    const stack = [{ x: Math.floor(point.x), y: Math.floor(point.y) }];
    
    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      const key = `${x},${y}`;
      
      if (visited.has(key) || x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const currentColor = this.getPixelColor(x, y);
      if (!currentColor) continue;
      
      // Get edge strength at this pixel
      const edgeStrength = edgeMap[y * width + x];
      
      // Use edge-aware color matching - stronger edges need closer color match
      const colorTolerance = 30;
      const adjustedTolerance = colorTolerance * (1 + edgeStrength * 0.5);
      
      if (!this.colorsMatchWithDistance(targetColor, currentColor, adjustedTolerance)) continue;
      
      visited.add(key);
      
      // Set RGBA values for the mask (white mask with full opacity)
      const pixelIndex = (y * width + x) * 4;
      mask[pixelIndex] = 255;     // R - white
      mask[pixelIndex + 1] = 255; // G - white  
      mask[pixelIndex + 2] = 255; // B - white
      mask[pixelIndex + 3] = 255; // A - full opacity
      
      // Add neighboring pixels
      stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
    }

    return {
      data: mask,
      width,
      height,
      score: 0.8, // Higher confidence for enhanced segmentation
      backend: 'enhanced-simple'
    };
  }

  private calculateEdgeMap(data: Uint8ClampedArray, width: number, height: number): Float32Array {
    const edgeMap = new Float32Array(width * height);
    
    // Sobel operators
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0, gy = 0;
        
        // Apply Sobel operators
        for (let i = -1; i <= 1; i++) {
          for (let j = -1; j <= 1; j++) {
            const pixelIndex = ((y + i) * width + (x + j)) * 4;
            const intensity = (data[pixelIndex] + data[pixelIndex + 1] + data[pixelIndex + 2]) / 3;
            const kernelIndex = (i + 1) * 3 + (j + 1);
            
            gx += intensity * sobelX[kernelIndex];
            gy += intensity * sobelY[kernelIndex];
          }
        }
        
        // Calculate edge magnitude
        const edgeMagnitude = Math.sqrt(gx * gx + gy * gy) / 255;
        edgeMap[y * width + x] = Math.min(edgeMagnitude, 1.0);
      }
    }
    
    return edgeMap;
  }

  private getPixelColor(x: number, y: number): [number, number, number] | null {
    if (!this.imageData || x < 0 || x >= this.imageData.width || y < 0 || y >= this.imageData.height) {
      return null;
    }
    
    const { data, width } = this.imageData;
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]];
  }

  private colorsMatchWithDistance(color1: [number, number, number], color2: [number, number, number], threshold: number): boolean {
    const [r1, g1, b1] = color1;
    const [r2, g2, b2] = color2;
    
    // Use Euclidean distance in RGB space for better color matching
    const distance = Math.sqrt(
      Math.pow(r1 - r2, 2) + 
      Math.pow(g1 - g2, 2) + 
      Math.pow(b1 - b2, 2)
    );
    
    return distance < threshold;
  }
}

// TensorFlow.js DeepLab v3 Segmentation Engine - Production Ready
export class TensorFlowSegmentationEngine {
  private tf: any = null;
  private deeplab: any = null;
  private model: any = null;
  private currentImageData: ImageData | null = null;
  private config: DeepLabConfig;
  private simpleSegmentation: SimpleSegmentationEngine;
  private initializationError: string | null = null;
  
  isInitialized: boolean = false;
  originalImageSize: { width: number; height: number } = { width: 0, height: 0 };
  currentImageElement: HTMLImageElement | null = null;

  constructor(config?: Partial<DeepLabConfig>) {
    this.config = {
      modelType: 'pascal',
      threshold: 0.7,
      enableDebugLogs: true,
      fallbackToSimpleSegmentation: true,
      ...config
    };
    this.simpleSegmentation = new SimpleSegmentationEngine();
  }

  async initialize(): Promise<boolean> {
    try {
      this.log('🚀 Initializing TensorFlow.js DeepLab v3 Segmentation Engine...');
      
      // Step 1: Import TensorFlow.js
      try {
        this.log('📦 Importing TensorFlow.js...');
        this.tf = await import('@tensorflow/tfjs');
        await this.tf.ready();
        this.log('✅ TensorFlow.js imported and ready');
      } catch (error) {
        this.initializationError = `Failed to import TensorFlow.js: ${error}`;
        this.logError('❌ Failed to import TensorFlow.js:', error);
        return this.handleInitializationFailure();
      }
      
      // Step 2: Import DeepLab model
      try {
        this.log('🧠 Importing DeepLab v3 model...');
        this.deeplab = await import('@tensorflow-models/deeplab');
        this.log('✅ DeepLab v3 model imported successfully');
      } catch (error) {
        this.initializationError = `Failed to import DeepLab model: ${error}`;
        this.logError('❌ Failed to import DeepLab model:', error);
        return this.handleInitializationFailure();
      }
      
      // Step 3: Load DeepLab model with retries
      try {
        await this.loadDeepLabModel();
        this.log('✅ DeepLab v3 model loaded successfully');
      } catch (error) {
        this.initializationError = `Failed to load DeepLab model: ${error}`;
        this.logError('❌ Failed to load DeepLab model:', error);
        return this.handleInitializationFailure();
      }
      
      this.isInitialized = true;
      this.log('✅ TensorFlow.js DeepLab v3 Segmentation Engine initialized successfully');
      return true;
    } catch (error) {
      this.initializationError = `General initialization error: ${error}`;
      this.logError('❌ Failed to initialize TensorFlow.js Segmentation Engine:', error);
      return this.handleInitializationFailure();
    }
  }

  private handleInitializationFailure(): boolean {
    if (this.config.fallbackToSimpleSegmentation) {
      this.log('🔄 Falling back to enhanced simple segmentation mode');
      this.isInitialized = true; // Mark as initialized to allow fallback usage
      return true;
    }
    return false;
  }

  private log(message: string, ...args: any[]): void {
    if (this.config.enableDebugLogs) {
      console.log(message, ...args);
    }
  }

  private logError(message: string, ...args: any[]): void {
    console.error(message, ...args);
  }

  private logWarn(message: string, ...args: any[]): void {
    console.warn(message, ...args);
  }

  private async loadDeepLabModel(): Promise<void> {
    this.log(`🔄 Loading DeepLab v3 model (${this.config.modelType})...`);
    
    const modelConfig = {
      base: this.config.modelType,
      quantizationBytes: 2 // Use quantization for better performance
    };
    
    // Try loading with retries
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.log(`🔄 Loading attempt ${attempt}/${maxRetries}...`);
        this.model = await this.deeplab.load(modelConfig);
        this.log(`✅ DeepLab v3 model (${this.config.modelType}) loaded successfully`);
        return;
      } catch (error) {
        this.logError(`❌ Load attempt ${attempt}/${maxRetries} failed:`, error);
        if (attempt === maxRetries) {
          throw error;
        }
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async processImage(imageData: ImageData, imageElement: HTMLImageElement): Promise<boolean> {
    if (!this.isInitialized) {
      this.logError('❌ TensorFlow.js engine not initialized');
      return false;
    }

    try {
      this.log('🖼️ Processing image for segmentation...');
      
      this.currentImageData = imageData;
      this.currentImageElement = imageElement;
      this.originalImageSize = { width: imageData.width, height: imageData.height };
      
      // Process enhanced simple segmentation as fallback
      this.simpleSegmentation.processImage(imageData);
      
      this.log('✅ Image processed successfully');
      return true;
    } catch (error) {
      this.logError('❌ Failed to process image:', error);
      return false;
    }
  }

  async generateHoverMask(hoverPoint: { x: number; y: number }): Promise<SegmentationMask | null> {
    if (!this.isInitialized) {
      this.logWarn('⚠️ Segmentation engine not ready for hover mask generation');
      return null;
    }

    // Try TensorFlow.js DeepLab first if available
    if (this.model && this.currentImageElement) {
      try {
        return await this.generateDeepLabMask(hoverPoint);
      } catch (error) {
        this.logError('❌ Failed to generate DeepLab hover mask:', error);
      }
    }

    // Fallback to enhanced simple segmentation
    if (this.config.fallbackToSimpleSegmentation && this.currentImageData) {
      this.log('🔄 Using enhanced simple segmentation for hover mask');
      return this.simpleSegmentation.generateEnhancedMask(hoverPoint);
    }

    return null;
  }

  async generateRealSegmentation(hoverPoint: { x: number; y: number }): Promise<SegmentationMask | null> {
    // For DeepLab, real segmentation is the same as hover mask but with higher quality
    return this.generateHoverMask(hoverPoint);
  }

  async generateMask(points: SegmentationPoint[]): Promise<SegmentationMask | null> {
    if (!this.isInitialized || points.length === 0) {
      this.logWarn('⚠️ Segmentation engine not ready for mask generation');
      return null;
    }

    // Try DeepLab first if available
    if (this.model && this.currentImageElement) {
      try {
        const firstPositivePoint = points.find(p => p.type === 1);
        if (firstPositivePoint) {
          return await this.generateDeepLabMask(firstPositivePoint);
        }
      } catch (error) {
        this.logError('❌ Failed to generate DeepLab mask:', error);
      }
    }

    // Fallback to enhanced simple segmentation using first positive point
    if (this.config.fallbackToSimpleSegmentation && this.currentImageData) {
      this.log('🔄 Using enhanced simple segmentation for multi-point mask');
      const firstPositivePoint = points.find(p => p.type === 1);
      if (firstPositivePoint) {
        return this.simpleSegmentation.generateEnhancedMask(firstPositivePoint);
      }
    }

    return null;
  }

  private async generateDeepLabMask(hoverPoint: { x: number; y: number }): Promise<SegmentationMask | null> {
    if (!this.model || !this.currentImageElement) return null;

    try {
      this.log('🧠 Generating DeepLab semantic segmentation...');
      
      // Run DeepLab segmentation on the entire image
      const segmentationResults = await this.model.segment(this.currentImageElement);
      
      // Extract the segmentation map
      const { segmentationMap, width, height } = segmentationResults;
      
      // Find the class at the clicked point
      const clickedX = Math.floor(hoverPoint.x);
      const clickedY = Math.floor(hoverPoint.y);
      const clickedIndex = clickedY * width + clickedX;
      const targetClass = segmentationMap[clickedIndex];
      
      // Create mask for the target class
      const mask = new Uint8ClampedArray(width * height * 4);
      
      for (let i = 0; i < segmentationMap.length; i++) {
        const pixelIndex = i * 4;
        const isTargetClass = segmentationMap[i] === targetClass;
        
        if (isTargetClass) {
          mask[pixelIndex] = 255;     // R
          mask[pixelIndex + 1] = 255; // G
          mask[pixelIndex + 2] = 255; // B
          mask[pixelIndex + 3] = 255; // A
        } else {
          mask[pixelIndex] = 0;       // R
          mask[pixelIndex + 1] = 0;   // G
          mask[pixelIndex + 2] = 0;   // B
          mask[pixelIndex + 3] = 0;   // A
        }
      }
      
      // Resize mask if needed
      const resizedMask = this.resizeMaskToOriginal(mask, width, height);
      
      this.log(`✅ DeepLab segmentation completed for class ${targetClass}`);
      
      return {
        data: resizedMask,
        width: this.originalImageSize.width,
        height: this.originalImageSize.height,
        score: 0.9, // High confidence for DeepLab
        backend: 'deeplab-v3'
      };
    } catch (error) {
      this.logError('❌ DeepLab segmentation failed:', error);
      throw error;
    }
  }

  private resizeMaskToOriginal(maskData: Uint8ClampedArray, maskWidth: number, maskHeight: number): Uint8ClampedArray {
    if (maskWidth === this.originalImageSize.width && maskHeight === this.originalImageSize.height) {
      return maskData;
    }
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    
    // Create ImageData from RGBA mask data
    const imageData = new ImageData(maskData, maskWidth, maskHeight);
    
    // Draw to canvas and resize
    canvas.width = maskWidth;
    canvas.height = maskHeight;
    ctx.putImageData(imageData, 0, 0);
    
    // Resize to original dimensions
    const resizedCanvas = document.createElement('canvas');
    const resizedCtx = resizedCanvas.getContext('2d')!;
    resizedCanvas.width = this.originalImageSize.width;
    resizedCanvas.height = this.originalImageSize.height;
    
    resizedCtx.drawImage(canvas, 0, 0, this.originalImageSize.width, this.originalImageSize.height);
    
    // Extract RGBA mask data
    const resizedImageData = resizedCtx.getImageData(0, 0, this.originalImageSize.width, this.originalImageSize.height);
    
    return resizedImageData.data;
  }

  getBackendStatus(): { [key: string]: any } {
    return {
      tensorflow: {
        initialized: this.isInitialized,
        modelReady: !!this.model,
        modelType: this.config.modelType,
        fallbackMode: this.config.fallbackToSimpleSegmentation && !this.model,
        initializationError: this.initializationError
      }
    };
  }

  // Legacy compatibility methods
  switchBackend(backend: string): boolean {
    this.log('🔄 TensorFlow.js engine supports tensorflow backend');
    return backend === 'tensorflow' || backend === 'deeplab';
  }

  getAvailableBackends(): string[] {
    return ['tensorflow', 'deeplab'];
  }

  getCurrentBackend(): string {
    return this.model ? 'deeplab-v3' : 'enhanced-simple';
  }
} 

// Export the new engine with the same interface as before
export { TensorFlowSegmentationEngine as SAM2SegmentationEngine };

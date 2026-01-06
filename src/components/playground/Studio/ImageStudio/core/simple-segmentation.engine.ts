// Simple Segmentation Engine - Browser-Optimized
// Uses proven techniques that work reliably in web browsers

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

export interface SimpleSegmentationConfig {
  threshold: number;
  enableDebugLogs: boolean;
  colorTolerance: number;
  edgeDetection: boolean;
}

// Enhanced Segmentation Engine with multiple algorithms
export class SimpleSegmentationEngine {
  private imageData: ImageData | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: SimpleSegmentationConfig;
  
  isInitialized: boolean = false;
  originalImageSize: { width: number; height: number } = { width: 0, height: 0 };

  constructor(config?: Partial<SimpleSegmentationConfig>) {
    this.config = {
      threshold: 0.5,
      enableDebugLogs: true,
      colorTolerance: 30,
      edgeDetection: true,
      ...config
    };
    
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
  }

  async initialize(): Promise<boolean> {
    try {
      this.log('🚀 Initializing Simple Segmentation Engine...');
      this.isInitialized = true;
      this.log('✅ Simple Segmentation Engine ready');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Simple Segmentation Engine:', error);
      return false;
    }
  }

  async processImage(imageData: ImageData, imageElement: HTMLImageElement): Promise<boolean> {
    try {
      this.log('🖼️ Processing image for segmentation...');
      
      this.imageData = imageData;
      this.originalImageSize = { width: imageData.width, height: imageData.height };
      this.canvas.width = imageData.width;
      this.canvas.height = imageData.height;
      this.ctx.putImageData(imageData, 0, 0);
      
      this.log('✅ Image processed successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to process image:', error);
      return false;
    }
  }

  async generateHoverMask(hoverPoint: { x: number; y: number }): Promise<SegmentationMask | null> {
    return this.generateAdvancedMask(hoverPoint);
  }

  async generateRealSegmentation(hoverPoint: { x: number; y: number }): Promise<SegmentationMask | null> {
    return this.generateAdvancedMask(hoverPoint);
  }

  async generateMask(points: SegmentationPoint[]): Promise<SegmentationMask | null> {
    if (points.length === 0) return null;
    
    // Use the first positive point for segmentation
    const firstPositivePoint = points.find(p => p.type === 1);
    if (!firstPositivePoint) return null;
    
    return this.generateAdvancedMask(firstPositivePoint);
  }

  private async generateAdvancedMask(point: { x: number; y: number }): Promise<SegmentationMask | null> {
    if (!this.imageData) return null;

    try {
      // Use enhanced flood fill with edge detection
      const mask = this.config.edgeDetection ? 
        this.edgeAwareFloodFill(point) : 
        this.basicFloodFill(point);
      
      if (!mask) return null;

      return {
        data: mask,
        width: this.originalImageSize.width,
        height: this.originalImageSize.height,
        score: 0.8, // Good confidence for enhanced algorithm
        backend: 'enhanced-simple'
      };
    } catch (error) {
      console.error('❌ Failed to generate advanced mask:', error);
      return null;
    }
  }

  private edgeAwareFloodFill(point: { x: number; y: number }): Uint8ClampedArray | null {
    const { width, height, data } = this.imageData!;
    const mask = new Uint8ClampedArray(width * height * 4);
    
    // Get target color
    const targetColor = this.getPixelColor(Math.floor(point.x), Math.floor(point.y));
    if (!targetColor) return null;

    // Calculate edge strength map for better boundaries
    const edgeMap = this.calculateEdgeMap();
    
    const visited = new Set<string>();
    const stack = [{ x: Math.floor(point.x), y: Math.floor(point.y) }];
    
    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      const key = `${x},${y}`;
      
      if (visited.has(key) || x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const currentColor = this.getPixelColor(x, y);
      if (!currentColor) continue;
      
      // Enhanced color matching with edge consideration
      const colorDistance = this.calculateColorDistance(targetColor, currentColor);
      const edgeStrength = edgeMap[y * width + x];
      
      // Adjust tolerance based on edge strength
      const adjustedTolerance = this.config.colorTolerance * (1 + edgeStrength * 0.5);
      
      if (colorDistance > adjustedTolerance) continue;
      
      visited.add(key);
      
      // Set RGBA values for the mask
      const pixelIndex = (y * width + x) * 4;
      mask[pixelIndex] = 255;     // R
      mask[pixelIndex + 1] = 255; // G
      mask[pixelIndex + 2] = 255; // B
      mask[pixelIndex + 3] = 255; // A
      
      // Add neighboring pixels
      stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
    }

    return mask;
  }

  private basicFloodFill(point: { x: number; y: number }): Uint8ClampedArray | null {
    const { width, height, data } = this.imageData!;
    const mask = new Uint8ClampedArray(width * height * 4);
    
    const targetColor = this.getPixelColor(Math.floor(point.x), Math.floor(point.y));
    if (!targetColor) return null;

    const visited = new Set<string>();
    const stack = [{ x: Math.floor(point.x), y: Math.floor(point.y) }];
    
    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      const key = `${x},${y}`;
      
      if (visited.has(key) || x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const currentColor = this.getPixelColor(x, y);
      if (!currentColor || !this.colorsMatch(targetColor, currentColor, this.config.colorTolerance)) continue;
      
      visited.add(key);
      
      const pixelIndex = (y * width + x) * 4;
      mask[pixelIndex] = 255;     // R
      mask[pixelIndex + 1] = 255; // G
      mask[pixelIndex + 2] = 255; // B
      mask[pixelIndex + 3] = 255; // A
      
      stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
    }

    return mask;
  }

  private calculateEdgeMap(): Float32Array {
    const { width, height } = this.imageData!;
    const edgeMap = new Float32Array(width * height);
    
    // Simple Sobel edge detection
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const gx = this.getSobelX(x, y);
        const gy = this.getSobelY(x, y);
        const magnitude = Math.sqrt(gx * gx + gy * gy) / 255.0; // Normalize
        edgeMap[y * width + x] = magnitude;
      }
    }
    
    return edgeMap;
  }

  private getSobelX(x: number, y: number): number {
    const colors = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const color = this.getPixelColor(x + dx, y + dy);
        colors.push(color ? this.getGrayscale(color) : 0);
      }
    }
    
    // Sobel X kernel: [-1, 0, 1; -2, 0, 2; -1, 0, 1]
    return (-1 * colors[0] + 1 * colors[2] +
            -2 * colors[3] + 2 * colors[5] +
            -1 * colors[6] + 1 * colors[8]);
  }

  private getSobelY(x: number, y: number): number {
    const colors = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const color = this.getPixelColor(x + dx, y + dy);
        colors.push(color ? this.getGrayscale(color) : 0);
      }
    }
    
    // Sobel Y kernel: [-1, -2, -1; 0, 0, 0; 1, 2, 1]
    return (-1 * colors[0] + -2 * colors[1] + -1 * colors[2] +
             1 * colors[6] +  2 * colors[7] +  1 * colors[8]);
  }

  private getGrayscale(color: [number, number, number]): number {
    return 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
  }

  private calculateColorDistance(color1: [number, number, number], color2: [number, number, number]): number {
    const dr = color1[0] - color2[0];
    const dg = color1[1] - color2[1];
    const db = color1[2] - color2[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  private getPixelColor(x: number, y: number): [number, number, number] | null {
    if (!this.imageData || x < 0 || x >= this.imageData.width || y < 0 || y >= this.imageData.height) {
      return null;
    }
    
    const { data, width } = this.imageData;
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]];
  }

  private colorsMatch(color1: [number, number, number], color2: [number, number, number], threshold: number): boolean {
    return this.calculateColorDistance(color1, color2) < threshold;
  }

  private log(message: string, ...args: any[]): void {
    if (this.config.enableDebugLogs) {
      console.log(message, ...args);
    }
  }

  getBackendStatus(): { [key: string]: any } {
    return {
      simple: {
        initialized: this.isInitialized,
        imageReady: !!this.imageData,
        edgeDetection: this.config.edgeDetection,
        colorTolerance: this.config.colorTolerance
      }
    };
  }

  switchBackend(backend: string): boolean {
    return backend === 'simple';
  }

  getAvailableBackends(): string[] {
    return ['simple'];
  }

  getCurrentBackend(): string {
    return 'simple';
  }
} 
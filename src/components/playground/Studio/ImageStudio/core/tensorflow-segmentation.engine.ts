// TensorFlow.js DeepLab v3 Segmentation Engine - Production Ready with Enhanced Object Detection
// Based on Google's DeepLab v3 semantic segmentation model

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
}

// Enhanced Simple segmentation with edge detection and region growing for when TensorFlow.js fails
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
    
    // Enhanced segmentation using multiple algorithms
    const targetColor = this.getPixelColor(Math.floor(point.x), Math.floor(point.y));
    if (!targetColor) return null;

    console.log('🎯 Enhanced segmentation at point:', point);
    console.log('🎨 Target color:', targetColor);

    // Analyze the clicked region to determine if it's likely background or foreground
    const regionAnalysis = this.analyzeClickedRegion(data, width, height, Math.floor(point.x), Math.floor(point.y));
    console.log('📊 Region analysis:', regionAnalysis);

    // Try different segmentation approaches with different parameters based on analysis
    const approaches = [
      () => this.smartRegionGrowing(point, mask, width, height, data, regionAnalysis),
      () => this.regionGrowingSegmentation(point, mask, width, height, data),
      () => this.edgeAwareFloodFill(point, mask, width, height, data),
      () => this.watershedSegmentation(point, mask, width, height, data)
    ];

    for (let i = 0; i < approaches.length; i++) {
      try {
        console.log(`🔄 Trying approach ${i + 1}/${approaches.length}`);
        const result = approaches[i]();
        if (result && this.validateMask(result, width, height)) {
          // Count pixels for logging
          let pixelCount = 0;
          for (let j = 0; j < result.length; j += 4) {
            if (result[j] > 0) pixelCount++;
          }
          const coverage = pixelCount / (width * height);
          console.log(`✅ Approach ${i + 1} succeeded - Coverage: ${(coverage * 100).toFixed(2)}%`);
          
          return {
            data: result,
            width,
            height,
            score: 0.85,
            backend: `enhanced-simple-${i + 1}`
          };
        } else {
          console.log(`❌ Approach ${i + 1} failed validation`);
        }
      } catch (error) {
        console.warn(`❌ Approach ${i + 1} failed with error:`, error);
      }
    }

    // Fallback to basic flood fill
    console.log('🔄 Falling back to basic flood fill');
    return this.basicFloodFill(point, mask, width, height, data);
  }

  private regionGrowingSegmentation(point: { x: number; y: number }, mask: Uint8ClampedArray, width: number, height: number, data: Uint8ClampedArray): Uint8ClampedArray | null {
    const targetColor = this.getPixelColor(Math.floor(point.x), Math.floor(point.y));
    if (!targetColor) return null;

    const visited = new Set<string>();
    const seeds = [{ x: Math.floor(point.x), y: Math.floor(point.y) }];
    const region: Array<{ x: number; y: number }> = [];
    
    // Calculate local statistics around the clicked point for better thresholding
    const localStats = this.calculateLocalStats(data, width, height, Math.floor(point.x), Math.floor(point.y), 20);
    const globalStats = this.calculateImageStats(data, width, height);
    
    // Use much more conservative threshold - start small and be selective
    const baseThreshold = Math.min(15, localStats.stdDev * 0.3);
    const maxRegionSize = Math.floor((width * height) * 0.3); // Limit to 30% of image
    
    while (seeds.length > 0 && region.length < maxRegionSize) {
      const { x, y } = seeds.pop()!;
      const key = `${x},${y}`;
      
      if (visited.has(key) || x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const currentColor = this.getPixelColor(x, y);
      if (!currentColor) continue;
      
      // Calculate distance from target color
      const colorDistance = this.calculateColorDistance(targetColor, currentColor);
      
      // Use very conservative matching - only very similar colors
      if (colorDistance < baseThreshold) {
        visited.add(key);
        region.push({ x, y });
        
        // Only add 4-connected neighbors to be more conservative
        const neighbors = [
          { x: x + 1, y },
          { x: x - 1, y },
          { x, y: y + 1 },
          { x, y: y - 1 }
        ];
        
        for (const neighbor of neighbors) {
          const neighborKey = `${neighbor.x},${neighbor.y}`;
          if (!visited.has(neighborKey)) {
            seeds.push(neighbor);
          }
        }
      }
    }

    // Only return result if we found a reasonable region (not too small, not too large)
    const coverage = region.length / (width * height);
    if (coverage < 0.005 || coverage > 0.4) {
      return null; // Region too small or too large
    }

    // Fill the mask
    const resultMask = new Uint8ClampedArray(width * height * 4);
    for (const { x, y } of region) {
      const pixelIndex = (y * width + x) * 4;
      resultMask[pixelIndex] = 255;     // R
      resultMask[pixelIndex + 1] = 255; // G
      resultMask[pixelIndex + 2] = 255; // B
      resultMask[pixelIndex + 3] = 255; // A
    }

    return resultMask;
  }

  private edgeAwareFloodFill(point: { x: number; y: number }, mask: Uint8ClampedArray, width: number, height: number, data: Uint8ClampedArray): Uint8ClampedArray | null {
    const targetColor = this.getPixelColor(Math.floor(point.x), Math.floor(point.y));
    if (!targetColor) return null;

    // Calculate edge map using Sobel operator
    const edgeMap = this.calculateEdgeMap(data, width, height);
    
    const visited = new Set<string>();
    const stack = [{ x: Math.floor(point.x), y: Math.floor(point.y) }];
    const resultMask = new Uint8ClampedArray(width * height * 4);
    const maxRegionSize = Math.floor((width * height) * 0.25); // Limit to 25% of image
    let pixelCount = 0;
    
    while (stack.length > 0 && pixelCount < maxRegionSize) {
      const { x, y } = stack.pop()!;
      const key = `${x},${y}`;
      
      if (visited.has(key) || x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const currentColor = this.getPixelColor(x, y);
      if (!currentColor) continue;
      
      // Get edge strength at this pixel
      const edgeStrength = edgeMap[y * width + x];
      
      // Use much more conservative thresholds
      const baseThreshold = 18; // Reduced from 35
      const adjustedThreshold = baseThreshold * (1 - edgeStrength * 0.6); // Stronger edge influence
      
      // Stop at strong edges
      if (edgeStrength > 0.4) continue;
      
      const colorDistance = this.calculateColorDistance(targetColor, currentColor);
      
      if (colorDistance < adjustedThreshold) {
        visited.add(key);
        pixelCount++;
        
        // Set mask pixel
        const pixelIndex = (y * width + x) * 4;
        resultMask[pixelIndex] = 255;
        resultMask[pixelIndex + 1] = 255;
        resultMask[pixelIndex + 2] = 255;
        resultMask[pixelIndex + 3] = 255;
        
        // Add 4-connected neighbors
        stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
      }
    }

    // Validate region size
    const coverage = pixelCount / (width * height);
    if (coverage < 0.003 || coverage > 0.35) {
      return null; // Region too small or too large
    }

    return resultMask;
  }

  private watershedSegmentation(point: { x: number; y: number }, mask: Uint8ClampedArray, width: number, height: number, data: Uint8ClampedArray): Uint8ClampedArray | null {
    // Simplified watershed-like segmentation
    const targetColor = this.getPixelColor(Math.floor(point.x), Math.floor(point.y));
    if (!targetColor) return null;

    const gradientMap = this.calculateGradientMap(data, width, height);
    const visited = new Set<string>();
    const queue = [{ x: Math.floor(point.x), y: Math.floor(point.y), priority: 0 }];
    const resultMask = new Uint8ClampedArray(width * height * 4);
    
    // Priority queue simulation (simplified)
    queue.sort((a, b) => a.priority - b.priority);
    
    while (queue.length > 0) {
      const { x, y } = queue.shift()!;
      const key = `${x},${y}`;
      
      if (visited.has(key) || x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const currentColor = this.getPixelColor(x, y);
      if (!currentColor) continue;
      
      const gradient = gradientMap[y * width + x];
      const colorDistance = this.calculateColorDistance(targetColor, currentColor);
      
      // Combine color similarity and gradient information
      if (colorDistance < 40 && gradient < 0.3) {
        visited.add(key);
        
        const pixelIndex = (y * width + x) * 4;
        resultMask[pixelIndex] = 255;
        resultMask[pixelIndex + 1] = 255;
        resultMask[pixelIndex + 2] = 255;
        resultMask[pixelIndex + 3] = 255;
        
        // Add neighbors with priority based on gradient
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const neighborGradient = gradientMap[ny * width + nx];
              queue.push({ x: nx, y: ny, priority: neighborGradient });
            }
          }
        }
        
        queue.sort((a, b) => a.priority - b.priority);
      }
    }

    return resultMask;
  }

  private basicFloodFill(point: { x: number; y: number }, mask: Uint8ClampedArray, width: number, height: number, data: Uint8ClampedArray): SegmentationMask {
    const targetColor = this.getPixelColor(Math.floor(point.x), Math.floor(point.y));
    if (!targetColor) {
      return {
        data: mask,
        width,
        height,
        score: 0.1,
        backend: 'basic-fallback'
      };
    }

    const visited = new Set<string>();
    const stack = [{ x: Math.floor(point.x), y: Math.floor(point.y) }];
    const maxRegionSize = Math.floor((width * height) * 0.2); // Limit to 20% of image
    let pixelCount = 0;
    
    // Calculate local color variance for adaptive threshold
    const localStats = this.calculateLocalStats(data, width, height, Math.floor(point.x), Math.floor(point.y), 15);
    const adaptiveThreshold = Math.max(8, Math.min(20, localStats.stdDev * 0.4)); // Very conservative
    
    while (stack.length > 0 && pixelCount < maxRegionSize) {
      const { x, y } = stack.pop()!;
      const key = `${x},${y}`;
      
      if (visited.has(key) || x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const currentColor = this.getPixelColor(x, y);
      if (!currentColor) continue;
      
      const colorDistance = this.calculateColorDistance(targetColor, currentColor);
      
      if (colorDistance < adaptiveThreshold) {
        visited.add(key);
        pixelCount++;
        
        const pixelIndex = (y * width + x) * 4;
        mask[pixelIndex] = 255;
        mask[pixelIndex + 1] = 255;
        mask[pixelIndex + 2] = 255;
        mask[pixelIndex + 3] = 255;
        
        // Only add 4-connected neighbors
        stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
      }
    }

    // Validate the result
    const coverage = pixelCount / (width * height);
    const score = coverage > 0.002 && coverage < 0.3 ? 0.7 : 0.3;

    return {
      data: mask,
      width,
      height,
      score,
      backend: 'basic-fallback'
    };
  }

  private calculateImageStats(data: Uint8ClampedArray, width: number, height: number): { mean: number; stdDev: number } {
    let sum = 0;
    let count = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const intensity = (data[i] + data[i + 1] + data[i + 2]) / 3;
      sum += intensity;
      count++;
    }
    
    const mean = sum / count;
    let variance = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const intensity = (data[i] + data[i + 1] + data[i + 2]) / 3;
      variance += Math.pow(intensity - mean, 2);
    }
    
    const stdDev = Math.sqrt(variance / count);
    return { mean, stdDev };
  }

  private calculateLocalStats(data: Uint8ClampedArray, width: number, height: number, centerX: number, centerY: number, radius: number): { mean: number; stdDev: number } {
    let sum = 0;
    let count = 0;
    const colors: number[] = [];
    
    // Sample pixels in a square region around the center point
    const minX = Math.max(0, centerX - radius);
    const maxX = Math.min(width - 1, centerX + radius);
    const minY = Math.max(0, centerY - radius);
    const maxY = Math.min(height - 1, centerY + radius);
    
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const pixelIndex = (y * width + x) * 4;
        const r = data[pixelIndex];
        const g = data[pixelIndex + 1];
        const b = data[pixelIndex + 2];
        
        // Calculate color distance from center pixel
        const centerPixelIndex = (centerY * width + centerX) * 4;
        const centerR = data[centerPixelIndex];
        const centerG = data[centerPixelIndex + 1];
        const centerB = data[centerPixelIndex + 2];
        
        const colorDistance = Math.sqrt(
          Math.pow(r - centerR, 2) + 
          Math.pow(g - centerG, 2) + 
          Math.pow(b - centerB, 2)
        );
        
        colors.push(colorDistance);
        sum += colorDistance;
        count++;
      }
    }
    
    const mean = count > 0 ? sum / count : 0;
    let variance = 0;
    
    for (const colorDistance of colors) {
      variance += Math.pow(colorDistance - mean, 2);
    }
    
    const stdDev = count > 0 ? Math.sqrt(variance / count) : 0;
    return { mean, stdDev };
  }

  private calculateGradientMap(data: Uint8ClampedArray, width: number, height: number): Float32Array {
    const gradientMap = new Float32Array(width * height);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const pixelIdx = idx * 4;
        
        // Calculate gradient using central differences
        const leftIdx = (y * width + (x - 1)) * 4;
        const rightIdx = (y * width + (x + 1)) * 4;
        const topIdx = ((y - 1) * width + x) * 4;
        const bottomIdx = ((y + 1) * width + x) * 4;
        
        const gx = (data[rightIdx] - data[leftIdx]) / 2;
        const gy = (data[bottomIdx] - data[topIdx]) / 2;
        
        gradientMap[idx] = Math.sqrt(gx * gx + gy * gy) / 255;
      }
    }
    
    return gradientMap;
  }

  private validateMask(mask: Uint8ClampedArray, width: number, height: number): boolean {
    let pixelCount = 0;
    for (let i = 0; i < mask.length; i += 4) {
      if (mask[i] > 0) pixelCount++;
    }
    
    const totalPixels = width * height;
    const coverage = pixelCount / totalPixels;
    
    // Much stricter validation - reject masks that are too large or too small
    return coverage > 0.002 && coverage < 0.35;
  }

  private calculateColorDistance(color1: [number, number, number], color2: [number, number, number]): number {
    const [r1, g1, b1] = color1;
    const [r2, g2, b2] = color2;
    return Math.sqrt(Math.pow(r1 - r2, 2) + Math.pow(g1 - g2, 2) + Math.pow(b1 - b2, 2));
  }

  private smoothRegionBoundaries(
    region: Array<{ x: number; y: number }>, 
    width: number, 
    height: number, 
    data: Uint8ClampedArray
  ): Array<{ x: number; y: number }> {
    // Create a set for fast lookup
    const regionSet = new Set(region.map(p => `${p.x},${p.y}`));
    const smoothedRegion: Array<{ x: number; y: number }> = [];
    
    for (const { x, y } of region) {
      // Count neighbors in the region
      let neighborCount = 0;
      const neighbors = [
        { x: x - 1, y: y - 1 }, { x, y: y - 1 }, { x: x + 1, y: y - 1 },
        { x: x - 1, y }, { x: x + 1, y },
        { x: x - 1, y: y + 1 }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }
      ];
      
      for (const neighbor of neighbors) {
        if (neighbor.x >= 0 && neighbor.x < width && 
            neighbor.y >= 0 && neighbor.y < height &&
            regionSet.has(`${neighbor.x},${neighbor.y}`)) {
          neighborCount++;
        }
      }
      
      // Keep pixels that have at least 3 neighbors (removes isolated pixels and thin protrusions)
      if (neighborCount >= 3) {
        smoothedRegion.push({ x, y });
      }
    }
    
    return smoothedRegion.length > region.length * 0.7 ? smoothedRegion : region;
  }

  private analyzeClickedRegion(data: Uint8ClampedArray, width: number, height: number, centerX: number, centerY: number): { 
    isLikelyBackground: boolean; 
    colorVariance: number; 
    edgeDensity: number;
    position: 'edge' | 'center' | 'corner';
  } {
    const radius = 25;
    const minX = Math.max(0, centerX - radius);
    const maxX = Math.min(width - 1, centerX + radius);
    const minY = Math.max(0, centerY - radius);
    const maxY = Math.min(height - 1, centerY + radius);
    
    const centerColor = this.getPixelColor(centerX, centerY);
    if (!centerColor) {
      return { isLikelyBackground: true, colorVariance: 0, edgeDensity: 0, position: 'center' };
    }
    
    let colorVarianceSum = 0;
    let edgeCount = 0;
    let sampleCount = 0;
    
    // Sample the region around the click point
    for (let y = minY; y <= maxY; y += 2) { // Sample every 2nd pixel for performance
      for (let x = minX; x <= maxX; x += 2) {
        const color = this.getPixelColor(x, y);
        if (color) {
          const distance = this.calculateColorDistance(centerColor, color);
          colorVarianceSum += distance;
          
          // Check if this is an edge pixel
          if (distance > 30) {
            edgeCount++;
          }
          
          sampleCount++;
        }
      }
    }
    
    const colorVariance = sampleCount > 0 ? colorVarianceSum / sampleCount : 0;
    const edgeDensity = sampleCount > 0 ? edgeCount / sampleCount : 0;
    
    // Determine position relative to image
    const relativeX = centerX / width;
    const relativeY = centerY / height;
    const distanceFromCenter = Math.sqrt(Math.pow(relativeX - 0.5, 2) + Math.pow(relativeY - 0.5, 2));
    
    let position: 'edge' | 'center' | 'corner' = 'center';
    if (relativeX < 0.1 || relativeX > 0.9 || relativeY < 0.1 || relativeY > 0.9) {
      position = 'edge';
    } else if ((relativeX < 0.2 && relativeY < 0.2) || (relativeX > 0.8 && relativeY > 0.8) || 
               (relativeX < 0.2 && relativeY > 0.8) || (relativeX > 0.8 && relativeY < 0.2)) {
      position = 'corner';
    }
    
    // Background is likely if:
    // - High color variance (textured background)
    // - Low edge density (uniform background)
    // - Near edges/corners of image
    const isLikelyBackground = (colorVariance > 40 && edgeDensity < 0.3) || 
                               (position === 'edge' && colorVariance > 20) ||
                               (position === 'corner');
    
    return { isLikelyBackground, colorVariance, edgeDensity, position };
  }

  private smartRegionGrowing(
    point: { x: number; y: number }, 
    mask: Uint8ClampedArray, 
    width: number, 
    height: number, 
    data: Uint8ClampedArray,
    analysis: { isLikelyBackground: boolean; colorVariance: number; edgeDensity: number; position: string }
  ): Uint8ClampedArray | null {
    const targetColor = this.getPixelColor(Math.floor(point.x), Math.floor(point.y));
    if (!targetColor) return null;

    const visited = new Set<string>();
    const seeds = [{ x: Math.floor(point.x), y: Math.floor(point.y) }];
    const region: Array<{ x: number; y: number }> = [];
    
    // Calculate edge map for better boundary detection
    const edgeMap = this.calculateEdgeMap(data, width, height);
    
    // Adjust parameters based on analysis
    let baseThreshold: number;
    let maxRegionSize: number;
    let edgeStopThreshold: number;
    
    if (analysis.isLikelyBackground) {
      // For background: be more aggressive but respect strong edges
      baseThreshold = Math.min(30, Math.max(15, analysis.colorVariance * 0.5));
      maxRegionSize = Math.floor((width * height) * 0.4); // Reduced from 0.6
      edgeStopThreshold = 0.3; // Stop at moderate edges
    } else {
      // For foreground objects: be very conservative and respect all edges
      baseThreshold = Math.min(20, Math.max(10, analysis.colorVariance * 0.3));
      maxRegionSize = Math.floor((width * height) * 0.15); // Reduced from 0.2
      edgeStopThreshold = 0.2; // Stop at weaker edges for objects
    }
    
    console.log(`🧠 Smart segmentation - Background: ${analysis.isLikelyBackground}, Threshold: ${baseThreshold}, Max size: ${(maxRegionSize / (width * height) * 100).toFixed(1)}%, Edge threshold: ${edgeStopThreshold}`);
    
    while (seeds.length > 0 && region.length < maxRegionSize) {
      const { x, y } = seeds.pop()!;
      const key = `${x},${y}`;
      
      if (visited.has(key) || x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const currentColor = this.getPixelColor(x, y);
      if (!currentColor) continue;
      
      // Check edge strength at this pixel
      const edgeStrength = edgeMap[y * width + x];
      
      // Stop at strong edges
      if (edgeStrength > edgeStopThreshold) continue;
      
      // Use adaptive threshold based on distance from seed point
      const distanceFromSeed = Math.sqrt(
        Math.pow(x - Math.floor(point.x), 2) + 
        Math.pow(y - Math.floor(point.y), 2)
      );
      const distanceFactor = Math.max(0.5, 1 - (distanceFromSeed / 50)); // Reduce threshold with distance
      const adaptiveThreshold = baseThreshold * distanceFactor;
      
      const colorDistance = this.calculateColorDistance(targetColor, currentColor);
      
      if (colorDistance < adaptiveThreshold) {
        visited.add(key);
        region.push({ x, y });
        
        // Add neighbors with priority based on color similarity
        const neighbors = analysis.isLikelyBackground ? 
          // 8-connected for background
          [
            { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
            { x: x + 1, y: y + 1 }, { x: x - 1, y: y - 1 }, 
            { x: x + 1, y: y - 1 }, { x: x - 1, y: y + 1 }
          ] :
          // 4-connected for objects
          [
            { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }
          ];
        
        // Sort neighbors by color similarity to prioritize similar colors
        const neighborsWithPriority = neighbors.map(neighbor => {
          const neighborColor = this.getPixelColor(neighbor.x, neighbor.y);
          const priority = neighborColor ? 
            this.calculateColorDistance(targetColor, neighborColor) : 999;
          return { ...neighbor, priority };
        }).sort((a, b) => a.priority - b.priority);
        
        // Add neighbors in order of similarity
        for (const neighbor of neighborsWithPriority) {
          const neighborKey = `${neighbor.x},${neighbor.y}`;
          if (!visited.has(neighborKey)) {
            seeds.push({ x: neighbor.x, y: neighbor.y });
          }
        }
      }
    }

    // Validate region size with stricter limits
    const coverage = region.length / (width * height);
    const minCoverage = analysis.isLikelyBackground ? 0.005 : 0.002;
    const maxCoverage = analysis.isLikelyBackground ? 0.25 : 0.12;
    
    if (coverage < minCoverage || coverage > maxCoverage) {
      console.log(`❌ Smart segmentation failed validation - Coverage: ${(coverage * 100).toFixed(2)}%`);
      return null;
    }

    // Post-process the region to smooth boundaries
    const smoothedRegion = this.smoothRegionBoundaries(region, width, height, data);
    
    // Fill the mask
    const resultMask = new Uint8ClampedArray(width * height * 4);
    for (const { x, y } of smoothedRegion) {
      const pixelIndex = (y * width + x) * 4;
      resultMask[pixelIndex] = 255;
      resultMask[pixelIndex + 1] = 255;
      resultMask[pixelIndex + 2] = 255;
      resultMask[pixelIndex + 3] = 255;
    }

    console.log(`✅ Smart segmentation completed - Final coverage: ${(smoothedRegion.length / (width * height) * 100).toFixed(2)}%`);
    return resultMask;
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
    
    // Try different model configurations based on common issues
    const modelConfigs = [
      {
        base: this.config.modelType,
        quantizationBytes: 2
      },
      {
        base: this.config.modelType,
        quantizationBytes: 4 // Disable quantization if 2 bytes fails
      },
      {
        base: 'pascal', // Fallback to pascal if other models fail
        quantizationBytes: 2
      }
    ];
    
    // Try loading with retries and different configurations
    const maxRetries = 3;
    
    for (const modelConfig of modelConfigs) {
      this.log(`🔄 Trying model config:`, modelConfig);
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          this.log(`🔄 Loading attempt ${attempt}/${maxRetries} with config:`, modelConfig);
          
          // Set a timeout for model loading
          const loadPromise = this.deeplab.load(modelConfig);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Model loading timeout')), 30000)
          );
          
          this.model = await Promise.race([loadPromise, timeoutPromise]);
          this.log(`✅ DeepLab v3 model loaded successfully with config:`, modelConfig);
          return;
        } catch (error) {
          this.logError(`❌ Load attempt ${attempt}/${maxRetries} failed with config:`, modelConfig, error);
          if (attempt < maxRetries) {
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
    }
    
    throw new Error('Failed to load DeepLab model with all configurations');
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

    this.log('🎯 Generating hover mask at point:', hoverPoint);
    this.log('🔍 Engine status - Model ready:', !!this.model, 'Image element ready:', !!this.currentImageElement);

    // Try TensorFlow.js DeepLab first if available
    if (this.model && this.currentImageElement) {
      try {
        this.log('🧠 Attempting DeepLab segmentation...');
        const result = await this.generateDeepLabMask(hoverPoint);
        if (result) {
          this.log('✅ DeepLab segmentation successful');
          return result;
        } else {
          this.log('⚠️ DeepLab returned null result');
        }
      } catch (error) {
        this.logError('❌ Failed to generate DeepLab hover mask:', error);
      }
    } else {
      this.log('⚠️ DeepLab not available - Model:', !!this.model, 'Image:', !!this.currentImageElement);
    }

    // Fallback to enhanced simple segmentation
    if (this.config.fallbackToSimpleSegmentation && this.currentImageData) {
      this.log('🔄 Using enhanced simple segmentation for hover mask');
      try {
        const result = this.simpleSegmentation.generateEnhancedMask(hoverPoint);
        if (result) {
          this.log('✅ Enhanced simple segmentation successful');
          return result;
        } else {
          this.log('⚠️ Enhanced simple segmentation returned null');
        }
      } catch (error) {
        this.logError('❌ Enhanced simple segmentation failed:', error);
      }
    }

    this.logWarn('❌ All segmentation methods failed');
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
      this.log('Hover point:', hoverPoint);
      this.log('Original image size:', this.originalImageSize);
      
      // Run DeepLab segmentation on the entire image
      const segmentationResults = await this.model.segment(this.currentImageElement);
      
      // Extract the segmentation map
      const { segmentationMap, width, height } = segmentationResults;
      this.log('DeepLab output dimensions:', { width, height });
      this.log('Segmentation map length:', segmentationMap.length);
      
      // Map hover point coordinates to DeepLab output coordinates
      const scaleX = width / this.originalImageSize.width;
      const scaleY = height / this.originalImageSize.height;
      
      const mappedX = Math.floor(hoverPoint.x * scaleX);
      const mappedY = Math.floor(hoverPoint.y * scaleY);
      
      // Ensure coordinates are within bounds
      const clampedX = Math.max(0, Math.min(width - 1, mappedX));
      const clampedY = Math.max(0, Math.min(height - 1, mappedY));
      
      this.log('Mapped coordinates:', { mappedX, mappedY, clampedX, clampedY });
      
      // Find the class at the clicked point
      const clickedIndex = clampedY * width + clampedX;
      const targetClass = segmentationMap[clickedIndex];
      
      this.log(`Target class at point: ${targetClass}`);
      
      // Count pixels for each class to understand the segmentation
      const classCounts = new Map<number, number>();
      for (let i = 0; i < segmentationMap.length; i++) {
        const classId = segmentationMap[i];
        classCounts.set(classId, (classCounts.get(classId) || 0) + 1);
      }
      
      this.log('Class distribution:', Object.fromEntries(classCounts));
      
      // If the target class covers too much of the image, it's likely the background class
      // In this case, use connected component analysis to get just the region around the click
      const targetClassPixels = classCounts.get(targetClass) || 0;
      const totalPixels = width * height;
      const coverage = targetClassPixels / totalPixels;
      
      this.log(`Target class ${targetClass} coverage: ${(coverage * 100).toFixed(1)}%`);
      
      if (coverage > 0.7) {
        // This is likely a background class that covers most of the image
        // Use connected component analysis to get just the connected region
        this.log('🔄 Target class covers >70% of image, using connected component analysis...');
        
        const connectedMask = this.getConnectedComponent(segmentationMap, width, height, clampedX, clampedY, targetClass);
        if (connectedMask) {
          const resizedMask = this.resizeMaskToOriginal(connectedMask, width, height);
          
          // Count pixels in connected component
          let connectedPixels = 0;
          for (let i = 0; i < connectedMask.length; i += 4) {
            if (connectedMask[i] > 0) connectedPixels++;
          }
          
          this.log(`Connected component has ${connectedPixels} pixels (${(connectedPixels / totalPixels * 100).toFixed(1)}%)`);
          
          return {
            data: resizedMask,
            width: this.originalImageSize.width,
            height: this.originalImageSize.height,
            score: 0.8,
            backend: 'deeplab-v3-connected'
          };
        }
      }
      
      // For smaller classes or if connected component failed, use the full class mask
      const mask = new Uint8ClampedArray(width * height * 4);
      let pixelCount = 0;
      
      for (let i = 0; i < segmentationMap.length; i++) {
        const pixelIndex = i * 4;
        const isTargetClass = segmentationMap[i] === targetClass;
        
        if (isTargetClass) {
          mask[pixelIndex] = 255;     // R
          mask[pixelIndex + 1] = 255; // G
          mask[pixelIndex + 2] = 255; // B
          mask[pixelIndex + 3] = 255; // A
          pixelCount++;
        } else {
          mask[pixelIndex] = 0;       // R
          mask[pixelIndex + 1] = 0;   // G
          mask[pixelIndex + 2] = 0;   // B
          mask[pixelIndex + 3] = 0;   // A
        }
      }
      
      this.log(`Full class mask created with ${pixelCount} pixels for class ${targetClass}`);
      
      // If the mask is still too large, reject it and fall back to simple segmentation
      if (coverage > 0.5) {
        this.log('❌ DeepLab mask too large, rejecting...');
        throw new Error('DeepLab mask covers too much of the image');
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

  private getConnectedComponent(
    segmentationMap: Uint8Array | Int32Array, 
    width: number, 
    height: number, 
    startX: number, 
    startY: number, 
    targetClass: number
  ): Uint8ClampedArray | null {
    const visited = new Set<string>();
    const stack = [{ x: startX, y: startY }];
    const connectedPixels: Array<{ x: number; y: number }> = [];
    const maxRegionSize = Math.floor((width * height) * 0.4); // Limit to 40% of image
    
    while (stack.length > 0 && connectedPixels.length < maxRegionSize) {
      const { x, y } = stack.pop()!;
      const key = `${x},${y}`;
      
      if (visited.has(key) || x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const index = y * width + x;
      if (segmentationMap[index] !== targetClass) continue;
      
      visited.add(key);
      connectedPixels.push({ x, y });
      
      // Add 4-connected neighbors
      stack.push(
        { x: x + 1, y },
        { x: x - 1, y },
        { x, y: y + 1 },
        { x, y: y - 1 }
      );
    }
    
    // Validate the connected component size
    const coverage = connectedPixels.length / (width * height);
    if (coverage < 0.005 || coverage > 0.4) {
      this.log(`❌ Connected component invalid - Coverage: ${(coverage * 100).toFixed(2)}%`);
      return null;
    }
    
    // Create mask for the connected component
    const mask = new Uint8ClampedArray(width * height * 4);
    for (const { x, y } of connectedPixels) {
      const pixelIndex = (y * width + x) * 4;
      mask[pixelIndex] = 255;     // R
      mask[pixelIndex + 1] = 255; // G
      mask[pixelIndex + 2] = 255; // B
      mask[pixelIndex + 3] = 255; // A
    }
    
    return mask;
  }
} 
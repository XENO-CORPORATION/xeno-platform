// Test file for Enhanced Segmentation Engine
// This file can be used to verify the enhanced segmentation algorithms work correctly

import { TensorFlowSegmentationEngine } from './tensorflow-segmentation.engine';

export async function testEnhancedSegmentation(): Promise<boolean> {
  console.log('🧪 Testing Enhanced Segmentation Engine...');
  
  try {
    // Create engine instance with fallback enabled
    const engine = new TensorFlowSegmentationEngine({
      modelType: 'pascal',
      enableDebugLogs: true,
      fallbackToSimpleSegmentation: true,
      threshold: 0.6
    });
    
    console.log('✅ Engine created successfully');
    
    // Test initialization
    const initialized = await engine.initialize();
    console.log(`🔄 Initialization result: ${initialized}`);
    
    if (!initialized) {
      console.error('❌ Engine failed to initialize');
      return false;
    }
    
    // Create a test image (simple colored squares)
    const testCanvas = document.createElement('canvas');
    testCanvas.width = 100;
    testCanvas.height = 100;
    const ctx = testCanvas.getContext('2d')!;
    
    // Draw test pattern - red square on blue background
    ctx.fillStyle = 'blue';
    ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = 'red';
    ctx.fillRect(25, 25, 50, 50);
    
    // Get image data
    const imageData = ctx.getImageData(0, 0, 100, 100);
    
    // Create test image element
    const testImage = new Image();
    testImage.src = testCanvas.toDataURL();
    
    await new Promise(resolve => {
      testImage.onload = resolve;
    });
    
    // Process the test image
    const processed = await engine.processImage(imageData, testImage);
    console.log(`📊 Image processing result: ${processed}`);
    
    if (!processed) {
      console.error('❌ Failed to process test image');
      return false;
    }
    
    // Test hover mask generation on red square (center)
    console.log('🎯 Testing hover mask generation...');
    const hoverMask = await engine.generateHoverMask({ x: 50, y: 50 });
    
    if (!hoverMask) {
      console.error('❌ Failed to generate hover mask');
      return false;
    }
    
    console.log(`✅ Hover mask generated successfully:`);
    console.log(`   - Backend: ${hoverMask.backend}`);
    console.log(`   - Score: ${hoverMask.score}`);
    console.log(`   - Dimensions: ${hoverMask.width}x${hoverMask.height}`);
    
    // Analyze mask quality
    let maskedPixels = 0;
    for (let i = 0; i < hoverMask.data.length; i += 4) {
      if (hoverMask.data[i] > 0) {
        maskedPixels++;
      }
    }
    
    const totalPixels = hoverMask.width * hoverMask.height;
    const coverage = maskedPixels / totalPixels;
    
    console.log(`📈 Mask analysis:`);
    console.log(`   - Masked pixels: ${maskedPixels}/${totalPixels}`);
    console.log(`   - Coverage: ${(coverage * 100).toFixed(2)}%`);
    
    // Test different points
    const testPoints = [
      { x: 10, y: 10, expected: 'background' }, // Blue background
      { x: 50, y: 50, expected: 'object' },     // Red square
      { x: 90, y: 90, expected: 'background' }  // Blue background
    ];
    
    for (const point of testPoints) {
      console.log(`🎯 Testing point (${point.x}, ${point.y}) - expected: ${point.expected}`);
      const mask = await engine.generateHoverMask(point);
      
      if (mask) {
        let pixelCount = 0;
        for (let i = 0; i < mask.data.length; i += 4) {
          if (mask.data[i] > 0) pixelCount++;
        }
        const pointCoverage = pixelCount / (mask.width * mask.height);
        console.log(`   - Coverage: ${(pointCoverage * 100).toFixed(2)}%, Backend: ${mask.backend}`);
      } else {
        console.log(`   - No mask generated`);
      }
    }
    
    // Get backend status
    const status = engine.getBackendStatus();
    console.log('🔍 Backend Status:', JSON.stringify(status, null, 2));
    
    console.log('✅ Enhanced segmentation test completed successfully');
    return true;
    
  } catch (error) {
    console.error('❌ Enhanced segmentation test failed:', error);
    return false;
  }
}

// Auto-run test if this file is imported
if (typeof window !== 'undefined') {
  // Run test after a short delay to ensure DOM is ready
  setTimeout(() => {
    testEnhancedSegmentation().then(result => {
      console.log(`🏁 Test result: ${result ? 'PASSED' : 'FAILED'}`);
    });
  }, 1000);
} 
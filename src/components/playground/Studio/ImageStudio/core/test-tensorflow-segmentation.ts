// Test file for TensorFlow.js Segmentation Engine
// This file can be used to verify the engine works correctly

import { TensorFlowSegmentationEngine } from './tensorflow-segmentation.engine';

export async function testTensorFlowSegmentation(): Promise<boolean> {
  console.log('🧪 Testing TensorFlow.js Segmentation Engine...');
  
  try {
    // Create engine instance
    const engine = new TensorFlowSegmentationEngine({
      modelType: 'pascal',
      enableDebugLogs: true,
      fallbackToSimpleSegmentation: true
    });
    
    console.log('✅ Engine created successfully');
    
    // Test initialization
    const initialized = await engine.initialize();
    console.log(`🔄 Initialization result: ${initialized}`);
    
    // Check backend status
    const status = engine.getBackendStatus();
    console.log('📊 Backend status:', status);
    
    if (status.tensorflow?.fallbackMode) {
      console.log('⚠️ Running in enhanced simple segmentation mode');
    } else if (status.tensorflow?.modelReady) {
      console.log('🎉 DeepLab v3 model loaded successfully!');
    }
    
    return initialized;
  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

// Export for use in browser console
(window as any).testTensorFlowSegmentation = testTensorFlowSegmentation; 
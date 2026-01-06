// Import statements first
import * as falImport from '@fal-ai/client';
import hyper3dRodinSchema from '../components/playground/Generation/Rodin/hyper3d-rodin-schema.json';
import triposrSchema from '../components/playground/Generation/Rodin/triposr-schema.json';
import hunyuan3dV2Schema from '../components/playground/Generation/Rodin/hunyuan3d-v2-schema.json';

// Get environment variables
const FAL_KEY = import.meta.env.VITE_FAL_KEY;

// Initialize the fal client properly
const { createFalClient } = falImport;
const fal = createFalClient({
  credentials: FAL_KEY,
});

console.log("Initialized Fal.ai client for 3D generation:", fal);

if (!FAL_KEY) {
  console.warn('Fal AI key (VITE_FAL_KEY) is not set. Fal.ai 3D models will not work.');
}

// Type definitions
interface ThreeDModelDefinition {
  provider: 'fal';
  falModelId: string;
  isTextTo3D: boolean;
  isImageTo3D: boolean;
  schema: any;
  defaultSettings: any;
}

interface ThreeDGenerationSettings {
  // Hyper3D Rodin settings
  prompt?: string;
  condition_mode?: 'fuse' | 'concat';
  tier?: 'Regular' | 'Sketch';
  bbox_condition?: number[] | null;
  quality?: 'high' | 'medium' | 'low' | 'extra-low';
  input_image_urls?: string[];
  TAPose?: boolean;
  geometry_file_format?: 'glb' | 'usdz' | 'fbx' | 'obj' | 'stl';
  use_hyper?: boolean;
  addons?: 'HighPack' | null;
  seed?: number | null;
  material?: 'PBR' | 'Shaded';
  
  // TripoSR settings
  image_url?: string;
  mc_resolution?: number;
  do_remove_background?: boolean;
  foreground_ratio?: number;
  output_format?: 'glb' | 'obj';
  
  // Hunyuan3D v2 settings
  input_image_url?: string;
  octree_resolution?: number;
  guidance_scale?: number;
  num_inference_steps?: number;
  textured_mesh?: boolean;
  
  [key: string]: any;
}

interface ThreeDGenerationResult {
  model_mesh: {
    url: string;
    file_name?: string;
    file_size?: number;
    content_type?: string;
  };
  seed?: number;
  textures?: Array<{
    url: string;
    width?: number;
    height?: number;
    file_name?: string;
    file_size?: number;
  }>;
  timings?: Record<string, number>;
  remeshing_dir?: {
    url: string;
    file_name?: string;
    file_size?: number;
    content_type?: string;
  };
}

// Model registry - Define all supported 3D models
const threeDModelRegistry: Record<string, ThreeDModelDefinition> = {
  'fal-ai/hyper3d/rodin': {
    provider: 'fal',
    falModelId: 'fal-ai/hyper3d/rodin',
    isTextTo3D: true,
    isImageTo3D: true,
    schema: hyper3dRodinSchema,
    defaultSettings: {
      prompt: '',
      condition_mode: 'concat',
      tier: 'Regular',
      bbox_condition: null,
      quality: 'medium',
      input_image_urls: [],
      TAPose: false,
      geometry_file_format: 'glb',
      use_hyper: false,
      addons: null,
      seed: null,
      material: 'PBR',
    },
  },
  'fal-ai/triposr': {
    provider: 'fal',
    falModelId: 'fal-ai/triposr',
    isTextTo3D: false,
    isImageTo3D: true,
    schema: triposrSchema,
    defaultSettings: {
      image_url: '',
      mc_resolution: 256,
      do_remove_background: true,
      foreground_ratio: 0.9,
      output_format: 'glb',
    },
  },
  'fal-ai/hunyuan3d/v2': {
    provider: 'fal',
    falModelId: 'fal-ai/hunyuan3d/v2',
    isTextTo3D: false,
    isImageTo3D: true,
    schema: hunyuan3dV2Schema,
    defaultSettings: {
      input_image_url: '',
      octree_resolution: 256,
      guidance_scale: 7.5,
      num_inference_steps: 50,
      textured_mesh: false,
      seed: null,
    },
  },
};

// Map 3D settings to fal.ai input format
const mapThreeDSettingsToFalInput = (
  settings: ThreeDGenerationSettings,
  falModelId: string
): any => {
  const modelDef = threeDModelRegistry[falModelId];
  
  // Handle Hunyuan3D v2 specifically
  if (falModelId === 'fal-ai/hunyuan3d/v2') {
    const input: any = {
      input_image_url: settings.input_image_url || settings.image_url || '',
      octree_resolution: settings.octree_resolution || modelDef?.defaultSettings.octree_resolution || 256,
      guidance_scale: settings.guidance_scale || modelDef?.defaultSettings.guidance_scale || 7.5,
      num_inference_steps: settings.num_inference_steps || modelDef?.defaultSettings.num_inference_steps || 50,
      textured_mesh: settings.textured_mesh !== undefined ? settings.textured_mesh : modelDef?.defaultSettings.textured_mesh || false,
    };
    
    if (settings.seed !== undefined && settings.seed !== null) {
      input.seed = settings.seed;
    }
    
    console.log("Mapped Hunyuan3D v2 Input:", input);
    return input;
  }

  // Handle TripoSR specifically
  if (falModelId === 'fal-ai/triposr') {
    const input: any = {
      image_url: settings.image_url || '',
      mc_resolution: settings.mc_resolution || modelDef?.defaultSettings.mc_resolution || 256,
      do_remove_background: settings.do_remove_background !== undefined ? settings.do_remove_background : modelDef?.defaultSettings.do_remove_background || true,
      foreground_ratio: settings.foreground_ratio || modelDef?.defaultSettings.foreground_ratio || 0.9,
      output_format: settings.output_format || modelDef?.defaultSettings.output_format || 'glb',
    };
    
    console.log("Mapped TripoSR Input:", input);
    return input;
  }

  // Handle Hyper3D Rodin specifically
  if (falModelId === 'fal-ai/hyper3d/rodin') {
    // Base input with prompt
    const input: any = {
      prompt: settings.prompt || '',
    };

    // Map all Hyper3D Rodin specific settings
    input.condition_mode = settings.condition_mode || modelDef?.defaultSettings.condition_mode || 'concat';
    input.tier = settings.tier || modelDef?.defaultSettings.tier || 'Regular';
    input.quality = settings.quality || modelDef?.defaultSettings.quality || 'medium';
    input.geometry_file_format = settings.geometry_file_format || modelDef?.defaultSettings.geometry_file_format || 'glb';
    input.material = settings.material || modelDef?.defaultSettings.material || 'PBR';
    input.TAPose = settings.TAPose !== undefined ? settings.TAPose : modelDef?.defaultSettings.TAPose || false;
    input.use_hyper = settings.use_hyper !== undefined ? settings.use_hyper : modelDef?.defaultSettings.use_hyper || false;
    
    // Handle optional arrays and nullables
    if (settings.input_image_urls && settings.input_image_urls.length > 0) {
      input.input_image_urls = settings.input_image_urls;
    }
    
    if (settings.bbox_condition && Array.isArray(settings.bbox_condition)) {
      input.bbox_condition = settings.bbox_condition;
    }
    
    if (settings.addons === 'HighPack') {
      input.addons = 'HighPack';
    }
    
    if (settings.seed !== undefined && settings.seed !== null) {
      input.seed = Math.max(0, Math.min(65535, settings.seed)); // Clamp to valid range
    }
    
    console.log("Mapped Hyper3D Rodin Input:", input);
    return input;
  }

  // Default fallback for other models
  const input: any = {};
  Object.keys(settings).forEach(key => {
    if (settings[key] !== undefined && key !== 'prompt') {
      input[key] = settings[key];
    }
  });

  console.log("Mapped 3D Input:", input);
  return input;
};

// Main 3D generation function
export const generate3DModel = async (
  modelId: string,
  settings: ThreeDGenerationSettings
): Promise<ThreeDGenerationResult> => {
  const modelDef = threeDModelRegistry[modelId];
  
  if (!modelDef) {
    throw new Error(`Model ${modelId} not found in registry`);
  }

  if (modelDef.provider !== 'fal') {
    throw new Error(`Provider ${modelDef.provider} not supported`);
  }

  if (!FAL_KEY) {
    throw new Error('Fal AI key (VITE_FAL_KEY) is not configured.');
  }

  // Validate required parameters based on model type
  if (modelId === 'fal-ai/triposr') {
    if (!settings.image_url || !settings.image_url.trim()) {
      throw new Error('Image URL is required for TripoSR model');
    }
  } else if (modelId === 'fal-ai/hunyuan3d/v2') {
    if (!settings.input_image_url || !settings.input_image_url.trim()) {
      throw new Error('Image URL is required for Hunyuan3D v2 model');
    }
  } else if (modelId === 'fal-ai/hyper3d/rodin') {
    if (!settings.prompt || !settings.prompt.trim()) {
      throw new Error('Prompt is required for Hyper3D Rodin model');
    }
  }

  try {
    console.log(`Starting 3D generation with model: ${modelId}`, settings);
    
    // Map settings to fal.ai format
    const falInput = mapThreeDSettingsToFalInput(settings, modelDef.falModelId);
    
    // Generate using fal.ai
    console.log(`Calling fal.run with model: ${modelDef.falModelId}`);
    console.log('Input parameters:', falInput);
    
    // @ts-ignore - Suppress error due to potential typing issue
    const result = await fal.run(modelDef.falModelId, { input: falInput });

    console.log('fal.ai response:', result);

    // Handle the response format based on model type
    let modelMesh, seed, textures, timings, remeshingDir;
    
    if ((result as any)?.data) {
      // New response format with data property
      const data = (result as any).data;
      modelMesh = data.model_mesh;
      seed = data.seed;
      textures = data.textures;
      timings = data.timings;
      remeshingDir = data.remeshing_dir;
    } else {
      // Direct response format
      modelMesh = (result as any).model_mesh;
      seed = (result as any).seed;
      textures = (result as any).textures;
      timings = (result as any).timings;
      remeshingDir = (result as any).remeshing_dir;
    }

    // Validate result structure
    if (!modelMesh) {
      throw new Error('Invalid response from fal.ai: missing model_mesh');
    }

    // Return structured result
    const threeDResult: ThreeDGenerationResult = {
      model_mesh: {
        url: modelMesh.url,
        file_name: modelMesh.file_name,
        file_size: modelMesh.file_size,
        content_type: modelMesh.content_type,
      },
    };

    // Add optional fields based on what's available
    if (seed !== undefined) {
      threeDResult.seed = seed;
    }
    
    if (textures && Array.isArray(textures)) {
      threeDResult.textures = textures;
    }
    
    if (timings) {
      threeDResult.timings = timings;
    }
    
    if (remeshingDir) {
      threeDResult.remeshing_dir = {
        url: remeshingDir.url,
        file_name: remeshingDir.file_name,
        file_size: remeshingDir.file_size,
        content_type: remeshingDir.content_type,
      };
    }

    console.log('Generated 3D model successfully:', threeDResult);
    return threeDResult;

  } catch (error) {
    console.error('Error generating 3D model:', error);
    throw error;
  }
};

// Export model registry for UI
export const getThreeDModelRegistry = () => threeDModelRegistry;

// Helper functions
export const isModelSupported = (modelId: string): boolean => {
  return modelId in threeDModelRegistry;
};

export const getModelDefinition = (modelId: string): ThreeDModelDefinition | undefined => {
  return threeDModelRegistry[modelId];
};

export const getSupportedModels = (): string[] => {
  return Object.keys(threeDModelRegistry);
};

// Export types
export type { ThreeDGenerationSettings, ThreeDGenerationResult, ThreeDModelDefinition }; 
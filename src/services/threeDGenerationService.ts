import { postXenoRequest } from './xenoProxyRequest';

// Type definitions
interface ThreeDModelDefinition {
  provider: 'xeno';
  xenoModelId?: string;
  isTextTo3D: boolean;
  isImageTo3D: boolean;
  isAvailable: boolean;
  unavailableMessage?: string;
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
    provider: 'xeno',
    isTextTo3D: true,
    isImageTo3D: true,
    isAvailable: false,
    unavailableMessage: 'Hyper3D Rodin is not yet available on Xeno API. 3D generation models coming soon.',
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
    provider: 'xeno',
    isTextTo3D: false,
    isImageTo3D: true,
    isAvailable: false,
    unavailableMessage: 'TripoSR is not yet available on Xeno API. 3D generation models coming soon.',
    defaultSettings: {
      image_url: '',
      mc_resolution: 256,
      do_remove_background: true,
      foreground_ratio: 0.9,
      output_format: 'glb',
    },
  },
  'fal-ai/hunyuan3d/v2': {
    provider: 'xeno',
    isTextTo3D: false,
    isImageTo3D: true,
    isAvailable: false,
    unavailableMessage: 'Hunyuan3D v2 is not yet available on Xeno API. 3D generation models coming soon.',
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

// Main 3D generation function
export const generate3DModel = async (
  modelId: string,
  settings: ThreeDGenerationSettings
): Promise<ThreeDGenerationResult> => {
  const modelDef = threeDModelRegistry[modelId];

  if (!modelDef) {
    throw new Error(`Model ${modelId} not found in registry`);
  }

  if (!modelDef.isAvailable) {
    throw new Error(modelDef.unavailableMessage || `Model ${modelId} is not available`);
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
    const result = await postXenoRequest('/images/generate', {
      model: modelDef.xenoModelId || 'auto',
      prompt: settings.prompt || '',
      ...settings,
    });

    if (!result || !result.model_mesh) {
      throw new Error('Invalid response from Xeno API: missing model_mesh');
    }

    const threeDResult: ThreeDGenerationResult = {
      model_mesh: {
        url: result.model_mesh.url,
        file_name: result.model_mesh.file_name,
        file_size: result.model_mesh.file_size,
        content_type: result.model_mesh.content_type,
      },
    };

    if (result.seed !== undefined) {
      threeDResult.seed = result.seed;
    }

    if (result.textures && Array.isArray(result.textures)) {
      threeDResult.textures = result.textures;
    }

    if (result.timings) {
      threeDResult.timings = result.timings;
    }

    if (result.remeshing_dir) {
      threeDResult.remeshing_dir = {
        url: result.remeshing_dir.url,
        file_name: result.remeshing_dir.file_name,
        file_size: result.remeshing_dir.file_size,
        content_type: result.remeshing_dir.content_type,
      };
    }

    return threeDResult;

  } catch (error) {
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

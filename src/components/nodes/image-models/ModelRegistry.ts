import { ImageModelInterface } from './ImageModelInterface';
import { StableDiffusion35Model } from './models/StableDiffusion35Model';
import { FluxDevModel } from './models/FluxDevModel';
import { FluxPro11Model } from './models/FluxPro11Model';
import { LumaPhotonModel } from './models/LumaPhotonModel';
import { RecraftV3Model } from './models/RecraftV3Model';
import { RecraftV3SVGModel } from './models/RecraftV3SVGModel';

// Registry of all available model implementations
export const modelRegistry: Record<string, ImageModelInterface> = {
  'stable-diffusion-3.5': new StableDiffusion35Model(),
  'flux-dev': new FluxDevModel(),
  'flux-pro-1.1': new FluxPro11Model(),
  'fal-ai/luma-photon/flash': new LumaPhotonModel(),
  'fal-ai/recraft/v3/text-to-image': new RecraftV3Model(),
  'fal-ai/ideogram/v3': new LumaPhotonModel(),
  'fal-ai/ideogram/v2a/turbo': new LumaPhotonModel(),
  'recraft-v3-svg': new RecraftV3SVGModel()
};

export const IMAGE_MODELS = modelRegistry; // Export models mapping for UI

/**
 * Get a model implementation by name
 * @param modelName The name of the model to get
 * @returns The model implementation or null if not found
 */
export const getModelImplementation = (modelName: string): ImageModelInterface | null => {
  return modelRegistry[modelName] || null;
};

/**
 * Get all available model implementations
 * @returns An array of all model implementations
 */
export const getAllModelImplementations = (): ImageModelInterface[] => {
  return Object.values(modelRegistry);
};

/**
 * Register a new model implementation
 * @param modelName The name of the model
 * @param implementation The model implementation
 */
export const registerModelImplementation = (modelName: string, implementation: ImageModelInterface): void => {
  modelRegistry[modelName] = implementation;
};

/**
 * Get the names of all available models
 * @returns An array of model names
 */
export const getAvailableModelNames = (): string[] => {
  return Object.keys(modelRegistry);
}; 
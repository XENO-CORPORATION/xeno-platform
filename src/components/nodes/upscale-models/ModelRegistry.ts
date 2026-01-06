import { UpscaleModelInterface } from './UpscaleModelInterface';
import { XimilarModel } from './models/XimilarModel';
import { DeepAIImageModel } from './models/DeepAIImageModel';
import { UpscaleMediaModel } from './models/UpscaleMediaModel';
import { StabilityAIModel } from './models/StabilityAIModel';
import { TopazLabsModel } from './models/TopazLabsModel';
import { MagnificAIModel } from './models/MagnificAIModel';

// Registry of all available upscale model implementations
const modelRegistry: Record<string, UpscaleModelInterface> = {
  'ximilar': new XimilarModel(),
  'deepai-image': new DeepAIImageModel(),
  'upscale-media': new UpscaleMediaModel(),
  'stability-ai': new StabilityAIModel(),
  'topaz-labs': new TopazLabsModel(),
  'magnific-ai': new MagnificAIModel()
};

/**
 * Get a model implementation by name
 * @param modelName The name of the model to get
 * @returns The model implementation or null if not found
 */
export const getModelImplementation = (modelName: string): UpscaleModelInterface | null => {
  return modelRegistry[modelName] || null;
};

/**
 * Get all available model implementations
 * @returns An array of all model implementations
 */
export const getAllModelImplementations = (): UpscaleModelInterface[] => {
  return Object.values(modelRegistry);
};

/**
 * Register a new model implementation
 * @param modelName The name of the model
 * @param implementation The model implementation
 */
export const registerModelImplementation = (modelName: string, implementation: UpscaleModelInterface): void => {
  modelRegistry[modelName] = implementation;
}; 
import { VideoUpscaleModelInterface } from './VideoUpscaleModelInterface';
import { TopazVideoModel } from './models/TopazVideoModel';
import { DaincModel } from './models/DaincModel';
import { FlowframeModel } from './models/FlowframeModel';
import { EnhancerAIModel } from './models/EnhancerAIModel';
import { RifeModel } from './models/RifeModel';
import { RealESRGANVideoModel } from './models/RealESRGANVideoModel';

// Initialize model implementations
const topazModel = new TopazVideoModel();
const daincModel = new DaincModel();
const flowframeModel = new FlowframeModel();
const enhancerAIModel = new EnhancerAIModel();
const rifeModel = new RifeModel();
const realESRGANVideoModel = new RealESRGANVideoModel();

// Map of model name to implementation
const modelRegistry = new Map<string, VideoUpscaleModelInterface>([
  [topazModel.name, topazModel],
  [daincModel.name, daincModel],
  [flowframeModel.name, flowframeModel],
  [enhancerAIModel.name, enhancerAIModel],
  [rifeModel.name, rifeModel],
  [realESRGANVideoModel.name, realESRGANVideoModel]
]);

/**
 * Get a model implementation by name
 * @param modelName The name of the model to get
 * @returns The model implementation or null if not found
 */
export function getModelImplementation(modelName: string): VideoUpscaleModelInterface | null {
  return modelRegistry.get(modelName) || null;
}

/**
 * Get all available model implementations
 * @returns An array of all model implementations
 */
export function getAllModelImplementations(): VideoUpscaleModelInterface[] {
  return Array.from(modelRegistry.values());
}

/**
 * Register a new model implementation
 * @param model The model implementation to register
 */
export function registerModelImplementation(model: VideoUpscaleModelInterface): void {
  modelRegistry.set(model.name, model);
}

/**
 * Get the names of all available models
 * @returns An array of model names
 */
export function getAvailableModelNames(): string[] {
  return Array.from(modelRegistry.keys());
}

export default {
  getModelImplementation,
  getAllModelImplementations,
  registerModelImplementation,
  getAvailableModelNames
}; 
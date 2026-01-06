import { VideoModelInterface } from './VideoModelInterface';
import { HailuoMinimaxModel } from './models/HailuoMinimaxModel';
import { Veo2Model } from './models/Veo2Model';
import { KlingStandard16Model } from './models/KlingStandard16Model';
import { KlingPro15Model } from './models/KlingPro15Model';
import { LumaRay2Model } from './models/LumaRay2Model';
import { LumaDreamMachineModel } from './models/LumaDreamMachineModel';
import { PikaModel } from './models/PikaModel';
import { TencentHunyuanModel } from './models/TencentHunyuanModel';
import { Wan21Model } from './models/Wan21Model';
import { MinimaxVideo01Model } from './models/MinimaxVideo01Model';

// Registry of all available model implementations
const modelRegistry: Record<string, VideoModelInterface> = {
  'hailuo-minimax': new HailuoMinimaxModel(),
  'veo-2': new Veo2Model(),
  'kling-standard-1.6': new KlingStandard16Model(),
  'kling-pro-1.5': new KlingPro15Model(),
  'luma-ray-2': new LumaRay2Model(),
  'luma-dream-machine': new LumaDreamMachineModel(),
  'pika': new PikaModel(),
  'tencent-hunyuan': new TencentHunyuanModel(),
  'wan-2.1-1.3b': new Wan21Model(),
  'minimax-video-01': new MinimaxVideo01Model()
};

/**
 * Get a model implementation by name
 * @param modelName The name of the model to get
 * @returns The model implementation or null if not found
 */
export const getModelImplementation = (modelName: string): VideoModelInterface | null => {
  return modelRegistry[modelName] || null;
};

/**
 * Get all available model implementations
 * @returns An array of all model implementations
 */
export const getAllModelImplementations = (): VideoModelInterface[] => {
  return Object.values(modelRegistry);
};

/**
 * Register a new model implementation
 * @param modelName The name of the model
 * @param implementation The model implementation
 */
export const registerModelImplementation = (modelName: string, implementation: VideoModelInterface): void => {
  modelRegistry[modelName] = implementation;
};

/**
 * Get the names of all available models
 * @returns An array of model names
 */
export const getAvailableModelNames = (): string[] => {
  return Object.keys(modelRegistry);
}; 
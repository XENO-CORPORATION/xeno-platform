import { LLMModelInterface } from './LLMModelInterface';
import { GPT4oModel } from './models/GPT4oModel';
import { Claude3SonnetModel } from './models/Claude3SonnetModel';
import { GeminiModel } from './models/GeminiModel';
import { Grok3Model } from './models/Grok3Model';
import { OllamaModel } from './models/OllamaModel';

// Registry of all available model implementations
const modelRegistry: Record<string, LLMModelInterface> = {
  'gpt-4o': new GPT4oModel(),
  'claude-3-sonnet': new Claude3SonnetModel(),
  'gemini': new GeminiModel(),
  'grok-3': new Grok3Model(),
  'ollama': new OllamaModel()
};

/**
 * Get a model implementation by name
 * @param modelName The name of the model to get
 * @returns The model implementation or null if not found
 */
export const getModelImplementation = (modelName: string): LLMModelInterface | null => {
  return modelRegistry[modelName] || null;
};

/**
 * Get all available model implementations
 * @returns An array of all model implementations
 */
export const getAllModelImplementations = (): LLMModelInterface[] => {
  return Object.values(modelRegistry);
};

/**
 * Register a new model implementation
 * @param modelName The name of the model
 * @param implementation The model implementation
 */
export const registerModelImplementation = (modelName: string, implementation: LLMModelInterface): void => {
  modelRegistry[modelName] = implementation;
};

/**
 * Get the names of all available models
 * @returns An array of model names
 */
export const getAvailableModelNames = (): string[] => {
  return Object.keys(modelRegistry);
}; 
import { PreviewNodeInterface } from './PreviewNodeInterface';
import { ImagePreviewNode } from './models/ImagePreviewNode';
import { VideoPreviewNode } from './models/VideoPreviewNode';
import { TextPreviewNode } from './models/TextPreviewNode';
import { AudioPreviewNode } from './models/AudioPreviewNode';

// Initialize model implementations
const imagePreviewNode = new ImagePreviewNode();
const videoPreviewNode = new VideoPreviewNode();
const textPreviewNode = new TextPreviewNode();
const audioPreviewNode = new AudioPreviewNode();

// Map of preview type to implementation
const modelRegistry = new Map<string, PreviewNodeInterface>([
  [imagePreviewNode.name, imagePreviewNode],
  [videoPreviewNode.name, videoPreviewNode],
  [textPreviewNode.name, textPreviewNode],
  [audioPreviewNode.name, audioPreviewNode],
]);

/**
 * Get a preview node implementation by name
 * @param modelName The name of the preview node
 * @returns The preview node implementation or null if not found
 */
export function getPreviewNodeImplementation(modelName: string): PreviewNodeInterface | null {
  return modelRegistry.get(modelName) || null;
}

/**
 * Get all available preview node implementations
 * @returns An array of all preview node implementations
 */
export function getAllPreviewNodeImplementations(): PreviewNodeInterface[] {
  return Array.from(modelRegistry.values());
}

/**
 * Register a new preview node implementation
 * @param model The preview node implementation to register
 */
export function registerPreviewNodeImplementation(model: PreviewNodeInterface): void {
  modelRegistry.set(model.name, model);
}

/**
 * Get the names of all available preview nodes
 * @returns An array of preview node names
 */
export function getAvailablePreviewNodeNames(): string[] {
  return Array.from(modelRegistry.keys());
}

/**
 * Get all available preview nodes by type
 * @param type The type of preview nodes to get (e.g., 'image', 'video', 'text', 'audio')
 * @returns An array of preview node implementations of the specified type
 */
export function getPreviewNodesByType(type: string): PreviewNodeInterface[] {
  return Array.from(modelRegistry.values()).filter(
    (model) => model.previewType === type
  );
}

export default {
  getPreviewNodeImplementation,
  getAllPreviewNodeImplementations,
  registerPreviewNodeImplementation,
  getAvailablePreviewNodeNames,
  getPreviewNodesByType
}; 
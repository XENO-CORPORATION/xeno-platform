// Export interfaces
export * from './UpscaleModelInterface';

// Export base class
export * from './BaseUpscaleModel';

// Export registry
export * from './ModelRegistry';

// Export the enhanced component
export { default as EnhancedUpscaleImageNode } from './EnhancedUpscaleImageNode';

// Export model implementations
export * from './models/XimilarModel';
export * from './models/DeepAIImageModel';
export * from './models/UpscaleMediaModel';
export * from './models/StabilityAIModel';
export * from './models/TopazLabsModel';
export * from './models/MagnificAIModel'; 
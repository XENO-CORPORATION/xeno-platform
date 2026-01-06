// Main component exports - Using StudioVideoCanvas as the primary interface
export { default as VideoStudio } from './components/StudioVideoCanvas'; // Export StudioVideoCanvas as VideoStudio for backward compatibility
export { default } from './components/StudioVideoCanvas'; // Default export
export { default as StudioVideoCanvas } from './components/StudioVideoCanvas';

// Export types that are commonly needed
export type { VideoProject, VideoFile, VideoStudioSettings } from './core/types';
// Core functionality
export * from './core/types';
export * from './core/utils';
export * from './core/segmentation.engine';
export * from './core/styles';

// Components
export * from './components/OptimizedImage';
export * from './components/FullScreenImageViewer';
export * from './components/HistoryModal';
export * from './components/ChatMessages';
export { default as ImageStudio } from './components/ImageStudio';

// Hooks
export * from './hooks/useImageStudio';
export * from './hooks/useConversationHistory';

// Main component export
export { default } from './components/ImageStudio'; 
// Core exports for VideoStudio

export * from './types';
export * from './utils';
export * from './video.engine';
export * from './styles';

// Re-export commonly used items
export type {
  VideoFile,
  VideoProject,
  VideoStudioSettings,
  VideoEditOperation,
  VideoTimeline,
  VideoTrack,
  VideoClip
} from './types';

export {
  formatFileSize,
  formatDuration,
  generateId,
  isValidVideoFormat,
  getResolutionString,
  getAspectRatio,
  getDefaultSettings,
  createNewProject
} from './utils';

export { VideoEngine } from './video.engine';
export { injectVideoStudioStyles } from './styles';
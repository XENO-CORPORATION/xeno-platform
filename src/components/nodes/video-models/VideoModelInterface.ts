import { BaseNodeProps } from '../BaseNode';

export interface VideoModelSettings {
  duration: number;
  fps: number;
  resolution?: string;
  motionStrength?: number;
  stabilization?: number;
  [key: string]: any; // Allow for model-specific settings
}

export interface VideoGenerationResponse {
  videoUrl: string;
  metadata?: {
    generationTime: number;
    promptTokens?: number;
    modelVersion?: string;
    [key: string]: any;
  };
}

export interface VideoModelInterface {
  // Model information
  name: string;
  description: string;
  supportedResolutions: string[];
  supportedFpsRanges: number[];
  defaultSettings: VideoModelSettings;
  
  // Core functionality
  generateVideo(
    prompt: string,
    settings: VideoModelSettings,
    imageUrl?: string
  ): Promise<VideoGenerationResponse>;
  
  // UI rendering
  renderModelSettings(
    settings: VideoModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element;
  
  // Optional capabilities
  supportsTextToVideo?: boolean;
  supportsImageToVideo?: boolean;
  supportsVideoToVideo?: boolean;
  supportsStoryboard?: boolean;
  supportsMusicGeneration?: boolean;
  supportsExtendedDuration?: boolean;
  
  // Optional methods for specific capabilities
  addMusicToVideo?(
    videoUrl: string, 
    musicPrompt: string, 
    settings: VideoModelSettings
  ): Promise<VideoGenerationResponse>;
  
  extendVideoSequence?(
    videoUrl: string, 
    duration: number, 
    settings: VideoModelSettings
  ): Promise<VideoGenerationResponse>;
}

export interface VideoModelProps extends BaseNodeProps {
  modelInterface: VideoModelInterface;
} 
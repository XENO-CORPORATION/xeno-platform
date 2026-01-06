import { BaseNodeProps } from '../BaseNode';

export interface VideoUpscaleModelSettings {
  upscaleFactor: number;
  denoise: number;
  enhanceDetails: boolean;
  preserveColors: boolean;
  frameConsistency: number;
  [key: string]: any; // Allow for model-specific settings
}

export interface VideoUpscaleResponse {
  outputVideoUrl: string;
  metadata?: {
    processingTime: number;
    originalResolution?: string;
    outputResolution?: string;
    frameCount?: number;
    modelVersion?: string;
    enhancementScore?: number;
    [key: string]: any;
  };
}

export interface VideoUpscaleModelInterface {
  // Model information
  name: string;
  description: string;
  maxUpscaleFactor: number;
  supportedUpscaleFactors: number[];
  defaultSettings: VideoUpscaleModelSettings;
  
  // Core functionality
  upscaleVideo(
    videoUrl: string, 
    settings: VideoUpscaleModelSettings
  ): Promise<VideoUpscaleResponse>;
  
  // UI rendering
  renderModelSettings(
    settings: VideoUpscaleModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element;
  
  // Optional capabilities
  supportsFaceEnhancement?: boolean;
  supportsArtifactRemoval?: boolean;
  supportsDenoising?: boolean;
  supportsFrameInterpolation?: boolean;
  supportsSlowMotion?: boolean;
  supportsHDREnhancement?: boolean;
  
  // Optional methods for specific capabilities
  enhanceFaces?(videoUrl: string, settings: VideoUpscaleModelSettings): Promise<VideoUpscaleResponse>;
  removeArtifacts?(videoUrl: string, settings: VideoUpscaleModelSettings): Promise<VideoUpscaleResponse>;
  interpolateFrames?(videoUrl: string, settings: VideoUpscaleModelSettings): Promise<VideoUpscaleResponse>;
  convertToHDR?(videoUrl: string, settings: VideoUpscaleModelSettings): Promise<VideoUpscaleResponse>;
}

export interface VideoUpscaleModelProps extends BaseNodeProps {
  modelInterface: VideoUpscaleModelInterface;
} 
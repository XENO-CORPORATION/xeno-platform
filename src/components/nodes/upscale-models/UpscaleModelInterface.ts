import { BaseNodeProps } from '../BaseNode';

export interface UpscaleModelSettings {
  upscaleFactor: number;
  denoise: number;
  enhanceDetails: boolean;
  preserveColors: boolean;
  [key: string]: any; // Allow for model-specific settings
}

export interface UpscaleResponse {
  outputImageUrl: string;
  metadata?: {
    processingTime: number;
    originalSize?: string;
    outputSize?: string;
    modelVersion?: string;
    enhancementScore?: number;
    [key: string]: any;
  };
}

export interface UpscaleModelInterface {
  // Model information
  name: string;
  description: string;
  maxUpscaleFactor: number;
  supportedUpscaleFactors: number[];
  defaultSettings: UpscaleModelSettings;
  
  // Core functionality
  upscaleImage(
    imageUrl: string, 
    settings: UpscaleModelSettings
  ): Promise<UpscaleResponse>;
  
  // UI rendering
  renderModelSettings(
    settings: UpscaleModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element;
  
  // Optional capabilities
  supportsFaceEnhancement?: boolean;
  supportsArtifactRemoval?: boolean;
  supportsDenoising?: boolean;
  supportsAIDetectionRemoval?: boolean;
  supportsTextEnhancement?: boolean;
  supportsStyleTransfer?: boolean;
  
  // Optional methods for specific capabilities
  enhanceFaces?(imageUrl: string, settings: UpscaleModelSettings): Promise<UpscaleResponse>;
  removeArtifacts?(imageUrl: string, settings: UpscaleModelSettings): Promise<UpscaleResponse>;
  removeAIDetection?(imageUrl: string, settings: UpscaleModelSettings): Promise<UpscaleResponse>;
}

export interface UpscaleModelProps extends BaseNodeProps {
  modelInterface: UpscaleModelInterface;
} 
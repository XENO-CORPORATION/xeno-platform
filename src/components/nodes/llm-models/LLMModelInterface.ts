import { BaseNodeProps } from '../BaseNode';

export interface LLMModelSettings {
  temperature: number;
  maxTokens: number;
  prompt: string;
  [key: string]: any; // Allow for model-specific settings
}

export interface LLMModelResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  metadata?: Record<string, any>;
}

export interface LLMModelInterface {
  // Model information
  name: string;
  description: string;
  maxContextLength: number;
  defaultSettings: LLMModelSettings;
  
  // Core functionality
  generateText(prompt: string, settings: LLMModelSettings): Promise<LLMModelResponse>;
  
  // UI rendering
  renderModelSettings(
    settings: LLMModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element;
  
  // Optional capabilities
  supportsStreaming?: boolean;
  supportsFunctionCalling?: boolean;
  supportsVision?: boolean;
  
  // Optional streaming implementation
  streamText?(
    prompt: string, 
    settings: LLMModelSettings, 
    onChunk: (chunk: string) => void
  ): Promise<LLMModelResponse>;
}

export interface LLMModelProps extends BaseNodeProps {
  modelInterface: LLMModelInterface;
} 
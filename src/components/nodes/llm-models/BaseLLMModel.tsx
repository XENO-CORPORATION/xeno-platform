import React from 'react';
import { LLMModelInterface, LLMModelSettings, LLMModelResponse } from './LLMModelInterface';

/**
 * Abstract base class for LLM model implementations
 * Provides common functionality and default implementations
 */
export abstract class BaseLLMModel implements LLMModelInterface {
  // Abstract properties that must be implemented by subclasses
  abstract name: string;
  abstract description: string;
  abstract maxContextLength: number;
  abstract defaultSettings: LLMModelSettings;
  
  // Optional capabilities with default values
  supportsStreaming: boolean = false;
  supportsFunctionCalling: boolean = false;
  supportsVision: boolean = false;
  
  // Abstract methods that must be implemented by subclasses
  abstract generateText(prompt: string, settings: LLMModelSettings): Promise<LLMModelResponse>;
  
  // Default implementation for streaming that can be overridden
  async streamText(
    prompt: string, 
    settings: LLMModelSettings, 
    onChunk: (chunk: string) => void
  ): Promise<LLMModelResponse> {
    if (!this.supportsStreaming) {
      throw new Error(`Streaming not supported for ${this.name}`);
    }
    
    // Default implementation just calls generateText and returns the full response
    const response = await this.generateText(prompt, settings);
    onChunk(response.text);
    return response;
  }
  
  // Default UI rendering for common settings
  renderModelSettings(
    settings: LLMModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <div className="space-y-4">
        {/* System Prompt */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">System Prompt</label>
          <textarea
            value={settings.prompt}
            onChange={(e) => handleSettingChange('prompt', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm min-h-[100px] focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20 resize-none"
            placeholder="Enter system instructions..."
          />
          <p className="mt-2 text-xs text-white/50">Define the behavior and context for the language model</p>
        </div>

        {/* Temperature Control */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Temperature</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.temperature}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={settings.temperature}
            onChange={(e) => handleSettingChange('temperature', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <div className="flex justify-between text-xs text-white/50 mt-2">
            <span>Precise</span>
            <span>Balanced</span>
            <span>Creative</span>
          </div>
          <p className="mt-2 text-xs text-white/50">Adjust response creativity and randomness</p>
        </div>
        
        {/* Max Tokens Control */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Max Tokens</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.maxTokens}
            </span>
          </div>
          <input
            type="range"
            min="100"
            max="4000"
            step="100"
            value={settings.maxTokens}
            onChange={(e) => handleSettingChange('maxTokens', parseInt(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Maximum number of tokens to generate</p>
        </div>
        
        {/* Model-specific settings can be added by subclasses */}
        {this.renderModelSpecificSettings(settings, handleSettingChange)}
      </div>
    );
  }
  
  // Method for subclasses to override to add model-specific settings
  renderModelSpecificSettings(
    _settings: LLMModelSettings, 
    _handleSettingChange: (key: string, value: any) => void
  ): JSX.Element | null {
    return null;
  }
} 
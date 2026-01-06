import React from 'react'; // Keep React import for JSX in renderModelSettings
import { UpscaleModelInterface, UpscaleModelSettings, UpscaleResponse } from './UpscaleModelInterface';

/**
 * Abstract base class for upscale model implementations
 * Provides common functionality and default implementations
 */
export abstract class BaseUpscaleModel implements UpscaleModelInterface {
  // Abstract properties that must be implemented by subclasses
  abstract name: string;
  abstract description: string;
  abstract maxUpscaleFactor: number;
  abstract supportedUpscaleFactors: number[];
  abstract defaultSettings: UpscaleModelSettings;
  
  // Optional capabilities with default values
  supportsFaceEnhancement: boolean = false;
  supportsArtifactRemoval: boolean = false;
  supportsDenoising: boolean = true;
  supportsAIDetectionRemoval: boolean = false;
  supportsTextEnhancement: boolean = false;
  supportsStyleTransfer: boolean = false;
  
  // Abstract methods that must be implemented by subclasses
  abstract upscaleImage(
    imageUrl: string,
    settings: UpscaleModelSettings
  ): Promise<UpscaleResponse>;
  
  // Optional methods with default implementations
  async enhanceFaces(
    imageUrl: string, 
    _settings: UpscaleModelSettings
  ): Promise<UpscaleResponse> {
    if (!this.supportsFaceEnhancement) {
      throw new Error(`Face enhancement not supported for ${this.name}`);
    }
    
    // Default implementation returns the original image
    return {
      outputImageUrl: imageUrl,
      metadata: {
        processingTime: 0,
        modelVersion: this.name
      }
    };
  }
  
  async removeArtifacts(
    imageUrl: string, 
    _settings: UpscaleModelSettings
  ): Promise<UpscaleResponse> {
    if (!this.supportsArtifactRemoval) {
      throw new Error(`Artifact removal not supported for ${this.name}`);
    }
    
    // Default implementation returns the original image
    return {
      outputImageUrl: imageUrl,
      metadata: {
        processingTime: 0,
        modelVersion: this.name
      }
    };
  }
  
  async removeAIDetection(
    imageUrl: string, 
    _settings: UpscaleModelSettings
  ): Promise<UpscaleResponse> {
    if (!this.supportsAIDetectionRemoval) {
      throw new Error(`AI detection removal not supported for ${this.name}`);
    }
    
    // Default implementation returns the original image
    return {
      outputImageUrl: imageUrl,
      metadata: {
        processingTime: 0,
        modelVersion: this.name
      }
    };
  }
  
  // Default UI rendering implementation
  renderModelSettings(
    settings: UpscaleModelSettings,
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <div className="space-y-4">
        {/* Upscale Factor */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Upscale Factor</label>
          <div className="grid grid-cols-3 gap-2">
            {this.supportedUpscaleFactors.map((factor) => (
              <button
                key={factor}
                onClick={() => handleSettingChange('upscaleFactor', factor)}
                className={`p-2 text-xs rounded-lg border transition-colors ${
                  settings.upscaleFactor === factor
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {factor}x
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Select the upscaling factor</p>
        </div>

        {/* Denoise Level */}
        {this.supportsDenoising && (
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-white/70">Denoise Level</label>
              <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                {settings.denoise}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.denoise}
              onChange={(e) => handleSettingChange('denoise', parseInt(e.target.value))}
              className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
            />
            <p className="mt-2 text-xs text-white/50">Adjust noise reduction strength</p>
          </div>
        )}

        {/* Enhancement Options */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-3">Enhancement Options</label>
          <div className="space-y-3">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enhanceDetails}
                onChange={(e) => handleSettingChange('enhanceDetails', e.target.checked)}
                className="rounded border-white/30 bg-black/30 text-white focus:ring-0 focus:ring-offset-0"
              />
              <span className="text-sm text-white/70">Enhance details</span>
            </label>
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.preserveColors}
                onChange={(e) => handleSettingChange('preserveColors', e.target.checked)}
                className="rounded border-white/30 bg-black/30 text-white focus:ring-0 focus:ring-offset-0"
              />
              <span className="text-sm text-white/70">Preserve colors</span>
            </label>
          </div>
          <p className="mt-2 text-xs text-white/50">Fine-tune the enhancement process</p>
        </div>
        
        {/* Render model-specific settings if implemented by subclass */}
        {this.renderModelSpecificSettings?.(settings, handleSettingChange)}
      </div>
    );
  }
  
  // Optional method to render model-specific settings
  renderModelSpecificSettings?(
    settings: UpscaleModelSettings,
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element;
} 
import React from 'react'; // Keep React import for JSX in renderModelSettings
import { ImageModelInterface, ImageModelSettings, ImageGenerationResponse } from './ImageModelInterface';

/**
 * Abstract base class for image model implementations
 * Provides common functionality and default implementations
 */
export abstract class BaseImageModel implements ImageModelInterface {
  // Abstract properties that must be implemented by subclasses
  abstract name: string;
  abstract description: string;
  abstract supportedResolutions: string[];
  abstract defaultSettings: ImageModelSettings;
  
  // Optional capabilities with default values
  supportsNegativePrompt: boolean = false;
  supportsControlNet: boolean = false;
  supportsInpainting: boolean = false;
  supportsFaceEnhancement: boolean = false;
  supportsUpscaling: boolean = false;
  supportsSeed: boolean = true;
  
  // Abstract methods that must be implemented by subclasses
  abstract generateImage(prompt: string, settings: ImageModelSettings): Promise<ImageGenerationResponse>;
  
  // Optional methods with default implementations
  async enhanceImage(imageUrl: string, _settings: ImageModelSettings): Promise<ImageGenerationResponse> {
    if (!this.supportsFaceEnhancement) {
      throw new Error(`Face enhancement not supported for ${this.name}`);
    }
    
    // Default implementation returns the original image
    return {
      imageUrl,
      metadata: {
        generationTime: 0,
        modelVersion: this.name
      }
    };
  }
  
  async upscaleImage(imageUrl: string, _scale: number): Promise<ImageGenerationResponse> {
    if (!this.supportsUpscaling) {
      throw new Error(`Upscaling not supported for ${this.name}`);
    }
    
    // Default implementation returns the original image
    return {
      imageUrl,
      metadata: {
        generationTime: 0,
        modelVersion: this.name
      }
    };
  }
  
  // Default UI rendering for common settings
  renderModelSettings(
    settings: ImageModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <div className="space-y-4">
        {/* Resolution Selection */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Output Resolution</label>
          <div className="grid grid-cols-3 gap-2">
            {this.supportedResolutions.map((res) => (
              <button
                key={res}
                onClick={() => handleSettingChange('resolution', res)}
                className={`p-2 text-xs rounded-lg border transition-colors ${
                  settings.resolution === res
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {res}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Select the output image dimensions</p>
        </div>

        {/* Style Selection */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Image Style</label>
          <div className="grid grid-cols-2 gap-2">
            {['photorealistic', 'artistic', 'anime', 'digital-art'].map((style) => (
              <button
                key={style}
                onClick={() => handleSettingChange('style', style)}
                className={`p-2 text-xs rounded-lg border capitalize transition-colors ${
                  settings.style === style
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {style.replace('-', ' ')}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Define the artistic style of the generated image</p>
        </div>

        {/* Steps Control */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Steps</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.steps}
            </span>
          </div>
          <input
            type="range"
            min="20"
            max="150"
            value={settings.steps}
            onChange={(e) => handleSettingChange('steps', parseInt(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Higher values produce more detailed results</p>
        </div>

        {/* Guidance Scale Control */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Guidance Scale</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.guidance}
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="20"
            step="0.5"
            value={settings.guidance}
            onChange={(e) => handleSettingChange('guidance', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Controls prompt adherence strength</p>
        </div>
        
        {/* Seed Control (if supported) */}
        {this.supportsSeed && (
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-white/70">Random Seed</label>
              <div className="flex space-x-2">
                <input
                  type="number"
                  value={settings.seed || -1}
                  onChange={(e) => handleSettingChange('seed', parseInt(e.target.value))}
                  className="w-20 bg-black/30 text-white border border-white/10 rounded-lg p-1 text-xs focus:outline-none focus:ring-1 focus:ring-white/20"
                />
                <button
                  onClick={() => handleSettingChange('seed', Math.floor(Math.random() * 1000000))}
                  className="bg-black/30 text-white/70 border border-white/10 rounded-lg px-2 text-xs hover:bg-black/40 hover:text-white transition-colors"
                >
                  Random
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-white/50">-1 for random, or set for reproducible results</p>
          </div>
        )}

        {/* Negative Prompt (if supported) */}
        {this.supportsNegativePrompt && (
          <div className="bg-black/20 rounded-lg p-4">
            <label className="block text-xs font-medium text-white/70 mb-2">Negative Prompt</label>
            <textarea
              value={settings.negativePrompt || ''}
              onChange={(e) => handleSettingChange('negativePrompt', e.target.value)}
              className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm min-h-[80px] focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20 resize-none"
              placeholder="Elements to avoid in the generated image..."
            />
            <p className="mt-2 text-xs text-white/50">Specify elements to exclude from the generation</p>
          </div>
        )}
        
        {/* Model-specific settings can be added by subclasses */}
        {this.renderModelSpecificSettings(settings, handleSettingChange)}
      </div>
    );
  }
  
  // Method for subclasses to override to add model-specific settings
  renderModelSpecificSettings(
    _settings: ImageModelSettings, 
    _handleSettingChange: (key: string, value: any) => void
  ): JSX.Element | null {
    return null;
  }
} 
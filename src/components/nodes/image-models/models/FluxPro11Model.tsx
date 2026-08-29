import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseImageModel } from '../BaseImageModel';
import { ImageModelSettings, ImageGenerationResponse } from '../ImageModelInterface';
import { generateImage, XenoModels, getXenoSettings } from '../../../../services/xenoImageService';
import { API_ENDPOINTS } from '../../../../config/apiConfig';

export class FluxPro11Model extends BaseImageModel {
  name = 'Flux Pro 1.1';
  description = 'Professional model by Black Forest Labs with excellent image quality, prompt adherence, and output diversity.';
  supportedResolutions = ['1024x1024', '768x768', '1152x896', '1344x768', '768x1344', '832x1216', '1216x832'];
  
  // Capability flags
  supportsNegativePrompt = false; // No negative prompt for Flux models
  supportsControlNet = false;
  supportsInpainting = false;
  supportsFaceEnhancement = false;
  supportsUpscaling = false;
  
  defaultSettings: ImageModelSettings = {
    resolution: '1024x1024',
    style: 'photorealistic',
    steps: 28, // Default for Flux 1.1 Pro
    guidance: 3.5, // Default for Flux 1.1 Pro
    negativePrompt: '',
    seed: undefined,
    aspectRatio: '1:1',
    promptStyle: 'balanced',
    outputFormat: 'jpg', // Default for Flux Pro is jpg (not jpeg)
    qualitySetting: 'standard',
    safety_tolerance: 2
  };
  
  async generateImage(prompt: string, settings: ImageModelSettings): Promise<ImageGenerationResponse> {
    console.log(`Generating image with Flux Pro 1.1: ${prompt}`);
    
    try {
      // Extract width and height from resolution for tracking in metadata
      const [width, height] = (settings.resolution || '1024x1024').split('x').map(Number);
      
      // Generate a random seed if not provided
      if (!settings.seed) {
        settings.seed = Math.floor(Math.random() * 1000000);
      }
      
      // Get the appropriate settings for the Flux Pro 1.1 model
      const replicateSettings = {
        ...getXenoSettings(settings, XenoModels.FLUX_PRO.model),
        prompt: prompt // Ensure prompt is included
      };
      
      console.log("Flux Pro 1.1 settings:", replicateSettings);
      console.log("Model:", XenoModels.FLUX_PRO.model);
      console.log("Version:", XenoModels.FLUX_PRO.version);
      console.log("API Endpoint:", API_ENDPOINTS.XENO_API);
      
      // Call Replicate API using the official Flux 1.1 Pro model
      return await generateImage(
        XenoModels.FLUX_PRO,
        prompt,
        replicateSettings
      );
    } catch (error) {
      console.error(`Error generating image with Flux Pro 1.1:`, error);
      throw error;
    }
  }
  
  async enhanceImage(imageUrl: string, settings: ImageModelSettings): Promise<ImageGenerationResponse> {
    // In a real implementation, this would call an image enhancement API
    console.log(`Enhancing image with Flux Pro 1.1`);
    
    // For now, return the original image
    return {
      imageUrl: imageUrl,
      metadata: {
        generationTime: 1.2,
        modelVersion: 'Flux Pro 1.1 Enhancement',
        enhancement: 'face_refinement'
      }
    };
  }
  
  async upscaleImage(imageUrl: string, scale: number): Promise<ImageGenerationResponse> {
    // In a real implementation, this would call an upscaling API
    console.log(`Upscaling image with Flux Pro 1.1, scale: ${scale}x`);
    
    // For now, return the original image
    return {
      imageUrl: imageUrl,
      metadata: {
        generationTime: 1.5,
        modelVersion: 'Flux Pro 1.1 Upscaler',
        scale: scale
      }
    };
  }
  
  renderModelSpecificSettings(
    settings: ImageModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* Prompt Style Selection */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Prompt Style</label>
          <div className="grid grid-cols-3 gap-2">
            {['precise', 'balanced', 'creative'].map((style) => (
              <button
                key={style}
                onClick={() => handleSettingChange('promptStyle', style)}
                className={`p-2 text-xs rounded-lg border capitalize transition-colors ${
                  settings.promptStyle === style
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {style}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Controls the balance between precision and creativity</p>
        </div>
        
        {/* Aspect Ratio Selection */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Aspect Ratio</label>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {[
              { label: 'Square', value: '1024x1024' },
              { label: 'Portrait', value: '832x1216' },
              { label: 'Landscape', value: '1216x832' }
            ].map((ratio) => (
              <button
                key={ratio.label}
                onClick={() => handleSettingChange('resolution', ratio.value)}
                className={`p-2 text-xs rounded-lg border capitalize transition-colors ${
                  settings.resolution === ratio.value
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {ratio.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Widescreen', value: '1152x896' },
              { label: 'Tall', value: '768x1344' },
              { label: 'Wide', value: '1344x768' }
            ].map((ratio) => (
              <button
                key={ratio.label}
                onClick={() => handleSettingChange('resolution', ratio.value)}
                className={`p-2 text-xs rounded-lg border capitalize transition-colors ${
                  settings.resolution === ratio.value
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {ratio.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Choose the aspect ratio for the generated image</p>
        </div>
        
        {/* Safety Tolerance Slider */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Safety Tolerance</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.safety_tolerance || 2}
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="6"
            step="1"
            value={settings.safety_tolerance || 2}
            onChange={(e) => handleSettingChange('safety_tolerance', parseInt(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <div className="flex justify-between text-xs text-white/50 mt-1">
            <span>Strict</span>
            <span>Permissive</span>
          </div>
          <p className="mt-2 text-xs text-white/50">Adjust filtering level from strict (1) to permissive (6)</p>
        </div>
        
        {/* Output Format */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Output Format</label>
          <div className="grid grid-cols-3 gap-2">
            {['jpg', 'png', 'webp'].map((format) => (
              <button
                key={format}
                onClick={() => handleSettingChange('outputFormat', format)}
                className={`p-2 text-xs rounded-lg border capitalize transition-colors ${
                  settings.outputFormat === format
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {format.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Format for the output image</p>
        </div>
        
        {/* Random Seed Generator */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Seed</label>
            <div className="flex items-center space-x-2">
              <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                {settings.seed || 'Random'}
              </span>
              <button
                onClick={() => handleSettingChange('seed', Math.floor(Math.random() * 1000000))}
                className="text-xs bg-white/10 hover:bg-white/20 text-white/70 p-1 rounded"
                title="Generate random seed"
              >
                🎲
              </button>
            </div>
          </div>
          <input
            type="number"
            value={settings.seed || ''}
            onChange={(e) => handleSettingChange('seed', e.target.value === '' ? undefined : parseInt(e.target.value))}
            placeholder="Enter seed value (or leave empty for random)"
            className="w-full bg-black/30 border border-white/10 rounded p-2 text-white text-xs mt-2"
          />
          <p className="mt-2 text-xs text-white/50">Same seed + prompt = reproducible results</p>
        </div>
      </>
    );
  }
}

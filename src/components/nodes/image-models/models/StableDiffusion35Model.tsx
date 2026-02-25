import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseImageModel } from '../BaseImageModel';
import { ImageModelSettings, ImageGenerationResponse } from '../ImageModelInterface';
import { generateImage, XenoModels, getXenoSettings } from '../../../../services/xenoImageService';

export class StableDiffusion35Model extends BaseImageModel {
  name = 'Stable Diffusion 3.5';
  description = 'Latest Stable Diffusion model with improved quality, versatility, and detail generation.';
  supportedResolutions = ['512x512', '768x768', '1024x1024', '1344x768', '768x1344', '1536x1536'];
  
  // Capability flags
  supportsNegativePrompt = true;
  supportsControlNet = true;
  supportsInpainting = true;
  supportsFaceEnhancement = true;
  supportsUpscaling = true;
  
  defaultSettings: ImageModelSettings = {
    resolution: '1024x1024',
    style: 'photorealistic',
    steps: 50,
    guidance: 7.0,
    negativePrompt: '',
    sampler: 'DPM++ 2M Karras',
    clipSkip: 1,
    batchSize: 1,
    useHiresFix: false,
    useVAETiling: false
  };
  
  async generateImage(prompt: string, settings: ImageModelSettings): Promise<ImageGenerationResponse> {
    console.log(`Generating image with Stable Diffusion 3.5: ${prompt}`);
    
    try {
      // Convert our internal settings to Replicate API format
      const replicateSettings = {
        ...getXenoSettings(settings),
        // Add model-specific settings
        scheduler: settings.sampler || "K_EULER_ANCESTRAL",
        apply_watermark: false,
        high_noise_frac: 0.8,
        prompt_strength: 1.0
      };
      
      // Call Replicate API
      return await generateImage(
        XenoModels.STABLE_DIFFUSION_XL,
        prompt,
        replicateSettings
      );
    } catch (error) {
      console.error(`Error generating image with Stable Diffusion 3.5:`, error);
      throw error;
    }
  }
  
  async enhanceImage(imageUrl: string, _settings: ImageModelSettings): Promise<ImageGenerationResponse> {
    // Simulate enhancement processing
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return {
      imageUrl: imageUrl, // In a real implementation, this would be the enhanced image URL
      metadata: {
        generationTime: 1.2,
        modelVersion: 'Stable Diffusion 3.5 Face Enhancer',
        enhancement: 'face_detail'
      }
    };
  }
  
  async upscaleImage(imageUrl: string, scale: number): Promise<ImageGenerationResponse> {
    // Simulate upscaling processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return {
      imageUrl: imageUrl, // In a real implementation, this would be the upscaled image URL
      metadata: {
        generationTime: 1.8,
        modelVersion: 'Stable Diffusion 3.5 Upscaler',
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
        {/* Sampler Selection */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Sampler</label>
          <select
            value={settings.sampler || 'DPM++ 2M Karras'}
            onChange={(e) => handleSettingChange('sampler', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="Euler a">Euler a</option>
            <option value="Euler">Euler</option>
            <option value="DPM++ 2M Karras">DPM++ 2M Karras</option>
            <option value="DPM++ SDE Karras">DPM++ SDE Karras</option>
            <option value="UniPC">UniPC</option>
            <option value="DDIM">DDIM</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Different samplers produce different image characteristics</p>
        </div>
        
        {/* CLIP Skip */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">CLIP Skip</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.clipSkip || 1}
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="4"
            step="1"
            value={settings.clipSkip || 1}
            onChange={(e) => handleSettingChange('clipSkip', parseInt(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Skip CLIP text encoder layers for different image styling</p>
        </div>
        
        {/* Advanced Toggles */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-3">Advanced Settings</label>
          <div className="space-y-3">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.useHiresFix || false}
                onChange={(e) => handleSettingChange('useHiresFix', e.target.checked)}
                className="rounded border-white/30 bg-black/30 text-white focus:ring-0 focus:ring-offset-0"
              />
              <span className="text-sm text-white/70">Use Hires Fix</span>
            </label>
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.useVAETiling || false}
                onChange={(e) => handleSettingChange('useVAETiling', e.target.checked)}
                className="rounded border-white/30 bg-black/30 text-white focus:ring-0 focus:ring-offset-0"
              />
              <span className="text-sm text-white/70">VAE Tiling</span>
            </label>
          </div>
          <p className="mt-2 text-xs text-white/50">Advanced options for higher quality or performance</p>
        </div>
      </>
    );
  }
} 
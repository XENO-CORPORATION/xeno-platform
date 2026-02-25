import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseImageModel } from '../BaseImageModel';
import { ImageModelSettings, ImageGenerationResponse } from '../ImageModelInterface';
import { generateImage, XenoModels, getXenoSettings } from '../../../../services/xenoImageService';
import { API_ENDPOINTS } from '../../../../config/apiConfig';

export class LumaPhotonModel extends BaseImageModel {
  name = 'Luma Photon';
  description = 'Advanced image generation with reference capabilities for high-quality, customizable outputs.';
  supportedResolutions = ['1024x1024', '768x1024', '1024x768', '576x1024', '1024x576', '448x1024', '1024x448'];
  
  // Capability flags
  supportsNegativePrompt = false; // Photon doesn't use negative prompts
  supportsControlNet = false;
  supportsInpainting = false;
  supportsFaceEnhancement = false;
  supportsUpscaling = false;
  supportsReferenceImages = true; // New capability flag for reference images
  
  defaultSettings: ImageModelSettings = {
    resolution: '1024x576', // Default to 16:9 aspect ratio
    steps: 30,
    guidance: 7.0,
    seed: undefined,
    style: 'photorealistic',
    imageReferenceUrl: '',
    imageReferenceWeight: 0.85,
    styleReferenceUrl: '',
    styleReferenceWeight: 0.85,
    characterReferenceUrl: ''
  };
  
  async generateImage(prompt: string, settings: ImageModelSettings): Promise<ImageGenerationResponse> {
    console.log(`Generating image with Luma Photon: ${prompt}`);
    
    try {
      // Get the appropriate settings for the Luma Photon model
      const replicateSettings = {
        ...getXenoSettings(settings, XenoModels.LUMA_PHOTON.model),
        prompt: prompt // Ensure prompt is included
      };
      
      console.log("Luma Photon settings:", replicateSettings);
      console.log("Model:", XenoModels.LUMA_PHOTON.model);
      console.log("Version:", XenoModels.LUMA_PHOTON.version);
      console.log("API Endpoint:", API_ENDPOINTS.REPLICATE_API);
      
      // Call Replicate API
      const result = await generateImage(
        XenoModels.LUMA_PHOTON,
        prompt,
        replicateSettings
      );
      
      // Validate the image URL
      if (!result.imageUrl || result.imageUrl.length < 10 || !result.imageUrl.startsWith('http')) {
        console.error('Invalid image URL received from Luma Photon:', result.imageUrl);
        throw new Error('Failed to generate a valid image URL with Luma Photon');
      }
      
      return result;
    } catch (error) {
      console.error(`Error generating image with Luma Photon:`, error);
      throw error;
    }
  }
  
  async enhanceImage(imageUrl: string, settings: ImageModelSettings): Promise<ImageGenerationResponse> {
    // For now, just return the original image
    // In a production environment, you would call the real enhancement API
    return {
      imageUrl: imageUrl,
      metadata: {
        generationTime: 1.5,
        modelVersion: 'Luma Photon Enhancer',
        enhancement: 'photo_realism'
      }
    };
  }
  
  async upscaleImage(imageUrl: string, scale: number): Promise<ImageGenerationResponse> {
    // Simulate upscaling processing
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    return {
      imageUrl: imageUrl, // In a real implementation, this would be the upscaled image URL
      metadata: {
        generationTime: 2.2,
        modelVersion: 'Luma Photon Upscaler',
        scale: scale,
        preserveDetails: true
      }
    };
  }
  
  renderModelSpecificSettings(
    settings: ImageModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* Aspect Ratio Selection */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Aspect Ratio</label>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {[
              { label: 'Square', value: '1024x1024', ratio: '1:1' },
              { label: 'Portrait', value: '768x1024', ratio: '3:4' },
              { label: 'Landscape', value: '1024x768', ratio: '4:3' }
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
              { label: 'Vertical', value: '576x1024', ratio: '9:16' },
              { label: 'Widescreen', value: '1024x576', ratio: '16:9' },
              { label: 'Panoramic', value: '1024x448', ratio: '21:9' }
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
        
        {/* Image Reference URL */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Image Reference URL</label>
          <input
            type="text"
            value={settings.imageReferenceUrl || ''}
            onChange={(e) => handleSettingChange('imageReferenceUrl', e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          />
          <p className="mt-2 text-xs text-white/50">URL of a reference image to guide generation</p>
          
          {settings.imageReferenceUrl && (
            <div className="mt-3">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium text-white/70">Reference Weight</label>
                <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                  {settings.imageReferenceWeight || 0.85}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.imageReferenceWeight || 0.85}
                onChange={(e) => handleSettingChange('imageReferenceWeight', parseFloat(e.target.value))}
                className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
              />
              <p className="mt-2 text-xs text-white/50">Higher values increase reference image influence</p>
            </div>
          )}
        </div>
        
        {/* Style Reference URL */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Style Reference URL</label>
          <input
            type="text"
            value={settings.styleReferenceUrl || ''}
            onChange={(e) => handleSettingChange('styleReferenceUrl', e.target.value)}
            placeholder="https://example.com/style.jpg"
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          />
          <p className="mt-2 text-xs text-white/50">URL of a style reference image</p>
          
          {settings.styleReferenceUrl && (
            <div className="mt-3">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium text-white/70">Style Weight</label>
                <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                  {settings.styleReferenceWeight || 0.85}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.styleReferenceWeight || 0.85}
                onChange={(e) => handleSettingChange('styleReferenceWeight', parseFloat(e.target.value))}
                className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
              />
              <p className="mt-2 text-xs text-white/50">Higher values increase style reference influence</p>
            </div>
          )}
        </div>
        
        {/* Character Reference URL */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Character Reference URL</label>
          <input
            type="text"
            value={settings.characterReferenceUrl || ''}
            onChange={(e) => handleSettingChange('characterReferenceUrl', e.target.value)}
            placeholder="https://example.com/character.jpg"
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          />
          <p className="mt-2 text-xs text-white/50">URL of a character reference image</p>
        </div>
      </>
    );
  }
} 
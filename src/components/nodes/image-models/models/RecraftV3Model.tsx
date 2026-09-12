import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseImageModel } from '../BaseImageModel';
import { ImageModelSettings, ImageGenerationResponse } from '../ImageModelInterface';
import { generateImage, XenoModels, getXenoSettings } from '../../../../services/xenoImageService';
import { API_ENDPOINTS } from '../../../../config/apiConfig';

export class RecraftV3Model extends BaseImageModel {
  name = 'Recraft V3';
  description = 'Versatile image generation model with multiple art styles and high-quality outputs.';
  supportedResolutions = [
    '1024x1024', '1365x1024', '1024x1365', '1536x1024', 
    '1024x1536', '1820x1024', '1024x1820', '1024x2048', 
    '2048x1024', '1434x1024', '1024x1434', '1024x1280', 
    '1280x1024', '1024x1707', '1707x1024'
  ];
  
  // Capability flags
  supportsNegativePrompt = false; // Recraft V3 doesn't use negative prompts in its schema
  supportsControlNet = false;
  supportsInpainting = false;
  supportsFaceEnhancement = false;
  supportsUpscaling = false;
  
  defaultSettings: ImageModelSettings = {
    resolution: '1024x1024',
    style: 'any', // Default style
    steps: 30,
    guidance: 7.5,
    seed: undefined
  };
  
  async generateImage(prompt: string, settings: ImageModelSettings): Promise<ImageGenerationResponse> {
    console.log(`Generating image with Recraft V3: ${prompt}`);
    
    try {
      // Get the appropriate settings for the Recraft V3 model
      const replicateSettings = {
        ...getXenoSettings(settings, XenoModels.RECRAFT_V3.model),
        prompt: prompt // Ensure prompt is included
      };
      
      console.log("Recraft V3 settings:", replicateSettings);
      console.log("Model:", XenoModels.RECRAFT_V3.model);
      console.log("Version:", XenoModels.RECRAFT_V3.version);
      console.log("API Endpoint:", API_ENDPOINTS.XENO_API);
      
      // Call Replicate API
      const result = await generateImage(
        XenoModels.RECRAFT_V3,
        prompt,
        replicateSettings
      );
      
      // Validate the image URL
      if (!result.imageUrl || result.imageUrl.length < 10 || !result.imageUrl.startsWith('http')) {
        console.error('Invalid image URL received from Recraft V3:', result.imageUrl);
        throw new Error('Failed to generate a valid image URL with Recraft V3');
      }
      
      return result;
    } catch (error) {
      console.error(`Error generating image with Recraft V3:`, error);
      throw error;
    }
  }
  
  renderModelSpecificSettings(
    settings: ImageModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    // List of style options from the schema
    const styleOptions = [
      { value: 'any', label: 'Any Style' },
      { value: 'realistic_image', label: 'Realistic Image' },
      { value: 'digital_illustration', label: 'Digital Illustration' },
      { value: 'digital_illustration/pixel_art', label: 'Pixel Art' },
      { value: 'digital_illustration/hand_drawn', label: 'Hand Drawn' },
      { value: 'digital_illustration/grain', label: 'Grain' },
      { value: 'digital_illustration/infantile_sketch', label: 'Infantile Sketch' },
      { value: 'digital_illustration/2d_art_poster', label: '2D Art Poster' },
      { value: 'digital_illustration/handmade_3d', label: 'Handmade 3D' },
      { value: 'digital_illustration/hand_drawn_outline', label: 'Hand Drawn Outline' },
      { value: 'digital_illustration/engraving_color', label: 'Engraving Color' },
      { value: 'digital_illustration/2d_art_poster_2', label: '2D Art Poster Alt' },
      { value: 'realistic_image/b_and_w', label: 'Black & White' },
      { value: 'realistic_image/hard_flash', label: 'Hard Flash' },
      { value: 'realistic_image/hdr', label: 'HDR Photography' },
      { value: 'realistic_image/natural_light', label: 'Natural Light' },
      { value: 'realistic_image/studio_portrait', label: 'Studio Portrait' },
      { value: 'realistic_image/enterprise', label: 'Enterprise' },
      { value: 'realistic_image/motion_blur', label: 'Motion Blur' }
    ];
    
    return (
      <>
        {/* Aspect Ratio Selection */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Output Size</label>
          <select
            value={settings.resolution || '1024x1024'}
            onChange={(e) => handleSettingChange('resolution', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            {this.supportedResolutions.map((res) => {
              const [width, height] = res.split('x');
              const label = `${res} (${width}×${height})`;
              return (
                <option key={res} value={res}>
                  {label}
                </option>
              );
            })}
          </select>
          <p className="mt-2 text-xs text-white/50">Width and height of the generated image</p>
        </div>
        
        {/* Style Selection */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Style</label>
          <select
            value={settings.style || 'any'}
            onChange={(e) => handleSettingChange('style', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            {styleOptions.map((style) => (
              <option key={style.value} value={style.value}>
                {style.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-white/50">Style of the generated image</p>
        </div>

        {/* Style Category Selector for Quick Navigation */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Style Category</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleSettingChange('style', 'any')}
              className={`p-2 text-xs rounded-lg border transition-colors ${
                settings.style === 'any'
                  ? 'bg-white/20 border-white/30 text-white'
                  : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
              }`}
            >
              Any Style
            </button>
            <button
              onClick={() => handleSettingChange('style', 'realistic_image')}
              className={`p-2 text-xs rounded-lg border transition-colors ${
                settings.style === 'realistic_image' || settings.style?.startsWith('realistic_image/')
                  ? 'bg-white/20 border-white/30 text-white'
                  : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
              }`}
            >
              Realistic
            </button>
            <button
              onClick={() => handleSettingChange('style', 'digital_illustration')}
              className={`p-2 text-xs rounded-lg border transition-colors ${
                settings.style === 'digital_illustration' || settings.style?.startsWith('digital_illustration/')
                  ? 'bg-white/20 border-white/30 text-white'
                  : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
              }`}
            >
              Digital Illustration
            </button>
          </div>
          <p className="mt-2 text-xs text-white/50">Quickly choose between style categories</p>
        </div>
        
        {/* Examples of Each Style Category */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Style Guide</label>
          <div className="text-xs text-white/70">
            <p className="mb-1"><strong>Realistic:</strong> Photorealistic images with natural lighting and detail</p>
            <p className="mb-1"><strong>Digital Illustration:</strong> Stylized digital art, vector graphics, and illustrations</p>
            <p className="mb-1"><strong>Any:</strong> Let the model decide the best style for your prompt</p>
          </div>
          <p className="mt-2 text-xs text-white/50">Select a specific style from the dropdown above for more precise control</p>
        </div>
      </>
    );
  }
}

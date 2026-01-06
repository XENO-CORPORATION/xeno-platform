import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseUpscaleModel } from '../BaseUpscaleModel';
import { UpscaleModelSettings, UpscaleResponse } from '../UpscaleModelInterface';

export class TopazLabsModel extends BaseUpscaleModel {
  name = 'Topaz Labs';
  description = 'Professional-grade upscaler with industry-leading quality and specialized processing modes.';
  maxUpscaleFactor = 6;
  supportedUpscaleFactors = [2, 4, 6];
  
  // Capability flags
  supportsFaceEnhancement = true;
  supportsArtifactRemoval = true;
  supportsDenoising = true;
  supportsAIDetectionRemoval = false;
  supportsTextEnhancement = true;
  
  defaultSettings: UpscaleModelSettings = {
    upscaleFactor: 4,
    denoise: 35,
    enhanceDetails: true,
    preserveColors: true,
    processingMode: 'photo',
    aiPreset: 'standard',
    grainReduction: 'medium',
    sharpening: 0.6,
    clearNoise: true,
    recoverDetail: 0.7
  };
  
  async upscaleImage(
    imageUrl: string,
    settings: UpscaleModelSettings
  ): Promise<UpscaleResponse> {
    // Simulate upscaling processing
    await new Promise(resolve => setTimeout(resolve, 4500));
    
    return {
      outputImageUrl: imageUrl, // In a real implementation, this would be the upscaled image URL
      metadata: {
        processingTime: 4.5,
        modelVersion: 'Topaz Gigapixel AI 6.3',
        originalSize: '900x600',
        outputSize: `${900 * settings.upscaleFactor}x${600 * settings.upscaleFactor}`,
        enhancementScore: 0.97,
        noiseReduced: settings.clearNoise,
        detailRecovered: settings.recoverDetail
      }
    };
  }
  
  renderModelSpecificSettings(
    settings: UpscaleModelSettings,
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* Processing Mode */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Processing Mode</label>
          <select
            value={settings.processingMode || 'photo'}
            onChange={(e) => handleSettingChange('processingMode', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="photo">Photo</option>
            <option value="artwork">Artwork</option>
            <option value="cg">CG/3D Art</option>
            <option value="text">Text Document</option>
            <option value="low-res">Low Resolution</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Optimizes processing for the specific content type</p>
        </div>
        
        {/* AI Preset */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">AI Preset</label>
          <select
            value={settings.aiPreset || 'standard'}
            onChange={(e) => handleSettingChange('aiPreset', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="standard">Standard</option>
            <option value="conservative">Conservative</option>
            <option value="aggressive">Aggressive</option>
            <option value="ultra">Ultra</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Controls the AI processing intensity</p>
        </div>
        
        {/* Grain Reduction */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Grain Reduction</label>
          <select
            value={settings.grainReduction || 'medium'}
            onChange={(e) => handleSettingChange('grainReduction', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="none">None</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="max">Maximum</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Controls the grain/noise removal strength</p>
        </div>
        
        {/* Sharpening */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Sharpening</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.sharpening || 0.6}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={settings.sharpening || 0.6}
            onChange={(e) => handleSettingChange('sharpening', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Controls image sharpness enhancement</p>
        </div>
        
        {/* Clear Noise Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Clear Noise</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="clearNoise"
                checked={settings.clearNoise !== false}
                onChange={(e) => handleSettingChange('clearNoise', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.clearNoise !== false ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Advanced noise reduction algorithm</p>
        </div>
        
        {/* Recover Detail */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Recover Detail</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.recoverDetail || 0.7}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={settings.recoverDetail || 0.7}
            onChange={(e) => handleSettingChange('recoverDetail', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Intelligently recovers lost details in the image</p>
        </div>
      </>
    );
  }
} 
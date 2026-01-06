import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseUpscaleModel } from '../BaseUpscaleModel';
import { UpscaleModelSettings, UpscaleResponse } from '../UpscaleModelInterface';

export class StabilityAIModel extends BaseUpscaleModel {
  name = 'Stability AI';
  description = 'High-quality upscaler with prompt-guided enhancement and intelligent detail restoration from Stability AI.';
  maxUpscaleFactor = 4;
  supportedUpscaleFactors = [2, 3, 4];
  
  // Capability flags
  supportsFaceEnhancement = true;
  supportsArtifactRemoval = true;
  supportsDenoising = true;
  supportsStyleTransfer = true;
  
  defaultSettings: UpscaleModelSettings = {
    upscaleFactor: 4,
    denoise: 45,
    enhanceDetails: true,
    preserveColors: true,
    promptGuidance: '',
    guidanceStrength: 0.3,
    enhancementStyle: 'photorealistic',
    detailRefinement: 'balanced',
    faceRestoration: true
  };
  
  async upscaleImage(
    imageUrl: string,
    settings: UpscaleModelSettings
  ): Promise<UpscaleResponse> {
    // Simulate upscaling processing
    await new Promise(resolve => setTimeout(resolve, 3500));
    
    return {
      outputImageUrl: imageUrl, // In a real implementation, this would be the upscaled image URL
      metadata: {
        processingTime: 3.5,
        modelVersion: 'Stability AI Upscaler 3.0',
        originalSize: '720x480',
        outputSize: `${720 * settings.upscaleFactor}x${480 * settings.upscaleFactor}`,
        enhancementScore: 0.94,
        guidancePromptUsed: settings.promptGuidance ? true : false,
        faceRestorationApplied: settings.faceRestoration
      }
    };
  }
  
  renderModelSpecificSettings(
    settings: UpscaleModelSettings,
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* Prompt Guidance */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Prompt Guidance</label>
          <textarea
            value={settings.promptGuidance || ''}
            onChange={(e) => handleSettingChange('promptGuidance', e.target.value)}
            placeholder="Optional: Describe specific details to enhance..."
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 min-h-[80px]"
          />
          <p className="mt-2 text-xs text-white/50">Guide the upscaler with specific enhancement instructions</p>
        </div>
        
        {/* Guidance Strength */}
        {settings.promptGuidance && (
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-white/70">Guidance Strength</label>
              <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                {settings.guidanceStrength || 0.3}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.guidanceStrength || 0.3}
              onChange={(e) => handleSettingChange('guidanceStrength', parseFloat(e.target.value))}
              className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
            />
            <p className="mt-2 text-xs text-white/50">Controls how strongly the prompt affects the result</p>
          </div>
        )}
        
        {/* Enhancement Style */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Enhancement Style</label>
          <select
            value={settings.enhancementStyle || 'photorealistic'}
            onChange={(e) => handleSettingChange('enhancementStyle', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="photorealistic">Photorealistic</option>
            <option value="artistic">Artistic</option>
            <option value="enhanced">Enhanced</option>
            <option value="cinematic">Cinematic</option>
            <option value="anime">Anime</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Select overall enhancement style</p>
        </div>
        
        {/* Detail Refinement */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Detail Refinement</label>
          <div className="grid grid-cols-3 gap-2">
            {['minimal', 'balanced', 'aggressive'].map((mode) => (
              <button
                key={mode}
                onClick={() => handleSettingChange('detailRefinement', mode)}
                className={`p-2 text-xs rounded-lg border capitalize transition-colors ${
                  settings.detailRefinement === mode
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Controls the level of detail enhancement</p>
        </div>
        
        {/* Face Restoration Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Face Restoration</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="faceRestoration"
                checked={settings.faceRestoration !== false}
                onChange={(e) => handleSettingChange('faceRestoration', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.faceRestoration !== false ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Detect and enhance faces in the image</p>
        </div>
      </>
    );
  }
} 
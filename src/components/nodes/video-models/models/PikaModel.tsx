import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseVideoModel } from '../BaseVideoModel';
import { VideoModelSettings, VideoGenerationResponse } from '../VideoModelInterface';

export class PikaModel extends BaseVideoModel {
  name = 'Pika';
  description = 'Fast and versatile video generation optimized for creative motion and animation effects with a focus on storytelling.';
  supportedResolutions = ['512x512', '640x640', '768x768', '1024x1024', '1280x720', '1080x1920'];
  supportedFpsRanges = [24, 30];
  
  // Capability flags
  supportsTextToVideo = true;
  supportsImageToVideo = true;
  supportsVideoToVideo = false;
  supportsStoryboard = true;
  supportsMusicGeneration = false;
  supportsExtendedDuration = false;
  
  defaultSettings: VideoModelSettings = {
    duration: 3,
    fps: 24,
    resolution: '1024x1024',
    motionStrength: 60,
    stabilization: 70,
    animationStyle: 'realistic',
    promptStrength: 7.5,
    negativePrompt: '',
    seed: -1,
    guidanceScale: 8.0,
    motionBrushStrength: 50
  };
  
  async generateVideo(
    prompt: string,
    settings: VideoModelSettings,
    imageUrl?: string
  ): Promise<VideoGenerationResponse> {
    // In a real implementation, this would call the Pika API
    console.log(`Generating video with Pika: ${prompt}`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 3500));
    
    // This would be the actual video URL in a real implementation
    const mockVideoUrl = 'https://example.com/mock-pika-video.mp4';
    
    return {
      videoUrl: mockVideoUrl,
      metadata: {
        generationTime: 3.2,
        promptTokens: prompt.length / 4,
        modelVersion: 'Pika 1.0',
        resolution: settings.resolution,
        fps: settings.fps,
        duration: settings.duration,
        animationStyle: settings.animationStyle,
        promptStrength: settings.promptStrength,
        seed: settings.seed !== -1 ? settings.seed : Math.floor(Math.random() * 1000000),
        usedImagePrompt: !!imageUrl
      }
    };
  }
  
  renderModelSpecificSettings(
    settings: VideoModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* Animation Style */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Animation Style</label>
          <select
            value={settings.animationStyle || 'realistic'}
            onChange={(e) => handleSettingChange('animationStyle', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="realistic">Realistic</option>
            <option value="stylized">Stylized</option>
            <option value="anime">Anime</option>
            <option value="cartoon">Cartoon</option>
            <option value="3d-animation">3D Animation</option>
            <option value="claymation">Claymation</option>
            <option value="stopmotion">Stop Motion</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Sets the overall animation style</p>
        </div>
        
        {/* Prompt Strength */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Prompt Strength</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.promptStrength || 7.5}
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="15"
            step="0.5"
            value={settings.promptStrength || 7.5}
            onChange={(e) => handleSettingChange('promptStrength', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Controls how closely the video follows the prompt</p>
        </div>
        
        {/* Negative Prompt */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Negative Prompt</label>
          <textarea
            value={settings.negativePrompt || ''}
            onChange={(e) => handleSettingChange('negativePrompt', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm min-h-[60px] focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20 resize-none"
            placeholder="Things to avoid in the video..."
          />
          <p className="mt-2 text-xs text-white/50">Specify elements to exclude from the generation</p>
        </div>
        
        {/* Seed Setting */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-white/70">Random Seed</label>
            <div className="flex space-x-2">
              <input
                type="number"
                value={settings.seed || -1}
                onChange={(e) => handleSettingChange('seed', parseInt(e.target.value))}
                className="w-24 bg-black/30 text-white border border-white/10 rounded-lg p-1 text-xs focus:outline-none focus:ring-1 focus:ring-white/20"
                placeholder="-1 (random)"
              />
              <button 
                className="bg-black/30 text-white/70 border border-white/10 rounded-lg px-2 text-xs hover:bg-black/40 hover:text-white transition-colors"
                onClick={() => handleSettingChange('seed', Math.floor(Math.random() * 1000000))}
              >
                Random
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Set to -1 for random generation, or specify for reproducible results</p>
        </div>
        
        {/* Motion Brush Strength */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Motion Brush</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.motionBrushStrength || 50}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={settings.motionBrushStrength || 50}
            onChange={(e) => handleSettingChange('motionBrushStrength', parseInt(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Controls directional motion intensity</p>
        </div>
      </>
    );
  }
} 
import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseVideoModel } from '../BaseVideoModel';
import { VideoModelSettings, VideoGenerationResponse } from '../VideoModelInterface';
import { XenoModels } from '../../../../services/xenoImageService';

export class Wan21Model extends BaseVideoModel {
  id = 'wan-2.1-1.3b';
  name = 'Wan 2.1';
  description = 'High-quality video generation model with detailed motion and scene rendering capabilities.';
  supportedResolutions = ['512x512', '768x768', '1024x1024', '576x1024', '1024x576'];
  supportedFpsRanges = [8, 16, 24, 30];
  
  // Capability flags
  supportsTextToVideo = true;
  supportsImageToVideo = false;
  supportsVideoToVideo = false;
  supportsStoryboard = false;
  supportsMusicGeneration = false;
  supportsExtendedDuration = false;
  
  defaultSettings: VideoModelSettings = {
    duration: 4,
    fps: 24,
    resolution: '1024x1024',
    motionStrength: 70,
    stabilization: 80,
    steps: 30,
    guidance: 8.0,
    seed: -1
  };
  
  async generateVideo(
    prompt: string,
    settings: VideoModelSettings,
    imageUrl?: string
  ): Promise<VideoGenerationResponse> {
    console.log(`Generating video with Wan 2.1: ${prompt}`);
    
    try {
      // In a real implementation, this would call the Replicate API
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 4200));
      
      // This would be the actual video URL in a real implementation
      const mockVideoUrl = 'https://example.com/mock-video.mp4';
      
      return {
        videoUrl: mockVideoUrl,
        metadata: {
          generationTime: 4.2,
          promptTokens: prompt.length / 4,
          modelVersion: `Wan 2.1 (${XenoModels.WAN_2_1_1_3B.version.substring(0, 8)})`,
          resolution: settings.resolution,
          fps: settings.fps,
          duration: settings.duration,
          steps: settings.steps,
          guidance: settings.guidance,
          seed: settings.seed
        }
      };
    } catch (error) {
      console.error('Error generating video with Wan 2.1:', error);
      throw error;
    }
  }
  
  renderModelSpecificSettings(
    settings: VideoModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* Steps Control */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Steps</label>
          <div className="flex items-center">
            <input
              type="range"
              min="10"
              max="50"
              step="1"
              value={settings.steps || 30}
              onChange={(e) => handleSettingChange('steps', parseInt(e.target.value))}
              className="w-full h-2 bg-black/40 rounded-lg appearance-none cursor-pointer"
            />
            <span className="ml-2 text-xs text-white/80 min-w-[30px] text-right">
              {settings.steps || 30}
            </span>
          </div>
          <p className="mt-2 text-xs text-white/50">Higher steps produce more refined videos but take longer</p>
        </div>
        
        {/* Guidance Control */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Guidance Scale</label>
          <div className="flex items-center">
            <input
              type="range"
              min="1"
              max="15"
              step="0.1"
              value={settings.guidance || 8.0}
              onChange={(e) => handleSettingChange('guidance', parseFloat(e.target.value))}
              className="w-full h-2 bg-black/40 rounded-lg appearance-none cursor-pointer"
            />
            <span className="ml-2 text-xs text-white/80 min-w-[30px] text-right">
              {settings.guidance || 8.0}
            </span>
          </div>
          <p className="mt-2 text-xs text-white/50">How closely to follow the prompt (higher values = more faithful)</p>
        </div>
      </>
    );
  }
} 
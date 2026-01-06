import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseVideoModel } from '../BaseVideoModel';
import { VideoModelSettings, VideoGenerationResponse } from '../VideoModelInterface';
import { ReplicateModels } from '../../../../services/replicateService';

export class MinimaxVideo01Model extends BaseVideoModel {
  id = 'minimax-video-01';
  name = 'Minimax Video 01';
  description = 'Specializes in realistic human motion and facial expressions with detailed background rendering.';
  supportedResolutions = ['512x512', '768x768', '1024x1024', '640x1024', '1024x640'];
  supportedFpsRanges = [24, 30];
  
  // Capability flags
  supportsTextToVideo = true;
  supportsImageToVideo = false;
  supportsVideoToVideo = false;
  supportsStoryboard = false;
  supportsMusicGeneration = false;
  supportsExtendedDuration = false;
  
  defaultSettings: VideoModelSettings = {
    duration: 3,
    fps: 24,
    resolution: '1024x1024',
    motionStrength: 65,
    stabilization: 75,
    humanMotionOptimization: true,
    qualityPreset: 'high',
    expressionDetail: 'natural',
    seed: -1
  };
  
  async generateVideo(
    prompt: string,
    settings: VideoModelSettings,
    imageUrl?: string
  ): Promise<VideoGenerationResponse> {
    console.log(`Generating video with Minimax Video 01: ${prompt}`);
    
    try {
      // In a real implementation, this would call the Replicate API
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 3500));
      
      // This would be the actual video URL in a real implementation
      const mockVideoUrl = 'https://example.com/mock-video.mp4';
      
      return {
        videoUrl: mockVideoUrl,
        metadata: {
          generationTime: 3.5,
          promptTokens: prompt.length / 4,
          modelVersion: `Minimax Video 01 (${ReplicateModels.MINIMAX_VIDEO_01.version.substring(0, 8)})`,
          resolution: settings.resolution,
          fps: settings.fps,
          duration: settings.duration,
          motionStrength: settings.motionStrength,
          stabilization: settings.stabilization,
          humanMotionOptimization: settings.humanMotionOptimization,
          qualityPreset: settings.qualityPreset,
          expressionDetail: settings.expressionDetail
        }
      };
    } catch (error) {
      console.error('Error generating video with Minimax Video 01:', error);
      throw error;
    }
  }
  
  renderModelSpecificSettings(
    settings: VideoModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* Quality Preset */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Quality Preset</label>
          <select
            value={settings.qualityPreset || 'high'}
            onChange={(e) => handleSettingChange('qualityPreset', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="standard">Standard</option>
            <option value="high">High</option>
            <option value="ultra">Ultra</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Higher quality takes longer to generate</p>
        </div>
        
        {/* Expression Detail */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Expression Detail</label>
          <select
            value={settings.expressionDetail || 'natural'}
            onChange={(e) => handleSettingChange('expressionDetail', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="minimal">Minimal</option>
            <option value="natural">Natural</option>
            <option value="detailed">Detailed</option>
            <option value="exaggerated">Exaggerated</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Controls the level of facial expression detail</p>
        </div>
        
        {/* Human Motion Optimization Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Human Motion Optimization</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="humanMotionOptimization"
                checked={settings.humanMotionOptimization !== false}
                onChange={(e) => handleSettingChange('humanMotionOptimization', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.humanMotionOptimization !== false ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Enhances natural human movement and facial expressions</p>
        </div>
      </>
    );
  }
} 
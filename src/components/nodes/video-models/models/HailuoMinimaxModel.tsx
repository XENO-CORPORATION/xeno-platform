import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseVideoModel } from '../BaseVideoModel';
import { VideoModelSettings, VideoGenerationResponse } from '../VideoModelInterface';

export class HailuoMinimaxModel extends BaseVideoModel {
  name = 'Hailuo Minimax';
  description = 'Multimodal video generation model emphasizing detailed and precise control over movement and camera angles.';
  supportedResolutions = ['512x512', '768x768', '1024x1024', '1280x720', '1920x1080'];
  supportedFpsRanges = [24, 30];
  
  // Capability flags
  supportsTextToVideo = true;
  supportsImageToVideo = true;
  supportsVideoToVideo = false;
  supportsStoryboard = false;
  supportsMusicGeneration = false;
  supportsExtendedDuration = false;
  
  defaultSettings: VideoModelSettings = {
    duration: 3,
    fps: 24,
    resolution: '1024x1024',
    motionStrength: 65,
    stabilization: 80,
    detailLevel: 'high',
    promptPrecision: 8.5,
    negativePrompt: 'blurry, low quality, distorted',
    cameraMovement: 'static',
    colorProfile: 'natural',
    seed: -1
  };
  
  async generateVideo(
    prompt: string,
    settings: VideoModelSettings,
    imageUrl?: string
  ): Promise<VideoGenerationResponse> {
    // In a real implementation, this would call the Hailuo API
    console.log(`Generating video with Hailuo Minimax: ${prompt}`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 4500));
    
    // This would be the actual video URL in a real implementation
    const mockVideoUrl = 'https://example.com/mock-video.mp4';
    
    return {
      videoUrl: mockVideoUrl,
      metadata: {
        generationTime: 4.3,
        promptTokens: prompt.length / 4,
        modelVersion: 'Hailuo Minimax 1.0',
        resolution: settings.resolution,
        fps: settings.fps,
        duration: settings.duration,
        motionStrength: settings.motionStrength,
        stabilization: settings.stabilization,
        detailLevel: settings.detailLevel,
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
        {/* Detail Level */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Detail Level</label>
          <select
            value={settings.detailLevel || 'high'}
            onChange={(e) => handleSettingChange('detailLevel', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="standard">Standard</option>
            <option value="high">High</option>
            <option value="ultra">Ultra</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Controls the level of visual details</p>
        </div>
        
        {/* Prompt Precision */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Prompt Precision</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.promptPrecision || 8.5}
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="10"
            step="0.5"
            value={settings.promptPrecision || 8.5}
            onChange={(e) => handleSettingChange('promptPrecision', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Controls how closely the video follows the prompt</p>
        </div>
        
        {/* Camera Movement */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Camera Movement</label>
          <div className="grid grid-cols-2 gap-2">
            {['static', 'pan', 'zoom', 'orbit'].map((movement) => (
              <button
                key={movement}
                onClick={() => handleSettingChange('cameraMovement', movement)}
                className={`p-2 text-xs rounded-lg border capitalize transition-colors ${
                  settings.cameraMovement === movement
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {movement}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Sets the camera movement style</p>
        </div>
        
        {/* Color Profile */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Color Profile</label>
          <select
            value={settings.colorProfile || 'natural'}
            onChange={(e) => handleSettingChange('colorProfile', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="natural">Natural</option>
            <option value="vibrant">Vibrant</option>
            <option value="muted">Muted</option>
            <option value="filmic">Filmic</option>
            <option value="dramatic">Dramatic</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Sets the overall color style</p>
        </div>
        
        {/* Negative Prompt */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Negative Prompt</label>
          <textarea
            value={settings.negativePrompt || ''}
            onChange={(e) => handleSettingChange('negativePrompt', e.target.value)}
            placeholder="Specify what you don't want to see..."
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 min-h-[80px]"
          />
          <p className="mt-2 text-xs text-white/50">Elements to avoid in the generated video</p>
        </div>
      </>
    );
  }
} 
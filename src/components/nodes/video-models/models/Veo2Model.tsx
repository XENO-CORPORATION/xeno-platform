import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseVideoModel } from '../BaseVideoModel';
import { VideoModelSettings, VideoGenerationResponse } from '../VideoModelInterface';

export class Veo2Model extends BaseVideoModel {
  name = 'Veo 2';
  description = 'Specialized in high-speed action sequences with impressive motion smoothness and visual continuity.';
  supportedResolutions = ['640x640', '768x768', '1024x1024', '1280x720', '1920x1080'];
  supportedFpsRanges = [24, 30, 60];
  
  // Capability flags
  supportsTextToVideo = true;
  supportsImageToVideo = true;
  supportsVideoToVideo = true;
  supportsStoryboard = false;
  supportsMusicGeneration = false;
  supportsExtendedDuration = true;
  
  defaultSettings: VideoModelSettings = {
    duration: 4,
    fps: 30,
    resolution: '1024x1024',
    motionStrength: 75,
    stabilization: 70,
    focalLength: 50,
    motionBlur: 0.2,
    actionStyle: 'balanced',
    speedFactor: 1.0,
    smoothingFactor: 0.8,
    filterStrength: 'medium'
  };
  
  async generateVideo(
    prompt: string,
    settings: VideoModelSettings,
    imageUrl?: string
  ): Promise<VideoGenerationResponse> {
    // In a real implementation, this would call the Veo API
    console.log(`Generating video with Veo 2: ${prompt}`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 3800));
    
    // This would be the actual video URL in a real implementation
    const mockVideoUrl = 'https://example.com/mock-video.mp4';
    
    return {
      videoUrl: mockVideoUrl,
      metadata: {
        generationTime: 3.8,
        promptTokens: prompt.length / 4,
        modelVersion: 'Veo 2.1',
        resolution: settings.resolution,
        fps: settings.fps,
        duration: settings.duration,
        motionStrength: settings.motionStrength,
        stabilization: settings.stabilization,
        actionStyle: settings.actionStyle,
        usedImagePrompt: !!imageUrl
      }
    };
  }
  
  async extendVideoSequence(
    videoUrl: string, 
    duration: number, 
    settings: VideoModelSettings
  ): Promise<VideoGenerationResponse> {
    // Simulate video extension
    await new Promise(resolve => setTimeout(resolve, 3500));
    
    return {
      videoUrl: videoUrl, // In a real implementation, this would be the extended video
      metadata: {
        generationTime: 3.5,
        modelVersion: 'Veo 2.1 Extend',
        originalDuration: settings.duration,
        extendedDuration: duration,
        continuityScore: 0.85
      }
    };
  }
  
  renderModelSpecificSettings(
    settings: VideoModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* Action Style */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Action Style</label>
          <select
            value={settings.actionStyle || 'balanced'}
            onChange={(e) => handleSettingChange('actionStyle', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="subtle">Subtle</option>
            <option value="balanced">Balanced</option>
            <option value="dynamic">Dynamic</option>
            <option value="intense">Intense</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Sets the intensity of action and movement</p>
        </div>
        
        {/* Focal Length */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Focal Length</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.focalLength || 50}mm
            </span>
          </div>
          <input
            type="range"
            min="18"
            max="135"
            step="1"
            value={settings.focalLength || 50}
            onChange={(e) => handleSettingChange('focalLength', parseInt(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Controls field of view and perspective</p>
        </div>
        
        {/* Motion Blur */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Motion Blur</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.motionBlur || 0.2}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={settings.motionBlur || 0.2}
            onChange={(e) => handleSettingChange('motionBlur', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Adjusts motion blur amount for dynamic scenes</p>
        </div>
        
        {/* Speed Factor */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Speed Factor</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.speedFactor || 1.0}x
            </span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={settings.speedFactor || 1.0}
            onChange={(e) => handleSettingChange('speedFactor', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Adjusts the overall speed of motion in the video</p>
        </div>
        
        {/* Filter Strength */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Filter Strength</label>
          <div className="grid grid-cols-3 gap-2">
            {['light', 'medium', 'strong'].map((strength) => (
              <button
                key={strength}
                onClick={() => handleSettingChange('filterStrength', strength)}
                className={`p-2 text-xs rounded-lg border capitalize transition-colors ${
                  settings.filterStrength === strength
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {strength}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Controls image processing intensity</p>
        </div>
      </>
    );
  }
} 
import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseVideoModel } from '../BaseVideoModel';
import { VideoModelSettings, VideoGenerationResponse } from '../VideoModelInterface';

export class KlingStandard16Model extends BaseVideoModel {
  name = 'Kling Standard 1.6';
  description = 'Standard edition model balancing quality and speed with consistent results optimized for storytelling.';
  supportedResolutions = ['512x512', '768x768', '1024x1024', '1280x720', '1920x1080'];
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
    stabilization: 75,
    narrativeStyle: 'neutral',
    coherenceLevel: 0.75,
    compositionalBalance: 'centered',
    temperatureValue: 0.7,
    seed: -1,
    narrativeGuidance: ''
  };
  
  async generateVideo(
    prompt: string,
    settings: VideoModelSettings,
    imageUrl?: string
  ): Promise<VideoGenerationResponse> {
    // In a real implementation, this would call the Kling API
    console.log(`Generating video with Kling Standard 1.6: ${prompt}`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 3200));
    
    // This would be the actual video URL in a real implementation
    const mockVideoUrl = 'https://example.com/mock-video.mp4';
    
    return {
      videoUrl: mockVideoUrl,
      metadata: {
        generationTime: 3.2,
        promptTokens: prompt.length / 4,
        modelVersion: 'Kling Standard 1.6',
        resolution: settings.resolution,
        fps: settings.fps,
        duration: settings.duration,
        motionStrength: settings.motionStrength,
        stabilization: settings.stabilization,
        narrativeStyle: settings.narrativeStyle,
        coherenceLevel: settings.coherenceLevel,
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
        {/* Narrative Style */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Narrative Style</label>
          <select
            value={settings.narrativeStyle || 'neutral'}
            onChange={(e) => handleSettingChange('narrativeStyle', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="neutral">Neutral</option>
            <option value="dramatic">Dramatic</option>
            <option value="emotional">Emotional</option>
            <option value="documentary">Documentary</option>
            <option value="cinematic">Cinematic</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Sets the overall storytelling tone</p>
        </div>
        
        {/* Coherence Level */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Coherence Level</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.coherenceLevel || 0.75}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.coherenceLevel || 0.75}
            onChange={(e) => handleSettingChange('coherenceLevel', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Controls consistency between frames</p>
        </div>
        
        {/* Compositional Balance */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Compositional Balance</label>
          <div className="grid grid-cols-3 gap-2">
            {['left', 'centered', 'right'].map((balance) => (
              <button
                key={balance}
                onClick={() => handleSettingChange('compositionalBalance', balance)}
                className={`p-2 text-xs rounded-lg border capitalize transition-colors ${
                  settings.compositionalBalance === balance
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {balance}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Sets the visual weight distribution</p>
        </div>
        
        {/* Temperature */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Temperature</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.temperatureValue || 0.7}
            </span>
          </div>
          <input
            type="range"
            min="0.1"
            max="1.5"
            step="0.1"
            value={settings.temperatureValue || 0.7}
            onChange={(e) => handleSettingChange('temperatureValue', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Controls randomness and creativity</p>
        </div>
        
        {/* Narrative Guidance */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Narrative Guidance</label>
          <textarea
            value={settings.narrativeGuidance || ''}
            onChange={(e) => handleSettingChange('narrativeGuidance', e.target.value)}
            placeholder="Add extra context for the story..."
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 min-h-[80px]"
          />
          <p className="mt-2 text-xs text-white/50">Additional storytelling instructions</p>
        </div>
      </>
    );
  }
} 
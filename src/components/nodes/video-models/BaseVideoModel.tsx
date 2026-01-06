import React from 'react'; // Keep React import for JSX in renderModelSettings
import { VideoModelInterface, VideoModelSettings, VideoGenerationResponse } from './VideoModelInterface';

/**
 * Abstract base class for video model implementations
 * Provides common functionality and default implementations
 */
export abstract class BaseVideoModel implements VideoModelInterface {
  // Abstract properties that must be implemented by subclasses
  abstract name: string;
  abstract description: string;
  abstract supportedResolutions: string[];
  abstract supportedFpsRanges: number[];
  abstract defaultSettings: VideoModelSettings;
  
  // Optional capabilities with default values
  supportsTextToVideo: boolean = true;
  supportsImageToVideo: boolean = true;
  supportsVideoToVideo: boolean = false;
  supportsStoryboard: boolean = false;
  supportsMusicGeneration: boolean = false;
  supportsExtendedDuration: boolean = false;
  
  // Abstract methods that must be implemented by subclasses
  abstract generateVideo(
    prompt: string,
    settings: VideoModelSettings,
    imageUrl?: string
  ): Promise<VideoGenerationResponse>;
  
  // Optional methods with default implementations
  async addMusicToVideo(
    videoUrl: string, 
    _musicPrompt: string, 
    _settings: VideoModelSettings
  ): Promise<VideoGenerationResponse> {
    if (!this.supportsMusicGeneration) {
      throw new Error(`Music generation not supported for ${this.name}`);
    }
    
    // Default implementation returns the original video
    return {
      videoUrl,
      metadata: {
        generationTime: 0,
        modelVersion: this.name
      }
    };
  }
  
  async extendVideoSequence(
    videoUrl: string, 
    _duration: number, 
    _settings: VideoModelSettings
  ): Promise<VideoGenerationResponse> {
    if (!this.supportsExtendedDuration) {
      throw new Error(`Video extension not supported for ${this.name}`);
    }
    
    // Default implementation returns the original video
    return {
      videoUrl,
      metadata: {
        generationTime: 0,
        modelVersion: this.name
      }
    };
  }
  
  // Default UI rendering for common settings
  renderModelSettings(
    settings: VideoModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <div className="space-y-4">
        {/* Duration Control */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Duration</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.duration}s
            </span>
          </div>
          <input
            type="range"
            min="1"
            max={this.supportsExtendedDuration ? 30 : 10}
            value={settings.duration}
            onChange={(e) => handleSettingChange('duration', parseInt(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Set the output video duration in seconds</p>
        </div>

        {/* Frame Rate Selection */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Frame Rate</label>
          <div className="grid grid-cols-3 gap-2">
            {this.supportedFpsRanges.map((rate) => (
              <button
                key={rate}
                onClick={() => handleSettingChange('fps', rate)}
                className={`p-2 text-xs rounded-lg border transition-colors ${
                  settings.fps === rate
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {rate} FPS
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Choose the video frame rate</p>
        </div>
        
        {/* Resolution Selection (if multiple resolutions are supported) */}
        {this.supportedResolutions.length > 1 && (
          <div className="bg-black/20 rounded-lg p-4">
            <label className="block text-xs font-medium text-white/70 mb-2">Resolution</label>
            <select
              value={settings.resolution || this.supportedResolutions[0]}
              onChange={(e) => handleSettingChange('resolution', e.target.value)}
              className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
            >
              {this.supportedResolutions.map(res => (
                <option key={res} value={res}>{res}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-white/50">Select the output video resolution</p>
          </div>
        )}
        
        {/* Motion Strength (if supported) */}
        {settings.motionStrength !== undefined && (
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-white/70">Motion Strength</label>
              <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                {settings.motionStrength}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.motionStrength}
              onChange={(e) => handleSettingChange('motionStrength', parseInt(e.target.value))}
              className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
            />
            <p className="mt-2 text-xs text-white/50">Control the intensity of motion</p>
          </div>
        )}
        
        {/* Stabilization (if supported) */}
        {settings.stabilization !== undefined && (
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-white/70">Stabilization</label>
              <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                {settings.stabilization}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.stabilization}
              onChange={(e) => handleSettingChange('stabilization', parseInt(e.target.value))}
              className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
            />
            <p className="mt-2 text-xs text-white/50">Higher values produce smoother motion</p>
          </div>
        )}
        
        {/* Model-specific settings can be added by subclasses */}
        {this.renderModelSpecificSettings(settings, handleSettingChange)}
      </div>
    );
  }
  
  // Method for subclasses to override to add model-specific settings
  renderModelSpecificSettings(
    _settings: VideoModelSettings, 
    _handleSettingChange: (key: string, value: any) => void
  ): JSX.Element | null {
    return null;
  }
} 
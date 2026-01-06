import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseVideoModel } from '../BaseVideoModel';
import { VideoModelSettings, VideoGenerationResponse } from '../VideoModelInterface';

export class LumaDreamMachineModel extends BaseVideoModel {
  name = 'Luma Dream Machine';
  description = 'Creative-focused model specializing in artistic and surreal video generation with advanced stylization capabilities.';
  supportedResolutions = ['768x768', '1024x1024', '1280x720', '1920x1080'];
  supportedFpsRanges = [24, 30];
  
  // Capability flags
  supportsTextToVideo = true;
  supportsImageToVideo = true;
  supportsVideoToVideo = false;
  supportsStoryboard = true;
  supportsMusicGeneration = true;
  supportsExtendedDuration = false;
  
  defaultSettings: VideoModelSettings = {
    duration: 4,
    fps: 24,
    resolution: '1024x1024',
    motionStrength: 80,
    stabilization: 65,
    artisticStyle: 'dreamlike',
    colorVibrance: 0.7,
    surrealism: 0.6,
    stylization: 0.8,
    loopingType: 'none',
    soundDesign: true,
    creativityLevel: 0.9,
    visualMood: 'magical'
  };
  
  async generateVideo(
    prompt: string,
    settings: VideoModelSettings,
    imageUrl?: string
  ): Promise<VideoGenerationResponse> {
    // In a real implementation, this would call the Luma Dream Machine API
    console.log(`Generating video with Luma Dream Machine: ${prompt}`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 4200));
    
    // This would be the actual video URL in a real implementation
    const mockVideoUrl = 'https://example.com/mock-video.mp4';
    
    return {
      videoUrl: mockVideoUrl,
      metadata: {
        generationTime: 4.2,
        promptTokens: prompt.length / 4,
        modelVersion: 'Luma Dream Machine 1.0',
        resolution: settings.resolution,
        fps: settings.fps,
        duration: settings.duration,
        motionStrength: settings.motionStrength,
        stabilization: settings.stabilization,
        artisticStyle: settings.artisticStyle,
        stylization: settings.stylization,
        usedImagePrompt: !!imageUrl
      }
    };
  }
  
  async addMusicToVideo(
    videoUrl: string, 
    musicPrompt: string, 
    settings: VideoModelSettings
  ): Promise<VideoGenerationResponse> {
    // Simulate music generation
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    return {
      videoUrl: videoUrl, // In a real implementation, this would be the video with added music
      metadata: {
        generationTime: 2.5,
        modelVersion: 'Luma Dream Machine Audio',
        musicPrompt: musicPrompt,
        soundDesign: settings.soundDesign,
        audioType: 'generative',
        audioDuration: settings.duration
      }
    };
  }
  
  renderModelSpecificSettings(
    settings: VideoModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* Artistic Style */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Artistic Style</label>
          <select
            value={settings.artisticStyle || 'dreamlike'}
            onChange={(e) => handleSettingChange('artisticStyle', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="dreamlike">Dreamlike</option>
            <option value="surreal">Surreal</option>
            <option value="psychedelic">Psychedelic</option>
            <option value="abstract">Abstract</option>
            <option value="expressionist">Expressionist</option>
            <option value="fantastic">Fantastic</option>
            <option value="ethereal">Ethereal</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Sets the overall artistic direction</p>
        </div>
        
        {/* Color Vibrance */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Color Vibrance</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.colorVibrance || 0.7}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={settings.colorVibrance || 0.7}
            onChange={(e) => handleSettingChange('colorVibrance', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Controls color intensity and saturation</p>
        </div>
        
        {/* Surrealism Level */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Surrealism</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.surrealism || 0.6}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={settings.surrealism || 0.6}
            onChange={(e) => handleSettingChange('surrealism', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Controls how dreamlike and surreal the video appears</p>
        </div>
        
        {/* Stylization */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Stylization</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.stylization || 0.8}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={settings.stylization || 0.8}
            onChange={(e) => handleSettingChange('stylization', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Controls the strength of the artistic style</p>
        </div>
        
        {/* Looping Type */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Looping Type</label>
          <select
            value={settings.loopingType || 'none'}
            onChange={(e) => handleSettingChange('loopingType', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="none">None</option>
            <option value="seamless">Seamless Loop</option>
            <option value="reverse">Ping-pong (Forward/Reverse)</option>
            <option value="mobiusStrip">Mobius (Smooth Transition)</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Sets how the video should loop</p>
        </div>
        
        {/* Visual Mood */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Visual Mood</label>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {['magical', 'dark', 'bright', 'nostalgic', 'futuristic', 'mystical'].map((mood) => (
              <button
                key={mood}
                onClick={() => handleSettingChange('visualMood', mood)}
                className={`p-2 text-xs rounded-lg border capitalize transition-colors ${
                  settings.visualMood === mood
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {mood}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Sets the emotional tone of the visuals</p>
        </div>
        
        {/* Sound Design Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Sound Design</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="soundDesign"
                checked={settings.soundDesign !== false}
                onChange={(e) => handleSettingChange('soundDesign', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.soundDesign !== false ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Generate atmospheric sounds that match the visuals</p>
        </div>
      </>
    );
  }
} 
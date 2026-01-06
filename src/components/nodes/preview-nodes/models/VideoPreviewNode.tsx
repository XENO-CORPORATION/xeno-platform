import React, { useState, useRef, CSSProperties } from 'react';
import { BasePreviewNode } from '../BasePreviewNode';
import { PreviewSettings, PreviewResponse } from '../PreviewNodeInterface';

export class VideoPreviewNode extends BasePreviewNode {
  name = 'Video Preview';
  description = 'Preview videos with playback controls and frame analysis';
  previewType = 'video';
  
  // Capability flags
  supportsZoom = true;
  supportsPanning = false;
  supportsAnnotation = false;
  supportsExport = true;
  
  defaultSettings: PreviewSettings = {
    autoRefresh: false,
    refreshInterval: 5,
    displayMode: 'fit',
    showMetadata: true,
    showControls: true,
    theme: 'dark',
    volume: 50,
    playbackSpeed: 1,
    autoPlay: false,
    loop: false,
    showTimeline: true,
    qualityLevel: 'auto',
    thumbnailInterval: 5,
  };
  
  async generatePreview(
    contentUrl: string,
    settings: PreviewSettings
  ): Promise<PreviewResponse> {
    try {
      // In a real implementation, this might process the video, generate thumbnails, etc.
      // For this example, we'll just return the original URL
      return {
        success: true,
        previewUrl: contentUrl,
        metadata: {
          width: 1920, // These would be actual values in a real implementation
          height: 1080,
          format: 'mp4',
          duration: 120,
          fileSize: 25600000,
          frameRate: 30,
          codec: 'h264'
        }
      };
    } catch (error) {
      console.error('Failed to generate video preview:', error);
      return {
        success: false,
        error: 'Failed to generate video preview'
      };
    }
  }

  async exportContent(format: string): Promise<string> {
    // In a real implementation, this would convert/export the video
    console.log(`Exporting video as ${format}`);
    return 'exported-video-url.mp4';
  }

  renderPreview(
    contentUrl: string | null,
    settings: PreviewSettings,
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolume] = useState(settings.volume || 50);
    const [playbackSpeed, setPlaybackSpeed] = useState(settings.playbackSpeed || 1);
    
    if (!contentUrl) {
      return (
        <div className="flex items-center justify-center h-64 bg-black/20 rounded-lg">
          <p className="text-white/50 text-sm">No video to preview</p>
        </div>
      );
    }

    // Helper to format time in MM:SS
    const formatTime = (timeInSeconds: number) => {
      const minutes = Math.floor(timeInSeconds / 60);
      const seconds = Math.floor(timeInSeconds % 60);
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    // Video event handlers
    const handleTimeUpdate = () => {
      if (videoRef.current) {
        setCurrentTime(videoRef.current.currentTime);
      }
    };

    const handleLoadedMetadata = () => {
      if (videoRef.current) {
        setDuration(videoRef.current.duration);
        // Set volume based on settings
        videoRef.current.volume = volume / 100;
        // Set playback speed
        videoRef.current.playbackRate = playbackSpeed;
        // Autoplay if enabled
        if (settings.autoPlay) {
          videoRef.current.play().catch(e => console.error('Autoplay failed:', e));
          setIsPlaying(true);
        }
      }
    };

    const handlePlay = () => {
      if (videoRef.current) {
        videoRef.current.play();
        setIsPlaying(true);
      }
    };
    
    const handlePause = () => {
      if (videoRef.current) {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVolume = parseInt(e.target.value);
      setVolume(newVolume);
      if (videoRef.current) {
        videoRef.current.volume = newVolume / 100;
      }
      handleSettingChange('volume', newVolume);
    };

    const handlePlaybackSpeedChange = (speed: number) => {
      setPlaybackSpeed(speed);
      if (videoRef.current) {
        videoRef.current.playbackRate = speed;
      }
      handleSettingChange('playbackSpeed', speed);
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
      const seekTime = parseFloat(e.target.value);
      if (videoRef.current) {
        videoRef.current.currentTime = seekTime;
        setCurrentTime(seekTime);
      }
    };

    // Calculate video style based on display mode
    let videoStyle: CSSProperties;
    switch (settings.displayMode) {
      case 'fill':
        videoStyle = { objectFit: 'cover' as const, width: '100%', height: '100%' };
        break;
      case 'actual':
        videoStyle = { objectFit: 'none' as const };
        break;
      case 'fit':
      default:
        videoStyle = { objectFit: 'contain' as const, width: '100%', height: '100%' };
        break;
    }

    return (
      <div className="flex flex-col space-y-4">
        <div
          className={`relative rounded-lg overflow-hidden ${
            settings.theme === 'light' ? 'bg-gray-100' : 'bg-black/30'
          }`}
          style={{ height: '300px' }}
        >
          {/* Video Player */}
          <video
            ref={videoRef}
            src={contentUrl}
            className="w-full h-full"
            style={videoStyle}
            playsInline
            loop={settings.loop}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />

          {/* Video Controls Overlay */}
          {settings.showControls && (
            <div className="absolute bottom-0 left-0 right-0 bg-black/50 p-2 transition-opacity">
              {/* Timeline */}
              {settings.showTimeline && (
                <div className="mb-2 px-2">
                  <div className="flex justify-between text-xs text-white/70 mb-1">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={duration || 100}
                    value={currentTime}
                    onChange={handleSeek}
                    className="w-full h-1 bg-white/20 appearance-none rounded cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, white ${(currentTime / duration) * 100}%, rgba(255,255,255,0.2) 0%)`,
                    }}
                  />
                </div>
              )}

              {/* Control Buttons */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {/* Play/Pause Button */}
                  <button
                    onClick={isPlaying ? handlePause : handlePlay}
                    className="p-2 rounded-full hover:bg-white/10 text-white/90 transition-colors"
                  >
                    {isPlaying ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="6" y="4" width="4" height="16"></rect>
                        <rect x="14" y="4" width="4" height="16"></rect>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                    )}
                  </button>

                  {/* Volume Control */}
                  <div className="flex items-center space-x-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                      {volume > 0 && (
                        <>
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                          {volume > 50 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>}
                        </>
                      )}
                    </svg>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={volume}
                      onChange={handleVolumeChange}
                      className="w-16 h-1 bg-white/20 appearance-none rounded cursor-pointer"
                    />
                  </div>
                </div>

                {/* Right Side Controls */}
                <div className="flex items-center space-x-2">
                  {/* Playback Speed */}
                  <div className="relative">
                    <button
                      className="px-2 py-1 rounded hover:bg-white/10 text-white/90 text-xs transition-colors"
                    >
                      {playbackSpeed}x
                    </button>
                    <div className="absolute bottom-full right-0 mb-1 bg-black/80 rounded-lg p-1 hidden group-hover:block">
                      {[0.5, 1, 1.25, 1.5, 2].map(speed => (
                        <button
                          key={speed}
                          onClick={() => handlePlaybackSpeedChange(speed)}
                          className={`block w-full px-3 py-1 text-xs rounded ${
                            playbackSpeed === speed ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10'
                          }`}
                        >
                          {speed}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Fullscreen Button */}
                  <button
                    onClick={() => videoRef.current?.requestFullscreen()}
                    className="p-2 rounded-full hover:bg-white/10 text-white/90 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Video Info and Metadata */}
        {settings.showMetadata && this.renderMetadata({
          'Duration': formatTime(duration),
          'Current Time': formatTime(currentTime),
          'Resolution': '1920 x 1080',
          'Format': 'MP4',
          'Frame Rate': '30fps',
          'Playback Speed': `${playbackSpeed}x`
        })}
      </div>
    );
  }

  renderPreviewSpecificSettings(
    settings: PreviewSettings,
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* Auto Play Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Auto Play</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="autoPlay"
                checked={settings.autoPlay === true}
                onChange={(e) => handleSettingChange('autoPlay', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.autoPlay === true ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Automatically start playback when loaded</p>
        </div>

        {/* Loop Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Loop Video</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="loop"
                checked={settings.loop === true}
                onChange={(e) => handleSettingChange('loop', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.loop === true ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Repeat playback when video ends</p>
        </div>

        {/* Show Timeline Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Show Timeline</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="showTimeline"
                checked={settings.showTimeline !== false}
                onChange={(e) => handleSettingChange('showTimeline', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.showTimeline !== false ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Display timeline progress bar</p>
        </div>

        {/* Playback Speed */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Playback Speed</label>
          <div className="grid grid-cols-5 gap-2">
            {[0.5, 0.75, 1, 1.5, 2].map((speed) => (
              <button
                key={speed}
                onClick={() => handleSettingChange('playbackSpeed', speed)}
                className={`p-2 text-xs rounded-lg border transition-colors ${
                  settings.playbackSpeed === speed
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Control video playback speed</p>
        </div>

        {/* Quality Level */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Quality Level</label>
          <select
            value={settings.qualityLevel || 'auto'}
            onChange={(e) => handleSettingChange('qualityLevel', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="auto">Auto</option>
            <option value="low">Low (480p)</option>
            <option value="medium">Medium (720p)</option>
            <option value="high">High (1080p)</option>
            <option value="4k">Ultra HD (4K)</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Set video playback quality</p>
        </div>

        {/* Thumbnail Interval */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Thumbnail Interval</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.thumbnailInterval || 5}s
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="30"
            step="1"
            value={settings.thumbnailInterval || 5}
            onChange={(e) => handleSettingChange('thumbnailInterval', parseInt(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Time between thumbnails in seconds</p>
        </div>
      </>
    );
  }
} 
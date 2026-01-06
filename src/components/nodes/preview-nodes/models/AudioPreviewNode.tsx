import React, { useState, useRef, useEffect, CSSProperties } from 'react';
import { BasePreviewNode } from '../BasePreviewNode';
import { PreviewSettings, PreviewResponse } from '../PreviewNodeInterface';

export class AudioPreviewNode extends BasePreviewNode {
  name = 'Audio Preview';
  description = 'Preview audio with waveform visualization and playback controls';
  previewType = 'audio';
  
  // Capability flags
  supportsZoom = true;
  supportsPanning = true;
  supportsAnnotation = false;
  supportsExport = true;
  
  defaultSettings: PreviewSettings = {
    autoRefresh: false,
    refreshInterval: 5,
    displayMode: 'fit',
    showMetadata: true,
    showControls: true,
    theme: 'dark',
    volume: 70,
    playbackSpeed: 1,
    autoPlay: false,
    loop: false,
    showWaveform: true,
    showSpectrum: false,
    waveformColor: '#4287f5',
    timeDisplayFormat: 'standard',
    visualizerHeight: 100,
    visualizerMode: 'waveform',
  };
  
  private zoomLevel = 1;
  
  async generatePreview(
    contentUrl: string,
    settings: PreviewSettings
  ): Promise<PreviewResponse> {
    try {
      // In a real implementation, this might process the audio for visualization
      // For this example, we'll just return the original URL
      return {
        success: true,
        previewUrl: contentUrl,
        metadata: {
          format: 'mp3',
          duration: 237, // in seconds
          fileSize: 3840000,
          bitrate: 128,
          sampleRate: 44100,
          channels: 2
        }
      };
    } catch (error) {
      console.error('Failed to generate audio preview:', error);
      return {
        success: false,
        error: 'Failed to generate audio preview'
      };
    }
  }

  zoomIn(): void {
    this.zoomLevel = Math.min(5, this.zoomLevel + 0.5);
    console.log('Zoom level:', this.zoomLevel);
  }

  zoomOut(): void {
    this.zoomLevel = Math.max(0.5, this.zoomLevel - 0.5);
    console.log('Zoom level:', this.zoomLevel);
  }

  resetView(): void {
    this.zoomLevel = 1;
    console.log('View reset');
  }

  async exportContent(format: string): Promise<string> {
    // In a real implementation, this would convert/export the audio
    console.log(`Exporting audio as ${format}`);
    return 'exported-audio-url.mp3';
  }

  renderPreview(
    contentUrl: string | null,
    settings: PreviewSettings,
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    const audioRef = useRef<HTMLAudioElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolume] = useState(settings.volume || 70);
    const [playbackSpeed, setPlaybackSpeed] = useState(settings.playbackSpeed || 1);
    const [waveformData, setWaveformData] = useState<number[]>([]);
    
    // Create zoom control handlers that update the class property
    const handleZoomIn = () => {
      this.zoomIn();
      // Force a re-render through the settings change
      handleSettingChange('_forceUpdate', Date.now());
    };
    
    const handleZoomOut = () => {
      this.zoomOut();
      // Force a re-render through the settings change
      handleSettingChange('_forceUpdate', Date.now());
    };
    
    const handleResetZoom = () => {
      this.resetView();
      // Force a re-render through the settings change
      handleSettingChange('_forceUpdate', Date.now());
    };
    
    if (!contentUrl) {
      return (
        <div className="flex items-center justify-center h-64 bg-black/20 rounded-lg">
          <p className="text-white/50 text-sm">No audio to preview</p>
        </div>
      );
    }

    // Helper to format time in MM:SS
    const formatTime = (timeInSeconds: number) => {
      const minutes = Math.floor(timeInSeconds / 60);
      const seconds = Math.floor(timeInSeconds % 60);
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    // Generate dummy waveform data
    useEffect(() => {
      if (waveformData.length === 0) {
        // Generate 100 random values between 0.1 and 1.0 for the waveform
        const data = Array.from({ length: 100 }, () => 0.1 + Math.random() * 0.9);
        setWaveformData(data);
      }
    }, [waveformData]);

    // Setup canvas visualization
    useEffect(() => {
      if (canvasRef.current && settings.showWaveform && waveformData.length > 0) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
          const drawWaveform = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Draw background
            ctx.fillStyle = settings.theme === 'light' ? '#f0f0f0' : '#1a1a1a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw waveform or spectrum based on settings
            if (settings.visualizerMode === 'waveform') {
              // Draw waveform
              const barWidth = canvas.width / waveformData.length;
              const waveformColor = settings.waveformColor || '#4287f5';
              
              ctx.fillStyle = waveformColor;
              
              waveformData.forEach((value, index) => {
                const barHeight = value * canvas.height;
                const x = index * barWidth;
                const y = (canvas.height - barHeight) / 2;
                
                // Calculate progress to show played vs unplayed portion in different colors
                const progress = currentTime / duration;
                const position = index / waveformData.length;
                
                if (position <= progress) {
                  // Played portion
                  ctx.fillStyle = waveformColor;
                } else {
                  // Unplayed portion
                  ctx.fillStyle = `${waveformColor}80`; // Add transparency
                }
                
                ctx.fillRect(x, y, barWidth - 1, barHeight);
              });
            } else {
              // Draw spectrum visualization (simplified)
              const centerY = canvas.height / 2;
              const amplitude = canvas.height / 3;
              
              ctx.strokeStyle = settings.waveformColor || '#4287f5';
              ctx.lineWidth = 2;
              ctx.beginPath();
              
              // Create a sine wave as a simple spectrum visualization
              for (let x = 0; x < canvas.width; x++) {
                const frequency = 0.02; // Adjust for wave density
                const y = centerY + Math.sin(x * frequency) * amplitude * 0.5
                        + Math.sin(x * frequency * 2) * amplitude * 0.3
                        + Math.sin(x * frequency * 3) * amplitude * 0.2;
                
                if (x === 0) {
                  ctx.moveTo(x, y);
                } else {
                  ctx.lineTo(x, y);
                }
              }
              
              ctx.stroke();
              
              // Draw progress line
              const progressX = canvas.width * (currentTime / duration);
              ctx.strokeStyle = '#ff5555';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(progressX, 0);
              ctx.lineTo(progressX, canvas.height);
              ctx.stroke();
            }
          };
          
          drawWaveform();
        }
      }
    }, [canvasRef, waveformData, settings.showWaveform, settings.visualizerMode, 
        settings.theme, settings.waveformColor, currentTime, duration]);

    // Audio event handlers
    const handleTimeUpdate = () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
    };

    const handleLoadedMetadata = () => {
      if (audioRef.current) {
        setDuration(audioRef.current.duration);
        // Set volume based on settings
        audioRef.current.volume = volume / 100;
        // Set playback speed
        audioRef.current.playbackRate = playbackSpeed;
        // Autoplay if enabled
        if (settings.autoPlay) {
          audioRef.current.play().catch(e => console.error('Autoplay failed:', e));
          setIsPlaying(true);
        }
      }
    };

    const handlePlay = () => {
      if (audioRef.current) {
        audioRef.current.play();
        setIsPlaying(true);
      }
    };
    
    const handlePause = () => {
      if (audioRef.current) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVolume = parseInt(e.target.value);
      setVolume(newVolume);
      if (audioRef.current) {
        audioRef.current.volume = newVolume / 100;
      }
      handleSettingChange('volume', newVolume);
    };

    const handlePlaybackSpeedChange = (speed: number) => {
      setPlaybackSpeed(speed);
      if (audioRef.current) {
        audioRef.current.playbackRate = speed;
      }
      handleSettingChange('playbackSpeed', speed);
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
      const seekTime = parseFloat(e.target.value);
      if (audioRef.current) {
        audioRef.current.currentTime = seekTime;
        setCurrentTime(seekTime);
      }
    };

    return (
      <div className="flex flex-col space-y-4">
        {/* Audio Element (hidden) */}
        <audio
          ref={audioRef}
          src={contentUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          loop={settings.loop}
          style={{ display: 'none' }}
        />
        
        {/* Audio Visualization */}
        {settings.showWaveform && (
          <div
            className={`relative rounded-lg overflow-hidden ${
              settings.theme === 'light' ? 'bg-gray-100' : 'bg-black/30'
            }`}
          >
            <canvas
              ref={canvasRef}
              width={800}
              height={settings.visualizerHeight || 100}
              className="w-full"
            />
          </div>
        )}
        
        {/* Audio Controls */}
        <div className="bg-black/30 rounded-lg p-3">
          {/* Timeline */}
          <div className="mb-3 px-2">
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
              className="w-full h-1.5 bg-white/20 appearance-none rounded cursor-pointer"
              style={{
                background: `linear-gradient(to right, white ${(currentTime / duration) * 100}%, rgba(255,255,255,0.2) 0%)`,
              }}
            />
          </div>
          
          {/* Control Buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {/* Play/Pause Button */}
              <button
                onClick={isPlaying ? handlePause : handlePlay}
                className="p-2 rounded-full hover:bg-white/10 text-white/90 transition-colors"
              >
                {isPlaying ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="6" y="4" width="4" height="16"></rect>
                    <rect x="14" y="4" width="4" height="16"></rect>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                )}
              </button>
              
              {/* Volume Control */}
              <div className="flex items-center space-x-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
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
                  className="w-20 h-1.5 bg-white/20 appearance-none rounded cursor-pointer"
                />
              </div>
            </div>
            
            {/* Playback Speed */}
            <div className="flex items-center space-x-2">
              <span className="text-xs text-white/70">Speed:</span>
              <select
                value={playbackSpeed}
                onChange={(e) => handlePlaybackSpeedChange(parseFloat(e.target.value))}
                className="bg-black/30 text-white/80 border border-white/10 rounded-md text-xs p-1 focus:outline-none focus:ring-1 focus:ring-white/20"
              >
                <option value="0.5">0.5x</option>
                <option value="0.75">0.75x</option>
                <option value="1">1x</option>
                <option value="1.25">1.25x</option>
                <option value="1.5">1.5x</option>
                <option value="2">2x</option>
              </select>
            </div>
          </div>
        </div>
        
        {settings.showControls && this.renderControls(settings, handleSettingChange, {
          zoomIn: handleZoomIn,
          zoomOut: handleZoomOut,
          resetView: handleResetZoom
        })}
        
        {settings.showMetadata && this.renderMetadata({
          'Duration': formatTime(duration),
          'Format': 'MP3',
          'Bitrate': '128 kbps',
          'Sample Rate': '44.1 kHz',
          'Channels': 'Stereo',
          'Size': '3.7 MB'
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
            <label className="text-xs font-medium text-white/70">Loop Audio</label>
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
          <p className="mt-2 text-xs text-white/50">Repeat audio when playback ends</p>
        </div>

        {/* Show Waveform Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Show Visualization</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="showWaveform"
                checked={settings.showWaveform !== false}
                onChange={(e) => handleSettingChange('showWaveform', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.showWaveform !== false ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Display audio waveform or spectrum visualization</p>
        </div>

        {/* Visualization Mode */}
        {settings.showWaveform && (
          <div className="bg-black/20 rounded-lg p-4">
            <label className="block text-xs font-medium text-white/70 mb-2">Visualization Type</label>
            <div className="grid grid-cols-2 gap-2">
              {['waveform', 'spectrum'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleSettingChange('visualizerMode', mode)}
                  className={`p-2 text-xs rounded-lg border transition-colors ${
                    settings.visualizerMode === mode
                      ? 'bg-white/20 border-white/30 text-white'
                      : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                  }`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-white/50">Style of audio visualization</p>
          </div>
        )}

        {/* Visualizer Height */}
        {settings.showWaveform && (
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-white/70">Visualizer Height</label>
              <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                {settings.visualizerHeight || 100}px
              </span>
            </div>
            <input
              type="range"
              min="50"
              max="200"
              step="10"
              value={settings.visualizerHeight || 100}
              onChange={(e) => handleSettingChange('visualizerHeight', parseInt(e.target.value))}
              className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
            />
            <p className="mt-2 text-xs text-white/50">Height of the audio visualization</p>
          </div>
        )}

        {/* Waveform Color */}
        {settings.showWaveform && (
          <div className="bg-black/20 rounded-lg p-4">
            <label className="block text-xs font-medium text-white/70 mb-2">Waveform Color</label>
            <div className="grid grid-cols-5 gap-2">
              {['#4287f5', '#f54263', '#42f563', '#f5d142', '#9e42f5'].map((color) => (
                <button
                  key={color}
                  onClick={() => handleSettingChange('waveformColor', color)}
                  className={`w-full h-8 rounded-lg transition-opacity hover:opacity-80 ${
                    settings.waveformColor === color ? 'ring-2 ring-white' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-white/50">Color of the audio visualization</p>
          </div>
        )}

        {/* Time Display Format */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Time Display Format</label>
          <select
            value={settings.timeDisplayFormat || 'standard'}
            onChange={(e) => handleSettingChange('timeDisplayFormat', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="standard">Standard (MM:SS)</option>
            <option value="seconds">Seconds</option>
            <option value="timestamp">Timestamp (HH:MM:SS)</option>
            <option value="percentage">Percentage</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Format of the time display</p>
        </div>

        {/* Default Volume */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Default Volume</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.volume || 70}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={settings.volume || 70}
            onChange={(e) => handleSettingChange('volume', parseInt(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Initial playback volume</p>
        </div>
      </>
    );
  }
} 
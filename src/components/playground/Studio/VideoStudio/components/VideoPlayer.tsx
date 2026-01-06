// Video player component for VideoStudio

import React from 'react';
import { useVideoPlayer } from '../hooks/useVideoPlayer';
import { VideoFile } from '../core/types';
import { formatDuration } from '../core/utils';

interface VideoPlayerProps {
  videoFile?: VideoFile;
  className?: string;
  onTimeUpdate?: (currentTime: number) => void;
  onDurationChange?: (duration: number) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoFile,
  className = '',
  onTimeUpdate,
  onDurationChange
}) => {
  const { videoRef, state, actions } = useVideoPlayer();

  React.useEffect(() => {
    if (videoFile) {
      actions.loadVideo(videoFile);
    }
  }, [videoFile, actions]);

  React.useEffect(() => {
    if (onTimeUpdate) {
      onTimeUpdate(state.currentTime);
    }
  }, [state.currentTime, onTimeUpdate]);

  React.useEffect(() => {
    if (onDurationChange && state.duration > 0) {
      onDurationChange(state.duration);
    }
  }, [state.duration, onDurationChange]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * state.duration;
    actions.seekTo(newTime);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseFloat(e.target.value);
    actions.setVolume(volume);
  };

  if (state.error) {
    return (
      <div className={`video-player error ${className}`}>
        <div className="error-message">
          <p>Error loading video: {state.error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`video-player ${className}`}>
      <video
        ref={videoRef}
        className="video-element"
        onClick={actions.togglePlay}
      />
      
      {state.isLoading && (
        <div className="loading-overlay">
          <div className="loading-spinner">Loading...</div>
        </div>
      )}
      
      <div className="video-controls">
        {/* Play/Pause Button */}
        <button
          className="control-button play-pause"
          onClick={actions.togglePlay}
          disabled={!videoFile || state.isLoading}
        >
          {state.isPlaying ? '⏸️' : '▶️'}
        </button>
        
        {/* Skip Backward */}
        <button
          className="control-button skip"
          onClick={() => actions.skipBackward(10)}
          disabled={!videoFile || state.isLoading}
        >
          ⏪
        </button>
        
        {/* Skip Forward */}
        <button
          className="control-button skip"
          onClick={() => actions.skipForward(10)}
          disabled={!videoFile || state.isLoading}
        >
          ⏩
        </button>
        
        {/* Time Display */}
        <div className="time-display">
          <span>{formatDuration(state.currentTime)}</span>
          <span>/</span>
          <span>{formatDuration(state.duration)}</span>
        </div>
        
        {/* Progress Bar */}
        <div className="progress-container" onClick={handleSeek}>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ 
                width: state.duration > 0 ? `${(state.currentTime / state.duration) * 100}%` : '0%' 
              }}
            />
          </div>
        </div>
        
        {/* Volume Control */}
        <div className="volume-control">
          <button
            className="control-button volume"
            onClick={actions.toggleMute}
          >
            {state.isMuted || state.volume === 0 ? '🔇' : state.volume < 0.5 ? '🔉' : '🔊'}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={state.isMuted ? 0 : state.volume}
            onChange={handleVolumeChange}
            className="volume-slider appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:w-3
                     [&::-webkit-slider-thumb]:h-3
                     [&::-webkit-slider-thumb]:rounded-sm
                     [&::-webkit-slider-thumb]:bg-white
                     [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-webkit-slider-thumb]:border
                     [&::-webkit-slider-thumb]:border-white/20
                     [&::-webkit-slider-thumb]:shadow-lg
                     [&::-moz-range-thumb]:w-3
                     [&::-moz-range-thumb]:h-3
                     [&::-moz-range-thumb]:rounded-sm
                     [&::-moz-range-thumb]:bg-white
                     [&::-moz-range-thumb]:cursor-pointer
                     [&::-moz-range-thumb]:border-0
                     [&::-moz-range-thumb]:shadow-lg"
          />
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
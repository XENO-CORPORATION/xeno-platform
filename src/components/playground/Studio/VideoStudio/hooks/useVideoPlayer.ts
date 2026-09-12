// Custom hook for video player functionality

import { useState, useRef, useCallback, useEffect } from 'react';
import { VideoFile } from '../core/types';

export interface VideoPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isLoading: boolean;
  error: string | null;
}

export const useVideoPlayer = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<VideoPlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    isLoading: false,
    error: null
  });

  const updateState = useCallback((updates: Partial<VideoPlayerState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const loadVideo = useCallback(async (videoFile: VideoFile) => {
    if (!videoRef.current) return;

    updateState({ isLoading: true, error: null });

    try {
      videoRef.current.src = videoFile.url;
      await new Promise((resolve, reject) => {
        if (!videoRef.current) return reject(new Error('Video element not found'));
        
        videoRef.current.onloadedmetadata = resolve;
        videoRef.current.onerror = () => reject(new Error('Failed to load video'));
      });

      updateState({
        duration: videoRef.current.duration,
        isLoading: false
      });
    } catch (error) {
      updateState({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false
      });
    }
  }, [updateState]);

  const play = useCallback(() => {
    if (!videoRef.current) return;
    
    videoRef.current.play().then(() => {
      updateState({ isPlaying: true });
    }).catch((error) => {
      updateState({ error: error.message });
    });
  }, [updateState]);

  const pause = useCallback(() => {
    if (!videoRef.current) return;
    
    videoRef.current.pause();
    updateState({ isPlaying: false });
  }, [updateState]);

  const togglePlay = useCallback(() => {
    if (state.isPlaying) {
      pause();
    } else {
      play();
    }
  }, [state.isPlaying, play, pause]);

  const seekTo = useCallback((time: number) => {
    if (!videoRef.current) return;
    
    videoRef.current.currentTime = Math.max(0, Math.min(time, state.duration));
    updateState({ currentTime: videoRef.current.currentTime });
  }, [state.duration, updateState]);

  const setVolume = useCallback((volume: number) => {
    if (!videoRef.current) return;
    
    const clampedVolume = Math.max(0, Math.min(1, volume));
    videoRef.current.volume = clampedVolume;
    updateState({ volume: clampedVolume, isMuted: clampedVolume === 0 });
  }, [updateState]);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    
    const newMutedState = !state.isMuted;
    videoRef.current.muted = newMutedState;
    updateState({ isMuted: newMutedState });
  }, [state.isMuted, updateState]);

  const skipForward = useCallback((seconds: number = 10) => {
    seekTo(state.currentTime + seconds);
  }, [state.currentTime, seekTo]);

  const skipBackward = useCallback((seconds: number = 10) => {
    seekTo(state.currentTime - seconds);
  }, [state.currentTime, seekTo]);

  // Set up event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      updateState({ currentTime: video.currentTime });
    };

    const handleEnded = () => {
      updateState({ isPlaying: false, currentTime: 0 });
    };

    const handleVolumeChange = () => {
      updateState({ 
        volume: video.volume,
        isMuted: video.muted 
      });
    };

    const handleLoadStart = () => {
      updateState({ isLoading: true });
    };

    const handleCanPlay = () => {
      updateState({ isLoading: false });
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('volumechange', handleVolumeChange);
    video.addEventListener('loadstart', handleLoadStart);
    video.addEventListener('canplay', handleCanPlay);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('volumechange', handleVolumeChange);
      video.removeEventListener('loadstart', handleLoadStart);
      video.removeEventListener('canplay', handleCanPlay);
    };
  }, [updateState]);

  return {
    videoRef,
    state,
    actions: {
      loadVideo,
      play,
      pause,
      togglePlay,
      seekTo,
      setVolume,
      toggleMute,
      skipForward,
      skipBackward
    }
  };
};

export type UseVideoPlayerReturn = ReturnType<typeof useVideoPlayer>;

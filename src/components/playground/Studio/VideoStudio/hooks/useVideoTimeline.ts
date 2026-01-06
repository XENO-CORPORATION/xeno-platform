// Custom hook for video timeline functionality

import { useState, useCallback, useRef } from 'react';
import { VideoTimeline, VideoTrack, VideoClip, VideoEditOperation } from '../core/types';
import { generateId } from '../core/utils';

export interface TimelineState {
  timeline: VideoTimeline;
  selectedClip: string | null;
  selectedTrack: string | null;
  isPlaying: boolean;
  zoom: number;
  scrollPosition: number;
}

export const useVideoTimeline = () => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<TimelineState>({
    timeline: {
      tracks: [],
      duration: 0,
      currentTime: 0
    },
    selectedClip: null,
    selectedTrack: null,
    isPlaying: false,
    zoom: 1,
    scrollPosition: 0
  });

  const updateState = useCallback((updates: Partial<TimelineState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const updateTimeline = useCallback((updates: Partial<VideoTimeline>) => {
    setState(prev => ({
      ...prev,
      timeline: { ...prev.timeline, ...updates }
    }));
  }, []);

  const addTrack = useCallback((type: 'video' | 'audio' | 'text') => {
    const newTrack: VideoTrack = {
      id: generateId(),
      type,
      clips: [],
      muted: false,
      volume: 1
    };

    setState(prev => ({
      ...prev,
      timeline: {
        ...prev.timeline,
        tracks: [...prev.timeline.tracks, newTrack]
      }
    }));

    return newTrack.id;
  }, []);

  const removeTrack = useCallback((trackId: string) => {
    setState(prev => ({
      ...prev,
      timeline: {
        ...prev.timeline,
        tracks: prev.timeline.tracks.filter(track => track.id !== trackId)
      },
      selectedTrack: prev.selectedTrack === trackId ? null : prev.selectedTrack
    }));
  }, []);

  const addClip = useCallback((trackId: string, videoId: string, startTime: number, endTime: number, trackStartTime: number) => {
    const newClip: VideoClip = {
      id: generateId(),
      videoId,
      startTime,
      endTime,
      trackStartTime,
      effects: []
    };

    setState(prev => ({
      ...prev,
      timeline: {
        ...prev.timeline,
        tracks: prev.timeline.tracks.map(track => 
          track.id === trackId 
            ? { ...track, clips: [...track.clips, newClip] }
            : track
        ),
        duration: Math.max(prev.timeline.duration, trackStartTime + (endTime - startTime))
      }
    }));

    return newClip.id;
  }, []);

  const removeClip = useCallback((trackId: string, clipId: string) => {
    setState(prev => ({
      ...prev,
      timeline: {
        ...prev.timeline,
        tracks: prev.timeline.tracks.map(track => 
          track.id === trackId 
            ? { ...track, clips: track.clips.filter(clip => clip.id !== clipId) }
            : track
        )
      },
      selectedClip: prev.selectedClip === clipId ? null : prev.selectedClip
    }));
  }, []);

  const moveClip = useCallback((trackId: string, clipId: string, newTrackStartTime: number) => {
    setState(prev => ({
      ...prev,
      timeline: {
        ...prev.timeline,
        tracks: prev.timeline.tracks.map(track => 
          track.id === trackId 
            ? {
                ...track,
                clips: track.clips.map(clip => 
                  clip.id === clipId 
                    ? { ...clip, trackStartTime: newTrackStartTime }
                    : clip
                )
              }
            : track
        )
      }
    }));
  }, []);

  const trimClip = useCallback((trackId: string, clipId: string, newStartTime: number, newEndTime: number) => {
    setState(prev => ({
      ...prev,
      timeline: {
        ...prev.timeline,
        tracks: prev.timeline.tracks.map(track => 
          track.id === trackId 
            ? {
                ...track,
                clips: track.clips.map(clip => 
                  clip.id === clipId 
                    ? { ...clip, startTime: newStartTime, endTime: newEndTime }
                    : clip
                )
              }
            : track
        )
      }
    }));
  }, []);

  const addEffectToClip = useCallback((trackId: string, clipId: string, effect: VideoEditOperation) => {
    setState(prev => ({
      ...prev,
      timeline: {
        ...prev.timeline,
        tracks: prev.timeline.tracks.map(track => 
          track.id === trackId 
            ? {
                ...track,
                clips: track.clips.map(clip => 
                  clip.id === clipId 
                    ? { ...clip, effects: [...clip.effects, effect] }
                    : clip
                )
              }
            : track
        )
      }
    }));
  }, []);

  const removeEffectFromClip = useCallback((trackId: string, clipId: string, effectId: string) => {
    setState(prev => ({
      ...prev,
      timeline: {
        ...prev.timeline,
        tracks: prev.timeline.tracks.map(track => 
          track.id === trackId 
            ? {
                ...track,
                clips: track.clips.map(clip => 
                  clip.id === clipId 
                    ? { ...clip, effects: clip.effects.filter(effect => effect.id !== effectId) }
                    : clip
                )
              }
            : track
        )
      }
    }));
  }, []);

  const setCurrentTime = useCallback((time: number) => {
    updateTimeline({ currentTime: Math.max(0, Math.min(time, state.timeline.duration)) });
  }, [state.timeline.duration, updateTimeline]);

  const setDuration = useCallback((duration: number) => {
    updateTimeline({ duration: Math.max(0, duration) });
  }, [updateTimeline]);

  const setZoom = useCallback((zoom: number) => {
    updateState({ zoom: Math.max(0.1, Math.min(5, zoom)) });
  }, [updateState]);

  const setScrollPosition = useCallback((position: number) => {
    updateState({ scrollPosition: Math.max(0, position) });
  }, [updateState]);

  const selectClip = useCallback((clipId: string | null) => {
    updateState({ selectedClip: clipId });
  }, [updateState]);

  const selectTrack = useCallback((trackId: string | null) => {
    updateState({ selectedTrack: trackId });
  }, [updateState]);

  const toggleTrackMute = useCallback((trackId: string) => {
    setState(prev => ({
      ...prev,
      timeline: {
        ...prev.timeline,
        tracks: prev.timeline.tracks.map(track => 
          track.id === trackId 
            ? { ...track, muted: !track.muted }
            : track
        )
      }
    }));
  }, []);

  const setTrackVolume = useCallback((trackId: string, volume: number) => {
    setState(prev => ({
      ...prev,
      timeline: {
        ...prev.timeline,
        tracks: prev.timeline.tracks.map(track => 
          track.id === trackId 
            ? { ...track, volume: Math.max(0, Math.min(1, volume)) }
            : track
        )
      }
    }));
  }, []);

  const clearTimeline = useCallback(() => {
    setState(prev => ({
      ...prev,
      timeline: {
        tracks: [],
        duration: 0,
        currentTime: 0
      },
      selectedClip: null,
      selectedTrack: null
    }));
  }, []);

  return {
    timelineRef,
    state,
    actions: {
      addTrack,
      removeTrack,
      addClip,
      removeClip,
      moveClip,
      trimClip,
      addEffectToClip,
      removeEffectFromClip,
      setCurrentTime,
      setDuration,
      setZoom,
      setScrollPosition,
      selectClip,
      selectTrack,
      toggleTrackMute,
      setTrackVolume,
      clearTimeline
    }
  };
};
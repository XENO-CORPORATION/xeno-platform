// Video timeline component for VideoStudio

import React from 'react';
import { useVideoTimeline } from '../hooks/useVideoTimeline';
import { VideoFile, VideoTrack } from '../core/types';
import { formatDuration } from '../core/utils';

interface VideoTimelineProps {
  videos: VideoFile[];
  currentTime: number;
  onTimeChange: (time: number) => void;
  className?: string;
  onStateChange?: (snapshot: { tracks: VideoTrack[]; currentTime: number; duration: number }) => void;
  projectDuration?: number;
  onClipSelect?: (clipId: string | null, clipName?: string) => void;
}

export const VideoTimeline: React.FC<VideoTimelineProps> = ({
  videos,
  currentTime,
  onTimeChange,
  className = '',
  onStateChange,
  projectDuration,
  onClipSelect
}) => {
  const { timelineRef, state, actions } = useVideoTimeline();
  const draggingPlayheadRef = React.useRef(false);
  const draggingClipRef = React.useRef<{
    trackId: string;
    clipId: string;
    mode: 'move' | 'trim-start' | 'trim-end';
    startX: number;
    initialTime: number;
  } | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const leftPaneRef = React.useRef<HTMLDivElement>(null);
  const rightPaneRef = React.useRef<HTMLDivElement>(null);

  // Ensure default tracks (Video, Audio) exist for a logical starting state
  React.useEffect(() => {
    if (state.timeline.tracks.length === 0) {
      actions.addTrack('video');
      actions.addTrack('audio');
    }
  }, [state.timeline.tracks.length, actions]);

  React.useEffect(() => {
    actions.setCurrentTime(currentTime);
  }, [currentTime, actions]);

  // Apply externally provided project duration when available
  React.useEffect(() => {
    if (typeof projectDuration === 'number' && projectDuration > 0) {
      // Only update if it differs to avoid loops
      if ((state.timeline.duration || 0) !== projectDuration) {
        actions.setDuration(projectDuration);
      }
    }
  }, [projectDuration, actions, state.timeline.duration]);

  // When asset durations update, reconcile clip lengths for clips starting at 0
  React.useEffect(() => {
    if (!videos || videos.length === 0) return;
    const idToDur = new Map(videos.map(v => [v.id, v.duration || 0] as const));
    state.timeline.tracks.forEach(track => {
      track.clips.forEach(clip => {
        const mediaDur = idToDur.get(clip.videoId) || 0;
        const clipDur = Math.max(0, clip.endTime - clip.startTime);
        if (clip.startTime === 0 && mediaDur > 0 && Math.abs(mediaDur - clipDur) > 0.25) {
          actions.trimClip(track.id, clip.id, 0, mediaDur);
        }
      });
    });
  }, [videos, state.timeline.tracks, actions]);

  // Auto-insert the canvas-opened video into the first video track if no video clips exist yet
  React.useEffect(() => {
    if (state.timeline.tracks.length === 0) return;
    const videoTracks = state.timeline.tracks.filter(t => t.type === 'video');
    if (videoTracks.length === 0) return;
    const hasVideoClip = videoTracks.some(t => t.clips.length > 0);
    if (hasVideoClip) return;
    const canvasAsset = videos.find(a => a.id === 'canvas-video' && !(a.format || '').startsWith('audio'));
    if (!canvasAsset) return;
    const targetTrackId = videoTracks[0]?.id || actions.addTrack('video');
    const duration = Math.max(0.1, canvasAsset.duration || 3);
    actions.addClip(targetTrackId, canvasAsset.id, 0, duration, 0);
  }, [videos, state.timeline.tracks, actions]);

  // Notify parent of state updates so preview can reflect timeline
  React.useEffect(() => {
    onStateChange?.({
      tracks: state.timeline.tracks as unknown as VideoTrack[],
      currentTime: state.timeline.currentTime,
      duration: state.timeline.duration
    });
  }, [onStateChange, state.timeline.tracks, state.timeline.currentTime, state.timeline.duration]);

  // No auto-initialize. Clips are added by drag-and-drop from assets.

  const getPixelsPerSecond = () => 80 * state.zoom; // 80px per second at zoom 1
  const getContentWidthPx = () => (state.timeline.duration || 0) * getPixelsPerSecond();

  const pxToTime = (clientX: number) => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const scrollLeft = rightPaneRef.current ? rightPaneRef.current.scrollLeft : 0;
    const x = Math.max(0, clientX - rect.left + scrollLeft);
    const time = x / getPixelsPerSecond();
    return Math.max(0, Math.min(time, Math.max(state.timeline.duration, 0)));
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    const newTime = pxToTime(e.clientX);
    actions.setCurrentTime(newTime);
    onTimeChange(newTime);
  };

  // Accept drops from asset library to add clips
  const handleDropOnTrack = (e: React.DragEvent<HTMLDivElement>, trackId: string) => {
    e.preventDefault();
    // Support both our custom type and a fallback JSON in plain text
    let payloadText = e.dataTransfer.getData('application/x-xeno-asset');
    if (!payloadText) payloadText = e.dataTransfer.getData('text/plain');
    if (!payloadText) return;
    let payload: any = null;
    try { payload = JSON.parse(payloadText); } catch { return; }
    const asset: VideoFile | undefined = videos.find(v => v.id === payload.id);
    if (!asset) return;
    // Validate asset type vs. track type
    const track = state.timeline.tracks.find(t => t.id === trackId);
    const isAudio = (asset.format || '').startsWith('audio');
    const isImage = (asset.format || '').startsWith('image');
    if (track) {
      if (track.type === 'audio' && !isAudio) {
        return; // only audio on audio tracks
      }
      if (track.type === 'video' && isAudio) {
        return; // audio should go on audio tracks
      }
    }
    const dropTime = pxToTime(e.clientX);
    // Default durations: audio/video use metadata duration; images default to 3s
    const duration = Math.max(0.1, isImage ? 3 : (asset.duration || 0));
    actions.addClip(trackId, asset.id, 0, duration, Math.max(0, dropTime));
  };

  // Playhead drag
  React.useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!draggingPlayheadRef.current) return;
      const t = pxToTime(e.clientX);
      actions.setCurrentTime(t);
      onTimeChange(t);
    };
    const handleUp = () => {
      draggingPlayheadRef.current = false;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [actions, onTimeChange]);

  const handleAddVideoTrack = () => {
    const trackId = actions.addTrack('video');
    actions.selectTrack(trackId);
  };

  const handleAddAudioTrack = () => {
    const trackId = actions.addTrack('audio');
    actions.selectTrack(trackId);
  };

  const handleZoomIn = () => {
    actions.setZoom(state.zoom * 1.2);
  };

  const handleZoomOut = () => {
    actions.setZoom(state.zoom / 1.2);
  };

  const handleClipClick = (clipId: string, clipName: string | undefined, e: React.MouseEvent) => {
    e.stopPropagation();
    actions.selectClip(clipId);
    if (onClipSelect) {
      onClipSelect(clipId, clipName);
    }
  };

  const handleTrackClick = (trackId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    actions.selectTrack(trackId);
    // Deselect clip when clicking empty track area
    if (onClipSelect) {
      onClipSelect(null);
    }
  };

  const getClipStyle = (clip: any) => {
    const duration = clip.endTime - clip.startTime;
    const left = (clip.trackStartTime / state.timeline.duration) * 100;
    const width = (duration / state.timeline.duration) * 100;
    
    return {
      left: `${left}%`,
      width: `${width}%`
    };
  };

  // Dynamic time ruler ticks based on duration and zoom
  const computeTicks = React.useCallback(() => {
    const duration = Math.max(1, state.timeline.duration || 1);
    const pps = getPixelsPerSecond();
    const desiredPxBetweenTicks = 120;
    const stepSec = Math.max(1, Math.round(desiredPxBetweenTicks / pps));
    const ticks: Array<{ time: number; label: string } > = [];
    for (let t = 0; t <= duration + 0.0001; t += stepSec) {
      ticks.push({ time: t, label: formatDuration(t) });
    }
    return ticks;
  }, [state.timeline.duration, state.zoom]);
  const ticks = computeTicks();

  const onClipDragStart = (
    e: React.MouseEvent,
    trackId: string,
    clipId: string,
    mode: 'move' | 'trim-start' | 'trim-end'
  ) => {
    e.stopPropagation();
    draggingClipRef.current = {
      trackId,
      clipId,
      mode,
      startX: e.clientX,
      initialTime: state.timeline.currentTime
    };
    document.body.style.userSelect = 'none';
  };

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = draggingClipRef.current;
      if (!drag || !timelineRef.current) return;
      const t = pxToTime(e.clientX);
      const track = state.timeline.tracks.find(tr => tr.id === drag.trackId);
      const clip = track?.clips.find(c => c.id === drag.clipId);
      if (!clip) return;
      if (drag.mode === 'move') {
        // maintain clip duration; change trackStartTime
        actions.moveClip(drag.trackId, drag.clipId, t);
      } else if (drag.mode === 'trim-start') {
        actions.trimClip(drag.trackId, drag.clipId, Math.min(t, clip.endTime - 0.1), clip.endTime);
      } else if (drag.mode === 'trim-end') {
        actions.trimClip(drag.trackId, drag.clipId, clip.startTime, Math.max(t, clip.startTime + 0.1));
      }
    };
    const onUp = () => {
      draggingClipRef.current = null;
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [actions, state.timeline.tracks]);

  return (
    <div ref={containerRef} className={`video-timeline ${className} h-full flex flex-col`}> 
      {/* Header: controls and time ruler */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <button className="timeline-button" onClick={handleAddVideoTrack} title="Add Video Track">+ Video</button>
          <button className="timeline-button" onClick={handleAddAudioTrack} title="Add Audio Track">+ Audio</button>
          <div className="ml-3 flex items-center gap-2">
            <button className="timeline-button" onClick={handleZoomOut} title="Zoom Out">−</button>
            <span className="zoom-level text-white/70 text-xs w-12 text-center">{Math.round(state.zoom * 100)}%</span>
            <button className="timeline-button" onClick={handleZoomIn} title="Zoom In">+</button>
          </div>
        </div>
        <div className="flex-1 mx-4 relative h-6 overflow-hidden">
          <div className="absolute inset-0">
            {ticks.map(t => (
              <div key={t.time} className="absolute top-0" style={{ left: `${(t.time * getPixelsPerSecond()) - (rightPaneRef.current?.scrollLeft || 0)}px` }}>
                <div className="h-3 w-px bg-white/30" />
                <div className="absolute left-1 top-2 text-[10px] text-white/60 whitespace-nowrap">{t.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="w-40 text-right text-white/60 text-xs">
          Duration: {formatDuration(state.timeline.duration || 0)}
        </div>
      </div>

      {/* Body: tracks header + content */}
      <div className="flex-1 min-h-0 flex">
        {/* Left track headers */}
        <div ref={leftPaneRef} className="w-56 border-r border-white/10 overflow-auto" onDragOver={(e) => e.preventDefault()}>
          {state.timeline.tracks.map((track) => (
            <div key={track.id} className={`h-20 px-3 py-2 border-b border-white/10 ${state.selectedTrack === track.id ? 'bg-white/5' : ''}`}
                 onClick={(e) => handleTrackClick(track.id, e)}>
              <div className="h-full flex items-center justify-between gap-2">
                <span className="text-xs text-white/80 truncate">{track.name || track.type.toUpperCase()}</span>
                <div className="flex items-center gap-1">
                  <button className={`text-[10px] px-1 rounded ${track.muted ? 'bg-red-600/60' : 'bg-white/10'} text-white/80`}
                    title="Mute" onClick={(e) => { e.stopPropagation(); actions.toggleTrackMute(track.id); }}>M</button>
                  <button className={`text-[10px] px-1 rounded ${track.solo ? 'bg-green-600/60' : 'bg-white/10'} text-white/80`}
                    title="Solo" onClick={(e) => { e.stopPropagation(); /* placeholder solo toggle handled in hook if added */ }}>
                    S
                  </button>
                  <button className={`text-[10px] px-1 rounded ${track.locked ? 'bg-yellow-600/60' : 'bg-white/10'} text-white/80`}
                    title="Lock" onClick={(e) => { e.stopPropagation(); /* lock toggle placeholder */ }}>
                    L
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-white/50 -mt-2">{track.type.toUpperCase()}</div>
            </div>
          ))}
        </div>
        {/* Right timeline content */}
        <div
          ref={rightPaneRef}
          className="flex-1 overflow-auto relative"
          onClick={handleTimelineClick}
          onScroll={(e) => {
            if (leftPaneRef.current) {
              leftPaneRef.current.scrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
            }
          }}
        >
          <div ref={timelineRef} className="relative h-full" style={{ width: `${getContentWidthPx()}px` }}>
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 10px)',
                backgroundSize: '10px 100%'
              }}
            />
            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-blue-400 cursor-col-resize"
              style={{ left: `${state.timeline.currentTime * getPixelsPerSecond()}px` }}
              onMouseDown={() => { draggingPlayheadRef.current = true; }}
            />

            {/* Tracks */}
            <div className="relative">
              {state.timeline.tracks.map((track) => (
                <div
                  key={track.id}
                  className="relative h-20 border-b border-white/10"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDropOnTrack(e, track.id)}
                >
                  {/* Clips */}
                  <div className="absolute inset-0">
                    {track.clips.map((clip) => (
                      <div
                        key={clip.id}
                        className={`absolute top-2 bottom-2 bg-blue-600/40 border border-blue-400/60 rounded-sm overflow-hidden ${state.selectedClip === clip.id ? 'ring-2 ring-blue-400' : ''}`}
                        style={{
                          left: `${clip.trackStartTime * getPixelsPerSecond()}px`,
                          width: `${(clip.endTime - clip.startTime) * getPixelsPerSecond()}px`
                        }}
                        onMouseDown={(e) => onClipDragStart(e, track.id, clip.id, 'move')}
                        onClick={(e) => {
                          const video = videos.find(v => v.id === clip.videoId);
                          handleClipClick(clip.id, video?.name, e);
                        }}
                      >
                        {/* Trim handles */}
                        <div
                          className="absolute left-0 top-0 bottom-0 w-1 bg-white/70 cursor-ew-resize"
                          onMouseDown={(e) => onClipDragStart(e, track.id, clip.id, 'trim-start')}
                        />
                        <div
                          className="absolute right-0 top-0 bottom-0 w-1 bg-white/70 cursor-ew-resize"
                          onMouseDown={(e) => onClipDragStart(e, track.id, clip.id, 'trim-end')}
                        />
                        <div className="absolute left-1 top-1 text-[10px] text-white/90 truncate right-1">
                          {videos.find(v => v.id === clip.videoId)?.name || 'Clip'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {state.timeline.tracks.length === 0 && (
                <div className="h-full flex items-center justify-center text-white/40 text-sm">
                  Add a Video or Audio track to begin
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoTimeline;
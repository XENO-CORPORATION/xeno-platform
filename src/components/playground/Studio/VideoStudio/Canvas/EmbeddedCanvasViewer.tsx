import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2 } from 'lucide-react';

interface EmbeddedCanvasViewerProps {
  videoUrl?: string | null;
  currentTime?: number;
  duration?: number;
  onTimeChange?: (time: number) => void;
}

const EmbeddedCanvasViewer: React.FC<EmbeddedCanvasViewerProps> = ({
  videoUrl,
  currentTime = 0,
  duration = 0,
  onTimeChange
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [localCurrentTime, setLocalCurrentTime] = useState(0);
  const [localDuration, setLocalDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [scale, setScale] = useState(1);

  // Render video to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      if (video.readyState >= 2) {
        // Calculate canvas size to fit video
        const containerWidth = containerRef.current?.clientWidth || 800;
        const containerHeight = containerRef.current?.clientHeight || 600;

        const videoAspect = video.videoWidth / video.videoHeight;
        const containerAspect = containerWidth / containerHeight;

        let drawWidth, drawHeight;
        if (videoAspect > containerAspect) {
          drawWidth = containerWidth * 0.9 * scale;
          drawHeight = (containerWidth * 0.9 / videoAspect) * scale;
        } else {
          drawHeight = containerHeight * 0.9 * scale;
          drawWidth = (containerHeight * 0.9 * videoAspect) * scale;
        }

        canvas.width = drawWidth;
        canvas.height = drawHeight;

        // Clear and draw
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [videoUrl, scale]);

  // Sync external currentTime with video
  useEffect(() => {
    const video = videoRef.current;
    if (video && Math.abs(video.currentTime - currentTime) > 0.5) {
      video.currentTime = currentTime;
    }
  }, [currentTime]);

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play();
      setIsPlaying(true);
    }
  };

  const handleVolumeToggle = () => {
    setIsMuted(!isMuted);
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video) {
      setLocalCurrentTime(video.currentTime);
      onTimeChange?.(video.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video) {
      setLocalDuration(video.duration);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div ref={containerRef} className="relative w-full h-full flex flex-col items-center justify-center bg-[#0a0a0b] min-h-0 overflow-hidden">
      {/* Hidden video element */}
      <video
        ref={videoRef}
        src={videoUrl || ''}
        className="hidden"
        playsInline
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
        muted={isMuted}
      />

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full object-contain"
        style={{ imageRendering: 'auto' }}
      />

      {/* Video Controls Overlay */}
      {videoUrl && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2 md:p-4">
          <div className="flex items-center gap-2 md:gap-4 flex-wrap">
            {/* Play/Pause */}
            <button
              onClick={handlePlayPause}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>

            {/* Timeline */}
            <div className="flex-1 flex items-center gap-2">
              <span className="text-white text-sm font-mono">{formatTime(localCurrentTime)}</span>
              <div className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-100"
                  style={{ width: `${(localCurrentTime / localDuration) * 100}%` }}
                />
              </div>
              <span className="text-white/60 text-sm font-mono">{formatTime(localDuration)}</span>
            </div>

            {/* Volume */}
            <button
              onClick={handleVolumeToggle}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>

            {/* Zoom Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setScale(Math.max(0.5, scale - 0.1))}
                className="px-2 py-1 text-xs bg-white/10 hover:bg-white/20 text-white rounded"
              >
                -
              </button>
              <span className="text-white text-xs font-mono w-12 text-center">
                {Math.round(scale * 100)}%
              </span>
              <button
                onClick={() => setScale(Math.min(3, scale + 0.1))}
                className="px-2 py-1 text-xs bg-white/10 hover:bg-white/20 text-white rounded"
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmbeddedCanvasViewer;

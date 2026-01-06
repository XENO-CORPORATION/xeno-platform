import React, { useState, useEffect } from 'react';
import { X, Play, Pause, Volume2, VolumeX } from 'lucide-react';

interface FullScreenVideoViewerProps {
  src: string;
  isOpen: boolean;
  onClose: () => void;
  title?: string;
}

export const FullScreenVideoViewer: React.FC<FullScreenVideoViewerProps> = ({
  src,
  isOpen,
  onClose,
  title = 'Video Viewer'
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [videoRef, setVideoRef] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  const togglePlay = () => {
    if (videoRef) {
      if (isPlaying) {
        videoRef.pause();
      } else {
        videoRef.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
    if (videoRef) {
      videoRef.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 bg-black bg-opacity-90 flex items-center justify-center">
      <div className="relative max-w-7xl max-h-full w-full h-full flex items-center justify-center p-4">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-black bg-opacity-50 text-white rounded-full hover:bg-opacity-70 transition-all"
        >
          <X size={24} />
        </button>

        {/* Video container */}
        <div className="relative max-w-full max-h-full">
          <video
            ref={setVideoRef}
            src={src}
            className="max-w-full max-h-full object-contain"
            controls={false}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />

          {/* Custom controls overlay */}
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between bg-black bg-opacity-50 rounded-lg p-3">
            <div className="flex items-center space-x-3">
              <button
                onClick={togglePlay}
                className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded transition-all"
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>
              
              <button
                onClick={toggleMute}
                className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded transition-all"
              >
                {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
            </div>

            <div className="text-white text-sm font-medium">
              {title}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FullScreenVideoViewer;
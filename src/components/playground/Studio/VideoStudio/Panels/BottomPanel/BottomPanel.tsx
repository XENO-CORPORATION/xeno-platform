import React, { useState, useRef } from 'react';
import { X, GripHorizontal, Play, Pause, SkipBack, SkipForward } from 'lucide-react';

interface BottomPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
  title: string;
  children: React.ReactNode;
  zIndex?: number;
  onBringToFront?: () => void;
  isOnTop?: boolean;
  onHeightChange?: (height: number) => void;
  isPlaying?: boolean;
  onPlayPause?: () => void;
  onSkipBackward?: () => void;
  onSkipForward?: () => void;
}

const BottomPanel: React.FC<BottomPanelProps> = ({
  isOpen,
  onClose,
  onToggle,
  title,
  children,
  zIndex = 998,
  onBringToFront,
  isOnTop = true,
  onHeightChange,
  isPlaying = false,
  onPlayPause,
  onSkipBackward,
  onSkipForward
}) => {
  const [height, setHeight] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);

  // Resize logic only
  React.useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isResizing) {
        const panelRect = resizeRef.current?.closest('.bottom-panel-container')?.getBoundingClientRect();
        if (!panelRect) return;
        
        const newHeight = Math.max(150, Math.min(500, panelRect.bottom - e.clientY));
        setHeight(newHeight);
        onHeightChange?.(newHeight);
      }
    };

    const handleGlobalMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleGlobalMouseMove, { passive: false });
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isResizing]);

  if (!isOpen) return null;

  return (
    <div 
      className="absolute bottom-panel-container bottom-4 left-4 right-4"
      style={{
        zIndex: zIndex,
        height: `${height}px`
      }}
    >
      <div 
        className={`bg-black/90 backdrop-blur-sm border border-white/20 h-full overflow-hidden shadow-2xl transition-all duration-200 flex flex-col rounded-xl ${
          isOnTop 
            ? 'border-white/40 shadow-white/10' 
            : 'border-white/20'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          if (onBringToFront) onBringToFront();
        }}
      >
        {/* Header */}
        <div 
          className="px-4 py-3 border-b border-white/10 flex items-center justify-between select-none"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-white text-sm font-medium">{title}</h3>
          </div>
          
          {/* Centered Playback Controls */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSkipBackward?.();
              }}
              className="text-white/70 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10 flex items-center justify-center"
              disabled={!onSkipBackward}
              title="Skip Backward"
            >
              <SkipBack size={18} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlayPause?.();
              }}
              className="text-white/70 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10 flex items-center justify-center"
              disabled={!onPlayPause}
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSkipForward?.();
              }}
              className="text-white/70 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10 flex items-center justify-center"
              disabled={!onSkipForward}
              title="Skip Forward"
            >
              <SkipForward size={18} />
            </button>
          </div>
          
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="text-white/70 hover:text-white transition-colors p-1 rounded hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1">
          {children}
        </div>
      </div>
      
      {/* Resize Handle */}
      <div
        ref={resizeRef}
        className="absolute top-0 left-0 right-0 h-2 cursor-row-resize bg-transparent hover:bg-blue-500/30 transition-colors rounded-t-xl"
        onMouseDown={(e) => {
          e.stopPropagation();
          setIsResizing(true);
        }}
      >
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/40">
          <GripHorizontal size={12} />
        </div>
      </div>
    </div>
  );
};

export default BottomPanel;
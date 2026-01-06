import React, { useState, useRef } from 'react';
import { X, GripVertical } from 'lucide-react';

interface RightPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
  title: string;
  children: React.ReactNode;
  zIndex?: number;
  onBringToFront?: () => void;
  isOnTop?: boolean;
  bottomPanelHeight?: number;
  isBottomPanelOpen?: boolean;
}

const RightPanel: React.FC<RightPanelProps> = ({
  isOpen,
  onClose,
  onToggle,
  title,
  children,
  zIndex = 1001,
  onBringToFront,
  isOnTop = true,
  bottomPanelHeight = 300,
  isBottomPanelOpen = false
}) => {
  const [width, setWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);

  // Resize logic only
  React.useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isResizing) {
        const panelRect = resizeRef.current?.closest('.right-panel-container')?.getBoundingClientRect();
        if (!panelRect) return;
        
        const newWidth = panelRect.right - e.clientX;
        setWidth(Math.max(200, Math.min(600, newWidth)));
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

  // Calculate bottom margin based on bottom panel state
  const bottomMargin = isBottomPanelOpen ? bottomPanelHeight + 32 : 16; // 32px = 16px panel margin + 16px gap

  return (
    <div 
      className="absolute right-panel-container right-4 top-4"
      style={{
        zIndex: zIndex,
        width: `${width}px`,
        bottom: `${bottomMargin}px`
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
        <div className="overflow-y-auto flex-1">
          {children}
        </div>
      </div>
      
      {/* Resize Handle */}
      <div
        ref={resizeRef}
        className="absolute top-0 left-0 w-2 h-full cursor-col-resize bg-transparent hover:bg-blue-500/30 transition-colors rounded-l-xl"
        onMouseDown={(e) => {
          e.stopPropagation();
          setIsResizing(true);
        }}
      >
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-white/40">
          <GripVertical size={12} />
        </div>
      </div>
    </div>
  );
};

export default RightPanel;
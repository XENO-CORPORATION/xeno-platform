import React, { useRef, useEffect } from 'react';
import { Save, RefreshCw, X } from 'lucide-react';
import { ImageAdjustments } from './types';

interface AdjustmentModalProps {
  isVisible: boolean;
  position: { x: number; y: number };
  zIndex: number;
  isDragging: boolean;
  imageAdjustments: ImageAdjustments;
  onPositionChange: (position: { x: number; y: number }) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onAdjustmentChange: (adjustments: ImageAdjustments) => void;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
  onBringToFront: () => void;
  isOnTop: boolean;
  onHover?: (isHovering: boolean) => void;
}

const AdjustmentModal: React.FC<AdjustmentModalProps> = ({
  isVisible,
  position,
  zIndex,
  isDragging,
  imageAdjustments,
  onPositionChange,
  onDragStart,
  onDragEnd,
  onAdjustmentChange,
  onSave,
  onReset,
  onClose,
  onBringToFront,
  isOnTop,
  onHover
}) => {
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Check if adjustments have been made
  const hasAdjustments = () => {
    return imageAdjustments.brightness !== 100 ||
           imageAdjustments.contrast !== 100 ||
           imageAdjustments.saturation !== 100 ||
           imageAdjustments.hue !== 0 ||
           imageAdjustments.exposure !== 0 ||
           imageAdjustments.highlights !== 0 ||
           imageAdjustments.shadows !== 0 ||
           imageAdjustments.vibrance !== 0 ||
           imageAdjustments.warmth !== 0 ||
           imageAdjustments.tint !== 0;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    onBringToFront();
    onDragStart();
    
    const panelElement = e.currentTarget.closest('[style*="left:"]') as HTMLElement;
    if (!panelElement) {
      console.log('🐛 Panel element not found in handleMouseDown');
      return;
    }
    
    const rect = panelElement.getBoundingClientRect();
    
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  // Global mouse events for dragging
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelWidth = 320;
      const panelHeight = 600;
      
      const constrainedX = Math.max(0, Math.min(newX, viewportWidth - panelWidth));
      const constrainedY = Math.max(0, Math.min(newY, viewportHeight - panelHeight));
      
      onPositionChange({ x: constrainedX, y: constrainedY });
    };

    const handleGlobalMouseUp = () => {
      onDragEnd();
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, onPositionChange, onDragEnd]);

  if (!isVisible) return null;

  return (
    <div 
      className="absolute"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: position.y === 0 ? 'translateY(50vh) translateY(-50%)' : 'none',
        zIndex: zIndex
      }}
    >
      <div 
        className={`bg-black/90 border rounded-lg w-80 max-h-[70vh] overflow-hidden shadow-2xl transition-all duration-200 ${
          isDragging ? 'cursor-grabbing' : ''
        } ${
          isOnTop 
            ? 'border-white/40' 
            : 'border-white/20'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onBringToFront();
        }}
        onMouseEnter={() => onHover?.(true)}
        onMouseLeave={() => onHover?.(false)}
      >
        {/* Header - Draggable */}
        <div 
          className={`px-4 py-3 border-b border-white/10 flex items-center justify-between ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          } select-none transition-colors duration-200 ${
            isDragging ? 'bg-white/5' : 'hover:bg-white/5'
          }`}
          onMouseDown={handleMouseDown}
          title="Drag to move panel • Double-click to reset position"
        >
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-0.5">
              <div className={`w-1 h-1 rounded-full transition-colors ${
                isDragging ? 'bg-white/80' : 'bg-white/40'
              }`}></div>
              <div className={`w-1 h-1 rounded-full transition-colors ${
                isDragging ? 'bg-white/80' : 'bg-white/40'
              }`}></div>
              <div className={`w-1 h-1 rounded-full transition-colors ${
                isDragging ? 'bg-white/80' : 'bg-white/40'
              }`}></div>
            </div>
            <h3 className="text-white text-sm font-medium">Image Adjustments</h3>
          </div>
          <div className="flex items-center gap-1">
            {/* Save Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSave();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Save adjustments"
              disabled={!hasAdjustments()}
            >
              <Save size={14} className={hasAdjustments() ? 'text-white' : 'text-white/30'} />
            </button>
            
            {/* Reset Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReset();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Reset all adjustments"
              disabled={!hasAdjustments()}
            >
              <RefreshCw size={14} className={hasAdjustments() ? 'text-white' : 'text-white/30'} />
            </button>
            
            {/* Close Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Close adjustments"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        
        {/* Adjustment Controls - Scrollable Content */}
        <div 
          className="p-4 space-y-3 overflow-y-auto max-h-[calc(70vh-80px)] scrollbar-hide" 
          style={{
            scrollbarWidth: 'none', // Firefox
            msOverflowStyle: 'none', // IE and Edge
          }}
        >
          {/* Brightness */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Brightness</label>
              <span className="text-white/50 text-xs font-mono w-10 text-right">
                {Math.round(imageAdjustments.brightness - 100)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="200"
              value={imageAdjustments.brightness}
              onChange={(e) => onAdjustmentChange({ ...imageAdjustments, brightness: parseInt(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* Contrast */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Contrast</label>
              <span className="text-white/50 text-xs font-mono w-10 text-right">
                {Math.round(imageAdjustments.contrast - 100)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="200"
              value={imageAdjustments.contrast}
              onChange={(e) => onAdjustmentChange({ ...imageAdjustments, contrast: parseInt(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* Saturation */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Saturation</label>
              <span className="text-white/50 text-xs font-mono w-10 text-right">
                {Math.round(imageAdjustments.saturation - 100)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="200"
              value={imageAdjustments.saturation}
              onChange={(e) => onAdjustmentChange({ ...imageAdjustments, saturation: parseInt(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* Hue */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Hue</label>
              <span className="text-white/50 text-xs font-mono w-10 text-right">
                {Math.round(imageAdjustments.hue)}°
              </span>
            </div>
            <input
              type="range"
              min="-180"
              max="180"
              value={imageAdjustments.hue}
              onChange={(e) => onAdjustmentChange({ ...imageAdjustments, hue: parseInt(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* Exposure */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Exposure</label>
              <span className="text-white/50 text-xs font-mono w-10 text-right">
                {imageAdjustments.exposure > 0 ? '+' : ''}{Math.round(imageAdjustments.exposure)}
              </span>
            </div>
            <input
              type="range"
              min="-100"
              max="100"
              value={imageAdjustments.exposure}
              onChange={(e) => onAdjustmentChange({ ...imageAdjustments, exposure: parseInt(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* Highlights */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Highlights</label>
              <span className="text-white/50 text-xs font-mono w-10 text-right">
                {imageAdjustments.highlights > 0 ? '+' : ''}{Math.round(imageAdjustments.highlights)}
              </span>
            </div>
            <input
              type="range"
              min="-100"
              max="100"
              value={imageAdjustments.highlights}
              onChange={(e) => onAdjustmentChange({ ...imageAdjustments, highlights: parseInt(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* Shadows */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Shadows</label>
              <span className="text-white/50 text-xs font-mono w-10 text-right">
                {imageAdjustments.shadows > 0 ? '+' : ''}{Math.round(imageAdjustments.shadows)}
              </span>
            </div>
            <input
              type="range"
              min="-100"
              max="100"
              value={imageAdjustments.shadows}
              onChange={(e) => onAdjustmentChange({ ...imageAdjustments, shadows: parseInt(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* Vibrance */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Vibrance</label>
              <span className="text-white/50 text-xs font-mono w-10 text-right">
                {imageAdjustments.vibrance > 0 ? '+' : ''}{Math.round(imageAdjustments.vibrance)}
              </span>
            </div>
            <input
              type="range"
              min="-100"
              max="100"
              value={imageAdjustments.vibrance}
              onChange={(e) => onAdjustmentChange({ ...imageAdjustments, vibrance: parseInt(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* Warmth */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Warmth</label>
              <span className="text-white/50 text-xs font-mono w-10 text-right">
                {imageAdjustments.warmth > 0 ? '+' : ''}{Math.round(imageAdjustments.warmth)}
              </span>
            </div>
            <input
              type="range"
              min="-100"
              max="100"
              value={imageAdjustments.warmth}
              onChange={(e) => onAdjustmentChange({ ...imageAdjustments, warmth: parseInt(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* Tint */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Tint</label>
              <span className="text-white/50 text-xs font-mono w-10 text-right">
                {imageAdjustments.tint > 0 ? '+' : ''}{Math.round(imageAdjustments.tint)}
              </span>
            </div>
            <input
              type="range"
              min="-100"
              max="100"
              value={imageAdjustments.tint}
              onChange={(e) => onAdjustmentChange({ ...imageAdjustments, tint: parseInt(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdjustmentModal; 
import React, { useRef, useEffect } from 'react';
import { TrendingUp, RefreshCw, X, RotateCw } from 'lucide-react';
import { UpscaleModel } from './types';

interface EnhanceModalProps {
  isVisible: boolean;
  position: { x: number; y: number };
  zIndex: number;
  isDragging: boolean;
  selectedUpscaleModel: string;
  upscaleFactor: number;
  isEnhancing: boolean;
  upscaleModels: UpscaleModel[];
  onPositionChange: (position: { x: number; y: number }) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onModelChange: (modelId: string) => void;
  onScaleFactorChange: (factor: number) => void;
  onEnhance: () => void;
  onReset: () => void;
  onClose: () => void;
  onBringToFront: () => void;
  isOnTop: boolean;
}

const EnhanceModal: React.FC<EnhanceModalProps> = ({
  isVisible,
  position,
  zIndex,
  isDragging,
  selectedUpscaleModel,
  upscaleFactor,
  isEnhancing,
  upscaleModels,
  onPositionChange,
  onDragStart,
  onDragEnd,
  onModelChange,
  onScaleFactorChange,
  onEnhance,
  onReset,
  onClose,
  onBringToFront,
  isOnTop
}) => {
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    onBringToFront();
    onDragStart();
    
    const panelElement = e.currentTarget.closest('[style*="left:"]') as HTMLElement;
    if (!panelElement) {
      console.log('🐛 Enhance panel element not found in handleMouseDown');
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
        top: position.y === 0 ? '50%' : `${position.y}px`,
        transform: position.y === 0 ? 'translateY(-50%)' : 'none',
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
            <h3 className="text-white text-sm font-medium">Image Enhancement</h3>
          </div>
          <div className="flex items-center gap-1">
            {/* Enhance Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEnhance();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Enhance image"
              disabled={isEnhancing}
            >
              <TrendingUp size={14} className={isEnhancing ? 'text-white/30 animate-pulse' : 'text-white'} />
            </button>
            
            {/* Reset Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReset();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Reset settings"
            >
              <RefreshCw size={14} className="text-white" />
            </button>
            
            {/* Close Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Close enhancement"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        
        {/* Enhancement Controls - Scrollable Content */}
        <div 
          className="p-4 space-y-3 overflow-y-auto max-h-[calc(70vh-80px)] scrollbar-hide" 
          style={{
            scrollbarWidth: 'none', // Firefox
            msOverflowStyle: 'none', // IE and Edge
          }}
        >
          {/* Model Selection */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Enhancement Model</label>
              <span className="text-white/50 text-xs">
                {upscaleModels.find(m => m.id === selectedUpscaleModel)?.category || 'Model'}
              </span>
            </div>
            <select
              value={selectedUpscaleModel}
              onChange={(e) => onModelChange(e.target.value)}
              className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
              disabled={isEnhancing}
            >
              {upscaleModels.map((model) => (
                <option key={model.id} value={model.id} className="bg-black text-white">
                  {model.name} ({model.category})
                </option>
              ))}
            </select>
          </div>

          {/* Scale Factor */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Scale Factor</label>
              <span className="text-white/50 text-xs font-mono w-10 text-right">
                {upscaleFactor}x
              </span>
            </div>
            <div className="flex items-center justify-between space-x-1">
              {[2, 4, 8].map(factor => (
                <button
                  key={factor}
                  onClick={() => onScaleFactorChange(factor)}
                  disabled={isEnhancing}
                  className={`flex-1 px-3 py-1.5 rounded text-xs transition-colors ${
                    upscaleFactor === factor
                      ? 'bg-white/20 text-white border border-white/40'
                      : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  {factor}x
                </button>
              ))}
            </div>
          </div>

          {/* Model Info */}
          <div className="bg-black/30 border border-white/10 rounded-lg p-3">
            <div className="text-white/70 text-xs mb-2 flex items-center">
              <TrendingUp size={12} className="mr-1.5 text-white/70"/> Enhancement Info
            </div>
            <div className="space-y-2 text-xs text-white/60">
              {selectedUpscaleModel.includes('recraft') && (
                <>
                  <div className="flex items-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/60 mr-2"></div>
                    <span>AI-powered enhancement</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/60 mr-2"></div>
                    <span>{selectedUpscaleModel.includes('creative') ? 'Creative artistic style' : 'Crisp detail focus'}</span>
                  </div>
                </>
              )}
              {selectedUpscaleModel.includes('real-esrgan') && (
                <>
                  <div className="flex items-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/60 mr-2"></div>
                    <span>Traditional upscaling</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/60 mr-2"></div>
                    <span>Fast and reliable</span>
                  </div>
                </>
              )}
              {selectedUpscaleModel.includes('fal-ai') && !selectedUpscaleModel.includes('recraft') && (
                <>
                  <div className="flex items-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/60 mr-2"></div>
                    <span>Advanced AI processing</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/60 mr-2"></div>
                    <span>High-quality results</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Processing Status */}
          {isEnhancing && (
            <div className="bg-white/10 border border-white/20 rounded-lg p-3">
              <div className="flex items-center text-white/80 text-xs">
                <RotateCw size={12} className="mr-2 animate-spin" />
                <span>Enhancing image with {upscaleModels.find(m => m.id === selectedUpscaleModel)?.name}...</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EnhanceModal; 
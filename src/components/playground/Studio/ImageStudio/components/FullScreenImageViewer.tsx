import React, { useState, useRef, useEffect } from 'react';
import { 
  X, Download
} from 'lucide-react';

// Simplified Full-screen Image Viewer Component - Canvas logic moved to CanvasViewer
const FullScreenImageViewer: React.FC<{
  imageUrl: string | null;
  isOpen: boolean;
  onClose: () => void;
  showDownloadButton?: boolean;
}> = ({ 
  imageUrl, 
  isOpen, 
  onClose, 
  showDownloadButton
}) => {
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Basic keyboard controls
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isOpen, onClose]);

  // Reset view when image changes
  useEffect(() => {
    if (imageUrl) {
      setScale(1);
      setTranslateX(0);
      setTranslateY(0);
    }
  }, [imageUrl]);

  const handleDownload = () => {
    if (!imageUrl) return;
    
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `image-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isSpacePressed) {
    setIsDragging(true);
    setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && isSpacePressed) {
      const deltaX = e.clientX - lastMousePos.x;
      const deltaY = e.clientY - lastMousePos.y;

      setTranslateX(prev => prev + deltaX);
      setTranslateY(prev => prev + deltaY);
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(prev => Math.max(0.1, Math.min(5, prev * delta)));
  };

  const handleResetView = () => {
    setScale(1);
    setTranslateX(0);
    setTranslateY(0);
  };

  if (!isOpen || !imageUrl) return null;

  return (
    <div className="absolute inset-0 w-full h-full z-[1000] bg-black/80 backdrop-blur-md flex flex-col">
      {/* Top Controls */}
      <div className="absolute top-4 right-4 z-[1001] flex items-center gap-2">
        {(showDownloadButton === undefined || showDownloadButton === true) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
              handleDownload();
            }}
            className="p-2 rounded-md text-white hover:bg-white/10 transition-colors"
            title="Download Image"
          >
            <Download size={20} />
          </button>
        )}
        <button
          onClick={(e) => { 
            e.stopPropagation(); 
            onClose(); 
          }}
          className="p-2 rounded-md text-white hover:bg-white/10 transition-colors"
          title="Close Fullscreen"
        >
          <X size={24} />
        </button>
      </div>

      {/* Navigation Controls */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1001] flex items-center gap-3">
        <button
          onClick={handleResetView}
          className="px-3 py-2 bg-black/70 text-white rounded-lg text-sm font-medium hover:bg-black/90 transition-colors"
          title="Fit to Screen"
        >
          Fit to Screen
        </button>
        
        <div className="bg-black/70 text-white rounded-lg px-3 py-2 text-xs text-center">
          {Math.round(scale * 100)}%
        </div>
      </div>

      {/* Image Container */}
      <div 
        className="flex-1 flex items-center justify-center overflow-hidden"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        style={{
          cursor: isSpacePressed 
            ? (isDragging ? 'grabbing' : 'grab') 
            : 'default'
        }}
                >
                  <img
                    src={imageUrl}
          alt="Full screen view"
          className="max-w-none max-h-none object-contain select-none"
                     style={{
            transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.1s ease-out'
          }}
          draggable={false}
        />
                      </div>

      {/* Instructions */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-[1001] bg-black/70 text-white rounded-lg px-3 py-2 text-xs text-center">
        Hold Space + Drag to pan • Scroll to zoom • ESC to close
                  </div>
    </div>
  );
};

export { FullScreenImageViewer };

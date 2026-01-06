import React from 'react';
import { Eraser, X } from 'lucide-react';

interface RemoveModalProps {
  isVisible: boolean;
  position: { x: number; y: number };
  zIndex: number;
  onClose: () => void;
  onBringToFront: () => void;
  isOnTop: boolean;
}

const RemoveModal: React.FC<RemoveModalProps> = ({
  isVisible,
  position,
  zIndex,
  onClose,
  onBringToFront,
  isOnTop
}) => {
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
          isOnTop 
            ? 'border-white/40' 
            : 'border-white/20'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onBringToFront();
        }}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-white text-sm font-medium">Remove Tool</h3>
          </div>
          <div className="flex items-center gap-1">
            {/* Close Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Close remove tool"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        
        {/* Remove Controls */}
        <div className="p-4 space-y-3">
          <div className="text-center text-white/70 text-sm">
            <Eraser size={24} className="mx-auto mb-2 text-white/70" />
            <p>Remove Tool</p>
            <p className="text-xs text-white/50 mt-1">Coming soon...</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RemoveModal; 
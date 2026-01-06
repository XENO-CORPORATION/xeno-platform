import * as React from 'react';
import { IconSize } from './Desktop';
import { RefreshCw, FolderPlus, FilePlus, RotateCcw, Check } from 'lucide-react';

interface DesktopContextMenuProps {
  position: { x: number; y: number };
  onClose: () => void;
  onIconSizeChange: (size: IconSize) => void;
  onAutoArrange?: () => void;
  onRefresh?: () => void;
  onNewFolder?: () => void;
  onNewFile?: () => void;
  currentIconSize: IconSize;
}

const DesktopContextMenu: React.FC<DesktopContextMenuProps> = ({
  position,
  onClose,
  onIconSizeChange,
  onAutoArrange,
  onRefresh,
  onNewFolder,
  onNewFile,
  currentIconSize
}) => {
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to keep menu in viewport
  const adjustedPosition = React.useMemo(() => {
    const menuWidth = 200;
    const menuHeight = 280;
    const margin = 8;

    let x = position.x;
    let y = position.y;

    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - margin;
    }

    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - margin;
    }

    return { x, y };
  }, [position]);

  const handleIconSizeSelect = (size: IconSize) => {
    onIconSizeChange(size);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />

      {/* Context Menu */}
      <div
        ref={menuRef}
        className="fixed z-50 bg-[rgba(32,32,32,0.98)] backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl overflow-hidden"
        style={{
          left: adjustedPosition.x,
          top: adjustedPosition.y,
          width: '200px'
        }}
      >
        {/* View Options */}
        <div className="p-2">
          <div className="px-2 py-1 text-xs font-medium text-white/60 uppercase tracking-wide">
            View
          </div>

          {/* Icon Size Options */}
          <div className="mt-1 space-y-1">
            <button
              className={`w-full px-2 py-1.5 text-left text-sm transition-colors duration-200 flex items-center justify-between rounded ${
                currentIconSize === 'small'
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'text-white/90 hover:bg-white/10'
              }`}
              onClick={() => handleIconSizeSelect('small')}
            >
              <span>Small icons</span>
              {currentIconSize === 'small' && <Check size={12} />}
            </button>

            <button
              className={`w-full px-2 py-1.5 text-left text-sm transition-colors duration-200 flex items-center justify-between rounded ${
                currentIconSize === 'medium'
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'text-white/90 hover:bg-white/10'
              }`}
              onClick={() => handleIconSizeSelect('medium')}
            >
              <span>Medium icons</span>
              {currentIconSize === 'medium' && <Check size={12} />}
            </button>

            <button
              className={`w-full px-2 py-1.5 text-left text-sm transition-colors duration-200 flex items-center justify-between rounded ${
                currentIconSize === 'large'
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'text-white/90 hover:bg-white/10'
              }`}
              onClick={() => handleIconSizeSelect('large')}
            >
              <span>Large icons</span>
              {currentIconSize === 'large' && <Check size={12} />}
            </button>
          </div>
        </div>

        {/* Separator */}
        <div className="border-t border-white/10 mx-2" />

        {/* Creation Options */}
        <div className="p-2">
          <div className="px-2 py-1 text-xs font-medium text-white/60 uppercase tracking-wide">
            New
          </div>
          <button
            className="w-full px-2 py-1.5 text-left text-sm text-white/90 hover:bg-white/10 transition-colors duration-200 flex items-center gap-2 rounded"
            onClick={() => {
              onNewFolder?.();
              onClose();
            }}
          >
            <FolderPlus size={14} />
            Folder
          </button>
          <button
            className="w-full px-2 py-1.5 text-left text-sm text-white/90 hover:bg-white/10 transition-colors duration-200 flex items-center gap-2 rounded"
            onClick={() => {
              onNewFile?.();
              onClose();
            }}
          >
            <FilePlus size={14} />
            Text Document
          </button>
        </div>

        {/* Separator */}
        <div className="border-t border-white/10 mx-2" />

        {/* Action Options */}
        <div className="p-2">
          <button
            className="w-full px-2 py-1.5 text-left text-sm text-white/90 hover:bg-white/10 transition-colors duration-200 flex items-center gap-2 rounded"
            onClick={() => {
              onRefresh?.();
              onClose();
            }}
          >
            <RefreshCw size={14} />
            Refresh
          </button>

          <button
            className="w-full px-2 py-1.5 text-left text-sm text-white/90 hover:bg-white/10 transition-colors duration-200 flex items-center gap-2 rounded"
            onClick={() => {
              onAutoArrange?.();
              onClose();
            }}
          >
            <RotateCcw size={14} />
            Auto Arrange
          </button>
        </div>
      </div>
    </>
  );
};

export default DesktopContextMenu;

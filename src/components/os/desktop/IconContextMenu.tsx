import * as React from 'react';
import { FolderOpen, Pencil, Trash2, Info } from 'lucide-react';

interface IconContextMenuProps {
  position: { x: number; y: number };
  iconName: string;
  iconType: 'file' | 'folder' | 'app';
  onClose: () => void;
  onOpen?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onProperties?: () => void;
}

const IconContextMenu: React.FC<IconContextMenuProps> = ({
  position,
  iconName,
  iconType,
  onClose,
  onOpen,
  onRename,
  onDelete,
  onProperties
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
    const menuWidth = 180;
    const menuHeight = 180;
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

  // Determine if delete is allowed (not for system apps)
  const canDelete = iconType !== 'app';
  const canRename = iconType !== 'app';

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
          width: '180px'
        }}
      >
        {/* Header */}
        <div className="px-3 py-2 border-b border-white/10">
          <div className="text-xs text-white/60 truncate">{iconName}</div>
        </div>

        {/* Menu Items */}
        <div className="p-1">
          {/* Open */}
          <button
            className="w-full px-2 py-1.5 text-left text-sm text-white/90 hover:bg-white/10 transition-colors duration-200 flex items-center gap-2 rounded"
            onClick={() => {
              onOpen?.();
              onClose();
            }}
          >
            <FolderOpen size={14} />
            Open
          </button>

          {/* Rename */}
          {canRename && (
            <button
              className="w-full px-2 py-1.5 text-left text-sm text-white/90 hover:bg-white/10 transition-colors duration-200 flex items-center gap-2 rounded"
              onClick={() => {
                onRename?.();
                onClose();
              }}
            >
              <Pencil size={14} />
              Rename
            </button>
          )}

          {/* Separator before delete */}
          {canDelete && <div className="border-t border-white/10 my-1 mx-1" />}

          {/* Delete */}
          {canDelete && (
            <button
              className="w-full px-2 py-1.5 text-left text-sm text-red-400 hover:bg-red-500/20 transition-colors duration-200 flex items-center gap-2 rounded"
              onClick={() => {
                onDelete?.();
                onClose();
              }}
            >
              <Trash2 size={14} />
              Delete
            </button>
          )}

          {/* Separator before properties */}
          <div className="border-t border-white/10 my-1 mx-1" />

          {/* Properties */}
          <button
            className="w-full px-2 py-1.5 text-left text-sm text-white/90 hover:bg-white/10 transition-colors duration-200 flex items-center gap-2 rounded"
            onClick={() => {
              onProperties?.();
              onClose();
            }}
          >
            <Info size={14} />
            Properties
          </button>
        </div>
      </div>
    </>
  );
};

export default IconContextMenu;

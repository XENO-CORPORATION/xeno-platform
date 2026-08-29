import React, { useEffect, useRef, useState } from 'react';
import { GripVertical, X } from 'lucide-react';

interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
  position?: 'left' | 'right';
  title: string;
  children: React.ReactNode;
  zIndex?: number;
  onBringToFront?: () => void;
  isOnTop?: boolean;
  bottomPanelHeight?: number;
  isBottomPanelOpen?: boolean;
  hideCloseButton?: boolean;
  headerActions?: React.ReactNode;
}

const SidePanel: React.FC<SidePanelProps> = ({
  isOpen,
  onClose,
  position = 'left',
  title,
  children,
  zIndex = 1001,
  onBringToFront,
  isOnTop = true,
  bottomPanelHeight = 300,
  isBottomPanelOpen = false,
  hideCloseButton = false,
  headerActions,
}) => {
  const [width, setWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!isResizing) return;
      const panel = resizeRef.current?.parentElement?.getBoundingClientRect();
      if (!panel) return;
      const nextWidth = position === 'left' ? event.clientX - panel.left : panel.right - event.clientX;
      setWidth(Math.max(220, Math.min(640, nextWidth)));
    };
    const handleUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isResizing, position]);

  if (!isOpen) return null;
  const bottom = isBottomPanelOpen ? bottomPanelHeight + 32 : 16;
  const edgeClass = position === 'left' ? 'left-4' : 'right-4';
  const resizeEdge = position === 'left' ? 'right-0 translate-x-1/2' : 'left-0 -translate-x-1/2';

  return (
    <aside
      className={`absolute top-4 ${edgeClass} flex flex-col overflow-hidden rounded-xl border bg-black/90 shadow-2xl backdrop-blur-sm ${isOnTop ? 'border-white/40' : 'border-white/20'}`}
      style={{ zIndex, width, bottom }}
      onMouseDown={() => onBringToFront?.()}
    >
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h3 className="text-sm font-medium text-white">{title}</h3>
        <div className="flex items-center gap-1">
          {headerActions}
          {!hideCloseButton && (
            <button type="button" onClick={onClose} className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close panel">
              <X size={16} />
            </button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <div
        ref={resizeRef}
        className={`absolute top-0 h-full w-2 cursor-col-resize ${resizeEdge}`}
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); setIsResizing(true); }}
      >
        <GripVertical size={12} className="absolute top-1/2 -translate-y-1/2 text-white/40" />
      </div>
    </aside>
  );
};

export default SidePanel;

import * as React from 'react';
import { X, Minus, Square, Maximize2, Plus } from 'lucide-react';

export interface WindowState {
  id: string;
  title: string;
  content: React.ReactNode;
  position: { x: number; y: number };
  size: { width: number; height: number };
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  icon?: React.ReactNode;
}

export interface WindowTab {
  id: string;
  title: string;
  currentPath: string;
}

export interface WindowTabsProps {
  tabs: WindowTab[];
  activeTabId: string;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  onTabPathUpdate: (tabId: string, path: string) => void;
}

interface DesktopWindowProps {
  window: WindowState;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onMaximize: (id: string) => void;
  onFocus: (id: string) => void;
  isActive: boolean;
  tabs?: WindowTabsProps;
}

const DesktopWindow: React.FC<DesktopWindowProps> = ({
  window,
  onClose,
  onMinimize,
  onMaximize,
  onFocus,
  isActive,
  tabs
}) => {

  const [isDragging, setIsDragging] = React.useState(false);
  const [isResizing, setIsResizing] = React.useState(false);
  const [resizeHandle, setResizeHandle] = React.useState<string | null>(null);
  const [dragStart, setDragStart] = React.useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = React.useState({ width: 0, height: 0 });
  const [windowPosition, setWindowPosition] = React.useState(window.position);
  const [windowSize, setWindowSize] = React.useState(window.size);
  const windowRef = React.useRef<HTMLDivElement>(null);
  const dragStartRef = React.useRef({ x: 0, y: 0 });

  // Use refs for smooth dragging without React state updates
  const currentPositionRef = React.useRef(window.position);
  const rafIdRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    // Add validation for window position
    const safePosition = {
      x: isNaN(window.position.x) ? 100 : window.position.x,
      y: isNaN(window.position.y) ? 100 : window.position.y
    };

    setWindowPosition(safePosition);
    currentPositionRef.current = safePosition;
  }, [window.position]);

  React.useEffect(() => {
    // Update window size when props change
    const safeSize = {
      width: Math.max(400, window.size.width || 800),
      height: Math.max(300, window.size.height || 600)
    };
    setWindowSize(safeSize);
  }, [window.size]);

  // Resize event handlers
  const handleResizeMouseDown = React.useCallback((event: React.MouseEvent, handle: string) => {
    event.preventDefault();
    event.stopPropagation();

    setIsResizing(true);
    setResizeHandle(handle);
    setResizeStart({
      width: windowSize.width,
      height: windowSize.height
    });
    setDragStart({
      x: event.clientX,
      y: event.clientY
    });

    document.body.style.cursor = getResizeCursor(handle);
    document.body.style.userSelect = 'none';

    onFocus(window.id);
  }, [windowSize, onFocus, window.id]);

  const getResizeCursor = (handle: string) => {
    switch (handle) {
      case 'right': return 'ew-resize';
      case 'bottom': return 'ns-resize';
      case 'bottom-right': return 'nw-resize';
      default: return 'default';
    }
  };

  const handleResizeMouseMove = React.useCallback((event: MouseEvent) => {
    if (!isResizing || !resizeHandle) return;

    const deltaX = event.clientX - dragStart.x;
    const deltaY = event.clientY - dragStart.y;

    let newWidth = resizeStart.width;
    let newHeight = resizeStart.height;

    if (resizeHandle.includes('right')) {
      newWidth = Math.max(400, resizeStart.width + deltaX);
    }
    if (resizeHandle.includes('bottom')) {
      newHeight = Math.max(300, resizeStart.height + deltaY);
    }

    setWindowSize({ width: newWidth, height: newHeight });
  }, [isResizing, resizeHandle, dragStart, resizeStart]);

  const handleResizeMouseUp = React.useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      setResizeHandle(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }, [isResizing]);

  // Add global resize event listeners
  React.useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMouseMove);
      document.addEventListener('mouseup', handleResizeMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleResizeMouseMove);
        document.removeEventListener('mouseup', handleResizeMouseUp);
      };
    }
  }, [isResizing, handleResizeMouseMove, handleResizeMouseUp]);

  // Enhanced drag handlers with better event handling
  const handleMouseDown = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // Allow dragging from title bar and any of its children
    const titleBar = event.currentTarget as HTMLElement;
    const clickedElement = event.target as HTMLElement;

    // Check if clicked element is within the title bar
    if (!titleBar.contains(clickedElement)) return;

    // Don't start drag if clicking on window control buttons
    if (clickedElement.closest('button')) return;

    // Store initial drag position using current position ref
    const currentPos = currentPositionRef.current;
    const initialX = event.clientX - currentPos.x;
    const initialY = event.clientY - currentPos.y;

    // Add NaN checks
    const safeInitialX = isNaN(initialX) ? 0 : initialX;
    const safeInitialY = isNaN(initialY) ? 0 : initialY;

    dragStartRef.current = { x: safeInitialX, y: safeInitialY };
    setIsDragging(true);
    onFocus(window.id);
  }, [onFocus, window.id]);

  const handleMouseMove = React.useCallback((event: MouseEvent) => {
    if (!isDragging || !windowRef.current) return;

    event.preventDefault();

    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    // Calculate new position
    const newX = event.clientX - dragStartRef.current.x;
    const newY = event.clientY - dragStartRef.current.y;

    // Keep window within viewport bounds
    const maxX = globalThis.window.innerWidth - window.size.width;
    const maxY = globalThis.window.innerHeight - window.size.height;

    // Add NaN checks for safety
    const safeMaxX = isNaN(maxX) ? 800 : maxX;
    const safeMaxY = isNaN(maxY) ? 600 : maxY;

    const constrainedX = Math.max(0, Math.min(newX, safeMaxX));
    const constrainedY = Math.max(0, Math.min(newY, safeMaxY));

    // Update position ref immediately for smooth performance
    currentPositionRef.current = { x: constrainedX, y: constrainedY };

    // Use requestAnimationFrame for smooth DOM updates (no React state)
    rafIdRef.current = requestAnimationFrame(() => {
      if (windowRef.current) {
        windowRef.current.style.transform = `translate(${constrainedX}px, ${constrainedY}px)`;
      }
    });
  }, [isDragging, window.size]);

  const handleMouseUp = React.useCallback(() => {
    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Sync React state with final position
    setWindowPosition(currentPositionRef.current);
    setIsDragging(false);
  }, []);

  // Global event listeners with proper cleanup
  React.useEffect(() => {
    if (isDragging) {
      // Add global listeners
      document.addEventListener('mousemove', handleMouseMove, { passive: false });
      document.addEventListener('mouseup', handleMouseUp, { passive: false });

      // Prevent text selection during drag
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'move';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        // Restore normal cursor and selection
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  if (window.isMinimized) {
    return null;
  }

  return (
    <div
      ref={windowRef}
      className="absolute"
      style={{
        left: 0,
        top: 0,
        width: windowSize.width,
        height: windowSize.height,
        zIndex: window.zIndex,
        transform: `translate(${windowPosition.x}px, ${windowPosition.y}px)`
      }}
    >
      {/* Resize Handles */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/10"
        onMouseDown={(e) => handleResizeMouseDown(e, 'right')}
      />
      <div
        className="absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize hover:bg-white/10"
        onMouseDown={(e) => handleResizeMouseDown(e, 'bottom')}
      />
      <div
        className="absolute right-0 bottom-0 w-4 h-4 cursor-nw-resize"
        onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-right')}
      >
        <div className="absolute right-0 bottom-0 w-2 h-2 border-r-2 border-b-2 border-white/30 hover:border-white/50" />
      </div>

      {/* Window Content */}
      <div
        className={`relative bg-[rgba(32,32,32,0.95)] backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl overflow-hidden transition-all duration-200 flex flex-col`}
        style={{
          width: '100%',
          height: '100%'
        }}
        onClick={() => onFocus(window.id)}
      >
      {/* Window Title Bar */}
      <div
        className="flex items-center justify-between px-4 py-2 bg-[rgba(42,42,42,0.8)] border-b border-white/10 cursor-move select-none touch-none"
        onMouseDown={handleMouseDown}
        onTouchStart={(e) => {
          // Prevent touch scrolling during drag
          e.preventDefault();
        }}
        style={{
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          userSelect: 'none'
        }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {window.icon && (
            <div className="text-white/60 flex-shrink-0">
              {window.icon}
            </div>
          )}
          {tabs ? (
            <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
              {tabs.tabs.map((tab) => {

                return (
                  <div
                    key={tab.id}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer transition-colors min-w-0 ${
                      tabs.activeTabId === tab.id
                        ? 'bg-white/10 border border-white/30 text-white/90'
                        : 'text-white/70 hover:bg-white/5 hover:text-white/90'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      tabs.onTabClick(tab.id);
                    }}
                  >
                    <span className="text-xs truncate">{tab.title}</span>
                    {tabs.tabs.length > 1 && (
                      <button
                        className="ml-1 p-0.5 text-white/50 hover:text-white/80 hover:bg-white/10 rounded flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          tabs.onTabClose(tab.id);
                        }}
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                className="px-2 py-1 text-white/60 hover:text-white/80 hover:bg-white/10 rounded transition-colors flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  tabs.onNewTab();
                }}
                title="New Tab"
              >
                <Plus size={12} />
              </button>
            </div>
          ) : (
            <span className="text-white font-medium text-sm truncate">{window.title}</span>
          )}
        </div>

        {/* Window Controls */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Minimize Button */}
          <button
            className="p-2 text-white/60 hover:text-white hover:bg-white/10 transition-colors rounded"
            onClick={(e) => {
              e.stopPropagation();
              onMinimize(window.id);
            }}
            title="Minimize"
          >
            <Minus size={14} />
          </button>

          {/* Maximize/Restore Button */}
          <button
            className="p-2 text-white/60 hover:text-white hover:bg-white/10 transition-colors rounded"
            onClick={(e) => {
              e.stopPropagation();
              onMaximize(window.id);
            }}
            title={window.isMaximized ? "Restore Down" : "Maximize"}
          >
            {window.isMaximized ? <Square size={14} /> : <Maximize2 size={14} />}
          </button>

          {/* Close Button */}
          <button
            className="p-2 text-white/60 hover:text-white hover:bg-red-500/80 transition-colors rounded"
            onClick={(e) => {
              e.stopPropagation();
              onClose(window.id);
            }}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

        {/* Window Content */}
        <div className="flex-1 overflow-hidden">
          {window.content}
        </div>
      </div>
    </div>
  );
};

export default DesktopWindow;

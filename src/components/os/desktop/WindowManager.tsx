import * as React from 'react';
import DesktopWindow, { WindowState } from './DesktopWindow';
import FileExplorer from './FileExplorer';
import Settings from './Settings';
import TextEditor from './TextEditor';
import TaskManager from './TaskManager';
import { HardDrive, Terminal, Settings as SettingsIcon, Palette, FileText, Activity } from 'lucide-react';
import { FileSyncDemo } from '../../FileSyncDemo';
import ImageStudio from '../../playground/Studio/ImageStudio/components/ImageStudio';
import { useCollaboration, WindowOperation } from '../../../contexts/CollaborationContext';

interface WindowManagerProps {
  children: React.ReactNode;
}

const WindowManager: React.FC<WindowManagerProps> = ({ children }) => {
  const [windows, setWindows] = React.useState<WindowState[]>([]);
  const [nextZIndex, setNextZIndex] = React.useState(100);

  // Collaboration integration for real-time window sync
  const { session, broadcastWindowOperation, lastWindowOperation } = useCollaboration();

  // Ref to track if operation is from remote collaborator (to avoid broadcasting back)
  const isRemoteOperationRef = React.useRef(false);

  const openWindow = React.useCallback((
    id: string,
    title: string,
    content: React.ReactNode,
    icon?: React.ReactNode,
    size = { width: 800, height: 600 }
  ) => {
    setWindows(prevWindows => {
      // Check if window already exists
      const existingWindow = prevWindows.find(w => w.id === id);
      if (existingWindow) {
        // Bring to front instead of creating new one
        bringToFront(id);
        return prevWindows;
      }

      // Calculate position to cascade windows
      const windowCount = prevWindows.length;
      const offset = windowCount * 30;
      const position = {
        x: Math.min(50 + offset, window.innerWidth - size.width - 50),
        y: Math.min(50 + offset, window.innerHeight - size.height - 50)
      };

      const newWindow: WindowState = {
        id,
        title,
        content,
        position,
        size,
        isMinimized: false,
        isMaximized: false,
        zIndex: nextZIndex,
        icon
      };

      setNextZIndex(prev => prev + 1);

      // Broadcast to collaborators (only if not from remote)
      if (session && !isRemoteOperationRef.current) {
        broadcastWindowOperation({
          operation: 'open',
          windowId: id,
          windowType: id.split('-')[0], // Extract type from id like 'explorer-123'
          windowTitle: title,
          position,
          size,
          timestamp: new Date().toISOString()
        });
      }

      return [...prevWindows, newWindow];
    });
  }, [nextZIndex, session, broadcastWindowOperation]);

  const closeWindow = React.useCallback((id: string) => {
    // Broadcast to collaborators (only if not from remote)
    if (session && !isRemoteOperationRef.current) {
      broadcastWindowOperation({
        operation: 'close',
        windowId: id,
        timestamp: new Date().toISOString()
      });
    }

    setWindows(prevWindows => prevWindows.filter(w => w.id !== id));
  }, [session, broadcastWindowOperation]);

  const minimizeWindow = React.useCallback((id: string) => {
    // Broadcast to collaborators (only if not from remote)
    if (session && !isRemoteOperationRef.current) {
      broadcastWindowOperation({
        operation: 'minimize',
        windowId: id,
        timestamp: new Date().toISOString()
      });
    }

    setWindows(prevWindows =>
      prevWindows.map(w =>
        w.id === id ? { ...w, isMinimized: !w.isMinimized } : w
      )
    );
  }, [session, broadcastWindowOperation]);

  const maximizeWindow = React.useCallback((id: string) => {
    // Broadcast to collaborators (only if not from remote)
    if (session && !isRemoteOperationRef.current) {
      broadcastWindowOperation({
        operation: 'maximize',
        windowId: id,
        timestamp: new Date().toISOString()
      });
    }

    setWindows(prevWindows =>
      prevWindows.map(w => {
        if (w.id === id) {
          if (!w.isMaximized) {
            // Save current position and size before maximizing
            const originalPosition = w.position;
            const originalSize = w.size;

            return {
              ...w,
              isMaximized: true,
              position: { x: 0, y: 0 },
              size: { width: window.innerWidth, height: window.innerHeight - 40 }, // Account for taskbar
              originalPosition,
              originalSize
            };
          } else {
            // Restore original position and size
            return {
              ...w,
              isMaximized: false,
              position: (w as any).originalPosition || w.position,
              size: (w as any).originalSize || w.size
            };
          }
        }
        return w;
      })
    );
  }, [session, broadcastWindowOperation]);

  const bringToFront = React.useCallback((id: string) => {
    // Broadcast to collaborators (only if not from remote)
    if (session && !isRemoteOperationRef.current) {
      broadcastWindowOperation({
        operation: 'focus',
        windowId: id,
        timestamp: new Date().toISOString()
      });
    }

    setWindows(prevWindows => {
      const window = prevWindows.find(w => w.id === id);
      if (!window) return prevWindows;

      const maxZIndex = prevWindows.length > 0 ? Math.max(...prevWindows.map(w => w.zIndex)) : 0;
      const newZIndex = maxZIndex + 1;

      return prevWindows.map(w =>
        w.id === id ? { ...w, zIndex: newZIndex } : w
      );
    });
    setNextZIndex(prev => prev + 1);
  }, [session, broadcastWindowOperation]);

  const updateWindowPosition = React.useCallback((id: string, position: { x: number; y: number }) => {
    // Broadcast position updates (throttled in broadcastWindowOperation)
    if (session && !isRemoteOperationRef.current) {
      broadcastWindowOperation({
        operation: 'move',
        windowId: id,
        position,
        timestamp: new Date().toISOString()
      });
    }

    setWindows(prevWindows =>
      prevWindows.map(w =>
        w.id === id ? { ...w, position } : w
      )
    );
  }, [session, broadcastWindowOperation]);

  // Handle window operations from collaborators
  React.useEffect(() => {
    if (!lastWindowOperation) return;

    console.log('🪟 Processing window operation from collaborator:', lastWindowOperation);

    // Mark as remote operation to prevent re-broadcasting
    isRemoteOperationRef.current = true;

    const { operation, windowId, position, size } = lastWindowOperation;

    switch (operation) {
      case 'close':
        setWindows(prev => prev.filter(w => w.id !== windowId));
        break;

      case 'minimize':
        setWindows(prev => prev.map(w =>
          w.id === windowId ? { ...w, isMinimized: !w.isMinimized } : w
        ));
        break;

      case 'maximize':
        setWindows(prev => prev.map(w => {
          if (w.id === windowId) {
            if (!w.isMaximized) {
              return {
                ...w,
                isMaximized: true,
                position: { x: 0, y: 0 },
                size: { width: window.innerWidth, height: window.innerHeight - 40 },
                originalPosition: w.position,
                originalSize: w.size
              };
            } else {
              return {
                ...w,
                isMaximized: false,
                position: (w as any).originalPosition || w.position,
                size: (w as any).originalSize || w.size
              };
            }
          }
          return w;
        }));
        break;

      case 'focus':
        setWindows(prev => {
          const maxZIndex = prev.length > 0 ? Math.max(...prev.map(w => w.zIndex)) : 0;
          return prev.map(w =>
            w.id === windowId ? { ...w, zIndex: maxZIndex + 1 } : w
          );
        });
        break;

      case 'move':
        if (position) {
          setWindows(prev => prev.map(w =>
            w.id === windowId ? { ...w, position } : w
          ));
        }
        break;

      case 'resize':
        if (size) {
          setWindows(prev => prev.map(w =>
            w.id === windowId ? { ...w, size } : w
          ));
        }
        break;

      // Note: 'open' operation is handled by observing user actions,
      // since we can't serialize React components through WebSocket
    }

    // Reset remote operation flag
    setTimeout(() => {
      isRemoteOperationRef.current = false;
    }, 100);

  }, [lastWindowOperation]);

  // Expose window management functions to child components via context
  const contextValue = React.useMemo(() => ({
    openWindow,
    closeWindow,
    minimizeWindow,
    maximizeWindow,
    bringToFront,
    updateWindowPosition,
    windows
  }), [openWindow, closeWindow, minimizeWindow, maximizeWindow, bringToFront, updateWindowPosition, windows]);

  return (
    <WindowManagerContext.Provider value={contextValue}>
      {children}

      {/* Render all open windows */}
      {windows.map(window => {
        const isActive = windows.length > 0 ? window.zIndex === Math.max(...windows.map(w => w.zIndex)) : true;

        return (
          <DesktopWindow
            key={window.id}
            window={window}
            onClose={closeWindow}
            onMinimize={minimizeWindow}
            onMaximize={maximizeWindow}
            onFocus={bringToFront}
            isActive={isActive}
          />
        );
      })}
    </WindowManagerContext.Provider>
  );
};

// Context for window management
interface WindowManagerContextType {
  openWindow: (id: string, title: string, content: React.ReactNode, icon?: React.ReactNode, size?: { width: number; height: number }) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  bringToFront: (id: string) => void;
  updateWindowPosition: (id: string, position: { x: number; y: number }) => void;
  windows: WindowState[];
}

const WindowManagerContext = React.createContext<WindowManagerContextType | undefined>(undefined);

export const useWindowManager = () => {
  const context = React.useContext(WindowManagerContext);
  if (context === undefined) {
    throw new Error('useWindowManager must be used within a WindowManager');
  }
  return context;
};

// Predefined window templates
export const createFileExplorerWindow = (path?: string) => {
  const windowId = `explorer-${Date.now()}`;
  return {
    id: windowId,
    title: 'Xeno Explorer',
    content: <FileExplorer initialPath={path || '/home'} />,
    icon: <HardDrive size={16} />,
    size: { width: 1280, height: 720 } // 16:9 ratio
  };
};

export const createTerminalWindow = () => {
  return {
    id: `terminal-${Date.now()}`,
    title: 'Terminal',
    content: (
      <div className="h-full bg-black text-green-400 p-4 font-mono text-sm">
        <div className="mb-4">
          <div>XenoStudio Terminal v1.0.0</div>
          <div>Type 'help' for available commands.</div>
        </div>
        <div className="flex items-center">
          <span className="text-green-400 mr-2">$</span>
          <input
            type="text"
            className="flex-1 bg-transparent border-none outline-none text-green-400 caret-green-400"
            placeholder="Type a command..."
            autoFocus
          />
        </div>
      </div>
    ),
    icon: <Terminal size={16} />,
    size: { width: 800, height: 500 }
  };
};

export const createWebSocketDemoWindow = () => {
  return {
    id: `websocket-demo-${Date.now()}`,
    title: 'WebSocket File Sync Demo',
    content: <FileSyncDemo />,
    icon: <HardDrive size={16} />,
    size: { width: 1000, height: 700 }
  };
};

export const createSettingsWindow = () => {
  return {
    id: 'settings',
    title: 'Settings',
    content: <Settings />,
    icon: <SettingsIcon size={16} />,
    size: { width: 1000, height: 700 }
  };
};

export const createImageStudioWindow = () => {
  return {
    id: 'image-studio',
    title: 'Image Studio',
    content: <ImageStudio />,
    icon: <Palette size={16} />,
    size: { width: 1200, height: 800 }
  };
};

export const createTextEditorWindow = (path?: string) => {
  return {
    id: `text-editor-${Date.now()}`,
    title: path ? `Text Editor - ${path}` : 'Text Editor',
    content: <TextEditor initialPath={path} />,
    icon: <FileText size={16} />,
    size: { width: 800, height: 600 }
  };
};

export const createTaskManagerWindow = () => {
  return {
    id: 'task-manager',
    title: 'Task Manager',
    content: <TaskManager />,
    icon: <Activity size={16} />,
    size: { width: 700, height: 500 }
  };
};

export default WindowManager;

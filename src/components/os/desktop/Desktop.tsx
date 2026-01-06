import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Folder, FileText, Terminal, Settings, HardDrive, Trash2, Wifi, Activity } from 'lucide-react';
import DesktopIcon from './DesktopIcon';
import DesktopContextMenu from './DesktopContextMenu';
import DesktopContext from './DesktopContext';
import DesktopTaskbar from './DesktopTaskbar';
import StartMenu from './StartMenu';
import { useAuth } from '../../../contexts/AuthContext';
import { useWindowManager, createFileExplorerWindow, createTerminalWindow, createWebSocketDemoWindow, createSettingsWindow, createTextEditorWindow, createTaskManagerWindow } from './WindowManager';
import { useContainer } from '../../../contexts/ContainerContext';
import { containerFileSystemService } from '../../../services/containerFileSystemService';

export type IconSize = 'small' | 'medium' | 'large';

export interface DesktopIconData {
  id: string;
  name: string;
  icon: React.ReactNode;
  type: 'folder' | 'file' | 'app';
  position: { x: number; y: number };
  onOpen?: () => void;
  path?: string; // Path for file system items
}

// Grid configuration based on icon size
const getGridConfig = (iconSize: IconSize) => {
  switch (iconSize) {
    case 'small':
      return { gridSize: 60, iconSize: 24, labelHeight: 20, fontSize: 7 };
    case 'medium':
      return { gridSize: 80, iconSize: 36, labelHeight: 24, fontSize: 8.5 };
    case 'large':
      return { gridSize: 100, iconSize: 48, labelHeight: 28, fontSize: 10 };
  }
};

const Desktop: React.FC = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  
  // Container integration
  const { fileSystem, refreshFileSystem, navigateToPath } = useContainer();
  const desktopPath = '/home/user/Desktop';
  const [desktopItems, setDesktopItems] = React.useState<DesktopIconData[]>([]);
  
  const [selectedIcon, setSelectedIcon] = React.useState<string | null>(null);
  const [selectedIcons, setSelectedIcons] = React.useState<Set<string>>(new Set());
  const [iconSize, setIconSize] = React.useState<IconSize>('medium');
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [draggedIcon, setDraggedIcon] = React.useState<string | null>(null);
  const [dragOffset, setDragOffset] = React.useState({ x: 0, y: 0 });
  const [isStartMenuOpen, setIsStartMenuOpen] = React.useState(false);
  const { openWindow } = useWindowManager();

  // Marquee selection state
  const [isSelecting, setIsSelecting] = React.useState(false);
  const [selectionBox, setSelectionBox] = React.useState({ x: 0, y: 0, width: 0, height: 0 });
  const [selectionStart, setSelectionStart] = React.useState({ x: 0, y: 0 });
  const desktopRef = React.useRef<HTMLDivElement>(null);

  const gridConfig = getGridConfig(iconSize);
  const { gridSize, iconSize: actualIconSize, labelHeight, fontSize } = gridConfig;

  // Initialize desktop - Create Desktop folder if not exists
  React.useEffect(() => {
    const initDesktop = async () => {
      try {
        // Check/Create desktop folder
        const result = await containerFileSystemService.createDirectory('/home/user', 'Desktop');
        if (result.success) {
          console.log('Desktop folder verified');
          refreshDesktop();
        }
      } catch (error) {
        console.error('Failed to init desktop:', error);
      }
    };
    
    initDesktop();
  }, []);

  // Refresh desktop contents
  const refreshDesktop = async () => {
    try {
      const result = await containerFileSystemService.listDirectory(desktopPath);
      if (result.success && result.data) {
        // Map container files to desktop icons
        const newIcons: DesktopIconData[] = result.data.items.map((item, index) => {
          // Get saved position from localStorage if available
          const savedPos = localStorage.getItem(`icon_pos_${item.path}`);
          const position = savedPos ? JSON.parse(savedPos) : getAutoArrangedPosition(index, gridSize);
          
          return {
            id: item.id,
            name: item.name,
            type: item.type === 'folder' ? 'folder' : 'file',
            icon: item.type === 'folder' ? <Folder size={actualIconSize} /> : <FileText size={actualIconSize} />,
            position,
            path: item.path,
            onOpen: () => handleFileOpen(item)
          };
        });
        
        // Merge with static apps
        const appIcons: DesktopIconData[] = [
          createIcon('xeno-explorer', 'Xeno Explorer', HardDrive, 'app', getAppPosition(0)),
          createIcon('terminal', 'Terminal', Terminal, 'app', getAppPosition(1)),
          createIcon('trash', 'Trash', Trash2, 'folder', getAppPosition(2))
        ];
        
        setIcons([...appIcons, ...newIcons]);
      }
    } catch (error) {
      console.error('Failed to refresh desktop:', error);
    }
  };

  const getAppPosition = (index: number) => {
    const savedPos = localStorage.getItem(`icon_pos_app_${index}`);
    return savedPos ? JSON.parse(savedPos) : getAutoArrangedPosition(index, gridSize);
  };

  // File operations
  const handleNewFolder = async () => {
    const name = prompt('Folder name:', 'New Folder');
    if (name) {
      await containerFileSystemService.createDirectory(desktopPath, name);
      refreshDesktop();
    }
  };

  const handleNewFile = async () => {
    const name = prompt('File name:', 'New Text Document.txt');
    if (name) {
      await containerFileSystemService.createFile(desktopPath, name, '');
      refreshDesktop();
    }
  };

  const handleFileOpen = (item: any) => {
    if (item.type === 'folder') {
      const explorerWindow = createFileExplorerWindow(item.path);
      openWindow(explorerWindow.id, explorerWindow.title, explorerWindow.content, explorerWindow.icon, explorerWindow.size);
    } else {
      const ext = item.name.split('.').pop()?.toLowerCase();
      if (['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css'].includes(ext || '')) {
        const editorWindow = createTextEditorWindow(item.path);
        openWindow(editorWindow.id, editorWindow.title, editorWindow.content, editorWindow.icon, editorWindow.size);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  const handleAppLaunch = (appId: string) => {
    console.log('Launching app:', appId);
    switch (appId) {
      case 'xeno-explorer':
        const explorerWindow = createFileExplorerWindow();
        openWindow(explorerWindow.id, explorerWindow.title, explorerWindow.content, explorerWindow.icon, explorerWindow.size);
        break;
      case 'terminal':
        const terminalWindow = createTerminalWindow();
        openWindow(terminalWindow.id, terminalWindow.title, terminalWindow.content, terminalWindow.icon, terminalWindow.size);
        break;
      case 'settings':
        const settingsWindow = createSettingsWindow();
        openWindow(settingsWindow.id, settingsWindow.title, settingsWindow.content, settingsWindow.icon, settingsWindow.size);
        break;
      case 'websocket-demo':
        const websocketWindow = createWebSocketDemoWindow();
        openWindow(websocketWindow.id, websocketWindow.title, websocketWindow.content, websocketWindow.icon, websocketWindow.size);
        break;
      case 'text-editor':
        const editorWindow = createTextEditorWindow();
        openWindow(editorWindow.id, editorWindow.title, editorWindow.content, editorWindow.icon, editorWindow.size);
        break;
      case 'task-manager':
        const taskWindow = createTaskManagerWindow();
        openWindow(taskWindow.id, taskWindow.title, taskWindow.content, taskWindow.icon, taskWindow.size);
        break;
      default:
        console.warn('Unknown app ID:', appId);
    }
    setIsStartMenuOpen(false);
  };

  // Grid utility functions
  const snapToGrid = (x: number, y: number) => {
    const gridX = Math.round(x / gridSize) * gridSize;
    const gridY = Math.round(y / gridSize) * gridSize;
    return {
      x: gridX + 8, // 8px padding from edge
      y: gridY + 8  // 8px padding from edge
    };
  };

  const getGridCenter = (gridX: number, gridY: number) => {
    return {
      x: gridX + 8, // 8px padding from edge
      y: gridY + 8  // 8px padding from edge
    };
  };

  const getIconPosition = (gridCol: number, gridRow: number) => {
    const gridX = gridCol * gridSize;
    const gridY = gridRow * gridSize;
    return getGridCenter(gridX, gridY);
  };

  const handleIconDragStart = (iconId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setDraggedIcon(iconId);

    const icon = icons.find(i => i.id === iconId);
    if (icon) {
      setDragOffset({
        x: event.clientX - icon.position.x,
        y: event.clientY - icon.position.y
      });
    }
  };

  const handleIconDrag = React.useCallback((event: MouseEvent) => {
    if (!draggedIcon) return;

    const newX = event.clientX - dragOffset.x;
    const newY = event.clientY - dragOffset.y;

    // Update icon position in real-time during drag
    setIcons(prevIcons =>
      prevIcons.map(icon =>
        icon.id === draggedIcon
          ? { ...icon, position: { x: newX, y: newY } }
          : icon
      )
    );
  }, [draggedIcon, dragOffset]);

  const handleIconDragEnd = React.useCallback(() => {
    if (!draggedIcon) return;

    // Snap to grid on drop
    setIcons(prevIcons =>
      prevIcons.map(icon => {
        if (icon.id === draggedIcon) {
          const newPos = snapToGrid(icon.position.x, icon.position.y);
          // Save position persistence
          const storageKey = icon.path ? `icon_pos_${icon.path}` : `icon_pos_${icon.id}`;
          localStorage.setItem(storageKey, JSON.stringify(newPos));
          return { ...icon, position: newPos };
        }
        return icon;
      })
    );

    setDraggedIcon(null);
    setDragOffset({ x: 0, y: 0 });
  }, [draggedIcon]);

  // Set up drag event listeners
  React.useEffect(() => {
    if (draggedIcon) {
      document.addEventListener('mousemove', handleIconDrag);
      document.addEventListener('mouseup', handleIconDragEnd);

      return () => {
        document.removeEventListener('mousemove', handleIconDrag);
        document.removeEventListener('mouseup', handleIconDragEnd);
      };
    }
  }, [draggedIcon, handleIconDrag, handleIconDragEnd]);

  const createIcon = React.useCallback((id: string, name: string, IconComponent: any, type: 'folder' | 'file' | 'app', position: { x: number; y: number }) => {
    return {
      id,
      name,
      icon: <IconComponent size={actualIconSize} />,
      type,
      position,
      onOpen: () => handleAppLaunch(id)
    };
  }, [actualIconSize]);

  // Auto-arrange function for initial layout
  const getAutoArrangedPosition = (index: number, gridSize: number) => {
    const viewportHeight = window.innerHeight;
    const maxRows = Math.max(3, Math.floor(viewportHeight / (gridSize + 20)));
    
    // Fill columns top-to-bottom, then left-to-right
    const row = index % maxRows;
    const col = Math.floor(index / maxRows);

    // Calculate grid position directly
    const gridX = col * gridSize;
    const gridY = row * gridSize;
    return {
      x: gridX + 8, // 8px padding from edge
      y: gridY + 8  // 8px padding from edge
    };
  };

  const [icons, setIcons] = React.useState<DesktopIconData[]>([]);

  // Marquee selection handlers
  const handleMouseDown = (event: React.MouseEvent) => {
    // Only start selection if clicking on empty desktop area (not on icons)
    if (event.target === event.currentTarget) {
      event.preventDefault();
      setIsSelecting(true);
      setSelectedIcons(new Set());

      const rect = desktopRef.current?.getBoundingClientRect();
      if (rect) {
        const startX = event.clientX - rect.left;
        const startY = event.clientY - rect.top;

        setSelectionStart({ x: startX, y: startY });
        setSelectionBox({ x: startX, y: startY, width: 0, height: 0 });
      }

      setSelectedIcon(null);
      setContextMenu(null);
    }
  };

  const handleMouseMove = React.useCallback((event: MouseEvent) => {
    if (!isSelecting || !desktopRef.current) return;

    const rect = desktopRef.current.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    const left = Math.min(selectionStart.x, currentX);
    const top = Math.min(selectionStart.y, currentY);
    const width = Math.abs(currentX - selectionStart.x);
    const height = Math.abs(currentY - selectionStart.y);

    setSelectionBox({ x: left, y: top, width, height });

    // Check which icons intersect with selection box
    const newSelectedIcons = new Set<string>();
    icons.forEach(icon => {
      const iconLeft = icon.position.x;
      const iconTop = icon.position.y;
      const iconRight = iconLeft + gridSize;
      const iconBottom = iconTop + gridSize;

      const selectionRight = left + width;
      const selectionBottom = top + height;

      // Check if selection box intersects with icon
      if (left < iconRight && selectionRight > iconLeft &&
          top < iconBottom && selectionBottom > iconTop) {
        newSelectedIcons.add(icon.id);
      }
    });

    setSelectedIcons(newSelectedIcons);
  }, [isSelecting, selectionStart, icons, gridSize]);

  const handleMouseUp = React.useCallback(() => {
    if (!isSelecting) return;

    setIsSelecting(false);
    setSelectionBox({ x: 0, y: 0, width: 0, height: 0 });
  }, [isSelecting]);

  // Set up global mouse event listeners for marquee selection
  React.useEffect(() => {
    if (isSelecting) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isSelecting, handleMouseMove, handleMouseUp]);

  const handleDesktopClick = (event: React.MouseEvent) => {
    // Only clear selection if clicking on empty desktop area
    if (event.target === event.currentTarget) {
      setSelectedIcon(null);
      setSelectedIcons(new Set());
      setContextMenu(null);
    }
  };

  const handleDesktopContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setSelectedIcon(null);
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const handleIconSelect = (iconId: string, event?: React.MouseEvent) => {
    if (event?.ctrlKey || event?.metaKey) {
      // Multi-select with Ctrl/Cmd
      const newSelected = new Set(selectedIcons);
      if (newSelected.has(iconId)) {
        newSelected.delete(iconId);
      } else {
        newSelected.add(iconId);
      }
      setSelectedIcons(newSelected);
    } else {
      // Single select
      setSelectedIcon(iconId);
      setSelectedIcons(new Set([iconId]));
    }
  };

  // Auto-arrange function
  const autoArrangeIcons = () => {
    setIcons(prevIcons => {
      // Calculate optimal columns based on viewport width and current grid size
      const viewportHeight = window.innerHeight;
      const maxRows = Math.max(3, Math.floor(viewportHeight / (gridSize + 20)));

      return prevIcons.map((icon, index) => {
        // Calculate new position in auto-arranged grid
        const row = index % maxRows;
        const col = Math.floor(index / maxRows);

        // Calculate grid position with current grid size
        const gridX = col * gridSize;
        const gridY = row * gridSize;
        const newPosition = {
          x: gridX + 8, // 8px padding from edge
          y: gridY + 8  // 8px padding from edge
        };
        
        // Save new position
        const storageKey = icon.path ? `icon_pos_${icon.path}` : `icon_pos_${icon.id}`;
        localStorage.setItem(storageKey, JSON.stringify(newPosition));

        return {
          ...icon,
          position: newPosition
        };
      });
    });
  };

  const handleIconSizeChange = (size: IconSize) => {
    setIconSize(size);
    setContextMenu(null);

    // Get new grid configuration
    const newGridConfig = getGridConfig(size);
    const newGridSize = newGridConfig.gridSize;

    // Auto-arrange icons in optimal grid layout
    setIcons(prevIcons => {
      // Calculate optimal columns based on viewport width and grid size
      const viewportHeight = window.innerHeight;
      const maxRows = Math.max(3, Math.floor(viewportHeight / (newGridSize + 20)));

      return prevIcons.map((icon, index) => {
        // Calculate new position in auto-arranged grid
        const row = index % maxRows;
        const col = Math.floor(index / maxRows);

        // Calculate grid position with new grid size
        const gridX = col * newGridSize;
        const gridY = row * newGridSize;
        const newPosition = {
          x: gridX + 8, // 8px padding from edge
          y: gridY + 8  // 8px padding from edge
        };

        return {
          ...icon,
          icon: React.cloneElement(icon.icon as React.ReactElement, { size: newGridConfig.iconSize }),
          position: newPosition
        };
      });
    });
  };

  const contextValue = {
    selectedIcon,
    setSelectedIcon,
    icons,
    setIcons,
    iconSize,
    setIconSize: handleIconSizeChange
  };

  return (
    <DesktopContext.Provider value={contextValue}>
      <div
        ref={desktopRef}
        className="relative w-full h-full overflow-hidden select-none"
        style={{
          background: `
            radial-gradient(ellipse at top left, rgba(255, 255, 255, 0.05) 0%, transparent 50%),
            radial-gradient(ellipse at top right, rgba(255, 255, 255, 0.03) 0%, transparent 50%),
            radial-gradient(ellipse at bottom left, rgba(255, 255, 255, 0.02) 0%, transparent 50%),
            linear-gradient(135deg, rgba(10, 15, 25, 1) 0%, rgba(20, 25, 35, 1) 100%)
          `,
          backgroundAttachment: 'fixed'
        }}
        onClick={handleDesktopClick}
        onMouseDown={handleMouseDown}
        onContextMenu={handleDesktopContextMenu}
      >
        {/* Desktop Icons */}
        {icons.map((icon) => (
          <DesktopIcon
            key={icon.id}
            icon={icon}
            isSelected={selectedIcon === icon.id || selectedIcons.has(icon.id)}
            onSelect={(event) => handleIconSelect(icon.id, event)}
            onOpen={icon.onOpen}
            onDragStart={(event) => handleIconDragStart(icon.id, event)}
            isDragging={draggedIcon === icon.id}
            gridSize={gridSize}
          />
        ))}

        {/* Marquee Selection Box */}
        {isSelecting && (
          <div
            className="absolute pointer-events-none border border-blue-500 bg-blue-500/20 z-50"
            style={{
              left: selectionBox.x,
              top: selectionBox.y,
              width: selectionBox.width,
              height: selectionBox.height,
            }}
          />
        )}

        {/* Desktop Grid (dynamic square grid) */}
        <div
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)
            `,
            backgroundSize: `${gridSize}px ${gridSize}px`
          }}
        />

        {/* Welcome Message */}
        <div className="absolute bottom-12 right-4 text-white/20 text-4xl font-bold select-none pointer-events-none">
          XENO OS
        </div>

        {/* Desktop Context Menu */}
        {contextMenu && (
          <DesktopContextMenu
            position={contextMenu}
            onClose={() => setContextMenu(null)}
            onIconSizeChange={handleIconSizeChange}
            onAutoArrange={autoArrangeIcons}
            onRefresh={refreshDesktop}
            onNewFolder={handleNewFolder}
            onNewFile={handleNewFile}
            currentIconSize={iconSize}
          />
        )}

        {/* Windows-like Taskbar */}
        <DesktopTaskbar
          onStartMenuClick={() => setIsStartMenuOpen(!isStartMenuOpen)}
          onSearchClick={() => {
            // TODO: Implement search
            console.log('Search clicked');
          }}
          onSettingsClick={() => {
            handleAppLaunch('settings');
          }}
        />

        {/* Start Menu */}
        <StartMenu 
          isOpen={isStartMenuOpen} 
          onClose={() => setIsStartMenuOpen(false)} 
          onLogout={handleLogout}
          onLaunchApp={handleAppLaunch}
        />
      </div>
    </DesktopContext.Provider>
  );
};

export default Desktop;

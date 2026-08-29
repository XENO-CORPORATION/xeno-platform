import * as React from 'react';
import {
  Folder,
  FileText,
  Image,
  Video,
  Music,
  Archive,
  HardDrive,
  ChevronRight,
  ChevronLeft,
  ArrowUp,
  ArrowDown,
  Search,
  RefreshCw,
  Home,
  ArrowLeft,
  ArrowRight,
  Star,
  Monitor,
  Network,
  ChevronDown,
  Copy,
  Scissors,
  ClipboardPaste,
  Trash2,
  Edit,
  Plus,
  FolderPlus,
  FilePlus,
  Download,
  ExternalLink,
  Settings,
  CheckSquare,
  Square,
  RotateCcw,
  Users,
  UserPlus,
  Wifi,
  WifiOff,
  Shield,
  ShieldCheck,
  Crown,
  Clock,
  Share2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
  Lock,
  Unlock
} from 'lucide-react';
import { fileSystemService } from '../../../services/fileSystemService';
import { containerFileSystemService, ContainerFileSystemItem } from '../../../services/containerFileSystemService';
import { ContainerService } from '../../../services/containerService';
import { useAuth } from '../../../contexts/AuthContext';
import { useContainer } from '../../../contexts/ContainerContext';
import { useCollaboration } from '../../../contexts/CollaborationContext';
import { useWindowManager, createTextEditorWindow } from './WindowManager';

export interface FileSystemItem {
  id: string;
  name: string;
  type: 'folder' | 'file';
  path: string;
  size?: number;
  modified?: Date;
  icon: React.ReactNode;
  children?: FileSystemItem[];
}

export interface NetworkDevice {
  id: string;
  name: string;
  ip: string;
  status: 'online' | 'offline';
  type: 'computer' | 'server' | 'mobile' | 'storage';
  lastSeen: Date;
  permissions: ('read' | 'write' | 'admin')[];
}

export interface ShareInvitation {
  id: string;
  from: string;
  email: string;
  resource: string;
  permissions: ('read' | 'write' | 'admin')[];
  status: 'pending' | 'accepted' | 'rejected';
  timestamp: Date;
}

export interface SharedResource {
  id: string;
  name: string;
  type: 'file' | 'folder';
  owner: string;
  permissions: ('read' | 'write' | 'admin')[];
  size?: number;
  modified: Date;
  accessCount: number;
  icon: React.ReactNode;
}

export interface RecentFile {
  id: string;
  name: string;
  type: 'file' | 'folder';
  path: string;
  size?: number;
  modified: Date;
  accessed: Date;
  icon: React.ReactNode;
}

export type ExplorerTab = 'local' | 'network' | 'shared' | 'recent';

// Menu item type definitions
export interface MenuItem {
  action?: string;
  label?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  type?: 'separator';
  submenu?: SubMenuItem[];
}

export interface SubMenuItem {
  action: string;
  label: string;
  checked?: boolean;
}


interface FileExplorerProps {
  onItemDoubleClick?: (item: FileSystemItem) => void;
  onTabPathUpdate?: (tabId: string, path: string) => void;
  activeTabId?: string;
  initialPath?: string;
}

const FileExplorer: React.FC<FileExplorerProps> = ({
  onItemDoubleClick,
  onTabPathUpdate,
  activeTabId,
  initialPath = '/home/user'
}) => {
  // Authentication
  const { user, isAuthenticated } = useAuth();

  // Container context - provides preloaded data
  const {
    container,
    fileSystem: contextFileSystem,
    currentPath,
    storageData,
    quickAccessItems,
    thisContainerItems,
    isLoading: contextLoading,
    refreshFileSystem,
    navigateToPath,
    createFile,
    deleteFile
  } = useContainer();

  const { openWindow } = useWindowManager();

  // Collaboration context for real-time sync
  const { session, broadcastFileOperation, lastFileOperation } = useCollaboration();

  // Single tab state (tabs are now handled at window level)
  // currentPath now comes from ContainerContext
  const [selectedItem, setSelectedItem] = React.useState<string | null>(null);
  const [selectedItems, setSelectedItems] = React.useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = React.useState('');
  const [history, setHistory] = React.useState<string[]>([initialPath]);
  const [historyIndex, setHistoryIndex] = React.useState(0);

  // Marquee selection state
  const [isSelecting, setIsSelecting] = React.useState(false);
  const [selectionBox, setSelectionBox] = React.useState({ x: 0, y: 0, width: 0, height: 0 });
  const [selectionStart, setSelectionStart] = React.useState({ x: 0, y: 0 });
  const fileListRef = React.useRef<HTMLDivElement>(null);

  // Network tab state - shows network machines/containers
  const [networkDevices, setNetworkDevices] = React.useState<NetworkDevice[]>([]);
  const [selectedNetworkDevice, setSelectedNetworkDevice] = React.useState<string | null>(null);
  const [networkDeviceContents, setNetworkDeviceContents] = React.useState<FileSystemItem[]>([]);
  const [networkSortColumn, setNetworkSortColumn] = React.useState<'name' | 'size' | 'modified' | 'type'>('name');
  const [networkSortDirection, setNetworkSortDirection] = React.useState<'asc' | 'desc'>('asc');

  // Shared tab state
  const [sharedResources, setSharedResources] = React.useState<SharedResource[]>([]);
  const [sharedSortColumn, setSharedSortColumn] = React.useState<'name' | 'size' | 'modified' | 'type'>('name');
  const [sharedSortDirection, setSharedSortDirection] = React.useState<'asc' | 'desc'>('asc');
  const [sharedViewType, setSharedViewType] = React.useState<'with-me' | 'by-me'>('with-me');

  // Shared by me data (files/folders I've shared)
  const [sharedByMeResources, setSharedByMeResources] = React.useState<SharedResource[]>([]);

  // Recent tab state
  const [recentFiles, setRecentFiles] = React.useState<RecentFile[]>([]);
  const [recentSortColumn, setRecentSortColumn] = React.useState<'name' | 'size' | 'modified' | 'type'>('modified');
  const [recentSortDirection, setRecentSortDirection] = React.useState<'asc' | 'desc'>('desc');

  // QuickAccess data now comes from ContainerContext

  // Storage and container data now comes from ContainerContext

  // File system data now comes from ContainerContext - no need for individual loading

  // Collaboration: Handle file operations from other users (real-time sync)
  React.useEffect(() => {
    if (!lastFileOperation) return;

    // Refresh the current directory when another user modifies files
    console.log('📁 File operation from collaborator:', lastFileOperation);
    refreshFileSystem(currentPath);
  }, [lastFileOperation, refreshFileSystem, currentPath]);

  // Navigation now uses ContainerContext
  const loadContainerDirectory = React.useCallback(async (path: string) => {
    try {
      console.log('📁 Navigating to:', path);
      await navigateToPath(path);

      // Update history if not just refreshing current path
      setHistory(prev => {
        if (prev[prev.length - 1] !== path) {
          return [...prev, path];
        }
        return prev;
      });
    } catch (error) {
      console.error('❌ Navigation error:', error);
    }
  }, [navigateToPath]);

  // File operations now use ContainerContext

  // File creation now uses ContainerContext methods



  // Update path when initialPath changes (for tab switching)
  // Only if it's a significant change and not just the default
  React.useEffect(() => {
    if (initialPath !== currentPath && initialPath !== '/home' && initialPath !== '/home/user') {
      navigateToPath(initialPath);
      setHistory([initialPath]);
      setHistoryIndex(0);
      setSelectedItem(null);
    }
  }, [initialPath, currentPath]);

  // Initialize mock data (file system data comes from ContainerContext)
  React.useEffect(() => {
    // Initialize network devices for network browsing (keeping mock for now)
    setNetworkDevices(mockNetworkDevices);
    setSharedResources(mockSharedResources);
    setSharedByMeResources(mockSharedByMeResources);
    setRecentFiles(mockRecentFiles);
  }, []);

  // Sidebar state
  const [isSidebarExpanded, setIsSidebarExpanded] = React.useState(true);
  const [sidebarWidth, setSidebarWidth] = React.useState(200); // Default width in pixels (minimum)
  const [isResizing, setIsResizing] = React.useState(false);
  const [dragStart, setDragStart] = React.useState({ x: 0, width: 0 });
  const [expandedSections, setExpandedSections] = React.useState({
    quickAccess: false,
    thisLab: false,
    network: false,
    shared: false,
    recent: false
  });

  // Active view state
  const [activeView, setActiveView] = React.useState<'local' | 'network' | 'shared' | 'recent' | 'this-container'>('local');

  // Selected sidebar item state
  const [selectedSidebarItem, setSelectedSidebarItem] = React.useState<string | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = React.useState<{
    visible: boolean;
    x: number;
    y: number;
    selectedItems: FileSystemItem[];
    contextType: 'file' | 'folder' | 'empty';
    area: 'local' | 'network' | 'shared' | 'recent' | 'desktop';
    sharedType?: 'with-me' | 'by-me';
  } | null>(null);

  // Ref for FileExplorer container to calculate relative positions
  const fileExplorerRef = React.useRef<HTMLDivElement>(null);

  // Clipboard state
  const [clipboard, setClipboard] = React.useState<{
    items: FileSystemItem[];
    operation: 'copy' | 'cut';
  } | null>(null);

  // View and sort state
  const [sortBy, setSortBy] = React.useState<'name' | 'date' | 'size' | 'type'>('name');
  const [sortOrder, setSortOrder] = React.useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = React.useState<'details' | 'large' | 'medium' | 'small'>('details');

  // Inline editing state for new items
  const [editingItem, setEditingItem] = React.useState<{
    id: string;
    type: 'folder' | 'file';
    isNew: boolean;
  } | null>(null);

  // Temporary items for new folder/file creation
  const [tempItems, setTempItems] = React.useState<FileSystemItem[]>([]);

  // Column widths state
  const [columnWidths, setColumnWidths] = React.useState({
    name: 300,     // Default name column width
    size: 64,      // w-16 = 64px
    modified: 128, // w-32 = 128px
    type: 64       // w-16 = 64px
  });

  // Column resize state
  const [resizingColumn, setResizingColumn] = React.useState<string | null>(null);
  const [resizeStartX, setResizeStartX] = React.useState(0);
  const [resizeStartWidth, setResizeStartWidth] = React.useState(0);

  // Sidebar data - now uses preloaded context data
  const sidebarData = {
    quickAccess: quickAccessItems,
    thisLab: thisContainerItems,
    network: [
      { id: 'network', name: 'Network', view: 'network', icon: <Network size={16} /> }
    ],
    shared: [
      { id: 'shared-with-me', name: 'With me', view: 'shared', sharedType: 'with-me', icon: <Share2 size={16} /> },
      { id: 'shared-by-me', name: 'By me', view: 'shared', sharedType: 'by-me', icon: <Share2 size={16} /> }
    ],
    recent: [
      { id: 'recent-files', name: 'Recent Files', view: 'recent', icon: <Clock size={16} /> }
    ]
  };
  
  // Mock network devices data
  const mockNetworkDevices: NetworkDevice[] = [
    {
      id: 'dev-1',
      name: 'Alice\'s Workstation',
      ip: '192.168.1.101',
      status: 'online',
      type: 'computer',
      lastSeen: new Date(),
      permissions: ['read', 'write']
    },
    {
      id: 'dev-2',
      name: 'Bob\'s Server',
      ip: '192.168.1.102',
      status: 'online',
      type: 'server',
      lastSeen: new Date(Date.now() - 300000), // 5 minutes ago
      permissions: ['read']
    },
    {
      id: 'dev-3',
      name: 'Charlie\'s Mobile',
      ip: '192.168.1.103',
      status: 'offline',
      type: 'mobile',
      lastSeen: new Date(Date.now() - 3600000), // 1 hour ago
      permissions: ['read']
    }
  ];
  
  // Mock share invitations data
  const mockShareInvitations: ShareInvitation[] = [
    {
      id: 'inv-1',
      from: 'alice@example.com',
      email: 'alice@example.com',
      resource: 'Project Documents',
      permissions: ['read', 'write'],
      status: 'pending',
      timestamp: new Date(Date.now() - 86400000) // 1 day ago
    }
  ];
  
  // Mock shared resources data
  const mockSharedResources: SharedResource[] = [
    {
      id: 'shared-1',
      name: 'Q4 Report.pdf',
      type: 'file',
      owner: 'alice@example.com',
      permissions: ['read'],
      size: 2048576,
      modified: new Date('2024-01-15'),
      accessCount: 12,
      icon: <FileText size={16} />
    },
    {
      id: 'shared-2',
      name: 'Project Assets',
      type: 'folder',
      owner: 'bob@example.com',
      permissions: ['read', 'write'],
      modified: new Date('2024-01-20'),
      accessCount: 8,
      icon: <Folder size={16} />
    },
    {
      id: 'shared-3',
      name: 'Meeting Notes.txt',
      type: 'file',
      owner: 'charlie@example.com',
      permissions: ['read', 'write', 'admin'],
      size: 1024,
      modified: new Date('2024-01-18'),
      accessCount: 5,
      icon: <FileText size={16} />
    },
    {
      id: 'shared-4',
      name: 'Design Files',
      type: 'folder',
      owner: 'alice@example.com',
      permissions: ['read'],
      modified: new Date('2024-01-12'),
      accessCount: 15,
      icon: <Folder size={16} />
    },
    {
      id: 'shared-5',
      name: 'Backup Archive.zip',
      type: 'file',
      owner: 'bob@example.com',
      permissions: ['read', 'write'],
      size: 10485760,
      modified: new Date('2024-01-10'),
      accessCount: 3,
      icon: <Archive size={16} />
    }
  ];

  // Mock shared by me resources data (files I've shared with others)
  const mockSharedByMeResources: SharedResource[] = [
    {
      id: 'shared-by-me-1',
      name: 'Project Documentation.pdf',
      type: 'file',
      owner: 'me', // I am the owner
      permissions: ['read', 'write'], // Permissions I've granted
      size: 2097152,
      modified: new Date('2024-01-18'),
      accessCount: 5,
      icon: <FileText size={16} />
    },
    {
      id: 'shared-by-me-2',
      name: 'Team Assets',
      type: 'folder',
      owner: 'me',
      permissions: ['read'],
      modified: new Date('2024-01-16'),
      accessCount: 12,
      icon: <Folder size={16} />
    },
    {
      id: 'shared-by-me-3',
      name: 'Meeting Notes.docx',
      type: 'file',
      owner: 'me',
      permissions: ['read', 'write', 'admin'],
      size: 512000,
      modified: new Date('2024-01-14'),
      accessCount: 8,
      icon: <FileText size={16} />
    },
    {
      id: 'shared-by-me-4',
      name: 'Code Repository',
      type: 'folder',
      owner: 'me',
      permissions: ['read'],
      modified: new Date('2024-01-12'),
      accessCount: 15,
      icon: <Folder size={16} />
    },
    {
      id: 'shared-by-me-5',
      name: 'Presentation Slides.pptx',
      type: 'file',
      owner: 'me',
      permissions: ['read', 'write'],
      size: 8388608,
      modified: new Date('2024-01-10'),
      accessCount: 6,
      icon: <FileText size={16} />
    }
  ];

  // Mock recent files data
  const mockRecentFiles: RecentFile[] = [
    {
      id: 'recent-1',
      name: 'presentation.pptx',
      type: 'file',
      path: '/home/Documents/presentations/presentation.pptx',
      size: 5242880,
      modified: new Date('2024-01-20'),
      accessed: new Date('2024-01-20T10:30:00'),
      icon: <FileText size={16} />
    },
    {
      id: 'recent-2',
      name: 'budget.xlsx',
      type: 'file',
      path: '/home/Documents/finance/budget.xlsx',
      size: 1024000,
      modified: new Date('2024-01-19'),
      accessed: new Date('2024-01-19T15:45:00'),
      icon: <FileText size={16} />
    },
    {
      id: 'recent-3',
      name: 'Project Photos',
      type: 'folder',
      path: '/home/Pictures/Project Photos',
      modified: new Date('2024-01-18'),
      accessed: new Date('2024-01-18T09:15:00'),
      icon: <Folder size={16} />
    },
    {
      id: 'recent-4',
      name: 'meeting_notes.txt',
      type: 'file',
      path: '/home/Documents/meeting_notes.txt',
      size: 2048,
      modified: new Date('2024-01-17'),
      accessed: new Date('2024-01-17T14:20:00'),
      icon: <FileText size={16} />
    },
    {
      id: 'recent-5',
      name: 'report.pdf',
      type: 'file',
      path: '/home/Documents/reports/report.pdf',
      size: 1572864,
      modified: new Date('2024-01-16'),
      accessed: new Date('2024-01-16T11:00:00'),
      icon: <FileText size={16} />
    },
    {
      id: 'recent-6',
      name: 'Music',
      type: 'folder',
      path: '/home/Music',
      modified: new Date('2024-01-15'),
      accessed: new Date('2024-01-15T20:30:00'),
      icon: <Folder size={16} />
    },
    {
      id: 'recent-7',
      name: 'video.mp4',
      type: 'file',
      path: '/home/Videos/video.mp4',
      size: 104857600,
      modified: new Date('2024-01-14'),
      accessed: new Date('2024-01-14T16:45:00'),
      icon: <Video size={16} />
    },
    {
      id: 'recent-8',
      name: 'song.mp3',
      type: 'file',
      path: '/home/Music/song.mp3',
      size: 5242880,
      modified: new Date('2024-01-13'),
      accessed: new Date('2024-01-13T08:15:00'),
      icon: <Music size={16} />
    }
  ];

  // Sidebar functions
  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Function to navigate to This Container view (like Windows 11 "This PC")
  const navigateToThisContainer = () => {
    console.log('🖥️ Navigating to This Container view');
    setSelectedSidebarItem('this-container');
    setActiveView('this-container');
    // currentPath is now managed by ContainerContext
  };

  const navigateFromSidebar = (item: any) => {
    // Set the selected sidebar item
    setSelectedSidebarItem(item.id);

    if (item.path) {
      // Traditional folder navigation
      const pathTitle = item.path === '/home' ? 'Home' : item.path.split('/').filter(Boolean).pop() || 'Home';
      handleNavigateToPath(item.path, pathTitle);
      setActiveView('local');
    } else if (item.view) {
      // View navigation (Network, Shared, Recent)
      setActiveView(item.view);

      // Handle shared view type selection
      if (item.view === 'shared' && item.sharedType) {
        setSharedViewType(item.sharedType);
      }
    }
  };

  // Context menu handlers
  const handleRightClick = React.useCallback((event: React.MouseEvent, item?: FileSystemItem, area: 'local' | 'network' | 'shared' | 'recent' | 'desktop' = 'local', sharedType?: 'with-me' | 'by-me') => {
    event.preventDefault();
    event.stopPropagation();

    // Select the item that was right-clicked
    if (item) {
      setSelectedItem(item.id);
    }

    const selectedItems = item ? [item] : [];
    const contextType = item ? item.type : 'empty';

    // Calculate position relative to FileExplorer container
    let x = event.clientX;
    let y = event.clientY;

    if (fileExplorerRef.current) {
      const containerRect = fileExplorerRef.current.getBoundingClientRect();
      x = event.clientX - containerRect.left;
      y = event.clientY - containerRect.top;
    }

    setContextMenu({
      visible: true,
      x,
      y,
      selectedItems,
      contextType,
      area,
      sharedType
    });
  }, []);

  // Item interaction handlers
  const handleItemDoubleClick = (event: React.MouseEvent, item: FileSystemItem) => {
    if (item.type === 'folder') {
      handleNavigateToPath(item.path, item.name);
    } else {
      // Handle file opening
      console.log('Opening file:', item.name);
      
      const ext = item.name.split('.').pop()?.toLowerCase();
      if (['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css', 'env', 'log', 'yml', 'yaml'].includes(ext || '')) {
        const editorWindow = createTextEditorWindow(item.path);
        openWindow(editorWindow.id, editorWindow.title, editorWindow.content, editorWindow.icon, editorWindow.size);
      } else {
        onItemDoubleClick?.(item);
      }
    }
  };

  // Inline editing handlers
  const handleCancelEdit = React.useCallback((itemId: string) => {
    // Remove from temporary items
    setTempItems(prev => prev.filter(item => item.id !== itemId));
    setEditingItem(null);
  }, []);

  const handleSaveEdit = React.useCallback(async (itemId: string, newName: string) => {
    if (!editingItem || !editingItem.isNew) return;

    if (newName.trim()) {
      try {
        if (editingItem.type === 'folder') {
          // Create folder in container filesystem
          console.log('📁 Creating folder:', newName, 'in', currentPath);
          const result = await containerFileSystemService.createDirectory(currentPath, newName);

          if (result.success) {
            console.log('✅ Folder created successfully');
            // Use ContainerContext refresh instead of double refresh
            await refreshFileSystem(currentPath);

            // Broadcast to collaborators for real-time sync
            if (session) {
              broadcastFileOperation({
                odea: '',
                displayName: '',
                operation: 'create',
                path: `${currentPath}/${newName}`,
                itemType: 'folder',
                timestamp: new Date().toISOString()
              });
            }

            // Remove from temporary items
            setTempItems(prev => prev.filter(item => item.id !== itemId));
            setEditingItem(null);
          } else {
            console.error('❌ Failed to create folder:', result.error);
            alert(`Failed to create folder: ${result.error}`);
          }
        } else {
          // Create file in container filesystem
          console.log('📄 Creating file:', newName, 'in', currentPath);
          const result = await containerFileSystemService.createFile(currentPath, newName, '');

          if (result.success) {
            console.log('✅ File created successfully');
            // Use ContainerContext refresh instead of navigation
            await refreshFileSystem(currentPath);

            // Broadcast to collaborators for real-time sync
            if (session) {
              broadcastFileOperation({
                odea: '',
                displayName: '',
                operation: 'create',
                path: `${currentPath}/${newName}`,
                itemType: 'file',
                timestamp: new Date().toISOString()
              });
            }

            // Remove from temporary items
            setTempItems(prev => prev.filter(item => item.id !== itemId));
            setEditingItem(null);
          } else {
            console.error('❌ Failed to create file:', result.error);
            alert(`Failed to create file: ${result.error}`);
          }
        }
      } catch (error) {
        console.error('❌ Error creating item:', error);
        alert(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else {
      // If name is empty, cancel
      handleCancelEdit(itemId);
    }
  }, [editingItem, currentPath, handleCancelEdit, loadContainerDirectory]);

  const handleContextMenuAction = React.useCallback((action: string) => {
    if (!contextMenu) return;

    const { selectedItems, contextType } = contextMenu;
    const selectedItem = selectedItems[0];

    switch (action) {
      case 'open':
        if (selectedItem) {
          handleItemDoubleClick({} as React.MouseEvent, selectedItem);
        }
        break;

      case 'copy':
        if (selectedItems.length > 0) {
          setClipboard({ items: [...selectedItems], operation: 'copy' });
        }
        break;

      case 'cut':
        if (selectedItems.length > 0) {
          setClipboard({ items: [...selectedItems], operation: 'cut' });
        }
        break;

      case 'paste':
        if (clipboard && clipboard.items.length > 0) {
          // For now, just clear clipboard after paste
          console.log('Pasting items:', clipboard.items);
          setClipboard(null);
        }
        break;

      case 'delete':
        const itemsToDelete = selectedItems.length > 0 ? selectedItems : (selectedItem ? [selectedItem] : []);
        if (itemsToDelete.length > 0) {
          // Get all current items (context + temp)
          const currentAllItems = [...tempItems, ...(contextFileSystem || []).map(item => ({
            id: item.id,
            name: item.name,
            type: item.type,
            path: item.path,
            size: item.size,
            modified: item.modified ? new Date(item.modified) : undefined,
            icon: item.type === 'folder'
              ? <Folder size={16} className="text-blue-500" />
              : item.name.endsWith('.txt')
              ? <FileText size={16} className="text-gray-500" />
              : item.name.match(/\.(jpg|jpeg|png|gif)$/i)
              ? <Image size={16} className="text-green-500" />
              : <FileText size={16} className="text-gray-400" />
          }))];

          const itemNames = itemsToDelete.map(item => item.name);

          if (confirm(`Delete ${itemsToDelete.length} item(s)?\n\n${itemNames.join('\n')}`)) {
            // Delete items from the file system (use async IIFE)
            (async () => {
              for (const item of itemsToDelete) {
                if (item) {
                  try {
                    await deleteFile(item.path);

                    // Broadcast to collaborators for real-time sync
                    if (session) {
                      broadcastFileOperation({
                        odea: '',
                        displayName: '',
                        operation: 'delete',
                        path: item.path,
                        itemType: item.type as 'file' | 'folder',
                        timestamp: new Date().toISOString()
                      });
                    }
                  } catch (error) {
                    console.error(`Failed to delete ${item.name}:`, error);
                  }
                }
              }

              // Clear selection
              setSelectedItems(new Set());
              setSelectedItem(null);

              // Refresh the file system view
              setTimeout(() => refreshFileSystem(), 100);
            })();
          }
        }
        break;

      case 'rename':
        if (selectedItem) {
          const newName = prompt('Enter new name:', selectedItem.name);
          if (newName && newName !== selectedItem.name) {
            console.log('Renaming', selectedItem.name, 'to', newName);
            // TODO: Implement actual rename
          }
        }
        break;

      case 'newFolder':
        // Create temporary folder item for inline editing
        const tempFolderId = `temp-folder-${Date.now()}`;
        const tempFolder: FileSystemItem = {
          id: tempFolderId,
          name: 'New Folder',
          type: 'folder',
          path: `${currentPath}/New Folder`,
          size: 0,
          modified: new Date(),
          icon: <Folder size={16} />
        };

        setTempItems(prev => [tempFolder, ...prev]);
        setEditingItem({
          id: tempFolderId,
          type: 'folder',
          isNew: true
        });
        break;

      case 'newFile':
        // Create temporary file item for inline editing
        const tempFileId = `temp-file-${Date.now()}`;
        const tempFile: FileSystemItem = {
          id: tempFileId,
          name: 'New File.txt',
          type: 'file',
          path: `${currentPath}/New File.txt`,
          size: 0,
          modified: new Date(),
          icon: <FileText size={16} />
        };

        setTempItems(prev => [tempFile, ...prev]);
        setEditingItem({
          id: tempFileId,
          type: 'file',
          isNew: true
        });
        break;

      case 'selectAll':
        // Select all items in current view
        const currentAllItems = [...tempItems, ...(contextFileSystem || []).map(item => ({
          id: item.id,
          name: item.name,
          type: item.type,
          path: item.path,
          size: item.size,
          modified: item.modified ? new Date(item.modified) : undefined,
          icon: null
        }))];
        const allItemIds = new Set(currentAllItems.map(item => item.id));
        setSelectedItems(allItemIds);
        if (currentAllItems.length > 0) {
          setSelectedItem(currentAllItems[0].id);
        }
        break;

      case 'invertSelection':
        console.log('Invert selection');
        break;

      case 'clearSelection':
        setSelectedItems(new Set());
        setSelectedItem(null);
        break;

      case 'properties':
        if (selectedItem) {
          console.log('Properties for:', selectedItem);
          // TODO: Show properties dialog
        }
        break;

      case 'openNewTab':
        if (selectedItem && selectedItem.type === 'folder') {
          // This would need access to window manager
          console.log('Open in new tab:', selectedItem);
        }
        break;

      case 'copyPath':
        if (selectedItem) {
          navigator.clipboard.writeText(selectedItem.path);
          console.log('Copied path to clipboard:', selectedItem.path);
        }
        break;

      case 'sortByName':
        setSortBy('name');
        break;

      case 'sortByDate':
        setSortBy('date');
        break;

      case 'sortBySize':
        setSortBy('size');
        break;

      case 'sortByType':
        setSortBy('type');
        break;
    }

    setContextMenu(null);
  }, [contextMenu, clipboard, currentPath, selectedItem, selectedItems, setSelectedItem, setSelectedItems, handleSaveEdit, handleCancelEdit, setTempItems, setEditingItem, tempItems, contextFileSystem, deleteFile, refreshFileSystem]);

  const closeContextMenu = React.useCallback(() => {
    setContextMenu(null);
  }, []);

  // Marquee selection handlers
  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    // Only start selection on left click in empty space
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    if (target.closest('[data-file-item]')) return;

    const rect = fileListRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setSelectionStart({ x, y });
    setSelectionBox({ x, y, width: 0, height: 0 });
    setIsSelecting(true);

    // Clear existing selection when starting a new drag
    setSelectedItems(new Set());
    setSelectedItem(null);

    e.preventDefault();
  }, []);

  // Remove the local handleMouseMove to avoid duplicate selection updates
  // We only use the global event listener for mouse move during selection

  // Mouse up is handled globally to ensure we catch it even outside the component

  // Column resize handlers
  const handleColumnResizeStart = React.useCallback((e: React.MouseEvent, column: string) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(column);
    setResizeStartX(e.clientX);
    setResizeStartWidth(columnWidths[column as keyof typeof columnWidths]);
  }, [columnWidths]);

  const handleColumnResizeMove = React.useCallback((e: MouseEvent) => {
    if (!resizingColumn) return;

    const diff = e.clientX - resizeStartX;
    const newWidth = Math.max(40, resizeStartWidth + diff); // Minimum 40px width

    setColumnWidths(prev => ({
      ...prev,
      [resizingColumn]: newWidth
    }));
  }, [resizingColumn, resizeStartX, resizeStartWidth]);

  const handleColumnResizeEnd = React.useCallback(() => {
    setResizingColumn(null);
    setResizeStartX(0);
    setResizeStartWidth(0);
  }, []);

  // Global mouse events for column resizing
  React.useEffect(() => {
    if (resizingColumn) {
      const handleMouseMove = (e: MouseEvent) => handleColumnResizeMove(e);
      const handleMouseUp = () => handleColumnResizeEnd();

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [resizingColumn, handleColumnResizeMove, handleColumnResizeEnd]);

  // Global mouse events for marquee selection
  React.useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isSelecting || !fileListRef.current) return;

      const rect = fileListRef.current.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;

      const x = Math.min(selectionStart.x, currentX);
      const y = Math.min(selectionStart.y, currentY);
      const width = Math.abs(currentX - selectionStart.x);
      const height = Math.abs(currentY - selectionStart.y);

      setSelectionBox({ x, y, width, height });

      // Find items that intersect with selection box
      const fileItems = fileListRef.current.querySelectorAll('[data-file-item]');
      const newSelectedItems = new Set<string>();

      fileItems.forEach((item) => {
        const itemRect = item.getBoundingClientRect();
        const itemX = itemRect.left - rect.left;
        const itemY = itemRect.top - rect.top;
        const itemWidth = itemRect.width;
        const itemHeight = itemRect.height;

        // Check if selection box intersects with item
        if (
          x < itemX + itemWidth &&
          x + width > itemX &&
          y < itemY + itemHeight &&
          y + height > itemY
        ) {
          const itemId = item.getAttribute('data-item-id');
          if (itemId) {
            newSelectedItems.add(itemId);
          }
        }
      });

      setSelectedItems(newSelectedItems);
    };

    const handleGlobalMouseUp = () => {
      if (isSelecting) {
        setIsSelecting(false);
        setSelectionBox({ x: 0, y: 0, width: 0, height: 0 });
      }
    };

    if (isSelecting) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isSelecting, selectionStart]);

  // Context menu component
  const ContextMenu = React.memo(({
    visible,
    x,
    y,
    selectedItems,
    contextType,
    area,
    sharedType,
    onAction,
    onClose
  }: {
    visible: boolean;
    x: number;
    y: number;
    selectedItems: FileSystemItem[];
    contextType: 'file' | 'folder' | 'empty';
    area: 'local' | 'network' | 'shared' | 'recent' | 'desktop';
    sharedType?: 'with-me' | 'by-me';
    onAction: (action: string) => void;
    onClose: () => void;
  }) => {
    if (!visible) return null;

    const menuItems: MenuItem[] = [];

    // Area-specific menu items
    switch (area) {
      case 'local':
        // Local file system operations
        if (contextType !== 'empty') {
          menuItems.push(
            { action: 'open', label: 'Open', icon: <Folder size={14} />, shortcut: 'Enter' },
            { type: 'separator' },
            { action: 'copy', label: 'Copy', icon: <Copy size={14} />, shortcut: 'Ctrl+C' },
            { action: 'cut', label: 'Cut', icon: <Scissors size={14} />, shortcut: 'Ctrl+X' },
            { action: 'rename', label: 'Rename', icon: <Edit size={14} />, shortcut: 'F2' },
            { type: 'separator' },
            { action: 'delete', label: 'Delete', icon: <Trash2 size={14} />, shortcut: 'Delete', danger: true },
            { type: 'separator' },
            { action: 'properties', label: 'Properties', icon: <Settings size={14} />, shortcut: 'Alt+Enter' }
          );
        }

        // Paste option (only if clipboard has items)
        if (clipboard && clipboard.items.length > 0) {
          menuItems.unshift({
            action: 'paste',
            label: 'Paste',
            icon: <ClipboardPaste size={14} />,
            shortcut: 'Ctrl+V'
          });
          if (contextType !== 'empty') {
            menuItems.splice(1, 0, { type: 'separator' });
          }
        }

        // New items (for folders and empty space)
        if (contextType === 'folder' || contextType === 'empty') {
          menuItems.unshift(
            { action: 'newFolder', label: 'New Folder', icon: <FolderPlus size={14} />, shortcut: 'Ctrl+Shift+N' },
            { action: 'newFile', label: 'New File', icon: <FilePlus size={14} /> }
          );
          menuItems.splice(2, 0, { type: 'separator' });
        }

        // Folder-specific options
        if (contextType === 'folder') {
          menuItems.splice(-2, 0,
            { action: 'openNewTab', label: 'Open in New Tab', icon: <ExternalLink size={14} /> }
          );
        }

        // Path operations for files/folders
        if (contextType !== 'empty') {
          menuItems.splice(-2, 0,
            { action: 'copyPath', label: 'Copy Path', icon: <Copy size={14} /> }
          );
        }
        break;

      case 'shared':
        // Shared resources operations
        if (contextType !== 'empty') {
          menuItems.push(
            { action: 'open', label: 'Open', icon: <Folder size={14} />, shortcut: 'Enter' },
            { type: 'separator' },
            { action: 'copy', label: 'Copy', icon: <Copy size={14} />, shortcut: 'Ctrl+C' },
            { action: 'download', label: 'Download', icon: <ArrowDown size={14} />, shortcut: 'Ctrl+D' },
            { type: 'separator' },
            { action: 'share', label: 'Share Settings', icon: <Share2 size={14} /> },
            { action: 'properties', label: 'Properties', icon: <Settings size={14} />, shortcut: 'Alt+Enter' }
          );

          // Additional options for "Shared by me"
          if (sharedType === 'by-me') {
            menuItems.splice(-2, 0,
              { action: 'managePermissions', label: 'Manage Permissions', icon: <Users size={14} /> },
              { action: 'revokeAccess', label: 'Revoke Access', icon: <XCircle size={14} />, danger: true }
            );
          }
        }

        // New items (for empty space in shared view)
        if (contextType === 'empty') {
          menuItems.unshift(
            { action: 'uploadFile', label: 'Upload File', icon: <FilePlus size={14} /> },
            { action: 'uploadFolder', label: 'Upload Folder', icon: <FolderPlus size={14} /> },
            { type: 'separator' },
            { action: 'createSharedFolder', label: 'Create Shared Folder', icon: <FolderPlus size={14} />, shortcut: 'Ctrl+Shift+N' }
          );
        }
        break;

      case 'network':
        // Network device operations
        if (contextType !== 'empty') {
          menuItems.push(
            { action: 'connect', label: 'Connect', icon: <Network size={14} />, shortcut: 'Enter' },
            { action: 'disconnect', label: 'Disconnect', icon: <WifiOff size={14} /> },
            { type: 'separator' },
            { action: 'properties', label: 'Properties', icon: <Settings size={14} />, shortcut: 'Alt+Enter' }
          );
        }

        // Network-specific options for empty space
        if (contextType === 'empty') {
          menuItems.unshift(
            { action: 'scanNetwork', label: 'Scan Network', icon: <Search size={14} />, shortcut: 'F5' },
            { action: 'addDevice', label: 'Add Device', icon: <Plus size={14} /> }
          );
        }
        break;

      case 'recent':
        // Recent files operations
        if (contextType !== 'empty') {
          menuItems.push(
            { action: 'open', label: 'Open', icon: <Folder size={14} />, shortcut: 'Enter' },
            { action: 'openLocation', label: 'Open File Location', icon: <ExternalLink size={14} /> },
            { type: 'separator' },
            { action: 'copy', label: 'Copy', icon: <Copy size={14} />, shortcut: 'Ctrl+C' },
            { action: 'properties', label: 'Properties', icon: <Settings size={14} />, shortcut: 'Alt+Enter' }
          );
        }

        // Recent files specific options for empty space
        if (contextType === 'empty') {
          menuItems.unshift(
            { action: 'clearRecent', label: 'Clear Recent Files', icon: <Trash2 size={14} />, danger: true },
            { type: 'separator' },
            { action: 'refresh', label: 'Refresh', icon: <RefreshCw size={14} />, shortcut: 'F5' }
          );
        }
        break;

      case 'desktop':
        // Desktop operations
        menuItems.push(
          { action: 'newFolder', label: 'New Folder', icon: <FolderPlus size={14} />, shortcut: 'Ctrl+Shift+N' },
          { action: 'newFile', label: 'New File', icon: <FilePlus size={14} /> },
          { type: 'separator' },
          { action: 'paste', label: 'Paste', icon: <ClipboardPaste size={14} />, shortcut: 'Ctrl+V', disabled: !clipboard || clipboard.items.length === 0 },
          { type: 'separator' },
          { action: 'refresh', label: 'Refresh Desktop', icon: <RefreshCw size={14} />, shortcut: 'F5' },
          { action: 'sortDesktop', label: 'Sort Desktop Icons', icon: <RotateCcw size={14} /> },
          { type: 'separator' },
          { action: 'desktopSettings', label: 'Desktop Settings', icon: <Settings size={14} /> }
        );
        break;
    }

    // Selection operations
    menuItems.push(
      { type: 'separator' },
      { action: 'selectAll', label: 'Select All', icon: <CheckSquare size={14} />, shortcut: 'Ctrl+A' },
      { action: 'invertSelection', label: 'Invert Selection', icon: <RotateCcw size={14} /> },
      { action: 'clearSelection', label: 'Clear Selection', icon: <Square size={14} />, shortcut: 'Escape' }
    );

    // Sort options
    menuItems.push(
      { type: 'separator' },
      {
        label: 'Sort By',
        submenu: [
          { action: 'sortByName', label: 'Name', checked: sortBy === 'name' },
          { action: 'sortByDate', label: 'Date Modified', checked: sortBy === 'date' },
          { action: 'sortBySize', label: 'Size', checked: sortBy === 'size' },
          { action: 'sortByType', label: 'Type', checked: sortBy === 'type' }
        ]
      }
    );

    // Position menu to stay within container bounds
    const containerWidth = fileExplorerRef.current?.clientWidth || window.innerWidth;
    const containerHeight = fileExplorerRef.current?.clientHeight || window.innerHeight;
    const menuWidth = 220;
    const menuHeight = menuItems.length * 32; // Approximate height

    let adjustedX = x;
    let adjustedY = y;

    // Adjust position to stay within container bounds
    if (x + menuWidth > containerWidth) {
      adjustedX = x - menuWidth;
    }

    if (y + menuHeight > containerHeight) {
      adjustedY = y - menuHeight;
    }

    // Ensure menu doesn't go off-screen to the left or top
    if (adjustedX < 0) adjustedX = 0;
    if (adjustedY < 0) adjustedY = 0;

    return (
      <>
        {/* Backdrop */}
        <div
          className="absolute inset-0 z-40"
          onClick={onClose}
          onContextMenu={(e) => {
            e.preventDefault();
            onClose();
          }}
        />

        {/* Context Menu */}
        <div
          className="absolute z-50 bg-[rgba(32,32,32,0.98)] backdrop-blur-xl border border-white/20 rounded-lg shadow-2xl overflow-hidden"
          style={{
            left: adjustedX,
            top: adjustedY,
            width: menuWidth
          }}
        >
          {menuItems.map((item, index) => {
            if (item.type === 'separator') {
              return (
                <div key={index} className="border-t border-white/10 mx-2 my-1" />
              );
            }

            if (item.submenu) {
              return (
                <div key={index} className="relative">
                  <button className="w-full px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10 flex items-center gap-3">
                    <span className="flex-1">{item.label}</span>
                    <ChevronRight size={12} className="text-white/60" />
                  </button>
                  <div className="absolute left-full top-0 ml-1 bg-[rgba(32,32,32,0.98)] border border-white/20 rounded-lg shadow-2xl">
                    {item.submenu.map((subItem, subIndex) => (
                      <button
                        key={subIndex}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-white/10 flex items-center gap-3 ${
                          subItem.checked ? 'text-white' : 'text-white/90'
                        }`}
                        onClick={() => onAction(subItem.action)}
                      >
                        {subItem.checked && <div className="w-2 h-2 bg-white/60 rounded-full" />}
                        <span className="flex-1">{subItem.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            }

            return (
              <button
                key={index}
                disabled={item.disabled}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-white/10 flex items-center gap-3 ${
                  item.danger ? 'text-white/80 hover:text-white/90' : 'text-white/90'
                } ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                onClick={() => item.action && !item.disabled && onAction(item.action)}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {item.shortcut && (
                  <span className="text-xs text-white/60 ml-auto">{item.shortcut}</span>
                )}
              </button>
            );
          })}
        </div>
      </>
    );
  });

  // Resizer functionality
  const handleResizerMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    setDragStart({
      x: e.clientX,
      width: sidebarWidth
    });
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  const handleSidebarMouseMove = React.useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    // Calculate delta movement from initial position
    const deltaX = e.clientX - dragStart.x;
    const newWidth = Math.max(200, Math.min(400, dragStart.width + deltaX));

    setSidebarWidth(newWidth);
  }, [isResizing, dragStart]);

  const handleSidebarMouseUp = React.useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }, [isResizing]);

  // Add global mouse event listeners
  React.useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleSidebarMouseMove);
      document.addEventListener('mouseup', handleSidebarMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleSidebarMouseMove);
        document.removeEventListener('mouseup', handleSidebarMouseUp);
      };
    }
  }, [isResizing, handleSidebarMouseMove, handleSidebarMouseUp]);

  // Directory contents now come directly from ContainerContext

  // Use preloaded file system data from ContainerContext
  const currentItems = React.useMemo(() => {
    return (contextFileSystem || []).map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
      path: item.path,
      size: item.size,
      modified: item.modified ? new Date(item.modified) : undefined,
      icon: item.type === 'folder'
        ? <Folder size={16} className="text-blue-500" />
        : item.name.endsWith('.txt')
        ? <FileText size={16} className="text-gray-500" />
        : item.name.match(/\.(jpg|jpeg|png|gif)$/i)
        ? <Image size={16} className="text-green-500" />
        : <FileText size={16} className="text-gray-400" />
    }));
  }, [contextFileSystem]);

  // Merge current items with temporary items
  const allItems = [...tempItems, ...currentItems];

  // Filter items based on search query
  const filteredItems = searchQuery
    ? allItems.filter(item =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allItems;

  // Item interaction handlers
  const handleItemClick = React.useCallback((item: FileSystemItem, event?: React.MouseEvent) => {
    if (event?.ctrlKey) {
      // Ctrl+Click: Toggle item in selection
      const newSelection = new Set(selectedItems);
      if (newSelection.has(item.id)) {
        newSelection.delete(item.id);
      } else {
        newSelection.add(item.id);
      }
      setSelectedItems(newSelection);
      setSelectedItem(item.id);
    } else if (event?.shiftKey && selectedItem) {
      // Shift+Click: Select range
      // We'll need to get the current item list to find indices
      const currentAllItems = [...tempItems, ...(contextFileSystem || []).map(i => ({
        id: i.id,
        name: i.name,
        type: i.type,
        path: i.path,
        size: i.size,
        modified: i.modified ? new Date(i.modified) : undefined,
        icon: null
      }))];
      const currentFilteredItems = searchQuery
        ? currentAllItems.filter(i =>
            i.name.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : currentAllItems;

      const startIndex = currentFilteredItems.findIndex(i => i.id === selectedItem);
      const endIndex = currentFilteredItems.findIndex(i => i.id === item.id);
      if (startIndex !== -1 && endIndex !== -1) {
        const newSelection = new Set<string>();
        const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
        for (let i = from; i <= to; i++) {
          newSelection.add(currentFilteredItems[i].id);
        }
        setSelectedItems(newSelection);
        setSelectedItem(item.id);
      }
    } else {
      // Normal click: Clear selection and select only this item
      setSelectedItems(new Set([item.id]));
      setSelectedItem(item.id);
    }
  }, [selectedItems, selectedItem, setSelectedItems, setSelectedItem, tempItems, contextFileSystem, searchQuery]);

  // Keyboard shortcuts for context menu actions
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't handle shortcuts when context menu is open
      if (contextMenu?.visible) return;

      // Ctrl+A - Select All
      if (event.ctrlKey && event.key === 'a') {
        event.preventDefault();
        handleContextMenuAction('selectAll');
      }

      // Delete - Delete selected items
      if (event.key === 'Delete' && (selectedItems.size > 0 || selectedItem)) {
        event.preventDefault();
        handleContextMenuAction('delete');
      }

      // F2 - Rename selected item
      if (event.key === 'F2' && selectedItem) {
        event.preventDefault();
        handleContextMenuAction('rename');
      }

      // Ctrl+C - Copy selected item
      if (event.ctrlKey && event.key === 'c' && selectedItem) {
        event.preventDefault();
        const selectedItems = filteredItems.find(item => item.id === selectedItem) ? [filteredItems.find(item => item.id === selectedItem)!] : [];
        if (selectedItems.length > 0) {
          handleContextMenuAction('copy');
        }
      }

      // Ctrl+X - Cut selected item
      if (event.ctrlKey && event.key === 'x' && selectedItem) {
        event.preventDefault();
        const selectedItems = filteredItems.find(item => item.id === selectedItem) ? [filteredItems.find(item => item.id === selectedItem)!] : [];
        if (selectedItems.length > 0) {
          handleContextMenuAction('cut');
        }
      }

      // Ctrl+V - Paste
      if (event.ctrlKey && event.key === 'v' && clipboard) {
        event.preventDefault();
        handleContextMenuAction('paste');
      }

      // Escape - Clear selection
      if (event.key === 'Escape') {
        event.preventDefault();
        handleContextMenuAction('clearSelection');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [contextMenu, selectedItem, selectedItems, clipboard, handleContextMenuAction, editingItem, handleSaveEdit, handleCancelEdit, handleItemClick, handleItemDoubleClick, contextFileSystem, deleteFile, refreshFileSystem]);

  // Navigation functions
  const handleNavigateToPath = React.useCallback((newPath: string, newTitle?: string) => {
    console.log('🧭 Navigating to path:', newPath);

    // Load the new directory contents from container
    loadContainerDirectory(newPath);

    // Update tab title in WindowManager
    if (onTabPathUpdate && activeTabId) {
      onTabPathUpdate(activeTabId, newPath);
    }
  }, [loadContainerDirectory, onTabPathUpdate, activeTabId]);

  const goBack = React.useCallback(() => {
    // Handle network view back navigation
    if (activeView === 'network' && selectedNetworkDevice) {
      setSelectedNetworkDevice(null);
      setNetworkDeviceContents([]);
      return;
    }
    
    // Handle local file navigation
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const newPath = history[newIndex];
      handleNavigateToPath(newPath);
      setSelectedItem(null);
      setHistoryIndex(newIndex);

      // Update tab title in WindowManager
      if (onTabPathUpdate && activeTabId) {
        onTabPathUpdate(activeTabId, newPath);
      }
    }
  }, [historyIndex, history, onTabPathUpdate, activeTabId, activeView, selectedNetworkDevice]);

  const goForward = React.useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const newPath = history[newIndex];
      handleNavigateToPath(newPath);
      setSelectedItem(null);
      setHistoryIndex(newIndex);

      // Update tab title in WindowManager
      if (onTabPathUpdate && activeTabId) {
        onTabPathUpdate(activeTabId, newPath);
      }
    }
  }, [historyIndex, history, onTabPathUpdate, activeTabId]);

  const goUp = () => {
    // Handle network view up navigation
    if (activeView === 'network' && selectedNetworkDevice) {
      setSelectedNetworkDevice(null);
      setNetworkDeviceContents([]);
      return;
    }
    
    // Handle local file navigation
    if (currentPath !== '/home') {
      const pathSegments = currentPath.split('/').filter(Boolean);
      pathSegments.pop();
      const newPath = pathSegments.length === 0 ? '/home/user' : '/' + pathSegments.join('/');
      handleNavigateToPath(newPath);
    }
  };

  const refresh = () => {
    setSelectedItem(null);
  };

  // Network tab functions
  // Network scan moved to Settings window
  // Handle network device double-click to show shared folders
  const handleNetworkDeviceOpen = React.useCallback((device: NetworkDevice) => {
    setSelectedNetworkDevice(device.id);
    
    // Mock shared folders from the network device
    const mockSharedFolders: FileSystemItem[] = [
      {
        id: `${device.id}-shared-docs`,
        name: 'Shared Documents',
        type: 'folder',
        path: `\\\\${device.name}\\Shared Documents`,
        icon: <Folder size={16} />,
        modified: new Date(Date.now() - 86400000)
      },
      {
        id: `${device.id}-public`,
        name: 'Public',
        type: 'folder',
        path: `\\\\${device.name}\\Public`,
        icon: <Folder size={16} />,
        modified: new Date(Date.now() - 172800000)
      },
      {
        id: `${device.id}-media`,
        name: 'Media',
        type: 'folder',
        path: `\\\\${device.name}\\Media`,
        icon: <Folder size={16} />,
        modified: new Date(Date.now() - 259200000)
      },
      {
        id: `${device.id}-file1`,
        name: 'README.txt',
        type: 'file',
        path: `\\\\${device.name}\\README.txt`,
        size: 2048,
        icon: <FileText size={16} />,
        modified: new Date(Date.now() - 345600000)
      }
    ];
    
    setNetworkDeviceContents(mockSharedFolders);
  }, []);

  // Handle network content sorting
  const handleNetworkSort = React.useCallback((column: 'name' | 'size' | 'modified' | 'type') => {
    if (networkSortColumn === column) {
      setNetworkSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setNetworkSortColumn(column);
      setNetworkSortDirection('asc');
    }
  }, [networkSortColumn]);

  // Get sorted network device contents
  const getSortedNetworkContents = React.useCallback(() => {
    const sorted = [...networkDeviceContents].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (networkSortColumn) {
        case 'name':
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case 'size':
          aValue = a.size || 0;
          bValue = b.size || 0;
          break;
        case 'modified':
          aValue = a.modified?.getTime() || 0;
          bValue = b.modified?.getTime() || 0;
          break;
        case 'type':
          aValue = a.type;
          bValue = b.type;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return networkSortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return networkSortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [networkDeviceContents, networkSortColumn, networkSortDirection]);

  // Invitation handling moved to Settings window
  const handleInvitationResponse = React.useCallback((invitationId: string, action: 'accept' | 'reject') => {
    // setShareInvitations(prev =>
    //   prev.map(inv =>
    //     inv.id === invitationId
    //       ? { ...inv, status: action === 'accept' ? 'accepted' : 'rejected' as const }
    //       : inv
    //   )
    // );
  }, []);

  const handleSendInvitation = React.useCallback((email: string, permissions: ('read' | 'write' | 'admin')[]) => {
    const newInvitation: ShareInvitation = {
      id: `inv-${Date.now()}`,
      from: 'current-user@example.com',
      email,
      resource: 'Shared Folder',
      permissions,
      status: 'pending',
      timestamp: new Date()
    };

    // setShareInvitations(prev => [newInvitation, ...prev]);
    // setShowInviteModal(false);
  }, []);

  // Shared tab functions
  const getFilteredSharedResources = React.useCallback(() => {
    // Choose the appropriate data source based on view type
    const dataSource = sharedViewType === 'with-me' ? sharedResources : sharedByMeResources;

    const sorted = [...dataSource].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sharedSortColumn) {
        case 'name':
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case 'size':
          aValue = a.type === 'file' ? (a.size || 0) : -1; // Folders sort before files
          bValue = b.type === 'file' ? (b.size || 0) : -1;
          break;
        case 'modified':
          aValue = new Date(a.modified).getTime();
          bValue = new Date(b.modified).getTime();
          break;
        case 'type':
          aValue = a.type;
          bValue = b.type;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sharedSortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sharedSortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [sharedResources, sharedByMeResources, sharedViewType, sharedSortColumn, sharedSortDirection]);

  const handleSharedSort = (column: 'name' | 'size' | 'modified' | 'type') => {
    if (sharedSortColumn === column) {
      // Toggle direction if same column
      setSharedSortDirection(sharedSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to ascending
      setSharedSortColumn(column);
      setSharedSortDirection('asc');
    }
  };

  // Recent tab functions
  const getFilteredRecentFiles = React.useCallback(() => {
    const sorted = [...recentFiles].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (recentSortColumn) {
        case 'name':
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case 'size':
          aValue = a.type === 'file' ? (a.size || 0) : -1; // Folders sort before files
          bValue = b.type === 'file' ? (b.size || 0) : -1;
          break;
        case 'modified':
          aValue = new Date(a.modified).getTime();
          bValue = new Date(b.modified).getTime();
          break;
        case 'type':
          aValue = a.type;
          bValue = b.type;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return recentSortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return recentSortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [recentFiles, recentSortColumn, recentSortDirection]);

  const handleRecentSort = (column: 'name' | 'size' | 'modified' | 'type') => {
    if (recentSortColumn === column) {
      // Toggle direction if same column
      setRecentSortDirection(recentSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to ascending
      setRecentSortColumn(column);
      setRecentSortDirection('asc');
    }
  };

  const getPermissionIcon = (permissions: ('read' | 'write' | 'admin')[]) => {
    if (permissions.includes('admin')) return <Crown size={12} />;
    if (permissions.includes('write')) return <Unlock size={12} />;
    return <Lock size={12} />;
  };

  const getPermissionTooltip = (permissions: ('read' | 'write' | 'admin')[]) => {
    if (permissions.includes('admin')) return 'Admin access';
    if (permissions.includes('write')) return 'Write access';
    return 'Read access';
  };

  const getDeviceIcon = (type: NetworkDevice['type']) => {
    switch (type) {
      case 'computer': return <Monitor size={16} />;
      case 'server': return <HardDrive size={16} />;
      case 'mobile': return <Network size={16} />;
      case 'storage': return <Archive size={16} />;
      default: return <Monitor size={16} />;
    }
  };

  const getDeviceStatusColor = (status: NetworkDevice['status']) => {
    return 'text-white/80';
  };

  const getPathTitle = (path: string): string => {
    if (path === '/') return 'Home';
    const segments = path.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'Home';
  };

  // Keyboard shortcuts for navigation
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Alt+Left for back navigation
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        goBack();
      }

      // Alt+Right for forward navigation
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        goForward();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [goBack, goForward]);



  // Inline input component for editing item names
  const InlineInput = React.memo(({
    item,
    onSave,
    onCancel
  }: {
    item: FileSystemItem;
    onSave: (newName: string) => void;
    onCancel: () => void;
  }) => {
    const [value, setValue] = React.useState(item.name);
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSave(value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    const handleBlur = () => {
      onSave(value);
    };

    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
    };

    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onClick={handleClick}
        className="bg-white/10 border border-white/20 rounded px-2 py-1 text-white placeholder-white/60 focus:outline-none focus:border-white/40 min-w-32"
        style={{ fontSize: '14px', lineHeight: '1.2' }}
      />
    );
  });



  const handleNavigateUp = () => {
    goUp();
  };

  const getBreadcrumbs = () => {
    // Handle network view
    if (activeView === 'network') {
      if (selectedNetworkDevice) {
        const device = networkDevices.find(d => d.id === selectedNetworkDevice);
        return ['Network', device?.name || 'Unknown Device'];
      }
      return ['Network'];
    }

    // Handle this-container view
    if (activeView === 'this-container') {
      return ['This Container'];
    }

    // Handle shared view
    if (activeView === 'shared') {
      return [sharedViewType === 'with-me' ? 'Shared with me' : 'Shared by me'];
    }
    
    // Handle recent view
    if (activeView === 'recent') {
      return ['Recent'];
    }
    
    // Handle local files
    if (currentPath === '/' || currentPath === '/home') return ['Home'];

    const segments = currentPath.split('/').filter(Boolean);
    // Remove 'home' from the beginning if it exists to avoid "Home > home > ..."
    const relevantSegments = segments[0] === 'home' ? segments.slice(1) : segments;

    if (relevantSegments.length === 0) return ['Home'];

    return ['Home', ...relevantSegments];
  };

  const navigateToBreadcrumb = (index: number) => {
    // Handle network view navigation
    if (activeView === 'network') {
      if (index === 0) {
        // Go back to network devices list
        setSelectedNetworkDevice(null);
        setNetworkDeviceContents([]);
      }
      return;
    }
    
    // Handle other views
    if (activeView === 'shared' || activeView === 'recent' || activeView === 'this-container') {
      // These don't have sub-navigation
      return;
    }
    
    // Handle local file navigation
    if (index === 0) {
      // Home
      handleNavigateToPath('/home/user');
    } else {
      const segments = currentPath.split('/').filter(Boolean);
      const relevantSegments = segments[0] === 'home' ? segments.slice(1) : segments;
      const targetSegments = relevantSegments.slice(0, index);
      const targetPath = targetSegments.length > 0 ? '/home/' + targetSegments.join('/') : '/home/user';
      const segment = relevantSegments[index - 1];
      handleNavigateToPath(targetPath, segment);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (date?: Date) => {
    if (!date) return '';
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getFileType = (filename: string) => {
    const extension = filename.split('.').pop()?.toLowerCase();
    if (!extension) return 'File';
    
    const typeMap: { [key: string]: string } = {
      'txt': 'Text Document',
      'pdf': 'PDF Document',
      'doc': 'Word Document',
      'docx': 'Word Document',
      'xls': 'Excel Spreadsheet',
      'xlsx': 'Excel Spreadsheet',
      'ppt': 'PowerPoint Presentation',
      'pptx': 'PowerPoint Presentation',
      'jpg': 'JPEG Image',
      'jpeg': 'JPEG Image',
      'png': 'PNG Image',
      'gif': 'GIF Image',
      'bmp': 'Bitmap Image',
      'mp4': 'MP4 Video',
      'avi': 'AVI Video',
      'mov': 'QuickTime Video',
      'mp3': 'MP3 Audio',
      'wav': 'WAV Audio',
      'zip': 'Compressed Folder',
      'rar': 'Compressed Folder',
      '7z': 'Compressed Folder',
      'exe': 'Application',
      'msi': 'Windows Installer',
      'html': 'HTML Document',
      'css': 'CSS Stylesheet',
      'js': 'JavaScript File',
      'ts': 'TypeScript File',
      'json': 'JSON Document',
      'xml': 'XML Document',
      'sql': 'SQL Database',
      'csv': 'CSV Document'
    };
    
    return typeMap[extension] || `${extension.toUpperCase()} File`;
  };

  // File system data is now preloaded via ContainerContext
  // No need for individual loading states

  // File system data is now always available from ContainerContext
  // Using contextFileSystem array instead of local fileSystem state

  return (
    <div ref={fileExplorerRef} className="relative flex flex-col h-full bg-[rgba(42,42,42,0.8)] text-white">


      {/* Navigation Bar */}
      <div className="flex items-center gap-1 p-3 border-b border-white/10 bg-[rgba(37,37,37,0.8)]">
        {/* Sidebar Toggle & Navigation Arrows */}
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 text-white/80 hover:bg-white/10 hover:text-white rounded transition-colors"
            onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
            title={isSidebarExpanded ? "Hide sidebar" : "Show sidebar"}
          >
            {isSidebarExpanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
          <button
            className={`p-1.5 rounded hover:bg-white/10 transition-colors ${
              historyIndex > 0
                ? 'text-white/80 hover:text-white'
                : 'text-white/30 cursor-not-allowed'
            }`}
            onClick={goBack}
            disabled={historyIndex <= 0}
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            className={`p-1.5 rounded hover:bg-white/10 transition-colors ${
              historyIndex < history.length - 1
                ? 'text-white/80 hover:text-white'
                : 'text-white/30 cursor-not-allowed'
            }`}
            onClick={goForward}
            disabled={historyIndex >= history.length - 1}
            title="Forward"
          >
            <ArrowRight size={16} />
          </button>
          <button
            className="p-1.5 text-white/80 hover:bg-white/10 hover:text-white rounded transition-colors"
            onClick={handleNavigateUp}
            disabled={currentPath === '/'}
            title="Up"
          >
            <ArrowUp size={16} />
          </button>
          <button
            className="p-1.5 text-white/80 hover:bg-white/10 hover:text-white rounded transition-colors"
            onClick={refresh}
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {/* Address Bar */}
        <div className="flex-1 mx-4">
          <div className="flex items-center gap-2 px-3 py-2 bg-[rgba(32,32,32,0.6)] border border-white/10 rounded hover:bg-white/5 transition-colors cursor-pointer">
            <Home size={16} className="text-white/60 flex-shrink-0" />
            <div className="flex items-center gap-1 text-sm text-white/90 overflow-hidden">
              {getBreadcrumbs().map((segment, index) => (
                <React.Fragment key={index}>
                  {index > 0 && <ChevronRight size={12} className="text-white/40 flex-shrink-0" />}
                  <button
                    className="hover:text-white hover:bg-white/10 px-1 rounded transition-colors truncate"
                    onClick={() => navigateToBreadcrumb(index)}
                    title={`Navigate to ${segment}`}
                  >
                    {segment}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            placeholder={`Search ${activeView === 'local' ? 'Home' : activeView === 'network' ? 'Network' : activeView === 'this-container' ? 'This Container' : activeView === 'shared' ? (sharedViewType === 'with-me' ? 'Shared with me' : 'Shared by me') : 'Recent'}`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-2 pl-10 bg-[rgba(32,32,32,0.6)] border border-white/10 rounded text-white placeholder-white/40 text-sm focus:outline-none focus:border-blue-500/50 focus:bg-[rgba(42,42,42,0.8)] transition-colors min-w-48"
          />
          <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/40 flex-shrink-0 pointer-events-none" />
        </div>
      </div>


      {/* Main Content Area with Sidebar */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        {isSidebarExpanded && (
          <>
            <div
              className="bg-[rgba(37,37,37,0.9)] border-r border-white/10 flex flex-col overflow-hidden"
              style={{ width: `${sidebarWidth}px` }}
            >

            {/* Sidebar Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Quick Access Section */}
              <div className="p-2">
                <div className="flex items-center">
                  {/* Arrow button for expand/collapse */}
                  <button
                    onClick={() => toggleSection('quickAccess')}
                    className="flex items-center p-1 hover:bg-white/10 rounded transition-colors mr-1"
                  >
                    {expandedSections.quickAccess ? <ChevronDown size={14} className="text-white/70" /> : <ChevronRight size={14} className="text-white/70" />}
                  </button>

                  {/* Quick Access main area */}
                  <div className="flex items-center gap-2 flex-1 p-2 text-left text-white/80">
                    <Star size={16} className="text-yellow-400" />
                    <span className="text-sm">Quick access</span>
                  </div>
                </div>

                {expandedSections.quickAccess && (
                  <div className="ml-4 mt-1 space-y-1">
                    {sidebarData.quickAccess.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => navigateFromSidebar(item)}
                        className={`flex items-center gap-2 w-full p-2 text-left text-sm rounded transition-colors ${
                          selectedSidebarItem === item.id || (selectedSidebarItem === null && ((item.view && activeView === item.view) || (item.path && currentPath === item.path)))
                            ? 'bg-white/20 text-white'
                            : 'text-white/70 hover:bg-white/10 hover:text-white/90'
                        }`}
                      >
                        {item.icon}
                        <span className="truncate">{item.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* This Container Section */}
              <div className="p-2">
                <div className="flex items-center">
                  {/* Arrow button for expand/collapse */}
                  <button
                    onClick={() => toggleSection('thisLab')}
                    className="flex items-center p-1 hover:bg-white/10 rounded transition-colors mr-1"
                  >
                    {expandedSections.thisLab ? <ChevronDown size={14} className="text-white/70" /> : <ChevronRight size={14} className="text-white/70" />}
                  </button>

                  {/* This Container main button - opens volumes view */}
                  <button
                    onClick={() => navigateToThisContainer()}
                    className="flex items-center gap-2 flex-1 p-2 text-left text-white/80 hover:bg-white/10 rounded transition-colors"
                  >
                    <HardDrive size={16} className="text-white/70" />
                    <span className="text-sm">This Container</span>
                  </button>
                </div>

                {expandedSections.thisLab && (
                  <div className="ml-4 mt-1 space-y-1">
                    {sidebarData.thisLab.map((item) => {
                      // System Volume - Show with warning styling
                      if (item.isSystemVolume) {
                        return (
                          <div key={item.id} className="relative group">
                            <button
                              onClick={() => {
                                // Show warning before allowing access to system volume
                                if (window.confirm('⚠️ System Volume contains container system files. Modifying these files may break your container. Continue?')) {
                                  navigateFromSidebar(item);
                                }
                              }}
                              className={`flex items-center gap-2 w-full p-2 text-left text-sm rounded transition-colors ${
                                selectedSidebarItem === item.id || (selectedSidebarItem === null && currentPath === item.path)
                                  ? 'bg-red-500/20 text-red-300'
                                  : 'text-red-400/70 hover:bg-red-500/10 hover:text-red-300'
                              }`}
                              title={item.description}
                            >
                              {item.icon}
                              <span className="truncate">{item.name}</span>
                            </button>
                            <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-50 bg-black/90 text-white text-xs p-2 rounded shadow-lg max-w-xs">
                              {item.description} - Modify with caution
                            </div>
                          </div>
                        );
                      }

                      // User Volume or User Folders - Normal styling with blue accent
                      return (
                        <div key={item.id} className="relative group">
                          <button
                            onClick={() => navigateFromSidebar(item)}
                            className={`flex items-center gap-2 w-full p-2 text-left text-sm rounded transition-colors ${
                              selectedSidebarItem === item.id || (selectedSidebarItem === null && currentPath === item.path)
                                ? item.isUserVolume
                                  ? 'bg-blue-500/20 text-blue-300'
                                  : 'bg-white/20 text-white'
                                : item.isUserVolume
                                  ? 'text-blue-400/80 hover:bg-blue-500/10 hover:text-blue-300'
                                  : 'text-white/70 hover:bg-white/10 hover:text-white/90'
                            }`}
                            title={item.description || item.path}
                          >
                            {item.icon}
                            <span className="truncate">{item.name}</span>
                          </button>
                          {(item.description || item.isUserVolume) && (
                            <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-50 bg-black/90 text-white text-xs p-2 rounded shadow-lg max-w-xs">
                              {item.description || 'Your personal files and folders'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Network Section */}
              <div className="p-2">
                <div className="flex items-center">
                  {/* Arrow button for expand/collapse */}
                  <button
                    onClick={() => toggleSection('network')}
                    className="flex items-center p-1 hover:bg-white/10 rounded transition-colors mr-1"
                  >
                    {expandedSections.network ? <ChevronDown size={14} className="text-white/70" /> : <ChevronRight size={14} className="text-white/70" />}
                  </button>

                  {/* Network main button */}
                  <button
                    onClick={() => navigateFromSidebar({ id: 'network', view: 'network' })}
                    className="flex items-center gap-2 flex-1 p-2 text-left text-white/80 hover:bg-white/10 rounded transition-colors"
                  >
                    <Network size={16} className="text-green-400" />
                    <span className="text-sm">Network</span>
                  </button>
                </div>

                {expandedSections.network && (
                  <div className="ml-4 mt-1 space-y-1">
                    {sidebarData.network.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => navigateFromSidebar(item)}
                        className={`flex items-center gap-2 w-full p-2 text-left text-sm rounded transition-colors ${
                          selectedSidebarItem === item.id || (selectedSidebarItem === null && activeView === item.view)
                            ? 'bg-blue-500/20 text-blue-300'
                            : 'text-white/70 hover:bg-white/10 hover:text-white/90'
                        }`}
                      >
                        {item.icon}
                        <span className="truncate">{item.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Shared Section */}
              <div className="p-2">
                <div className="flex items-center">
                  {/* Arrow button for expand/collapse */}
                  <button
                    onClick={() => toggleSection('shared')}
                    className="flex items-center p-1 hover:bg-white/10 rounded transition-colors mr-1"
                  >
                    {expandedSections.shared ? <ChevronDown size={14} className="text-white/70" /> : <ChevronRight size={14} className="text-white/70" />}
                  </button>

                  {/* Shared main button */}
                  <button
                    onClick={() => navigateFromSidebar({ id: 'shared', view: 'shared' })}
                    className="flex items-center gap-2 flex-1 p-2 text-left text-white/80 hover:bg-white/10 rounded transition-colors"
                  >
                    <Share2 size={16} className="text-green-400" />
                    <span className="text-sm">Shared</span>
                  </button>
                </div>

                {expandedSections.shared && (
                  <div className="ml-4 mt-1 space-y-1">
                    {sidebarData.shared.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => navigateFromSidebar(item)}
                        className={`flex items-center gap-2 w-full p-2 text-left text-sm rounded transition-colors ${
                          selectedSidebarItem === item.id || (selectedSidebarItem === null && activeView === item.view && (!item.sharedType || item.sharedType === sharedViewType))
                            ? 'bg-white/20 text-white'
                            : 'text-white/70 hover:bg-white/10 hover:text-white/90'
                        }`}
                      >
                        {item.icon}
                        <span className="truncate">{item.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Section */}
              <div className="p-2">
                <div className="flex items-center">
                  {/* Arrow button for expand/collapse */}
                  <button
                    onClick={() => toggleSection('recent')}
                    className="flex items-center p-1 hover:bg-white/10 rounded transition-colors mr-1"
                  >
                    {expandedSections.recent ? <ChevronDown size={14} className="text-white/70" /> : <ChevronRight size={14} className="text-white/70" />}
                  </button>

                  {/* Recent main button */}
                  <button
                    onClick={() => navigateFromSidebar({ id: 'recent', view: 'recent' })}
                    className="flex items-center gap-2 flex-1 p-2 text-left text-white/80 hover:bg-white/10 rounded transition-colors"
                  >
                    <Clock size={16} className="text-white/70" />
                    <span className="text-sm">Recent</span>
                  </button>
                </div>

                {expandedSections.recent && (
                  <div className="ml-4 mt-1 space-y-1">
                    {sidebarData.recent.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => navigateFromSidebar(item)}
                        className={`flex items-center gap-2 w-full p-2 text-left text-sm rounded transition-colors ${
                          selectedSidebarItem === item.id || (selectedSidebarItem === null && activeView === item.view)
                            ? 'bg-white/20 text-white'
                            : 'text-white/70 hover:bg-white/10 hover:text-white/90'
                        }`}
                      >
                        {item.icon}
                        <span className="truncate">{item.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

          {/* Resizer Handle */}
          <div
            className={`w-1 bg-transparent hover:bg-white/20 cursor-ew-resize transition-colors flex-shrink-0 ${
              isResizing ? 'bg-white/30' : ''
            }`}
            onMouseDown={handleResizerMouseDown}
          />
        </div>
      </>
      )}

      {/* Main Content */}
      <div className="flex flex-col flex-1 min-w-0">
          {activeView === 'local' && (
            <>
              {/* File List Header */}
              <div className="flex items-center border-b border-white/10 bg-[rgba(32,32,32,0.5)]">
                <div className="flex items-center flex-1 px-4 py-2 text-sm font-medium text-white/60">
                  {/* Name column with icon space */}
                  <div className="flex items-center gap-3" style={{ width: `${columnWidths.name}px`, minWidth: '100px' }}>
                    <div className="w-4"></div>
                    <div className="truncate">Name</div>
                  </div>

                  {/* Name column resize divider */}
                  <div
                    className="w-px bg-white/20 mx-2 cursor-col-resize hover:bg-white/40 relative"
                    onMouseDown={(e) => handleColumnResizeStart(e, 'name')}
                    style={{ padding: '0 3px', margin: '0 -3px' }}
                  >
                    <div className="w-px h-4 bg-white/20"></div>
                  </div>

                  <div style={{ width: `${columnWidths.size}px` }} className="text-left flex-shrink-0">Size</div>

                  {/* Size column resize divider */}
                  <div
                    className="w-px bg-white/20 mx-2 cursor-col-resize hover:bg-white/40 relative"
                    onMouseDown={(e) => handleColumnResizeStart(e, 'size')}
                    style={{ padding: '0 3px', margin: '0 -3px' }}
                  >
                    <div className="w-px h-4 bg-white/20"></div>
                  </div>

                  <div style={{ width: `${columnWidths.modified}px` }} className="text-left flex-shrink-0">Modified</div>

                  {/* Modified column resize divider */}
                  <div
                    className="w-px bg-white/20 mx-2 cursor-col-resize hover:bg-white/40 relative"
                    onMouseDown={(e) => handleColumnResizeStart(e, 'modified')}
                    style={{ padding: '0 3px', margin: '0 -3px' }}
                  >
                    <div className="w-px h-4 bg-white/20"></div>
                  </div>

                  <div style={{ width: `${columnWidths.type}px` }} className="text-left flex-shrink-0">Type</div>

                  {/* Type column end divider */}
                  <div className="flex items-center justify-center" style={{ width: '17px' }}>
                    <div className="w-px h-4 bg-white/20"></div>
                  </div>

                  <div className="w-8"></div>
                </div>

                {/* Empty area header */}
                <div className="flex-1 min-w-[100px] py-2"></div>
              </div>

              {/* File List */}
              <div
                ref={fileListRef}
                className={`flex-1 overflow-auto relative select-none ${isSelecting ? 'is-selecting' : ''}`}
                onMouseDown={handleMouseDown}
                onContextMenu={(e) => {
                  // Only handle right-click on empty space (not on items)
                  const target = e.target as HTMLElement;
                  if (!target.closest('[data-file-item]')) {
                    handleRightClick(e);
                  }
                }}
                style={{ userSelect: 'none' }}
              >
                {filteredItems.map((item) => (
                  <div key={item.id} className="flex items-center border-b border-white/5">
                    {/* Selectable item area */}
                    <div
                      data-file-item
                      data-item-id={item.id}
                      className={`flex items-center flex-1 px-4 py-3 transition-colors ${
                        editingItem?.id === item.id
                          ? 'cursor-default'
                          : `cursor-pointer ${
                              !isSelecting ? 'hover:bg-white/5' : ''
                            } ${
                              selectedItems.has(item.id) ? 'bg-white/10' : ''
                            }`
                      }`}
                      onClick={(e) => editingItem?.id !== item.id && !isSelecting && handleItemClick(item, e)}
                      onDoubleClick={(e) => editingItem?.id !== item.id && !isSelecting && handleItemDoubleClick(e, item)}
                      onContextMenu={(e) => editingItem?.id !== item.id && !isSelecting && handleRightClick(e, item)}
                      style={{
                        pointerEvents: isSelecting ? 'none' : 'auto'
                      }}
                    >
                      {/* Name column with icon */}
                      <div className="flex items-center gap-3" style={{ width: `${columnWidths.name}px`, minWidth: '100px' }}>
                        <div className="text-white/60 w-4 flex items-center justify-center">
                          {item.icon}
                        </div>
                        {editingItem && editingItem.id === item.id ? (
                          <InlineInput
                            item={item}
                            onSave={(newName) => handleSaveEdit(item.id, newName)}
                            onCancel={() => handleCancelEdit(item.id)}
                          />
                        ) : (
                          <span className="text-white text-sm truncate">{item.name}</span>
                        )}
                      </div>

                      {/* Name divider - aligned with header */}
                      <div className="flex items-center justify-center" style={{ width: '17px' }}>
                        <div className="w-px h-4 bg-white/10"></div>
                      </div>

                      <div style={{ width: `${columnWidths.size}px` }} className="text-white/60 text-sm text-left flex-shrink-0 overflow-hidden truncate">
                        {item.type === 'file' ? formatFileSize(item.size) : ''}
                      </div>

                      {/* Size divider - aligned with header */}
                      <div className="flex items-center justify-center" style={{ width: '17px' }}>
                        <div className="w-px h-4 bg-white/10"></div>
                      </div>

                      <div style={{ width: `${columnWidths.modified}px` }} className="text-white/60 text-sm text-left flex-shrink-0 overflow-hidden truncate">
                        {formatDate(item.modified)}
                      </div>

                      {/* Modified divider - aligned with header */}
                      <div className="flex items-center justify-center" style={{ width: '17px' }}>
                        <div className="w-px h-4 bg-white/10"></div>
                      </div>

                      <div style={{ width: `${columnWidths.type}px` }} className="text-white/60 text-sm capitalize text-left flex-shrink-0 overflow-hidden truncate">
                        {item.type}
                      </div>

                      {/* Type divider - aligned with header */}
                      <div className="flex items-center justify-center" style={{ width: '17px' }}>
                        <div className="w-px h-4 bg-white/10"></div>
                      </div>

                      {/* Small extension of selectable area */}
                      <div className="w-8"></div>
                    </div>

                    {/* Non-selectable empty area */}
                    <div className="flex-1 min-w-[100px] py-3">
                      {/* Empty space for drag selection - not part of the item */}
                    </div>
                  </div>
                ))}

                {filteredItems.length === 0 && (
                  <div className="flex items-center justify-center h-32 text-white/40 text-sm">
                    {searchQuery ? 'No items found' : 'This folder is empty'}
                  </div>
                )}

                {/* Marquee Selection Box */}
                {isSelecting && (
                  <div
                    className="absolute pointer-events-none border border-blue-500 bg-blue-500/20"
                    style={{
                      left: selectionBox.x,
                      top: selectionBox.y,
                      width: selectionBox.width,
                      height: selectionBox.height,
                    }}
                  />
                )}
              </div>

              {/* Status Bar */}
              <div className="flex items-center justify-between px-4 py-2 bg-[rgba(32,32,32,0.5)] border-t border-white/10 text-sm text-white/60">
                <div>
                  {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
                  {selectedItem && (
                    <span className="ml-4">
                      Selected: {filteredItems.find(item => item.id === selectedItem)?.name}
                    </span>
                  )}
                </div>
                <div>{currentPath}</div>
              </div>
            </>
          )}

          {activeView === 'network' && (
            <div className="flex-1 overflow-auto">
              {!selectedNetworkDevice ? (
                <>
                  
                  {/* Network devices grid - Windows Explorer style */}
                  <div className="p-4">
                    {networkDevices.length > 0 ? (
                      <div className="grid grid-cols-6 gap-4">
                        {networkDevices.map((device) => (
                          <div
                            key={device.id}
                            className={`flex flex-col items-center p-3 rounded-lg ${!isSelecting ? 'hover:bg-white/5' : ''} cursor-pointer transition-colors`}
                            onDoubleClick={() => handleNetworkDeviceOpen(device)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const fileSystemItem: FileSystemItem = {
                                id: device.id,
                                name: device.name,
                                type: 'folder',
                                path: `\\\\${device.name}`,
                                icon: <Monitor size={16} />
                              };
                              handleRightClick(e, fileSystemItem);
                            }}
                          >
                            <div className="mb-2">
                              {device.type === 'computer' && <Monitor size={48} className="text-white/60" />}
                              {device.type === 'server' && <HardDrive size={48} className="text-white/60" />}
                              {device.type === 'mobile' && <HardDrive size={48} className="text-white/60" />}
                              {device.type === 'storage' && <HardDrive size={48} className="text-white/60" />}
                            </div>
                            <div className="text-center">
                              <div className="text-white/90 text-sm font-medium truncate max-w-[100px]">
                                {device.name}
                              </div>
                              <div className="text-white/50 text-xs mt-1">
                                {device.status === 'online' ? 'Available' : 'Offline'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Network size={48} className="text-white/30 mb-4" />
                        <p className="text-white/60 text-sm">No network devices found</p>
                        <p className="text-white/40 text-xs mt-2">
                          Network devices will appear here when shared with you
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* File List Header - Standard XenoExplorer interface */}
                  <div className="flex items-center px-4 py-2 bg-[rgba(32,32,32,0.5)] border-b border-white/10 text-sm font-medium text-white/60">
                    <button
                      onClick={() => handleNetworkSort('name')}
                      className="flex items-center gap-1 flex-1 pr-4 hover:text-white/80 transition-colors"
                    >
                      <span>Name</span>
                      {networkSortColumn === 'name' && (
                        networkSortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                      )}
                    </button>
                    <div className="w-px h-4 bg-white/20 mx-2"></div>
                    <button
                      onClick={() => handleNetworkSort('size')}
                      className="flex items-center gap-1 w-24 pr-4 hover:text-white/80 transition-colors"
                    >
                      <span>Size</span>
                      {networkSortColumn === 'size' && (
                        networkSortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                      )}
                    </button>
                    <div className="w-px h-4 bg-white/20 mx-2"></div>
                    <button
                      onClick={() => handleNetworkSort('modified')}
                      className="flex items-center gap-1 w-40 pr-4 hover:text-white/80 transition-colors"
                    >
                      <span>Modified</span>
                      {networkSortColumn === 'modified' && (
                        networkSortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                      )}
                    </button>
                    <div className="w-px h-4 bg-white/20 mx-2"></div>
                    <button
                      onClick={() => handleNetworkSort('type')}
                      className="flex items-center gap-1 w-20 hover:text-white/80 transition-colors"
                    >
                      <span>Type</span>
                      {networkSortColumn === 'type' && (
                        networkSortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                      )}
                    </button>
                  </div>
                  
                  {/* Shared folders and files list */}
                  <div
                    className="flex-1 overflow-auto"
                    onContextMenu={(e) => {
                      const target = e.target as HTMLElement;
                      if (!target.closest('[data-network-item]')) {
                        handleRightClick(e);
                      }
                    }}
                  >
                    {networkDeviceContents.length > 0 ? (
                      getSortedNetworkContents().map((item) => (
                        <div
                          key={item.id}
                          data-network-item
                          className={`flex items-center px-4 py-3 border-b border-white/5 transition-colors ${!isSelecting ? 'hover:bg-white/5' : ''} cursor-pointer ${
                            selectedItem === item.id ? 'bg-white/10' : ''
                          }`}
                          onClick={() => setSelectedItem(item.id)}
                          onDoubleClick={() => {
                            if (item.type === 'folder') {
                              // Navigate into folder
                              console.log('Opening network folder:', item.path);
                            } else {
                              // Open file
                              console.log('Opening network file:', item.path);
                            }
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleRightClick(e, item);
                          }}
                        >
                          <div className="flex items-center gap-3 flex-1 pr-4">
                            <div className="text-white/60">
                              {item.icon}
                            </div>
                            <span className="text-white text-sm">{item.name}</span>
                          </div>

                          <div className="w-px h-4 bg-white/10 mx-2"></div>

                          <div className="w-24 text-white/60 text-sm pr-4">
                            {item.type === 'file' && item.size ? formatFileSize(item.size) : ''}
                          </div>

                          <div className="w-px h-4 bg-white/10 mx-2"></div>

                          <div className="w-40 text-white/60 text-sm pr-4">
                            {formatDate(item.modified || new Date())}
                          </div>

                          <div className="w-px h-4 bg-white/10 mx-2"></div>

                          <div className="w-20 text-white/60 text-sm">
                            {item.type === 'folder' ? 'Folder' : 'File'}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Folder size={48} className="text-white/30 mb-4" />
                        <p className="text-white/60 text-sm">No shared resources</p>
                        <p className="text-white/40 text-xs mt-2">
                          This device has not shared any files or folders
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {activeView === 'this-container' && (
            <div className="flex-1 overflow-auto">

              {/* Volumes grid - Windows 11 "This PC" style */}
              <div className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {thisContainerItems.map((volume) => (
                    <div
                      key={volume.id}
                      className="group relative bg-[rgba(42,42,42,0.6)] border border-white/10 rounded-lg p-4 hover:bg-[rgba(52,52,52,0.8)] hover:border-white/20 transition-all cursor-pointer"
                      onClick={() => {
                        if (volume.isSystemVolume) {
                          // Show warning before allowing access to system volume
                          if (window.confirm('⚠️ System Volume contains container system files. Modifying these files may break your container. Continue?')) {
                            navigateFromSidebar(volume);
                          }
                        } else {
                          navigateFromSidebar(volume);
                        }
                      }}
                    >
                      {/* Volume Icon and Name */}
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`text-3xl ${volume.isSystemVolume ? 'text-red-400' : 'text-blue-400'}`}>
                          {volume.icon}
                        </div>
                        <div className="flex-1">
                          <h3 className="text-white font-medium text-sm">{volume.name}</h3>
                          <div className="flex justify-between items-center mt-1">
                            <p className="text-white/60 text-xs">{volume.description}</p>
                            {(volume.isSystemVolume ? storageData?.system : storageData?.user) && (
                              <span className="text-white/50 text-xs">
                                {formatFileSize((volume.isSystemVolume ? storageData?.system : storageData?.user)?.used) || '0 B'} / {formatFileSize((volume.isSystemVolume ? storageData?.system : storageData?.user)?.total) || 'Unknown'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Storage Bar */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs text-white/70">
                          <span>Storage</span>
                          <span>{volume.isSystemVolume ? 'System' : 'Available'}</span>
                        </div>
                        <div className="w-full bg-white/10 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all ${
                              volume.isSystemVolume
                                ? 'bg-red-400'
                                : 'bg-blue-400'
                            }`}
                            style={{
                              width: (volume.isSystemVolume ? storageData?.system : storageData?.user)?.percentage
                                ? `${(volume.isSystemVolume ? storageData?.system : storageData?.user)?.percentage}%`
                                : (volume.isSystemVolume ? '75%' : '15%')
                            }}
                          ></div>
                        </div>
                        <p className="text-xs text-white/60">
                          {volume.isSystemVolume
                            ? 'System files and OS'
                            : 'Your personal storage space'
                          }
                        </p>
                      </div>

                      {/* Hover effect */}
                      <div className="absolute inset-0 bg-white/5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                    </div>
                  ))}
                </div>

                {thisContainerItems.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-white/60">
                    <HardDrive size={48} className="mb-4 text-white/30" />
                    <p className="text-lg mb-2">No volumes found</p>
                    <p className="text-sm">Container volumes will appear here</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeView === 'shared' && (
            <>
              {/* File List Header */}
              <div className="flex items-center px-4 py-2 bg-[rgba(32,32,32,0.5)] border-b border-white/10 text-sm font-medium text-white/60">
                <button
                  onClick={() => handleSharedSort('name')}
                  className="flex items-center gap-1 flex-1 pr-4 hover:text-white/80 transition-colors"
                >
                  <span>Name</span>
                  {sharedSortColumn === 'name' && (
                    sharedSortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                  )}
                </button>
                <div className="w-px h-4 bg-white/20 mx-2"></div>
                <button
                  onClick={() => handleSharedSort('size')}
                  className="flex items-center gap-1 w-24 pr-4 hover:text-white/80 transition-colors"
                >
                  <span>Size</span>
                  {sharedSortColumn === 'size' && (
                    sharedSortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                  )}
                </button>
                <div className="w-px h-4 bg-white/20 mx-2"></div>
                <button
                  onClick={() => handleSharedSort('modified')}
                  className="flex items-center gap-1 w-40 pr-4 hover:text-white/80 transition-colors"
                >
                  <span>Modified</span>
                  {sharedSortColumn === 'modified' && (
                    sharedSortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                  )}
                </button>
                <div className="w-px h-4 bg-white/20 mx-2"></div>
                <button
                  onClick={() => handleSharedSort('type')}
                  className="flex items-center gap-1 w-20 hover:text-white/80 transition-colors"
                >
                  <span>Type</span>
                  {sharedSortColumn === 'type' && (
                    sharedSortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                  )}
                </button>
              </div>

              {/* Shared Resources List */}
              <div
                className="flex-1 overflow-auto"
                onContextMenu={(e) => {
                  // Only handle right-click on empty space (not on items)
                  const target = e.target as HTMLElement;
                  if (!target.closest('[data-shared-resource]')) {
                    handleRightClick(e);
                  }
                }}
              >
                {getFilteredSharedResources().map((resource) => (
                  <div
                    key={resource.id}
                    data-shared-resource
                    className={`flex items-center px-4 py-3 border-b border-white/5 transition-colors ${!isSelecting ? 'hover:bg-white/5' : ''} cursor-pointer`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // Convert SharedResource to FileSystemItem format for context menu
                      const fileSystemItem: FileSystemItem = {
                        id: resource.id,
                        name: resource.name,
                        type: resource.type,
                        path: resource.name, // Use name as path for shared resources
                        icon: resource.icon
                      };
                      handleRightClick(e, fileSystemItem);
                    }}
                  >
                    <div className="flex items-center gap-3 flex-1 pr-4">
                      <div className="text-white/60">
                        {resource.icon}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm">{resource.name}</span>
                        <div className="text-white/60" title={getPermissionTooltip(resource.permissions)}>{getPermissionIcon(resource.permissions)}</div>
                      </div>
                    </div>

                    <div className="w-px h-4 bg-white/10 mx-2"></div>

                    <div className="w-24 text-white/60 text-sm pr-4">
                      {resource.type === 'file' ? formatFileSize(resource.size) : ''}
                    </div>

                    <div className="w-px h-4 bg-white/10 mx-2"></div>

                    <div className="w-40 text-white/60 text-sm pr-4">
                      {formatDate(resource.modified)}
                    </div>

                    <div className="w-px h-4 bg-white/10 mx-2"></div>

                    <div className="w-20 text-white/60 text-sm capitalize">
                      {resource.type}
                    </div>
                  </div>
                ))}

                {getFilteredSharedResources().length === 0 && (
                  <div className="flex items-center justify-center h-32 text-white/40 text-sm">
                    No shared resources found
                  </div>
                )}
              </div>

              {/* Status Bar */}
              <div className="flex items-center justify-between px-4 py-2 bg-[rgba(32,32,32,0.5)] border-t border-white/10 text-sm text-white/60">
                <div>
                  {getFilteredSharedResources().length} item{getFilteredSharedResources().length !== 1 ? 's' : ''}
                </div>
              </div>
            </>
          )}

          {activeView === 'recent' && (
            <>
              {/* File List Header */}
              <div className="flex items-center px-4 py-2 bg-[rgba(32,32,32,0.5)] border-b border-white/10 text-sm font-medium text-white/60">
                <button
                  onClick={() => handleRecentSort('name')}
                  className="flex items-center gap-1 flex-1 pr-4 hover:text-white/80 transition-colors"
                >
                  <span>Name</span>
                  {recentSortColumn === 'name' && (
                    recentSortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                  )}
                </button>
                <div className="w-px h-4 bg-white/20 mx-2"></div>
                <button
                  onClick={() => handleRecentSort('size')}
                  className="flex items-center gap-1 w-24 pr-4 hover:text-white/80 transition-colors"
                >
                  <span>Size</span>
                  {recentSortColumn === 'size' && (
                    recentSortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                  )}
                </button>
                <div className="w-px h-4 bg-white/20 mx-2"></div>
                <button
                  onClick={() => handleRecentSort('modified')}
                  className="flex items-center gap-1 w-40 pr-4 hover:text-white/80 transition-colors"
                >
                  <span>Modified</span>
                  {recentSortColumn === 'modified' && (
                    recentSortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                  )}
                </button>
                <div className="w-px h-4 bg-white/20 mx-2"></div>
                <button
                  onClick={() => handleRecentSort('type')}
                  className="flex items-center gap-1 w-20 hover:text-white/80 transition-colors"
                >
                  <span>Type</span>
                  {recentSortColumn === 'type' && (
                    recentSortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                  )}
                </button>
              </div>

              {/* Recent Files List */}
              <div
                className="flex-1 overflow-auto"
                onContextMenu={(e) => {
                  // Only handle right-click on empty space (not on items)
                  const target = e.target as HTMLElement;
                  if (!target.closest('[data-recent-file]')) {
                    handleRightClick(e);
                  }
                }}
              >
                {getFilteredRecentFiles().map((file) => (
                  <div
                    key={file.id}
                    data-recent-file
                    className={`flex items-center px-4 py-3 border-b border-white/5 transition-colors ${!isSelecting ? 'hover:bg-white/5' : ''}`}
                  >
                    <div className="flex items-center gap-3 flex-1 pr-4">
                      <div className="text-white/60">
                        {file.icon}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm">{file.name}</span>
                      </div>
                    </div>

                    <div className="w-px h-4 bg-white/10 mx-2"></div>

                    <div className="w-24 text-white/60 text-sm pr-4">
                      {file.type === 'file' ? formatFileSize(file.size) : ''}
                    </div>

                    <div className="w-px h-4 bg-white/10 mx-2"></div>

                    <div className="w-40 text-white/60 text-sm pr-4">
                      {formatDate(file.modified)}
                    </div>

                    <div className="w-px h-4 bg-white/10 mx-2"></div>

                    <div className="w-20 text-white/60 text-sm capitalize">
                      {file.type}
                    </div>
                  </div>
                ))}

                {getFilteredRecentFiles().length === 0 && (
                  <div className="flex items-center justify-center h-32 text-white/40 text-sm">
                    No recent files found
                  </div>
                )}
              </div>

              {/* Status Bar */}
              <div className="flex items-center justify-between px-4 py-2 bg-[rgba(32,32,32,0.5)] border-t border-white/10 text-sm text-white/60">
                <div>
                  {getFilteredRecentFiles().length} item{getFilteredRecentFiles().length !== 1 ? 's' : ''}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          visible={contextMenu.visible}
          x={contextMenu.x}
          y={contextMenu.y}
          selectedItems={contextMenu.selectedItems}
          contextType={contextMenu.contextType}
          area={contextMenu.area}
          sharedType={contextMenu.sharedType}
          onAction={handleContextMenuAction}
          onClose={closeContextMenu}
        />
      )}

      {/* Invite User Modal - Moved to Settings window */}
      {/* {showInviteModal && (
        <InviteUserModal
          onClose={() => setShowInviteModal(false)}
          onSendInvitation={handleSendInvitation}
        />
      )} */}
    </div>
  );
};


export default FileExplorer;






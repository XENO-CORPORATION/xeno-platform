import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ContainerService } from '../services/containerService';
import { containerFileSystemService } from '../services/containerFileSystemService';
import { useAuth } from './AuthContext';

export interface FileSystemItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size?: number;
  modified?: string;
  path: string;
  icon?: React.ReactNode;
  permissions?: string;
  owner?: string;
  group?: string;
  description?: string;
  isSystemVolume?: boolean;
  isUserVolume?: boolean;
}

export interface StorageInfo {
  used: number;
  total: number;
  available: number;
  percentage: number;
}

export interface ContainerInfo {
  id: string;
  name: string;
  display_name?: string;
  status: string;
  resource_limits?: {
    cpu_cores?: number;
    memory_gb?: number;
    storage_gb?: number;
  };
}

interface ContainerContextType {
  // Container information
  container: ContainerInfo | null;

  // File system data
  fileSystem: FileSystemItem[];
  currentPath: string;

  // Storage data
  storageData: {
    system?: StorageInfo;
    user?: StorageInfo;
  } | null;

  // Quick access items
  quickAccessItems: FileSystemItem[];

  // This container items (volumes)
  thisContainerItems: FileSystemItem[];

  // Loading states
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  // Methods for updating data
  refreshFileSystem: (path?: string) => Promise<void>;
  refreshStorageData: () => Promise<void>;
  createFile: (path: string, name: string, type: 'file' | 'folder') => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  renameFile: (oldPath: string, newPath: string) => Promise<void>;
  navigateToPath: (path: string) => Promise<void>;

  // Real-time updates
  startRealTimeUpdates: () => void;
  stopRealTimeUpdates: () => void;
}

const ContainerContext = createContext<ContainerContextType | undefined>(undefined);

export const useContainer = () => {
  const context = useContext(ContainerContext);
  if (context === undefined) {
    throw new Error('useContainer must be used within a ContainerProvider');
  }
  return context;
};

interface ContainerProviderProps {
  children: React.ReactNode;
}

export const ContainerProvider: React.FC<ContainerProviderProps> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();

  // Core state
  const [container, setContainer] = useState<ContainerInfo | null>(null);
  const [fileSystem, setFileSystem] = useState<FileSystemItem[]>([]);
  const [currentPath, setCurrentPath] = useState('/home/user');
  const [storageData, setStorageData] = useState<{ system?: StorageInfo; user?: StorageInfo } | null>(null);
  const [quickAccessItems, setQuickAccessItems] = useState<FileSystemItem[]>([]);
  const [thisContainerItems, setThisContainerItems] = useState<FileSystemItem[]>([]);

  // Loading states
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real-time update mechanism
  const [updateInterval, setUpdateInterval] = useState<NodeJS.Timeout | null>(null);

  // Initialize container data
  const initializeContainer = useCallback(async () => {
    if (!isAuthenticated || !user?.id) {
      setError('Authentication required');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      console.log('🚀 ContainerContext: Initializing container data...');

      // Check if we're joining a shared container (collaboration)
      const sharedContainerId = localStorage.getItem('sharedContainerId');
      let containerInfo: ContainerInfo;

      if (sharedContainerId) {
        console.log('🤝 ContainerContext: Using shared container:', sharedContainerId);
        // Get auth token from localStorage
        const token = localStorage.getItem('xenoos_auth_token');
        // Fetch the shared container info
        const response = await fetch(`/api/containers/${sharedContainerId}`, {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          }
        });
        if (!response.ok) {
          // Clear the shared container and fall back to user's own
          localStorage.removeItem('sharedContainerId');
          throw new Error('Shared container not accessible');
        }
        const data = await response.json();
        containerInfo = data.container || data;
      } else {
        // 1. Get user's own container
        const containersResponse = await ContainerService.listContainers(1, 1);
        if ('error' in containersResponse) {
          throw new Error(containersResponse.error);
        }

        if (!containersResponse.containers || containersResponse.containers.length === 0) {
          throw new Error('No containers found for user');
        }

        containerInfo = containersResponse.containers[0];
      }

      setContainer(containerInfo);

      // 2. Initialize filesystem service
      containerFileSystemService.setContainerId(containerInfo.id);

      // 3. Start container if not running
      if (containerInfo.status !== 'running') {
        console.log('⚠️ Starting container...');
        const startResult = await ContainerService.startContainer(containerInfo.id);
        if (!startResult.success) {
          throw new Error(`Failed to start container: ${startResult.error}`);
        }
        containerInfo.status = 'running';
        setContainer(containerInfo);
      }

      // 4. Load all data in parallel
      await Promise.all([
        loadFileSystem('/home/user'),
        loadStorageData(containerInfo.id),
        loadQuickAccessItems(),
        loadThisContainerItems()
      ]);

      setIsInitialized(true);
      console.log('✅ ContainerContext: Initialization complete');

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('❌ ContainerContext: Initialization failed:', errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user?.id]);

  // Load file system data
  const loadFileSystem = useCallback(async (path: string = currentPath) => {
    try {
      console.log(`📁 Loading file system for path: ${path}`);
      const result = await containerFileSystemService.listDirectory(path);

      if (result.success && result.data) {
        // Extract items array from the result data structure
        const fileSystemData = result.data.items || [];
        setFileSystem(fileSystemData);
        setCurrentPath(path);
      } else {
        console.warn('⚠️ File system load failed, setting empty array');
        setFileSystem([]);
        throw new Error(result.error || 'Failed to load file system');
      }
    } catch (err) {
      console.error('❌ Failed to load file system:', err);
      // Set empty array on error to prevent map errors
      setFileSystem([]);
      // Don't throw - just log error to avoid breaking the UI
    }
  }, [currentPath]);

  // Load storage data
  const loadStorageData = useCallback(async (containerId?: string) => {
    const targetContainerId = containerId || container?.id;

    if (!targetContainerId) {
      console.warn('⚠️ Skipping storage data load - no container ID available');
      return;
    }

    try {
      console.log('💾 Loading storage data for container:', targetContainerId);
      const result = await ContainerService.getStorageUsage(targetContainerId);

      if (result.success && result.data) {
        setStorageData(result.data);
      } else {
        console.warn('⚠️ Failed to load storage data:', result.error);
      }
    } catch (err) {
      console.error('❌ Failed to load storage data:', err);
      // Don't throw - storage data is optional
    }
  }, [container?.id]);

  // Load quick access items
  const loadQuickAccessItems = useCallback(async () => {
    try {
      console.log('⚡ Loading quick access items...');

      const standardDirs = [
        { name: 'Desktop', path: '/home/user/Desktop', icon: '🖥️' },
        { name: 'Documents', path: '/home/user/Documents', icon: '📄' },
        { name: 'Downloads', path: '/home/user/Downloads', icon: '⬇️' },
        { name: 'Pictures', path: '/home/user/Pictures', icon: '🖼️' },
        { name: 'Videos', path: '/home/user/Videos', icon: '🎬' },
        { name: 'Music', path: '/home/user/Music', icon: '🎵' },
      ];

      const items = standardDirs.map(dir => ({
        id: dir.path,
        name: dir.name,
        type: 'folder' as const,
        path: dir.path,
        icon: dir.icon
      }));

      setQuickAccessItems(items);
    } catch (err) {
      console.error('❌ Failed to load quick access items:', err);
    }
  }, []);

  // Load this container items (volumes)
  const loadThisContainerItems = useCallback(async () => {
    try {
      console.log('🐳 Loading container volumes...');

      const volumes = [
        {
          id: 'system-volume',
          name: 'System Volume (X:)',
          type: 'folder' as const,
          path: '/',
          icon: '🔧',
          description: 'Container system files and OS',
          isSystemVolume: true,
          isUserVolume: false
        },
        {
          id: 'user-volume',
          name: 'Cloud Volume (Z:)',
          type: 'folder' as const,
          path: '/home/user',
          icon: '☁️',
          description: 'Your personal storage space',
          isSystemVolume: false,
          isUserVolume: true
        }
      ];

      setThisContainerItems(volumes);
    } catch (err) {
      console.error('❌ Failed to load container volumes:', err);
    }
  }, []);

  // File operations
  const createFile = useCallback(async (path: string, name: string, type: 'file' | 'folder') => {
    try {
      console.log(`📝 Creating ${type}: ${path}/${name}`);

      // Optimistic update
      const newItem: FileSystemItem = {
        id: `${path}/${name}`,
        name,
        type,
        path: `${path}/${name}`,
        size: type === 'file' ? 0 : undefined,
        modified: new Date().toISOString()
      };

      setFileSystem(prev => [...prev, newItem]);

      // API call
      const result = type === 'folder'
        ? await containerFileSystemService.createDirectory(`${path}/${name}`)
        : await containerFileSystemService.createFile(`${path}/${name}`, '');

      if (!result.success) {
        // Revert optimistic update
        setFileSystem(prev => prev.filter(item => item.id !== newItem.id));
        throw new Error(result.error || `Failed to create ${type}`);
      }

      // Refresh to get accurate data
      await loadFileSystem(currentPath);

    } catch (err) {
      console.error(`❌ Failed to create ${type}:`, err);
      throw err;
    }
  }, [currentPath, loadFileSystem]);

  const deleteFile = useCallback(async (path: string) => {
    try {
      console.log(`🗑️ Deleting: ${path}`);

      // Optimistic update
      setFileSystem(prev => prev.filter(item => item.path !== path));

      // API call
      const result = await containerFileSystemService.deleteFile(path);

      if (!result.success) {
        // Revert optimistic update
        await loadFileSystem(currentPath);
        throw new Error(result.error || 'Failed to delete file');
      }

    } catch (err) {
      console.error('❌ Failed to delete file:', err);
      throw err;
    }
  }, [currentPath, loadFileSystem]);

  const renameFile = useCallback(async (oldPath: string, newPath: string) => {
    try {
      console.log(`✏️ Renaming: ${oldPath} → ${newPath}`);

      // Optimistic update
      setFileSystem(prev => prev.map(item =>
        item.path === oldPath
          ? { ...item, path: newPath, name: newPath.split('/').pop() || item.name }
          : item
      ));

      // API call (assuming we have a rename method)
      // const result = await containerFileSystemService.renameFile(oldPath, newPath);

      // For now, just refresh
      await loadFileSystem(currentPath);

    } catch (err) {
      console.error('❌ Failed to rename file:', err);
      await loadFileSystem(currentPath); // Revert
      throw err;
    }
  }, [currentPath, loadFileSystem]);

  // Navigation
  const navigateToPath = useCallback(async (path: string) => {
    await loadFileSystem(path);
  }, [loadFileSystem]);

  // Refresh methods
  const refreshFileSystem = useCallback(async (path?: string) => {
    await loadFileSystem(path || currentPath);
  }, [loadFileSystem, currentPath]);

  const refreshStorageData = useCallback(async () => {
    await loadStorageData(container?.id);
  }, [loadStorageData, container?.id]);

  // Real-time updates
  const startRealTimeUpdates = useCallback(() => {
    if (updateInterval) return; // Already running

    console.log('🔄 Starting real-time updates...');

    const interval = setInterval(async () => {
      try {
        // Refresh storage data every 30 seconds
        await refreshStorageData();

        // Could also check for file system changes here
        // For now, we'll rely on user actions to update file system
      } catch (err) {
        console.warn('⚠️ Real-time update failed:', err);
      }
    }, 30000); // 30 seconds

    setUpdateInterval(interval);
  }, [updateInterval, refreshStorageData]);

  const stopRealTimeUpdates = useCallback(() => {
    if (updateInterval) {
      console.log('⏹️ Stopping real-time updates...');
      clearInterval(updateInterval);
      setUpdateInterval(null);
    }
  }, [updateInterval]);

  // Initialize when provider mounts
  useEffect(() => {
    // Don't retry if there's already an error (prevents infinite loop)
    if (isAuthenticated && user?.id && !isInitialized && !isLoading && !error) {
      initializeContainer();
    }
  }, [isAuthenticated, user?.id, isInitialized, isLoading, error, initializeContainer]);

  // Start real-time updates when initialized
  useEffect(() => {
    if (isInitialized) {
      startRealTimeUpdates();
    }

    return () => {
      stopRealTimeUpdates();
    };
  }, [isInitialized, startRealTimeUpdates, stopRealTimeUpdates]);

  const contextValue: ContainerContextType = {
    // Data
    container,
    fileSystem,
    currentPath,
    storageData,
    quickAccessItems,
    thisContainerItems,

    // States
    isLoading,
    isInitialized,
    error,

    // Methods
    refreshFileSystem,
    refreshStorageData,
    createFile,
    deleteFile,
    renameFile,
    navigateToPath,
    startRealTimeUpdates,
    stopRealTimeUpdates,
  };

  return (
    <ContainerContext.Provider value={contextValue}>
      {children}
    </ContainerContext.Provider>
  );
};
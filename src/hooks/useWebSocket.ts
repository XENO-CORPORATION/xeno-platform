// React Hook for WebSocket File Synchronization
// Provides easy-to-use interface for real-time file operations in React components

import { useEffect, useState, useCallback, useRef } from 'react';
import { webSocketService, WebSocketMessage, FileChangeEvent } from '../services/webSocketService';

export interface UseWebSocketOptions {
  autoConnect?: boolean;
  onFileChange?: (event: FileChangeEvent) => void;
  onAuthenticated?: (message: WebSocketMessage) => void;
  onError?: (message: WebSocketMessage) => void;
}

export interface UseWebSocketReturn {
  isConnected: boolean;
  clientId: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  authenticate: (token: string) => void;
  readFile: (filePath: string) => void;
  writeFile: (filePath: string, content: string) => void;
  deleteFile: (filePath: string) => void;
  listDirectory: (directoryPath: string) => void;
  watchDirectories: (directories: string[]) => Promise<void>;
  unwatchDirectories: (directories: string[]) => Promise<void>;
  getWatchedDirectories: () => Promise<string[]>;
  lastMessage: WebSocketMessage | null;
  error: string | null;
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    autoConnect = true,
    onFileChange,
    onAuthenticated,
    onError
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Use refs to avoid stale closures in event handlers
  const onFileChangeRef = useRef(onFileChange);
  const onAuthenticatedRef = useRef(onAuthenticated);
  const onErrorRef = useRef(onError);

  // Update refs when callbacks change
  useEffect(() => {
    onFileChangeRef.current = onFileChange;
    onAuthenticatedRef.current = onAuthenticated;
    onErrorRef.current = onError;
  }, [onFileChange, onAuthenticated, onError]);

  // Set up event handlers
  useEffect(() => {
    const handleConnectionChange = () => {
      setIsConnected(webSocketService.isWebSocketConnected);
      setClientId(webSocketService.clientId);
    };

    const handleFileChange = (message: WebSocketMessage) => {
      setLastMessage(message);
      onFileChangeRef.current?.(message as FileChangeEvent);
    };

    const handleAuthenticated = (message: WebSocketMessage) => {
      setLastMessage(message);
      onAuthenticatedRef.current?.(message);
    };

    const handleError = (message: WebSocketMessage) => {
      setError(message.message || 'WebSocket error');
      setLastMessage(message);
      onErrorRef.current?.(message);
    };

    const handleWelcome = (message: WebSocketMessage) => {
      setLastMessage(message);
      handleConnectionChange();
    };

    // Register event handlers
    webSocketService.on('file_change', handleFileChange);
    webSocketService.on('authenticated', handleAuthenticated);
    webSocketService.on('auth_error', handleError);
    webSocketService.on('error', handleError);
    webSocketService.on('welcome', handleWelcome);
    webSocketService.on('file_content', (msg) => setLastMessage(msg));
    webSocketService.on('file_operation_success', (msg) => setLastMessage(msg));
    webSocketService.on('directory_listing', (msg) => setLastMessage(msg));

    // Initial connection check
    handleConnectionChange();

    // Auto-connect if requested
    if (autoConnect) {
      webSocketService.connect().catch(err => {
        console.error('Auto-connect failed:', err);
        setError('Failed to connect to WebSocket server');
      });
    }

    // Cleanup
    return () => {
      webSocketService.off('file_change', handleFileChange);
      webSocketService.off('authenticated', handleAuthenticated);
      webSocketService.off('auth_error', handleError);
      webSocketService.off('error', handleError);
      webSocketService.off('welcome', handleWelcome);
    };
  }, [autoConnect]);

  // Connection methods
  const connect = useCallback(async () => {
    try {
      setError(null);
      await webSocketService.connect();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Connection failed';
      setError(errorMessage);
      throw err;
    }
  }, []);

  const disconnect = useCallback(() => {
    webSocketService.disconnect();
  }, []);

  const authenticate = useCallback((token: string) => {
    webSocketService.authenticate(token);
  }, []);

  // File operation methods
  const readFile = useCallback((filePath: string) => {
    webSocketService.readFile(filePath);
  }, []);

  const writeFile = useCallback((filePath: string, content: string) => {
    webSocketService.writeFile(filePath, content);
  }, []);

  const deleteFile = useCallback((filePath: string) => {
    webSocketService.deleteFile(filePath);
  }, []);

  const listDirectory = useCallback((directoryPath: string) => {
    webSocketService.listDirectory(directoryPath);
  }, []);

  const watchDirectories = useCallback(async (directories: string[]) => {
    try {
      setError(null);
      await webSocketService.watchDirectories(directories);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to watch directories';
      setError(errorMessage);
      throw err;
    }
  }, []);

  const unwatchDirectories = useCallback(async (directories: string[]) => {
    try {
      setError(null);
      await webSocketService.unwatchDirectories(directories);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to unwatch directories';
      setError(errorMessage);
      throw err;
    }
  }, []);

  const getWatchedDirectories = useCallback(async () => {
    try {
      return await webSocketService.getWatchedDirectories();
    } catch (err) {
      console.error('Failed to get watched directories:', err);
      return [];
    }
  }, []);

  return {
    isConnected,
    clientId,
    connect,
    disconnect,
    authenticate,
    readFile,
    writeFile,
    deleteFile,
    listDirectory,
    watchDirectories,
    unwatchDirectories,
    getWatchedDirectories,
    lastMessage,
    error
  };
}

// Hook for file synchronization status
export function useFileSync() {
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const { isConnected, watchDirectories, unwatchDirectories, getWatchedDirectories } = useWebSocket({
    onFileChange: (event) => {
      setSyncStatus('syncing');
      setLastSyncTime(new Date());

      // Reset status after a short delay
      setTimeout(() => {
        setSyncStatus('idle');
      }, 1000);
    },
    onError: () => {
      setSyncStatus('error');
    }
  });

  return {
    syncStatus,
    lastSyncTime,
    isConnected,
    watchDirectories,
    unwatchDirectories,
    getWatchedDirectories
  };
}

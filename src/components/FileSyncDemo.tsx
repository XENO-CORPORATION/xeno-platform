// Real-time File Synchronization Demo Component
// Demonstrates how to use WebSocket file sync in the XenoStudio interface

import React, { useState, useEffect } from 'react';
import { useWebSocket, useFileSync } from '../hooks/useWebSocket';
import { authService } from '../services/authService';

interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: Date;
}

export function FileSyncDemo() {
  const [currentDirectory, setCurrentDirectory] = useState<string>('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [watchedDirs, setWatchedDirs] = useState<string[]>([]);

  const {
    isConnected,
    clientId,
    connect,
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
  } = useWebSocket({
    onFileChange: (event) => {
      console.log('📁 File changed:', event);
      // Refresh directory listing when files change
      if (currentDirectory && event.filePath.startsWith(currentDirectory)) {
        listDirectory(currentDirectory);
      }
    },
    onAuthenticated: () => {
      console.log('✅ WebSocket authenticated');
      // Load initial watched directories
      getWatchedDirectories().then(setWatchedDirs);
    }
  });

  const { syncStatus, lastSyncTime } = useFileSync();

  // Authenticate when component mounts (optional for demo purposes)
  useEffect(() => {
    const token = authService.getToken();
    if (token && isConnected) {
      authenticate(token);
    }
    // Note: WebSocket server allows basic operations without authentication
  }, [isConnected, authenticate]);

  // Handle directory navigation
  const handleDirectoryClick = (dirPath: string) => {
    setCurrentDirectory(dirPath);
    listDirectory(dirPath);
    setSelectedFile(null);
    setFileContent('');
    setIsEditing(false);
  };

  // Handle file selection
  const handleFileClick = (filePath: string) => {
    setSelectedFile(filePath);
    readFile(filePath);
    setIsEditing(false);
  };

  // Handle file content received
  useEffect(() => {
    if (lastMessage && lastMessage.type === 'file_content' && lastMessage.filePath === selectedFile) {
      setFileContent(lastMessage.content || '');
    }
  }, [lastMessage, selectedFile]);

  // Handle directory listing received
  useEffect(() => {
    if (lastMessage && lastMessage.type === 'directory_listing' && lastMessage.directory === currentDirectory) {
      setFiles(lastMessage.items || []);
    }
  }, [lastMessage, currentDirectory]);

  // Handle file save
  const handleSaveFile = () => {
    if (selectedFile && fileContent !== undefined) {
      writeFile(selectedFile, fileContent);
      setIsEditing(false);
    }
  };

  // Handle file delete
  const handleDeleteFile = (filePath: string) => {
    if (confirm(`Are you sure you want to delete ${filePath}?`)) {
      deleteFile(filePath);
    }
  };

  // Handle directory watching
  const handleWatchDirectory = async (dirPath: string) => {
    try {
      await watchDirectories([dirPath]);
      const updatedDirs = await getWatchedDirectories();
      setWatchedDirs(updatedDirs);
    } catch (err) {
      console.error('Failed to watch directory:', err);
    }
  };

  const handleUnwatchDirectory = async (dirPath: string) => {
    try {
      await unwatchDirectories([dirPath]);
      const updatedDirs = await getWatchedDirectories();
      setWatchedDirs(updatedDirs);
    } catch (err) {
      console.error('Failed to unwatch directory:', err);
    }
  };

  return (
    <div className="file-sync-demo p-4 bg-gray-900 text-white rounded-lg">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Real-time File Synchronization</h3>

        {/* Connection Status */}
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="text-sm">
            {isConnected ? 'Connected' : 'Disconnected'}
            {clientId && ` (ID: ${clientId})`}
          </span>
          {!isConnected && (
            <button
              onClick={connect}
              className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
            >
              Connect
            </button>
          )}
        </div>

        {/* Sync Status */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">Sync Status:</span>
          <span className={`text-sm ${syncStatus === 'syncing' ? 'text-yellow-400' : syncStatus === 'error' ? 'text-red-400' : 'text-green-400'}`}>
            {syncStatus}
          </span>
          {lastSyncTime && (
            <span className="text-xs text-gray-400">
              (Last: {lastSyncTime.toLocaleTimeString()})
            </span>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-2 p-2 bg-red-900 border border-red-700 rounded text-sm">
            Error: {error}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Directory Browser */}
        <div className="bg-gray-800 p-3 rounded">
          <h4 className="font-medium mb-2">File Browser</h4>

          {/* Current Directory */}
          <div className="mb-2">
            <input
              type="text"
              value={currentDirectory}
              onChange={(e) => setCurrentDirectory(e.target.value)}
              placeholder="Enter directory path"
              className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleDirectoryClick(currentDirectory);
                }
              }}
            />
            <button
              onClick={() => handleDirectoryClick(currentDirectory)}
              className="mt-1 px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
            >
              Load Directory
            </button>
          </div>

          {/* Directory Controls */}
          {currentDirectory && (
            <div className="mb-2 flex gap-1">
              <button
                onClick={() => handleWatchDirectory(currentDirectory)}
                disabled={watchedDirs.includes(currentDirectory)}
                className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50"
              >
                Watch
              </button>
              <button
                onClick={() => handleUnwatchDirectory(currentDirectory)}
                disabled={!watchedDirs.includes(currentDirectory)}
                className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 disabled:opacity-50"
              >
                Unwatch
              </button>
            </div>
          )}

          {/* File List */}
          <div className="max-h-64 overflow-y-auto">
            {files.map((file) => (
              <div
                key={file.path}
                className={`flex items-center justify-between p-1 rounded cursor-pointer hover:bg-gray-700 ${
                  selectedFile === file.path ? 'bg-blue-700' : ''
                }`}
                onClick={() => file.type === 'directory' ? handleDirectoryClick(file.path) : handleFileClick(file.path)}
              >
                <div className="flex items-center gap-2">
                  <span className={file.type === 'directory' ? 'text-blue-400' : 'text-gray-300'}>
                    {file.type === 'directory' ? '📁' : '📄'}
                  </span>
                  <span className="text-sm">{file.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  {file.size && <span className="text-xs text-gray-400">{file.size}B</span>}
                  {file.type === 'file' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFile(file.path);
                      }}
                      className="px-1 py-0.5 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* File Editor */}
        <div className="bg-gray-800 p-3 rounded">
          <h4 className="font-medium mb-2">File Editor</h4>

          {selectedFile ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-300">{selectedFile}</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setIsEditing(!isEditing)}
                    className="px-2 py-1 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-700"
                  >
                    {isEditing ? 'Cancel' : 'Edit'}
                  </button>
                  {isEditing && (
                    <button
                      onClick={handleSaveFile}
                      className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
                    >
                      Save
                    </button>
                  )}
                </div>
              </div>

              {isEditing ? (
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="w-full h-64 px-2 py-1 bg-gray-700 text-white rounded text-sm font-mono"
                  placeholder="File content..."
                />
              ) : (
                <pre className="w-full h-64 px-2 py-1 bg-gray-700 text-white rounded text-sm font-mono overflow-auto whitespace-pre-wrap">
                  {fileContent || 'Select a file to view its content'}
                </pre>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-500">
              Select a file to edit
            </div>
          )}
        </div>
      </div>

      {/* Watched Directories */}
      {watchedDirs.length > 0 && (
        <div className="mt-4">
          <h4 className="font-medium mb-2">Watched Directories</h4>
          <div className="flex flex-wrap gap-2">
            {watchedDirs.map((dir) => (
              <div key={dir} className="px-2 py-1 bg-green-800 text-white rounded text-sm">
                📁 {dir}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

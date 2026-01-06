/**
 * XenoOS Terminal Window Component
 * Integrates terminal with desktop window management system
 */

import React, { useState, useEffect, useCallback } from 'react';
import { MultiTerminal } from '../../terminal/MultiTerminal';
import { ContainerService } from '../../../services/containerService';
import { 
  Terminal as TerminalIcon, 
  Settings, 
  Maximize2, 
  Minimize2, 
  X,
  AlertCircle,
  Loader2,
  Play,
  Square,
  RotateCcw
} from 'lucide-react';

interface TerminalWindowProps {
  containerId?: string;
  windowId: string;
  isActive: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  position: { x: number; y: number };
  size: { width: number; height: number };
  onPositionChange: (position: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
}

interface ContainerInfo {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'error';
  config?: any;
  portMappings?: { [key: string]: number };
  stats?: any;
}

export const TerminalWindow: React.FC<TerminalWindowProps> = ({
  containerId,
  windowId,
  isActive,
  onClose,
  onMinimize,
  onMaximize,
  position,
  size,
  onPositionChange,
  onSizeChange
}) => {
  const [containerInfo, setContainerInfo] = useState<ContainerInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showContainerInfo, setShowContainerInfo] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Fetch container information
  const fetchContainerInfo = useCallback(async () => {
    if (!containerId) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`/api/terminal/container/${containerId}`);
      const data = await response.json();

      if (data.success) {
        setContainerInfo(data.data);
      } else {
        setError(data.error || 'Failed to fetch container information');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsLoading(false);
    }
  }, [containerId]);

  // Container actions
  const startContainer = useCallback(async () => {
    if (!containerId) return;

    try {
      const response = await ContainerService.startContainer(containerId);
      if (response.success) {
        await fetchContainerInfo();
      } else {
        setError(response.error || 'Failed to start container');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start container');
    }
  }, [containerId, fetchContainerInfo]);

  const stopContainer = useCallback(async () => {
    if (!containerId) return;

    try {
      const response = await ContainerService.stopContainer(containerId);
      if (response.success) {
        await fetchContainerInfo();
      } else {
        setError(response.error || 'Failed to stop container');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop container');
    }
  }, [containerId, fetchContainerInfo]);

  const restartContainer = useCallback(async () => {
    await stopContainer();
    setTimeout(async () => {
      await startContainer();
    }, 2000);
  }, [stopContainer, startContainer]);

  // Dragging functionality
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.window-content, .resize-handle')) return;
    
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;

    const newX = Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - size.width));
    const newY = Math.max(0, Math.min(e.clientY - dragOffset.y, window.innerHeight - size.height));

    onPositionChange({ x: newX, y: newY });
  }, [isDragging, dragOffset, size, onPositionChange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
  }, []);

  // Resize functionality
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsResizing(true);
    setDragOffset({
      x: e.clientX - size.width,
      y: e.clientY - size.height
    });
  }, [size]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const newWidth = Math.max(400, Math.min(e.clientX - position.x, window.innerWidth - position.x));
    const newHeight = Math.max(300, Math.min(e.clientY - position.y, window.innerHeight - position.y));

    onSizeChange({ width: newWidth, height: newHeight });
  }, [isResizing, position, onSizeChange]);

  // Mouse event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, handleMouseMove, handleResizeMove, handleMouseUp]);

  // Initial data fetch
  useEffect(() => {
    fetchContainerInfo();
    
    // Refresh container info periodically
    const interval = setInterval(fetchContainerInfo, 30000); // Every 30 seconds
    return () => clearInterval(interval);
  }, [fetchContainerInfo]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#10b981';
      case 'stopped': return '#f59e0b';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  return (
    <div
      className={`
        terminal-window fixed bg-gray-900 border border-gray-700 rounded-lg shadow-2xl
        ${isActive ? 'z-50' : 'z-40'}
        ${isDragging || isResizing ? 'select-none' : ''}
      `}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
    >
      {/* Title Bar */}
      <div 
        className={`
          title-bar flex items-center justify-between px-4 py-2 bg-gray-800 rounded-t-lg cursor-move
          ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}
        `}
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-3">
          <TerminalIcon className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-white">
            Terminal {containerInfo?.name ? `- ${containerInfo.name}` : ''}
          </span>
          {containerInfo && (
            <div 
              className="flex items-center gap-1 text-xs px-2 py-1 rounded"
              style={{ backgroundColor: getStatusColor(containerInfo.status) + '20', color: getStatusColor(containerInfo.status) }}
            >
              <div 
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: getStatusColor(containerInfo.status) }}
              />
              {containerInfo.status}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Container Controls */}
          {containerInfo && (
            <div className="flex items-center gap-1 mr-2">
              {containerInfo.status === 'stopped' && (
                <button
                  onClick={startContainer}
                  className="p-1 text-green-400 hover:bg-gray-700 rounded transition-colors"
                  title="Start container"
                >
                  <Play className="w-3 h-3" />
                </button>
              )}
              {containerInfo.status === 'running' && (
                <button
                  onClick={stopContainer}
                  className="p-1 text-red-400 hover:bg-gray-700 rounded transition-colors"
                  title="Stop container"
                >
                  <Square className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={restartContainer}
                className="p-1 text-yellow-400 hover:bg-gray-700 rounded transition-colors"
                title="Restart container"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              <button
                onClick={() => setShowContainerInfo(!showContainerInfo)}
                className="p-1 text-gray-400 hover:bg-gray-700 rounded transition-colors"
                title="Container info"
              >
                <Settings className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Window Controls */}
          <button
            onClick={onMinimize}
            className="p-1 text-gray-400 hover:text-yellow-400 hover:bg-gray-700 rounded transition-colors"
            title="Minimize"
          >
            <Minimize2 className="w-3 h-3" />
          </button>
          <button
            onClick={onMaximize}
            className="p-1 text-gray-400 hover:text-green-400 hover:bg-gray-700 rounded transition-colors"
            title="Maximize"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
            title="Close"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Container Info Panel */}
      {showContainerInfo && containerInfo && (
        <div className="bg-gray-850 border-b border-gray-700 p-3 text-xs">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-gray-400 mb-1">Container ID</div>
              <div className="text-white font-mono">{containerInfo.id.substring(0, 12)}...</div>
            </div>
            <div>
              <div className="text-gray-400 mb-1">Status</div>
              <div className="text-white">{containerInfo.status}</div>
            </div>
            {containerInfo.stats && (
              <>
                <div>
                  <div className="text-gray-400 mb-1">CPU Usage</div>
                  <div className="text-white">{containerInfo.stats.cpu.percent.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-gray-400 mb-1">Memory Usage</div>
                  <div className="text-white">{containerInfo.stats.memory.usageMB} / {containerInfo.stats.memory.limitMB} MB</div>
                </div>
              </>
            )}
            {containerInfo.portMappings && Object.keys(containerInfo.portMappings).length > 0 && (
              <div className="col-span-2">
                <div className="text-gray-400 mb-1">Port Mappings</div>
                <div className="text-white space-x-2">
                  {Object.entries(containerInfo.portMappings).map(([container, host]) => (
                    <span key={container} className="bg-gray-700 px-2 py-1 rounded">
                      {container}→{host}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Window Content */}
      <div className="window-content flex-1 h-full overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading container...
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-red-400">
              <AlertCircle className="w-8 h-8 mx-auto mb-2" />
              <div className="text-sm mb-2">Container Error</div>
              <div className="text-xs text-gray-500">{error}</div>
              <button
                onClick={fetchContainerInfo}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        ) : containerId && containerInfo?.status === 'running' ? (
          <MultiTerminal
            containerId={containerId}
            className="h-full"
            allowMultiUser={true}
            maxTabs={10}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-400">
              <TerminalIcon className="w-8 h-8 mx-auto mb-2" />
              <div className="text-sm mb-2">
                {containerInfo?.status === 'stopped' ? 'Container is stopped' : 'No container available'}
              </div>
              {containerInfo?.status === 'stopped' && (
                <button
                  onClick={startContainer}
                  className="mt-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                >
                  Start Container
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Resize Handle */}
      <div
        className="resize-handle absolute bottom-0 right-0 w-3 h-3 cursor-se-resize"
        onMouseDown={handleResizeStart}
      >
        <div className="absolute bottom-0 right-0 w-2 h-2 bg-gray-600 rounded-tl"></div>
      </div>
    </div>
  );
};

export default TerminalWindow;
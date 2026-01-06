import React, { useState, useEffect } from 'react';
import { Cpu, MemoryStick, HardDrive, Activity, RefreshCw } from 'lucide-react';
import { ContainerService } from '../../../services/containerService';

const TaskManager: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const containers = await ContainerService.listContainers(1, 1);
        
        if ('success' in containers && containers.success === false) {
           throw new Error(containers.error);
        }

        const containerList = (containers as any).containers;
        
        if (containerList && containerList.length > 0) {
          const activeContainer = containerList[0];
          const statsResult = await ContainerService.getContainerStats(activeContainer.id);
          
          if (statsResult.success) {
            setStats({
              ...statsResult.data,
              name: activeContainer.display_name || activeContainer.name
            });
            setError(null);
          } else {
            setError('Failed to fetch statistics');
          }
        } else {
          setError('No active containers found');
        }
      } catch (err) {
        setError('Error connecting to container service');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    
    // Auto refresh every 5 seconds
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [refreshKey]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading && !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#1e1e1e] text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4"></div>
        <p>Connecting to container...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#1e1e1e] text-red-400 p-6 text-center">
        <Activity size={48} className="mb-4 opacity-50" />
        <p className="text-lg font-medium mb-2">Connection Failed</p>
        <p className="text-sm opacity-80">{error}</p>
        <button 
          onClick={() => setRefreshKey(k => k + 1)}
          className="mt-6 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-md text-white transition-colors flex items-center gap-2"
        >
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-white p-6 overflow-y-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-xl font-bold">{stats.name || 'Container Monitor'}</h2>
          <p className="text-sm text-gray-400 font-mono mt-1">ID: {stats.containerId?.substring(0, 12)}...</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-green-500"></span>
          <span className="text-sm text-green-500 font-medium">Running</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CPU Usage */}
        <div className="bg-[#2d2d2d] p-5 rounded-xl border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Cpu size={20} className="text-blue-400" />
              </div>
              <h3 className="font-medium text-gray-200">CPU Usage</h3>
            </div>
            <span className="text-2xl font-bold">{stats.usage.cpu}%</span>
          </div>
          <div className="w-full bg-black/40 rounded-full h-2.5 overflow-hidden">
            <div 
              className="bg-blue-500 h-2.5 rounded-full transition-all duration-500" 
              style={{ width: `${Math.min(stats.usage.cpu, 100)}%` }}
            />
          </div>
        </div>

        {/* Memory Usage */}
        <div className="bg-[#2d2d2d] p-5 rounded-xl border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <MemoryStick size={20} className="text-purple-400" />
              </div>
              <h3 className="font-medium text-gray-200">Memory</h3>
            </div>
            <span className="text-2xl font-bold">{stats.usage.memory}%</span>
          </div>
          <div className="w-full bg-black/40 rounded-full h-2.5 overflow-hidden mb-2">
            <div 
              className="bg-purple-500 h-2.5 rounded-full transition-all duration-500" 
              style={{ width: `${Math.min(stats.usage.memory, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>Used: {formatBytes(stats.usage.memoryUsage)}</span>
            <span>Limit: {formatBytes(stats.usage.memoryLimit)}</span>
          </div>
        </div>

        {/* Network */}
        <div className="bg-[#2d2d2d] p-5 rounded-xl border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <Activity size={20} className="text-green-400" />
              </div>
              <h3 className="font-medium text-gray-200">Network</h3>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Incoming (RX)</span>
              <span className="font-mono">{formatBytes(stats.usage.networkRx)}</span>
            </div>
            <div className="w-full bg-black/40 h-px" />
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Outgoing (TX)</span>
              <span className="font-mono">{formatBytes(stats.usage.networkTx)}</span>
            </div>
          </div>
        </div>

        {/* Processes */}
        <div className="bg-[#2d2d2d] p-5 rounded-xl border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/20 rounded-lg">
                <HardDrive size={20} className="text-orange-400" />
              </div>
              <h3 className="font-medium text-gray-200">Processes</h3>
            </div>
            <span className="text-2xl font-bold">{stats.usage.pids}</span>
          </div>
          <div className="text-sm text-gray-400">
            Active PIDs in container
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskManager;

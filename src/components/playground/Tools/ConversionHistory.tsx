/**
 * Conversion History Page
 * Displays user's conversion history with download, delete, and storage management
 */

import React, { useState, useEffect } from 'react';
import {
  RefreshCw, Download, Trash2, Clock, Check, AlertCircle, X,
  HardDrive, Zap, TrendingUp, Filter, Search, Calendar,
  ChevronLeft, ChevronRight, Grid, List, MoreVertical
} from 'lucide-react';
import ConversionService from '../../../services/conversionService';

interface ConversionRecord {
  id: string;
  originalName: string;
  inputFormat: string;
  outputFormat: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  fileSize: number;
  outputSize?: number;
  createdAt: string;
  completedAt?: string;
  downloadUrl?: string;
}

interface StorageUsage {
  totalFiles: number;
  totalSize: number;
  limit: number;
  percentage: number;
  available: number;
}

const ConversionHistory: React.FC = () => {
  const [conversions, setConversions] = useState<ConversionRecord[]>([]);
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);
  const [isDeleting, setIsDeleting] = useState(false);

  const conversionService = new ConversionService();

  // Load conversions and storage on mount
  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      // Auto-refresh for processing conversions
      if (conversions.some(c => c.status === 'processing' || c.status === 'pending')) {
        loadData();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [currentPage]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Load conversions
      const historyResult = await conversionService.getConversionHistory(currentPage, itemsPerPage);
      if (historyResult.success && historyResult.data) {
        setConversions(historyResult.data.conversions);
      }

      // Load storage usage
      const storageResult = await conversionService.getStorageUsage();
      if (storageResult.success && storageResult.data) {
        setStorage(storageResult.data);
      }
    } catch (error) {
      console.error('Error loading conversion history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async (conversion: ConversionRecord) => {
    if (!conversion.downloadUrl) return;
    
    try {
      const filename = `${conversion.originalName.split('.')[0]}.${conversion.outputFormat}`;
      await conversionService.downloadConvertedFile(conversion.id, filename);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download file');
    }
  };

  const handleDelete = async (conversionId: string) => {
    if (!confirm('Are you sure you want to delete this conversion?')) return;

    setIsDeleting(true);
    try {
      const result = await conversionService.deleteConversion(conversionId);
      if (result.success) {
        setConversions(prev => prev.filter(c => c.id !== conversionId));
        setSelectedIds(prev => prev.filter(id => id !== conversionId));
        await loadData(); // Reload to update storage
      } else {
        alert('Failed to delete conversion: ' + result.error);
      }
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete conversion');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} conversion(s)?`)) return;

    setIsDeleting(true);
    try {
      for (const id of selectedIds) {
        await conversionService.deleteConversion(id);
      }
      setConversions(prev => prev.filter(c => !selectedIds.includes(c.id)));
      setSelectedIds([]);
      await loadData();
    } catch (error) {
      console.error('Batch delete failed:', error);
      alert('Failed to delete some conversions');
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <Check size={16} className="text-emerald-400" />;
      case 'processing':
      case 'pending':
        return <RefreshCw size={16} className="text-blue-400 animate-spin" />;
      case 'failed':
        return <AlertCircle size={16} className="text-red-400" />;
      default:
        return <Clock size={16} className="text-white/40" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'processing':
        return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
      case 'pending':
        return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
      case 'failed':
        return 'text-red-400 bg-red-400/10 border-red-400/20';
      default:
        return 'text-white/40 bg-white/5 border-white/10';
    }
  };

  // Filter conversions
  const filteredConversions = conversions.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false;
    if (searchTerm && !c.originalName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-white">
      {/* Header */}
      <div className="border-b border-white/[0.08] bg-[#141414]/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold mb-1">Conversion History</h1>
            <p className="text-sm text-white/50">View and manage your file conversions</p>
          </div>
          <button
            onClick={loadData}
            disabled={isLoading}
            className="px-4 py-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-all disabled:opacity-50"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Storage Usage */}
        {storage && (
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <HardDrive size={16} className="text-white/60" />
                <span className="text-sm font-medium">Storage Usage</span>
              </div>
              <span className="text-sm text-white/70">
                {formatFileSize(storage.totalSize)} / {formatFileSize(storage.limit)}
              </span>
            </div>
            <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  storage.percentage > 90
                    ? 'bg-gradient-to-r from-red-500 to-red-400'
                    : storage.percentage > 70
                    ? 'bg-gradient-to-r from-yellow-500 to-yellow-400'
                    : 'bg-gradient-to-r from-blue-500 to-emerald-500'
                }`}
                style={{ width: `${storage.percentage}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-white/50">
              <span>{storage.totalFiles} files</span>
              <span>{formatFileSize(storage.available)} available</span>
            </div>
          </div>
        )}
      </div>

      {/* Filters & Search */}
      <div className="border-b border-white/[0.08] bg-[#141414]/30 p-4">
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              placeholder="Search conversions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-blue-500/50 transition-all"
            />
          </div>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-blue-500/50 transition-all"
          >
            <option value="all">All Status</option>
            <option value="completed">Completed</option>
            <option value="processing">Processing</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>

          {/* View Mode */}
          <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.08] rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'}`}
            >
              <List size={14} className="text-white/60" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'}`}
            >
              <Grid size={14} className="text-white/60" />
            </button>
          </div>

          {/* Batch Actions */}
          {selectedIds.length > 0 && (
            <button
              onClick={handleBatchDelete}
              disabled={isDeleting}
              className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
            >
              <Trash2 size={14} className="inline mr-1" />
              Delete {selectedIds.length}
            </button>
          )}
        </div>
      </div>

      {/* Conversions List */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && conversions.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw size={24} className="text-white/40 animate-spin" />
          </div>
        ) : filteredConversions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Calendar size={48} className="text-white/20 mb-4" />
            <h3 className="text-lg font-medium text-white/70 mb-2">No conversions found</h3>
            <p className="text-sm text-white/40">
              {searchTerm || filterStatus !== 'all'
                ? 'Try adjusting your filters'
                : 'Start converting files to see them here'}
            </p>
          </div>
        ) : viewMode === 'list' ? (
          <div className="space-y-2">
            {filteredConversions.map((conversion) => (
              <div
                key={conversion.id}
                className={`group bg-[#141414] border border-white/[0.08] hover:border-white/[0.12] rounded-xl p-4 transition-all ${
                  selectedIds.includes(conversion.id) ? 'ring-1 ring-blue-500/50' : ''
                }`}
              >
                <div className="flex items-center gap-4">
                  {/* Selection Checkbox */}
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(conversion.id)}
                    onChange={() => toggleSelection(conversion.id)}
                    className="w-4 h-4 rounded border-white/20 bg-white/5 checked:bg-blue-500 focus:ring-2 focus:ring-blue-500/50"
                  />

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-medium text-white/90 truncate">{conversion.originalName}</h4>
                      <span className={`px-2 py-0.5 rounded text-xs border ${getStatusColor(conversion.status)}`}>
                        {conversion.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-white/50">
                      <span>{conversion.inputFormat.toUpperCase()} → {conversion.outputFormat.toUpperCase()}</span>
                      <span>{formatFileSize(conversion.fileSize)}</span>
                      <span>{formatDate(conversion.createdAt)}</span>
                    </div>
                  </div>

                  {/* Status Icon */}
                  <div className="flex items-center gap-2">
                    {getStatusIcon(conversion.status)}
                    {conversion.status === 'processing' && (
                      <span className="text-xs text-white/60">{conversion.progress}%</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {conversion.status === 'completed' && conversion.downloadUrl && (
                      <button
                        onClick={() => handleDownload(conversion)}
                        className="p-2 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded-lg transition-all"
                        title="Download"
                      >
                        <Download size={14} className="text-blue-400" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(conversion.id)}
                      disabled={isDeleting}
                      className="p-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg transition-all disabled:opacity-50"
                      title="Delete"
                    >
                      <Trash2 size={14} className="text-red-400" />
                    </button>
                  </div>
                </div>

                {/* Progress Bar */}
                {conversion.status === 'processing' && (
                  <div className="mt-3">
                    <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300"
                        style={{ width: `${conversion.progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {filteredConversions.map((conversion) => (
              <div
                key={conversion.id}
                className={`group bg-[#141414] border border-white/[0.08] hover:border-white/[0.12] rounded-xl p-4 transition-all ${
                  selectedIds.includes(conversion.id) ? 'ring-1 ring-blue-500/50' : ''
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(conversion.id)}
                    onChange={() => toggleSelection(conversion.id)}
                    className="w-4 h-4 rounded border-white/20 bg-white/5 checked:bg-blue-500"
                  />
                  {getStatusIcon(conversion.status)}
                </div>

                <h4 className="text-sm font-medium text-white/90 truncate mb-2">{conversion.originalName}</h4>

                <div className="flex items-center justify-between text-xs text-white/50 mb-3">
                  <span>{conversion.inputFormat.toUpperCase()} → {conversion.outputFormat.toUpperCase()}</span>
                  <span className={`px-2 py-0.5 rounded border text-xs ${getStatusColor(conversion.status)}`}>
                    {conversion.status}
                  </span>
                </div>

                {conversion.status === 'processing' && (
                  <div className="mb-3">
                    <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all"
                        style={{ width: `${conversion.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {conversion.status === 'completed' && conversion.downloadUrl && (
                    <button
                      onClick={() => handleDownload(conversion)}
                      className="flex-1 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded-lg text-xs font-medium transition-all"
                    >
                      Download
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(conversion.id)}
                    disabled={isDeleting}
                    className="p-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg transition-all disabled:opacity-50"
                  >
                    <Trash2 size={14} className="text-red-400" />
                  </button>
                </div>

                <div className="mt-2 text-xs text-white/40 text-center">
                  {formatDate(conversion.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {filteredConversions.length > 0 && (
        <div className="border-t border-white/[0.08] bg-[#141414]/30 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/50">
              Showing {filteredConversions.length} of {conversions.length} conversions
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-white/70 px-3">Page {currentPage}</span>
              <button
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={filteredConversions.length < itemsPerPage}
                className="p-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConversionHistory;


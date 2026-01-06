import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Upload, Download, FileType, Image, Video, Music, FileText,
  ArrowRight, Sparkles, Check, AlertCircle, ChevronRight, Sliders,
  X, Play, Pause, Clock, Zap, TrendingUp, HardDrive, Cpu, Activity,
  Layers, Settings, MoreHorizontal, Search, Command, Grid, List,
  BarChart3, Archive, Folder, Star, History
} from 'lucide-react';
import ConversionService, { ConversionFile, ConversionRequest, ConversionResult } from '../../../services/conversionService';

// Extended file interface with upload progress
interface FileWithProgress extends ConversionFile {
  uploadProgress?: number;
  uploadStatus?: 'pending' | 'uploading' | 'completed' | 'error';
}

const ConvertToolsInterface: React.FC = () => {
  const navigate = useNavigate();
  
  // State management
  const [files, setFiles] = useState<FileWithProgress[]>([]);
  const [outputFormat, setOutputFormat] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [conversions, setConversions] = useState<ConversionResult[]>([]);

  // Services
  const conversionService = new ConversionService();
  
  // Advanced settings
  const [advancedSettings, setAdvancedSettings] = useState({
    quality: 85,
    resolution: 'original',
    compression: 'balanced',
    colorSpace: 'sRGB',
    bitDepth: 8,
    codec: 'auto'
  });

  // Statistics
  const [stats, setStats] = useState({
    totalProcessed: 247,
    totalSaved: '2.4 GB',
    avgSpeed: '127 MB/s',
    queueLength: 0
  });

  // Conversion history
  const [recentConversions, setRecentConversions] = useState<Array<{
    id: string;
    from: string;
    to: string;
    name: string;
    time: string;
    size: number;
    savedSpace?: number;
  }>>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Supported formats by category
  const supportedFormats = {
    image: ['JPG', 'PNG', 'WebP', 'GIF', 'BMP', 'TIFF', 'SVG', 'ICO', 'HEIC', 'AVIF'],
    video: ['MP4', 'AVI', 'MOV', 'MKV', 'WebM', 'FLV', 'WMV', 'MPEG', 'M4V', 'OGV'],
    audio: ['MP3', 'WAV', 'AAC', 'FLAC', 'OGG', 'M4A', 'WMA', 'OPUS', 'ALAC', 'APE'],
    document: ['PDF', 'DOCX', 'TXT', 'HTML', 'MD', 'RTF', 'ODT', 'EPUB', 'PPTX', 'XLSX']
  };

  // Conversion presets
  const presets = [
    { id: 'web-optimized', name: 'Web Optimized', quality: 85, format: 'WebP', icon: '🌐' },
    { id: 'print-quality', name: 'Print Quality', quality: 95, format: 'TIFF', icon: '🖨️' },
    { id: 'archive', name: 'Archive', quality: 100, format: 'PNG', icon: '📦' },
    { id: 'social-media', name: 'Social Media', quality: 80, format: 'JPG', icon: '📱' }
  ];

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
      // Open file
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        fileInputRef.current?.click();
      }
      // Start conversion
      if (e.key === 'Enter' && files.length > 0 && outputFormat) {
        e.preventDefault();
        handleConvert();
      }
      // Close/Cancel
      if (e.key === 'Escape') {
        setShowCommandPalette(false);
        setSelectedFiles([]);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [files, outputFormat]);

  // Utility functions
  const getFileTypeIcon = (type: string) => {
    switch(type) {
      case 'image': return <Image size={16} className="text-emerald-400" />;
      case 'video': return <Video size={16} className="text-blue-400" />;
      case 'audio': return <Music size={16} className="text-purple-400" />;
      case 'document': return <FileText size={16} className="text-orange-400" />;
      default: return <FileType size={16} className="text-white/40" />;
    }
  };

  const getFileType = (file: ConversionFile): string => {
    if (file.mimeType?.startsWith('image/')) return 'image';
    if (file.mimeType?.startsWith('video/')) return 'video';
    if (file.mimeType?.startsWith('audio/')) return 'audio';
    return 'document';
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  // File handling
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = Array.from(event.target.files || []);
    processFiles(uploadedFiles);
  };

  const processFiles = async (uploadedFiles: File[]) => {
    // Add files to state with pending status
    const pendingFiles: FileWithProgress[] = uploadedFiles.map((file, index) => ({
      id: `temp-${Date.now()}-${index}`,
      originalName: file.name,
      filename: file.name,
      path: '',
      size: file.size,
      mimeType: file.type,
      uploadedAt: new Date().toISOString(),
      status: 'uploaded',
      uploadProgress: 0,
      uploadStatus: 'pending'
    }));
    
    setFiles(prev => [...prev, ...pendingFiles]);
    
    // Upload each file individually with progress tracking
    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];
      const tempId = pendingFiles[i].id;
      
      try {
        // Update status to uploading
        setFiles(prev => prev.map(f => 
          f.id === tempId 
            ? { ...f, uploadStatus: 'uploading' as const } 
            : f
        ));
        
        // Create FormData for single file upload
        const formData = new FormData();
        formData.append('files', file);
        
        // Upload with real progress tracking
        const result = await conversionService.uploadFiles(
          formData as any,
          (progress) => {
            // Update progress in real-time
            setFiles(prev => prev.map(f => 
              f.id === tempId 
                ? { ...f, uploadProgress: progress } 
                : f
            ));
          }
        );
        
        if (result.success && result.data && result.data.files.length > 0) {
          const uploadedFile = result.data.files[0];
          
          // Replace temp file with real uploaded file
          setFiles(prev => prev.map(f => 
            f.id === tempId 
              ? { 
                  ...uploadedFile, 
                  uploadProgress: 100, 
                  uploadStatus: 'completed' as const 
                } 
              : f
          ));
          
          setStats(prev => ({ ...prev, queueLength: prev.queueLength + 1 }));
        } else {
          // Mark as error
          setFiles(prev => prev.map(f => 
            f.id === tempId 
              ? { ...f, uploadStatus: 'error' as const } 
              : f
          ));
        }
      } catch (error) {
        console.error(`Error uploading file ${file.name}:`, error);
        setFiles(prev => prev.map(f => 
          f.id === tempId 
            ? { ...f, uploadStatus: 'error' as const } 
            : f
        ));
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    processFiles(droppedFiles);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  // Conversion handling
  const handleConvert = async () => {
    if (!files.length || !outputFormat) return;

    setIsProcessing(true);

    try {
      // Convert each selected file (or all files if none selected)
      const filesToConvert = selectedFiles.length > 0 
        ? files.filter(f => selectedFiles.includes(f.id))
        : files;

      for (const file of filesToConvert) {
        const conversionRequest: ConversionRequest = {
          fileId: file.id,
          outputFormat,
          settings: {
            quality: advancedSettings.quality,
            resolution: advancedSettings.resolution,
            compression: advancedSettings.compression,
            colorSpace: advancedSettings.colorSpace,
            bitDepth: advancedSettings.bitDepth,
            codec: advancedSettings.codec
          }
        };

        const result = await conversionService.convertFile(conversionRequest);
        
        if (result.success && result.data) {
          setConversions(prev => [...prev, result.data!]);
          
          // Start polling for conversion status
          pollConversionStatus(result.data!.id);
        } else {
          console.error('Conversion failed:', result.error);
        }
      }
    } catch (error) {
      console.error('Error starting conversion:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Poll conversion status
  const pollConversionStatus = async (conversionId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const result = await conversionService.getConversionStatus(conversionId);
        
        if (result.success && result.data) {
          setConversions(prev => 
            prev.map(conv => 
              conv.id === conversionId ? result.data! : conv
            )
          );

          // Stop polling if conversion is complete or failed
          if (result.data.status === 'completed' || result.data.status === 'failed') {
            clearInterval(pollInterval);
            
            // Update stats
            if (result.data.status === 'completed') {
              setStats(prev => ({
                ...prev,
                totalProcessed: prev.totalProcessed + 1,
                queueLength: Math.max(0, prev.queueLength - 1)
              }));
            }
          }
        }
      } catch (error) {
        console.error('Error polling conversion status:', error);
        clearInterval(pollInterval);
      }
    }, 2000); // Poll every 2 seconds
  };

  const removeFile = (fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
    setSelectedFiles(prev => prev.filter(id => id !== fileId));
    setStats(prev => ({ ...prev, queueLength: Math.max(0, prev.queueLength - 1) }));
  };


  const clearCompleted = () => {
    // Remove files that have completed conversions
    const completedFileIds = conversions
      .filter(c => c.status === 'completed')
      .map(c => c.fileId);
    setFiles(prev => prev.filter(f => !completedFileIds.includes(f.id)));
  };

  const toggleFileSelection = (fileId: string) => {
    setSelectedFiles(prev => 
      prev.includes(fileId) 
        ? prev.filter(id => id !== fileId)
        : [...prev, fileId]
    );
  };

  return (
    // Negative margin to counteract DisplayContainer padding for edge-to-edge layout
    <div style={{ margin: '-12px', height: 'calc(100% + 24px)' }}>
      <div className="flex flex-col h-full bg-[#0a0a0a] text-white overflow-hidden">
      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Quick access & history */}
        <aside className="w-64 flex-shrink-0 border-r border-white/[0.08] bg-[#141414]/50 overflow-y-auto">
          <div className="p-4 space-y-6">
            {/* Presets */}
            <div>
              <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">Quick Presets</h3>
              <div className="space-y-1.5">
                {presets.map(preset => (
              <button
                    key={preset.id}
                onClick={() => {
                      setOutputFormat(preset.format.toLowerCase());
                      setAdvancedSettings(prev => ({ ...prev, quality: preset.quality }));
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] hover:border-blue-500/30 rounded-lg transition-all text-left group"
                  >
                    <span className="text-lg">{preset.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white/90">{preset.name}</div>
                      <div className="text-xs text-white/40">{preset.format} • {preset.quality}%</div>
                  </div>
                    <ChevronRight size={14} className="text-white/20 group-hover:text-white/40 transition-colors" />
              </button>
            ))}
          </div>
            </div>

            {/* Recent conversions */}
            {recentConversions.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <History size={12} />
                  Recent
                </h3>
                <div className="space-y-1.5">
                  {recentConversions.slice(0, 5).map(conversion => (
                    <div
                      key={conversion.id}
                      className="px-3 py-2 bg-white/[0.02] border border-white/[0.05] rounded-lg"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Check size={12} className="text-emerald-400 flex-shrink-0" />
                        <span className="text-xs text-white/70 truncate">{conversion.name}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/40">{conversion.from} → {conversion.to}</span>
                        <span className="text-white/30">{conversion.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* System resources mini-graph */}
            <div>
              <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Activity size={12} />
                System
              </h3>
              <div className="space-y-3 px-3 py-3 bg-white/[0.02] border border-white/[0.05] rounded-lg">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-white/50">CPU</span>
                    <span className="text-xs font-medium text-white/70">34%</span>
                  </div>
                  <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500/70 rounded-full" style={{ width: '34%' }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-white/50">Memory</span>
                    <span className="text-xs font-medium text-white/70">58%</span>
                  </div>
                  <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500/70 rounded-full" style={{ width: '58%' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Center - Main work area */}
        <main className="flex-1 overflow-y-auto">
          <div className={`p-6 space-y-6 max-w-6xl mx-auto ${files.length === 0 ? 'h-full flex items-center justify-center' : 'h-full flex flex-col justify-center'}`}>
            {/* Upload zone */}
            <div
              className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all ${
                isDragging 
                  ? 'border-blue-500/50 bg-blue-500/5' 
                  : 'border-white/[0.08] hover:border-white/[0.12] bg-white/[0.02]'
              } ${files.length === 0 ? 'w-full max-w-2xl' : 'w-full'}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                multiple
                  onChange={handleFileUpload}
                  className="hidden"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
                />

              {files.length === 0 ? (
                <div className="space-y-4">
                  <div className="inline-flex p-4 bg-white/[0.03] rounded-2xl border border-white/[0.08]">
                    <Upload size={32} className="text-white/40" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-1">Drop files here</h3>
                    <p className="text-sm text-white/50 mb-4">or click to browse your computer</p>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 hover:border-blue-500/50 rounded-lg text-sm font-medium transition-all"
                    >
                      <Upload size={16} />
                      Select Files
                    </button>
                  </div>
                  <div className="flex items-center justify-center gap-8 pt-4">
                    {Object.entries(supportedFormats).map(([type, formats]) => (
                      <div key={type} className="text-center">
                        <div className="mb-1">{getFileTypeIcon(type)}</div>
                        <div className="text-xs text-white/40 capitalize">{type}s</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold">{files.length} file{files.length !== 1 ? 's' : ''} selected</h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setViewMode('grid')}
                          className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'}`}
                        >
                          <Grid size={14} className="text-white/60" />
                        </button>
                        <button
                          onClick={() => setViewMode('list')}
                          className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'}`}
                        >
                          <List size={14} className="text-white/60" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate('/overview/tools/convert/history')}
                        className="px-3 py-1.5 text-xs text-white/60 hover:text-white/80 hover:bg-white/[0.05] rounded-lg transition-all flex items-center gap-1.5"
                        title="View conversion history"
                      >
                        <History size={14} />
                        View History
                      </button>
                      <button
                        onClick={clearCompleted}
                        className="px-3 py-1.5 text-xs text-white/60 hover:text-white/80 hover:bg-white/[0.05] rounded-lg transition-all"
                      >
                        Clear Completed
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 text-xs bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-all"
                      >
                        Add More
                      </button>
                        </div>
                      </div>
                </div>
              )}
            </div>

            {/* File list/grid */}
            {files.length > 0 && (
              <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-3' : 'space-y-2'}>
                {files.map(file => (
                  <div
                    key={file.id}
                    className={`group relative bg-[#141414] border border-white/[0.08] hover:border-white/[0.12] rounded-xl p-4 transition-all ${
                      selectedFiles.includes(file.id) ? 'ring-1 ring-blue-500/50' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Thumbnail/Icon */}
                      <div className="flex-shrink-0">
                        <div className="w-12 h-12 bg-white/[0.03] border border-white/[0.08] rounded-lg flex items-center justify-center">
                          {getFileTypeIcon(getFileType(file))}
                        </div>
                      </div>

                      {/* File info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-medium text-white/90 truncate mb-0.5">{file.originalName}</h4>
                            <p className="text-xs text-white/40">{formatFileSize(file.size)}</p>
                    </div>
                    <button
                            onClick={() => removeFile(file.id)}
                            className="flex-shrink-0 p-1 hover:bg-white/[0.08] rounded transition-all opacity-0 group-hover:opacity-100"
                          >
                            <X size={14} className="text-white/40" />
                    </button>
                  </div>

                        {/* Status */}
                        {(() => {
                          // Show upload status first
                          if (file.uploadStatus === 'uploading') {
                            return (
                              <div className="mt-3">
                                <div className="flex items-center justify-between text-xs mb-1.5">
                                  <span className="text-blue-400 flex items-center gap-1.5">
                                    <Upload size={12} className="animate-pulse" />
                                    Uploading...
                                  </span>
                                  <span className="text-white/70 font-medium">{Math.round(file.uploadProgress || 0)}%</span>
                                </div>
                                <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300"
                                    style={{ width: `${file.uploadProgress || 0}%` }}
                                  />
                                </div>
                              </div>
                            );
                          }
                          
                          if (file.uploadStatus === 'error') {
                            return (
                              <div className="mt-2 flex items-center gap-2 text-xs text-red-400">
                                <AlertCircle size={12} />
                                <span>Upload failed</span>
                              </div>
                            );
                          }
                          
                          if (file.uploadStatus === 'completed') {
                            // Check conversion status
                            const conversion = conversions.find(c => c.fileId === file.id);
                            if (conversion) {
                              if (conversion.status === 'processing') {
                                return (
                                  <div className="mt-3">
                                    <div className="flex items-center justify-between text-xs mb-1.5">
                                      <span className="text-white/50">Converting...</span>
                                      <span className="text-white/70 font-medium">{conversion.progress}%</span>
                                    </div>
                                    <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
                                      <div 
                                        className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300"
                                        style={{ width: `${conversion.progress}%` }}
                                      />
              </div>
            </div>
                                );
                              } else if (conversion.status === 'completed') {
                                return (
                                  <div className="mt-2 flex items-center gap-2 text-xs text-emerald-400">
                                    <Check size={12} />
                                    <span>Converted to {conversion.outputFormat.toUpperCase()}</span>
                                  </div>
                                );
                              } else if (conversion.status === 'failed') {
                                return (
                                  <div className="mt-2 flex items-center gap-2 text-xs text-red-400">
                                    <AlertCircle size={12} />
                                    <span>Conversion failed</span>
                                  </div>
                                );
                              }
                            } else {
                              // Upload completed, ready to convert
                              return (
                                <div className="mt-2 flex items-center gap-2 text-xs text-emerald-400">
                                  <Check size={12} />
                                  <span>Ready to convert</span>
                                </div>
                              );
                            }
                          }
                          
                          return null;
                        })()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Format selection */}
            {files.length > 0 && (
              <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-6">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Sparkles size={16} className="text-blue-400" />
                  Output Format
                </h3>
                
                <div className="grid grid-cols-8 gap-2">
                  {supportedFormats[getFileType(files[0]) as keyof typeof supportedFormats]?.map(format => (
                      <button
                        key={format}
                        onClick={() => setOutputFormat(format.toLowerCase())}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                          outputFormat === format.toLowerCase()
                          ? 'bg-blue-500/20 border-blue-500/50 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-white/[0.02] border-white/[0.08] text-white/70 hover:bg-white/[0.05] hover:border-white/[0.12]'
                        }`}
                      >
                        {format}
                      </button>
                    ))}
                  </div>
                </div>
              )}

            {/* Advanced settings */}
            {files.length > 0 && outputFormat && (
              <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-6">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Sliders size={16} className="text-white/60" />
                    Advanced Settings
                  </h3>
                
                <div className="grid grid-cols-2 gap-6">
                    <div>
                    <label className="block text-xs text-white/50 mb-2">Quality</label>
                    <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="10"
                          max="100"
                          value={advancedSettings.quality}
                          onChange={(e) => setAdvancedSettings({...advancedSettings, quality: parseInt(e.target.value)})}
                        className="flex-1 h-1.5 bg-white/[0.08] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500"
                        />
                      <span className="text-sm font-medium text-white/80 w-12 text-right">{advancedSettings.quality}%</span>
                      </div>
                    </div>
                  
                    <div>
                    <label className="block text-xs text-white/50 mb-2">Resolution</label>
                      <select
                      className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.12] rounded-lg text-sm text-white/90 focus:outline-none focus:border-blue-500/50 transition-all"
                        value={advancedSettings.resolution}
                        onChange={(e) => setAdvancedSettings({...advancedSettings, resolution: e.target.value})}
                      >
                        <option value="original">Original</option>
                      <option value="4k">4K (2160p)</option>
                      <option value="2k">2K (1440p)</option>
                      <option value="hd">HD (1080p)</option>
                      <option value="sd">SD (720p)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-white/50 mb-2">Color Space</label>
                    <select
                      className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.12] rounded-lg text-sm text-white/90 focus:outline-none focus:border-blue-500/50 transition-all"
                      value={advancedSettings.colorSpace}
                      onChange={(e) => setAdvancedSettings({...advancedSettings, colorSpace: e.target.value})}
                    >
                      <option value="sRGB">sRGB</option>
                      <option value="adobeRGB">Adobe RGB</option>
                      <option value="displayP3">Display P3</option>
                      <option value="prophoto">ProPhoto RGB</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-white/50 mb-2">Compression</label>
                    <select
                      className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.12] rounded-lg text-sm text-white/90 focus:outline-none focus:border-blue-500/50 transition-all"
                      value={advancedSettings.compression}
                      onChange={(e) => setAdvancedSettings({...advancedSettings, compression: e.target.value})}
                    >
                      <option value="none">None</option>
                      <option value="fast">Fast</option>
                      <option value="balanced">Balanced</option>
                      <option value="best">Best Quality</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

            {/* Convert button */}
            {files.length > 0 && outputFormat && (
              <div className="flex justify-center">
                <button
                  onClick={handleConvert}
                  disabled={isProcessing}
                  className="relative overflow-hidden px-8 py-4 bg-gradient-to-r from-blue-500/20 to-emerald-500/20 hover:from-blue-500/30 hover:to-emerald-500/30 disabled:from-white/[0.03] disabled:to-white/[0.03] border border-blue-500/30 hover:border-blue-500/50 disabled:border-white/[0.08] rounded-xl text-white disabled:text-white/40 transition-all shadow-lg shadow-blue-500/10 disabled:shadow-none group"
                >
                  <div className="relative flex items-center gap-3">
                    {isProcessing ? (
                      <>
                        <RefreshCw size={20} className="animate-spin" />
                        <span className="font-medium">Starting Conversion...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={20} />
                        <span className="font-medium">Convert {files.length} Files</span>
                        <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </div>
                </button>
                </div>
              )}
            </div>
        </main>

        {/* Right sidebar - Analytics & metadata */}
        <aside className="w-80 flex-shrink-0 border-l border-white/[0.08] bg-[#141414]/50 overflow-y-auto">
          <div className="p-4 space-y-6">
            {/* Performance metrics */}
            <div>
              <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
                <BarChart3 size={12} />
                Performance
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-white/[0.02] border border-white/[0.05] rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap size={14} className="text-yellow-400" />
                    <span className="text-xs text-white/50">Speed</span>
                  </div>
                  <div className="text-lg font-semibold">127</div>
                  <div className="text-xs text-white/40">MB/s</div>
                </div>
                <div className="p-3 bg-white/[0.02] border border-white/[0.05] rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock size={14} className="text-blue-400" />
                    <span className="text-xs text-white/50">ETA</span>
                    </div>
                  <div className="text-lg font-semibold">2.4</div>
                  <div className="text-xs text-white/40">minutes</div>
                    </div>
                  </div>
                </div>

            {/* Format compatibility */}
                          <div>
              <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">Supported Formats</h3>
              <div className="space-y-3">
                {Object.entries(supportedFormats).map(([type, formats]) => (
                  <div key={type} className="p-3 bg-white/[0.02] border border-white/[0.05] rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      {getFileTypeIcon(type)}
                      <span className="text-sm font-medium capitalize">{type}s</span>
                      <span className="ml-auto text-xs text-white/40">{formats.length} formats</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {formats.slice(0, 6).map(format => (
                        <span key={format} className="px-2 py-0.5 bg-white/[0.05] text-xs text-white/60 rounded">
                          {format}
                        </span>
                      ))}
                      {formats.length > 6 && (
                        <span className="px-2 py-0.5 text-xs text-white/40">
                          +{formats.length - 6}
                        </span>
                      )}
                          </div>
                      </div>
                    ))}
                  </div>
                </div>

            {/* Keyboard shortcuts hint */}
            <div className="p-4 bg-gradient-to-br from-blue-500/5 to-purple-500/5 border border-blue-500/20 rounded-lg">
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Command size={14} className="text-blue-400" />
                Quick Actions
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Command Palette</span>
                  <kbd className="px-2 py-0.5 bg-white/[0.08] border border-white/[0.08] rounded text-white/80">⌘K</kbd>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Open Files</span>
                  <kbd className="px-2 py-0.5 bg-white/[0.08] border border-white/[0.08] rounded text-white/80">⌘O</kbd>
                    </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Start Convert</span>
                  <kbd className="px-2 py-0.5 bg-white/[0.08] border border-white/[0.08] rounded text-white/80">Enter</kbd>
                </div>
              </div>
            </div>
          </div>
        </aside>
          </div>

      {/* Command Palette Modal */}
      {showCommandPalette && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh] z-50" onClick={() => setShowCommandPalette(false)}>
          <div className="w-full max-w-2xl bg-[#141414] border border-white/[0.12] rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-white/[0.08]">
              <div className="flex items-center gap-3 px-4 py-3 bg-white/[0.03] border border-white/[0.08] rounded-lg">
                <Search size={18} className="text-white/40" />
                <input
                  type="text"
                  placeholder="Type a command or search..."
                  className="flex-1 bg-transparent text-white/90 placeholder:text-white/40 focus:outline-none"
                  autoFocus
                />
                <kbd className="px-2 py-1 bg-white/[0.08] border border-white/[0.08] rounded text-xs text-white/60">ESC</kbd>
              </div>
            </div>
            <div className="p-2 max-h-96 overflow-y-auto">
              <div className="space-y-1">
                {[
                  { label: 'Open Files', shortcut: '⌘O', icon: Upload },
                  { label: 'Convert All', shortcut: 'Enter', icon: RefreshCw },
                  { label: 'Clear Queue', shortcut: '', icon: X },
                  { label: 'Export Settings', shortcut: '⌘E', icon: Download },
                  { label: 'View History', shortcut: '⌘H', icon: History },
                ].map((cmd, i) => (
              <button
                    key={i}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.05] rounded-lg transition-all text-left"
                  >
                    <div className="flex items-center gap-3">
                      <cmd.icon size={16} className="text-white/40" />
                      <span className="text-sm text-white/80">{cmd.label}</span>
                    </div>
                    {cmd.shortcut && (
                      <kbd className="px-2 py-1 bg-white/[0.05] border border-white/[0.08] rounded text-xs text-white/60">{cmd.shortcut}</kbd>
                )}
              </button>
                ))}
          </div>
        </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default ConvertToolsInterface;

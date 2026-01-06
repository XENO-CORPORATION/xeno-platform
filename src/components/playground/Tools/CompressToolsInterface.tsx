import React, { useState, useRef } from 'react';
import { Archive, Upload, Download, Gauge, Settings, FileText, Package, Zap, HardDrive, Shield, CheckCircle, X } from 'lucide-react';

const CompressToolsInterface: React.FC = () => {
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [compressionLevel, setCompressionLevel] = useState<number>(5);
  const [outputFormat, setOutputFormat] = useState<string>('zip');
  const [isCompressing, setIsCompressing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const compressionLevels = [
    { value: 1, name: 'Fast', icon: <Zap size={16} />, description: 'Minimal compression', color: 'text-yellow-400' },
    { value: 5, name: 'Balanced', icon: <Gauge size={16} />, description: 'Good balance', color: 'text-blue-400' },
    { value: 9, name: 'Maximum', icon: <HardDrive size={16} />, description: 'Best compression', color: 'text-purple-400' }
  ];

  const archiveFormats = [
    { value: 'zip', name: 'ZIP', description: 'Universal compatibility' },
    { value: '7z', name: '7Z', description: 'Best compression ratio' },
    { value: 'tar.gz', name: 'TAR.GZ', description: 'Unix/Linux standard' },
    { value: 'rar', name: 'RAR', description: 'Advanced features' }
  ];

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setSelectedFiles(files);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setSelectedFiles(files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleCompress = async () => {
    if (!selectedFiles) return;

    setIsCompressing(true);
    setCompressionProgress(0);

    // Simulate compression progress
    const interval = setInterval(() => {
      setCompressionProgress(prev => {
        if (prev >= 90) {
          clearInterval(interval);
          return 100;
        }
        return prev + 15;
      });
    }, 300);

    setTimeout(() => {
      setIsCompressing(false);
      setCompressionProgress(100);
      alert('Compression completed! (This is a demo)');
      setTimeout(() => setCompressionProgress(0), 1000);
    }, 3000);
  };

  const getTotalSize = () => {
    if (!selectedFiles) return 0;
    let total = 0;
    for (let i = 0; i < selectedFiles.length; i++) {
      total += selectedFiles[i].size;
    }
    return total;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const estimatedSize = selectedFiles ? Math.round(getTotalSize() * (1 - compressionLevel * 0.08)) : 0;
  const savingsPercent = selectedFiles ? Math.round(compressionLevel * 8) : 0;

  const removeFile = (index: number) => {
    if (!selectedFiles) return;
    const newFiles = Array.from(selectedFiles);
    newFiles.splice(index, 1);
    const dt = new DataTransfer();
    newFiles.forEach(file => dt.items.add(file));
    setSelectedFiles(dt.files.length > 0 ? dt.files : null);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-4 space-y-6">
          {/* Header */}
          <div className="text-center py-4">
            <div className="flex items-center justify-center mb-3">
              <Archive size={28} className="text-orange-400 mr-3" />
              <h1 className="text-2xl font-bold text-white">File Compressor</h1>
            </div>
            <p className="text-white/60 text-sm">Reduce file sizes with powerful compression</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Files Section */}
            <div className="bg-white/5 rounded-xl border border-white/10 p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center">
                <Upload size={18} className="mr-2" />
                Select Files
              </h2>

              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  isDragging ? 'border-orange-500/50 bg-orange-500/5' : 'border-white/20 hover:border-white/40'
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileUpload}
                    className="hidden"
                    multiple
                    accept="*/*"
                  />

                {!selectedFiles || selectedFiles.length === 0 ? (
                  <>
                    <Package size={40} className="text-white/40 mx-auto mb-3" />
                    <p className="text-white/80 mb-1">Drop files here to compress</p>
                    <p className="text-white/40 text-sm mb-3">Select multiple files to bundle</p>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/30 rounded-lg text-white text-sm transition-all"
                    >
                      Browse Files
                    </button>
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="text-white/80 text-sm">
                      {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected
                    </p>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {Array.from(selectedFiles).map((file, index) => (
                        <div key={index} className="flex justify-between items-center p-2 bg-white/5 rounded text-sm">
                          <span className="text-white/80 truncate">{file.name}</span>
                          <div className="flex items-center space-x-2">
                            <span className="text-white/60">{formatFileSize(file.size)}</span>
                            <button
                              onClick={() => removeFile(index)}
                              className="text-white/60 hover:text-red-400"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="pt-2 border-t border-white/10 text-sm">
                      <div className="flex justify-between">
                        <span className="text-white/60">Total: {formatFileSize(getTotalSize())}</span>
                        <span className="text-emerald-400">After: ~{formatFileSize(estimatedSize)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Settings Section */}
            <div className="bg-white/5 rounded-xl border border-white/10 p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Compression Settings</h2>

              <div className="space-y-4">
                {/* Archive Format */}
                <div>
                  <label className="block text-white/80 text-sm mb-2">Archive Format</label>
                  <div className="grid grid-cols-2 gap-2">
                    {archiveFormats.map((format) => (
                      <button
                        key={format.value}
                        onClick={() => setOutputFormat(format.value)}
                        className={`p-2 rounded-lg border text-sm transition-all ${
                          outputFormat === format.value
                            ? 'bg-orange-500/20 border-orange-500/30 text-white'
                            : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                        }`}
                      >
                        {format.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Compression Level */}
                <div>
                  <label className="block text-white/80 text-sm mb-2">Compression Level</label>
                  <div className="space-y-2">
                    {compressionLevels.map((level) => (
                      <button
                        key={level.value}
                        onClick={() => setCompressionLevel(level.value)}
                        className={`w-full p-2 rounded-lg border text-sm text-left transition-all ${
                          compressionLevel === level.value
                            ? 'bg-orange-500/20 border-orange-500/30 text-white'
                            : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-center space-x-2">
                          <span className={level.color}>{level.icon}</span>
                          <span>{level.name} - {level.description}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stats */}
                {selectedFiles && selectedFiles.length > 0 && (
                  <div className="pt-3 border-t border-white/10">
                    <div className="grid grid-cols-3 gap-2 text-center text-sm">
                      <div>
                        <p className="text-white/60 text-xs">Files</p>
                        <p className="text-white font-medium">{selectedFiles.length}</p>
                      </div>
                      <div>
                        <p className="text-white/60 text-xs">Format</p>
                        <p className="text-white font-medium">{outputFormat.toUpperCase()}</p>
                      </div>
                      <div>
                        <p className="text-white/60 text-xs">Savings</p>
                        <p className="text-emerald-400 font-medium">~{savingsPercent}%</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Compress Button */}
              {selectedFiles && selectedFiles.length > 0 && (
                <button
                  onClick={handleCompress}
                  disabled={isCompressing}
                  className="w-full mt-4 p-3 bg-orange-500/20 hover:bg-orange-500/30 disabled:bg-white/5
                           border border-orange-500/30 hover:border-orange-500/50 disabled:border-white/10
                           rounded-lg text-white disabled:text-white/40 transition-all flex items-center justify-center"
                >
                  {isCompressing ? (
                    <>
                      <Archive size={20} className="mr-2 animate-spin" />
                      Compressing... {compressionProgress}%
                    </>
                  ) : (
                    <>
                      <Download size={20} className="mr-2" />
                      Compress Files
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Features Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="group relative overflow-hidden bg-gradient-to-br from-orange-500/10 to-orange-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-orange-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/0 to-orange-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-orange-500/20 rounded-lg inline-block mb-3">
                  <Archive size={20} className="text-orange-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Archive</h3>
                <p className="text-white/60 text-xs leading-relaxed">Create compressed archives</p>
              </div>
            </div>
            <div className="group relative overflow-hidden bg-gradient-to-br from-yellow-500/10 to-yellow-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-yellow-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/0 to-yellow-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-yellow-500/20 rounded-lg inline-block mb-3">
                  <Zap size={20} className="text-yellow-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Fast</h3>
                <p className="text-white/60 text-xs leading-relaxed">Lightning speed compression</p>
              </div>
            </div>
            <div className="group relative overflow-hidden bg-gradient-to-br from-purple-500/10 to-purple-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-purple-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-purple-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-purple-500/20 rounded-lg inline-block mb-3">
                  <HardDrive size={20} className="text-purple-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Optimize</h3>
                <p className="text-white/60 text-xs leading-relaxed">Maximum space savings</p>
              </div>
            </div>
            <div className="group relative overflow-hidden bg-gradient-to-br from-green-500/10 to-green-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-green-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-green-500/0 to-green-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-green-500/20 rounded-lg inline-block mb-3">
                  <Shield size={20} className="text-green-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Secure</h3>
                <p className="text-white/60 text-xs leading-relaxed">Protected archives</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompressToolsInterface;
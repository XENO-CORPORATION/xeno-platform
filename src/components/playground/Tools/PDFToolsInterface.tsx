import React, { useState } from 'react';
import { FileType, Upload, Download, Scissors, Merge, Lock, Unlock, Eye, FileText } from 'lucide-react';

const PDFToolsInterface: React.FC = () => {
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [activeTab, setActiveTab] = useState<string>('merge');
  const [isProcessing, setIsProcessing] = useState(false);
  const [password, setPassword] = useState<string>('');

  const tabs = [
    { id: 'merge', name: 'Merge', icon: <Merge size={16} /> },
    { id: 'split', name: 'Split', icon: <Scissors size={16} /> },
    { id: 'protect', name: 'Protect', icon: <Lock size={16} /> },
    { id: 'unlock', name: 'Unlock', icon: <Unlock size={16} /> },
  ];

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setSelectedFiles(files);
    }
  };

  const handleProcess = async () => {
    if (!selectedFiles) return;

    setIsProcessing(true);
    // Simulate PDF processing
    setTimeout(() => {
      setIsProcessing(false);
      alert('PDF processing completed! (This is a demo)');
    }, 2500);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'merge':
        return (
          <div className="space-y-4">
            <h3 className="text-white font-medium">Merge PDFs</h3>
            <p className="text-white/60 text-sm">Select multiple PDF files to merge them into one document.</p>
            <div className="space-y-2">
              <label className="block text-white/80 text-sm">Output filename</label>
              <input
                type="text"
                defaultValue="merged-document.pdf"
                className="w-full p-2 bg-white/10 border border-white/20 rounded text-white"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-white/80 text-sm">Page order</label>
              <select className="w-full p-2 bg-white/10 border border-white/20 rounded text-white">
                <option>File order</option>
                <option>Alphabetical</option>
                <option>Date modified</option>
                <option>Custom order</option>
              </select>
            </div>
          </div>
        );
      case 'split':
        return (
          <div className="space-y-4">
            <h3 className="text-white font-medium">Split PDF</h3>
            <p className="text-white/60 text-sm">Extract specific pages or split by page ranges.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-white/80 text-sm mb-1">Split method</label>
                <select className="w-full p-2 bg-white/10 border border-white/20 rounded text-white">
                  <option>Every page</option>
                  <option>Every 2 pages</option>
                  <option>Every 5 pages</option>
                  <option>Every 10 pages</option>
                  <option>Custom page ranges</option>
                </select>
              </div>
              <div>
                <label className="block text-white/80 text-sm mb-1">Page ranges (e.g., 1-5, 10-15)</label>
                <input
                  type="text"
                  placeholder="1-5, 10-15, 20"
                  className="w-full p-2 bg-white/10 border border-white/20 rounded text-white"
                />
              </div>
            </div>
          </div>
        );
      case 'protect':
        return (
          <div className="space-y-4">
            <h3 className="text-white font-medium">Password Protect</h3>
            <p className="text-white/60 text-sm">Add password protection to your PDF documents.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-white/80 text-sm mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full p-2 bg-white/10 border border-white/20 rounded text-white"
                />
              </div>
              <div>
                <label className="block text-white/80 text-sm mb-1">Confirm password</label>
                <input
                  type="password"
                  placeholder="Confirm password"
                  className="w-full p-2 bg-white/10 border border-white/20 rounded text-white"
                />
              </div>
              <div className="space-y-2">
                <p className="text-white/80 text-sm">Permissions:</p>
                <div className="space-y-1">
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" defaultChecked />
                    <span className="text-white/70 text-sm">Allow printing</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" defaultChecked />
                    <span className="text-white/70 text-sm">Allow copying text</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" />
                    <span className="text-white/70 text-sm">Allow editing</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        );
      case 'unlock':
        return (
          <div className="space-y-4">
            <h3 className="text-white font-medium">Remove Password</h3>
            <p className="text-white/60 text-sm">Remove password protection from encrypted PDF files.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-white/80 text-sm mb-1">Current password</label>
                <input
                  type="password"
                  placeholder="Enter current password"
                  className="w-full p-2 bg-white/10 border border-white/20 rounded text-white"
                />
              </div>
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-yellow-400 text-sm">
                  ⚠️ Make sure you have permission to remove the password protection.
                </p>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-4 space-y-6">
          {/* Header */}
          <div className="text-center py-4">
            <div className="flex items-center justify-center mb-3">
              <FileType size={28} className="text-red-400 mr-3" />
              <h1 className="text-2xl font-bold text-white">PDF Tools</h1>
            </div>
            <p className="text-white/60 text-sm">Merge, split, protect, and modify PDF documents</p>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Upload Section */}
            <div className="bg-white/5 rounded-xl border border-white/10 p-4">
              <h2 className="text-lg font-semibold text-white mb-3 flex items-center">
                <Upload size={18} className="mr-2" />
                Upload PDF Files
              </h2>

              <div className="border-2 border-dashed border-white/20 rounded-lg p-6 text-center hover:border-white/40 transition-colors">
                <input
                  type="file"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="pdf-upload"
                  multiple={activeTab === 'merge'}
                  accept=".pdf"
                />
                <label htmlFor="pdf-upload" className="cursor-pointer">
                  <FileType size={40} className="text-white/40 mx-auto mb-3" />
                  <p className="text-white/80 mb-1">
                    {activeTab === 'merge' ? 'Select multiple PDF files' : 'Select a PDF file'}
                  </p>
                  <p className="text-white/40 text-sm">Only PDF files are supported</p>
                </label>
              </div>

              {selectedFiles && selectedFiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="p-3 bg-white/5 rounded-lg">
                    <p className="text-white/80 text-sm">
                      <strong>Selected:</strong> {selectedFiles.length} file(s)
                    </p>
                  </div>

                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {Array.from(selectedFiles).map((file, index) => (
                      <div key={index} className="flex justify-between items-center p-2 bg-white/5 rounded text-sm">
                        <span className="text-white/80 truncate">{file.name}</span>
                        <span className="text-white/60">{formatFileSize(file.size)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Tools Section */}
            <div className="bg-white/5 rounded-xl border border-white/10 p-4">
              <h2 className="text-lg font-semibold text-white mb-3">PDF Operations</h2>

              {/* Tool Tabs */}
              <div className="flex flex-wrap gap-1 mb-4">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-1 px-3 py-2 rounded-lg text-sm transition-all ${
                      activeTab === tab.id
                        ? 'bg-red-500/20 text-white border border-red-500/30'
                        : 'bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.name}</span>
                  </button>
                ))}
              </div>

              {renderTabContent()}

              <button
                onClick={handleProcess}
                disabled={!selectedFiles || isProcessing}
                className="w-full mt-4 p-3 bg-red-500/20 hover:bg-red-500/30 disabled:bg-white/5
                         border border-red-500/30 hover:border-red-500/50 disabled:border-white/10
                         rounded-lg text-white disabled:text-white/40 transition-all flex items-center justify-center"
              >
                {isProcessing ? (
                  <>
                    <FileType size={20} className="mr-2 animate-pulse" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Download size={20} className="mr-2" />
                    Process PDF
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Features Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="group relative overflow-hidden bg-gradient-to-br from-red-500/10 to-red-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-red-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-red-500/0 to-red-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-red-500/20 rounded-lg inline-block mb-3">
                  <Merge size={20} className="text-red-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Merge</h3>
                <p className="text-white/60 text-xs leading-relaxed">Combine multiple PDFs</p>
              </div>
            </div>
            <div className="group relative overflow-hidden bg-gradient-to-br from-blue-500/10 to-blue-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-blue-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-blue-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-blue-500/20 rounded-lg inline-block mb-3">
                  <Scissors size={20} className="text-blue-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Split</h3>
                <p className="text-white/60 text-xs leading-relaxed">Extract specific pages</p>
              </div>
            </div>
            <div className="group relative overflow-hidden bg-gradient-to-br from-green-500/10 to-green-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-green-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-green-500/0 to-green-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-green-500/20 rounded-lg inline-block mb-3">
                  <Lock size={20} className="text-green-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Protect</h3>
                <p className="text-white/60 text-xs leading-relaxed">Add password security</p>
              </div>
            </div>
            <div className="group relative overflow-hidden bg-gradient-to-br from-purple-500/10 to-purple-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-purple-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-purple-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-purple-500/20 rounded-lg inline-block mb-3">
                  <Eye size={20} className="text-purple-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Preview</h3>
                <p className="text-white/60 text-xs leading-relaxed">View PDF contents</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PDFToolsInterface;
import React, { useState } from 'react';
import { Share, Upload, Link, QrCode, Clock, Users, Mail, MessageCircle, Copy, Eye } from 'lucide-react';

const ShareToolsInterface: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [shareSettings, setShareSettings] = useState({
    expirationTime: '7d',
    requirePassword: false,
    password: '',
    allowDownload: true,
    maxViews: '',
    notifyOnAccess: false
  });
  const [shareLink, setShareLink] = useState<string>('');
  const [qrCodeData, setQrCodeData] = useState<string>('');

  const expirationOptions = [
    { value: '1h', label: '1 hour' },
    { value: '24h', label: '24 hours' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
    { value: 'never', label: 'Never expires' }
  ];

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const generateShareLink = () => {
    if (!selectedFile) return;

    // Generate a mock share link
    const mockLink = `https://xenolabs.app/share/${Math.random().toString(36).substr(2, 9)}`;
    setShareLink(mockLink);
    setQrCodeData(mockLink);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-4 space-y-6">
          {/* Header */}
          <div className="text-center py-4">
            <div className="flex items-center justify-center mb-3">
              <Share size={28} className="text-green-400 mr-3" />
              <h1 className="text-2xl font-bold text-white">Share Tools</h1>
            </div>
            <p className="text-white/60 text-sm">Securely share files with customizable settings</p>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Upload & Settings Section */}
            <div className="space-y-4">
              {/* File Upload */}
              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <h2 className="text-lg font-semibold text-white mb-3 flex items-center">
                  <Upload size={18} className="mr-2" />
                  Upload File
                </h2>

                <div className="border-2 border-dashed border-white/20 rounded-lg p-6 text-center hover:border-white/40 transition-colors">
                  <input
                    type="file"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="file-upload"
                    accept="*/*"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <Share size={40} className="text-white/40 mx-auto mb-3" />
                    <p className="text-white/80 mb-1">Click to upload file</p>
                    <p className="text-white/40 text-sm">Any file type supported</p>
                  </label>
                </div>

                {selectedFile && (
                  <div className="mt-4 p-3 bg-white/5 rounded-lg">
                    <p className="text-white/80 text-sm">
                      <strong>File:</strong> {selectedFile.name}
                    </p>
                    <p className="text-white/60 text-sm">
                      Size: {formatFileSize(selectedFile.size)}
                    </p>
                  </div>
                )}
              </div>

              {/* Share Settings */}
              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <h2 className="text-lg font-semibold text-white mb-3">Share Settings</h2>

                <div className="space-y-4">
                  {/* Expiration Time */}
                  <div>
                    <label className="flex items-center text-white/80 mb-2 text-sm">
                      <Clock size={16} className="mr-2" />
                      Expiration Time
                    </label>
                    <select
                      value={shareSettings.expirationTime}
                      onChange={(e) => setShareSettings({...shareSettings, expirationTime: e.target.value})}
                      className="w-full p-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm"
                    >
                      {expirationOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Password Protection */}
                  <div>
                    <label className="flex items-center space-x-2 mb-2">
                      <input
                        type="checkbox"
                        checked={shareSettings.requirePassword}
                        onChange={(e) => setShareSettings({...shareSettings, requirePassword: e.target.checked})}
                      />
                      <span className="text-white/80 text-sm">Require password</span>
                    </label>
                    {shareSettings.requirePassword && (
                      <input
                        type="password"
                        placeholder="Enter password"
                        value={shareSettings.password}
                        onChange={(e) => setShareSettings({...shareSettings, password: e.target.value})}
                        className="w-full p-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm"
                      />
                    )}
                  </div>

                  {/* Max Views */}
                  <div>
                    <label className="flex items-center text-white/80 mb-2 text-sm">
                      <Eye size={16} className="mr-2" />
                      Maximum Views (optional)
                    </label>
                    <input
                      type="number"
                      placeholder="Unlimited"
                      value={shareSettings.maxViews}
                      onChange={(e) => setShareSettings({...shareSettings, maxViews: e.target.value})}
                      className="w-full p-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm"
                    />
                  </div>

                  {/* Additional Options */}
                  <div className="space-y-2">
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={shareSettings.allowDownload}
                        onChange={(e) => setShareSettings({...shareSettings, allowDownload: e.target.checked})}
                      />
                      <span className="text-white/80 text-sm">Allow downloads</span>
                    </label>
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={shareSettings.notifyOnAccess}
                        onChange={(e) => setShareSettings({...shareSettings, notifyOnAccess: e.target.checked})}
                      />
                      <span className="text-white/80 text-sm">Notify on access</span>
                    </label>
                  </div>

                  <button
                    onClick={generateShareLink}
                    disabled={!selectedFile}
                    className="w-full p-3 bg-green-500/20 hover:bg-green-500/30 disabled:bg-white/5
                             border border-green-500/30 hover:border-green-500/50 disabled:border-white/10
                             rounded-lg text-white disabled:text-white/40 transition-all flex items-center justify-center text-sm"
                  >
                    <Link size={16} className="mr-2" />
                    Generate Share Link
                  </button>
                </div>
              </div>
            </div>

            {/* Share Link & QR Code Section */}
            <div className="space-y-4">
              {/* Share Link */}
              {shareLink ? (
                <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                  <h2 className="text-lg font-semibold text-white mb-3 flex items-center">
                    <Link size={18} className="mr-2" />
                    Share Link
                  </h2>

                  <div className="space-y-4">
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={shareLink}
                        readOnly
                        className="flex-1 p-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm"
                      />
                      <button
                        onClick={() => copyToClipboard(shareLink)}
                        className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white transition-all"
                      >
                        <Copy size={16} />
                      </button>
                    </div>

                    {/* Quick Share Buttons */}
                    <div className="grid grid-cols-2 gap-2">
                      <button className="flex items-center justify-center space-x-2 p-2 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded-lg text-white transition-all text-sm">
                        <Mail size={16} />
                        <span>Email</span>
                      </button>
                      <button className="flex items-center justify-center space-x-2 p-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 rounded-lg text-white transition-all text-sm">
                        <MessageCircle size={16} />
                        <span>Message</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white/5 rounded-xl border border-white/10 p-4 h-40 flex items-center justify-center">
                  <div className="text-center">
                    <Link size={40} className="text-white/20 mx-auto mb-2" />
                    <p className="text-white/40 text-sm">Generate a share link to see options</p>
                  </div>
                </div>
              )}

              {/* QR Code */}
              {qrCodeData ? (
                <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                  <h2 className="text-lg font-semibold text-white mb-3 flex items-center">
                    <QrCode size={18} className="mr-2" />
                    QR Code
                  </h2>

                  <div className="text-center">
                    <div className="bg-white p-4 rounded-lg inline-block mb-3">
                      <QrCode size={100} className="text-black" />
                    </div>
                    <p className="text-white/60 text-sm">Scan to access the shared file</p>
                  </div>
                </div>
              ) : (
                <div className="bg-white/5 rounded-xl border border-white/10 p-4 h-40 flex items-center justify-center">
                  <div className="text-center">
                    <QrCode size={40} className="text-white/20 mx-auto mb-2" />
                    <p className="text-white/40 text-sm">QR code will appear here</p>
                  </div>
                </div>
              )}

              {/* Share Analytics (if link exists) */}
              {shareLink && (
                <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                  <h2 className="text-lg font-semibold text-white mb-3 flex items-center">
                    <Users size={18} className="mr-2" />
                    Share Analytics
                  </h2>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-center p-3 bg-white/5 rounded-lg">
                      <p className="text-xl font-bold text-white">0</p>
                      <p className="text-white/60 text-sm">Views</p>
                    </div>
                    <div className="text-center p-3 bg-white/5 rounded-lg">
                      <p className="text-xl font-bold text-white">0</p>
                      <p className="text-white/60 text-sm">Downloads</p>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1">
                    <p className="text-white/80 text-sm">
                      <strong>Created:</strong> {new Date().toLocaleDateString()}
                    </p>
                    <p className="text-white/80 text-sm">
                      <strong>Expires:</strong> {shareSettings.expirationTime === 'never' ? 'Never' : `In ${shareSettings.expirationTime}`}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Features Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="group relative overflow-hidden bg-gradient-to-br from-green-500/10 to-green-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-green-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-green-500/0 to-green-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-green-500/20 rounded-lg inline-block mb-3">
                  <Link size={20} className="text-green-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Secure Links</h3>
                <p className="text-white/60 text-xs leading-relaxed">Password protected sharing</p>
              </div>
            </div>
            <div className="group relative overflow-hidden bg-gradient-to-br from-blue-500/10 to-blue-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-blue-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-blue-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-blue-500/20 rounded-lg inline-block mb-3">
                  <Clock size={20} className="text-blue-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Time Limited</h3>
                <p className="text-white/60 text-xs leading-relaxed">Auto-expiring links</p>
              </div>
            </div>
            <div className="group relative overflow-hidden bg-gradient-to-br from-purple-500/10 to-purple-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-purple-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-purple-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-purple-500/20 rounded-lg inline-block mb-3">
                  <QrCode size={20} className="text-purple-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">QR Codes</h3>
                <p className="text-white/60 text-xs leading-relaxed">Easy mobile sharing</p>
              </div>
            </div>
            <div className="group relative overflow-hidden bg-gradient-to-br from-orange-500/10 to-orange-600/5 backdrop-blur-xl rounded-xl border border-white/10 p-5 hover:border-orange-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/0 to-orange-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="p-2.5 bg-orange-500/20 rounded-lg inline-block mb-3">
                  <Users size={20} className="text-orange-400" />
                </div>
                <h3 className="text-white font-semibold mb-1.5 text-sm">Analytics</h3>
                <p className="text-white/60 text-xs leading-relaxed">Track access and downloads</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareToolsInterface;
import React, { useState, useRef, useEffect } from 'react';
import {
  Download, Link, Youtube, Twitter, Instagram, Music2, Clipboard,
  ArrowRight, Sparkles, Check, AlertCircle, ChevronRight, Sliders,
  X, Play, Pause, Clock, Zap, Video, Image, FileAudio, Loader2,
  Settings, Search, Command, Grid, List, BarChart3, History, Trash2,
  ExternalLink, Copy, FolderDown, Globe, Film, Camera, Key, Cookie, Shield
} from 'lucide-react';

// Platform types
type Platform = 'youtube' | 'twitter' | 'instagram' | 'tiktok' | 'auto';

interface DownloadItem {
  id: string;
  url: string;
  platform: Platform;
  title: string;
  thumbnail?: string;
  duration?: string;
  author?: string;
  status: 'pending' | 'fetching' | 'ready' | 'downloading' | 'completed' | 'error';
  progress?: number;
  error?: string;
  downloadUrl?: string;
  fileSize?: string;
  quality?: string;
  mediaType?: 'video' | 'audio' | 'image';
}

interface QualityOption {
  id: string;
  label: string;
  resolution?: string;
  format: string;
  hasAudio: boolean;
  fileSize?: string;
}

interface DownloadToolsInterfaceProps {
  defaultPlatform?: Platform;
}

const DownloadToolsInterface: React.FC<DownloadToolsInterfaceProps> = ({ defaultPlatform = 'auto' }) => {
  // State management
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState<Platform>(defaultPlatform);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState<string>('best');
  const [downloadHistory, setDownloadHistory] = useState<DownloadItem[]>([]);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  // Cookie management state
  const [showCookieModal, setShowCookieModal] = useState(false);
  const [cookieText, setCookieText] = useState('');
  const [hasCookies, setHasCookies] = useState(false);
  const [cookieLoading, setCookieLoading] = useState(false);
  const [cookieError, setCookieError] = useState<string | null>(null);
  const [cookieSuccess, setCookieSuccess] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Quality options for video downloads
  const qualityOptions: QualityOption[] = [
    { id: 'best', label: 'Best Quality', resolution: '4K/1080p', format: 'MP4', hasAudio: true },
    { id: '1080p', label: 'Full HD', resolution: '1080p', format: 'MP4', hasAudio: true },
    { id: '720p', label: 'HD', resolution: '720p', format: 'MP4', hasAudio: true },
    { id: '480p', label: 'SD', resolution: '480p', format: 'MP4', hasAudio: true },
    { id: 'audio', label: 'Audio Only', format: 'MP3', hasAudio: true },
  ];

  // Platform configurations
  const platforms = [
    { id: 'auto' as Platform, name: 'Auto Detect', icon: Globe, color: 'text-white/60', description: 'Automatically detect platform' },
    { id: 'youtube' as Platform, name: 'YouTube', icon: Youtube, color: 'text-red-500', description: 'Videos, Shorts, Music' },
    { id: 'twitter' as Platform, name: 'X (Twitter)', icon: Twitter, color: 'text-blue-400', description: 'Videos, GIFs, Images' },
    { id: 'instagram' as Platform, name: 'Instagram', icon: Instagram, color: 'text-pink-500', description: 'Reels, Posts, Stories' },
    { id: 'tiktok' as Platform, name: 'TikTok', icon: Music2, color: 'text-cyan-400', description: 'Videos without watermark' },
  ];

  // Statistics
  const [stats] = useState({
    totalDownloaded: 156,
    totalSize: '12.4 GB',
    avgSpeed: '8.2 MB/s',
    queueLength: 0
  });

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        handlePasteFromClipboard();
      }
      if (e.key === 'Escape') {
        setShowCommandPalette(false);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  // Check cookie status on mount
  useEffect(() => {
    checkCookieStatus();
  }, []);

  // Cookie management functions
  const checkCookieStatus = async () => {
    try {
      const response = await fetch('/api/download/cookies/status');
      const data = await response.json();
      if (data.success) {
        setHasCookies(data.data.hasCookies);
      }
    } catch (error) {
      console.error('Error checking cookie status:', error);
    }
  };

  const handleSaveCookies = async () => {
    if (!cookieText.trim()) {
      setCookieError('Please paste your cookies');
      return;
    }

    setCookieLoading(true);
    setCookieError(null);
    setCookieSuccess(null);

    try {
      const response = await fetch('/api/download/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: cookieText }),
      });

      const data = await response.json();

      if (data.success) {
        setHasCookies(true);
        setCookieSuccess('Cookies saved successfully');
        setCookieText('');
        setTimeout(() => {
          setShowCookieModal(false);
          setCookieSuccess(null);
        }, 1500);
      } else {
        setCookieError(data.error || 'Failed to save cookies');
      }
    } catch (error) {
      console.error('Error saving cookies:', error);
      setCookieError('Network error - please try again');
    }

    setCookieLoading(false);
  };

  const handleDeleteCookies = async () => {
    setCookieLoading(true);
    setCookieError(null);

    try {
      const response = await fetch('/api/download/cookies', {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        setHasCookies(false);
        setCookieSuccess('Cookies deleted');
        setTimeout(() => setCookieSuccess(null), 2000);
      } else {
        setCookieError(data.error || 'Failed to delete cookies');
      }
    } catch (error) {
      console.error('Error deleting cookies:', error);
      setCookieError('Network error - please try again');
    }

    setCookieLoading(false);
  };

  // Detect platform from URL
  const detectPlatform = (inputUrl: string): Platform => {
    if (inputUrl.includes('youtube.com') || inputUrl.includes('youtu.be')) return 'youtube';
    if (inputUrl.includes('twitter.com') || inputUrl.includes('x.com')) return 'twitter';
    if (inputUrl.includes('instagram.com')) return 'instagram';
    if (inputUrl.includes('tiktok.com')) return 'tiktok';
    return 'auto';
  };

  // Handle URL input change
  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    setUrl(newUrl);

    if (platform === 'auto' && newUrl.length > 10) {
      const detected = detectPlatform(newUrl);
      if (detected !== 'auto') {
        setPlatform(detected);
      }
    }
  };

  // Paste from clipboard
  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
        setUrl(text);
        const detected = detectPlatform(text);
        if (detected !== 'auto') {
          setPlatform(detected);
        }
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
    }
  };

  // Fetch media info
  const handleFetchInfo = async () => {
    if (!url.trim()) return;

    const newItem: DownloadItem = {
      id: `download-${Date.now()}`,
      url: url.trim(),
      platform: platform === 'auto' ? detectPlatform(url) : platform,
      title: 'Fetching info...',
      status: 'fetching',
    };

    setDownloads(prev => [...prev, newItem]);
    setUrl('');
    setIsProcessing(true);

    try {
      // Call backend API to fetch media info
      const response = await fetch('/api/download/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newItem.url, platform: newItem.platform }),
      });

      const data = await response.json();

      if (data.success) {
        setDownloads(prev => prev.map(d =>
          d.id === newItem.id
            ? {
                ...d,
                title: data.data.title || 'Unknown Title',
                thumbnail: data.data.thumbnail,
                duration: data.data.duration,
                author: data.data.author,
                status: 'ready',
                mediaType: data.data.mediaType || 'video',
              }
            : d
        ));
      } else {
        setDownloads(prev => prev.map(d =>
          d.id === newItem.id
            ? { ...d, status: 'error', error: data.error || 'Failed to fetch info' }
            : d
        ));
      }
    } catch (error) {
      console.error('Error fetching media info:', error);
      setDownloads(prev => prev.map(d =>
        d.id === newItem.id
          ? { ...d, status: 'error', error: 'Network error - please try again' }
          : d
      ));
    }

    setIsProcessing(false);
  };

  // Poll for download status
  const pollDownloadStatus = async (backendId: string, frontendId: string) => {
    const poll = async () => {
      try {
        const response = await fetch(`/api/download/status/${backendId}`);
        const data = await response.json();

        if (data.success) {
          const status = data.data;

          setDownloads(prev => prev.map(d =>
            d.id === frontendId
              ? {
                  ...d,
                  status: status.status === 'completed' ? 'completed' :
                          status.status === 'error' ? 'error' :
                          status.status === 'merging' ? 'downloading' : 'downloading',
                  progress: status.progress || 0,
                  fileSize: status.filesize || '',
                  error: status.error,
                  downloadUrl: status.status === 'completed' ? `/api/download/file/${backendId}` : undefined,
                }
              : d
          ));

          // Continue polling if not completed or error
          if (status.status !== 'completed' && status.status !== 'error') {
            setTimeout(poll, 500);
          } else if (status.status === 'completed') {
            // Add to history
            const item = downloads.find(d => d.id === frontendId);
            if (item) {
              setDownloadHistory(prev => [{
                ...item,
                status: 'completed',
                fileSize: status.filesize,
                downloadUrl: `/api/download/file/${backendId}`,
              }, ...prev].slice(0, 20));
            }
          }
        }
      } catch (error) {
        console.error('Error polling status:', error);
      }
    };

    poll();
  };

  // Start download
  const handleDownload = async (itemId: string) => {
    const item = downloads.find(d => d.id === itemId);
    if (!item) return;

    setDownloads(prev => prev.map(d =>
      d.id === itemId ? { ...d, status: 'downloading', progress: 0 } : d
    ));

    try {
      // Call backend API to start download
      const response = await fetch('/api/download/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: item.url,
          quality: selectedQuality,
          audioOnly: selectedQuality === 'audio',
        }),
      });

      const data = await response.json();

      if (data.success && data.data.downloadId) {
        // Start polling for status
        pollDownloadStatus(data.data.downloadId, itemId);
      } else {
        setDownloads(prev => prev.map(d =>
          d.id === itemId ? { ...d, status: 'error', error: data.error || 'Failed to start download' } : d
        ));
      }
    } catch (error) {
      console.error('Error starting download:', error);
      setDownloads(prev => prev.map(d =>
        d.id === itemId ? { ...d, status: 'error', error: 'Network error - please try again' } : d
      ));
    }
  };

  // Remove download item
  const removeItem = (itemId: string) => {
    setDownloads(prev => prev.filter(d => d.id !== itemId));
  };

  // Get platform icon component
  const getPlatformIcon = (platformId: Platform) => {
    const platformConfig = platforms.find(p => p.id === platformId);
    if (!platformConfig) return Globe;
    return platformConfig.icon;
  };

  // Get platform color
  const getPlatformColor = (platformId: Platform) => {
    const platformConfig = platforms.find(p => p.id === platformId);
    return platformConfig?.color || 'text-white/60';
  };

  return (
    <div className="h-full w-full">
      <div className="flex flex-col h-full bg-[#121212] text-white overflow-hidden">
        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar - Platforms & history (hidden on mobile) */}
          <aside className="hidden lg:flex lg:w-64 flex-shrink-0 flex-col border-r border-[#2a2a2d] bg-[#121212] overflow-y-auto">
            <div className="p-4 space-y-6">
              {/* Platforms */}
              <div>
                <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">Platforms</h3>
                <div className="space-y-1.5">
                  {platforms.map(p => {
                    const Icon = p.icon;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setPlatform(p.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 border rounded-lg transition-all text-left group ${
                          platform === p.id
                            ? 'bg-[#1f1f20] border-[#3a3a3d]'
                            : 'bg-[#19191a] border-[#2a2a2d] hover:bg-[#1f1f20] hover:border-gray-500'
                        }`}
                      >
                        <Icon size={18} className={p.color} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white/90">{p.name}</div>
                          <div className="text-xs text-white/40">{p.description}</div>
                        </div>
                        {platform === p.id && (
                          <Check size={14} className="text-emerald-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Recent downloads */}
              {downloadHistory.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <History size={12} />
                    Recent
                  </h3>
                  <div className="space-y-1.5">
                    {downloadHistory.slice(0, 5).map(item => (
                      <div
                        key={item.id}
                        className="px-3 py-2 bg-[#19191a] border border-[#2a2a2d] rounded-lg"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Check size={12} className="text-emerald-400 flex-shrink-0" />
                          <span className="text-xs text-white/70 truncate">{item.title}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/40 capitalize">{item.platform}</span>
                          <span className="text-white/30">{item.fileSize}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div>
                <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <BarChart3 size={12} />
                  Statistics
                </h3>
                <div className="space-y-3 px-3 py-3 bg-[#19191a] border border-[#2a2a2d] rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/50">Total Downloaded</span>
                    <span className="text-xs font-medium text-white/70">{stats.totalDownloaded}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/50">Total Size</span>
                    <span className="text-xs font-medium text-white/70">{stats.totalSize}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/50">Avg Speed</span>
                    <span className="text-xs font-medium text-white/70">{stats.avgSpeed}</span>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* Center - Main work area */}
          <main className="flex-1 overflow-y-auto bg-[#121212]">
            <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-4xl mx-auto">
              {/* Mobile Platform Selector (visible only on mobile) */}
              <div className="lg:hidden">
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {platforms.map(p => {
                    const Icon = p.icon;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setPlatform(p.id)}
                        className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-all whitespace-nowrap flex-shrink-0 ${
                          platform === p.id
                            ? 'bg-[#1f1f20] border-[#3a3a3d]'
                            : 'bg-[#19191a] border-[#2a2a2d]'
                        }`}
                      >
                        <Icon size={16} className={p.color} />
                        <span className="text-sm text-white/90">{p.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* URL Input Section */}
              <div className="bg-[#19191a] border border-[#2a2a2d] rounded-lg p-4 md:p-6">
                <h2 className="text-base md:text-lg font-semibold mb-4 flex items-center gap-2">
                  <Download size={20} className="text-blue-400" />
                  Download Media
                </h2>

                {/* URL Input */}
                <div className="space-y-4">
                  <div className="relative">
                    <div className="flex items-center gap-2 px-4 py-3 bg-[#121212] border border-[#3a3a3d] hover:border-gray-500 focus-within:border-blue-500/50 rounded-lg transition-all">
                      <Link size={18} className="text-white/40" />
                      <input
                        ref={inputRef}
                        type="text"
                        value={url}
                        onChange={handleUrlChange}
                        placeholder="Paste URL from YouTube, Twitter, Instagram, TikTok..."
                        className="flex-1 bg-transparent text-white/90 placeholder:text-white/40 focus:outline-none text-sm"
                        onKeyDown={(e) => e.key === 'Enter' && handleFetchInfo()}
                      />
                      <button
                        onClick={handlePasteFromClipboard}
                        className="p-1.5 hover:bg-[#2a2a2d] rounded-lg transition-all"
                        title="Paste from clipboard"
                      >
                        <Clipboard size={16} className="text-white/40" />
                      </button>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleFetchInfo}
                      disabled={!url.trim() || isProcessing}
                      className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-[#19191a] hover:bg-[#1f1f20] disabled:bg-[#19191a] border border-[#3a3a3d] hover:border-gray-500 disabled:border-[#2a2a2d] rounded-lg text-white disabled:text-white/40 transition-all font-medium h-11"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />
                          Fetching...
                        </>
                      ) : (
                        <>
                          <Search size={18} />
                          Fetch Info
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* YouTube Auth Notice (Mobile) */}
              <div className="xl:hidden">
                <div className={`flex items-center justify-between p-3 rounded-lg border ${hasCookies ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
                  <div className="flex items-center gap-3">
                    <Shield size={16} className={hasCookies ? 'text-emerald-400' : 'text-amber-400'} />
                    <div>
                      <span className={`text-xs font-medium ${hasCookies ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {hasCookies ? 'YouTube Auth Active' : 'YouTube Auth Required'}
                      </span>
                      <p className="text-xs text-white/40">
                        {hasCookies ? 'Cookies configured' : 'Add cookies to download from YouTube'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowCookieModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#19191a] hover:bg-[#1f1f20] border border-[#3a3a3d] rounded-lg text-xs text-white/70 transition-all"
                  >
                    <Key size={12} />
                    {hasCookies ? 'Manage' : 'Setup'}
                  </button>
                </div>
              </div>

              {/* Quality Selection */}
              <div className="bg-[#19191a] border border-[#2a2a2d] rounded-lg p-4">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Sliders size={14} className="text-white/60" />
                  Quality
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:flex md:flex-wrap gap-2">
                  {qualityOptions.map(option => (
                    <button
                      key={option.id}
                      onClick={() => setSelectedQuality(option.id)}
                      className={`px-3 md:px-4 py-2 rounded-lg border text-sm transition-all ${
                        selectedQuality === option.id
                          ? 'bg-[#2a2a2d] border-[#3a3a3d] text-white'
                          : 'bg-[#121212] border-[#2a2a2d] text-white/70 hover:bg-[#1f1f20] hover:border-gray-500'
                      }`}
                    >
                      <div className="font-medium text-xs md:text-sm">{option.label}</div>
                      <div className="text-xs text-white/50">{option.resolution || option.format}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Download Queue */}
              {downloads.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-white/70">Download Queue ({downloads.length})</h3>
                    <button
                      onClick={() => setDownloads([])}
                      className="text-xs text-white/50 hover:text-white/70 transition-colors"
                    >
                      Clear All
                    </button>
                  </div>

                  {downloads.map(item => {
                    const PlatformIcon = getPlatformIcon(item.platform);
                    return (
                      <div
                        key={item.id}
                        className="bg-[#19191a] border border-[#2a2a2d] rounded-lg p-3 md:p-4 transition-all hover:border-gray-500"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start gap-3 md:gap-4">
                          {/* Thumbnail */}
                          <div className="w-full sm:w-24 h-32 sm:h-16 bg-[#2a2a2d] rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                            {item.thumbnail ? (
                              <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <PlatformIcon size={24} className={getPlatformColor(item.platform)} />
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <h4 className="text-sm font-medium text-white/90 truncate">{item.title}</h4>
                                <div className="flex flex-wrap items-center gap-2 md:gap-3 mt-1">
                                  {item.author && (
                                    <span className="text-xs text-white/50">{item.author}</span>
                                  )}
                                  {item.duration && (
                                    <span className="text-xs text-white/40">{item.duration}</span>
                                  )}
                                  <span className={`text-xs capitalize ${getPlatformColor(item.platform)}`}>
                                    {item.platform}
                                  </span>
                                </div>
                              </div>
                              <button
                                onClick={() => removeItem(item.id)}
                                className="p-1 hover:bg-[#2a2a2d] rounded transition-all"
                              >
                                <X size={14} className="text-white/40" />
                              </button>
                            </div>

                            {/* Status */}
                            <div className="mt-3">
                              {item.status === 'fetching' && (
                                <div className="flex items-center gap-2 text-xs text-blue-400">
                                  <Loader2 size={12} className="animate-spin" />
                                  Fetching media info...
                                </div>
                              )}

                              {item.status === 'ready' && (
                                <button
                                  onClick={() => handleDownload(item.id)}
                                  className="flex items-center gap-2 px-4 py-2 bg-[#19191a] hover:bg-[#1f1f20] border border-[#3a3a3d] hover:border-gray-500 rounded-lg text-sm text-emerald-400 transition-all"
                                >
                                  <Download size={14} />
                                  Download
                                </button>
                              )}

                              {item.status === 'downloading' && (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-white/50">Downloading...</span>
                                    <span className="text-white/70 font-medium">{Math.round(item.progress || 0)}%</span>
                                  </div>
                                  <div className="h-1.5 bg-[#2a2a2d] rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-500 transition-all duration-300"
                                      style={{ width: `${item.progress || 0}%` }}
                                    />
                                  </div>
                                </div>
                              )}

                              {item.status === 'completed' && (
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 text-xs text-emerald-400">
                                    <Check size={12} />
                                    Downloaded ({item.fileSize})
                                  </div>
                                  <a
                                    href={item.downloadUrl}
                                    download
                                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#19191a] hover:bg-[#1f1f20] border border-[#3a3a3d] rounded-lg text-xs text-white/70 transition-all"
                                  >
                                    <FolderDown size={12} />
                                    Save File
                                  </a>
                                </div>
                              )}

                              {item.status === 'error' && (
                                <div className="flex items-center gap-2 text-xs text-red-400">
                                  <AlertCircle size={12} />
                                  {item.error || 'Download failed'}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Empty state */}
              {downloads.length === 0 && (
                <div className="text-center py-8 md:py-12 px-4">
                  <div className="inline-flex p-3 md:p-4 bg-[#19191a] rounded-lg border border-[#2a2a2d] mb-4">
                    <Download size={28} className="text-white/30 md:w-8 md:h-8" />
                  </div>
                  <h3 className="text-base md:text-lg font-medium text-white/70 mb-2">No downloads yet</h3>
                  <p className="text-xs md:text-sm text-white/40 max-w-md mx-auto">
                    Paste a URL from YouTube, Twitter, Instagram, or TikTok to download videos, images, and audio.
                  </p>
                </div>
              )}
            </div>
          </main>

          {/* Right sidebar - Tips & info (hidden on mobile) */}
          <aside className="hidden xl:flex xl:w-72 flex-shrink-0 flex-col border-l border-[#2a2a2d] bg-[#121212] overflow-y-auto">
            <div className="p-4 space-y-6">
              {/* Supported content */}
              <div>
                <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">Supported Content</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 p-3 bg-[#19191a] border border-[#2a2a2d] rounded-lg">
                    <Youtube size={16} className="text-red-500" />
                    <div className="flex-1">
                      <div className="text-xs font-medium text-white/80">YouTube</div>
                      <div className="text-xs text-white/40">Videos, Shorts, Music, Playlists</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-[#19191a] border border-[#2a2a2d] rounded-lg">
                    <Twitter size={16} className="text-blue-400" />
                    <div className="flex-1">
                      <div className="text-xs font-medium text-white/80">X (Twitter)</div>
                      <div className="text-xs text-white/40">Videos, GIFs, Images</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-[#19191a] border border-[#2a2a2d] rounded-lg">
                    <Instagram size={16} className="text-pink-500" />
                    <div className="flex-1">
                      <div className="text-xs font-medium text-white/80">Instagram</div>
                      <div className="text-xs text-white/40">Reels, Posts, Stories, IGTV</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-[#19191a] border border-[#2a2a2d] rounded-lg">
                    <Music2 size={16} className="text-cyan-400" />
                    <div className="flex-1">
                      <div className="text-xs font-medium text-white/80">TikTok</div>
                      <div className="text-xs text-white/40">Videos without watermark</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tips */}
              <div className="p-4 bg-[#19191a] border border-[#2a2a2d] rounded-lg">
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Sparkles size={14} className="text-blue-400" />
                  Tips
                </h4>
                <ul className="space-y-2 text-xs text-white/60">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">•</span>
                    Copy URL directly from the app's share button
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">•</span>
                    Use "Audio Only" to extract music from videos
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">•</span>
                    Private content requires authentication
                  </li>
                </ul>
              </div>

              {/* Keyboard shortcuts */}
              <div className="p-4 bg-[#19191a] border border-[#2a2a2d] rounded-lg">
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Command size={14} className="text-white/60" />
                  Shortcuts
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-white/60">Paste URL</span>
                    <kbd className="px-2 py-0.5 bg-[#2a2a2d] border border-[#3a3a3d] rounded text-white/80">⌘V</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/60">Command Palette</span>
                    <kbd className="px-2 py-0.5 bg-[#2a2a2d] border border-[#3a3a3d] rounded text-white/80">⌘K</kbd>
                  </div>
                </div>
              </div>

              {/* YouTube Authentication */}
              <div className="p-4 bg-[#19191a] border border-[#2a2a2d] rounded-lg">
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Shield size={14} className="text-amber-400" />
                  YouTube Auth
                </h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${hasCookies ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="text-xs text-white/60">
                      {hasCookies ? 'Cookies configured' : 'No cookies set'}
                    </span>
                  </div>
                  <p className="text-xs text-white/40">
                    YouTube requires cookies to bypass bot detection. Export your cookies from browser and paste them here.
                  </p>
                  <button
                    onClick={() => setShowCookieModal(true)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#121212] hover:bg-[#1f1f20] border border-[#3a3a3d] hover:border-gray-500 rounded-lg text-xs text-white/70 transition-all"
                  >
                    <Key size={12} />
                    {hasCookies ? 'Manage Cookies' : 'Add Cookies'}
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* Command Palette Modal */}
        {showCommandPalette && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[10vh] md:pt-[15vh] z-50 px-4" onClick={() => setShowCommandPalette(false)}>
            <div className="w-full max-w-2xl bg-[#1f1f20] border border-[#3a3a3d] rounded-lg shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-[#2a2a2d]">
                <div className="flex items-center gap-3 px-4 py-3 bg-[#19191a] border border-[#3a3a3d] rounded-lg">
                  <Search size={18} className="text-white/40" />
                  <input
                    type="text"
                    placeholder="Type a command or search..."
                    className="flex-1 bg-transparent text-white/90 placeholder:text-white/40 focus:outline-none"
                    autoFocus
                  />
                  <kbd className="px-2 py-1 bg-[#2a2a2d] border border-[#3a3a3d] rounded text-xs text-white/60">ESC</kbd>
                </div>
              </div>
              <div className="p-2 max-h-96 overflow-y-auto">
                <div className="space-y-1">
                  {[
                    { label: 'Paste URL', shortcut: '⌘V', icon: Clipboard },
                    { label: 'Download All', shortcut: '⌘D', icon: Download },
                    { label: 'Clear Queue', shortcut: '', icon: Trash2 },
                    { label: 'View History', shortcut: '⌘H', icon: History },
                  ].map((cmd, i) => (
                    <button
                      key={i}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#2a2a2d] rounded-lg transition-all text-left"
                    >
                      <div className="flex items-center gap-3">
                        <cmd.icon size={16} className="text-white/40" />
                        <span className="text-sm text-white/80">{cmd.label}</span>
                      </div>
                      {cmd.shortcut && (
                        <kbd className="px-2 py-1 bg-[#19191a] border border-[#3a3a3d] rounded text-xs text-white/60">{cmd.shortcut}</kbd>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Cookie Management Modal */}
        {showCookieModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4" onClick={() => setShowCookieModal(false)}>
            <div className="w-full max-w-lg bg-[#1f1f20] border border-[#3a3a3d] rounded-lg shadow-2xl" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-[#2a2a2d]">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-500/10 rounded-lg">
                    <Key size={18} className="text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-white/90">YouTube Cookies</h3>
                    <p className="text-xs text-white/50">Required for YouTube downloads</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowCookieModal(false)}
                  className="p-1.5 hover:bg-[#2a2a2d] rounded-lg transition-all"
                >
                  <X size={16} className="text-white/40" />
                </button>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                {/* Status indicator */}
                <div className={`flex items-center gap-3 p-3 rounded-lg ${hasCookies ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-amber-500/10 border border-amber-500/20'}`}>
                  <div className={`w-2 h-2 rounded-full ${hasCookies ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className={`text-xs ${hasCookies ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {hasCookies ? 'Cookies are configured and active' : 'No cookies configured - YouTube downloads may fail'}
                  </span>
                </div>

                {/* Instructions */}
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-white/70">How to get cookies:</h4>
                  <ol className="text-xs text-white/50 space-y-1.5 list-decimal list-inside">
                    <li>Install a browser extension like "Get cookies.txt LOCALLY"</li>
                    <li>Go to YouTube and make sure you're logged in</li>
                    <li>Click the extension and export cookies in Netscape format</li>
                    <li>Paste the entire cookie content below</li>
                  </ol>
                </div>

                {/* Cookie input */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-white/70">Cookie content (Netscape format):</label>
                  <textarea
                    value={cookieText}
                    onChange={(e) => setCookieText(e.target.value)}
                    placeholder="# Netscape HTTP Cookie File&#10;.youtube.com	TRUE	/	TRUE	..."
                    className="w-full h-32 px-3 py-2 bg-[#121212] border border-[#3a3a3d] focus:border-blue-500/50 rounded-lg text-xs text-white/90 placeholder:text-white/30 focus:outline-none resize-none font-mono"
                  />
                </div>

                {/* Error/Success messages */}
                {cookieError && (
                  <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <AlertCircle size={12} className="text-red-400" />
                    <span className="text-xs text-red-400">{cookieError}</span>
                  </div>
                )}
                {cookieSuccess && (
                  <div className="flex items-center gap-2 p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <Check size={12} className="text-emerald-400" />
                    <span className="text-xs text-emerald-400">{cookieSuccess}</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 p-4 border-t border-[#2a2a2d]">
                {hasCookies && (
                  <button
                    onClick={handleDeleteCookies}
                    disabled={cookieLoading}
                    className="flex items-center gap-2 px-4 py-2 hover:bg-red-500/10 border border-[#3a3a3d] hover:border-red-500/30 rounded-lg text-xs text-red-400 transition-all disabled:opacity-50"
                  >
                    <Trash2 size={12} />
                    Delete Cookies
                  </button>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={() => setShowCookieModal(false)}
                    className="px-4 py-2 hover:bg-[#2a2a2d] border border-[#3a3a3d] rounded-lg text-xs text-white/70 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveCookies}
                    disabled={cookieLoading || !cookieText.trim()}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 rounded-lg text-xs text-white transition-all disabled:cursor-not-allowed"
                  >
                    {cookieLoading ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check size={12} />
                        Save Cookies
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DownloadToolsInterface;

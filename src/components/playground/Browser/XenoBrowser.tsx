import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  X,
  Maximize2,
  Minimize2,
  ExternalLink,
  Lock,
  Loader2,
  AlertCircle,
  Globe
} from 'lucide-react';

interface XenoBrowserProps {
  initialUrl?: string;
  onClose?: () => void;
  onUrlChange?: (url: string) => void;
  onAgentResult?: (result: any) => void;
  className?: string;
}

export interface XenoBrowserRef {
  sendAgentCommand: (command: string, payload: any) => Promise<any>;
  getCurrentUrl: () => string;
  navigateTo: (url: string) => void;
  getIframeOffset: () => { x: number; y: number };
}

const XenoBrowser = forwardRef<XenoBrowserRef, XenoBrowserProps>(({
  initialUrl = 'https://www.google.com',
  onClose,
  onUrlChange,
  onAgentResult,
  className = ''
}, ref) => {
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [pageTitle, setPageTitle] = useState('Loading...');

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Update when initialUrl changes (from parent component)
  useEffect(() => {
    if (initialUrl && initialUrl !== currentUrl) {
      navigateTo(initialUrl);
    }
  }, [initialUrl]);

  // Pending agent command resolvers
  const pendingCommands = useRef<Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void }>>(new Map());

  // Listen for navigation events and agent results from the proxied iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Check if this is a navigation message from our proxy
      if (event.data && event.data.type === 'xeno-browser-navigation') {
        const { url, title, action } = event.data;

        console.log('[XenoBrowser] Navigation event:', action, url);

        if (url && url !== currentUrl) {
          // Update URL bar without triggering a new navigation (it's already happening in the iframe)
          setCurrentUrl(url);
          setInputUrl(url);

          // Update history for navigation events (not just loads)
          if (action === 'click' || action === 'form') {
            const newHistory = history.slice(0, historyIndex + 1);
            newHistory.push(url);
            setHistory(newHistory);
            setHistoryIndex(newHistory.length - 1);
          }

          // Notify parent of URL change
          onUrlChange?.(url);
        }

        // Update title if provided
        if (title) {
          setPageTitle(title);
        }
      }

      // Handle agent command results
      if (event.data && event.data.type === 'xeno-agent-result') {
        const { commandId, ...result } = event.data;
        console.log('[XenoBrowser] Agent result:', commandId, result);

        // Resolve pending command
        if (commandId && pendingCommands.current.has(commandId)) {
          const { resolve } = pendingCommands.current.get(commandId)!;
          pendingCommands.current.delete(commandId);
          resolve(result);
        }

        // Notify parent of agent result
        onAgentResult?.(result);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [currentUrl, history, historyIndex, onUrlChange, onAgentResult]);

  // Send agent command to iframe
  const sendAgentCommand = useCallback((command: string, payload: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      const commandId = `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Store resolver
      pendingCommands.current.set(commandId, { resolve, reject });

      // Set timeout for command
      setTimeout(() => {
        if (pendingCommands.current.has(commandId)) {
          pendingCommands.current.delete(commandId);
          reject(new Error('Command timeout'));
        }
      }, 10000);

      // Send command to iframe
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'xeno-agent-command',
          command,
          payload,
          commandId
        }, '*');
      } else {
        reject(new Error('Iframe not available'));
      }
    });
  }, []);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    sendAgentCommand,
    getCurrentUrl: () => currentUrl,
    navigateTo,
    getIframeOffset: () => {
      // Get the iframe's position relative to its container
      if (iframeRef.current && containerRef.current) {
        const iframeRect = iframeRef.current.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();
        return {
          x: iframeRect.left - containerRect.left,
          y: iframeRect.top - containerRect.top
        };
      }
      // Fallback: estimate header height (nav bar ~40px + tab bar ~28px = ~68px)
      return { x: 0, y: 68 };
    }
  }), [sendAgentCommand, currentUrl]);

  // Generate proxy URL for iframe
  const getProxyUrl = (url: string): string => {
    return `/api/browser/proxy?url=${encodeURIComponent(url)}`;
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let url = inputUrl.trim();

    // Add https:// if no protocol specified
    if (url && !url.match(/^https?:\/\//)) {
      url = 'https://' + url;
    }

    if (url) {
      navigateTo(url);
    }
  };

  const navigateTo = (url: string) => {
    setIsLoading(true);
    setCurrentUrl(url);
    setInputUrl(url);
    setPageTitle('Loading...');
    onUrlChange?.(url);

    // Update history
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(url);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const url = history[newIndex];
      setCurrentUrl(url);
      setInputUrl(url);
      setIsLoading(true);
      onUrlChange?.(url);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      const url = history[newIndex];
      setCurrentUrl(url);
      setInputUrl(url);
      setIsLoading(true);
      onUrlChange?.(url);
    }
  };

  const refresh = () => {
    setIsLoading(true);
    if (iframeRef.current) {
      iframeRef.current.src = getProxyUrl(currentUrl);
    }
  };

  const goHome = () => {
    navigateTo('https://www.google.com');
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const openExternal = () => {
    window.open(currentUrl, '_blank');
  };

  const getDomain = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return url;
    }
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
    setPageTitle(getDomain(currentUrl));
  };

  return (
    <div
      ref={containerRef}
      className={`flex flex-col h-full bg-[#0a0a0a] ${className}`}
    >
      {/* Browser Header */}
      <div className="flex-shrink-0 bg-[#141414] border-b border-[#2a2a2d]">
        {/* Navigation Bar */}
        <div className="flex items-center gap-2 px-3 py-2">
          {/* Navigation Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={goBack}
              disabled={historyIndex === 0}
              className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-[#2a2a2d] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 transition-colors"
              title="Go back"
            >
              <ArrowLeft size={16} />
            </button>
            <button
              onClick={goForward}
              disabled={historyIndex >= history.length - 1}
              className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-[#2a2a2d] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 transition-colors"
              title="Go forward"
            >
              <ArrowRight size={16} />
            </button>
            <button
              onClick={refresh}
              className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-[#2a2a2d] transition-colors"
              title="Refresh"
            >
              <RotateCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={goHome}
              className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-[#2a2a2d] transition-colors"
              title="Home"
            >
              <Home size={16} />
            </button>
          </div>

          {/* URL Bar */}
          <form onSubmit={handleUrlSubmit} className="flex-1">
            <div className="relative flex items-center">
              <div className="absolute left-3 text-gray-500">
                {currentUrl.startsWith('https') ? (
                  <Lock size={14} className="text-green-500" />
                ) : (
                  <Globe size={14} className="text-gray-400" />
                )}
              </div>
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="Enter URL or search..."
                className="w-full bg-[#0a0a0a] border border-[#2a2a2d] rounded-lg py-1.5 pl-9 pr-3 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[#3a3a3d] transition-colors"
              />
            </div>
          </form>

          {/* Action Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={openExternal}
              className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-[#2a2a2d] transition-colors"
              title="Open in new tab"
            >
              <ExternalLink size={16} />
            </button>
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-[#2a2a2d] transition-colors"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Close browser"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex items-center px-3 py-1 bg-[#0a0a0a]">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#141414] border border-[#2a2a2d] border-b-0 rounded-t-lg text-sm max-w-[250px]">
            {isLoading ? (
              <Loader2 size={14} className="animate-spin text-gray-400 flex-shrink-0" />
            ) : (
              <Globe size={14} className="text-gray-400 flex-shrink-0" />
            )}
            <span className="text-white truncate">{pageTitle}</span>
          </div>
        </div>
      </div>

      {/* Browser Content */}
      <div className="flex-1 relative bg-white">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a] z-10">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={32} className="animate-spin text-white/40" />
              <p className="text-gray-500 text-sm">Loading {getDomain(currentUrl)}...</p>
            </div>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={getProxyUrl(currentUrl)}
          className="w-full h-full border-0"
          title="Xeno Browser"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          onLoad={handleIframeLoad}
        />
      </div>

      {/* Status Bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1 bg-[#141414] border-t border-[#2a2a2d] text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          {isLoading ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              Loading...
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              Ready
            </>
          )}
        </span>
        <span className="truncate max-w-[300px]">{currentUrl}</span>
      </div>
    </div>
  );
});

XenoBrowser.displayName = 'XenoBrowser';

export default XenoBrowser;

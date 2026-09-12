/**
 * XenoOS Terminal Component
 * Real terminal integration with xterm.js for full OS experience
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon } from 'xterm-addon-search';
import 'xterm/css/xterm.css';

interface TerminalProps {
  containerId: string;
  sessionId?: string;
  isMultiUser?: boolean;
  theme?: TerminalTheme;
  className?: string;
  onConnect?: (connected: boolean) => void;
  onResize?: (cols: number, rows: number) => void;
  onTitle?: (title: string) => void;
}

interface TerminalTheme {
  background?: string;
  foreground?: string;
  cursor?: string;
  cursorAccent?: string;
  selection?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

const DEFAULT_THEME: TerminalTheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#1e1e1e',
  selection: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
};

export const Terminal: React.FC<TerminalProps> = ({
  containerId,
  sessionId,
  isMultiUser = false,
  theme = DEFAULT_THEME,
  className = '',
  onConnect,
  onResize,
  onTitle
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');

  // Initialize terminal
  const initializeTerminal = useCallback(() => {
    if (!terminalRef.current || xtermRef.current) return;

    // Create xterm instance
    const xterm = new XTerm({
      theme,
      fontSize: 14,
      fontFamily: 'Fira Code, Consolas, Monaco, monospace',
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      allowTransparency: true,
      convertEol: true,
      disableStdin: false,
      fastScrollModifier: 'shift',
      fastScrollSensitivity: 5,
      scrollSensitivity: 1,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: false,
      rightClickSelectsWord: true,
      wordSeparator: ' ()[]{}\'".,;:',
      altClickMovesCursor: true,
      logLevel: 'warn',
      tabStopWidth: 4
    });

    // Add-ons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);
    xterm.loadAddon(searchAddon);

    // Open terminal
    xterm.open(terminalRef.current);
    fitAddon.fit();

    // Store references
    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Handle resize
    const handleResize = () => {
      if (fitAddon && xterm) {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && onResize) {
          onResize(dims.cols, dims.rows);
        }
        // Send resize to backend
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            cols: dims?.cols || 80,
            rows: dims?.rows || 24
          }));
        }
      }
    };

    // Handle window resize
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(terminalRef.current);

    // Handle data input from terminal
    xterm.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'input',
          data
        }));
      }
    });

    // Handle title changes
    xterm.onTitleChange((title) => {
      onTitle?.(title);
    });

    // Handle binary data
    xterm.onBinary((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'binary',
          data: Array.from(new Uint8Array(data.split('').map(c => c.charCodeAt(0))))
        }));
      }
    });

    // Keyboard shortcuts
    xterm.attachCustomKeyEventHandler((event) => {
      // Ctrl+C: Copy selection if available, otherwise send interrupt
      if (event.ctrlKey && event.key === 'c' && event.type === 'keydown') {
        if (xterm.hasSelection()) {
          document.execCommand('copy');
          return false;
        }
        return true;
      }

      // Ctrl+V: Paste from clipboard
      if (event.ctrlKey && event.key === 'v' && event.type === 'keydown') {
        navigator.clipboard.readText().then(text => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'input',
              data: text
            }));
          }
        }).catch(() => {
          // Fallback for browsers without clipboard API
          const textarea = document.createElement('textarea');
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.focus();
          
          setTimeout(() => {
            const pasteText = textarea.value;
            if (pasteText && wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'input',
                data: pasteText
              }));
            }
            document.body.removeChild(textarea);
          }, 100);
        });
        return false;
      }

      // Ctrl+Shift+F: Search
      if (event.ctrlKey && event.shiftKey && event.key === 'F' && event.type === 'keydown') {
        searchAddon.findNext('');
        return false;
      }

      return true;
    });

    return () => {
      resizeObserver.disconnect();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [theme, onResize, onTitle]);

  // Connect to WebSocket terminal server
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setConnectionStatus('connecting');
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/terminal/${containerId}${sessionId ? `/${sessionId}` : ''}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Terminal WebSocket connected');
      setIsConnected(true);
      setConnectionStatus('connected');
      onConnect?.(true);

      // Send initial resize
      if (fitAddonRef.current && xtermRef.current) {
        const dims = fitAddonRef.current.proposeDimensions();
        ws.send(JSON.stringify({
          type: 'resize',
          cols: dims?.cols || 80,
          rows: dims?.rows || 24
        }));
      }

      // Send initial shell setup if needed
      if (isMultiUser) {
        ws.send(JSON.stringify({
          type: 'init',
          multiUser: true,
          sessionId
        }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        switch (message.type) {
          case 'output':
            xtermRef.current?.write(message.data);
            break;
            
          case 'binary':
            if (message.data && Array.isArray(message.data)) {
              const uint8Array = new Uint8Array(message.data);
              const str = String.fromCharCode.apply(null, Array.from(uint8Array));
              xtermRef.current?.write(str);
            }
            break;
            
          case 'title':
            onTitle?.(message.title);
            break;
            
          case 'resize':
            // Handle remote resize (multi-user scenario)
            if (message.cols && message.rows) {
              xtermRef.current?.resize(message.cols, message.rows);
            }
            break;
            
          case 'cursor':
            // Handle cursor position sync for multi-user
            if (isMultiUser && message.position) {
              // Visual cursor indicator for other users
              console.log('Remote cursor at:', message.position, 'from user:', message.userId);
            }
            break;
            
          case 'error':
            console.error('Terminal error:', message.error);
            xtermRef.current?.write(`\r\n\x1b[31mTerminal Error: ${message.error}\x1b[0m\r\n`);
            break;
            
          default:
            console.log('Unknown terminal message:', message);
        }
      } catch (error) {
        console.error('Error parsing terminal message:', error);
        // Treat as raw output
        xtermRef.current?.write(event.data);
      }
    };

    ws.onclose = (event) => {
      console.log('Terminal WebSocket closed:', event.code, event.reason);
      setIsConnected(false);
      setConnectionStatus('disconnected');
      onConnect?.(false);

      // Show disconnection message
      if (xtermRef.current) {
        xtermRef.current.write('\r\n\x1b[33mConnection closed. Attempting to reconnect...\x1b[0m\r\n');
      }

      // Attempt to reconnect after delay
      setTimeout(() => {
        if (terminalRef.current) {
          connectWebSocket();
        }
      }, 3000);
    };

    ws.onerror = (error) => {
      console.error('Terminal WebSocket error:', error);
      setConnectionStatus('error');
      
      if (xtermRef.current) {
        xtermRef.current.write('\r\n\x1b[31mConnection error. Check your network connection.\x1b[0m\r\n');
      }
    };
  }, [containerId, sessionId, isMultiUser, onConnect, onTitle]);

  // Initialize terminal and connect
  useEffect(() => {
    const cleanup = initializeTerminal();
    connectWebSocket();

    return () => {
      cleanup?.();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [initializeTerminal, connectWebSocket]);

  // Update theme
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = theme;
    }
  }, [theme]);

  // Connection status indicator
  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return '#22c55e';
      case 'connecting': return '#f59e0b';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'error': return 'Connection Error';
      default: return 'Disconnected';
    }
  };

  return (
    <div className={`terminal-container ${className}`}>
      {/* Connection Status */}
      <div className="flex items-center justify-between px-2 py-1 bg-gray-800 text-xs">
        <div className="flex items-center gap-2">
          <div 
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: getStatusColor() }}
          />
          <span className="text-gray-300">{getStatusText()}</span>
          {isMultiUser && sessionId && (
            <span className="text-blue-400">• Multi-User Session: {sessionId}</span>
          )}
        </div>
        <div className="text-gray-500">
          Container: {containerId.substring(0, 8)}...
        </div>
      </div>

      {/* Terminal */}
      <div 
        ref={terminalRef}
        className="terminal-xterm flex-1"
        style={{ 
          height: '100%', 
          width: '100%',
          backgroundColor: theme.background || DEFAULT_THEME.background
        }}
      />

      {/* Loading overlay */}
      {connectionStatus === 'connecting' && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="flex items-center gap-2 text-white">
            <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            Connecting to terminal...
          </div>
        </div>
      )}
    </div>
  );
};

export default Terminal;

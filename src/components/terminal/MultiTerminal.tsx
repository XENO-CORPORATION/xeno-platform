/**
 * XenoOS Multi-Terminal Component
 * Manages multiple terminal tabs with session persistence
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Terminal } from './Terminal';
import { Plus, X, Settings, Download, Upload, Terminal as TerminalIcon } from 'lucide-react';

interface TerminalTab {
  id: string;
  title: string;
  containerId: string;
  sessionId?: string;
  isActive: boolean;
  isMultiUser: boolean;
  theme?: TerminalTheme;
  createdAt: Date;
  lastActiveAt: Date;
}

interface TerminalTheme {
  name: string;
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

const TERMINAL_THEMES: TerminalTheme[] = [
  {
    name: 'Dark',
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5'
  },
  {
    name: 'Light',
    background: '#ffffff',
    foreground: '#333333',
    cursor: '#333333',
    black: '#000000',
    red: '#cd3131',
    green: '#00bc00',
    yellow: '#949800',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#555555'
  },
  {
    name: 'Matrix',
    background: '#000000',
    foreground: '#00ff00',
    cursor: '#00ff00',
    black: '#000000',
    red: '#ff0000',
    green: '#00ff00',
    yellow: '#ffff00',
    blue: '#0000ff',
    magenta: '#ff00ff',
    cyan: '#00ffff',
    white: '#ffffff'
  },
  {
    name: 'Dracula',
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2'
  },
  {
    name: 'Monokai',
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2'
  }
];

interface MultiTerminalProps {
  containerId: string;
  className?: string;
  defaultTheme?: string;
  maxTabs?: number;
  allowMultiUser?: boolean;
}

export const MultiTerminal: React.FC<MultiTerminalProps> = ({
  containerId,
  className = '',
  defaultTheme = 'Dark',
  maxTabs = 10,
  allowMultiUser = false
}) => {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState(defaultTheme);
  const tabContainerRef = useRef<HTMLDivElement>(null);

  // Get current theme object
  const getCurrentTheme = useCallback((themeName: string = selectedTheme) => {
    return TERMINAL_THEMES.find(t => t.name === themeName) || TERMINAL_THEMES[0];
  }, [selectedTheme]);

  // Create new terminal tab
  const createTab = useCallback((isMultiUser: boolean = false) => {
    if (tabs.length >= maxTabs) {
      console.warn(`Maximum number of tabs (${maxTabs}) reached`);
      return;
    }

    const newTab: TerminalTab = {
      id: `terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: `Terminal ${tabs.length + 1}`,
      containerId,
      sessionId: isMultiUser ? `session-${Date.now()}` : undefined,
      isActive: false,
      isMultiUser,
      theme: getCurrentTheme(),
      createdAt: new Date(),
      lastActiveAt: new Date()
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs.length, maxTabs, containerId, getCurrentTheme]);

  // Close terminal tab
  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const filteredTabs = prev.filter(tab => tab.id !== tabId);
      
      // If we're closing the active tab, activate another tab
      if (tabId === activeTabId) {
        if (filteredTabs.length > 0) {
          const lastActiveTab = filteredTabs.reduce((latest, current) => 
            current.lastActiveAt > latest.lastActiveAt ? current : latest
          );
          setActiveTabId(lastActiveTab.id);
        } else {
          setActiveTabId(null);
        }
      }
      
      return filteredTabs;
    });
  }, [activeTabId]);

  // Switch to tab
  const switchToTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    setTabs(prev => prev.map(tab => ({
      ...tab,
      lastActiveAt: tab.id === tabId ? new Date() : tab.lastActiveAt
    })));
  }, []);

  // Update tab title
  const updateTabTitle = useCallback((tabId: string, title: string) => {
    setTabs(prev => prev.map(tab => 
      tab.id === tabId ? { ...tab, title } : tab
    ));
  }, []);

  // Apply theme to all tabs
  const applyThemeToAllTabs = useCallback((themeName: string) => {
    const theme = getCurrentTheme(themeName);
    setSelectedTheme(themeName);
    setTabs(prev => prev.map(tab => ({ ...tab, theme })));
  }, [getCurrentTheme]);

  // Export terminal configuration
  const exportConfig = useCallback(() => {
    const config = {
      tabs: tabs.map(tab => ({
        title: tab.title,
        isMultiUser: tab.isMultiUser,
        sessionId: tab.sessionId,
        theme: tab.theme?.name,
        createdAt: tab.createdAt.toISOString()
      })),
      selectedTheme,
      containerId
    };

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xenoos-terminal-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [tabs, selectedTheme, containerId]);

  // Import terminal configuration
  const importConfig = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const config = JSON.parse(e.target?.result as string);
          
          if (config.containerId !== containerId) {
            console.warn('Configuration is for a different container');
            return;
          }

          // Clear existing tabs
          setTabs([]);
          setActiveTabId(null);

          // Apply theme
          if (config.selectedTheme) {
            setSelectedTheme(config.selectedTheme);
          }

          // Recreate tabs
          if (config.tabs && Array.isArray(config.tabs)) {
            const newTabs = config.tabs.map((tabConfig: any, index: number) => ({
              id: `terminal-${Date.now()}-${index}`,
              title: tabConfig.title || `Terminal ${index + 1}`,
              containerId,
              sessionId: tabConfig.isMultiUser ? `session-${Date.now()}-${index}` : undefined,
              isActive: false,
              isMultiUser: tabConfig.isMultiUser || false,
              theme: getCurrentTheme(tabConfig.theme),
              createdAt: new Date(tabConfig.createdAt || Date.now()),
              lastActiveAt: new Date()
            }));

            setTabs(newTabs);
            if (newTabs.length > 0) {
              setActiveTabId(newTabs[0].id);
            }
          }
        } catch (error) {
          console.error('Error importing terminal configuration:', error);
          alert('Invalid configuration file');
        }
      };
      reader.readAsText(file);
    };

    input.click();
  }, [containerId, getCurrentTheme]);

  // Initialize with first tab
  useEffect(() => {
    if (tabs.length === 0) {
      createTab(false);
    }
  }, [tabs.length, createTab]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      // Ctrl+Shift+T: New tab
      if (event.ctrlKey && event.shiftKey && event.key === 'T') {
        event.preventDefault();
        createTab(false);
      }

      // Ctrl+Shift+W: Close current tab
      if (event.ctrlKey && event.shiftKey && event.key === 'W' && activeTabId) {
        event.preventDefault();
        closeTab(activeTabId);
      }

      // Ctrl+Tab / Ctrl+Shift+Tab: Switch tabs
      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault();
        const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
        if (currentIndex !== -1) {
          const nextIndex = event.shiftKey 
            ? (currentIndex - 1 + tabs.length) % tabs.length
            : (currentIndex + 1) % tabs.length;
          switchToTab(tabs[nextIndex].id);
        }
      }

      // Ctrl+1-9: Switch to specific tab
      if (event.ctrlKey && event.key >= '1' && event.key <= '9') {
        event.preventDefault();
        const tabIndex = parseInt(event.key) - 1;
        if (tabs[tabIndex]) {
          switchToTab(tabs[tabIndex].id);
        }
      }
    };

    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [tabs, activeTabId, createTab, closeTab, switchToTab]);

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  return (
    <div className={`multi-terminal h-full flex flex-col bg-gray-900 ${className}`}>
      {/* Tab Bar */}
      <div className="flex items-center bg-gray-800 border-b border-gray-700">
        {/* Tab List */}
        <div 
          ref={tabContainerRef}
          className="flex-1 flex items-center overflow-x-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800"
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`
                flex items-center gap-2 px-3 py-2 min-w-0 max-w-48 border-r border-gray-700 cursor-pointer
                transition-colors duration-200 group
                ${tab.id === activeTabId 
                  ? 'bg-gray-700 text-white' 
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }
              `}
              onClick={() => switchToTab(tab.id)}
            >
              <TerminalIcon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate text-sm font-medium">
                {tab.title}
              </span>
              {tab.isMultiUser && (
                <div className="w-2 h-2 bg-blue-400 rounded-full flex-shrink-0" title="Multi-user session" />
              )}
              <button
                className="w-4 h-4 flex-shrink-0 opacity-0 group-hover:opacity-100 hover:bg-gray-600 rounded transition-all duration-200"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                title="Close tab"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 px-2 border-l border-gray-700">
          <button
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors duration-200"
            onClick={() => createTab(false)}
            title="New Terminal (Ctrl+Shift+T)"
            disabled={tabs.length >= maxTabs}
          >
            <Plus className="w-4 h-4" />
          </button>

          {allowMultiUser && (
            <button
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors duration-200"
              onClick={() => createTab(true)}
              title="New Multi-User Terminal"
              disabled={tabs.length >= maxTabs}
            >
              <TerminalIcon className="w-4 h-4" />
            </button>
          )}

          <div className="relative">
            <button
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors duration-200"
              onClick={() => setShowThemeSelector(!showThemeSelector)}
              title="Terminal Settings"
            >
              <Settings className="w-4 h-4" />
            </button>

            {showThemeSelector && (
              <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg z-50">
                <div className="p-2 border-b border-gray-700">
                  <h3 className="text-sm font-medium text-white mb-2">Theme</h3>
                  {TERMINAL_THEMES.map((theme) => (
                    <button
                      key={theme.name}
                      className={`
                        w-full text-left px-2 py-1 text-sm rounded transition-colors duration-200
                        ${selectedTheme === theme.name 
                          ? 'bg-blue-600 text-white' 
                          : 'text-gray-300 hover:bg-gray-700'
                        }
                      `}
                      onClick={() => {
                        applyThemeToAllTabs(theme.name);
                        setShowThemeSelector(false);
                      }}
                    >
                      {theme.name}
                    </button>
                  ))}
                </div>
                <div className="p-2">
                  <button
                    className="flex items-center gap-2 w-full text-left px-2 py-1 text-sm text-gray-300 hover:bg-gray-700 rounded transition-colors duration-200"
                    onClick={() => {
                      exportConfig();
                      setShowThemeSelector(false);
                    }}
                  >
                    <Download className="w-3 h-3" />
                    Export Config
                  </button>
                  <button
                    className="flex items-center gap-2 w-full text-left px-2 py-1 text-sm text-gray-300 hover:bg-gray-700 rounded transition-colors duration-200"
                    onClick={() => {
                      importConfig();
                      setShowThemeSelector(false);
                    }}
                  >
                    <Upload className="w-3 h-3" />
                    Import Config
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Terminal Content */}
      <div className="flex-1 relative">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 ${tab.id === activeTabId ? 'block' : 'hidden'}`}
          >
            <Terminal
              containerId={tab.containerId}
              sessionId={tab.sessionId}
              isMultiUser={tab.isMultiUser}
              theme={tab.theme}
              onTitle={(title) => updateTabTitle(tab.id, title)}
              className="h-full"
            />
          </div>
        ))}

        {tabs.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <TerminalIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No terminal sessions</p>
              <button
                className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors duration-200"
                onClick={() => createTab(false)}
              >
                Create Terminal
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Click outside handler for theme selector */}
      {showThemeSelector && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowThemeSelector(false)}
        />
      )}
    </div>
  );
};

export default MultiTerminal;
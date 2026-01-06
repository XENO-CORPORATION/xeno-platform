import React from 'react'; // Keep React import for JSX
import { PreviewNodeInterface, PreviewSettings, PreviewResponse } from './PreviewNodeInterface';

export abstract class BasePreviewNode implements PreviewNodeInterface {
  // Abstract properties to be implemented by specific nodes
  abstract name: string;
  abstract description: string;
  abstract previewType: string;
  abstract defaultSettings: PreviewSettings;

  // Capability flags with default values
  supportsZoom: boolean = false;
  supportsPanning: boolean = false;
  supportsAnnotation: boolean = false;
  supportsExport: boolean = false;

  // Abstract core method
  abstract generatePreview(
    contentUrl: string,
    settings: PreviewSettings
  ): Promise<PreviewResponse>;

  // Default implementations of optional methods
  zoomIn(): void {
    console.warn('Zoom in not implemented for this preview type');
  }

  zoomOut(): void {
    console.warn('Zoom out not implemented for this preview type');
  }

  resetView(): void {
    console.warn('Reset view not implemented for this preview type');
  }

  async exportContent(format: string): Promise<string> {
    console.warn('Export not implemented for this preview type');
    return '';
  }

  async annotate(annotation: any): Promise<void> {
    console.warn('Annotation not implemented for this preview type');
  }

  // Default rendering methods
  renderPreview(
    contentUrl: string | null,
    settings: PreviewSettings,
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    if (!contentUrl) {
      return (
        <div className="flex items-center justify-center h-64 bg-black/20 rounded-lg">
          <p className="text-white/50 text-sm">No content to preview</p>
        </div>
      );
    }

    // Default preview rendering - should be overridden by specific implementations
    return (
      <div className="flex flex-col space-y-4">
        <div className="rounded-lg overflow-hidden bg-black/30 aspect-video">
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-white/70">Preview not available for this content type</p>
          </div>
        </div>
        
        {settings.showControls && this.renderControls(settings, handleSettingChange)}
        {settings.showMetadata && this.renderMetadata({ contentUrl })}
      </div>
    );
  }

  renderSettings(
    settings: PreviewSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <div className="space-y-4">
        {/* Auto Refresh Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Auto Refresh</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="autoRefresh"
                checked={settings.autoRefresh}
                onChange={(e) => handleSettingChange('autoRefresh', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.autoRefresh ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Automatically refresh the preview</p>
        </div>

        {/* Refresh Interval - only shown if auto refresh is enabled */}
        {settings.autoRefresh && (
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-white/70">Refresh Interval</label>
              <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                {settings.refreshInterval || 5}s
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="60"
              value={settings.refreshInterval || 5}
              onChange={(e) => handleSettingChange('refreshInterval', parseInt(e.target.value))}
              className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
            />
            <p className="mt-2 text-xs text-white/50">How often to refresh the preview (seconds)</p>
          </div>
        )}

        {/* Display Mode */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Display Mode</label>
          <select
            value={settings.displayMode}
            onChange={(e) => handleSettingChange('displayMode', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="fit">Fit</option>
            <option value="fill">Fill</option>
            <option value="actual">Actual Size</option>
          </select>
          <p className="mt-2 text-xs text-white/50">How to display the content in the preview area</p>
        </div>

        {/* Show Metadata Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Show Metadata</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="showMetadata"
                checked={settings.showMetadata}
                onChange={(e) => handleSettingChange('showMetadata', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.showMetadata ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Display metadata about the content</p>
        </div>

        {/* Show Controls Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Show Controls</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="showControls"
                checked={settings.showControls}
                onChange={(e) => handleSettingChange('showControls', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.showControls ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Display playback controls if applicable</p>
        </div>

        {/* Theme Selection */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Theme</label>
          <div className="grid grid-cols-2 gap-2">
            {['dark', 'light'].map((theme) => (
              <button
                key={theme}
                onClick={() => handleSettingChange('theme', theme)}
                className={`p-2 text-xs rounded-lg border transition-colors ${
                  settings.theme === theme
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {theme.charAt(0).toUpperCase() + theme.slice(1)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Preview appearance theme</p>
        </div>

        {/* Node-specific settings */}
        {this.renderPreviewSpecificSettings(settings, handleSettingChange)}
      </div>
    );
  }

  // Helper method to render preview-specific settings - should be overridden by implementations
  renderPreviewSpecificSettings(
    settings: PreviewSettings,
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return <></>;
  }

  // Helper method to render controls
  protected renderControls(
    settings: PreviewSettings,
    handleSettingChange: (key: string, value: any) => void,
    // Add optional handlers for zoom operations
    zoomHandlers?: {
      zoomIn?: () => void;
      zoomOut?: () => void;
      resetView?: () => void;
    }
  ): JSX.Element {
    return (
      <div className="flex items-center justify-center space-x-3 p-2 bg-black/30 rounded-lg">
        {this.supportsZoom && (
          <>
            <button
              onClick={() => zoomHandlers?.zoomOut ? zoomHandlers.zoomOut() : this.zoomOut()}
              className="p-2 rounded-full hover:bg-white/10 text-white/70 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                <line x1="8" y1="11" x2="14" y2="11"></line>
              </svg>
            </button>
            <button
              onClick={() => zoomHandlers?.zoomIn ? zoomHandlers.zoomIn() : this.zoomIn()}
              className="p-2 rounded-full hover:bg-white/10 text-white/70 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                <line x1="11" y1="8" x2="11" y2="14"></line>
                <line x1="8" y1="11" x2="14" y2="11"></line>
              </svg>
            </button>
            <button
              onClick={() => zoomHandlers?.resetView ? zoomHandlers.resetView() : this.resetView()}
              className="p-2 rounded-full hover:bg-white/10 text-white/70 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </button>
          </>
        )}
        {this.supportsExport && (
          <button
            onClick={() => this.exportContent('png')}
            className="p-2 rounded-full hover:bg-white/10 text-white/70 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
        )}
      </div>
    );
  }

  // Helper method to render metadata
  protected renderMetadata(data: any): JSX.Element {
    return (
      <div className="p-3 bg-black/20 rounded-lg text-xs text-white/60">
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="flex justify-between">
              <span className="font-medium">{key}:</span>
              <span>{String(value)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
} 
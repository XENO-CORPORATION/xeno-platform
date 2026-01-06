import React, { useState, useRef, CSSProperties } from 'react';
import { BasePreviewNode } from '../BasePreviewNode';
import { PreviewSettings, PreviewResponse } from '../PreviewNodeInterface';

export class ImagePreviewNode extends BasePreviewNode {
  name = 'Image Preview';
  description = 'Preview images with zoom and annotation capabilities';
  previewType = 'image';
  
  // Capability flags
  supportsZoom = true;
  supportsPanning = true;
  supportsAnnotation = true;
  supportsExport = true;
  
  defaultSettings: PreviewSettings = {
    autoRefresh: false,
    refreshInterval: 5,
    displayMode: 'fit',
    showMetadata: true,
    showControls: true,
    theme: 'dark',
    imageQuality: 'high',
    applyFilters: false,
    filterBrightness: 100,
    filterContrast: 100,
    filterSaturation: 100,
    filterBlur: 0,
    showGrid: false,
    gridSize: 50,
  };
  
  private zoomLevel = 1;
  
  async generatePreview(
    contentUrl: string,
    settings: PreviewSettings
  ): Promise<PreviewResponse> {
    try {
      // In a real implementation, this might process the image, apply filters, etc.
      // For this example, we'll just return the original URL
      return {
        success: true,
        previewUrl: contentUrl,
        metadata: {
          width: 1920, // These would be actual values in a real implementation
          height: 1080,
          format: 'jpg',
          fileSize: 2048000,
          filterApplied: settings.applyFilters
        }
      };
    } catch (error) {
      console.error('Failed to generate image preview:', error);
      return {
        success: false,
        error: 'Failed to generate image preview'
      };
    }
  }

  zoomIn(): void {
    this.zoomLevel = Math.min(5, this.zoomLevel + 0.5);
    console.log('Zoom level:', this.zoomLevel);
  }

  zoomOut(): void {
    this.zoomLevel = Math.max(0.5, this.zoomLevel - 0.5);
    console.log('Zoom level:', this.zoomLevel);
  }

  resetView(): void {
    this.zoomLevel = 1;
    console.log('View reset');
  }

  async exportContent(format: string): Promise<string> {
    // In a real implementation, this would convert/export the image
    console.log(`Exporting image as ${format}`);
    return 'exported-image-url.png';
  }

  async annotate(annotation: any): Promise<void> {
    console.log('Annotation added:', annotation);
  }

  renderPreview(
    contentUrl: string | null,
    settings: PreviewSettings,
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    if (!contentUrl) {
      return (
        <div className="flex items-center justify-center h-64 bg-black/20 rounded-lg">
          <p className="text-white/50 text-sm">No image to preview</p>
        </div>
      );
    }
    
    const currentZoom = this.zoomLevel;
    
    const handleZoomIn = () => {
      this.zoomIn();
      handleSettingChange('_forceUpdate', Date.now());
    };
    
    const handleZoomOut = () => {
      this.zoomOut();
      handleSettingChange('_forceUpdate', Date.now());
    };
    
    const handleResetZoom = () => {
      this.resetView();
      handleSettingChange('_forceUpdate', Date.now());
    };

    // Calculate filter styles if filters are enabled
    const filterStyle: CSSProperties = settings.applyFilters
      ? {
          filter: `
            brightness(${settings.filterBrightness}%) 
            contrast(${settings.filterContrast}%) 
            saturate(${settings.filterSaturation}%) 
            blur(${settings.filterBlur}px)
          `
        }
      : {};

    // Calculate image style based on display mode
    let imgStyle: CSSProperties;
    switch (settings.displayMode) {
      case 'fill':
        imgStyle = { objectFit: 'cover' as const, width: '100%', height: '100%' };
        break;
      case 'actual':
        imgStyle = { objectFit: 'none' as const, transform: `scale(${currentZoom})` };
        break;
      case 'fit':
      default:
        imgStyle = { objectFit: 'contain' as const, width: '100%', height: '100%', transform: `scale(${currentZoom})` };
        break;
    }

    return (
      <div className="flex flex-col space-y-4">
        <div 
          className={`relative rounded-lg overflow-hidden bg-black/30 ${
            settings.theme === 'light' ? 'bg-gray-100' : 'bg-black/30'
          }`}
          style={{ height: '300px' }}
        >
          {/* Image Display */}
          <img
            src={contentUrl}
            alt="Preview"
            className="w-full h-full transition-all"
            style={{ ...imgStyle, ...filterStyle }}
          />
          
          {/* Grid Overlay */}
          {settings.showGrid && (
            <div 
              className="absolute inset-0 pointer-events-none"
              style={{ 
                backgroundImage: `repeating-linear-gradient(to right, rgba(255,255,255,0.1), rgba(255,255,255,0.1) 1px, transparent 1px, transparent ${settings.gridSize}px),
                                  repeating-linear-gradient(to bottom, rgba(255,255,255,0.1), rgba(255,255,255,0.1) 1px, transparent 1px, transparent ${settings.gridSize}px)`,
                backgroundSize: `${settings.gridSize}px ${settings.gridSize}px`
              }}
            />
          )}
        </div>
        
        {settings.showControls && this.renderControls(settings, handleSettingChange, {
          zoomIn: handleZoomIn,
          zoomOut: handleZoomOut,
          resetView: handleResetZoom
        })}
        {settings.showMetadata && this.renderMetadata({
          'Dimensions': '1920 × 1080',
          'Format': 'JPEG',
          'Size': '2.0 MB',
          'Zoom': `${Math.round(currentZoom * 100)}%`
        })}
      </div>
    );
  }

  renderPreviewSpecificSettings(
    settings: PreviewSettings,
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* Image Quality */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Image Quality</label>
          <select
            value={settings.imageQuality || 'high'}
            onChange={(e) => handleSettingChange('imageQuality', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="original">Original</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Quality level of the displayed image</p>
        </div>

        {/* Apply Filters Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Apply Filters</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="applyFilters"
                checked={settings.applyFilters === true}
                onChange={(e) => handleSettingChange('applyFilters', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.applyFilters === true ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Enable image adjustments</p>
        </div>

        {/* Filter Controls - only shown if filters are enabled */}
        {settings.applyFilters && (
          <>
            {/* Brightness */}
            <div className="bg-black/20 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium text-white/70">Brightness</label>
                <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                  {settings.filterBrightness || 100}%
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="150"
                value={settings.filterBrightness || 100}
                onChange={(e) => handleSettingChange('filterBrightness', parseInt(e.target.value))}
                className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
              />
            </div>

            {/* Contrast */}
            <div className="bg-black/20 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium text-white/70">Contrast</label>
                <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                  {settings.filterContrast || 100}%
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="150"
                value={settings.filterContrast || 100}
                onChange={(e) => handleSettingChange('filterContrast', parseInt(e.target.value))}
                className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
              />
            </div>

            {/* Saturation */}
            <div className="bg-black/20 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium text-white/70">Saturation</label>
                <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                  {settings.filterSaturation || 100}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="200"
                value={settings.filterSaturation || 100}
                onChange={(e) => handleSettingChange('filterSaturation', parseInt(e.target.value))}
                className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
              />
            </div>

            {/* Blur */}
            <div className="bg-black/20 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium text-white/70">Blur</label>
                <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                  {settings.filterBlur || 0}px
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                value={settings.filterBlur || 0}
                onChange={(e) => handleSettingChange('filterBlur', parseInt(e.target.value))}
                className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
              />
            </div>
          </>
        )}

        {/* Show Grid Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Show Grid</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="showGrid"
                checked={settings.showGrid === true}
                onChange={(e) => handleSettingChange('showGrid', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.showGrid === true ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Display measurement grid overlay</p>
        </div>

        {/* Grid Size - only shown if grid is enabled */}
        {settings.showGrid && (
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-white/70">Grid Size</label>
              <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                {settings.gridSize || 50}px
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              step="10"
              value={settings.gridSize || 50}
              onChange={(e) => handleSettingChange('gridSize', parseInt(e.target.value))}
              className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
            />
          </div>
        )}
      </>
    );
  }
} 
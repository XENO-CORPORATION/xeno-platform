import { BaseNodeProps } from '../BaseNode';

export interface PreviewSettings {
  autoRefresh: boolean;
  refreshInterval?: number;
  displayMode: 'fit' | 'fill' | 'actual';
  showMetadata: boolean;
  showControls: boolean;
  theme: 'dark' | 'light';
  [key: string]: any; // Allow for preview-type specific settings
}

export interface PreviewResponse {
  success: boolean;
  previewUrl?: string;
  error?: string;
  metadata?: {
    width?: number;
    height?: number;
    format?: string;
    duration?: number;
    fileSize?: number;
    [key: string]: any;
  };
}

export interface PreviewNodeInterface {
  // Preview information
  name: string;
  description: string;
  previewType: string; // e.g., 'image', 'video', 'audio', 'text', etc.
  defaultSettings: PreviewSettings;
  
  // Core functionality
  generatePreview(
    contentUrl: string, 
    settings: PreviewSettings
  ): Promise<PreviewResponse>;
  
  // UI rendering
  renderPreview(
    contentUrl: string | null,
    settings: PreviewSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element;
  
  renderSettings(
    settings: PreviewSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element;
  
  // Optional capabilities
  supportsZoom?: boolean;
  supportsPanning?: boolean;
  supportsAnnotation?: boolean;
  supportsExport?: boolean;
  
  // Optional methods for specific capabilities
  zoomIn?(): void;
  zoomOut?(): void;
  resetView?(): void;
  exportContent?(format: string): Promise<string>;
  annotate?(annotation: any): Promise<void>;
}

export interface PreviewNodeProps extends BaseNodeProps {
  previewInterface: PreviewNodeInterface;
} 
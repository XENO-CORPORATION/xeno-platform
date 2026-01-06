import React, { useState, CSSProperties } from 'react';
import { BasePreviewNode } from '../BasePreviewNode';
import { PreviewSettings, PreviewResponse } from '../PreviewNodeInterface';

export class TextPreviewNode extends BasePreviewNode {
  name = 'Text Preview';
  description = 'Preview text content with syntax highlighting and formatting options';
  previewType = 'text';
  
  // Capability flags
  supportsZoom = false;
  supportsPanning = false;
  supportsAnnotation = false;
  supportsExport = true;
  
  defaultSettings: PreviewSettings = {
    autoRefresh: false,
    refreshInterval: 5,
    displayMode: 'fit',
    showMetadata: true,
    showControls: true,
    theme: 'dark',
    fontSize: 14,
    fontFamily: 'monospace',
    wordWrap: true,
    showLineNumbers: true,
    syntaxHighlighting: true,
    language: 'auto',
    tabSize: 2,
    maxLines: 500
  };
  
  async generatePreview(
    contentUrl: string,
    settings: PreviewSettings
  ): Promise<PreviewResponse> {
    try {
      // In a real implementation, this might fetch the text content and parse it
      // For this example, we'll return a mock response
      return {
        success: true,
        previewUrl: contentUrl,
        metadata: {
          fileSize: 24500,
          format: 'txt',
          lineCount: 352,
          wordCount: 1508,
          characterCount: 8734,
          encoding: 'UTF-8'
        }
      };
    } catch (error) {
      console.error('Failed to generate text preview:', error);
      return {
        success: false,
        error: 'Failed to generate text preview'
      };
    }
  }

  async exportContent(format: string): Promise<string> {
    // In a real implementation, this would convert/export the text
    console.log(`Exporting text as ${format}`);
    return 'exported-text-url.txt';
  }

  renderPreview(
    contentUrl: string | null,
    settings: PreviewSettings,
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    const [content, setContent] = useState<string | null>(null);
    
    if (!contentUrl) {
      return (
        <div className="flex items-center justify-center h-64 bg-black/20 rounded-lg">
          <p className="text-white/50 text-sm">No text content to preview</p>
        </div>
      );
    }

    // In a real implementation, we would fetch the text content from the URL
    // For this example, we'll use placeholder text
    if (content === null) {
      // Simulate fetching text content
      setTimeout(() => {
        setContent(`
// Example TypeScript code for preview
import React, { useState, useEffect } from 'react';

interface Props {
  title: string;
  onSubmit: (data: FormData) => void;
}

const ExampleComponent: React.FC<Props> = ({ title, onSubmit }) => {
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    message: ''
  });

  useEffect(() => {
    console.log('Component mounted');
    return () => console.log('Component unmounted');
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="form-container">
      <h2>{title}</h2>
      <form onSubmit={handleSubmit}>
        {/* Form fields would go here */}
        <button type="submit">Submit</button>
      </form>
    </div>
  );
};

export default ExampleComponent;
        `);
      }, 500);
    }

    // Calculate text style
    const textStyle: CSSProperties = {
      fontFamily: settings.fontFamily || 'monospace',
      fontSize: `${settings.fontSize || 14}px`,
      whiteSpace: settings.wordWrap ? 'pre-wrap' : 'pre',
      overflowX: settings.wordWrap ? 'hidden' : 'auto',
      color: settings.theme === 'light' ? '#333' : '#e0e0e0',
      padding: '1rem',
      maxHeight: '300px',
      overflowY: 'auto'
    };

    return (
      <div className="flex flex-col space-y-4">
        <div
          className={`relative rounded-lg overflow-hidden ${
            settings.theme === 'light' ? 'bg-gray-100' : 'bg-black/30'
          }`}
          style={{ minHeight: '300px' }}
        >
          {content === null ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white/30"></div>
            </div>
          ) : (
            <div className="relative">
              {/* Text Content */}
              <pre style={textStyle}>
                {settings.showLineNumbers ? (
                  <div className="flex">
                    {/* Line Numbers */}
                    <div className="select-none pr-4 text-white/40 text-right" style={{ minWidth: '3rem' }}>
                      {content.split('\n').map((_, i) => (
                        <div key={i}>{i + 1}</div>
                      ))}
                    </div>
                    {/* Code Content */}
                    <div className="flex-1">
                      {content}
                    </div>
                  </div>
                ) : (
                  content
                )}
              </pre>
            </div>
          )}
        </div>

        {settings.showControls && this.renderControls(settings, handleSettingChange)}
        {settings.showMetadata && this.renderMetadata({
          'File Type': 'TypeScript',
          'Lines': '25',
          'Words': '~120',
          'Characters': '~850',
          'Size': '1.2 KB'
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
        {/* Font Size */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Font Size</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.fontSize || 14}px
            </span>
          </div>
          <input
            type="range"
            min="10"
            max="20"
            step="1"
            value={settings.fontSize || 14}
            onChange={(e) => handleSettingChange('fontSize', parseInt(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Text size in pixels</p>
        </div>

        {/* Font Family */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Font Family</label>
          <select
            value={settings.fontFamily || 'monospace'}
            onChange={(e) => handleSettingChange('fontFamily', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="monospace">Monospace</option>
            <option value="sans-serif">Sans Serif</option>
            <option value="serif">Serif</option>
            <option value="Consolas, monospace">Consolas</option>
            <option value="'Source Code Pro', monospace">Source Code Pro</option>
          </select>
          <p className="mt-2 text-xs text-white/50">Text font family</p>
        </div>

        {/* Word Wrap Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Word Wrap</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="wordWrap"
                checked={settings.wordWrap !== false}
                onChange={(e) => handleSettingChange('wordWrap', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.wordWrap !== false ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Wrap text to fit container width</p>
        </div>

        {/* Line Numbers Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Show Line Numbers</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="showLineNumbers"
                checked={settings.showLineNumbers !== false}
                onChange={(e) => handleSettingChange('showLineNumbers', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.showLineNumbers !== false ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Display line numbers in gutter</p>
        </div>

        {/* Syntax Highlighting Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-white/70">Syntax Highlighting</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                id="syntaxHighlighting"
                checked={settings.syntaxHighlighting !== false}
                onChange={(e) => handleSettingChange('syntaxHighlighting', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.syntaxHighlighting !== false ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Apply language-specific highlighting</p>
        </div>

        {/* Language Selection - only shown if syntax highlighting is enabled */}
        {settings.syntaxHighlighting && (
          <div className="bg-black/20 rounded-lg p-4">
            <label className="block text-xs font-medium text-white/70 mb-2">Language</label>
            <select
              value={settings.language || 'auto'}
              onChange={(e) => handleSettingChange('language', e.target.value)}
              className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
            >
              <option value="auto">Auto Detect</option>
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="html">HTML</option>
              <option value="css">CSS</option>
              <option value="json">JSON</option>
              <option value="markdown">Markdown</option>
              <option value="plaintext">Plain Text</option>
            </select>
            <p className="mt-2 text-xs text-white/50">Programming language for highlighting</p>
          </div>
        )}

        {/* Tab Size */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Tab Size</label>
          <div className="grid grid-cols-4 gap-2">
            {[2, 4, 6, 8].map((size) => (
              <button
                key={size}
                onClick={() => handleSettingChange('tabSize', size)}
                className={`p-2 text-xs rounded-lg border transition-colors ${
                  settings.tabSize === size
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                }`}
              >
                {size} spaces
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">Number of spaces per tab</p>
        </div>

        {/* Max Lines */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Max Lines</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.maxLines || 500}
            </span>
          </div>
          <input
            type="range"
            min="100"
            max="2000"
            step="100"
            value={settings.maxLines || 500}
            onChange={(e) => handleSettingChange('maxLines', parseInt(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Maximum number of lines to display</p>
        </div>
      </>
    );
  }
} 
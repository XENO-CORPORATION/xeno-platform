import React, { useState } from 'react';
import { Zap } from 'lucide-react';
import BaseNode, { BaseNodeProps } from './BaseNode';

const UtilityNode: React.FC<BaseNodeProps> = (props) => {
  const [nodeSettings, setNodeSettings] = useState({
    mode: 'preview',
    outputFormat: 'auto',
    cacheResults: true,
    autoRefresh: false,
    previewContent: null as string | null,
    contentType: 'none' as 'none' | 'image' | 'video' | 'text',
    inspectorData: null as any
  });

  const handleSettingChange = (key: string, value: any) => {
    setNodeSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const renderSettings = () => {
    // Different settings based on utility node subtype (preview, save, bridge)
    const nodeId = props.title?.toLowerCase() || '';
    
    if (nodeId.includes('preview')) {
      return (
        <div className="space-y-4">
          {/* Preview Container with different modes */}
          <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
            <div className="absolute inset-0 bg-black/20 rounded-lg overflow-hidden flex items-center justify-center">
              {nodeSettings.mode === 'inspector' ? (
                <div className="absolute inset-0 p-3 overflow-auto font-mono text-xs">
                  <pre className="text-white/70">
                    {nodeSettings.inspectorData ? 
                      JSON.stringify(nodeSettings.inspectorData, null, 2) :
                      'No data to inspect'
                    }
                  </pre>
                </div>
              ) : nodeSettings.mode === 'compare' ? (
                <div className="absolute inset-0 grid grid-cols-2 gap-1">
                  <div className="bg-black/30 flex items-center justify-center relative">
                    <div className="absolute top-2 left-2 text-xs text-white/50 bg-black/50 px-2 py-0.5 rounded">Input</div>
                    {nodeSettings.contentType === 'image' && nodeSettings.previewContent ? (
                      <img 
                        src={nodeSettings.previewContent}
                        alt="Input preview"
                        className="max-w-full max-h-full object-contain"
                      />
                    ) : nodeSettings.contentType === 'video' && nodeSettings.previewContent ? (
                      <video 
                        src={nodeSettings.previewContent}
                        className="max-w-full max-h-full object-contain"
                        controls={false}
                        autoPlay={false}
                        muted
                        loop
                      />
                    ) : (
                      <div className="text-white/30 text-sm">No input</div>
                    )}
                  </div>
                  <div className="bg-black/30 flex items-center justify-center relative">
                    <div className="absolute top-2 left-2 text-xs text-white/50 bg-black/50 px-2 py-0.5 rounded">Output</div>
                    {nodeSettings.contentType === 'image' && nodeSettings.previewContent ? (
                      <img 
                        src={nodeSettings.previewContent}
                        alt="Output preview"
                        className="max-w-full max-h-full object-contain"
                      />
                    ) : nodeSettings.contentType === 'video' && nodeSettings.previewContent ? (
                      <video 
                        src={nodeSettings.previewContent}
                        className="max-w-full max-h-full object-contain"
                        controls={false}
                        autoPlay={false}
                        muted
                        loop
                      />
                    ) : (
                      <div className="text-white/30 text-sm">No output</div>
                    )}
                  </div>
                </div>
              ) : nodeSettings.contentType === 'image' && nodeSettings.previewContent ? (
                <img 
                  src={nodeSettings.previewContent}
                  alt="Preview"
                  className="max-w-full max-h-full object-contain"
                  onLoad={(e) => {
                    // Update container ratio based on actual image dimensions
                    const img = e.target as HTMLImageElement;
                    const ratio = img.naturalHeight / img.naturalWidth;
                    const container = e.currentTarget.parentElement;
                    if (container) {
                      container.style.paddingTop = `${ratio * 100}%`;
                    }
                  }}
                />
              ) : nodeSettings.contentType === 'video' && nodeSettings.previewContent ? (
                <video 
                  src={nodeSettings.previewContent}
                  className="max-w-full max-h-full object-contain"
                  controls={false}
                  autoPlay={false}
                  muted
                  loop
                  onLoadedMetadata={(e) => {
                    // Update container ratio based on video dimensions
                    const video = e.target as HTMLVideoElement;
                    const ratio = video.videoHeight / video.videoWidth;
                    const container = e.currentTarget.parentElement;
                    if (container) {
                      container.style.paddingTop = `${ratio * 100}%`;
                    }
                  }}
                />
              ) : nodeSettings.contentType === 'text' ? (
                <div className="absolute inset-0 p-3 overflow-auto">
                  <p className="text-white/70 text-sm whitespace-pre-wrap">
                    {nodeSettings.previewContent || 'No text content'}
                  </p>
                </div>
              ) : (
                <div className="text-white/50 text-sm">No content to preview</div>
              )}
            </div>
          </div>
          <div className="bg-black/20 rounded-lg p-4">
            <label className="block text-xs font-medium text-white/70 mb-2">Preview Mode</label>
            <select 
              value={nodeSettings.mode}
              onChange={(e) => handleSettingChange('mode', e.target.value)}
              className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
            >
              <option value="preview">Live Preview</option>
              <option value="inspector">Data Inspector</option>
              <option value="compare">Compare View</option>
            </select>
            <p className="mt-2 text-xs text-white/50">Choose how to preview the input data</p>
          </div>
          
          <div className="bg-black/20 rounded-lg p-4">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={nodeSettings.autoRefresh}
                onChange={(e) => handleSettingChange('autoRefresh', e.target.checked)}
                className="rounded border-white/30 bg-black/30 text-white focus:ring-0 focus:ring-offset-0"
              />
              <span className="text-sm text-white/70">Auto-refresh preview</span>
            </label>
            <p className="mt-2 text-xs text-white/50">Automatically update when input changes</p>
          </div>
        </div>
      );
    } 
    else if (nodeId.includes('save')) {
      return (
        <div className="space-y-4">
          <div className="bg-black/20 rounded-lg p-4">
            <label className="block text-xs font-medium text-white/70 mb-2">Output Format</label>
            <select 
              value={nodeSettings.outputFormat}
              onChange={(e) => handleSettingChange('outputFormat', e.target.value)}
              className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
            >
              <option value="auto">Auto (based on input)</option>
              <option value="png">PNG Image</option>
              <option value="jpg">JPG Image</option>
              <option value="mp4">MP4 Video</option>
              <option value="json">JSON Data</option>
              <option value="txt">Text File</option>
            </select>
            <p className="mt-2 text-xs text-white/50">Select the format for saving outputs</p>
          </div>
          
          <div className="bg-black/20 rounded-lg p-4">
            <label className="block text-xs font-medium text-white/70 mb-3">Save Settings</label>
            <div className="space-y-3">
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={nodeSettings.cacheResults}
                  onChange={(e) => handleSettingChange('cacheResults', e.target.checked)}
                  className="rounded border-white/30 bg-black/30 text-white focus:ring-0 focus:ring-offset-0"
                />
                <span className="text-sm text-white/70">Cache results</span>
              </label>
            </div>
            <p className="mt-2 text-xs text-white/50">Store outputs for faster retrieval</p>
          </div>
        </div>
      );
    }
    else {
      // Bridge or other utility node
      return (
        <div className="space-y-4">
          <div className="bg-black/20 rounded-lg p-4">
            <p className="text-sm text-white/70">
              This utility node converts between different data types and formats. Connect inputs and outputs to use.
            </p>
          </div>
          
          <div className="bg-black/20 rounded-lg p-4 text-center">
            <p className="text-xs text-white/50">No additional configuration required</p>
          </div>
        </div>
      );
    }
  };

  return (
    <BaseNode {...props} icon={props.icon || <Zap size={16} />}>
      {renderSettings()}
    </BaseNode>
  );
};

export default UtilityNode;
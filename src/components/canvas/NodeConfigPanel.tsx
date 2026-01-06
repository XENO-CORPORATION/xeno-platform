import React, { useState } from 'react';
import { Settings, Image as ImageIcon, Video as VideoIcon, BrainCircuit, X, Check } from 'lucide-react';

interface NodeConfigPanelProps {
  node: {
    id: number;
    type: string;
    title: string;
    inputs: Array<{ id: string; type: string; label: string }>;
    outputs: Array<{ id: string; type: string; label: string }>;
  };
  onClose: () => void;
  onUpdateNode: (nodeId: number, updates: any) => void;
}

const NodeConfigPanel: React.FC<NodeConfigPanelProps> = ({ node, onClose, onUpdateNode }) => {
  // State for configuration values
  const [config, setConfig] = useState({
    // LLM settings
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 1000,
    prompt: '',
    
    // Image settings
    imageModel: 'stable-diffusion-3.5',
    imageResolution: '1024x1024',
    imageStyle: 'photorealistic',
    negativePrompt: '',
    guidanceScale: 7.5,
    steps: 30,
    
    // Video settings
    videoModel: 'luma-ray-2',
    videoDuration: 3,
    videoFps: 24,
    motionScale: 50,
    videoResolution: '1024x576'
  });

  // Handle config changes
  const handleConfigChange = (key: string, value: any) => {
    setConfig(prev => ({
      ...prev,
      [key]: value
    }));
    
    onUpdateNode(node.id, {
      [key]: value
    });
  };

  // Render different configuration panels based on node type
  const renderConfigFields = () => {
    switch (node.type) {
      case 'llm':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Model</label>
              <select
                value={config.model}
                onChange={(e) => handleConfigChange('model', e.target.value)}
                className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-white/20"
              >
                <option value="gpt-4o">GPT-4o</option>
                <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                <option value="gemini">Gemini</option>
                <option value="grok-3">Grok 3</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Temperature</label>
              <div className="flex items-center space-x-2">
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={config.temperature}
                  onChange={(e) => handleConfigChange('temperature', parseFloat(e.target.value))}
                  className="flex-grow"
                />
                <span className="text-sm text-white/70 w-12">{config.temperature}</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Max Tokens</label>
              <input
                type="number"
                value={config.maxTokens}
                onChange={(e) => handleConfigChange('maxTokens', parseInt(e.target.value))}
                className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-white/20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">System Prompt</label>
              <textarea
                value={config.prompt}
                onChange={(e) => handleConfigChange('prompt', e.target.value)}
                placeholder="Enter system instructions..."
                className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 h-24 focus:outline-none focus:ring-1 focus:ring-white/20"
              />
            </div>
          </div>
        );

      case 'image':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Model</label>
              <select
                value={config.imageModel}
                onChange={(e) => handleConfigChange('imageModel', e.target.value)}
                className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-white/20"
              >
                <option value="fal-ai/flux/dev">Flux Dev</option>
                <option value="fal-ai/flux-pro/v1.1-ultra">Flux Pro v1.1-Ultra</option>
                <option value="fal-ai/luma-photon/flash">Luma Photon Flash</option>
                <option value="fal-ai/recraft/v3/text-to-image">Recraft V3</option>
                <option value="fal-ai/ideogram/v3">Ideogram V3</option>
                <option value="fal-ai/ideogram/v2a/turbo">Ideogram V2a Turbo</option>
                <option value="stable-diffusion-3.5">Stable Diffusion 3.5</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Resolution</label>
              <select
                value={config.imageResolution}
                onChange={(e) => handleConfigChange('imageResolution', e.target.value)}
                className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-white/20"
              >
                <option value="512x512">512 × 512</option>
                <option value="768x768">768 × 768</option>
                <option value="1024x1024">1024 × 1024</option>
                <option value="1536x1536">1536 × 1536</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Style</label>
              <select
                value={config.imageStyle}
                onChange={(e) => handleConfigChange('imageStyle', e.target.value)}
                className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-white/20"
              >
                <option value="photorealistic">Photorealistic</option>
                <option value="artistic">Artistic</option>
                <option value="anime">Anime</option>
                <option value="digital-art">Digital Art</option>
                <option value="oil-painting">Oil Painting</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Negative Prompt</label>
              <textarea
                value={config.negativePrompt}
                onChange={(e) => handleConfigChange('negativePrompt', e.target.value)}
                placeholder="Enter elements to exclude..."
                className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 h-24 focus:outline-none focus:ring-1 focus:ring-white/20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Guidance Scale</label>
              <div className="flex items-center space-x-2">
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="0.5"
                  value={config.guidanceScale}
                  onChange={(e) => handleConfigChange('guidanceScale', parseFloat(e.target.value))}
                  className="flex-grow"
                />
                <span className="text-sm text-white/70 w-12">{config.guidanceScale}</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Steps</label>
              <div className="flex items-center space-x-2">
                <input
                  type="range"
                  min="20"
                  max="150"
                  step="1"
                  value={config.steps}
                  onChange={(e) => handleConfigChange('steps', parseInt(e.target.value))}
                  className="flex-grow"
                />
                <span className="text-sm text-white/70 w-12">{config.steps}</span>
              </div>
            </div>
          </div>
        );

      case 'video':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Model</label>
              <select
                value={config.videoModel}
                onChange={(e) => handleConfigChange('videoModel', e.target.value)}
                className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-white/20"
              >
                <option value="hailuo-minimax">Hailuo Minimax</option>
                <option value="veo-2">Veo 2</option>
                <option value="kling-standard-1.6">Kling Standard 1.6</option>
                <option value="kling-pro-1.5">Kling Pro 1.5</option>
                <option value="luma-ray-2">Luma Ray 2</option>
                <option value="luma-dream-machine">Luma Dream Machine</option>
                <option value="pika">Pika</option>
                <option value="tencent-hunyuan">Tencent Hunyuan</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Duration (seconds)</label>
              <div className="flex items-center space-x-2">
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={config.videoDuration}
                  onChange={(e) => handleConfigChange('videoDuration', parseInt(e.target.value))}
                  className="flex-grow"
                />
                <span className="text-sm text-white/70 w-12">{config.videoDuration}s</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Frame Rate</label>
              <select
                value={config.videoFps}
                onChange={(e) => handleConfigChange('videoFps', parseInt(e.target.value))}
                className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-white/20"
              >
                <option value="24">24 FPS</option>
                <option value="30">30 FPS</option>
                <option value="60">60 FPS</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Resolution</label>
              <select
                value={config.videoResolution}
                onChange={(e) => handleConfigChange('videoResolution', e.target.value)}
                className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-white/20"
              >
                <option value="512x288">512 × 288 (16:9)</option>
                <option value="768x432">768 × 432 (16:9)</option>
                <option value="1024x576">1024 × 576 (16:9)</option>
                <option value="1280x720">1280 × 720 (720p)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Motion Scale</label>
              <div className="flex items-center space-x-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={config.motionScale}
                  onChange={(e) => handleConfigChange('motionScale', parseInt(e.target.value))}
                  className="flex-grow"
                />
                <span className="text-sm text-white/70 w-12">{config.motionScale}%</span>
              </div>
            </div>
          </div>
        );

      default:
        return (
          <div className="text-center text-white/50 py-4">
            No configuration options available for this node type.
          </div>
        );
    }
  };

  // Get icon based on node type
  const getNodeIcon = () => {
    switch (node.type) {
      case 'llm':
        return <BrainCircuit size={16} />;
      case 'image':
        return <ImageIcon size={16} />;
      case 'video':
        return <VideoIcon size={16} />;
      default:
        return <Settings size={16} />;
    }
  };

  return (
    <div className="absolute right-0 top-0 bottom-0 w-80 bg-[rgba(20,20,20,0.95)] border-l border-white/10 shadow-lg flex flex-col transform-gpu">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded bg-white/10">
            {getNodeIcon()}
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">Configure Node</h3>
            <p className="text-xs text-white/50">{node.title}</p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-1 hover:bg-white/10 rounded-lg transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Configuration form */}
      <div className="flex-grow overflow-y-auto p-4">
        {renderConfigFields()}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/10 flex justify-end space-x-2">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
          Close
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm bg-white text-primary-bg rounded-lg hover:bg-white/90 transition-colors flex items-center space-x-1"
        >
          <Check size={14} />
          <span>Apply Changes</span>
        </button>
      </div>
    </div>
  );
};

export default NodeConfigPanel;
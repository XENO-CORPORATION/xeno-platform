import React, { useState, useEffect } from 'react';
import { Image } from 'lucide-react';
import BaseNode, { 
  BaseNodeProps, 
  useNodeContent
} from './BaseNode';

const ImageNode: React.FC<BaseNodeProps> = (props) => {
  const [nodeSettings, setNodeSettings] = useState({
    model: 'dalle-3',
    aspectRatio: '1:1',
    promptInput: '', // We'll receive this from connections
    negativePrompt: '',
    guidanceScale: 7.5,
    numInferenceSteps: 30,
    seed: -1,
    useRandomSeed: true,
    quality: 'standard',
    style: 'vivid'
  });

  const { isExpanded, showAdvancedSettings } = useNodeContent();

  // Listen for model change events from BaseNode's direct implementation
  useEffect(() => {
    const handleModelChange = (event: CustomEvent) => {
      const { value, nodeId } = event.detail;
      
      // Only process events for this node
      if (nodeId === props.id) {
        setNodeSettings(prev => ({
          ...prev,
          model: value
        }));
      }
    };

    // Add event listener
    window.addEventListener('image-model-change', handleModelChange as EventListener);
    
    // Clean up
    return () => {
      window.removeEventListener('image-model-change', handleModelChange as EventListener);
    };
  }, [props.id]);

  // Listen for aspect ratio change events
  useEffect(() => {
    const handleRatioChange = (event: CustomEvent) => {
      const { value, nodeId } = event.detail;
      
      // Only process events for this node
      if (nodeId === props.id) {
        setNodeSettings(prev => ({
          ...prev,
          aspectRatio: value
        }));
      }
    };

    // Add event listener
    window.addEventListener('image-ratio-change', handleRatioChange as EventListener);
    
    // Clean up
    return () => {
      window.removeEventListener('image-ratio-change', handleRatioChange as EventListener);
    };
  }, [props.id]);

  const handleSettingChange = (key: string, value: any) => {
    setNodeSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Create content for expanded state
  const expandedContent = (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="bg-black/20 rounded-lg p-4">
        <label className="block text-xs font-medium text-white/70 mb-2">Image Model</label>
        <select 
          value={nodeSettings.model}
          onChange={(e) => handleSettingChange('model', e.target.value)}
          className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
        >
          <option value="dalle-3">DALL·E 3</option>
          <option value="sdxl">Stable Diffusion XL</option>
          <option value="midjourney">Midjourney</option>
        </select>
        <p className="mt-2 text-xs text-white/50">Select the image generation model to use</p>
      </div>

      {/* Aspect Ratio Selection */}
      <div className="bg-black/20 rounded-lg p-4">
        <label className="block text-xs font-medium text-white/70 mb-2">Aspect Ratio</label>
        <div className="grid grid-cols-3 gap-2">
          {['1:1', '16:9', '4:3', '3:2', '9:16', 'Custom'].map((ratio) => (
            <button
              key={ratio}
              className={`py-2 px-1 text-sm rounded-md border focus:outline-none transition-colors
                ${nodeSettings.aspectRatio === ratio 
                  ? 'bg-white/10 border-white/30 text-white' 
                  : 'bg-black/30 border-white/10 text-white/70 hover:bg-white/5'}`}
              onClick={() => handleSettingChange('aspectRatio', ratio)}
            >
              {ratio}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-white/50">Choose the aspect ratio for the generated image</p>
      </div>

      {/* Prompt Input Preview (read-only) */}
      <div className="bg-black/20 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-white/70">Input Prompt</label>
          <span className="text-xs bg-blue-500/30 text-blue-200 px-2 py-0.5 rounded-full">From Connection</span>
        </div>
        <div className="w-full bg-black/50 text-white/70 border border-white/10 rounded-lg p-3 text-sm min-h-[60px] italic overflow-y-auto">
          {nodeSettings.promptInput ? 
            nodeSettings.promptInput : 
            <span className="text-white/30">Connect to a text output to receive prompt input...</span>}
        </div>
        <p className="mt-2 text-xs text-white/50">Text prompt from connected nodes (LLM, text input, etc.)</p>
      </div>

      {/* Expanded section with more options */}
      {isExpanded && !showAdvancedSettings && (
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Negative Prompt</label>
          <textarea
            value={nodeSettings.negativePrompt}
            onChange={(e) => handleSettingChange('negativePrompt', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm min-h-[80px] focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20 resize-none"
            placeholder="Elements to exclude from the image..."
          />
          <p className="mt-2 text-xs text-white/50">Describe what you want to avoid in the generated image</p>
        </div>
      )}

      {/* Advanced Settings */}
      {showAdvancedSettings && (
        <div className="space-y-4">
          {/* Guidance Scale */}
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-white/70">Guidance Scale</label>
              <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                {nodeSettings.guidanceScale}
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="20"
              step="0.1"
              value={nodeSettings.guidanceScale}
              onChange={(e) => handleSettingChange('guidanceScale', parseFloat(e.target.value))}
              className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
            />
            <p className="mt-2 text-xs text-white/50">Higher values make image more closely follow the prompt</p>
          </div>

          {/* Inference Steps */}
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-white/70">Inference Steps</label>
              <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                {nodeSettings.numInferenceSteps}
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="150"
              step="1"
              value={nodeSettings.numInferenceSteps}
              onChange={(e) => handleSettingChange('numInferenceSteps', parseInt(e.target.value))}
              className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
            />
            <p className="mt-2 text-xs text-white/50">Higher values may produce more detailed images but take longer</p>
          </div>

          {/* Seed control */}
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-white/70">Seed</label>
              <div className="flex items-center">
                <label className="mr-2 text-xs text-white/50">
                  <input
                    type="checkbox"
                    checked={nodeSettings.useRandomSeed}
                    onChange={(e) => handleSettingChange('useRandomSeed', e.target.checked)}
                    className="mr-1"
                  />
                  Random
                </label>
                <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                  {nodeSettings.useRandomSeed ? 'Random' : nodeSettings.seed}
                </span>
              </div>
            </div>
            <input
              type="range"
              min="-1"
              max="2147483647"
              step="1"
              value={nodeSettings.seed}
              onChange={(e) => handleSettingChange('seed', parseInt(e.target.value))}
              disabled={nodeSettings.useRandomSeed}
              className={`w-full accent-white/50 bg-black/30 rounded-lg h-1.5 ${nodeSettings.useRandomSeed ? 'opacity-30' : ''}`}
            />
            <p className="mt-2 text-xs text-white/50">Use the same seed to reproduce similar images</p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <BaseNode 
      {...props} 
      icon={props.icon || <Image size={16} />}
      nodeState={nodeSettings}
    >
      {expandedContent}
    </BaseNode>
  );
};

export default ImageNode;
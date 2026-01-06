import React, { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import BaseNode, { BaseNodeProps } from './BaseNode';

const UpscaleImageNode: React.FC<BaseNodeProps> = (props) => {
  const [nodeSettings, setNodeSettings] = useState({
    model: 'stability-ai',
    upscaleFactor: 2,
    denoise: 50,
    enhanceDetails: true,
    preserveColors: true
  });

  const handleSettingChange = (key: string, value: any) => {
    setNodeSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const renderSettings = () => (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="bg-black/20 rounded-lg p-4">
        <label className="block text-xs font-medium text-white/70 mb-2">Model Selection</label>
        <select 
          value={nodeSettings.model}
          onChange={(e) => handleSettingChange('model', e.target.value)}
          className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
        >
          <option value="ximilar">Ximilar</option>
          <option value="deepai-image">DeepAI Image</option>
          <option value="upscale-media">Upscale.media</option>
          <option value="stability-ai">Stability AI</option>
          <option value="topaz-labs">Topaz Labs</option>
          <option value="magnific-ai">Magnific AI</option>
        </select>
        <p className="mt-2 text-xs text-white/50">Choose the image upscaling model</p>
      </div>

      {/* Upscale Factor */}
      <div className="bg-black/20 rounded-lg p-4">
        <label className="block text-xs font-medium text-white/70 mb-2">Upscale Factor</label>
        <div className="grid grid-cols-3 gap-2">
          {[2, 4, 6].map((factor) => (
            <button
              key={factor}
              onClick={() => handleSettingChange('upscaleFactor', factor)}
              className={`p-2 text-xs rounded-lg border transition-colors ${
                nodeSettings.upscaleFactor === factor
                  ? 'bg-white/20 border-white/30 text-white'
                  : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
              }`}
            >
              {factor}x
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-white/50">Select the upscaling multiplier</p>
      </div>

      {/* Denoise Level */}
      <div className="bg-black/20 rounded-lg p-4">
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs font-medium text-white/70">Denoise Level</label>
          <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
            {nodeSettings.denoise}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={nodeSettings.denoise}
          onChange={(e) => handleSettingChange('denoise', parseInt(e.target.value))}
          className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
        />
        <p className="mt-2 text-xs text-white/50">Adjust noise reduction strength</p>
      </div>

      {/* Enhancement Options */}
      <div className="bg-black/20 rounded-lg p-4">
        <label className="block text-xs font-medium text-white/70 mb-3">Enhancement Options</label>
        <div className="space-y-3">
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={nodeSettings.enhanceDetails}
              onChange={(e) => handleSettingChange('enhanceDetails', e.target.checked)}
              className="rounded border-white/30 bg-black/30 text-white focus:ring-0 focus:ring-offset-0"
            />
            <span className="text-sm text-white/70">Enhance details</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={nodeSettings.preserveColors}
              onChange={(e) => handleSettingChange('preserveColors', e.target.checked)}
              className="rounded border-white/30 bg-black/30 text-white focus:ring-0 focus:ring-offset-0"
            />
            <span className="text-sm text-white/70">Preserve colors</span>
          </label>
        </div>
        <p className="mt-2 text-xs text-white/50">Fine-tune the enhancement process</p>
      </div>
    </div>
  );

  return (
    <BaseNode {...props} icon={props.icon || <ArrowUpRight size={16} />}>
      {renderSettings()}
    </BaseNode>
  );
};

export default UpscaleImageNode;
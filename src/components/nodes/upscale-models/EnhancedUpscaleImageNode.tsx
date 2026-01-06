import React, { useState, useEffect } from 'react';
import { ArrowUpRight } from 'lucide-react';
import BaseNode, { BaseNodeProps } from '../BaseNode';
import { UpscaleModelInterface, UpscaleModelSettings } from './UpscaleModelInterface';
import { getModelImplementation } from './ModelRegistry';

interface EnhancedUpscaleImageNodeProps extends BaseNodeProps {
  initialModel?: string;
}

const EnhancedUpscaleImageNode: React.FC<EnhancedUpscaleImageNodeProps> = (props) => {
  // Get the initial model from props or default to Stability AI
  const initialModelName = props.initialModel || 'stability-ai';
  
  // State for the selected model and settings
  const [selectedModelName, setSelectedModelName] = useState(initialModelName);
  const [modelImplementation, setModelImplementation] = useState<UpscaleModelInterface | null>(null);
  const [settings, setSettings] = useState<UpscaleModelSettings>({
    upscaleFactor: 2,
    denoise: 50,
    enhanceDetails: true,
    preserveColors: true
  });
  
  // Load the model implementation when the selected model changes
  useEffect(() => {
    const implementation = getModelImplementation(selectedModelName);
    setModelImplementation(implementation);
    
    // Update settings with model-specific defaults
    if (implementation) {
      setSettings(prev => ({
        ...implementation.defaultSettings,
        // Preserve user values if they exist
        ...(prev.upscaleFactor ? { upscaleFactor: prev.upscaleFactor } : {}),
        ...(prev.denoise ? { denoise: prev.denoise } : {})
      }));
    }
  }, [selectedModelName]);
  
  // Handle setting changes
  const handleSettingChange = (key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };
  
  // Handle model selection change
  const handleModelChange = (modelName: string) => {
    setSelectedModelName(modelName);
  };
  
  // Render the node settings
  const renderSettings = () => (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="bg-black/20 rounded-lg p-4">
        <label className="block text-xs font-medium text-white/70 mb-2">Model Selection</label>
        <select 
          value={selectedModelName}
          onChange={(e) => handleModelChange(e.target.value)}
          className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
        >
          <option value="ximilar">Ximilar</option>
          <option value="deepai-image">DeepAI Image</option>
          <option value="upscale-media">Upscale.media</option>
          <option value="stability-ai">Stability AI</option>
          <option value="topaz-labs">Topaz Labs</option>
          <option value="magnific-ai">Magnific AI</option>
        </select>
        <p className="mt-2 text-xs text-white/50">Select the image upscaling model</p>
      </div>
      
      {/* Model capabilities info */}
      {modelImplementation && (
        <div className="bg-black/20 rounded-lg p-4">
          <p className="text-xs text-white/70 leading-relaxed">
            {modelImplementation.description}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {modelImplementation.supportsFaceEnhancement && (
              <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">Face Enhancement</span>
            )}
            {modelImplementation.supportsArtifactRemoval && (
              <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">Artifact Removal</span>
            )}
            {modelImplementation.supportsDenoising && (
              <span className="text-[10px] bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">Denoising</span>
            )}
            {modelImplementation.supportsAIDetectionRemoval && (
              <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">AI Detection Removal</span>
            )}
            {modelImplementation.supportsTextEnhancement && (
              <span className="text-[10px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">Text Enhancement</span>
            )}
            {modelImplementation.supportsStyleTransfer && (
              <span className="text-[10px] bg-pink-500/20 text-pink-400 px-2 py-0.5 rounded-full">Style Transfer</span>
            )}
          </div>
        </div>
      )}
      
      {/* Model-specific settings */}
      {modelImplementation && (
        modelImplementation.renderModelSettings(settings, handleSettingChange)
      )}
    </div>
  );
  
  return (
    <BaseNode {...props} icon={props.icon || <ArrowUpRight size={16} />}>
      {renderSettings()}
    </BaseNode>
  );
};

export default EnhancedUpscaleImageNode; 
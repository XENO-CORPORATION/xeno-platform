import React, { useState, useEffect } from 'react';
import { Image } from 'lucide-react';
import BaseNode, { BaseNodeProps } from '../BaseNode';
import { ImageModelInterface, ImageModelSettings } from './ImageModelInterface';
import { getModelImplementation } from './ModelRegistry';

interface EnhancedImageNodeProps extends BaseNodeProps {
  initialModel?: string;
}

const EnhancedImageNode: React.FC<EnhancedImageNodeProps> = (props) => {
  // Get the initial model from props or default to Stable Diffusion 3.5
  const initialModelName = props.initialModel || 'stable-diffusion-3.5';
  
  // State for the selected model and settings
  const [selectedModelName, setSelectedModelName] = useState(initialModelName);
  const [modelImplementation, setModelImplementation] = useState<ImageModelInterface | null>(null);
  const [settings, setSettings] = useState<ImageModelSettings>({
    resolution: '1024x1024',
    style: 'photorealistic',
    steps: 30,
    guidance: 7.5
  });
  
  // Load the model implementation when the selected model changes
  useEffect(() => {
    const implementation = getModelImplementation(selectedModelName);
    setModelImplementation(implementation);
    
    // Update settings with model-specific defaults
    if (implementation) {
      setSettings(prev => ({
        ...implementation.defaultSettings,
        // Preserve any user-set values if they exist
        ...(prev.negativePrompt ? { negativePrompt: prev.negativePrompt } : {}),
        ...(prev.seed !== undefined ? { seed: prev.seed } : {})
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
          <option value="fal-ai/flux/dev">Flux Dev</option>
          <option value="fal-ai/flux-pro/v1.1-ultra">Flux Pro v1.1-Ultra</option>
          <option value="fal-ai/luma-photon/flash">Luma Photon Flash</option>
          <option value="fal-ai/recraft/v3/text-to-image">Recraft V3</option>
          <option value="fal-ai/ideogram/v3">Ideogram V3</option>
          <option value="fal-ai/ideogram/v2a/turbo">Ideogram V2a Turbo</option>
          <option value="stable-diffusion-3.5">Stable Diffusion 3.5</option>
        </select>
        <p className="mt-2 text-xs text-white/50">Choose the AI model for image generation</p>
      </div>
      
      {/* Model-specific settings */}
      {modelImplementation && (
        modelImplementation.renderModelSettings(settings, handleSettingChange)
      )}
    </div>
  );
  
  return (
    <BaseNode {...props} icon={props.icon || <Image size={16} />}>
      {renderSettings()}
    </BaseNode>
  );
};

export default EnhancedImageNode; 
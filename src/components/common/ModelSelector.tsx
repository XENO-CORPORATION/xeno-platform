import React, { useState } from 'react';
import { Image, ChevronDown } from 'lucide-react';

interface ModelOption {
  id: string;
  name: string;
}

interface ModelSelectorProps {
  models: ModelOption[];
  selectedModel: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ 
  models, 
  selectedModel, 
  onChange,
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const getModelDescription = (modelId: string) => {
    switch(modelId) {
      case 'stable-diffusion-3-5-large':
        return "A Multimodal Diffusion Transformer (MMDiT) model with enhanced image quality and typography.";
      case 'flux-dev':
        return "A 12-billion-parameter flow transformer for high-quality image generation.";
      case 'fal-ai/flux-pro/v1.1-ultra':
        return "A professional-grade model with up to 2K resolution and improved photorealism.";
      case 'fal-ai/luma-photon/flash':
        return "A creative, personalizable model for high-quality image generation.";
      case 'fal-ai/recraft/v3/text-to-image':
        return "A state-of-the-art model for long texts, vector art, and brand-style images.";
      case 'fal-ai/ideogram/v3':
        return "The latest version with improved typography, composition capabilities, and style reference support.";
      case 'fal-ai/ideogram/v2a/turbo':
        return "Fast generation optimized for high-quality images, posters, and logos with excellent typography.";
      case 'recraft-v3-svg':
        return "A specialized SVG output variant of Recraft V3.";
      case 'ideogram-v2':
        return "Optimized for high-quality images, posters, and logos with excellent typography.";
      case 'sd3':
        return "Stable Diffusion 3.5 Large - A state-of-the-art image generation model with incredible quality and detail.";
      case 'sd3-small':
        return "Stable Diffusion 3.5 Small - Faster generation with excellent quality.";
      case 'flux-1.1':
        return "Flux 1.1 - Professional-grade image model with excellent photorealism.";
      default:
        return "Advanced image generation model.";
    }
  };

  const getModelIcon = (modelId: string) => {
    return <div className="mr-2 rounded-full bg-white/10 p-1"><Image size={16} /></div>;
  };

  // Find the selected model from the array
  const selectedModelObj = models.find(m => m.id === selectedModel) || models[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-white/20 flex justify-between items-center ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        <div className="flex items-center">
          {getModelIcon(selectedModel)}
          <span>{selectedModelObj.name}</span>
        </div>
        <ChevronDown 
          className={`w-4 h-4 transition-transform ${isOpen ? 'transform rotate-180' : ''}`} 
        />
      </button>
      
      {isOpen && !disabled && (
        <div className="absolute z-10 w-full mt-1 bg-[rgba(30,30,30,0.95)] border border-white/10 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {models.map((model) => (
            <div
              key={model.id}
              onClick={() => {
                onChange(model.id);
                setIsOpen(false);
              }}
              className={`p-2 hover:bg-white/10 cursor-pointer ${
                model.id === selectedModel ? 'bg-white/5' : ''
              }`}
            >
              <div className="flex items-center">
                {getModelIcon(model.id)}
                <div>
                  <div className="text-white text-sm">{model.name}</div>
                  <div className="text-white/60 text-xs mt-0.5">
                    {getModelDescription(model.id)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModelSelector;

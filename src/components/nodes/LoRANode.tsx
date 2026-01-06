import React, { useState } from 'react';
import { Layers } from 'lucide-react';
import BaseNode, { BaseNodeProps } from './BaseNode';

interface LoRAModel {
  id: string;
  name: string;
  description: string;
  category: string;
  strength?: number;
  previewImageUrl?: string;
}

// Sample LoRA models - in a real app, these would come from an API or database
const SAMPLE_LORA_MODELS: LoRAModel[] = [
  {
    id: 'anime-style',
    name: 'Anime Style',
    description: 'Adapts generation to anime and manga art styles',
    category: 'art',
    previewImageUrl: 'https://images.unsplash.com/photo-1560169897-fc0cdbdfa4d5?q=80&w=300&h=300&auto=format&fit=crop'
  },
  {
    id: 'photorealism',
    name: 'Photorealism',
    description: 'Enhances photorealistic details and textures',
    category: 'photography',
    previewImageUrl: 'https://images.unsplash.com/photo-1579353977828-2a4eab540b9a?q=80&w=300&h=300&auto=format&fit=crop'
  },
  {
    id: 'architecture',
    name: 'Architecture',
    description: 'Specialized in architectural designs and structures',
    category: 'architecture',
    previewImageUrl: 'https://images.unsplash.com/photo-1487958449943-2429e8be8625?q=80&w=300&h=300&auto=format&fit=crop'
  },
  {
    id: 'portrait',
    name: 'Portrait Pro',
    description: 'Optimized for human portraits and facial features',
    category: 'portrait',
    previewImageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=300&h=300&auto=format&fit=crop'
  },
  {
    id: 'landscape',
    name: 'Landscape Master',
    description: 'Specialized in natural landscapes and scenery',
    category: 'landscape',
    previewImageUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?q=80&w=300&h=300&auto=format&fit=crop'
  },
  {
    id: 'concept-art',
    name: 'Concept Art',
    description: 'Creates detailed concept art for games and films',
    category: 'art',
    previewImageUrl: 'https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?q=80&w=300&h=300&auto=format&fit=crop'
  },
  {
    id: 'sci-fi',
    name: 'Sci-Fi Worlds',
    description: 'Specialized in futuristic and sci-fi environments',
    category: 'sci-fi',
    previewImageUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=300&h=300&auto=format&fit=crop'
  },
  {
    id: 'fantasy',
    name: 'Fantasy Realms',
    description: 'Creates magical and fantasy-themed imagery',
    category: 'fantasy',
    previewImageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=300&h=300&auto=format&fit=crop'
  }
];

// Categories for filtering
const CATEGORIES = ['all', 'art', 'photography', 'architecture', 'portrait', 'landscape', 'sci-fi', 'fantasy'];

interface LoRANodeProps extends BaseNodeProps {
  initialModel?: string;
}

const LoRANode: React.FC<LoRANodeProps> = (props) => {
  const { initialModel, ...nodeProps } = props;
  
  // State for the node settings
  const [nodeSettings, setNodeSettings] = useState({
    selectedModel: initialModel || 'anime-style',
    strength: 0.75,
    category: 'all',
    searchQuery: '',
    customModelUrl: '',
    useCustomModel: false
  });

  // Filtered models based on category and search
  const filteredModels = SAMPLE_LORA_MODELS.filter(model => {
    const matchesCategory = nodeSettings.category === 'all' || model.category === nodeSettings.category;
    const matchesSearch = nodeSettings.searchQuery === '' || 
      model.name.toLowerCase().includes(nodeSettings.searchQuery.toLowerCase()) ||
      model.description.toLowerCase().includes(nodeSettings.searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Handle setting changes
  const handleSettingChange = (key: string, value: any) => {
    setNodeSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Handle model selection
  const handleModelSelect = (modelId: string) => {
    setNodeSettings(prev => ({
      ...prev,
      selectedModel: modelId,
      useCustomModel: false
    }));
  };

  // Get the currently selected model
  const selectedModel = SAMPLE_LORA_MODELS.find(model => model.id === nodeSettings.selectedModel);

  return (
    <BaseNode {...nodeProps} icon={props.icon || <Layers size={16} />}>
      <div className="space-y-4">
        {/* Search and Filter */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <input
              type="text"
              placeholder="Search LoRA models..."
              value={nodeSettings.searchQuery}
              onChange={(e) => handleSettingChange('searchQuery', e.target.value)}
              className="interactive-element flex-1 bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
            />
            <select
              value={nodeSettings.category}
              onChange={(e) => handleSettingChange('category', e.target.value)}
              className="interactive-element bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
            >
              {CATEGORIES.map(category => (
                <option key={category} value={category}>
                  {category.charAt(0).toUpperCase() + category.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* LoRA Model Selection */}
        <div className="bg-black/20 rounded-lg p-4">
          <h3 className="text-sm font-medium text-white/80 mb-3">Select LoRA Model</h3>
          
          <div className="grid grid-cols-2 gap-2 mb-4">
            {filteredModels.map(model => (
              <div
                key={model.id}
                onClick={(e) => {
                  e.stopPropagation();
                  handleModelSelect(model.id);
                }}
                className="interactive-element relative rounded-lg border overflow-hidden cursor-pointer transition-all ${
                  nodeSettings.selectedModel === model.id
                    ? 'border-blue-500 ring-1 ring-blue-500'
                    : 'border-white/10 hover:border-white/30'
                }"
              >
                {/* Model Preview Image */}
                <div className="aspect-square bg-black/40 overflow-hidden">
                  {model.previewImageUrl ? (
                    <img 
                      src={model.previewImageUrl} 
                      alt={model.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Layers size={32} className="text-white/30" />
                    </div>
                  )}
                </div>
                
                {/* Model Info */}
                <div className="p-2">
                  <h4 className="text-xs font-medium text-white/90 truncate">{model.name}</h4>
                  <p className="text-[10px] text-white/50 truncate">{model.description}</p>
                </div>
                
                {/* Selected Indicator */}
                {nodeSettings.selectedModel === model.id && (
                  <div className="absolute top-2 right-2 bg-blue-500 rounded-full p-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {/* Custom Model Upload */}
          <div className="border border-white/10 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-white/70">Use Custom LoRA</label>
              <div className="relative inline-block w-10 align-middle select-none">
                <input
                  type="checkbox"
                  id="useCustomModel"
                  checked={nodeSettings.useCustomModel}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleSettingChange('useCustomModel', e.target.checked);
                  }}
                  className="interactive-element sr-only"
                />
                <div className="block h-6 bg-black/30 rounded-full w-10"></div>
                <div 
                  className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                    nodeSettings.useCustomModel ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                  }`}
                ></div>
              </div>
            </div>
            
            {nodeSettings.useCustomModel && (
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  placeholder="Enter model URL or path..."
                  value={nodeSettings.customModelUrl}
                  onChange={(e) => handleSettingChange('customModelUrl', e.target.value)}
                  className="interactive-element w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-white/20"
                />
                <div className="flex justify-end">
                  <button 
                    onClick={(e) => e.stopPropagation()}
                    className="interactive-element bg-blue-600/30 hover:bg-blue-600/50 text-white text-xs rounded-lg px-3 py-1 transition-colors"
                  >
                    Upload Model
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Model Strength */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">LoRA Strength</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {(nodeSettings.strength * 100).toFixed()}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={nodeSettings.strength}
            onChange={(e) => handleSettingChange('strength', parseFloat(e.target.value))}
            className="interactive-element w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Adjust the influence of the LoRA model on generation</p>
        </div>
        
        {/* Selected Model Info */}
        {selectedModel && !nodeSettings.useCustomModel && (
          <div className="bg-black/20 rounded-lg p-4">
            <h3 className="text-sm font-medium text-white/80 mb-2">Selected Model</h3>
            <div className="flex items-start space-x-3">
              <div className="w-16 h-16 rounded-md overflow-hidden bg-black/40">
                {selectedModel.previewImageUrl ? (
                  <img 
                    src={selectedModel.previewImageUrl} 
                    alt={selectedModel.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Layers size={24} className="text-white/30" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-white/90">{selectedModel.name}</h4>
                <p className="text-xs text-white/60 mt-1">{selectedModel.description}</p>
                <div className="mt-2 flex items-center">
                  <span className="text-[10px] bg-white/10 text-white/70 px-2 py-0.5 rounded-full">
                    {selectedModel.category}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Custom Model Info */}
        {nodeSettings.useCustomModel && nodeSettings.customModelUrl && (
          <div className="bg-black/20 rounded-lg p-4">
            <h3 className="text-sm font-medium text-white/80 mb-2">Custom Model</h3>
            <div className="text-xs text-white/70 break-all border border-white/10 rounded p-2 bg-black/30">
              {nodeSettings.customModelUrl}
            </div>
          </div>
        )}
      </div>
    </BaseNode>
  );
};

export default LoRANode; 
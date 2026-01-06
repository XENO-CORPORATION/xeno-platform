import React, { useState } from 'react';
import { BrainCircuit, Image, Video, Zap, Search, Bookmark, Filter, ChevronDown, X, ArrowUpRight, Plus, Layers, Save, Eye, Link } from 'lucide-react';

// Node template interface
export interface NodeTemplate {
  id: string;
  title: string;
  icon: React.ReactNode;
  description: string;
  type: 'llm' | 'image' | 'video' | 'utility' | 'upscale-image' | 'upscale-video' | 'lora' | 'save' | 'preview' | 'bridge';
  category: string;
  inputs: Array<{ id: string; type: string; label: string }>;
  outputs: Array<{ id: string; type: string; label: string }>;
  popular?: boolean;
}

interface AgentPanelProps {
  onAddNode: (template: NodeTemplate) => void;
  className?: string;
}

// Export the node templates so they can be used by other components
export const nodeTemplates: NodeTemplate[] = [
  // Single LLM Node
  {
    id: 'llm-node',
    title: 'Language Model',
    icon: <BrainCircuit size={16} />,
    description: 'Versatile language model that can be configured to use different LLM providers including GPT-4o, Claude 3 Sonnet, Gemini, Grok 3, and Ollama',
    type: 'llm',
    category: 'Language Models',
    inputs: [
      { id: "prompt", type: "text", label: "Text Input" },
      { id: "style", type: "parameter", label: "Style Parameters" }
    ],
    outputs: [
      { id: "text", type: "text", label: "Generated Text" }
    ],
    popular: true
  },
  
  // Gemini Node
  {
    id: 'llm-gemini',
    title: 'Gemini',
    icon: <BrainCircuit size={16} />,
    description: 'Google\'s advanced language model with excellent reasoning capabilities',
    type: 'llm',
    category: 'Language Models',
    inputs: [
      { id: "prompt", type: "text", label: "Text Input" },
      { id: "style", type: "parameter", label: "Style Parameters" }
    ],
    outputs: [
      { id: "text", type: "text", label: "Generated Text" }
    ],
    popular: true
  },
  
  // Single Image Generation Node
  {
    id: 'image-node',
    title: 'Image Generator',
    icon: <Image size={16} />,
    description: 'Create images using various models including Stable Diffusion 3.5, Flux Dev, Flux Pro 1.1, Luma Photon, and Recraft V3',
    type: 'image',
    category: 'Image Generation',
    inputs: [
      { id: "prompt", type: "text", label: "Text Prompt" },
      { id: "style", type: "parameter", label: "Style Settings" }
    ],
    outputs: [
      { id: "image", type: "image", label: "Generated Image" }
    ],
    popular: true
  },
  
  // Single Video Generation Node
  {
    id: 'video-node',
    title: 'Video Generator',
    icon: <Video size={16} />,
    description: 'Generate and transform videos using models like Runway Gen-2, Pika, and others',
    type: 'video',
    category: 'Video Generation',
    inputs: [
      { id: "prompt", type: "text", label: "Text/Image Input" },
      { id: "motion", type: "parameter", label: "Motion Parameters" }
    ],
    outputs: [
      { id: "video", type: "video", label: "Generated Video" }
    ],
    popular: true
  },
  
  // Image Upscale Node
  {
    id: 'upscale-image-node',
    title: 'Image Upscaler',
    icon: <ArrowUpRight size={16} />,
    description: 'Enhance and upscale images using AI-powered models like Stability AI and Topaz Labs',
    type: 'upscale-image',
    category: 'Enhancement',
    inputs: [
      { id: "image", type: "image", label: "Image Input" },
      { id: "settings", type: "parameter", label: "Upscale Settings" }
    ],
    outputs: [
      { id: "image", type: "image", label: "Enhanced Image" }
    ],
    popular: true
  },
  
  // Video Upscale Node
  {
    id: 'upscale-video-node',
    title: 'Video Upscaler',
    icon: <ArrowUpRight size={16} />,
    description: 'Enhance video quality, resolution, and frame rate using advanced AI models',
    type: 'upscale-video',
    category: 'Enhancement',
    inputs: [
      { id: "video", type: "video", label: "Video Input" },
      { id: "settings", type: "parameter", label: "Upscale Settings" }
    ],
    outputs: [
      { id: "video", type: "video", label: "Enhanced Video" }
    ]
  },
  
  // Utility Nodes
  {
    id: 'preview-node',
    title: 'Preview Node',
    icon: <Eye size={16} />,
    description: 'Display intermediate outputs for real-time feedback',
    type: 'preview',
    category: 'Utility',
    inputs: [
      { id: "input", type: "any", label: "Any Input" }
    ],
    outputs: []
  },
  {
    id: 'save-node',
    title: 'Save Node',
    icon: <Save size={16} />,
    description: 'Export final outputs to your device',
    type: 'save',
    category: 'Utility',
    inputs: [
      { id: "input", type: "any", label: "Any Input" }
    ],
    outputs: []
  },
  {
    id: 'bridge-node',
    title: 'Bridge Node',
    icon: <Link size={16} />,
    description: 'Convert data between incompatible types',
    type: 'bridge',
    category: 'Utility',
    inputs: [
      { id: "input", type: "any", label: "Any Input" }
    ],
    outputs: [
      { id: "output", type: "any", label: "Converted Output" }
    ]
  },
  
  // LoRA Node
  {
    id: 'lora-node',
    title: 'LoRA Model',
    icon: <Layers size={16} />,
    description: 'Apply Low-Rank Adaptation (LoRA) models to fine-tune image and text generation',
    type: 'lora',
    category: 'Fine-tuning',
    inputs: [],
    outputs: [
      { id: "lora", type: "lora", label: "LoRA Model" }
    ],
    popular: true
  }
];

const AgentPanel: React.FC<AgentPanelProps> = ({ onAddNode, className = '' }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  
  // Filter nodes based on search term and selected filters
  const filteredNodes = nodeTemplates.filter(node => {
    const matchesSearch = searchTerm === '' || 
      node.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      node.description.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesType = selectedType === null || 
      (selectedType === 'upscale' ? (node.type === 'upscale-image' || node.type === 'upscale-video') : node.type === selectedType);
    
    return matchesSearch && matchesType;
  });
  
  // Group nodes by category
  const nodesByCategory = filteredNodes.reduce((acc, node) => {
    if (!acc[node.category]) {
      acc[node.category] = [];
    }
    acc[node.category].push(node);
    return acc;
  }, {} as Record<string, NodeTemplate[]>);
  
  // Handle node drag start
  const handleDragStart = (e: React.DragEvent, template: NodeTemplate) => {
    // Create a simplified version of the template without React components
    const templateData = {
      ...template,
      // Convert icon to a string identifier instead of a React component
      icon: template.type // Use the type as an identifier for the icon
    };
    
    e.dataTransfer.setData('application/json', JSON.stringify(templateData));
    e.dataTransfer.effectAllowed = 'copy';
  };
  
  return (
    <div className={`bg-[rgba(20,20,20,0.95)] border-r border-white/10 rounded-l-xl flex flex-col h-full transform-gpu ${className}`}>
      {/* Header with search and filters */}
      <div className="p-4 border-b border-white/10">
        <h3 className="text-lg font-medium text-white mb-3">Agent Library</h3>
        
        {/* Search bar */}
        <div className="relative mb-3">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={16} className="text-white/40" />
          </div>
          <input
            type="text"
            placeholder="Search nodes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg py-2 pl-10 pr-4 focus:outline-none focus:ring-1 focus:ring-white/20"
          />
        </div>
        
        {/* Filter controls */}
        <div className="flex items-center space-x-2">
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center space-x-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
          >
            <Filter size={14} />
            <span className="text-sm">Filters</span>
            <ChevronDown size={14} className={`ml-1 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          
          {selectedType && (
            <button 
              onClick={() => setSelectedType(null)}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-sm flex items-center space-x-1 transition-colors"
            >
              <span>{selectedType === 'upscale' ? 'UPSCALE' : selectedType.toUpperCase()}</span>
              <X size={14} />
            </button>
          )}
        </div>
        
        {/* Expanded filters */}
        {showFilters && (
          <div className="mt-3 p-3 bg-[rgba(0,0,0,0.2)] rounded-lg border border-white/5 animate-fadeIn">
            {/* Node type filters */}
            <div className="mb-3">
              <div className="text-sm font-medium text-white/70 mb-2">Node Type</div>
              <div className="flex flex-wrap gap-2">
                <button 
                  onClick={() => setSelectedType('llm')}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                    selectedType === 'llm' 
                      ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                      : 'bg-white/5 hover:bg-white/10 text-white/70 border border-white/10'
                  }`}
                >
                  <div className="flex items-center space-x-1">
                    <BrainCircuit size={12} />
                    <span>Language Models</span>
                  </div>
                </button>
                
                <button 
                  onClick={() => setSelectedType('image')}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                    selectedType === 'image' 
                      ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                      : 'bg-white/5 hover:bg-white/10 text-white/70 border border-white/10'
                  }`}
                >
                  <div className="flex items-center space-x-1">
                    <Image size={12} />
                    <span>Image Generation</span>
                  </div>
                </button>
                
                <button 
                  onClick={() => setSelectedType('video')}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                    selectedType === 'video' 
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      : 'bg-white/5 hover:bg-white/10 text-white/70 border border-white/10'
                  }`}
                >
                  <div className="flex items-center space-x-1">
                    <Video size={12} />
                    <span>Video Generation</span>
                  </div>
                </button>
                
                <button 
                  onClick={() => setSelectedType('upscale')}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                    selectedType === 'upscale' 
                      ? 'bg-pink-500/20 text-pink-300 border border-pink-500/30'
                      : 'bg-white/5 hover:bg-white/10 text-white/70 border border-white/10'
                  }`}
                >
                  <div className="flex items-center space-x-1">
                    <ArrowUpRight size={12} />
                    <span>Upscalers</span>
                  </div>
                </button>
                
                <button 
                  onClick={() => setSelectedType('utility')}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                    selectedType === 'utility' 
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'bg-white/5 hover:bg-white/10 text-white/70 border border-white/10'
                  }`}
                >
                  <div className="flex items-center space-x-1">
                    <Zap size={12} />
                    <span>Utility</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Node library (scrollable) */}
      <div className="flex-grow overflow-y-auto p-3">
        {Object.keys(nodesByCategory).length > 0 ? (
          Object.entries(nodesByCategory).map(([category, nodes]) => (
            <div key={category} className="mb-6">
              <h4 className="text-white/70 text-sm font-medium mb-2">{category}</h4>
              <div className="space-y-2">
                {nodes.map(template => {
                  const getBorderColor = () => {
                    if (template.type === 'llm') return 'border-yellow-500/30';
                    if (template.type === 'image') return 'border-green-500/30';
                    if (template.type === 'video') return 'border-blue-500/30';
                    if (template.type === 'upscale-image' || template.type === 'upscale-video') return 'border-pink-500/30';
                    return 'border-purple-500/30';
                  };
                  
                  const getBackgroundColor = () => {
                    if (template.type === 'llm') return 'bg-yellow-500/10';
                    if (template.type === 'image') return 'bg-green-500/10';
                    if (template.type === 'video') return 'bg-blue-500/10';
                    if (template.type === 'upscale-image' || template.type === 'upscale-video') return 'bg-pink-500/10';
                    return 'bg-purple-500/10';
                  };
                  
                  return (
                    <div 
                      key={template.id} 
                      className={`p-3 border ${getBorderColor()} ${getBackgroundColor()} rounded-lg cursor-grab relative group transition-all hover:brightness-110 hover:scale-[1.02] transform-gpu`}
                      draggable="true"
                      onDragStart={(e) => handleDragStart(e, template)}
                    >
                      <div className="flex items-start space-x-3">
                        <div className={`mt-0.5 p-1.5 rounded-md ${
                          template.type === 'llm' ? 'bg-yellow-500/20 text-yellow-300' :
                          template.type === 'image' ? 'bg-green-500/20 text-green-300' : 
                          template.type === 'video' ? 'bg-blue-500/20 text-blue-300' : 
                          (template.type === 'upscale-image' || template.type === 'upscale-video') ? 'bg-pink-500/20 text-pink-300' :
                          'bg-purple-500/20 text-purple-300'
                        }`}>
                          {template.icon}
                        </div>
                        <div className="flex-grow">
                          <div className="flex items-center">
                            <h5 className="text-white text-sm font-medium">{template.title}</h5>
                            {template.popular && (
                              <span className="ml-2 text-xs px-1.5 py-0.5 bg-white/20 text-white/80 rounded">Popular</span>
                            )}
                          </div>
                          <p className="text-white/60 text-xs mt-1 line-clamp-2">{template.description}</p>
                        </div>
                      </div>
                      
                      {/* Drag indicator and click to add */}
                      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-2">
                        <div className="text-xs text-white/50">Drag to add</div>
                        <button 
                          onClick={() => onAddNode(template)}
                          className="p-1 bg-white/10 hover:bg-white/20 rounded text-white/70 hover:text-white transition-colors"
                          title="Add to canvas"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-white/50 text-center p-6">
            <Search size={24} className="mb-2 opacity-40" />
            <p>No nodes match your search criteria</p>
            <button 
              onClick={() => {
                setSearchTerm('');
                setSelectedType(null);
              }} 
              className="mt-2 text-sm text-white/70 hover:text-white underline transition-colors"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
      
      {/* Bottom quick filters */}
      <div className="p-3 border-t border-white/10">
        <div className="flex space-x-2">
          <button className="flex items-center justify-center p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors flex-1">
            <Bookmark size={16} className="text-white/70" />
          </button>
          <button 
            onClick={() => setSelectedType('llm')}
            className={`flex items-center justify-center p-2 rounded-lg transition-colors flex-1 ${
              selectedType === 'llm' ? 'bg-yellow-500/20 text-yellow-300' : 'bg-white/5 hover:bg-white/10 text-white/70'
            }`}
          >
            <BrainCircuit size={16} />
          </button>
          <button 
            onClick={() => setSelectedType('image')}
            className={`flex items-center justify-center p-2 rounded-lg transition-colors flex-1 ${
              selectedType === 'image' ? 'bg-green-500/20 text-green-300' : 'bg-white/5 hover:bg-white/10 text-white/70'
            }`}
          >
            <Image size={16} />
          </button>
          <button 
            onClick={() => setSelectedType('video')}
            className={`flex items-center justify-center p-2 rounded-lg transition-colors flex-1 ${
              selectedType === 'video' ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 hover:bg-white/10 text-white/70'
            }`}
          >
            <Video size={16} />
          </button>
          <button 
            onClick={() => setSelectedType('upscale')}
            className={`flex items-center justify-center p-2 rounded-lg transition-colors flex-1 ${
              selectedType === 'upscale' ? 'bg-pink-500/20 text-pink-300' : 'bg-white/5 hover:bg-white/10 text-white/70'
            }`}
          >
            <ArrowUpRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgentPanel;
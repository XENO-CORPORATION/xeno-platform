import React, { useState, useEffect, useRef } from 'react';
import { Image, Send, Download, Copy, Share2, Trash2, Sparkles, Plus, X, Info, AlertCircle, RotateCw, Wand2, Settings, ChevronDown, RefreshCw, Triangle, PenTool, Camera, Minus, ZoomIn, ZoomOut, Move, Maximize, Minimize, DownloadCloud, ChevronRight } from 'lucide-react';
import imageGenerationService from '../../../services/imageGenerationService';
import { ImageModelSettings, GeneratedImage } from '../../nodes/image-models/ImageModelInterface';
import { API_TOKENS } from '../../../config/apiConfig';
import { generateImagePrompt, GeneratedPromptResult, analyzeImageWithGemini } from '../../../services/geminiService';
import { useLayout } from '../../../pages/Overview';

// Create a custom event for when an image is generated
export const IMAGE_GENERATED_EVENT = 'image_generated';

// Custom event interface (from Gallery file)
interface ImageGeneratedEvent extends CustomEvent {
  detail: {
    id: string;
    url: string;
    prompt: string;
    model: string;
    settings: Record<string, any>;
    metadata?: Record<string, any>;
  };
}

// GalleryItem interface (from Gallery file)
interface GalleryItem {
  id: string;
  title?: string;
  description?: string;
  type: 'image' | 'video' | 'svg';
  url: string;
  thumbnailUrl?: string;
  prompt?: string;
  created: Date;
  tags?: string[];
  model?: string;
  settings?: Record<string, any>;
  inProgress?: boolean;
}

// Simple notification helper to avoid dependency issues
const notifications = {
  error: (message: string) => {
    console.error(`Error: ${message}`);
    alert("Error: " + message);
  },
  success: (message: React.ReactNode, options?: any) => {
    if (typeof message === 'string') {
      console.log(`Success: ${message}`);
    } else {
      console.log('Operation completed successfully');
    }
    // No alert dialog, to avoid interrupting the user experience
  }
};

// Define model families and their submodels
interface ModelFamily {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
  isNew?: boolean;
  isBeta?: boolean;
  submodels: SubModel[];
}

interface SubModel {
  id: string;
  name: string;
  description: string;
  isNew?: boolean;
  isBeta?: boolean;
  additionalInfo?: string;
  supportsImageUpload?: boolean; // New property to indicate if model supports direct image uploads
}

// Define model families and their submodels - make this accessible to the entire file
const modelFamilies: ModelFamily[] = [
  {
    id: 'google',
    name: 'Google',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Sparkles size={16} className="text-purple-400" /></div>,
    description: "Google's state-of-the-art Imagen models for high-quality image generation with advanced understanding.",
    submodels: [
      {
        id: 'fal-ai/imagen4/preview',
        name: 'Imagen 4 Preview',
        description: "Google's latest Imagen 4 model in preview, offering enhanced image quality and better prompt understanding.",
        isNew: true,
        supportsImageUpload: false
      },
      {
        id: 'fal-ai/imagen3',
        name: 'Imagen 3',
        description: "Google's powerful Imagen 3 model with excellent photorealism and artistic capabilities.",
        supportsImageUpload: false
      }
    ]
  },
  {
    id: 'stable-diffusion',
    name: 'Stable Diffusion',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Image size={16} className="text-sky-400" /></div>,
    description: "The most versatile and widely-used open-source text-to-image model family, known for high-quality image generation.",
    submodels: [
      {
        id: 'fal-ai/stable-diffusion-v35-large', // Match service registry key
        name: 'v3.5 Large',
        description: "Latest version with enhanced image quality and advanced conditioning features. Text-to-image only.",
        isNew: true,
        supportsImageUpload: false // SD v3.5 Large is text-to-image only (ControlNet/IP-Adapter are advanced features)
      },
      {
        id: 'fal-ai/stable-diffusion-v3-medium', // Match service registry key
        name: 'v3 Medium',
        description: "Balanced model with good performance and quality for most use cases. Text-to-image only.",
        additionalInfo: "Good default choice for most image generations.",
        supportsImageUpload: false // SD v3 Medium is text-to-image only
      }
    ]
  },
  {
    id: 'flux',
    name: 'Flux',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><RefreshCw size={16} className="text-green-400" /></div>,
    description: "Advanced flow-based diffusion models with exceptional photorealism and artistic capabilities.",
    submodels: [
      {
        id: 'fal-ai/flux/dev',
        name: 'Flux Dev', 
        description: "Development model with excellent creative capabilities and artistic flexibility. Text-to-image only.",
        isBeta: true,
        supportsImageUpload: false // Flux Dev is text-to-image only
      },
      {
        id: 'fal-ai/flux-pro/v1.1-ultra',
        name: 'Flux Pro v1.1-Ultra', 
        description: "Professional-grade model with ultra-high fidelity and advanced generation capabilities. Text-to-image only.",
        isNew: true,
        supportsImageUpload: false // Flux Pro v1.1-Ultra is text-to-image only
      }
    ]
  },
  {
    id: 'luma',
    name: 'Luma',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Camera size={16} className="text-amber-400" /></div>,
    description: "Leading models for photorealistic outputs with precise control over reference images and style.",
    submodels: [
      {
        id: 'fal-ai/luma-photon/flash',
        name: 'Photon Flash',
        description: "A fast, creative model for high-quality image generation with excellent photorealism.",
        supportsImageUpload: false
      }
    ]
  },
  {
    id: 'recraft',
    name: 'Recraft',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><PenTool size={16} className="text-rose-400" /></div>,
    description: "Specialized models for creating high-quality illustrations and vector graphics for UI/UX and product design.",
    submodels: [
      {
        id: 'fal-ai/recraft/v3/text-to-image',
        name: 'Recraft V3',
        description: "High-quality raster image generation optimized for illustrations and product designs. Supports realistic images, digital illustrations, and vector graphics.",
        isNew: true,
        supportsImageUpload: false
      },
      {
        id: 'recraft-v3-svg',
        name: 'Recraft V3 SVG', 
        description: "Vector graphics generator for creating scalable, editable SVG illustrations.",
        isNew: true
      }
    ]
  },
  {
    id: 'ideogram',
    name: 'Ideogram',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Triangle size={16} className="text-indigo-400" /></div>,
    description: "A powerful model for diverse visual styles, detailed illustrations, and artistic image generation.",
    submodels: [
      {
        id: 'fal-ai/ideogram/v3',
        name: 'Ideogram V3',
        description: "The latest version with improved typography, composition capabilities, and style reference support.",
        isNew: true,
        supportsImageUpload: true // Supports style reference images
      },
      {
        id: 'fal-ai/ideogram/v2a/turbo',
        name: 'Ideogram V2a Turbo',
        description: "Fast generation optimized for high-quality images, posters, and logos with excellent typography.",
        isBeta: true,
        additionalInfo: "Supports color palette",
        supportsImageUpload: false
      }
    ]
  }
];

// Model Selector Component with two-tier selection
const ModelSelector = ({ 
  selectedModel, 
  onChange,
  disabled 
}: { 
  selectedModel: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Helper function to determine input type for each image model
  const getModelInputType = (modelId: string): { type: 'Text' | 'Image' | 'Mixed'; color: string } => {
    switch (modelId) {
      // Mixed models (support both text and image/style reference)
      case 'fal-ai/ideogram/v3':
        return { type: 'Mixed', color: 'bg-purple-500/30 text-purple-300 border-purple-500/40' };
      // Text-to-image models (default for most image generation models)
      default:
        return { type: 'Text', color: 'bg-blue-500/30 text-blue-300 border-blue-500/40' };
    }
  };

  // Custom CSS for the animations - horizontal slide from left
  const animationStyles = isVisible ? {
    opacity: 1,
    transform: 'translateX(0)',
    transition: 'opacity 0.3s ease-out, transform 0.3s ease-out'
  } : {
    opacity: 0,
    transform: 'translateX(-20px)',
    transition: 'opacity 0.3s ease-out, transform 0.3s ease-out'
  };

  const findSelectedModelDetails = () => {
    for (const family of modelFamilies) {
      for (const model of family.submodels) {
        if (model.id === selectedModel) {
          return { family, model };
        }
      }
    }
    return null;
  };

  const selectedDetails = findSelectedModelDetails();

  const togglePanel = () => {
    if (disabled) return;

    if (!isOpen) {
      setIsOpen(true);
      setTimeout(() => setIsVisible(true), 10);
    } else {
      setIsVisible(false);
      setTimeout(() => {
        setIsOpen(false);
        setSelectedFamily(null);
      }, 300);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsVisible(false);
        setTimeout(() => {
          setIsOpen(false);
          setSelectedFamily(null);
        }, 300);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelectModel = (modelId: string) => {
    onChange(modelId);
    setIsVisible(false);
    setTimeout(() => {
      setIsOpen(false);
      setSelectedFamily(null);
    }, 300);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="w-full bg-[#0e0e10] text-white/90 border border-[#3a3a3d] rounded-lg h-10 px-3 focus:outline-none focus:border-[#6b7280] flex justify-between items-center transition-colors hover:border-[#6b7280]"
        onClick={togglePanel}
        disabled={disabled}
      >
        <div className="flex items-center">
          <div className="mr-2.5 rounded-lg bg-[#19191a] border border-[#3a3a3d] p-1.5">
            <Image size={14} className="text-white/60" />
          </div>
          <span className="text-sm">{selectedDetails ? selectedDetails.model.name : 'Select a model'}</span>
        </div>
        <svg
          className={`w-4 h-4 text-white/40 transition-transform ${isOpen ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={containerRef}
          className="absolute z-50 top-0 left-full ml-3 bg-[#19191a] border border-[#3a3a3d] rounded-lg shadow-xl overflow-hidden w-[340px]"
          style={animationStyles}
        >
          {selectedFamily === null ? (
            <div>
              <div className="px-3 py-2.5 border-b border-[#3a3a3d] bg-[#0e0e10]">
                <h3 className="text-xs font-medium text-white/60 text-center uppercase tracking-wide">Select Model Family</h3>
              </div>
              <div className="p-2">
                {modelFamilies.map(family => (
                  <div
                    key={family.id}
                    className="rounded-lg p-2.5 hover:bg-[#222224] cursor-pointer transition-all duration-200 border border-transparent hover:border-[#3a3a3d]"
                    onClick={() => setSelectedFamily(family.id)}
                  >
                    <div className="flex items-center">
                      <div className="mr-2.5 rounded-lg bg-[#0e0e10] border border-[#3a3a3d] p-1.5">
                        <Image size={14} className="text-white/60" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white/90 flex items-center">
                          {family.name}
                          {family.isBeta && <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-[#222224] text-white/50 rounded border border-[#3a3a3d]">BETA</span>}
                        </div>
                        <div className="text-xs text-white/40 mt-0.5 line-clamp-1">{family.description}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="px-3 py-2.5 border-b border-[#3a3a3d] bg-[#0e0e10] flex items-center">
                <button
                  className="mr-2 rounded-lg hover:bg-[#222224] p-1.5 transition-colors border border-transparent hover:border-[#3a3a3d]"
                  onClick={() => setSelectedFamily(null)}
                >
                  <svg
                    className="w-3.5 h-3.5 text-white/60 transform rotate-180"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
                <h3 className="text-sm font-medium text-white/80">
                  {modelFamilies.find(f => f.id === selectedFamily)?.name || 'Select Model'}
                </h3>
              </div>
              <div className="p-2">
                {modelFamilies
                  .find(f => f.id === selectedFamily)?.submodels
                  .map((model, index, array) => (
                    <div
                      key={model.id}
                      className={`rounded-lg p-2.5 cursor-pointer transition-all duration-200 border ${
                        selectedModel === model.id
                          ? 'bg-[#222224] border-[#6b7280]'
                          : 'border-[#3a3a3d] hover:border-[#6b7280] hover:bg-[#222224]'
                      } ${
                        index < array.length - 1 ? 'mb-1.5' : ''
                      }`}
                      onClick={() => handleSelectModel(model.id)}
                    >
                      <div className="flex items-center">
                        <div className={`w-4 h-4 rounded mr-2.5 flex-shrink-0 border flex items-center justify-center transition-all duration-200 ${
                          selectedModel === model.id
                            ? 'border-white/60 bg-white/20'
                            : 'border-[#3a3a3d] bg-transparent hover:border-white/40'
                        }`}>
                          {selectedModel === model.id && (
                            <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center flex-wrap gap-1.5">
                              <span className={`text-sm font-medium transition-colors ${
                                selectedModel === model.id ? 'text-white' : 'text-white/80'
                              }`}>
                                {model.name}
                              </span>
                              {model.isNew && (
                                <span className="px-1.5 py-0.5 text-[10px] bg-[#222224] text-white/50 rounded border border-[#3a3a3d]">
                                  NEW
                                </span>
                              )}
                              {model.isBeta && (
                                <span className="px-1.5 py-0.5 text-[10px] bg-[#222224] text-white/50 rounded border border-[#3a3a3d]">
                                  BETA
                                </span>
                              )}
                            </div>
                          </div>

                          <p className={`text-xs leading-relaxed transition-colors ${
                            selectedModel === model.id ? 'text-white/60' : 'text-white/40'
                          }`}>
                            {model.description}
                          </p>
                          
                          {/* Model-specific details - Right aligned */}
                          <div className="flex items-center justify-end gap-3 text-xs">
                            {/* Image-specific format info */}
                            <span className={`transition-colors ${
                              selectedModel === model.id ? 'text-white/60' : 'text-white/50'
                            }`}>
                              PNG/JPG
                            </span>
                            {/* Credit estimation based on model */}
                            {model.id.includes('imagen') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-purple-300' : 'text-purple-400/80'
                              }`}>
                                • Premium • ~80 credits
                              </span>
                            )}
                            {model.id.includes('stable-diffusion') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-sky-300' : 'text-sky-400/80'
                              }`}>
                                • Versatile • ~60 credits
                              </span>
                            )}
                            {model.id.includes('flux') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-green-300' : 'text-green-400/80'
                              }`}>
                                • Advanced • ~90 credits
                              </span>
                            )}
                            {model.id.includes('luma') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-amber-300' : 'text-amber-400/80'
                              }`}>
                                • Photorealistic • ~70 credits
                              </span>
                            )}
                            {model.id.includes('recraft') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-rose-300' : 'text-rose-400/80'
                              }`}>
                                • Design • ~65 credits
                              </span>
                            )}
                            {model.id.includes('ideogram') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-indigo-300' : 'text-indigo-400/80'
                              }`}>
                                • Creative • ~75 credits
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// --- Clean Interface Component (from Gallery file) ---
const CleanInterface: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loadedModelFamilies, setLoadedModelFamilies] = useState<ModelFamily[]>([]); // Use shared interface
  const [selectedModel, setSelectedModel] = useState<string>('fal-ai/imagen4/preview'); // Default to Google Imagen 4
  const [aspectRatio, setAspectRatio] = useState({ width: 1024, height: 1024 });
  const settingsRef = useRef<HTMLDivElement>(null);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const [modelSelectorPosition, setModelSelectorPosition] = useState({ top: 0, left: 0, width: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image upload state
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [showImageUpload, setShowImageUpload] = useState(false); // Keep this state local to CleanInterface

  const cleanAspectRatios = [ // Renamed to avoid conflict with Full interface
    { name: 'Square', width: 1024, height: 1024, ratio: '1:1' },
    { name: 'Portrait', width: 832, height: 1216, ratio: '2:3' },
    { name: 'Landscape', width: 1216, height: 832, ratio: '3:2' },
    { name: 'Widescreen', width: 1152, height: 896, ratio: '16:9' },
  ];

  // Load models specific to Clean Interface (can reuse shared modelFamilies if needed)
  useEffect(() => {
    const loadModels = () => {
      const registry = imageGenerationService.modelRegistry;
      const falModels: SubModel[] = []; // Use shared SubModel interface

      Object.keys(registry).forEach(modelId => {
        const modelDef = registry[modelId];
        if (modelDef.provider === 'fal') {
          let simpleName = modelId.split('/').pop() || modelId;
          simpleName = simpleName.replace('stable-diffusion-', '').replace('-', ' ');

          falModels.push({
            id: modelId,
            name: simpleName,
            description: modelDef.schema?.info?.description || modelDef.schema?.description || 'Fal.ai Model',
            supportsImageUpload: modelDef.isImageToImage || false,
            // Assume isNew/isBeta are defined in the registry or omit them
          });
        }
        // Add other providers if needed
      });

      const families: ModelFamily[] = []; // Use shared ModelFamily interface
      if (falModels.length > 0) {
        falModels.sort((a, b) => {
          if (a.id === 'fal-ai/stable-diffusion-v35-large') return -1;
          if (b.id === 'fal-ai/stable-diffusion-v35-large') return 1;
          return a.name.localeCompare(b.name);
        });

        families.push({
          id: 'fal-stable-diffusion',
          name: 'Stable Diffusion (Fal.ai)',
          icon: <div className="mr-2 rounded-full bg-white/10 p-1"><Image size={16} className="text-sky-400" /></div>,
          description: 'Fal.ai hosted Stable Diffusion models',
          submodels: falModels
        });
      }
      // Add other families

      setLoadedModelFamilies(families); // Use state specific to CleanInterface

      const firstValidModelId = families[0]?.submodels[0]?.id;
      if (firstValidModelId && (!selectedModel || !registry[selectedModel])) {
        setSelectedModel(firstValidModelId); // Use state specific to CleanInterface
      }
    };
    loadModels();
  }, [selectedModel]); // Re-run if selectedModel changes externally? Maybe just once on mount []?

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node) && modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node) && modelButtonRef.current && !modelButtonRef.current.contains(event.target as Node)) {
        setShowSettings(false); // Use state specific to CleanInterface
      }

      if (modelSelectorOpen && modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node) && modelButtonRef.current && !modelButtonRef.current.contains(event.target as Node)) {
        setModelSelectorOpen(false); // Use state specific to CleanInterface
        setSelectedFamilyId(null); // Use state specific to CleanInterface
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [modelSelectorOpen]); // Dependency on state specific to CleanInterface

  const getSelectedModelInfo = () => {
    if (!loadedModelFamilies || loadedModelFamilies.length === 0) { // Use state specific to CleanInterface
      return { familyName: 'Loading...', modelName: '', familyIcon: null };
    }
    for (const family of loadedModelFamilies) { // Use state specific to CleanInterface
      for (const model of family.submodels) {
        if (model.id === selectedModel) { // Use state specific to CleanInterface
          return {
            familyName: family.name,
            modelName: model.name,
            familyIcon: family.icon,
            isNew: model.isNew,
            isBeta: model.isBeta
          };
        }
      }
    }
    return { familyName: 'Unknown', modelName: 'Unknown', familyIcon: null };
  };

  const selectedModelInfo = getSelectedModelInfo();

  const supportsDirectImageUpload = () => {
    const currentModel = selectedModel; // Use state specific to CleanInterface

    for (const family of loadedModelFamilies) { // Use state specific to CleanInterface
      for (const submodel of family.submodels) {
        if (submodel.id === currentModel && submodel.supportsImageUpload) {
          return true;
        }
      }
    }
    return false;
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    console.log("File selected:", file.name);
    setIsGenerating(true); // Use state specific to CleanInterface
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const dataUrl = event.target?.result as string;
        setInputImage(dataUrl); // Use state specific to CleanInterface
        setShowImageUpload(true); // Use state specific to CleanInterface
      } catch (error) {
        console.error("Error processing image:", error);
      } finally {
        setIsGenerating(false); // Use state specific to CleanInterface
      }
    };
    reader.onerror = () => {
      console.error("Error reading file");
      setIsGenerating(false); // Use state specific to CleanInterface
    };
    reader.readAsDataURL(file);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const removeUploadedImage = () => {
    setInputImage(null); // Use state specific to CleanInterface
    setShowImageUpload(false); // Use state specific to CleanInterface
    setInputValue(''); // Use state specific to CleanInterface
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!inputValue.trim() && !inputImage) { // Use state specific to CleanInterface
      console.warn("Prompt or input image required.");
      return;
    }

    const modelDefinition = imageGenerationService.modelRegistry[selectedModel]; // Use state specific to CleanInterface
    if (!modelDefinition) {
      console.error(`Model definition not found for ${selectedModel}`); // Use state specific to CleanInterface
      return;
    }

    setIsGenerating(true); // Use state specific to CleanInterface

    // Ensure GeneratedImage interface is available or defined
    const settings: ImageModelSettings = {
      prompt: inputValue.trim(), // Use state specific to CleanInterface
      width: aspectRatio.width, // Use state specific to CleanInterface
      height: aspectRatio.height, // Use state specific to CleanInterface
      // Add other common settings if needed
    };

    // Add image_url only if model supports it and an image is uploaded
    if (modelDefinition.isImageToImage && inputImage) { // Use state specific to CleanInterface
      settings.image_url = inputImage; // Use state specific to CleanInterface
    }

    console.log(`Generating with model: ${selectedModel}`, settings); // Use state specific to CleanInterface

    try {
      const response = await imageGenerationService.generateImage(selectedModel, settings); // Use state specific to CleanInterface

      if (response.success && response.images && response.images.length > 0) {
        console.log("Generation successful:", response.images);
        response.images.forEach((image: GeneratedImage, index: number) => { // Added types
          // Dispatch the global event to update the gallery/history in the parent wrapper
          document.dispatchEvent(new CustomEvent(IMAGE_GENERATED_EVENT, {
            detail: {
              id: `gen_${Date.now()}_${index}`,
              url: image.url,
              prompt: settings.prompt,
              model: selectedModel, // Use state specific to CleanInterface
              settings: { ...settings, seed: image.seed },
              metadata: {
                generationTime: response.metadata?.generationTime,
                latency: image.latency,
                // Add other metadata
              }
            }
          }));
        });

        setInputValue(''); // Use state specific to CleanInterface
        // removeUploadedImage(); // Optional: Keep image for img2img flow
      } else {
        console.error("Generation failed:", response.error);
        // TODO: Show error notification
      }
    } catch (error) {
      console.error("Error calling generation service:", error);
      // TODO: Show error notification
    } finally {
      setIsGenerating(false); // Use state specific to CleanInterface
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const toggleSettings = () => {
    setShowSettings(prev => !prev); // Use state specific to CleanInterface
    setModelSelectorOpen(false); // Use state specific to CleanInterface
    setSelectedFamilyId(null); // Use state specific to CleanInterface
  };

  const toggleModelSelector = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (modelButtonRef.current) {
      const rect = modelButtonRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const left = Math.min(rect.left + window.scrollX, viewportWidth - rect.width - 20);
      setModelSelectorPosition({
        top: rect.bottom + window.scrollY + 8,
        left: left,
        width: Math.max(rect.width, 300)
      }); // Use state specific to CleanInterface
    }
    setModelSelectorOpen(prev => !prev); // Use state specific to CleanInterface
    setSelectedFamilyId(null); // Use state specific to CleanInterface
  };

  const selectFamily = (familyId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFamilyId(familyId === selectedFamilyId ? null : familyId); // Use state specific to CleanInterface
  };

  const selectModel = (modelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedModel(modelId); // Use state specific to CleanInterface
    setModelSelectorOpen(false); // Use state specific to CleanInterface
    setSelectedFamilyId(null); // Use state specific to CleanInterface
  };

  const getAspectRatioText = () => {
    const found = cleanAspectRatios.find(ar => ar.width === aspectRatio.width && ar.height === aspectRatio.height); // Use state specific to CleanInterface
    return found ? found.ratio : `${aspectRatio.width}:${aspectRatio.height}`; // Use state specific to CleanInterface
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* Input Bar at the Top */}
      <div className="w-full pb-0 pt-0">
        <div className="bg-[rgba(20,20,20,0.85)] border border-white/10 rounded-xl shadow-xl overflow-hidden">
          <div className="relative">
            <div className="relative flex flex-col">
              <div className="relative flex items-center">
                {/* Hidden File Input */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  className="hidden"
                  accept="image/*"
                />
                {/* Image Upload Button / Preview */}
                {inputImage ? (
                  <div className="absolute left-3 top-3 flex items-center group">
                    <div
                      onClick={triggerFileInput}
                      className="w-8 h-8 rounded overflow-hidden border border-white/20 cursor-pointer hover:opacity-80 transition-opacity relative"
                      title="Change image"
                    >
                      <img src={inputImage} alt="Uploaded" className="w-full h-full object-cover" />
                    </div>
                    <div
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-black/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/95 transition-opacity z-20 cursor-pointer"
                      onClick={removeUploadedImage}
                      title="Remove image"
                    >
                      <X size={8} className="text-white" />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={triggerFileInput}
                    className={`absolute left-3 top-3 w-8 h-8 rounded flex items-center justify-center transition-all duration-300 ${
                      isGenerating || !supportsDirectImageUpload()
                        ? 'opacity-50 cursor-not-allowed'
                        : 'bg-white/10 text-white/70 hover:bg-white/15 hover:text-white'
                    }`}
                    disabled={isGenerating || !supportsDirectImageUpload()}
                    title={supportsDirectImageUpload() ? "Upload image" : "Image upload not supported by this model"}
                  >
                    <Image size={18} />
                  </button>
                )}
                {/* Prompt Textarea */}
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={isGenerating ? "Generating..." : `Describe what you want to see...${inputImage ? " (using uploaded image)" : ""}`}
                  className="w-full bg-black/30 py-4 px-5 pl-14 pr-14 text-white placeholder-white/40 focus:outline-none resize-none h-14 overflow-hidden"
                  disabled={isGenerating}
                  onKeyDown={handleKeyDown}
                  rows={3} // Adjust rows as needed
                />
                {/* Settings Button */}
                <button
                  onClick={toggleSettings}
                  className={`absolute right-3 top-3 w-8 h-8 rounded flex items-center justify-center transition-all duration-300 ${
                    showSettings
                      ? 'bg-white/20 text-white'
                      : 'bg-white/10 text-white/70 hover:bg-white/15 hover:text-white'
                  }`}
                  title="Generation settings"
                >
                   <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-sliders">
                    <line x1="4" x2="4" y1="21" y2="14"></line>
                    <line x1="4" x2="4" y1="10" y2="3"></line>
                    <line x1="12" x2="12" y1="21" y2="12"></line>
                    <line x1="12" x2="12" y1="8" y2="3"></line>
                    <line x1="20" x2="20" y1="21" y2="16"></line>
                    <line x1="20" x2="20" y1="12" y2="3"></line>
                    <line x1="1" x2="7" y1="14" y2="14"></line>
                    <line x1="9" x2="15" y1="8" y2="8"></line>
                    <line x1="17" x2="23" y2="16" y1="16"></line>
                  </svg>
                </button>
                {/* Generating Spinner */}
                {isGenerating && (
                  <div className="absolute right-14 top-3 flex items-center justify-center w-8 h-8">
                    <svg className="animate-spin h-5 w-5 text-white/70" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div
          ref={settingsRef}
          className="mt-1 bg-[rgba(15,15,15,0.95)] border border-white/10 overflow-hidden transition-all duration-300 mx-auto w-full rounded-xl shadow-2xl z-10 backdrop-blur-sm"
          style={{ maxHeight: showSettings ? '500px' : '0' }}
        >
          <div className="p-5">
            <div className="space-y-5">
              {/* Aspect Ratio */}
              <div className="space-y-2">
                <div className="flex justify-between items-center mb-1">
                  <label className="text-white/70 text-xs font-medium">Aspect Ratio</label>
                  <span className="text-white/60 text-xs">{getAspectRatioText()}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {cleanAspectRatios.map((ar) => (
                    <button
                      key={ar.name}
                      onClick={() => setAspectRatio({ width: ar.width, height: ar.height })}
                      className={`px-2 py-1.5 text-xs rounded ${
                        ar.width === aspectRatio.width && ar.height === aspectRatio.height
                          ? 'bg-white/20 text-white'
                          : 'bg-black/30 text-white/60 hover:bg-black/40 hover:text-white/80'
                      }`}
                    >
                      {ar.name}
                    </button>
                  ))}
                </div>
              </div>
              {/* Model Selector Button */}
              <div className="space-y-2">
                <div className="flex justify-between items-center mb-1">
                  <label className="text-white/70 text-xs font-medium">Model</label>
                </div>
                <div className="relative">
                  <button
                    ref={modelButtonRef}
                    onClick={toggleModelSelector}
                    className="w-full flex items-center justify-between bg-black/20 border border-white/10 rounded-lg p-3 text-white hover:bg-black/30 transition-colors"
                  >
                    <div className="flex items-center">
                      {selectedModelInfo.familyIcon}
                      <div className="text-left">
                        <span className="block text-sm">{selectedModelInfo.familyName}</span>
                        <span className="block text-xs text-white/60">{selectedModelInfo.modelName}</span>
                      </div>
                    </div>
                    <ChevronDown size={16} className={`transition-transform duration-300 ${modelSelectorOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Model Selector Panel */}
      {modelSelectorOpen && (
        <div
          ref={modelSelectorRef}
          className="fixed bg-[rgba(10,10,10,0.98)] border border-white/10 rounded-lg overflow-hidden shadow-2xl z-50 backdrop-blur-sm"
          style={{
            top: `${modelSelectorPosition.top}px`,
            left: `${modelSelectorPosition.left}px`,
            width: `${modelSelectorPosition.width}px`,
            maxHeight: '80vh'
          }}
        >
          <div className="max-h-[70vh] overflow-y-auto py-2">
            {loadedModelFamilies.map(family => (
              <div key={family.id} className="border-b border-white/5 last:border-b-0">
                <button
                  onClick={(e) => selectFamily(family.id, e)}
                  className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center">
                    {family.icon}
                    <div>
                      <div className="text-sm font-medium text-white flex items-center gap-2">
                        {family.name}
                        {family.isNew && <span className="text-[10px] font-semibold bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">New</span>}
                        {family.isBeta && <span className="text-[10px] font-semibold bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Beta</span>}
                      </div>
                      <div className="text-xs text-white/60">{family.description}</div>
                    </div>
                  </div>
                  {family.submodels.length > 0 && (
                    <div className={`transition-transform duration-300 ${selectedFamilyId === family.id ? 'rotate-90' : ''}`}>
                      <ChevronRight size={16} />
                    </div>
                  )}
                </button>
                {selectedFamilyId === family.id && (
                  <div className="bg-black/30 border-t border-white/5">
                    {family.submodels.map((model, index, array) => (
                      <button
                        key={model.id}
                        onClick={(e) => selectModel(model.id, e)}
                        className={`w-full text-left px-4 py-2.5 flex items-center justify-between ${selectedModel === model.id ? 'bg-white/10' : 'hover:bg-white/5'} transition-colors ${
                          index < array.length - 1 ? 'mb-1' : ''
                        }`}
                      >
                        <div>
                          <div className="text-sm font-medium text-white flex items-center gap-2">
                            {model.name}
                            {model.isNew && <span className="text-[10px] font-semibold bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">New</span>}
                            {model.isBeta && <span className="text-[10px] font-semibold bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Beta</span>}
                          </div>
                          <div className="text-xs text-white/60">{model.description}</div>
                        </div>
                        {selectedModel === model.id && <div className="h-3 w-3 rounded-full bg-white"></div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- Full Image Generation Interface --- (Renamed from original ImageGenerationInterface)
const FullImageGenerationInterface: React.FC = () => {
  const [prompt, setPrompt] = useState<string>('');
  const [negativePrompt, setNegativePrompt] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isProcessingImage, setIsProcessingImage] = useState<boolean>(false); // New state for image processing
  const [history, setHistory] = useState<Array<{ id: string; image: string; prompt: string; timestamp: Date; metadata?: any }>>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [imageHistoryOpen, setImageHistoryOpen] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  // Model settings
  const [selectedModel, setSelectedModel] = useState<string>('fal-ai/imagen4/preview'); // Default to Google Imagen 4
  const [width, setWidth] = useState<number>(1024);
  const [height, setHeight] = useState<number>(1024);
  const [steps, setSteps] = useState<number>(30);
  const [guidance, setGuidance] = useState<number>(7.5);
  const [stylePreset, setStylePreset] = useState<string | null>(null);

  // Number of generations to create
  const [numGenerations, setNumGenerations] = useState<number>(1);

  // Quality setting (SD, HD, 4K)
  const [quality, setQuality] = useState<'SD' | 'HD' | '4K'>('HD');

  // State for zoom and pan functionality - now using maps for multiple images
  const [zoomLevels, setZoomLevels] = useState<{[key: string]: number}>({});
  const [panXValues, setPanXValues] = useState<{[key: string]: number}>({});
  const [panYValues, setPanYValues] = useState<{[key: string]: number}>({});
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; imgKey: string } | null>(null);
  const imageContainerRefs = useRef<{[key: string]: HTMLDivElement | null}>({}); // Ref for image containers

  // Initialize zoom and pan for new images
  useEffect(() => {
    // Initialize values for each preview image
    const newZoomLevels: {[key: string]: number} = {};
    const newPanXValues: {[key: string]: number} = {};
    const newPanYValues: {[key: string]: number} = {};

    previewImages.forEach((img, index) => {
      const imgKey = `img-${index}`;
      if (zoomLevels[imgKey] === undefined) {
        newZoomLevels[imgKey] = 0.8; // Default 80% zoom
        newPanXValues[imgKey] = 0;
        newPanYValues[imgKey] = 0;
      }
    });

    // Update state with new values
    setZoomLevels(prev => ({ ...prev, ...newZoomLevels }));
    setPanXValues(prev => ({ ...prev, ...newPanXValues }));
    setPanYValues(prev => ({ ...prev, ...newPanYValues }));
  }, [previewImages]);

  // --- Zoom/Pan Logic (adapted from ImageUpscaleInterface) ---
  const resetZoomPan = (imgKey: string) => {
    setZoomLevels(prev => ({ ...prev, [imgKey]: 0.8 })); // Default zoom 0.8
    setPanXValues(prev => ({ ...prev, [imgKey]: 0 }));
    setPanYValues(prev => ({ ...prev, [imgKey]: 0 }));
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>, imgKey: string) => {
    e.preventDefault();
    const scaleAmount = -e.deltaY * 0.005; // Adjust sensitivity
    setZoomLevels(prev => ({
      ...prev,
      [imgKey]: Math.max(0.1, Math.min((prev[imgKey] || 1) + scaleAmount, 10))
    }));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLImageElement>, imgKey: string) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ 
      x: e.clientX - (panXValues[imgKey] || 0), 
      y: e.clientY - (panYValues[imgKey] || 0), 
      imgKey 
    });
    (e.target as HTMLImageElement).style.cursor = 'grabbing';
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart) return;
    e.preventDefault();
    const { imgKey } = dragStart;
    setPanXValues(prev => ({ ...prev, [imgKey]: e.clientX - dragStart.x }));
    setPanYValues(prev => ({ ...prev, [imgKey]: e.clientY - dragStart.y }));
  };

  const handleMouseUpOrLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging && dragStart) {
      setIsDragging(false);
      // Find the image element within the container that triggered the event
      const container = e.currentTarget;
      const imgElement = container.querySelector('img');
      if (imgElement) {
        imgElement.style.cursor = 'grab';
      }
      setDragStart(null); // Clear drag start info
    }
  };

  // Backwards compatibility for single image selection
  useEffect(() => {
    if (selectedImage && !previewImages.includes(selectedImage)) {
      setPreviewImages([selectedImage]);
    }
  }, [selectedImage]);

  // Flux model settings
  const [safetyTolerance, setSafetyTolerance] = useState(2);

  // Luma Photon reference image settings
  const [imageReferenceUrl, setImageReferenceUrl] = useState('');
  const [imageReferenceWeight, setImageReferenceWeight] = useState(0.85);
  const [styleReferenceUrl, setStyleReferenceUrl] = useState('');
  const [styleReferenceWeight, setStyleReferenceWeight] = useState(0.85);
  const [characterReferenceUrl, setCharacterReferenceUrl] = useState('');

  // Initialize token from URL if present
  React.useEffect(() => {
    // Check URL for token parameter
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('xeno_token');
    if (tokenFromUrl) {
      window.XENO_API_KEY = tokenFromUrl;
      // Update API_TOKENS object
      if (API_TOKENS) {
        API_TOKENS.XENO_API_KEY = tokenFromUrl;
      }
      // Remove token from URL to avoid exposing it
      const url = new URL(window.location.href);
      url.searchParams.delete('xeno_token');
      window.history.replaceState({}, document.title, url.toString());
    }

    // Check for Gemini API key
    const geminiTokenFromUrl = params.get('gemini_token');
    if (geminiTokenFromUrl) {
      window.GEMINI_API_KEY = geminiTokenFromUrl;
      // Update API_TOKENS object if it has a Gemini property
      if (API_TOKENS && 'GEMINI_API_KEY' in API_TOKENS) {
        API_TOKENS.GEMINI_API_KEY = geminiTokenFromUrl;
      }
      // Remove token from URL to avoid exposing it
      const url = new URL(window.location.href);
      url.searchParams.delete('gemini_token');
      window.history.replaceState({}, document.title, url.toString());
    }
  }, []);

  // Check for API token availability immediately on initial render
  React.useEffect(() => {
    // API is now proxied through backend - no client-side key needed
  }, []);

  // Load actual model data on component mount
  useEffect(() => {
    try {
      // const availableModels = imageGenerationService.getAvailableModels(); // Removed: This component uses its own modelFamilies
      // Set initial model settings from the default model
      const defaultSettings = imageGenerationService.getModelDefaults(selectedModel);
      if (defaultSettings) {
        if (defaultSettings.resolution) {
          const [w, h] = defaultSettings.resolution.split('x').map(Number);
          if (w && h) {
            setWidth(w);
            setHeight(h);
          }
        }
        if (defaultSettings.steps) setSteps(defaultSettings.steps);
        if (defaultSettings.guidance) setGuidance(defaultSettings.guidance);
        if (defaultSettings.style) setStylePreset(defaultSettings.style);
      }
    } catch (error) {
      console.error("Error initializing models:", error);
    }
  }, []);

  // Update settings when model changes
  useEffect(() => {
    try {
      const defaultSettings = imageGenerationService.getModelDefaults(selectedModel);
      if (defaultSettings) {
        if (defaultSettings.resolution) {
          const [w, h] = defaultSettings.resolution.split('x').map(Number);
          if (w && h) {
            setWidth(w);
            setHeight(h);
          }
        }
        if (defaultSettings.steps) setSteps(defaultSettings.steps);
        if (defaultSettings.guidance) setGuidance(defaultSettings.guidance);
        if (defaultSettings.style) setStylePreset(defaultSettings.style);
      }

      // Reset the prompt and negative prompt when model changes
      setPrompt('');
      setNegativePrompt('');

      // Also reset input image if there was one
      if (inputImage) {
        setInputImage(null);
        setShowImageUpload(false);
      }

    } catch (error) {
      console.error(`Error loading settings for model ${selectedModel}:`, error);
    }
  }, [selectedModel]);

  const aspectRatios = [
    { name: 'Square', width: 1024, height: 1024 },
    { name: 'Portrait', width: 832, height: 1216 },
    { name: 'Landscape', width: 1216, height: 832 },
  ];

  // Luma Photon supported aspect ratios
  const lumaPhotonAspectRatios = [
    { name: 'Square', width: 1024, height: 1024 }, // 1:1
    { name: 'Landscape', width: 1024, height: 768 }, // 4:3
    { name: 'Portrait', width: 768, height: 1024 }, // 3:4
    { name: 'Widescreen', width: 1024, height: 576 }, // 16:9
    { name: 'Vertical', width: 576, height: 1024 }, // 9:16
    { name: 'Ultra Wide', width: 1024, height: 488 }, // 21:9
    { name: 'Ultra Tall', width: 488, height: 1024 }, // 9:21
  ];

  // Recraft V3 supported aspect ratios
  const recraftV3AspectRatios = [
    { name: 'Square HD', width: 1024, height: 1024 }, // square_hd
    { name: 'Square', width: 512, height: 512 }, // square
    { name: 'Portrait 4:3', width: 768, height: 1024 }, // portrait_4_3
    { name: 'Portrait 16:9', width: 576, height: 1024 }, // portrait_16_9
    { name: 'Landscape 4:3', width: 1024, height: 768 }, // landscape_4_3
    { name: 'Landscape 16:9', width: 1024, height: 576 }, // landscape_16_9
  ];

  // Flux model supported aspect ratios
  const fluxAspectRatios = [
    { name: 'Square', width: 1024, height: 1024 },
    { name: 'Portrait', width: 832, height: 1216 },
    { name: 'Landscape', width: 1216, height: 832 },
    { name: 'Widescreen', width: 1152, height: 896 },
    { name: 'Tall', width: 768, height: 1344 },
    { name: 'Wide', width: 1344, height: 768 }
  ];

  // Google Imagen supported aspect ratios
  const googleImagenAspectRatios = [
    { name: 'Square', width: 1024, height: 1024, ratio: '1:1' },
    { name: 'Landscape', width: 1216, height: 832, ratio: '16:9' },
    { name: 'Portrait', width: 832, height: 1216, ratio: '9:16' },
    { name: 'Wide', width: 1024, height: 768, ratio: '4:3' },
    { name: 'Tall', width: 768, height: 1024, ratio: '3:4' }
  ];

  // Ideogram V3 supported aspect ratios (same as Recraft V3)
  const ideogramV3AspectRatios = [
    { name: 'Square HD', width: 1024, height: 1024 }, // square_hd
    { name: 'Square', width: 512, height: 512 }, // square
    { name: 'Portrait 4:3', width: 768, height: 1024 }, // portrait_4_3
    { name: 'Portrait 16:9', width: 576, height: 1024 }, // portrait_16_9
    { name: 'Landscape 4:3', width: 1024, height: 768 }, // landscape_4_3
    { name: 'Landscape 16:9', width: 1024, height: 576 }, // landscape_16_9
  ];

  // Ideogram V2a Turbo supported aspect ratios
  const ideogramV2aAspectRatios = [
    { name: 'Square', width: 1024, height: 1024 }, // 1:1
    { name: 'Portrait 3:4', width: 768, height: 1024 }, // 3:4
    { name: 'Landscape 4:3', width: 1024, height: 768 }, // 4:3
    { name: 'Portrait 9:16', width: 576, height: 1024 }, // 9:16
    { name: 'Landscape 16:9', width: 1024, height: 576 }, // 16:9
    { name: 'Portrait 10:16', width: 640, height: 1024 }, // 10:16
    { name: 'Landscape 16:10', width: 1024, height: 640 }, // 16:10
    { name: 'Ultra Portrait', width: 341, height: 1024 }, // 1:3
    { name: 'Ultra Landscape', width: 1024, height: 341 }, // 3:1
    { name: 'Portrait 2:3', width: 683, height: 1024 }, // 2:3
    { name: 'Landscape 3:2', width: 1024, height: 683 }, // 3:2
  ];

  const stylePresets = [
    'Cinematic', 'Digital Art', 'Photographic', 'Pixel Art', 'Anime',
    'Oil Painting', 'Watercolor', 'Pastel', 'Sketch', 'Realistic'
  ];

  // Check if the current model is a Flux model
  const isFluxModel = () => {
    return isFluxDev() || isFluxProV11Ultra();
  };

  // Check if the current model is Flux Dev
  const isFluxDev = () => {
    return selectedModel === 'fal-ai/flux/dev';
  };

  // Check if the current model is Flux Pro v1.1-Ultra
  const isFluxProV11Ultra = () => {
    return selectedModel === 'fal-ai/flux-pro/v1.1-ultra';
  };

  // Check if the current model is Google Imagen
  const isGoogleImagen = () => {
    return selectedModel === 'fal-ai/imagen3' || selectedModel === 'fal-ai/imagen4/preview';
  };

  // Check if the current model is Luma Photon
  const isLumaPhoton = () => {
    return selectedModel === 'fal-ai/luma-photon/flash';
  };

  // Check if the current model is Recraft V3
  const isRecraftV3 = () => {
    return selectedModel === 'fal-ai/recraft/v3/text-to-image';
  };

  // Check if the current model is Recraft V3 SVG
  const isRecraftV3SVG = () => {
    return selectedModel === 'recraft-v3-svg';
  };

  // Check if the current model is Stable Diffusion v3 Medium
  const isStableDiffusionV3Medium = () => {
    return selectedModel === 'fal-ai/stable-diffusion-v3-medium';
  };

  // Check if the current model is Stable Diffusion v3.5 Large
  const isStableDiffusionV35Large = () => {
    return selectedModel === 'fal-ai/stable-diffusion-v35-large';
  };

  // Check if the current model is any Stable Diffusion model
  const isStableDiffusion = () => {
    return isStableDiffusionV3Medium() || isStableDiffusionV35Large();
  };

  // Check if the model uses reference images
  const supportsReferenceImages = () => {
    return isLumaPhoton();
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      notifications.error('Please enter a prompt');
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);
    setErrorDetails(null);

    try {
      // Prepare settings for the current model
      const settings: ImageModelSettings = {
        width: width,
        height: height,
        num_inference_steps: steps,
        guidance_scale: guidance,
        // seed: seed >= 0 ? seed : Math.floor(Math.random() * 1000000), // Removed seed from settings
        // style: stylePreset.toLowerCase(), // Style handling might differ per model/provider
        num_outputs: numGenerations // Use num_outputs for Fal standard
      };

      // For Google Imagen models, add aspect_ratio instead of width/height
      if (isGoogleImagen()) {
        // Convert current width/height to aspect ratio format
        const aspectRatio = getAspectRatioFromDimensions(width, height);
        settings.aspect_ratio = aspectRatio;
        
        // Remove width/height for Imagen models as they use aspect_ratio
        delete settings.width;
        delete settings.height;
        delete settings.num_inference_steps; // Imagen doesn't use inference steps
        delete settings.guidance_scale; // Imagen doesn't use guidance scale
        
        // Use num_images instead of num_outputs for Imagen
        settings.num_images = numGenerations;
        delete settings.num_outputs;
      }

      // For non-Flux models, we include negative prompt in settings
      if (!isFluxModel() && !isRecraftV3() && !isRecraftV3SVG() && !isLumaPhoton() && negativePrompt) {
        // Only add negative prompt for Imagen 3, not Imagen 4
        if (isGoogleImagen() && selectedModel === 'fal-ai/imagen3') {
          settings.negative_prompt = negativePrompt;
        } else if (!isGoogleImagen()) {
          settings.negative_prompt = negativePrompt; // Use snake_case
        }
      }

      // Add flux-specific settings if we're using a Flux model
      if (isFluxModel()) {
        // Add safety tolerance for Flux models
        settings.safety_tolerance = safetyTolerance;
      }

      // Add Recraft V3 specific settings
      if (isRecraftV3() || isRecraftV3SVG()) {
        // Set the style option for Recraft V3
        settings.style = stylePreset || 'any';
        // Use resolution as 'size' parameter
        settings.size = `${width}x${height}`;
      }

      // Add Luma Photon specific settings
      if (isLumaPhoton()) {
        // Add reference image URLs if available
        if (imageReferenceUrl) {
          settings.imageReferenceUrl = imageReferenceUrl;
          settings.imageReferenceWeight = imageReferenceWeight;
        }

        if (styleReferenceUrl) {
          settings.styleReferenceUrl = styleReferenceUrl;
          settings.styleReferenceWeight = styleReferenceWeight;
        }

        if (characterReferenceUrl) {
          settings.characterReferenceUrl = characterReferenceUrl;
        }
      }

      // Add support for image upload in supported models
      if (inputImage && supportsDirectImageUpload()) {
        settings.image_url = inputImage; // Use image_url for Fal standard if it's a URL/base64
      }

      // Detailed logging
      console.groupCollapsed(`[ImageGen] Request - ${selectedModel}`);
      console.log(`Prompt:`, prompt);
      if (settings.negative_prompt) {
        console.log(`Negative Prompt:`, settings.negative_prompt);
      }
      console.log(`Model:`, selectedModel);
      console.log(`Dimensions:`, `${settings.width}x${settings.height}`);
      console.log(`Steps:`, settings.num_inference_steps);
      console.log(`Guidance (CFG):`, settings.guidance_scale);
      // console.log(`Seed:`, settings.seed);
      console.log(`Num Outputs:`, settings.num_outputs);
      if (stylePreset) {
        console.log(`Style Preset:`, stylePreset);
      }
      if (settings.image_url) {
        console.log(`Input Image Provided:`, true);
      }
      console.log(`Full Settings Payload:`, settings);
      console.groupEnd();

      // Generate image
      const result = await imageGenerationService.generateImage(
        selectedModel,
        { // Pass prompt and other settings within the settings object
          ...settings,
          prompt: prompt,
          // Input image handling might need refinement based on service implementation
          // image_url is already added above if applicable
        }
      );

      console.log('Generation result:', result);

      if (result.success && result.images && result.images.length > 0) {
        // DISPATCH EVENT instead of setting history directly
        setIsLoading(true);
        setGenerationError(null);

        const allImageUrls: string[] = []; // Explicit type

        result.images.forEach((image: GeneratedImage, index: number) => { // Added types
          const detail = {
            id: `gen_${Date.now()}_${index}`,
            url: image.url,
            prompt: settings.prompt, // Use the main prompt state
          model: selectedModel,
            settings: { // Include relevant settings
              ...settings, // Spread the settings used for generation
              negative_prompt: negativePrompt, // Keep negative prompt
              seed: image.seed, // Use the seed from the response
            },
            metadata: {
              generationTime: result.metadata?.generationTime,
              latency: image.latency,
              has_nsfw_concept: image.has_nsfw_concept,
              // Add other metadata if needed
            }
          };
          // Dispatch the event
          document.dispatchEvent(new CustomEvent(IMAGE_GENERATED_EVENT, { detail }));
          allImageUrls.push(image.url); // Collect URL for preview update
        });

        // Update preview area
        if (allImageUrls.length > 0) {
          preloadImage(allImageUrls[0])
          .then(url => {
              setSelectedImage(url); // Select the first image
              setPreviewImages(allImageUrls); // Show all generated images
          })
          .catch(err => {
            console.error('Failed to preload image:', err);
              setSelectedImage(allImageUrls[0]); // Fallback
              setPreviewImages(allImageUrls);
            })
            .finally(() => {
            setIsLoading(false);
          });
        } else {
           setIsLoading(false);
        }

        notifications.success('Image(s) generated successfully');

        // Clear prompt? Optional, based on desired UX
        // setPrompt('');
        // setNegativePrompt('');

      } else {
        // Handle failure (already done in original code)
        console.error('Generation failed:', result.error);
        setGenerationError(result.error || 'Generation failed');
        setErrorDetails(''); // Clear previous details or add from result if available
        notifications.error(`Error: ${result.error || 'Generation failed'}`);
         setIsLoading(false); // Ensure loading stops on failure
      }

    } catch (error) {
      console.error('Error generating image:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : '';

      setGenerationError(errorMessage);
      setErrorDetails(errorStack || '');

      notifications.error(`Error: ${errorMessage}`);
    } finally {
      setIsGenerating(false);

      // Clear the input image after generation if using Gemini (don't clear for models that directly use the uploaded image)
      if (isGemini() && !supportsDirectImageUpload() && inputImage) {
        setInputImage(null);
        setShowImageUpload(false);
      }
    }
  };

  // Image preloading function to make UI updates faster
  const preloadImage = (url: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        console.log('Image preloaded successfully:', url);
        resolve(url);
      };
      img.onerror = () => {
        console.error('Error preloading image:', url);
        reject(new Error(`Failed to load image: ${url}`));
      };
      img.src = url;
    });
  };

  // Improved selected image effect with preloading
  useEffect(() => {
    if (selectedImage) {
      console.log('Selected image updated in effect:', selectedImage);
    }
  }, [selectedImage]);

  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear your generation history?')) {
      setHistory([]);
      setSelectedImage(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleGenerate();
    }
  };

  const handleAspectRatioChange = (width: number, height: number) => {
    setWidth(width);
    setHeight(height);
  };

  // Handle number of generations change
  const increaseGenerations = () => {
    if (numGenerations < 4) {
      setNumGenerations(numGenerations + 1);
    }
  };

  const decreaseGenerations = () => {
    if (numGenerations > 1) {
      setNumGenerations(numGenerations - 1);
    }
  };

  const handleAddStyleToPrompt = (style: string) => {
    setPrompt(prev => {
      const trimmed = prev.trim();
      return trimmed ? `${trimmed}, ${style.toLowerCase()} style` : `${style.toLowerCase()} style`;
    });
  };

  // Add this useEffect to log when the selected image changes
  useEffect(() => {
    if (selectedImage) {
      console.log('Selected image updated:', selectedImage);
    }
  }, [selectedImage]);

  // Add these new state variables
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptTheme, setPromptTheme] = useState('');
  const [showPromptThemeInput, setShowPromptThemeInput] = useState(false);
  const [promptGenerationSuccess, setPromptGenerationSuccess] = useState(false);

  // Add this new function for handling prompt generation
  const handleGeneratePrompt = async () => {
    if (isGeneratingPrompt) return;

    setIsGeneratingPrompt(true);
    setPromptGenerationSuccess(false);

    try {
      if (isFluxModel()) {
        // Flux-specific prompt generation using best practices
        const baseTheme = promptTheme || getRandomFluxTheme();

        // Generate components for a well-structured Flux prompt

        // Artistic style - Flux defaults to realism if not specified
        const styles = [
          "photorealistic", "digital art", "cinematic", "portrait photography", 
          "oil painting", "watercolor", "concept art", "3D rendering",
          "fantasy illustration", "anime", "comic book", "impressionist",
          "surrealist", "hyperrealistic", "moody", "bright", "tonal",
          "expressive", "balanced", "harmonious", "experimental", "precise"
        ];
        const style = styles[Math.floor(Math.random() * styles.length)];

        // Camera and lens details for photorealistic outputs
        const cameras = ["Canon EOS R5", "Sony A7R IV", "Nikon Z9", "Hasselblad X2D", "Leica M11"];
        const lenses = ["24mm wide-angle", "35mm prime", "50mm f/1.4", "85mm portrait", "135mm telephoto"];
        const camera = cameras[Math.floor(Math.random() * cameras.length)];
        const lens = lenses[Math.floor(Math.random() * lenses.length)];

        // Generate high-quality descriptors
        const adjectives = [getRandomAdjective(), getRandomAdjective()];
        const composition = getRandomComposition();
        const lighting = getRandomLighting();
        const mood = getRandomMood();
        const detail = getRandomElement();

        // Generate negative elements to avoid (without using a negative prompt, which Flux doesn't support)
        const negativeElements = [
          getRandomNegativeElement(), 
          getRandomNegativeElement(), 
          getRandomNegativeElement()
        ];

        // Build a structured prompt optimized for Flux models
        let fluxPrompt = `${baseTheme}, ${style}`;

        // Add adjectives
        fluxPrompt += `, ${adjectives.join(", ")}`;

        // Add composition and lighting details
        fluxPrompt += `, ${composition}, ${lighting}, ${mood}`;

        // Add camera details for photorealistic images
        if (style === "photorealistic" || style === "portrait photography" || style.includes("photo")) {
          fluxPrompt += `, shot on ${camera} with ${lens}`;
        }

        // Add positive detail elements
        fluxPrompt += `, with ${detail}`;

        // Add "no" elements directly in the positive prompt since Flux doesn't use negative prompts
        fluxPrompt += `, no ${negativeElements.join(", no ")}`;

        // Set the generated prompt
        setPrompt(fluxPrompt);

        // Show success message briefly
        setPromptGenerationSuccess(true);
      } 
      else if (isRecraftV3()) {
        // Recraft V3 specialized prompt generation
        const baseTheme = promptTheme || getRandomRecraftTheme();

        // Select a style based on the current stylePreset or randomly choose one
        let styleCategory = stylePreset || 'any';
        if (styleCategory === 'any') {
          const styleCategories = ['realistic_image', 'digital_illustration'];
          styleCategory = styleCategories[Math.floor(Math.random() * styleCategories.length)];
        }

        // Generate components for a well-structured Recraft V3 prompt
        const adjectives = [getRandomAdjective(), getRandomAdjective()];
        const composition = getRandomComposition();
        const detail = getRandomDetail();

        // Build the prompt
        let recraftPrompt = `${baseTheme}`;

        // Add style-specific details
        if (styleCategory.includes('realistic_image')) {
          const photographyStyles = [
            "professional photography", "high-resolution", "detailed", 
            "4K", "high-definition", "sharp focus", "studio lighting"
          ];
          const photoStyle = photographyStyles[Math.floor(Math.random() * photographyStyles.length)];
          recraftPrompt += `, ${photoStyle}, ${adjectives.join(", ")}, ${composition}, ${detail}`;
        } else {
          const illustrationStyles = [
            "vibrant colors", "detailed illustration", "professional design",
            "clean lines", "artistic", "creative", "stylized"
          ];
          const illoStyle = illustrationStyles[Math.floor(Math.random() * illustrationStyles.length)];
          recraftPrompt += `, ${illoStyle}, ${adjectives.join(", ")}, ${composition}, ${detail}`;
        }

        // Set the generated prompt
        setPrompt(recraftPrompt);

        // Show success message briefly
        setPromptGenerationSuccess(true);
      }
      else if (isLumaPhoton()) {
        // Luma Photon specialized prompt generation
        const baseTheme = promptTheme || getRandomLumaTheme();

        // Generate components for a well-structured Luma Photon prompt
        const styles = [
          "photorealistic", "cinematic", "portrait photography", 
          "atmospheric", "candid", "editorial", "commercial",
          "fashion", "documentary", "conceptual", "architectural",
          "product", "landscape", "lifestyle", "street"
        ];
        const style = styles[Math.floor(Math.random() * styles.length)];

        // Technical photography terms that Luma Photon responds well to
        const techniques = [
          "shallow depth of field", "golden hour lighting", "rim lighting",
          "high contrast", "soft diffused lighting", "dramatic shadows",
          "split lighting", "backlit", "silhouette", "long exposure",
          "low key", "high key", "studio lighting", "natural light",
          "color harmony", "complementary colors"
        ];
        const technique = techniques[Math.floor(Math.random() * techniques.length)];

        // Photographic qualities
        const qualities = [
          "sharp focus", "vivid colors", "rich detail", "crisp", "textured",
          "pristine quality", "soft bokeh", "moody", "atmospheric", "dreamy",
          "ultra-detailed", "glossy", "professional", "high resolution", "high fidelity"
        ];
        const quality = qualities[Math.floor(Math.random() * qualities.length)];

        // Build the prompt
        let lumaPrompt = `${baseTheme}, ${style}`;
        lumaPrompt += `, ${technique}, ${quality}`;

        // Add additional details
        if (Math.random() > 0.5) {
          const cameras = ["Canon EOS", "Sony Alpha", "Nikon Z", "Leica", "Hasselblad", "Fujifilm"];
          const camera = cameras[Math.floor(Math.random() * cameras.length)];
          lumaPrompt += `, shot on ${camera}`;
        }

        // Set the generated prompt
        setPrompt(lumaPrompt);

        // Show success message briefly
        setPromptGenerationSuccess(true);
      }
      else if (isGoogleImagen()) {
        // Google Imagen specialized prompt generation
        const baseTheme = promptTheme || getRandomGoogleImagenTheme();

        // Google Imagen excels at natural language prompts with clear descriptions
        const styles = [
          "photorealistic", "artistic", "cinematic", "detailed photograph",
          "professional photography", "studio photography", "portrait style",
          "landscape photography", "macro photography", "street photography",
          "documentary style", "fine art", "contemporary art", "digital art",
          "illustration", "concept art", "surreal", "abstract", "minimalist"
        ];
        const style = styles[Math.floor(Math.random() * styles.length)];

        // Lighting and mood descriptors that work well with Imagen
        const lightingMoods = [
          "soft natural lighting", "dramatic lighting", "golden hour glow",
          "studio lighting", "ambient lighting", "warm lighting", "cool lighting",
          "high contrast", "low contrast", "backlit", "rim lighting",
          "moody atmosphere", "bright and airy", "dark and mysterious",
          "ethereal glow", "vibrant colors", "muted tones", "rich textures"
        ];
        const lightingMood = lightingMoods[Math.floor(Math.random() * lightingMoods.length)];

        // Quality and detail descriptors
        const qualities = [
          "highly detailed", "ultra-sharp", "crystal clear", "pristine quality",
          "professional quality", "award-winning", "masterpiece", "stunning detail",
          "intricate details", "fine details", "smooth textures", "rich colors",
          "perfect composition", "balanced exposure", "excellent depth of field"
        ];
        const quality = qualities[Math.floor(Math.random() * qualities.length)];

        // Build a natural language prompt optimized for Google Imagen
        let imagenPrompt = `A ${style} of ${baseTheme}`;
        imagenPrompt += `, featuring ${lightingMood}`;
        imagenPrompt += `, ${quality}`;

        // Add compositional elements
        const compositions = [
          "centered composition", "rule of thirds", "leading lines",
          "symmetrical layout", "asymmetrical balance", "foreground and background",
          "shallow depth of field", "wide angle view", "close-up detail",
          "panoramic view", "bird's eye view", "low angle shot"
        ];
        const composition = compositions[Math.floor(Math.random() * compositions.length)];
        imagenPrompt += `, with ${composition}`;

        // Set the generated prompt
        setPrompt(imagenPrompt);

        // For Imagen 3, also generate a negative prompt if supported
        if (selectedModel === 'fal-ai/imagen3') {
          const negativeElements = [
            "blurry", "low quality", "pixelated", "distorted", "oversaturated",
            "underexposed", "overexposed", "noisy", "artifacts", "watermark",
            "text", "logo", "poor composition", "bad lighting", "unrealistic"
          ];
          const negativePrompt = negativeElements.slice(0, 3).join(", ");
          setNegativePrompt(negativePrompt);
        }

        // Show success message briefly
        setPromptGenerationSuccess(true);
      }
      else {
        // General prompt generation using AI service - for non-Flux models
        const theme = promptTheme || '';
        const generatedPrompt = await generateImagePrompt(selectedModel, theme);

        if (generatedPrompt && generatedPrompt.positivePrompt) {
          setPrompt(generatedPrompt.positivePrompt);

          // If negative prompt was generated and we're not using a Flux model
          if (generatedPrompt.negativePrompt && !isFluxModel()) {
            setNegativePrompt(generatedPrompt.negativePrompt);
          }

          // Show success message briefly
          setPromptGenerationSuccess(true);
        }
      }

      // Hide success message after 3 seconds
      setTimeout(() => setPromptGenerationSuccess(false), 3000);

      // Hide the theme input after successful generation
      if (showPromptThemeInput) {
        setShowPromptThemeInput(false);
      }
    } catch (error) {
      console.error('Error generating prompt:', error);
      // If there's an error, show it as a flash message or in the UI somewhere
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  // Helper functions for Flux prompt generation
  const getRandomFluxTheme = (): string => {
    const themes = [
      "landscape", "portrait", "still life", "abstract composition", 
      "futuristic cityscape", "nature scene", "underwater world",
      "fantasy environment", "architectural visualization", "character concept",
      "product visualization", "interior design", "fashion photography",
      "cinematic shot", "macro photography", "magical scene"
    ];
    return themes[Math.floor(Math.random() * themes.length)];
  };

  // Helper function for Luma Photon themes
  const getRandomLumaTheme = (): string => {
    const themes = [
      "portrait of a person", "landscape scene", "cityscape at night", 
      "close-up of a subject", "aerial view", "food photography",
      "lifestyle scene", "travel photography", "wedding photo",
      "product photography", "automotive photography", "abstract composition",
      "architecture", "wildlife photography", "street scene", 
      "fashion editorial", "interior design", "nature macro"
    ];
    return themes[Math.floor(Math.random() * themes.length)];
  };

  // Helper function for Recraft V3 themes
  const getRandomRecraftTheme = (): string => {
    const themes = [
      "a beautiful landscape", "a detailed portrait", "a colorful still life",
      "a futuristic cityscape", "a fantasy character", "an abstract design",
      "a product visualization", "a concept art scene", "an architectural rendering",
      "a stylized animal", "a digital illustration", "a surreal composition",
      "a minimalist design", "a vibrant scene", "a creative artwork",
      "a professional photograph", "a detailed character", "a scenic environment"
    ];
    return themes[Math.floor(Math.random() * themes.length)];
  };

  // Helper function for Google Imagen themes
  const getRandomGoogleImagenTheme = (): string => {
    const themes = [
      "majestic mountain landscape", "serene ocean sunset", "bustling city street",
      "peaceful forest clearing", "modern architectural structure", "vintage car",
      "blooming flower garden", "cozy coffee shop interior", "dramatic storm clouds",
      "elegant portrait", "rustic countryside", "futuristic cityscape",
      "tropical beach paradise", "winter wonderland", "desert sand dunes",
      "waterfall in jungle", "northern lights", "ancient temple ruins",
      "space nebula", "underwater coral reef", "autumn forest path",
      "medieval castle", "japanese zen garden", "art deco building"
    ];
    return themes[Math.floor(Math.random() * themes.length)];
  };

  const getRandomAdjective = (): string => {
    const adjectives = [
      "stunning", "photorealistic", "vibrant", "detailed", "atmospheric",
      "dramatic", "colorful", "minimalist", "elegant", "dreamy",
      "surreal", "hyperrealistic", "moody", "bright", "tonal",
      "expressive", "balanced", "harmonious", "experimental", "precise"
    ];
    return adjectives[Math.floor(Math.random() * adjectives.length)];
  };

  const getRandomDetail = (): string => {
    const details = [
      "with extreme attention to detail", "with perfect composition",
      "rendered in high definition", "shot with professional lighting",
      "with stunning depth of field", "with professional color grading",
      "with perfect exposure", "with excellent contrast",
      "with beautiful textures", "with intricate details",
      "with gorgeous light and shadow play", "with stunning visual impact",
      "with impeccable clarity", "with excellent focus"
    ];
    return details[Math.floor(Math.random() * details.length)];
  };

  const getRandomQuality = (): string => {
    const qualities = [
      "natural", "studio", "cinematic", "golden hour", "dramatic",
      "soft", "hard", "backlit", "rim", "diffused", "directional",
      "moody", "high-key", "low-key", "vibrant", "atmospheric"
    ];
    return qualities[Math.floor(Math.random() * qualities.length)];
  };

  const getRandomComposition = (): string => {
    const compositions = [
      "balanced composition with strong focal point", "rule of thirds composition",
      "symmetrical composition", "central composition", "asymmetrical composition",
      "dynamic diagonal composition", "framed composition", "minimalist composition",
      "layered composition with foreground and background", "leading lines guiding the eye"
    ];
    return compositions[Math.floor(Math.random() * compositions.length)];
  };

  const getRandomElement = (): string => {
    const elements = [
      "rich textures", "fine details", "subtle lighting effects", 
      "natural elements", "interesting patterns", "complementary colors",
      "atmospheric perspective", "realistic reflections", "natural shadows",
      "depth and dimension", "balanced composition", "interesting focal point",
      "natural color palette", "organic shapes", "dynamic movement"
    ];
    return elements[Math.floor(Math.random() * elements.length)];
  };

  const getRandomNegativeElement = (): string => {
    const negatives = [
      "blurriness", "pixelation", "oversaturation", "distorted proportions",
      "watermarks", "artifacts", "excessive noise", "unnatural colors",
      "overexposure", "chromatic aberration", "sensor dust", "lens flare",
      "poor composition", "harsh shadows", "flat lighting", "blown out highlights",
      "crushed blacks", "over-sharpening", "bad cropping", "color banding"
    ];
    return negatives[Math.floor(Math.random() * negatives.length)];
  };

  const getRandomLighting = (): string => {
    const lightings = [
      "golden hour sunlight", "soft diffused daylight", "dramatic side lighting",
      "blue hour ambiance", "warm candlelight", "cool moonlight", "neon glow",
      "dramatic backlighting", "studio lighting with soft boxes"
    ];
    return lightings[Math.floor(Math.random() * lightings.length)];
  };

  const getRandomMood = (): string => {
    const moods = [
      "serene", "mysterious", "energetic", "melancholic", "joyful", 
      "tense", "romantic", "whimsical", "dramatic", "peaceful"
    ];
    return moods[Math.floor(Math.random() * moods.length)];
  };

  // Helper function to convert width/height to aspect ratio string (for Google Imagen)
  const getAspectRatioFromDimensions = (width: number, height: number): string => {
    const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
    const divisor = gcd(width, height);
    const ratioW = width / divisor;
    const ratioH = height / divisor;
    
    // Map common ratios to expected format for Google Imagen
    const commonRatios: Record<string, string> = {
      '1:1': '1:1',
      '4:3': '4:3',
      '3:4': '3:4',
      '16:9': '16:9',
      '9:16': '9:16',
      '3:2': '3:2',
      '2:3': '2:3'
    };
    
    const ratioKey = `${ratioW}:${ratioH}`;
    return commonRatios[ratioKey] || '1:1'; // Default to square if ratio not recognized
  };

  // Get the appropriate aspect ratios for the current model
  const getModelAspectRatios = () => {
    if (isLumaPhoton()) {
      return lumaPhotonAspectRatios;
    } else if (isRecraftV3() || isRecraftV3SVG()) {
      return recraftV3AspectRatios;
    } else if (isFluxModel()) {
      return fluxAspectRatios;
    } else if (isGoogleImagen()) {
      return googleImagenAspectRatios;
    } else if (isIdeogramV3()) {
      return ideogramV3AspectRatios;
    } else if (isIdeogramV2aTurbo()) {
      return ideogramV2aAspectRatios;
    } else if (isStableDiffusion()) {
      // Use standard aspect ratios for both SD v3 Medium and v3.5 Large
      return [
        { name: 'Square HD', width: 1024, height: 1024 },
        { name: 'Landscape 4:3', width: 1024, height: 768 },
        { name: 'Portrait 4:3', width: 768, height: 1024 },
        { name: 'Landscape 16:9', width: 1024, height: 576 },
        { name: 'Portrait 16:9', width: 576, height: 1024 },
        { name: 'Square', width: 512, height: 512 }
      ];
    }
    return aspectRatios;
  };

  // Add state for handling image input for Gemini editing capabilities 
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [showImageUpload, setShowImageUpload] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Add the isGemini helper function near other model helpers
  const isGemini = () => {
    return false; // Gemini Flash model has been removed
  };

  // Helper function to check if the current model supports direct image uploads
  const supportsDirectImageUpload = () => {
    const currentModel = selectedModel;

    // Check all model families and their submodels
    for (const family of modelFamilies) {
      for (const submodel of family.submodels) {
        if (submodel.id === currentModel && submodel.supportsImageUpload) {
          return true;
        }
      }
    }

    return false;
  };

  // Step-by-step image upload and processing
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log("File selected:", file.name);

    // Step 1: Read the file
    if (!supportsDirectImageUpload()) {
      setIsProcessingImage(true); // Show loading in the text area for non-supporting models
    } else {
      setIsGenerating(true); // Use general loading for direct upload models
    }

    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        // Step 2: Get data URL
        const dataUrl = e.target?.result as string;
        console.log("File read successfully.");

        // Save the image data for reference
        setInputImage(dataUrl);
        setShowImageUpload(true);

        // Step 3: Based on the model, either convert to text or use directly
        if (isGemini() || !supportsDirectImageUpload()) {
          console.log("Processing with Gemini for text conversion...");

          try {
            // Call the Gemini API to analyze the image
            const imageDescription = await analyzeImageWithGemini(dataUrl);

            // Set the description in the prompt field
            setPrompt(imageDescription);
            console.log("Gemini image analysis complete");

          } catch (error) {
            console.error("Error calling Gemini vision API:", error);
            notifications.error("Failed to analyze image with Gemini. Please check your API key and try again.");

            // Fallback to placeholder text if the API call fails
            setPrompt(`Please add a description for the uploaded image "${file.name}".`);
          }
        } else {
          console.log("Model supports direct image upload. Image ready for use in generation.");
          // For models that support direct image upload, we just keep the image
          // and will use it directly during generation
        }

      } catch (error) {
        console.error("Error in file processing:", error);
        notifications.error("Error processing file");
      } finally {
        setIsGenerating(false);
        setIsProcessingImage(false);
      }
    };

    reader.onerror = () => {
      console.error("Error reading file");
      notifications.error("Error reading file");
      setIsGenerating(false);
      setIsProcessingImage(false);
    };

    // Start reading the file
    reader.readAsDataURL(file);
  };

  // Function to process with Gemini in the future
  // This is separated out for easier debugging
  const processWithGemini = async (dataUrl: string, mimeType: string) => {
    try {
      // Check if API is available
      if (typeof window.GoogleGenerativeAI === 'undefined') {
        throw new Error("Gemini API not available");
      }

      if (!window.GEMINI_API_KEY) {
        throw new Error("Gemini API key not set");
      }

      // Initialize Gemini
      const genAI = new window.GoogleGenerativeAI(window.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      // Extract base64 data
      const base64Data = dataUrl.split(',')[1];

      // Send to Gemini
      const result = await model.generateContent([
        "Create a detailed description of this image that could be used as a prompt to generate a similar image. Focus on subject, style, lighting, composition, and mood.",
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType
          }
        }
      ]);

      // Get response
      const description = result.response.text();
      setPrompt(description);

    } catch (error: any) {
      console.error("Gemini processing error:", error);
      alert(`Gemini error: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const [sdkStatus, setSdkStatus] = React.useState<string>('Checking...');

  // Function to check SDK status
  const checkSDKStatus = () => {
    if (typeof window.GoogleGenerativeAI !== 'undefined') {
      setSdkStatus('Loaded');
      return true;
    } else {
      setSdkStatus('Not Loaded');
      return false;
    }
  };

  // Check SDK status on mount
  React.useEffect(() => {
    checkSDKStatus();
    // Set up interval to check status
    const interval = setInterval(() => {
      checkSDKStatus();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Test Gemini API connection function
  const testGeminiApiConnection = async () => {
    try {
      console.log("[Gemini Test] Testing connection...");
      setSdkStatus('Testing...');

      // Check if the SDK is loaded
      if (typeof window.GoogleGenerativeAI !== 'undefined') {
        console.log('Gemini SDK available');
      } else {
        console.error('Gemini SDK not available. Image generation might fail.');
      }

      // Initialize the API client
      const genAI = new window.GoogleGenerativeAI(window.GEMINI_API_KEY || '');

      // Test with a simple text model first
      console.log("[Gemini Test] Testing with text model...");
      const textModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const textResult = await textModel.generateContent("Hello, this is a test.");
      const textResponse = await textResult.response;
      const text = textResponse.text();

      console.log("[Gemini Test] Text generation successful:", text);

      // Now test with image model
      console.log("[Gemini Test] Testing with image model...");
      const imageModel = genAI.getGenerativeModel({
        model: "gemini-1.5-flash", // Changed to use regular Gemini model instead of image generation
        generationConfig: { responseModalities: ['Text'] } // Removed 'Image' since we're not using image generation
      });

      // Just check if the model is initialized properly
      console.log("[Gemini Test] Text model initialized successfully");

      alert(`Gemini API connection successful!\nText model response: "${text}"\nGemini model initialized correctly.`);
      setSdkStatus('Loaded & Working');
    } catch (error: any) {
      console.error("[Gemini Test] Connection test failed:", error);
      alert(`Gemini API connection test failed: ${error.message || 'Unknown error'}`);
      setSdkStatus('Error');
    }
  };

  // Function to force reload the SDK
  const reloadSDK = () => {
    try {
      console.log("[Gemini] Attempting to reload SDK...");
      setSdkStatus('Reloading...');

      // Create a new script element
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/@google/generative-ai@0.2.0/dist/web/index.js';
      script.async = true;

      script.onload = () => {
        console.log("[Gemini] SDK reload successful");
        setSdkStatus('Reloaded');
        setTimeout(checkSDKStatus, 500);
      };

      script.onerror = () => {
        console.error("[Gemini] SDK reload failed");
        setSdkStatus('Reload Failed');
      };

      // Add to document
      document.head.appendChild(script);
    } catch (error) {
      console.error("[Gemini] SDK reload error:", error);
      setSdkStatus('Reload Error');
    }
  };

  // Function to update Gemini API key
  const updateGeminiApiKey = () => {
    const newKey = window.prompt('Enter your Gemini API key:');
    if (newKey && newKey.trim()) {
      window.GEMINI_API_KEY = newKey.trim();
      console.log('Updated Gemini API key');

      // Store in URL temporarily for testing
      const url = new URL(window.location.href);
      url.searchParams.set('gemini_token', newKey.trim());
      window.history.replaceState({}, document.title, url.toString());

      // Test the new key
      setTimeout(() => {
        testGeminiApiConnection();
      }, 500);
    }
  };

  // When model changes, update UI
  React.useEffect(() => {
    if (isGemini()) {
      // Check if Gemini SDK is available
      if (typeof window.GoogleGenerativeAI !== 'undefined') {
        console.log('Gemini SDK available');
      } else {
        console.error('Gemini SDK not available. Image generation might fail.');
      }
    }
  }, [selectedModel]);

  // Define aspect ratios with numerical format
  const aspectRatioOptions = [
    { ratio: "1:1", width: 1024, height: 1024 },
    { ratio: "4:3", width: 1024, height: 768 },
    { ratio: "3:4", width: 768, height: 1024 },
    { ratio: "16:9", width: 1024, height: 576 },
    { ratio: "9:16", width: 576, height: 1024 },
    { ratio: "3:2", width: 1024, height: 683 },
  ];

  // Get current aspect ratio as string
  const getCurrentAspectRatio = () => {
    const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
    const divisor = gcd(width, height);
    return `${width/divisor}:${height/divisor}`;
  };

  const [isLoading, setIsLoading] = useState(false);

  // Check if the current model is Ideogram V3
  const isIdeogramV3 = () => {
    return selectedModel === 'fal-ai/ideogram/v3';
  };

  // Check if the current model is Ideogram V2a Turbo
  const isIdeogramV2aTurbo = () => {
    return selectedModel === 'fal-ai/ideogram/v2a/turbo';
  };

  // Check if the current model is any Ideogram model
  const isIdeogram = () => {
    return isIdeogramV3() || isIdeogramV2aTurbo();
  };

  return (
    <div className="flex flex-col h-full w-full p-4" style={{ minHeight: 0, minWidth: 0 }}>
      <div className="flex flex-col lg:flex-row h-full relative gap-4">
        {/* Left Panel (Controls) */}
        <div className="lg:w-[320px] lg:min-w-[320px] lg:max-w-[360px] flex-shrink-0">
          <div className="bg-[#19191a] border border-[#3a3a3d] rounded-lg p-4 h-full flex flex-col">

            {/* Model Selection */}
            <div className="mb-4">
              <ModelSelector
                selectedModel={selectedModel}
                onChange={setSelectedModel}
                disabled={isGenerating}
              />
            </div>

            {/* Prompt Input */}
            <div className="mb-4">
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder=""
                  className="w-full h-28 bg-[#0e0e10] border border-[#3a3a3d] rounded-lg px-3 py-3 text-sm text-white/90 focus:outline-none focus:border-[#6b7280] transition-colors resize-none leading-relaxed"
                  disabled={isGenerating || isProcessingImage}
                  onKeyDown={handleKeyDown}
                />
                {!prompt && !isGenerating && !isProcessingImage && (
                  <div className="absolute top-3 left-3 text-sm pointer-events-none flex items-center">
                    <span className="text-white/40">Describe the image or</span>
                    <span
                      className="text-white/60 hover:text-white pointer-events-auto cursor-pointer ml-1 underline"
                      onClick={handleUploadClick}
                    >
                      upload
                    </span>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleImageUpload}
                      accept="image/*"
                      style={{ display: 'none' }}
                    />
                  </div>
                )}
                {isProcessingImage && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg">
                    <div className="flex flex-col items-center">
                      <RotateCw size={20} className="text-white/70 animate-spin mb-2" />
                      <div className="text-xs text-white/70">Analyzing image...</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Uploaded Image Preview */}
            {inputImage && supportsDirectImageUpload() && (
              <div className="mb-4 p-3 bg-[#0e0e10] border border-[#3a3a3d] rounded-lg relative group">
                <div className="flex justify-center">
                  <img
                    src={inputImage}
                    alt="Uploaded Preview"
                    className="max-h-24 max-w-full rounded-md object-contain"
                  />
                </div>
                <button
                  onClick={() => {
                    setInputImage(null);
                    setShowImageUpload(false);
                  }}
                  className="absolute top-2 right-2 p-1.5 bg-[#19191a] border border-[#3a3a3d] rounded-md text-white/50 hover:text-white hover:border-[#6b7280] opacity-0 group-hover:opacity-100 transition-all"
                  title="Remove Image"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            {/* Settings Sections */}
            <div className="flex-1 flex flex-col gap-3">

              {/* Generation Settings Bar */}
              <div className="flex items-center gap-2">
                {/* Number of Images */}
                <div className="flex items-center h-9 bg-[#0e0e10] border border-[#3a3a3d] rounded-lg px-1">
                  <button
                    onClick={decreaseGenerations}
                    disabled={numGenerations <= 1 || isGenerating}
                    className={`flex items-center justify-center h-7 w-7 rounded-md transition-all ${
                      numGenerations <= 1 || isGenerating
                        ? 'text-white/20 cursor-not-allowed'
                        : 'text-white/60 hover:bg-[#2a2a2d] hover:text-white'
                    }`}
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-5 text-center text-white text-sm font-medium">{numGenerations}</span>
                  <button
                    onClick={increaseGenerations}
                    disabled={numGenerations >= 4 || isGenerating}
                    className={`flex items-center justify-center h-7 w-7 rounded-md transition-all ${
                      numGenerations >= 4 || isGenerating
                        ? 'text-white/20 cursor-not-allowed'
                        : 'text-white/60 hover:bg-[#2a2a2d] hover:text-white'
                    }`}
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {/* Aspect Ratio Dropdown */}
                <div className="relative group flex-1">
                  <button
                    className="flex items-center justify-center gap-2 h-9 px-3 bg-[#0e0e10] border border-[#3a3a3d] rounded-lg text-white/80 text-sm hover:border-[#6b7280] transition-all w-full"
                    disabled={isGenerating}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/50">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                      <line x1="8" y1="21" x2="16" y2="21"/>
                      <line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                    <span>{getModelAspectRatios().find(ar => ar.width === width && ar.height === height)?.name || 'Square'}</span>
                  </button>
                  {/* Dropdown Menu */}
                  <div className="absolute bottom-full left-0 mb-2 w-full bg-[#19191a] border border-[#3a3a3d] rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 py-1">
                    {getModelAspectRatios().map(ar => (
                      <button
                        key={ar.name}
                        onClick={() => handleAspectRatioChange(ar.width, ar.height)}
                        className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                          width === ar.width && height === ar.height
                            ? 'bg-[#2a2a2d] text-white'
                            : 'text-white/60 hover:bg-[#222224] hover:text-white'
                        }`}
                        disabled={isGenerating}
                      >
                        {ar.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quality Selector */}
                <div className="relative group">
                  <button
                    className="flex items-center justify-center gap-2 h-9 px-3 bg-[#0e0e10] border border-[#3a3a3d] rounded-lg text-white/80 text-sm hover:border-[#6b7280] transition-all"
                    disabled={isGenerating}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/50">
                      <polyline points="15 3 21 3 21 9"/>
                      <polyline points="9 21 3 21 3 15"/>
                      <line x1="21" y1="3" x2="14" y2="10"/>
                      <line x1="3" y1="21" x2="10" y2="14"/>
                    </svg>
                    <span>{quality}</span>
                  </button>
                  {/* Quality Dropdown */}
                  <div className="absolute bottom-full right-0 mb-2 w-24 bg-[#19191a] border border-[#3a3a3d] rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 py-1">
                    {(['SD', 'HD', '4K'] as const).map((q) => (
                      <button
                        key={q}
                        onClick={() => setQuality(q)}
                        className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                          quality === q
                            ? 'bg-[#2a2a2d] text-white'
                            : 'text-white/60 hover:bg-[#222224] hover:text-white'
                        }`}
                        disabled={isGenerating}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Credit Usage */}
              <div className="flex items-center justify-between text-xs text-white/40 px-1">
                <span>Estimated credits</span>
                <span className="text-white/60">
                  ~{selectedModel.includes('imagen') ? '80' :
                    selectedModel.includes('stable-diffusion') ? '60' :
                    selectedModel.includes('flux') ? '90' :
                    selectedModel.includes('luma') ? '70' :
                    selectedModel.includes('recraft') ? '65' :
                    selectedModel.includes('ideogram') ? '75' :
                    (numGenerations * (Math.round(steps / 10) * 0.5 + (width * height) / (1024 * 1024) * 1)).toFixed(0)} per image
                </span>
              </div>
            </div>

            {/* Generate Button */}
            <div className="mt-4 pt-4 border-t border-[#3a3a3d]">
              <button
                onClick={handleGenerate}
                disabled={isGenerating || isProcessingImage || !prompt.trim()}
                className={`w-full h-11 rounded-lg flex items-center justify-center text-sm font-medium transition-all ${
                  isGenerating || isProcessingImage
                    ? 'bg-[#19191a] border border-[#3a3a3d] cursor-not-allowed text-white/30'
                    : prompt.trim()
                      ? 'bg-[#2a2a2d] border border-[#6b7280] text-white hover:bg-[#333336] hover:border-[#9ca3af]'
                      : 'bg-[#19191a] border border-[#3a3a3d] text-white/30'
                }`}
              >
                {isGenerating ? (
                  <>
                    <RotateCw size={14} className="mr-2 animate-spin" />
                    Generating...
                  </>
                ) : isProcessingImage ? (
                  <>
                    <RotateCw size={14} className="mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Send size={14} className="mr-2" />
                    Generate {numGenerations > 1 ? `${numGenerations} Images` : 'Image'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
        
        {/* Right Panel (Preview & History) */}
        <div className="flex-1 flex flex-col gap-4">

          {/* Preview Area */}
          <div className="bg-[#19191a] border border-[#3a3a3d] rounded-lg p-4 flex flex-col flex-1" style={{ minHeight: '400px' }}>

            {/* Preview Header */}
            <div className="flex items-center justify-between mb-4 h-8">
              <span className="text-white/50 text-xs uppercase tracking-wide">Preview</span>
              {history.length > 0 && (
                <button
                  onClick={handleClearHistory}
                  className="h-8 px-3 flex items-center gap-1.5 text-white/40 hover:text-white/70 bg-[#0e0e10] hover:bg-[#222224] rounded-md transition-all border border-[#3a3a3d] hover:border-[#6b7280] text-xs"
                  title="Clear History"
                >
                  <Trash2 size={12} />
                  Clear
                </button>
              )}
            </div>

            {/* Preview Display */}
            <div className="flex-1 relative rounded-lg overflow-hidden bg-[#0e0e10] border border-[#3a3a3d] flex items-center justify-center">
              {/* Image Container */}
              <div className="absolute inset-0 flex items-center justify-center">
                {/* Loading State */}
                {isLoading || isGenerating ? (
                  <div className="flex flex-col items-center justify-center p-8">
                    <div className="w-16 h-16 rounded-xl bg-[#19191a] border border-[#3a3a3d] flex items-center justify-center mb-4">
                      <RotateCw size={24} className="text-white/50 animate-spin" />
                    </div>
                    <p className="text-white/50 text-sm font-medium">
                      {isGenerating ? `Generating ${numGenerations > 1 ? numGenerations + ' images' : 'image'}...` : 'Loading...'}
                    </p>
                  </div>
                ) : (
                  /* Image Display Grid / Single Image */
                  previewImages.length > 0 ? (
                    <div className={`relative w-full h-full ${previewImages.length > 1 ? 'grid grid-cols-2 gap-2' : ''}`}>
                      {previewImages.map((imageUrl, index) => {
                        const imgKey = `img-${index}`;
                        const currentZoom = zoomLevels[imgKey] || 0.8;
                        const currentPanX = panXValues[imgKey] || 0;
                        const currentPanY = panYValues[imgKey] || 0;

                        return (
                          <div key={imgKey} className="relative w-full h-full overflow-hidden border border-[#3a3a3d] rounded-lg group">
                            {/* Image Tool Controls */}
                            <div className="absolute top-2 right-2 flex gap-1 bg-[#19191a] border border-[#3a3a3d] p-1 rounded-lg z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                className="p-1.5 hover:bg-[#222224] rounded-md transition-colors text-white/60 hover:text-white"
                                onClick={() => setZoomLevels(prev => ({ ...prev, [imgKey]: Math.min((prev[imgKey] || 1) * 1.2, 10) }))}
                                title="Zoom In"
                              >
                                <ZoomIn size={14} />
                              </button>
                              <button
                                className="p-1.5 hover:bg-[#222224] rounded-md transition-colors text-white/60 hover:text-white"
                                onClick={() => setZoomLevels(prev => ({ ...prev, [imgKey]: Math.max(0.1, prev[imgKey] - 0.2) }))}
                                title="Zoom Out"
                              >
                                <ZoomOut size={14} />
                              </button>
                              <button
                                className="p-1.5 hover:bg-[#222224] rounded-md transition-colors text-white/60 hover:text-white"
                                onClick={() => resetZoomPan(imgKey)}
                                title="Reset View"
                              >
                                <Maximize size={14} />
                              </button>
                              <button
                                className="p-1.5 hover:bg-[#222224] rounded-md transition-colors text-white/60 hover:text-white"
                                onClick={async () => {
                                  try {
                                    const a = document.createElement('a');
                                    a.style.display = 'none';
                                    a.href = imageUrl;
                                    // Create filename
                                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                                    // Extract filename from URL or use a default
                                    const urlParts = imageUrl.split('/');
                                    const filenameGuess = urlParts[urlParts.length - 1].split('?')[0] || `generated_${timestamp}`;
                                    // Ensure filename has an extension, default to .png
                                    const finalFilename = filenameGuess.includes('.') ? filenameGuess : `${filenameGuess}.png`;
                                    a.download = finalFilename;
                                    document.body.appendChild(a);
                                    a.click();
                                    window.URL.revokeObjectURL(imageUrl);
                                    a.remove();
                                    notifications.success('Image downloaded');
                                  } catch (err) {
                                    console.error('Download failed:', err);
                                    notifications.error('Failed to download image.');
                                  }
                                }}
                                title="Download Image"
                              >
                                <Download size={14} />
                              </button>
                            </div>
                            
                            {/* Image with zoom/pan - Keep existing */}
                             <div 
                              className="w-full h-full overflow-hidden cursor-grab" 
                              onMouseMove={handleMouseMove}
                              onMouseUp={handleMouseUpOrLeave}
                              onMouseLeave={handleMouseUpOrLeave}
                              onWheel={(e) => handleWheel(e, imgKey)}
                            >
                               <img 
                                src={imageUrl} 
                                alt={`Generated ${index + 1}`} 
                                className="transition-transform duration-100 ease-out" // Add smooth transition
                                style={{ 
                                  transform: `scale(${currentZoom}) translate(${currentPanX / currentZoom}px, ${currentPanY / currentZoom}px)`, 
                                  maxWidth: 'none',
                                  maxHeight: 'none',
                                  cursor: isDragging && dragStart?.imgKey === imgKey ? 'grabbing' : 'grab',
                                  objectFit: 'contain', // Ensure image scales correctly within bounds
                                }}
                                onMouseDown={(e) => handleMouseDown(e, imgKey)}
                                loading="eager"
                                draggable="false" // Prevent native image dragging
                                onError={(e) => { 
                                  console.error('Preview image failed to load:', imageUrl);
                                  (e.target as HTMLImageElement).style.display = 'none'; 
                                  // Optionally show an error message in its place
                                }}
                              />
                            </div>
                            
                            {/* Image number indicator - Match video style */}
                            {previewImages.length > 1 && (
                              <div className="absolute bottom-1 left-1 bg-black/70 text-white/90 text-[10px] px-1.5 py-0.5 rounded">
                                {index + 1}/{previewImages.length}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Empty State */
                    <div className="flex flex-col items-center justify-center p-8">
                      <div className="w-16 h-16 rounded-xl bg-[#19191a] border border-[#3a3a3d] flex items-center justify-center mb-4">
                        <Image size={24} className="text-white/30" />
                      </div>
                      <p className="text-white/40 text-sm">Generated images appear here</p>
                      <p className="text-white/25 text-xs mt-1">Enter a prompt and click Generate</p>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>

          {/* History Area */}
          <div className="bg-[#19191a] border border-[#3a3a3d] rounded-lg p-4 flex-shrink-0" style={{ height: '120px' }}>
            {/* History Header */}
            <div className="flex items-center justify-between mb-3 h-5">
              <span className="text-white/50 text-xs uppercase tracking-wide">Recent Generations</span>
              {history.length > 0 && (
                <button
                  onClick={handleClearHistory}
                  className="text-xs text-white/40 hover:text-white/60 transition-colors flex items-center gap-1.5"
                  title="Clear History"
                >
                  <Trash2 size={12} />
                  Clear
                </button>
              )}
            </div>
            {/* History Thumbnails */}
            <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-[#3a3a3d] scrollbar-track-transparent" style={{ height: '72px' }}>
              <div className="flex gap-2 h-full">
                {history.length > 0 ? (
                  history.map((item) => (
                    <div
                      key={item.id}
                      className={`relative flex-shrink-0 h-full aspect-square rounded-md overflow-hidden cursor-pointer group bg-cover bg-center transition-all border-2 ${
                        selectedImage === item.image
                          ? 'border-[#6b7280]'
                          : 'border-[#3a3a3d] hover:border-[#6b7280]'
                      }`}
                      style={{ backgroundImage: `url('${item.image}')` }}
                      onClick={() => setSelectedImage(item.image)}
                      title={`Preview: ${item.prompt}`}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setHistory(prev => prev.filter(h => h.id !== item.id));
                          if (selectedImage === item.image) {
                            setSelectedImage(history.length > 1 ? history[0].image : null);
                          }
                        }}
                        className="absolute top-1 right-1 p-1 bg-[#19191a]/90 border border-[#3a3a3d] rounded text-white/50 opacity-0 group-hover:opacity-100 transition-opacity hover:text-white hover:border-[#6b7280]"
                        title="Delete"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center w-full h-full text-white/30 text-xs">
                    History will appear here
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main Wrapper Component ---
const ImageGenerationInterfaceWrapper: React.FC = () => {
  const { isSidebarCollapsed } = useLayout();
  const [isCleanMode, setIsCleanMode] = useState(localStorage.getItem('isCleanMode') === 'true');

   // Function to get interface mode state from localStorage
  const getInterfaceMode = (): boolean => {
    return localStorage.getItem('isCleanMode') === 'true';
  };

  // Function to set interface mode state in localStorage and dispatch event
  const setInterfaceMode = (isClean: boolean): void => {
    localStorage.setItem('isCleanMode', isClean.toString());
    window.dispatchEvent(new CustomEvent('interface_mode_changed', { detail: { isCleanMode: isClean } }));
  };


  // Listen for interface mode changes triggered globally or by sidebar
  useEffect(() => {
    const handleInterfaceModeChange = (event: CustomEvent) => {
      setIsCleanMode(event.detail.isCleanMode);
    };
    window.addEventListener('interface_mode_changed', handleInterfaceModeChange as EventListener);

     // Add listener for clicks on potential toggle buttons (like in sidebar)
    const toggleButtons = document.querySelectorAll('[data-interface-toggle]');
    const handleToggleClick = () => {
        const newMode = !getInterfaceMode(); // Get current mode from storage
        setInterfaceMode(newMode); // Update state and notify others
    };
    toggleButtons.forEach(button => button.addEventListener('click', handleToggleClick));

    return () => {
      window.removeEventListener('interface_mode_changed', handleInterfaceModeChange as EventListener);
      toggleButtons.forEach(button => button.removeEventListener('click', handleToggleClick));
    };
  }, []); // Run only once on mount


  // --- Render the appropriate interface based on mode ---
  return (
    <div className="flex flex-col h-full">
      {/* Conditionally render Clean or Full Interface */}
       {isCleanMode ? (
            <CleanInterface />
        ) : (
            // Wrap Full Interface ONLY (No History Bar)
            <div className="flex flex-col h-full">
                {/* Full Interface takes all available space */}
                <div className="flex-grow h-full"> {/* Adjusted height/flex properties */}
                   <FullImageGenerationInterface />
                </div>
                {/* History Bar at the bottom - REMOVED */}
                {/*
                <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 mt-2 overflow-hidden flex flex-col"
                     style={{ height: '120px', minHeight: '120px', flexShrink: 0 }}>
                    <div className="flex justify-between items-center mb-1 px-1 flex-shrink-0">
                       <div className="text-xs text-white/60">Recent Generations</div>
                        {historyItems.length > 0 && (...)}
                    </div>
                    <div className="flex-1 overflow-x-auto ...">
                        <div className="flex space-x-2 h-full pb-1">
                            {historyItems.length > 0 ? (
                                historyItems.map((item) => (...))
                            ) : (...)}
                        </div>
                    </div>
                </div>
                */}
            </div>
        )}
    </div>
  );
};


// Default export is the wrapper component
export default ImageGenerationInterfaceWrapper;

// Consolidated global Window type extension
declare global {
  interface Window {
    XENO_API_KEY?: string;
    GEMINI_API_KEY?: string;
    GoogleGenerativeAI?: any; // Make optional or ensure SDK script loads first
  }
}

// TEST COMMENT - DOCKER BUILD TEST

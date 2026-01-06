import React, { useState, useEffect, useRef } from 'react';
import '@google/model-viewer';
import { Box, Wand2, Info, Download, Loader, Settings, ChevronDown, Copy, Share2, Trash2, X, Send, Play, Upload, Image as ImageIcon } from 'lucide-react';
import { generate3DModel, type ThreeDGenerationSettings, type ThreeDGenerationResult } from '../../../services/threeDGenerationService';

// Mock API token check
const checkApiTokens = () => {
  return {
    replicate: true, // Simulate having the API token
  };
};

// ApiTokenNotice component for when API token is missing
const ApiTokenNotice: React.FC<{serviceKey: string, onTokenSaved: () => void}> = ({ serviceKey, onTokenSaved }) => {
  return (
    <div className="w-full mb-6 bg-yellow-900/30 border border-yellow-600/30 rounded-xl p-4 flex items-start space-x-4">
      <Info className="text-yellow-500 flex-shrink-0 mt-0.5" size={20} />
      <div>
        <h3 className="text-yellow-500 font-medium text-sm">API Token Required</h3>
        <p className="text-yellow-500/80 text-sm mt-1">
          You need to provide an API token for {serviceKey} to use 3D generation features.
          Go to Settings {'>'} API Keys to add your token.
        </p>
        <button
          className="mt-2 px-3 py-1 bg-yellow-600/30 hover:bg-yellow-600/50 text-yellow-500 text-sm rounded-md transition-colors"
          onClick={onTokenSaved}
        >
          I've added my API token
        </button>
      </div>
    </div>
  );
};

// Model option interface
interface ModelOption {
  id: string;
  name: string;
  description: string;
  provider: string;
}

interface ThreeDPreview {
  url: string;
  type: '3d' | 'glb' | 'obj' | 'gltf';
  thumbnailUrl?: string;
}

interface ThreeDGenerationInterfaceProps {
  isCleanMode?: boolean;
  onToggleInterface?: () => void;
}

interface SubModel {
  id: string;
  name: string;
  description: string;
  isNew?: boolean;
  isBeta?: boolean;
}

interface ModelFamily {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
  isNew?: boolean;
  isBeta?: boolean;
  submodels: SubModel[];
}

interface ThreeDHistoryItem {
  id: string;
  url: string;
  type: string;
  thumbnailUrl?: string;
  prompt: string;
  timestamp: Date;
  metadata?: any; // Store model, settings, etc.
}

const modelFamilies: ModelFamily[] = [
  {
    id: 'triposr',
    name: 'TripoSR',
    icon: <div className="mr-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 p-2"><Box size={16} className="text-emerald-400" /></div>,
    description: "VAST AI Research's fast and high-quality image-to-3D generation model with excellent geometry reconstruction.",
    submodels: [
      {
        id: 'fal-ai/triposr',
        name: 'TripoSR',
        description: "Fast image-to-3D conversion with excellent geometry and texture quality. Supports GLB and OBJ output formats.",
        isNew: true
      }
    ]
  },
  {
    id: 'hunyuan3d',
    name: 'Hunyuan3D',
    icon: <div className="mr-2 rounded-lg bg-red-500/20 border border-red-500/30 p-2"><Box size={16} className="text-red-400" /></div>,
    description: "Tencent's advanced image-to-3D generation model with textured mesh support and high-quality geometry reconstruction.",
    submodels: [
      {
        id: 'fal-ai/hunyuan3d/v2',
        name: 'Hunyuan3D v2',
        description: "Advanced image-to-3D model with optional textured mesh generation. Features octree-based processing and diffusion guidance.",
        isNew: true
      }
    ]
  },
  {
    id: 'hyper3d',
    name: 'Hyper3D',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Box size={16} className="text-blue-400" /></div>,
    description: "Advanced text-to-3D and image-to-3D generation with professional quality output and multiple format support.",
    submodels: [
      {
        id: 'fal-ai/hyper3d/rodin',
        name: 'Hyper3D Rodin',
        description: "Professional 3D model generation supporting both text-to-3D and image-to-3D with multiple quality tiers and output formats (GLB, USDZ, FBX, OBJ, STL).",
        isNew: true
      }
    ]
  },
  {
    id: 'rodin',
    name: 'Rodin (Legacy)',
    icon: <div className="mr-2 rounded-lg bg-gray-500/20 border border-gray-500/30 p-2"><Box size={16} className="text-gray-400" /></div>,
    description: "Legacy Rodin models - use Hyper3D Rodin for latest features.",
    submodels: [
      {
        id: 'rodin-v1',
        name: 'Rodin V1',
        description: "Legacy model - recommend using Hyper3D Rodin instead"
      }
    ]
  },
  {
    id: 'shap-e',
    name: 'Shap-E',
    icon: <div className="mr-2 rounded-lg bg-green-500/20 border border-green-500/30 p-2"><Box size={16} className="text-green-400" /></div>,
    description: "Creates stylized 3D objects with fast generation times and consistent outputs.",
    submodels: [
      {
        id: 'shap-e-v2',
        name: 'Shap-E V2',
        description: "Creates stylized 3D objects with consistent outputs",
        isNew: true
      }
    ]
  },
  {
    id: 'trellis',
    name: 'Trellis',
    icon: <div className="mr-2 rounded-lg bg-purple-500/20 border border-purple-500/30 p-2"><Box size={16} className="text-purple-400" /></div>,
    description: "Highly optimized 3D model generation for detailed structures and landscapes.",
    submodels: [
      {
        id: 'trellis-t2m',
        name: 'Trellis T2M',
        description: "Specialized for architectural elements and detailed structures",
        isBeta: true
      }
    ]
  }
];

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

  // Helper function to determine input type for each model
  const getModelInputType = (modelId: string): { type: 'Text' | 'Image' | 'Mixed'; color: string } => {
    switch (modelId) {
      case 'fal-ai/triposr':
      case 'fal-ai/hunyuan3d/v2':
        return { type: 'Image', color: 'bg-emerald-500/30 text-emerald-300 border-emerald-500/40' };
      case 'fal-ai/hyper3d/rodin':
        return { type: 'Mixed', color: 'bg-purple-500/30 text-purple-300 border-purple-500/40' };
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
        className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-white/20 flex justify-between items-center "
        onClick={togglePanel}
        disabled={disabled}
      >
        <div className="flex items-center">
          {selectedDetails ? selectedDetails.family.icon : <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Box size={16} className="text-blue-400" /></div>}
          <span>{selectedDetails ? selectedDetails.model.name : 'Select a model'}</span>
        </div>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
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
          className="absolute z-50 top-0 left-full ml-9 bg-[rgba(20,20,20,0.95)] border border-white/10 rounded-xl shadow-xl overflow-hidden w-[400px] backdrop-blur-sm"
          style={animationStyles}
        >
          {selectedFamily === null ? (
            <div>
              <div className="p-3 border-b border-white/10 bg-black/20">
                <h3 className="text-sm font-medium text-white/80 text-center">Select Model Family</h3>
              </div>
              <div className="p-2">
                {modelFamilies.map(family => (
                  <div
                    key={family.id}
                    className="rounded-lg p-3 hover:bg-white/5 cursor-pointer transition-all duration-200 border border-transparent hover:border-white/10"
                    onClick={() => setSelectedFamily(family.id)}
                  >
                    <div className="flex items-center">
                      {family.icon}
                      <div>
                        <div className="text-sm font-medium text-white flex items-center">
                          {family.name}
                          {family.isBeta && <span className="ml-2 px-1.5 py-0.5 text-xs bg-orange-500/30 text-orange-300 rounded">BETA</span>}
                        </div>
                        <div className="text-xs text-white/60 mt-0.5">{family.description}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="p-3 border-b border-white/10 bg-black/20 flex items-center">
                <button
                  className="mr-2 rounded-lg hover:bg-white/10 p-1 transition-colors"
                  onClick={() => setSelectedFamily(null)}
                >
                  <svg
                    className="w-4 h-4 transform rotate-180"
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
                      className={`rounded-lg p-3 cursor-pointer transition-all duration-200 border ${
                        selectedModel === model.id
                          ? 'bg-blue-500/10 border-blue-500/40 shadow-md shadow-blue-500/10'
                          : 'border-white/10 hover:border-white/20 hover:bg-white/5'
                      } ${
                        index < array.length - 1 ? 'mb-2' : ''
                      }`}
                      onClick={() => handleSelectModel(model.id)}
                    >
                      <div className="flex items-center">
                        <div className={`w-4 h-4 rounded-md mr-3 flex-shrink-0 border flex items-center justify-center transition-all duration-200 ${
                          selectedModel === model.id
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-white/40 bg-transparent hover:border-white/60'
                        }`}>
                          {selectedModel === model.id && (
                            <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center flex-wrap gap-1.5">
                              <span className={`text-sm font-semibold transition-colors ${
                                selectedModel === model.id ? 'text-white' : 'text-white/90'
                              }`}>
                            {model.name}
                              </span>
                              {(() => {
                                const inputType = getModelInputType(model.id);
                                return (
                                  <span className={`px-1.5 py-0.5 text-xs rounded font-medium border ${inputType.color}`}>
                                    {inputType.type}
                                  </span>
                                );
                              })()}
                              {model.isBeta && (
                                <span className="px-1.5 py-0.5 text-xs bg-orange-500/30 text-orange-300 rounded font-medium border border-orange-500/40">
                                  BETA
                                </span>
                              )}
                          </div>
                            {/* Capability indicators */}
                            <div className="flex items-center gap-1 ml-2">
                              {model.id === 'fal-ai/hyper3d/rodin' && (
                                <>
                                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Text-to-3D"></div>
                                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Image-to-3D"></div>
                                </>
                              )}
                              {(model.id === 'fal-ai/triposr' || model.id === 'fal-ai/hunyuan3d/v2') && (
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Image-to-3D"></div>
                              )}
                            </div>
                          </div>
                          
                          <p className={`text-xs leading-relaxed mb-1.5 transition-colors ${
                            selectedModel === model.id ? 'text-white/75' : 'text-white/65'
                          }`}>
                            {model.description}
                          </p>
                          
                          {/* Model-specific details - Right aligned */}
                          <div className="flex items-center justify-end gap-3 text-xs">
                            {model.id === 'fal-ai/triposr' && (
                              <>
                                <span className={`transition-colors ${
                                  selectedModel === model.id ? 'text-white/60' : 'text-white/50'
                                }`}>
                                  GLB, OBJ
                                </span>
                                <span className={`transition-colors ${
                                  selectedModel === model.id ? 'text-emerald-300' : 'text-emerald-400/80'
                                }`}>
                                  • Fast • ~50 credits
                                </span>
                              </>
                            )}
                            {model.id === 'fal-ai/hunyuan3d/v2' && (
                              <>
                                <span className={`transition-colors ${
                                  selectedModel === model.id ? 'text-white/60' : 'text-white/50'
                                }`}>
                                  GLB
                                </span>
                                <span className={`transition-colors ${
                                  selectedModel === model.id ? 'text-red-300' : 'text-red-400/80'
                                }`}>
                                  • Textured • 70-210 credits
                                </span>
                              </>
                            )}
                            {model.id === 'fal-ai/hyper3d/rodin' && (
                              <>
                                <span className={`transition-colors ${
                                  selectedModel === model.id ? 'text-white/60' : 'text-white/50'
                                }`}>
                                  GLB, USDZ, FBX, OBJ, STL
                                </span>
                                <span className={`transition-colors ${
                                  selectedModel === model.id ? 'text-blue-300' : 'text-blue-400/80'
                                }`}>
                                  • Premium • 100-300 credits
                                </span>
                              </>
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

const ThreeDGenerationInterface: React.FC<ThreeDGenerationInterfaceProps> = ({
  isCleanMode = false,
  onToggleInterface
}) => {
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState('fal-ai/hyper3d/rodin');
  const [apiTokenAvailable, setApiTokenAvailable] = useState(true);
  const [isCheckingToken, setIsCheckingToken] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // State for the *currently displayed* 3D model in the main preview
  const [currentPreview, setCurrentPreview] = useState<ThreeDHistoryItem | null>(null);
  // State for the list of *all* generated models (history)
  const [history3D, setHistory3D] = useState<ThreeDHistoryItem[]>([]);
  
  // Hyper3D Rodin specific settings
  const [conditionMode, setConditionMode] = useState<'fuse' | 'concat'>('concat');
  const [tier, setTier] = useState<'Regular' | 'Sketch'>('Regular');
  const [quality, setQuality] = useState<'high' | 'medium' | 'low' | 'extra-low'>('medium');
  const [geometryFileFormat, setGeometryFileFormat] = useState<'glb' | 'usdz' | 'fbx' | 'obj' | 'stl'>('glb');
  const [material, setMaterial] = useState<'PBR' | 'Shaded'>('PBR');
  const [taPose, setTaPose] = useState(false);
  const [useHyper, setUseHyper] = useState(false);
  const [addons, setAddons] = useState<'HighPack' | null>(null);
  const [bboxCondition, setBboxCondition] = useState<string>(''); // Store as string, parse to array
  const [inputImageUrls, setInputImageUrls] = useState<string[]>([]);
  
  // Hyper3D Rodin image upload state
  const [hyper3dGenerationMode, setHyper3dGenerationMode] = useState<'text' | 'image' | 'mixed'>('text');
  const [hyper3dUploadedImages, setHyper3dUploadedImages] = useState<File[]>([]);
  const [hyper3dImagePreviews, setHyper3dImagePreviews] = useState<string[]>([]);
  const [hyper3dImageUrls, setHyper3dImageUrls] = useState<string[]>([]);
  
  // TripoSR specific settings
  const [imageUrl, setImageUrl] = useState<string>('');
  const [mcResolution, setMcResolution] = useState<number>(256);
  const [doRemoveBackground, setDoRemoveBackground] = useState<boolean>(true);
  const [foregroundRatio, setForegroundRatio] = useState<number>(0.9);
  const [triposrOutputFormat, setTriposrOutputFormat] = useState<'glb' | 'obj'>('glb');
  
  // Hunyuan3D v2 specific settings - Updated to match schema exactly
  const [hunyuan3dUploadedImage, setHunyuan3dUploadedImage] = useState<File | null>(null);
  const [hunyuan3dImagePreview, setHunyuan3dImagePreview] = useState<string>('');
  const [hunyuan3dImageUrl, setHunyuan3dImageUrl] = useState<string>(''); // For API call
  const [octreeResolution, setOctreeResolution] = useState<number>(256);
  const [hunyuan3dGuidanceScale, setHunyuan3dGuidanceScale] = useState<number>(7.5);
  const [hunyuan3dInferenceSteps, setHunyuan3dInferenceSteps] = useState<number>(50);
  const [texturedMesh, setTexturedMesh] = useState<boolean>(false);
  const [hunyuan3dSeed, setHunyuan3dSeed] = useState<string>('');
  
  // File input refs
  const triposrFileInputRef = useRef<HTMLInputElement>(null);
  const hunyuan3dFileInputRef = useRef<HTMLInputElement>(null);
  const hyper3dFileInputRef = useRef<HTMLInputElement>(null);
  
  const [showPromptThemeInput, setShowPromptThemeInput] = useState(false);
  const [promptTheme, setPromptTheme] = useState('');
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptGenerationSuccess, setPromptGenerationSuccess] = useState(false);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [resolution, setResolution] = useState(512);
  const [steps, setSteps] = useState(50);
  const [guidance, setGuidance] = useState(7.5);
  const [seed, setSeed] = useState('');
  const [numGenerations, setNumGenerations] = useState(1);
  const [promptFocused, setPromptFocused] = useState(false);

  // Hunyuan3D v2 image upload handlers
  const handleHunyuan3dImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('Image file size must be less than 10MB.');
      return;
    }

    setHunyuan3dUploadedImage(file);
    
    // Create preview URL
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setHunyuan3dImagePreview(dataUrl);
    };
    reader.readAsDataURL(file);

    // TODO: In production, upload the image to your server/cloud storage and get a public URL
    // Example implementation would call an upload service:
    // uploadImageToServer(file).then(publicUrl => setHunyuan3dImageUrl(publicUrl))
    // For now, we'll create a temporary URL which won't work with the actual API
    const imageUrl = URL.createObjectURL(file);
    setHunyuan3dImageUrl(imageUrl);
    
    console.warn('Note: Using temporary local URL. In production, upload image to server first to get public URL for API.');
  };

  const handleHunyuan3dImageRemove = () => {
    setHunyuan3dUploadedImage(null);
    setHunyuan3dImagePreview('');
    setHunyuan3dImageUrl('');
    if (hunyuan3dFileInputRef.current) {
      hunyuan3dFileInputRef.current.value = '';
    }
  };

  const handleHunyuan3dImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      // Simulate file input change
      const input = hunyuan3dFileInputRef.current;
      if (input) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  };

  const handleHunyuan3dImageDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // TripoSR image upload handlers (similar pattern)
  const handleTriposrImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('Image file size must be less than 10MB.');
      return;
    }

    // TODO: In production, upload the image to your server/cloud storage and get a public URL
    // For now, create a temporary URL which won't work with the actual API
    const imageUrl = URL.createObjectURL(file);
    setImageUrl(imageUrl);
    
    console.warn('Note: Using temporary local URL for TripoSR. In production, upload image to server first to get public URL for API.');
  };

  const handleTriposrImageRemove = () => {
    setImageUrl('');
    if (triposrFileInputRef.current) {
      triposrFileInputRef.current.value = '';
    }
  };

  const checkTokenAvailability = () => {
    setIsCheckingToken(true);
    const tokens = checkApiTokens();
    setApiTokenAvailable(tokens.replicate);
    setIsCheckingToken(false);
  };

  const handleTokenSaved = () => {
    checkTokenAvailability();
  };

  const handleGeneratePrompt = async () => {
    setIsGeneratingPrompt(true);

    setTimeout(() => {
      const basePrompts = [
        "A detailed 3D model of a SUBJECT with DETAIL_1 and DETAIL_2, STYLE",
        "SUBJECT with DETAIL_1, highly detailed 3D model, STYLE",
        "3D rendering of SUBJECT featuring DETAIL_1, STYLE, high-quality textures",
        "Detailed 3D model of SUBJECT with DETAIL_1 and DETAIL_2, STYLE, professional rendering"
      ];

      const subjects = ['fantasy castle', 'futuristic spacecraft', 'cyberpunk city', 'modern furniture', 'mythical creature', 'sports car'];
      const details = ['intricate textures', 'detailed geometry', 'realistic proportions', 'high-quality materials', 'ambient lighting', 'photorealistic rendering'];
      const styles = ['detailed 3D render', 'octane render', 'unreal engine', 'cinema 4D', 'blender render', 'physically based rendering'];

      const currentModelFamily = modelFamilies.find(m => m.id.startsWith(selectedModel.split('-')[0]));
      const currentModelName = currentModelFamily?.name || selectedModel;

      const subject = promptTheme || subjects[Math.floor(Math.random() * subjects.length)];
      const template = basePrompts[Math.floor(Math.random() * basePrompts.length)];
      const detail1 = details[Math.floor(Math.random() * details.length)];
      const detail2 = details[Math.floor(Math.random() * details.length)];
      const style = styles[Math.floor(Math.random() * styles.length)];

      let generatedPrompt = template
        .replace('SUBJECT', subject)
        .replace('DETAIL_1', detail1)
        .replace('DETAIL_2', detail2)
        .replace('STYLE', style);

      // Add model name context if helpful
      // generatedPrompt += `, using ${currentModelName} style`;

      const negativePromptBase = "low quality, low poly, simplistic, blurry textures, incomplete, deformed, unrefined, text, words, letters, signature, watermark";

      setPrompt(generatedPrompt);
      setNegativePrompt(negativePromptBase);
      setIsGeneratingPrompt(false);
      setPromptGenerationSuccess(true);

      setTimeout(() => {
        setPromptGenerationSuccess(false);
      }, 3000);
    }, 1500);
  };

  const handleGenerate = async () => {
    // Check model-specific requirements
    if (selectedModel === 'fal-ai/triposr') {
      if (!imageUrl) {
        alert('Please upload an image for TripoSR before generating');
        return;
      }
    } else if (selectedModel === 'fal-ai/hunyuan3d/v2') {
      if (!hunyuan3dUploadedImage || !hunyuan3dImageUrl) {
        alert('Please upload an image for Hunyuan3D v2 before generating');
        return;
      }
    } else if (selectedModel === 'fal-ai/hyper3d/rodin') {
      if (hyper3dGenerationMode === 'text') {
    if (!prompt.trim()) {
          alert('Please enter a text prompt for text-to-3D generation');
          return;
        }
      } else if (hyper3dGenerationMode === 'image') {
        if (hyper3dUploadedImages.length === 0) {
          alert('Please upload at least one image for image-to-3D generation');
          return;
        }
      } else if (hyper3dGenerationMode === 'mixed') {
        if (!prompt.trim() && hyper3dUploadedImages.length === 0) {
          alert('Please provide either a text prompt or upload images for mixed mode generation');
          return;
        }
      }
    } else if (!prompt.trim()) {
      alert('Please enter a prompt before generating');
      return;
    }

    // Check if this is a real fal.ai model
    if (selectedModel === 'fal-ai/hunyuan3d/v2') {
      setIsGenerating(true);

      try {
        // Prepare settings for Hunyuan3D v2
        const settings: ThreeDGenerationSettings = {
          input_image_url: hunyuan3dImageUrl,
          octree_resolution: octreeResolution,
          guidance_scale: hunyuan3dGuidanceScale,
          num_inference_steps: hunyuan3dInferenceSteps,
          textured_mesh: texturedMesh,
        };

        // Add seed if provided
        if (hunyuan3dSeed && !isNaN(parseInt(hunyuan3dSeed))) {
          settings.seed = parseInt(hunyuan3dSeed);
        }

        console.log("Generating 3D Model with Hunyuan3D v2:", settings);

        // Generate the model
        const result: ThreeDGenerationResult = await generate3DModel(selectedModel, settings);

        console.log("Generation successful:", result);

        // Create history item from result
        const newItem: ThreeDHistoryItem = {
          id: `model-${Date.now()}`,
          url: result.model_mesh.url,
          type: 'glb', // Hunyuan3D v2 outputs GLB format
          thumbnailUrl: result.textures?.[0]?.url || result.remeshing_dir?.url,
          prompt: `Image-to-3D: ${hunyuan3dUploadedImage?.name || 'uploaded image'}${texturedMesh ? ' (Textured)' : ' (White Mesh)'}`,
          timestamp: new Date(),
          metadata: {
            model: selectedModel,
            seed: result.seed,
            file_name: result.model_mesh.file_name,
            file_size: result.model_mesh.file_size,
            content_type: result.model_mesh.content_type,
            settings: settings,
            timings: result.timings,
            remeshing_dir: result.remeshing_dir,
          }
        };

        // Set as current preview and add to history
        setCurrentPreview(newItem);
        setHistory3D(prev => [newItem, ...prev]);

        alert(`3D model generated successfully! ${texturedMesh ? 'Textured mesh' : 'White mesh'} in GLB format.`);

      } catch (error) {
        console.error('Error generating 3D model:', error);
        alert(`Error generating 3D model: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setIsGenerating(false);
      }
      
      return; // Exit early for Hunyuan3D v2
    }

    if (selectedModel === 'fal-ai/triposr') {
      setIsGenerating(true);

      try {
        // Prepare settings for TripoSR
        const settings: ThreeDGenerationSettings = {
          image_url: imageUrl,
          mc_resolution: mcResolution,
          do_remove_background: doRemoveBackground,
          foreground_ratio: foregroundRatio,
          output_format: triposrOutputFormat,
        };

        console.log("Generating 3D Model with TripoSR:", settings);

        // Generate the model
        const result: ThreeDGenerationResult = await generate3DModel(selectedModel, settings);

        console.log("Generation successful:", result);

        // Create history item from result
        const newItem: ThreeDHistoryItem = {
          id: `model-${Date.now()}`,
          url: result.model_mesh.url,
          type: triposrOutputFormat,
          thumbnailUrl: result.textures?.[0]?.url || result.remeshing_dir?.url, // Use texture or remeshing dir as thumbnail
          prompt: `Image-to-3D: ${imageUrl.split('/').pop() || 'uploaded image'}`,
          timestamp: new Date(),
          metadata: {
            model: selectedModel,
            file_name: result.model_mesh.file_name,
            file_size: result.model_mesh.file_size,
            content_type: result.model_mesh.content_type,
            settings: settings,
            timings: result.timings,
            remeshing_dir: result.remeshing_dir,
          }
        };

        // Set as current preview and add to history
        setCurrentPreview(newItem);
        setHistory3D(prev => [newItem, ...prev]);

        alert(`3D model generated successfully! Format: ${triposrOutputFormat.toUpperCase()}`);

      } catch (error) {
        console.error('Error generating 3D model:', error);
        alert(`Error generating 3D model: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setIsGenerating(false);
      }
      
      return; // Exit early for TripoSR
    }

    if (selectedModel === 'fal-ai/hyper3d/rodin') {
      setIsGenerating(true);

      try {
        // Parse bounding box condition if provided
        let parsedBboxCondition: number[] | null = null;
        if (bboxCondition.trim()) {
          try {
            parsedBboxCondition = JSON.parse(`[${bboxCondition}]`);
          } catch (e) {
            console.warn('Invalid bbox condition format, ignoring:', bboxCondition);
          }
        }

        // Prepare settings for Hyper3D Rodin
        const settings: ThreeDGenerationSettings = {
          prompt: prompt.trim(),
          condition_mode: conditionMode,
          tier: tier,
          quality: quality,
          geometry_file_format: geometryFileFormat,
          material: material,
          TAPose: taPose,
          use_hyper: useHyper,
          addons: addons,
          bbox_condition: parsedBboxCondition,
          input_image_urls: hyper3dImageUrls.length > 0 ? hyper3dImageUrls : undefined,
        };

        // Add seed if provided
        if (seed && !isNaN(parseInt(seed))) {
          settings.seed = parseInt(seed);
        }

        console.log("Generating 3D Model with Hyper3D Rodin:", settings);

        // Generate the model
        const result: ThreeDGenerationResult = await generate3DModel(selectedModel, settings);

        console.log("Generation successful:", result);

        // Create history item from result
        const newItem: ThreeDHistoryItem = {
          id: `model-${Date.now()}`,
          url: result.model_mesh.url,
          type: geometryFileFormat,
          thumbnailUrl: result.textures?.[0]?.url, // Use first texture as thumbnail if available
          prompt: prompt,
          timestamp: new Date(),
          metadata: {
            model: selectedModel,
            seed: result.seed,
            file_name: result.model_mesh.file_name,
            file_size: result.model_mesh.file_size,
            content_type: result.model_mesh.content_type,
            settings: settings,
            textures: result.textures,
          }
        };

        // Set as current preview and add to history
        setCurrentPreview(newItem);
        setHistory3D(prev => [newItem, ...prev]);

        alert(`3D model generated successfully! Format: ${geometryFileFormat.toUpperCase()}`);

      } catch (error) {
        console.error('Error generating 3D model:', error);
        alert(`Error generating 3D model: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setIsGenerating(false);
      }
      
      return; // Exit early for real model
    }

    // --- MOCK API CALL for other models ---
    if (!apiTokenAvailable) {
      alert('API token required to generate 3D models');
      return;
    }

    setIsGenerating(true);
    const useSeed = seed ? parseInt(seed) : Math.floor(Math.random() * 1000000);

    console.log("Generating 3D Model(s) with parameters (MOCK):", {
      prompt,
      negativePrompt,
      model: selectedModel,
      resolution,
      steps,
      guidance,
      seed: useSeed,
      count: numGenerations
    });

    // Simulate generating 'numGenerations' models
    setTimeout(() => {
      const generatedItems: ThreeDHistoryItem[] = [];
      const modelsToGenerate = Math.min(numGenerations, 4);

      for (let i = 0; i < modelsToGenerate; i++) {
        const modelId = `model-${Date.now()}-${i}`;
        const modelType: 'glb' | 'obj' | 'gltf' = 'glb';
        const modelUrl = `https://example.com/models/${modelId}.${modelType}`;
        const keywords = prompt.split(' ').filter(word => word.length > 3).slice(0, 3).join(',');
        const thumbnailUrl = `https://source.unsplash.com/random/300x200?3d,model,${keywords}&sig=${Math.random()}-${i}`;

        const newItem: ThreeDHistoryItem = {
          id: modelId,
          url: modelUrl,
          type: modelType,
          thumbnailUrl: thumbnailUrl,
          prompt: prompt,
          timestamp: new Date(),
          metadata: {
            model: selectedModel,
            resolution: resolution,
            steps: steps,
            guidance: guidance,
            seed: useSeed,
            negativePrompt: negativePrompt,
          }
        };
        generatedItems.push(newItem);
      }

      console.log("Mock Generation Complete:", generatedItems.map(item => item.url));

      if (generatedItems.length > 0) {
        setCurrentPreview(generatedItems[0]);
      }
      
      setHistory3D(prev => [...generatedItems, ...prev]);
      setIsGenerating(false);

    }, 3000 + Math.random() * 2000);
    // --- END MOCK API CALL ---
  };

  // Function to set a history item as the current preview
  const handleSelectHistoryItem = (item: ThreeDHistoryItem) => {
    setCurrentPreview(item);
  };
  
  // Function to clear history
  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear your 3D generation history?')) {
      setHistory3D([]);
      setCurrentPreview(null);
    }
  };

  useEffect(() => {
    checkTokenAvailability();
  }, []);

  // Find details for the currently previewed model
  const currentPreviewModelDetails = currentPreview?.metadata?.model 
    ? modelFamilies.flatMap(f => f.submodels).find(s => s.id === currentPreview.metadata.model)
    : null;
  const currentPreviewModelFamily = currentPreview?.metadata?.model
    ? modelFamilies.find(f => f.submodels.some(s => s.id === currentPreview.metadata.model))
    : null;

  // Hyper3D Rodin image upload handlers
  const handleHyper3dImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Validate files
    const invalidFiles = files.filter(file => !file.type.startsWith('image/'));
    if (invalidFiles.length > 0) {
      alert('Please select only image files.');
      return;
    }

    // Validate file sizes (max 10MB each)
    const oversizedFiles = files.filter(file => file.size > 10 * 1024 * 1024);
    if (oversizedFiles.length > 0) {
      alert('Each image must be less than 10MB.');
      return;
    }

    // Limit to 5 images max for practical UI reasons
    const totalImages = hyper3dUploadedImages.length + files.length;
    if (totalImages > 5) {
      alert('Maximum 5 images allowed. Please remove some images first.');
      return;
    }

    // Add files to state
    setHyper3dUploadedImages(prev => [...prev, ...files]);

    // Create preview URLs
    const newPreviews = files.map(file => {
      const reader = new FileReader();
      return new Promise<string>((resolve) => {
        reader.onload = (event) => {
          resolve(event.target?.result as string);
        };
        reader.readAsDataURL(file);
      });
    });

    Promise.all(newPreviews).then(previews => {
      setHyper3dImagePreviews(prev => [...prev, ...previews]);
    });

    // TODO: In production, upload images to server/cloud storage and get public URLs
    const newUrls = files.map(file => URL.createObjectURL(file));
    setHyper3dImageUrls(prev => [...prev, ...newUrls]);
    setInputImageUrls(prev => [...prev, ...newUrls]); // Update the existing state for API compatibility
    
    console.warn('Note: Using temporary local URLs for Hyper3D Rodin. In production, upload images to server first to get public URLs for API.');
  };

  const handleHyper3dImageRemove = (index: number) => {
    // Revoke the URL to prevent memory leaks
    URL.revokeObjectURL(hyper3dImageUrls[index]);
    
    // Remove from all related state arrays
    setHyper3dUploadedImages(prev => prev.filter((_, i) => i !== index));
    setHyper3dImagePreviews(prev => prev.filter((_, i) => i !== index));
    setHyper3dImageUrls(prev => prev.filter((_, i) => i !== index));
    setInputImageUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleHyper3dClearAllImages = () => {
    // Revoke all URLs
    hyper3dImageUrls.forEach(url => URL.revokeObjectURL(url));
    
    // Clear all image state
    setHyper3dUploadedImages([]);
    setHyper3dImagePreviews([]);
    setHyper3dImageUrls([]);
    setInputImageUrls([]);
    
    // Reset file input
    if (hyper3dFileInputRef.current) {
      hyper3dFileInputRef.current.value = '';
    }
  };

  const handleHyper3dImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
    if (files.length > 0) {
      // Simulate file input change
      const input = hyper3dFileInputRef.current;
      if (input) {
        const dataTransfer = new DataTransfer();
        files.forEach(file => dataTransfer.items.add(file));
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  };

  const handleHyper3dImageDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
  <div className="flex flex-col h-full w-full min-w-0 min-h-0">
      {!apiTokenAvailable && !isCheckingToken && ( // Added !isCheckingToken check
        <ApiTokenNotice
          serviceKey="replicate" // Or appropriate service key
          onTokenSaved={handleTokenSaved}
        />
      )}

      {/* Main Two-Panel Layout - Adopt structure from VideoGenerationInterface */}
      {/* Use lg:flex-row for large screens, flex-col for smaller */}
      <div className="flex flex-col lg:flex-row h-full relative">

        {/* Left Panel: Controls - Adopt structure from VideoGenerationInterface */}
        {/* Use fixed width on large screens */}
        <div className="lg:w-[30%] lg:max-w-[350px] pr-1 pl-0">
          {/* Controls Card */}
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 space-y-2 h-full flex flex-col">
             {/* Keep existing header or adapt if needed */}
             <h2 className="text-base font-semibold text-white flex items-center flex-shrink-0">
              {/* Removed mb-2 to match video interface spacing */}
              {/* <Box size={16} className="mr-2 text-cyan-400" /> 3D Generation Controls */}
             </h2>

            {/* Model selector - Fixed at top */}
            <div className="flex-shrink-0">
            <ModelSelector
              selectedModel={selectedModel}
              onChange={setSelectedModel}
              disabled={isGenerating}
            />
            </div>

            {/* Spacer like in video interface */}
            <div className="mt-2 flex-shrink-0"></div>

            {/* Scrollable content area - This will take available space and scroll if needed */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent space-y-2 pr-1">
            {/* Prompt input OR Image input depending on model */}
              <div className="space-y-2">
              {/* Show image upload for image-to-3D models */}
              {(selectedModel === 'fal-ai/triposr' || selectedModel === 'fal-ai/hunyuan3d/v2') ? (
                <div>
                  <label className="block text-xs text-white/70 mb-1.5">
                    {selectedModel === 'fal-ai/triposr' ? 'Input Image for TripoSR' : 'Input Image for Hunyuan3D v2'}
                    <span className="text-red-400 ml-1">*</span>
                  </label>
                  
                  {/* Hunyuan3D v2 Image Upload */}
                  {selectedModel === 'fal-ai/hunyuan3d/v2' && (
                    <>
                      <input
                        type="file"
                        ref={hunyuan3dFileInputRef}
                        onChange={handleHunyuan3dImageUpload}
                        accept="image/*"
                        className="hidden"
                      />
                      {!hunyuan3dImagePreview ? (
                        <div
                          onClick={() => hunyuan3dFileInputRef.current?.click()}
                          onDrop={handleHunyuan3dImageDrop}
                          onDragOver={handleHunyuan3dImageDragOver}
                          className="w-full h-32 border-2 border-dashed border-white/20 rounded-lg flex flex-col items-center justify-center text-white/60 hover:bg-white/5 hover:border-white/30 transition-colors cursor-pointer"
                        >
                          <ImageIcon size={32} className="mb-2 text-red-400" />
                          <span className="text-sm font-medium">Click to Upload Image</span>
                          <span className="text-xs mt-1">or drag and drop</span>
                          <span className="text-xs text-white/40 mt-1">PNG, JPG, WEBP (max 10MB)</span>
                        </div>
                      ) : (
                        <div className="relative w-full h-32 bg-black/30 rounded-lg overflow-hidden border border-white/10 group">
                          <img
                            src={hunyuan3dImagePreview}
                            alt="Upload Preview"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                              onClick={() => hunyuan3dFileInputRef.current?.click()}
                              className="mr-2 px-3 py-1 bg-white/20 text-white text-xs rounded hover:bg-white/30 transition-colors"
                            >
                              Change
                            </button>
                            <button
                              onClick={handleHunyuan3dImageRemove}
                              className="px-3 py-1 bg-red-600/80 text-white text-xs rounded hover:bg-red-700 transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                          <button
                            onClick={handleHunyuan3dImageRemove}
                            className="absolute top-2 right-2 p-1 bg-red-700/80 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  
                  {/* TripoSR Image Upload */}
                  {selectedModel === 'fal-ai/triposr' && (
                    <>
                      <input
                        type="file"
                        ref={triposrFileInputRef}
                        onChange={handleTriposrImageUpload}
                        accept="image/*"
                        className="hidden"
                      />
                      {!imageUrl ? (
                        <div
                          onClick={() => triposrFileInputRef.current?.click()}
                          className="w-full h-32 border-2 border-dashed border-white/20 rounded-lg flex flex-col items-center justify-center text-white/60 hover:bg-white/5 hover:border-white/30 transition-colors cursor-pointer"
                        >
                          <ImageIcon size={32} className="mb-2 text-emerald-400" />
                          <span className="text-sm font-medium">Click to Upload Image</span>
                          <span className="text-xs mt-1">or drag and drop</span>
                          <span className="text-xs text-white/40 mt-1">PNG, JPG, WEBP (max 10MB)</span>
                        </div>
                      ) : (
                        <div className="relative w-full h-32 bg-black/30 rounded-lg overflow-hidden border border-white/10 group">
                          <img
                            src={imageUrl}
                            alt="Upload Preview"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                              onClick={() => triposrFileInputRef.current?.click()}
                              className="mr-2 px-3 py-1 bg-white/20 text-white text-xs rounded hover:bg-white/30 transition-colors"
                            >
                              Change
                            </button>
                            <button
                              onClick={handleTriposrImageRemove}
                              className="px-3 py-1 bg-red-600/80 text-white text-xs rounded hover:bg-red-700 transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                          <button
                            onClick={handleTriposrImageRemove}
                            className="absolute top-2 right-2 p-1 bg-red-700/80 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : selectedModel === 'fal-ai/hyper3d/rodin' ? (
                /* Hyper3D Rodin - Support both text-to-3D and image-to-3D */
                <div className="space-y-3">
                  {/* Generation Mode Selector */}
                  <div>
                    <label className="block text-xs text-white/70 mb-1.5">Generation Mode</label>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setHyper3dGenerationMode('text')}
                        disabled={isGenerating}
                        className={`flex-1 px-3 py-2 rounded text-xs transition-colors ${
                          hyper3dGenerationMode === 'text'
                            ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                            : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                        }`}
                      >
                        Text-to-3D
                      </button>
                      <button
                        onClick={() => setHyper3dGenerationMode('image')}
                        disabled={isGenerating}
                        className={`flex-1 px-3 py-2 rounded text-xs transition-colors ${
                          hyper3dGenerationMode === 'image'
                            ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                            : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                        }`}
                      >
                        Image-to-3D
                      </button>
                      <button
                        onClick={() => setHyper3dGenerationMode('mixed')}
                        disabled={isGenerating}
                        className={`flex-1 px-3 py-2 rounded text-xs transition-colors ${
                          hyper3dGenerationMode === 'mixed'
                            ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                            : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                        }`}
                      >
                        Mixed Mode
                      </button>
                    </div>
                  </div>

                  {/* Text Prompt - Show for text and mixed modes */}
                  {(hyper3dGenerationMode === 'text' || hyper3dGenerationMode === 'mixed') && (
              <div className="relative">
                      <label className="block text-xs text-white/70 mb-1.5">
                        Text Prompt
                        {hyper3dGenerationMode === 'text' && <span className="text-red-400 ml-1">*</span>}
                      </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                        placeholder={hyper3dGenerationMode === 'mixed' ? 'Optional: Add text guidance...' : ''}
                        className="w-full h-20 bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                        disabled={isGenerating}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.ctrlKey) {
                            handleGenerate();
                          }
                        }}
                      />
                      {!prompt && !isGenerating && hyper3dGenerationMode === 'text' && (
                        <div className="absolute top-[36px] left-[16px] text-xs pointer-events-none flex items-center tracking-normal font-normal">
                          <span className="text-white/30">Describe the 3D model...</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Image Upload - Show for image and mixed modes */}
                  {(hyper3dGenerationMode === 'image' || hyper3dGenerationMode === 'mixed') && (
                    <div>
                      <label className="block text-xs text-white/70 mb-1.5">
                        Input Images for Hyper3D Rodin
                        {hyper3dGenerationMode === 'image' && <span className="text-red-400 ml-1">*</span>}
                        <span className="text-blue-400 ml-1">(Up to 5 images)</span>
                      </label>
                      
                      <input
                        type="file"
                        ref={hyper3dFileInputRef}
                        onChange={handleHyper3dImageUpload}
                        accept="image/*"
                        multiple
                        className="hidden"
                      />
                      
                      {/* Upload Area */}
                      <div
                        onClick={() => hyper3dFileInputRef.current?.click()}
                        onDrop={handleHyper3dImageDrop}
                        onDragOver={handleHyper3dImageDragOver}
                        className="w-full h-24 border-2 border-dashed border-white/20 rounded-lg flex flex-col items-center justify-center text-white/60 hover:bg-white/5 hover:border-white/30 transition-colors cursor-pointer mb-2"
                      >
                        <ImageIcon size={24} className="mb-1 text-blue-400" />
                        <span className="text-xs font-medium">Click to Upload Images</span>
                        <span className="text-xs text-white/40">PNG, JPG, WEBP (max 10MB each)</span>
                      </div>

                      {/* Image Previews */}
                      {hyper3dImagePreviews.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-white/60">{hyper3dImagePreviews.length} image(s) uploaded</span>
                            <button
                              onClick={handleHyper3dClearAllImages}
                              className="text-xs text-red-400 hover:text-red-300"
                            >
                              Clear All
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {hyper3dImagePreviews.map((preview, index) => (
                              <div key={index} className="relative group">
                                <img
                                  src={preview}
                                  alt={`Upload ${index + 1}`}
                                  className="w-full h-16 object-cover rounded border border-white/10"
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleHyper3dImageRemove(index);
                                  }}
                                  className="absolute top-1 right-1 p-0.5 bg-red-700/80 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                                >
                                  <X size={10} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Show prompt input for other text-to-3D models */
                <div className="relative">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  placeholder="" // Clear placeholder
                  className="w-full h-24 bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                  disabled={isGenerating}
                  onKeyDown={(e) => { // Add Ctrl+Enter shortcut
                    if (e.key === 'Enter' && e.ctrlKey) {
                      handleGenerate();
                    }
                  }}
                />
                {/* Placeholder text like in video interface */}
                  {!prompt && !isGenerating && (
                  <div
                    className="absolute top-[12px] left-[16px] text-xs pointer-events-none flex items-center tracking-normal font-normal"
                  >
                    <span className="text-white/30">Describe the 3D model...</span>
                  </div>
                )}
              </div>
              )}
            </div>

              {/* Negative prompt - Only show for text-to-3D models */}
              {selectedModel !== 'fal-ai/triposr' && selectedModel !== 'fal-ai/hunyuan3d/v2' && 
               !(selectedModel === 'fal-ai/hyper3d/rodin' && hyper3dGenerationMode === 'image') && (
                <div className="space-y-2">
                <label className="block text-xs text-white/70">Negative Prompt</label>
                <textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="E.g., low quality, blurry, text, words"
                  className="w-full h-16 bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                  disabled={isGenerating}
                />
              </div>
              )}

            {/* Credit usage info */}
              <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg px-1.5 py-2.5 min-h-[40px] flex items-center">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center text-white/70">
                  <Info size={10} className="mr-1" />
                  <span className="text-xs">Credit usage</span>
                </div>
                <div className="text-xs">
                    {selectedModel === 'fal-ai/hyper3d/rodin' ? (
                      <>
                        <span className="text-white/90 font-medium">
                          ~{addons === 'HighPack' ? 300 : 100} credits
                        </span>
                  <span className="text-white/50 ml-1">per model</span>
                        <div className="text-blue-400 text-[10px] mt-0.5">
                          {hyper3dGenerationMode === 'text' ? 'Text-to-3D' : 
                           hyper3dGenerationMode === 'image' ? 'Image-to-3D' : 
                           'Mixed mode'}
                          {addons === 'HighPack' && ' • HighPack'}
                </div>
                      </>
                    ) : selectedModel === 'fal-ai/hunyuan3d/v2' ? (
                      <>
                        <span className="text-white/90 font-medium">
                          ~{texturedMesh ? 210 : 70} credits
                        </span>
                        <span className="text-white/50 ml-1">per model</span>
                        <div className="text-red-400 text-[10px] mt-0.5">
                          {texturedMesh ? 'Textured mesh' : 'White mesh'}
                        </div>
                      </>
                    ) : selectedModel === 'fal-ai/triposr' ? (
                      <>
                        <span className="text-white/90 font-medium">~50 credits</span>
                        <span className="text-white/50 ml-1">per model</span>
                        <div className="text-emerald-400 text-[10px] mt-0.5">Fast image-to-3D</div>
                      </>
                    ) : (
                      <>
                        <span className="text-white/90 font-medium">~100 credits</span>
                        <span className="text-white/50 ml-1">per model</span>
                      </>
                    )}
                </div>
              </div>
            </div>

              {/* Parameters controls - Scrollable section */}
              <div className="space-y-2">
                {/* Hyper3D Rodin Model-specific settings */}
                {selectedModel === 'fal-ai/hyper3d/rodin' && (
                  <>
                    {/* Condition Mode - Only show when using images */}
                    {(hyper3dGenerationMode === 'image' || hyper3dGenerationMode === 'mixed') && hyper3dUploadedImages.length > 0 && (
                      <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-white/70 text-xs">Condition Mode</span>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => setConditionMode('fuse')}
                            disabled={isGenerating}
                            className={`flex-1 px-3 py-2 rounded text-xs transition-colors ${
                              conditionMode === 'fuse'
                                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                                : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                            }`}
                          >
                            Fuse
                          </button>
                          <button
                            onClick={() => setConditionMode('concat')}
                            disabled={isGenerating}
                            className={`flex-1 px-3 py-2 rounded text-xs transition-colors ${
                              conditionMode === 'concat'
                                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                                : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                            }`}
                          >
                            Concat
                          </button>
                        </div>
                        <div className="mt-1.5 text-[10px] text-white/50">
                          {conditionMode === 'fuse' 
                            ? 'Fuse features from multiple images' 
                            : 'Use multi-view images of same object'}
                        </div>
                      </div>
                    )}

                    {/* Quality Setting */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white/70 text-xs">Quality</span>
                        <span className="text-white/70 text-xs">{quality}</span>
                      </div>
                      <div className="flex space-x-1">
                        {(['extra-low', 'low', 'medium', 'high'] as const).map((q) => (
                          <button
                            key={q}
                            onClick={() => setQuality(q)}
                            disabled={isGenerating}
                            className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
                              quality === q
                                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                                : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                            }`}
                          >
                            {q.replace('-', ' ')}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Tier Setting */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white/70 text-xs">Generation Tier</span>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => setTier('Regular')}
                          disabled={isGenerating}
                          className={`flex-1 px-3 py-2 rounded text-xs transition-colors ${
                            tier === 'Regular'
                              ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                              : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          Regular
                        </button>
                        <button
                          onClick={() => setTier('Sketch')}
                          disabled={isGenerating}
                          className={`flex-1 px-3 py-2 rounded text-xs transition-colors ${
                            tier === 'Sketch'
                              ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                              : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          Sketch
                        </button>
                      </div>
                    </div>

                    {/* Geometry File Format */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white/70 text-xs">Output Format</span>
                        <span className="text-white/70 text-xs">{geometryFileFormat.toUpperCase()}</span>
                      </div>
                      <select
                        value={geometryFileFormat}
                        onChange={(e) => setGeometryFileFormat(e.target.value as any)}
                        disabled={isGenerating}
                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                      >
                        <option value="glb">GLB (Recommended)</option>
                        <option value="usdz">USDZ (iOS/Apple)</option>
                        <option value="fbx">FBX (Animation)</option>
                        <option value="obj">OBJ (Universal)</option>
                        <option value="stl">STL (3D Printing)</option>
                      </select>
                    </div>

                    {/* Material Type */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white/70 text-xs">Material Type</span>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => setMaterial('PBR')}
                          disabled={isGenerating}
                          className={`flex-1 px-3 py-2 rounded text-xs transition-colors ${
                            material === 'PBR'
                              ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                              : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          PBR
                        </button>
                        <button
                          onClick={() => setMaterial('Shaded')}
                          disabled={isGenerating}
                          className={`flex-1 px-3 py-2 rounded text-xs transition-colors ${
                            material === 'Shaded'
                              ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                              : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          Shaded
                        </button>
                      </div>
                    </div>

                    {/* Advanced Options */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white/70 text-xs">Advanced Options</span>
                      </div>
                      
                      {/* T/A Pose Toggle */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white/70 text-xs">T/A Pose (Humans)</span>
                        <button
                          onClick={() => setTaPose(!taPose)}
                          disabled={isGenerating}
                          className={`relative inline-flex h-5 w-8 rounded-full transition-colors ${
                            taPose ? 'bg-blue-600' : 'bg-black/30'
                          }`}
                        >
                          <span
                            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                              taPose ? 'translate-x-4' : 'translate-x-1'
                            } mt-1`}
                          />
                        </button>
                      </div>

                      {/* Use Hyper Toggle */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white/70 text-xs">Hyper Mode</span>
                        <button
                          onClick={() => setUseHyper(!useHyper)}
                          disabled={isGenerating}
                          className={`relative inline-flex h-5 w-8 rounded-full transition-colors ${
                            useHyper ? 'bg-blue-600' : 'bg-black/30'
                          }`}
                        >
                          <span
                            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                              useHyper ? 'translate-x-4' : 'translate-x-1'
                            } mt-1`}
                          />
                        </button>
                      </div>

                      {/* HighPack Addon */}
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-white/70 text-xs">HighPack (4K)</span>
                          <div className="text-yellow-400 text-[10px]">3x credits</div>
                        </div>
                        <button
                          onClick={() => setAddons(addons === 'HighPack' ? null : 'HighPack')}
                          disabled={isGenerating}
                          className={`relative inline-flex h-5 w-8 rounded-full transition-colors ${
                            addons === 'HighPack' ? 'bg-yellow-600' : 'bg-black/30'
                          }`}
                        >
                          <span
                            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                              addons === 'HighPack' ? 'translate-x-4' : 'translate-x-1'
                            } mt-1`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Bounding Box Condition (Optional) */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white/70 text-xs">Bounding Box (X,Y,Z)</span>
                      </div>
                      <input
                        type="text"
                        value={bboxCondition}
                        onChange={(e) => setBboxCondition(e.target.value)}
                        placeholder="e.g., 100,50,150"
                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                        disabled={isGenerating}
                      />
                    </div>
                  </>
                )}

                {/* TripoSR Model-specific settings */}
                {selectedModel === 'fal-ai/triposr' && (
                  <>
                    {/* Output Format */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white/70 text-xs">Output Format</span>
                        <span className="text-white/70 text-xs">{triposrOutputFormat.toUpperCase()}</span>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => setTriposrOutputFormat('glb')}
                          disabled={isGenerating}
                          className={`flex-1 px-3 py-2 rounded text-xs transition-colors ${
                            triposrOutputFormat === 'glb'
                              ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                              : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          GLB
                        </button>
                        <button
                          onClick={() => setTriposrOutputFormat('obj')}
                          disabled={isGenerating}
                          className={`flex-1 px-3 py-2 rounded text-xs transition-colors ${
                            triposrOutputFormat === 'obj'
                              ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                              : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          OBJ
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Hunyuan3D v2 Model-specific settings */}
                {selectedModel === 'fal-ai/hunyuan3d/v2' && (
                  <>
                    {/* Textured Mesh Toggle */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-white/70 text-xs">Textured Mesh</span>
                          <div className="text-red-400 text-[10px]">3x credits when enabled</div>
                        </div>
                        <button
                          onClick={() => setTexturedMesh(!texturedMesh)}
                          disabled={isGenerating}
                          className={`relative inline-flex h-5 w-8 rounded-full transition-colors ${
                            texturedMesh ? 'bg-red-600' : 'bg-black/30'
                          }`}
                        >
                          <span
                            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                              texturedMesh ? 'translate-x-4' : 'translate-x-1'
                            } mt-1`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Octree Resolution */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white/70 text-xs">Octree Resolution</span>
                        <span className="text-white/70 text-xs">{octreeResolution}</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="1024"
                        step="32"
                        value={octreeResolution}
                        onChange={(e) => setOctreeResolution(parseInt(e.target.value))}
                        className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-red-500"
                        disabled={isGenerating}
                      />
                      <div className="flex justify-between text-[10px] text-white/50 mt-1">
                        <span>1 (Minimal)</span>
                        <span>1024 (Maximum)</span>
                      </div>
                    </div>
              
              {/* Guidance Scale */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-white/70 text-xs">Guidance Scale</span>
                        <span className="text-white/70 text-xs">{hunyuan3dGuidanceScale.toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="20"
                        step="0.5"
                        value={hunyuan3dGuidanceScale}
                        onChange={(e) => setHunyuan3dGuidanceScale(parseFloat(e.target.value))}
                        className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-red-500"
                        disabled={isGenerating}
                      />
                      <div className="flex justify-between text-[10px] text-white/50 mt-1">
                        <span>0.0 (No guidance)</span>
                        <span>20.0 (Strong)</span>
                      </div>
                    </div>

                    {/* Inference Steps */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white/70 text-xs">Inference Steps</span>
                        <span className="text-white/70 text-xs">{hunyuan3dInferenceSteps}</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="50"
                        step="1"
                        value={hunyuan3dInferenceSteps}
                        onChange={(e) => setHunyuan3dInferenceSteps(parseInt(e.target.value))}
                        className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-red-500"
                        disabled={isGenerating}
                      />
                      <div className="flex justify-between text-[10px] text-white/50 mt-1">
                        <span>1 (Fastest)</span>
                        <span>50 (Best quality)</span>
                      </div>
                    </div>

                    {/* Seed Control */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white/70 text-xs">Seed</span>
                        <button
                          onClick={() => setHunyuan3dSeed(String(Math.floor(Math.random() * 1000000)))}
                          className="text-xs text-red-400 hover:text-red-300"
                          disabled={isGenerating}
                        >
                          Random
                        </button>
                      </div>
                      <input
                        type="number"
                        value={hunyuan3dSeed}
                        onChange={(e) => setHunyuan3dSeed(e.target.value)}
                        placeholder="Random seed"
                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                        disabled={isGenerating}
                      />
                    </div>
                  </>
                )}

                {/* Legacy controls for other models */}
                {selectedModel !== 'fal-ai/hyper3d/rodin' && selectedModel !== 'fal-ai/triposr' && selectedModel !== 'fal-ai/hunyuan3d/v2' && (
                  <>
                    {/* Guidance Scale */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white/70 text-xs">Guidance Scale</span>
                        <span className="text-white/70 text-xs">{guidance.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="0.5"
                  value={guidance}
                  onChange={(e) => setGuidance(parseFloat(e.target.value))}
                        className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-blue-500"
                  disabled={isGenerating}
                />
              </div>

              {/* Inference Steps */}
                    <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-white/70 text-xs">Inference Steps</span>
                  <span className="text-white/70 text-xs">{steps}</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="1"
                  value={steps}
                  onChange={(e) => setSteps(parseInt(e.target.value))}
                        className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-blue-500"
                  disabled={isGenerating}
                />
              </div>
              
                    {/* Number of Generations Control for legacy models */}
              <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-white/70 text-xs">Number of models</span>
                  <div className="flex items-center justify-end">
                    <button
                      onClick={() => setNumGenerations(prev => Math.max(1, prev - 1))}
                      disabled={numGenerations <= 1 || isGenerating}
                      className={`flex items-center justify-center h-6 w-6 rounded-md ${
                        numGenerations <= 1 || isGenerating
                          ? 'text-white/30 cursor-not-allowed'
                          : 'text-white/80 bg-black/30 hover:bg-black/50'
                      }`}
                    >
                       <svg width="14" height="2" viewBox="0 0 14 2" xmlns="http://www.w3.org/2000/svg">
                         <path d="M0 1h14" stroke="currentColor" strokeWidth="2"/>
                       </svg>
                    </button>
                    <div className="flex items-center justify-center w-8 text-white text-center">
                      {numGenerations}
                    </div>
                    <button
                            onClick={() => setNumGenerations(prev => Math.min(4, prev + 1))}
                      disabled={numGenerations >= 4 || isGenerating}
                      className={`flex items-center justify-center h-6 w-6 rounded-md ${
                        numGenerations >= 4 || isGenerating
                          ? 'text-white/30 cursor-not-allowed'
                          : 'text-white/80 bg-black/30 hover:bg-black/50'
                      }`}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
                  </>
                )}

                {/* Seed Control - Universal */}
                <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-white/70 text-xs">Seed</span>
                  <button
                      onClick={() => setSeed(String(Math.floor(Math.random() * (selectedModel === 'fal-ai/hyper3d/rodin' ? 65535 : 1000000))))}
                    className="text-xs text-blue-400 hover:text-blue-300"
                    disabled={isGenerating}
                  >
                    Random
                  </button>
                </div>
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                    placeholder={selectedModel === 'fal-ai/hyper3d/rodin' ? 'Seed (0-65535)' : 'Random seed'}
                  className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                  disabled={isGenerating}
                    min={selectedModel === 'fal-ai/hyper3d/rodin' ? 0 : undefined}
                    max={selectedModel === 'fal-ai/hyper3d/rodin' ? 65535 : undefined}
                />
                </div>
              </div>
            </div>
            
            {/* Generate button - Fixed at bottom */}
            <div className="flex-shrink-0 pt-2 border-t border-white/10">
              <button
                onClick={handleGenerate}
                disabled={isGenerating || (
                  selectedModel === 'fal-ai/triposr' ? !imageUrl : 
                  selectedModel === 'fal-ai/hunyuan3d/v2' ? !hunyuan3dUploadedImage :
                  selectedModel === 'fal-ai/hyper3d/rodin' ? (
                    hyper3dGenerationMode === 'text' ? !prompt.trim() :
                    hyper3dGenerationMode === 'image' ? hyper3dUploadedImages.length === 0 :
                    hyper3dGenerationMode === 'mixed' ? (!prompt.trim() && hyper3dUploadedImages.length === 0) :
                    false
                  ) :
                  !prompt.trim()
                )}
                className={`w-full p-3 rounded-lg text-white flex items-center justify-center text-xs
                  ${
                    isGenerating
                      ? 'bg-black/50 cursor-not-allowed'
                      : (selectedModel === 'fal-ai/triposr' ? imageUrl : 
                         selectedModel === 'fal-ai/hunyuan3d/v2' ? hunyuan3dUploadedImage :
                         selectedModel === 'fal-ai/hyper3d/rodin' ? (
                           hyper3dGenerationMode === 'text' ? prompt.trim() :
                           hyper3dGenerationMode === 'image' ? hyper3dUploadedImages.length > 0 :
                           hyper3dGenerationMode === 'mixed' ? (prompt.trim() || hyper3dUploadedImages.length > 0) :
                           true
                         ) :
                         prompt.trim())
                        ? 'bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600'
                        : 'bg-zinc-800/40 hover:bg-zinc-800/60 border border-zinc-700/40 opacity-60'
                  }
                `}
              >
                {isGenerating ? (
                  <>
                    <svg className="animate-spin h-3 w-3 mr-1.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating...
                  </>
                ) : (
                  <>
                    <Send size={14} className="mr-1.5" />
                    {selectedModel === 'fal-ai/triposr' || selectedModel === 'fal-ai/hunyuan3d/v2' ? (
                      'Generate 3D Model'
                    ) : selectedModel === 'fal-ai/hyper3d/rodin' ? (
                      `Generate 3D Model (${hyper3dGenerationMode})`
                    ) : (
                      `Generate ${numGenerations > 1 ? `${numGenerations} Models` : 'Model'}`
                    )}
                  </>
                )}
              </button>
            </div>
          </div>
        </div> {/* End Left Panel */}

        {/* Right Panel: Preview & History - Adopt structure from VideoGenerationInterface */}
        <div className="flex-1 lg:pl-2 lg:pr-0 pt-0 flex flex-col">
          {/* Container 1: Preview Area - Fixed height like video */}
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-4 flex flex-col"
               style={{ height: 'calc(100% - 120px - 8px)', minHeight: '400px' }}> {/* Dynamic height minus history and gap */}

            {/* Preview Controls (Top Right) */}
            <div className="flex items-center justify-end mb-2 flex-shrink-0">
              {currentPreview && (
                <div className="flex space-x-2">
                  {/* Download Button */}
                  <a // Use anchor for direct download
                    href={currentPreview.url}
                    download={`generated_model_${currentPreview.id}.${currentPreview.type}`}
                    className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title={`Download ${currentPreview.type.toUpperCase()} model`}
                  >
                    <Download size={18} />
                  </a>
                  {/* Copy Link Button */}
                  <button
                    className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="Copy Model URL"
                    onClick={() => navigator.clipboard.writeText(currentPreview.url).then(() => alert('Link copied!'))} // Add notification feedback
                  >
                    <Copy size={18} />
                  </button>
                  {/* Share Button (Placeholder) */}
                  <button
                    className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="Share (Placeholder)"
                    onClick={() => alert(`Sharing 3D model (URL: ${currentPreview.url})`)}
                  >
                    <Share2 size={18} />
                  </button>
                   {/* Clear History Button */}
                  <button
                    onClick={handleClearHistory}
                    className="p-2 text-red-500/70 hover:text-red-500 hover:bg-red-900/20 rounded-lg transition-colors"
                    title="Clear History"
                  >
                    <Trash2 size={18} />
                   </button>
                </div>
              )}
            </div>

            {/* 3D Model Display Area */}
            <div className="flex-1 relative rounded-lg overflow-hidden bg-black/20 flex items-center justify-center">
              {isGenerating ? (
                <div className="text-center z-10 p-4">
                  <div className="inline-block p-5 bg-blue-900/20 rounded-full shadow-lg mb-3">
                     <Loader className="w-8 h-8 animate-spin text-blue-400" />
                  </div>
                  <div className="text-sm text-white/80 font-medium">
                    {`Generating ${numGenerations > 1 ? numGenerations + ' models' : 'model'}...`}
                  </div>
                  <p className="text-xs text-white/50 mt-1">This may take 30-90 seconds</p>
                </div>
              ) : currentPreview ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-2">
                  <div className="w-full h-full bg-black/30 rounded-md flex items-center justify-center relative overflow-hidden">
                    {/* Use <model-viewer> for 3D formats, fallback to <img> for thumbnails */}
                    {['glb', 'gltf', 'obj', 'fbx', 'stl'].includes(currentPreview.type) ? (
                      <model-viewer
                        src={currentPreview.url}
                        alt={`Preview of ${currentPreview.prompt}`}
                        camera-controls
                        auto-rotate
                        style={{ width: '100%', height: '100%', background: 'transparent' }}
                        shadow-intensity="1"
                        exposure="1"
                        ar
                        ar-modes="webxr scene-viewer quick-look"
                        loading="eager"
                      />
                    ) : (
                      <img
                        src={currentPreview.thumbnailUrl || 'https://via.placeholder.com/512x512.png?text=3D+Preview'}
                        alt={`Preview of ${currentPreview.prompt}`}
                        className="max-w-full max-h-full object-contain transition-opacity duration-300 hover:opacity-80"
                        onError={(e) => { e.currentTarget.src = 'https://via.placeholder.com/512x512.png?text=Error'; }}
                      />
                    )}
                    {/* Overlay with basic info */}
                    <div className="absolute bottom-2 left-2 right-2 z-10">
                      <div className="flex justify-between items-center bg-black/60 backdrop-blur-sm text-white/80 px-2 py-1 text-xs rounded">
                        <div className="flex items-center truncate mr-2">
                          <Box size={12} className="mr-1.5 flex-shrink-0 text-blue-400" />
                          <span className="truncate" title={currentPreview.prompt}>{currentPreview.prompt}</span>
                        </div>
                        <span className="bg-white/10 px-1.5 py-0.5 rounded text-white/70 text-[10px] uppercase font-semibold flex-shrink-0">{currentPreview.type}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                // Initial state / No selection
                <div className="flex flex-col items-center text-center p-4">
                  <Box size={48} className="mx-auto mb-3 text-white/30" />
                  <p className="text-white/70">Generated 3D models will appear here</p>
                  <p className="text-xs text-white/50 mt-1">
                    Enter a prompt and click 'Generate Model'
                  </p>
                </div>
              )}
            </div>
          </div> {/* End Container 1: Preview Area */}

          {/* Container 2: History Scrollable Area - Added */}
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 mt-2 overflow-hidden flex flex-col"
               style={{ height: '120px', minHeight: '120px' }}> {/* Fixed height */}
            <div className="text-xs text-white/60 mb-1 px-1 flex justify-between items-center">
               <span>Recent Generations</span>
               {/* Optional: Button to clear history here too? */}
            </div>
            <div className="flex-1 overflow-x-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
                <div className="flex space-x-2 h-full pb-1">
                 {history3D.length > 0 ? (
                   history3D.map((item) => (
                    <div
                      key={item.id}
                      className={`relative flex-shrink-0 h-full aspect-video border rounded-lg overflow-hidden cursor-pointer group ${currentPreview?.id === item.id ? 'border-blue-500 border-2' : 'border-white/10 hover:border-white/30'}`}
                      onClick={() => handleSelectHistoryItem(item)}
                      title={`Preview: ${item.prompt}`}
                    >
                       <img
                         src={item.thumbnailUrl || 'https://via.placeholder.com/160x90.png?text=3D'}
                         alt={`Thumbnail for ${item.prompt}`}
                         className="h-full w-full object-cover transition-transform group-hover:scale-105"
                         loading="lazy" // Lazy load history images
                         onError={(e) => { e.currentTarget.src = 'https://via.placeholder.com/160x90.png?text=Err'; }}
                       />
                       {/* Overlay on hover/selection */}
                       <div className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ${currentPreview?.id === item.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                         <Play size={24} className="text-white/80" />
                       </div>
                       {/* Model Type Badge */}
                       <span className="absolute top-1 right-1 bg-black/70 text-white/80 text-[9px] px-1 py-0.5 rounded uppercase font-semibold">{item.type}</span>
                    </div>
                   ))
                 ) : (
                   <div className="flex items-center justify-center w-full h-full text-white/50 text-sm">
                     <p>History will appear here</p>
                   </div>
                 )}
               </div>
            </div>
          </div> {/* End Container 2: History Area */}

        </div> {/* End Right Panel */}
      </div> {/* End Main Two-Panel Layout */}
    </div> // End Root Div
  );
};

export default ThreeDGenerationInterface;

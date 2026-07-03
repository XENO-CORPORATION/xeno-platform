import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, Send, Download, Copy, Share2, Trash2, Sparkles, Play, Pause, Clock, Image, RotateCw, Info, X, AlertCircle, Wand2, Settings, ChevronDown, RefreshCw, Camera, Minus, ZoomIn, ZoomOut, Move, Maximize, Minimize, DownloadCloud, Film, Image as ImageIcon, Plus } from 'lucide-react';
import { checkApiTokens, API_TOKENS } from '../../../config/apiConfig';
import ApiTokenNotice from '../../common/ApiTokenNotice';
import { analyzeImageWithGemini, initializeGeminiSDK } from '../../../services/geminiService';
import videoGenerationService from '../../../services/videoGenerationService';
import VideoPromptEditor, { VideoPromptEditorHandle } from './components/VideoPromptEditor';

// A single image reference in the prompt composer. Mirrors the multi-reference
// pattern used by the polished image interface (ImageGenerationInterface2Copy).
interface UploadedReference {
  id: string;
  url: string;
}

const MAX_REFERENCES = 6;

// Stacked reference-pile geometry (mirrors Dreamina's reference group):
// cards overlap into a tilted pile at rest and fan out into a row on hover.
const REF_CARD = 52;   // card width/height (px)
const REF_GAP = 8;     // gap between cards when fanned out
const REF_PEEK = 12;   // horizontal offset per card while stacked
const REF_ROTATIONS = [-8, 6, -5, 8, -4, 7]; // per-index tilt (deg)
const refRotation = (i: number) => REF_ROTATIONS[i % REF_ROTATIONS.length];
const REF_EASE = 'cubic-bezier(0.4,0,0.2,1)';

// Per-video credit estimate by model — drives the Dreamina-style cost indicator.
const creditCostPerVideo = (model: string): number => {
  if (model.includes('wan')) return 150;
  if (model.includes('veo2')) return 200;
  if (model.includes('minimax') || model.includes('hailuo')) return 100;
  if (model.includes('hunyuan')) return 120;
  if (model.includes('luma')) return 180;
  if (model.includes('pika')) return 130;
  if (model.includes('kling')) return 160;
  return 120;
};

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
    alert("Success: " + message);
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
  supportsImageUpload?: boolean;
}

// Define model families and their submodels
const modelFamilies: ModelFamily[] = [
  {
    id: 'wan',
    name: 'Wan AI',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Film size={16} className="text-emerald-400" /></div>,
    description: "Wan AI's advanced text-to-video generation models with high-quality output and comprehensive controls.",
    submodels: [
      {
        id: 'fal-ai/wan-t2v',
        name: 'Wan T2V',
        description: "Advanced text-to-video model with extensive customization options, high-quality output up to 720p, and professional-grade controls.",
        isNew: true,
        supportsImageUpload: false // Text-to-video only
      }
    ]
  },
  {
    id: 'google',
    name: 'Google',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Sparkles size={16} className="text-purple-400" /></div>,
    description: "Google's advanced video generation models with state-of-the-art quality and understanding.",
    submodels: [
      {
        id: 'fal-ai/veo2',
        name: 'Veo 2',
        description: "Google's latest video generation model with exceptional quality, cinematography, and physics understanding.",
        isNew: true,
        supportsImageUpload: false // Text-to-video only
      }
    ]
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Video size={16} className="text-purple-400" /></div>,
    description: "MiniMax's AI video generation models with excellent human motion and facial expressions.",
    submodels: [
      {
        id: 'fal-ai/minimax/video-01-live',
        name: 'Video-01-Live',
        description: "MiniMax's fast live video generation model with excellent prompt understanding and motion quality.",
        isNew: true,
        supportsImageUpload: false // Text-to-video only
      },
      {
        id: 'hailuo-video-01-live',
        name: 'Hailuo Video-01-Live',
        description: "Specializes in realistic human motion and facial expressions, with strong prompt understanding.",
        isNew: true,
        supportsImageUpload: true
      }
    ]
  },
  {
    id: 'hunyuan',
    name: 'Hunyuan',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><RefreshCw size={16} className="text-amber-400" /></div>,
    description: "Tencent's advanced video generation platform with customizable resolutions and professional-grade controls.",
    submodels: [
      {
        id: 'fal-ai/hunyuan-video',
        name: 'Hunyuan Video',
        description: "Tencent's high-quality video generation model with detailed control over resolution, frame count, and pro mode for enhanced quality.",
        isNew: true,
        supportsImageUpload: false // Text-to-video only
      }
    ]
  },
  {
    id: 'luma',
    name: 'Luma',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Video size={16} className="text-rose-400" /></div>,
    description: "Luma's advanced video generation models with high-quality output, multiple aspect ratios, and professional controls.",
    submodels: [
      {
        id: 'fal-ai/luma-dream-machine/ray-2',
        name: 'Dream Machine Ray-2',
        description: "High-fidelity text-to-video model with support for multiple aspect ratios (16:9, 9:16, 4:3, 3:4, 21:9, 9:21), resolutions up to 1080p, and seamless looping.",
        isNew: true,
        supportsImageUpload: false // Text-to-video only according to schema
      }
    ]
  },
  {
    id: 'pika',
    name: 'Pika',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Video size={16} className="text-sky-400" /></div>,
    description: "Pika's advanced text-to-video generation models with high-quality motion, multiple aspect ratios, and negative prompt support.",
    submodels: [
      {
        id: 'fal-ai/pika/v2.2/text-to-video',
        name: 'Pika V2.2',
        description: "Next-generation video model with advanced text-to-motion capabilities, support for 7 aspect ratios, high-quality rendering up to 1080p, and negative prompt control.",
        isNew: true,
        supportsImageUpload: false // Text-to-video only according to schema
      }
    ]
  },
  {
    id: 'kling',
    name: 'Kling',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Video size={16} className="text-indigo-400" /></div>,
    description: "Kling's advanced image-to-video generation models with high-quality motion and precise control.",
    submodels: [
      {
        id: 'fal-ai/kling-video/v1.6/pro/image-to-video',
        name: 'Kling Video V1.6 Pro',
        description: "Professional image-to-video model with advanced controls, negative prompts, CFG scale, and tail image support for enhanced video generation.",
        isNew: true,
        supportsImageUpload: true
      },
      {
        id: 'fal-ai/kling-video/v2/master/image-to-video',
        name: 'Kling Video V2 Master',
        description: "Latest generation image-to-video model with improved quality, enhanced motion understanding, and streamlined controls.",
        isNew: true,
        supportsImageUpload: true
      },
      {
        id: 'kling-video-v1-6',
        name: 'Kling Video V1.6',
        description: "Versatile model supporting negative prompts and first-frame control for precise video generation.",
        supportsImageUpload: true
      }
    ]
  }
];

// Model Selector Component with two-tier selection (similar to ImageGenerationInterface)
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

  // Helper function to determine input type for each video model
  const getModelInputType = (modelId: string): { type: 'Text' | 'Image' | 'Mixed'; color: string } => {
    switch (modelId) {
      // Image-to-video models
      case 'fal-ai/kling-video/v1.6/pro/image-to-video':
      case 'fal-ai/kling-video/v2/master/image-to-video':
      case 'kling-video-v1-6':
        return { type: 'Image', color: 'bg-emerald-500/30 text-emerald-300 border-emerald-500/40' };
      // Mixed models (support both text and image)
      case 'hailuo-video-01-live':
        return { type: 'Mixed', color: 'bg-purple-500/30 text-purple-300 border-purple-500/40' };
      // Text-to-video models (default)
      default:
        return { type: 'Text', color: 'bg-blue-500/30 text-blue-300 border-blue-500/40' };
    }
  };

  // Custom CSS for the animations - horizontal slide from left
  const animationStyles = isVisible ? {
    opacity: 1,
    transform: 'translateY(0) scale(1)',
    transformOrigin: 'bottom center',
    transition: 'opacity 0.32s cubic-bezier(0.16,0.84,0.3,1), transform 0.32s cubic-bezier(0.16,0.84,0.3,1)'
  } : {
    opacity: 0,
    transform: 'translateY(20px) scale(0.96)',
    transformOrigin: 'bottom center',
    transition: 'opacity 0.32s cubic-bezier(0.16,0.84,0.3,1), transform 0.32s cubic-bezier(0.16,0.84,0.3,1)'
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
        className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg h-9 pl-1.5 pr-2 text-xs gap-1 focus:outline-none focus:ring-1 focus:ring-white/20 flex justify-between items-center "
        onClick={togglePanel}
        disabled={disabled}
      >
        <div className="flex items-center min-w-0 [&>div]:p-1 [&>div]:mr-1.5 [&_svg]:w-3.5 [&_svg]:h-3.5">
          {selectedDetails ? selectedDetails.family.icon : <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Film size={16} className="text-blue-400" /></div>}
          <span className="truncate">{selectedDetails ? selectedDetails.model.name : 'Select a model'}</span>
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
          className="absolute z-50 bottom-full mb-2 left-0 bg-[rgba(20,20,20,0.97)] border border-white/10 rounded-xl shadow-xl overflow-hidden w-[360px] max-h-[60vh] overflow-y-auto backdrop-blur-sm"
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
                              {/* Show specific indicators based on model type */}
                              {model.id.includes('image-to-video') || model.supportsImageUpload ? (
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Image-to-Video"></div>
                              ) : null}
                              {model.id === 'hailuo-video-01-live' ? (
                                <>
                                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Text-to-Video"></div>
                                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Image-to-Video"></div>
                                </>
                              ) : !model.id.includes('image-to-video') && !model.supportsImageUpload ? (
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Text-to-Video"></div>
                              ) : null}
                            </div>
                          </div>
                          
                          <p className={`text-xs leading-relaxed mb-1.5 transition-colors ${
                            selectedModel === model.id ? 'text-white/75' : 'text-white/65'
                          }`}>
                            {model.description}
                          </p>
                          
                          {/* Model-specific details - Right aligned */}
                          <div className="flex items-center justify-end gap-3 text-xs">
                            {/* Video-specific format info */}
                            <span className={`transition-colors ${
                              selectedModel === model.id ? 'text-white/60' : 'text-white/50'
                            }`}>
                              MP4
                            </span>
                            {/* Credit estimation based on model */}
                            {model.id.includes('wan') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-emerald-300' : 'text-emerald-400/80'
                              }`}>
                                • Advanced • ~150 credits
                              </span>
                            )}
                            {model.id.includes('veo2') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-purple-300' : 'text-purple-400/80'
                              }`}>
                                • Premium • ~200 credits
                              </span>
                            )}
                            {model.id.includes('minimax') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-purple-300' : 'text-purple-400/80'
                              }`}>
                                • Fast • ~100 credits
                              </span>
                            )}
                            {model.id.includes('hunyuan') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-amber-300' : 'text-amber-400/80'
                              }`}>
                                • Quality • ~120 credits
                              </span>
                            )}
                            {model.id.includes('luma') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-rose-300' : 'text-rose-400/80'
                              }`}>
                                • High-res • ~180 credits
                              </span>
                            )}
                            {model.id.includes('pika') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-sky-300' : 'text-sky-400/80'
                              }`}>
                                • Motion • ~130 credits
                              </span>
                            )}
                            {model.id.includes('kling') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-indigo-300' : 'text-indigo-400/80'
                              }`}>
                                • Image2Video • ~160 credits
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

// Compact toolbar select — a pill button that opens a small dropdown upward,
// mirroring Dreamina's `toolbar-select` controls (model/aspect/duration/etc.).
interface ToolbarSelectOption {
  value: string;
  label: string;
}

const ToolbarSelect = ({
  icon,
  value,
  options,
  onChange,
  disabled,
  title,
}: {
  icon?: React.ReactNode;
  value: string;
  options: ToolbarSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
}) => {
  const [open, setOpen] = useState(false);   // mounted
  const [visible, setVisible] = useState(false); // animation target
  const ref = useRef<HTMLDivElement>(null);

  const closeMenu = () => {
    setVisible(false);
    setTimeout(() => setOpen(false), 280);
  };
  const toggleMenu = () => {
    if (disabled) return;
    if (open) {
      closeMenu();
    } else {
      setOpen(true);
      setTimeout(() => setVisible(true), 10);
    }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={toggleMenu}
        title={title}
        className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg bg-black/30 border border-white/10 text-white/80 hover:bg-black/40 transition-colors text-xs disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {icon}
        <span className="whitespace-nowrap">{current?.label ?? value}</span>
        <ChevronDown size={12} className={`text-white/40 transition-transform duration-300 ${visible ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.96)',
            transformOrigin: 'bottom center',
            transition: 'opacity 0.28s cubic-bezier(0.16,0.84,0.3,1), transform 0.28s cubic-bezier(0.16,0.84,0.3,1)',
          }}
          className="absolute bottom-full mb-1.5 left-0 min-w-[150px] bg-[#1a1a1c] border border-white/10 rounded-lg shadow-xl shadow-black/40 p-1 z-50"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); closeMenu(); }}
              className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors ${o.value === value ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Add props for clean mode to VideoGenerationInterfaceProps
interface VideoGenerationInterfaceProps {
  isCleanMode?: boolean;
  onToggleInterface?: () => void; // Optional: To allow toggling back from clean mode if needed
}

// Define props for the CleanModeInputBar
interface CleanModeInputBarProps {
  prompt: string;
  setPrompt: (value: string) => void;
  handleGenerate: () => void;
  isGenerating: boolean;
  handleImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  supportsImageUpload: boolean;
  handleRemoveInputImage: () => void;
  inputImage: string | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  setShowAdvancedSettings: React.Dispatch<React.SetStateAction<boolean>>;
}

// Define the CleanModeInputBar component
const CleanModeInputBar: React.FC<CleanModeInputBarProps> = ({
  prompt,
  setPrompt,
  handleGenerate,
  isGenerating,
  handleImageUpload,
  supportsImageUpload,
  handleRemoveInputImage,
  inputImage,
  fileInputRef,
  setShowAdvancedSettings
}) => {
  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="relative flex items-center bg-[rgba(20,20,20,0.85)] border border-white/10 rounded-xl shadow-xl p-2">
      {/* Hidden File Input - needed by the button */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageUpload}
        className="hidden"
        accept="image/*"
      />
      {/* Image Upload/Preview Button */}
            {inputImage ? (
        <div className="relative group mr-2 flex-shrink-0">
          <img
            src={inputImage}
            alt="Input Preview"
            className="w-10 h-10 rounded object-cover border border-white/20"
          />
                <button
                  onClick={handleRemoveInputImage}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-600/80 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 hover:bg-red-700 transition-opacity z-10"
                  title="Remove Image"
                >
            <X size={8} />
                </button>
              </div>
            ) : (
              <button
          onClick={triggerFileInput}
          className={`flex-shrink-0 w-10 h-10 rounded flex items-center justify-center mr-2 transition-all duration-300 ${
            isGenerating || !supportsImageUpload
              ? 'bg-black/20 text-white/40 cursor-not-allowed'
              : 'bg-white/10 text-white/70 hover:bg-white/15 hover:text-white'
          }`}
          disabled={isGenerating || !supportsImageUpload}
          title={supportsImageUpload ? "Upload Image" : "Image upload not supported for this model"}
              >
          <ImageIcon size={18} />
              </button>
        )}

      {/* Prompt Textarea */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        placeholder={isGenerating ? "Generating video..." : "Describe the video you want to generate..."}
        className="flex-1 bg-black/30 border border-white/10 rounded-lg p-2.5 pr-24 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none h-14 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
          disabled={isGenerating}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleGenerate();
            }
          }}
        rows={2}
        />

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
        className={`absolute right-14 top-1/2 transform -translate-y-1/2 w-10 h-10 rounded flex items-center justify-center transition-all duration-300 ${
              isGenerating
            ? 'bg-blue-600/50 text-white/70 cursor-wait'
                : prompt.trim()
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'bg-white/10 text-white/40 cursor-not-allowed'
        }`}
        title="Generate Video (Enter)"
        >
          {isGenerating ? (
          <RotateCw size={18} className="animate-spin" />
          ) : (
          <Send size={18} />
          )}
        </button>

        {/* Settings Button */}
        <button
        onClick={() => setShowAdvancedSettings(prev => !prev)}
        className={`absolute right-3 top-1/2 transform -translate-y-1/2 w-8 h-8 rounded flex items-center justify-center transition-all duration-300
          bg-white/10 text-white/70 hover:bg-white/15 hover:text-white'
        }`}
        title="Advanced Settings"
        >
        <Settings size={18} />
        </button>
    </div>
  );
};

// Main component definition accepting new props
const VideoGenerationInterfaceCopy: React.FC<VideoGenerationInterfaceProps> = ({
  isCleanMode = false,
  onToggleInterface // Destructure the new props
}) => {
  // Helper function to check if model has advanced settings
  const hasAdvancedSettings = (model: string): boolean => {
    const modelsWithSettings = [
      'fal-ai/minimax/video-01-live', 
      'hailuo-video-01-live', 
      'fal-ai/veo2', 
      'fal-ai/wan-t2v', 
      'fal-ai/hunyuan-video', 
      'fal-ai/luma-dream-machine/ray-2', 
      'fal-ai/pika/v2.2/text-to-video', 
      'fal-ai/kling-video/v1.6/pro/image-to-video', 
      'fal-ai/kling-video/v2/master/image-to-video'
    ];
    return modelsWithSettings.includes(model);
  };
  
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [selectedModel, setSelectedModel] = useState('fal-ai/kling-video/v1.6/pro/image-to-video');
  const [numGenerations, setNumGenerations] = useState(1);
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [uploadedReferences, setUploadedReferences] = useState<UploadedReference[]>([]);
  const [referenceMode, setReferenceMode] = useState('omni');
  const [referencesExpanded, setReferencesExpanded] = useState(false);
  const [mountedRefIds, setMountedRefIds] = useState<string[]>([]);
  // Hovering an image expands the stack; the + is inert on its own hover, but
  // keeps the stack open (cancels the debounced collapse) so you can reach it.
  const refCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandReferences = () => {
    if (refCollapseTimer.current) clearTimeout(refCollapseTimer.current);
    refCollapseTimer.current = null;
    setReferencesExpanded(true);
  };
  const collapseReferencesSoon = () => {
    if (refCollapseTimer.current) clearTimeout(refCollapseTimer.current);
    refCollapseTimer.current = setTimeout(() => setReferencesExpanded(false), 140);
  };
  const keepReferencesExpanded = () => {
    if (refCollapseTimer.current) clearTimeout(refCollapseTimer.current);
    refCollapseTimer.current = null;
  };
  const [showImageUpload, setShowImageUpload] = useState(false);
  const editorRef = useRef<VideoPromptEditorHandle>(null);
  const [history, setHistory] = useState<Array<{ id: string; video: string; prompt: string; timestamp: Date; metadata?: any }>>([]);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [previewVideos, setPreviewVideos] = useState<string[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<{[key: string]: boolean}>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Model settings
  const [duration, setDuration] = useState(3);
  const [fps, setFps] = useState(24);
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(576);
  const [seed, setSeed] = useState(-1);
  
  // Video state tracking for multiple videos
  const [videoStates, setVideoStates] = useState<{[key: string]: {muted: boolean}}>({}); 
  
  // Model-specific settings
  // MiniMax settings
  const [promptOptimizer, setPromptOptimizer] = useState(true);
  
  // Wan settings
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [frameCount, setFrameCount] = useState(81);
  const [sampleSteps, setSampleSteps] = useState(30);
  const [guideScale, setGuideScale] = useState(6.0);
  const [sampleShift, setSampleShift] = useState(8.0);
  
  // Wan-T2V specific settings
  const [wanResolution, setWanResolution] = useState('720p');
  const [wanNumFrames, setWanNumFrames] = useState(81);
  const [wanTurboMode, setWanTurboMode] = useState(false);
  const [wanFramesPerSecond, setWanFramesPerSecond] = useState(16);
  const [wanEnablePromptExpansion, setWanEnablePromptExpansion] = useState(false);
  const [wanNumInferenceSteps, setWanNumInferenceSteps] = useState(30);
  const [wanNegativePrompt, setWanNegativePrompt] = useState('bright colors, overexposed, static, blurred details, subtitles, style, artwork, painting, picture, still, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, malformed limbs, fused fingers, still picture, cluttered background, three legs, many people in the background, walking backwards');
  const [wanEnableSafetyChecker, setWanEnableSafetyChecker] = useState(false);
  
  // Hunyuan settings
  const [hunyuanAspectRatio, setHunyuanAspectRatio] = useState('16:9');
  const [hunyuanResolution, setHunyuanResolution] = useState('720p');
  const [hunyuanNumFrames, setHunyuanNumFrames] = useState('129');
  const [hunyuanNumInferenceSteps, setHunyuanNumInferenceSteps] = useState(30);
  const [hunyuanProMode, setHunyuanProMode] = useState(false);
  const [hunyuanEnableSafetyChecker, setHunyuanEnableSafetyChecker] = useState(false);
  
  // Legacy Hunyuan settings (keeping for compatibility)
  const [videoLength, setVideoLength] = useState(129);
  const [inferSteps, setInferSteps] = useState(50);
  const [embeddedGuidance, setEmbeddedGuidance] = useState(6.0);
  
  // Luma Dream Machine Ray-2 specific settings
  const [lumaAspectRatio, setLumaAspectRatio] = useState('16:9');
  const [lumaResolution, setLumaResolution] = useState('540p');
  const [lumaDuration, setLumaDuration] = useState('5s');
  const [lumaLoop, setLumaLoop] = useState(false);
  
  // Legacy Luma settings (keeping for compatibility)
  const [loopVideo, setLoopVideo] = useState(false);
  
  // Kling settings
  const [cfgScale, setCfgScale] = useState(0.5);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedMode, setSelectedMode] = useState('text-to-video');
  
  const [apiTokenAvailable, setApiTokenAvailable] = useState<boolean>(false);
  const [isCheckingToken, setIsCheckingToken] = useState<boolean>(true);

  // Gemini SDK status
  const [geminiInitialized, setGeminiInitialized] = useState<boolean>(false);

  // State for clean mode specific settings popup
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  // Mount/visible states drive the settings popover's slide-up / slide-down animation.
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  useEffect(() => {
    if (showAdvancedSettings) {
      setSettingsMounted(true);
      const t = setTimeout(() => setSettingsVisible(true), 10);
      return () => clearTimeout(t);
    }
    setSettingsVisible(false);
    const t = setTimeout(() => setSettingsMounted(false), 300);
    return () => clearTimeout(t);
  }, [showAdvancedSettings]);

  // Pika V2.2 specific settings
  const [pikaDuration, setPikaDuration] = useState(5);
  const [pikaAspectRatio, setPikaAspectRatio] = useState('16:9');
  const [pikaResolution, setPikaResolution] = useState('720p');
  const [pikaNegativePrompt, setPikaNegativePrompt] = useState('');
  
  // Kling Video specific settings
  const [klingDuration, setKlingDuration] = useState('5');
  const [klingAspectRatio, setKlingAspectRatio] = useState('16:9');
  const [klingNegativePrompt, setKlingNegativePrompt] = useState('blur, distort, and low quality');
  const [klingCfgScale, setKlingCfgScale] = useState(0.5);
  const [klingTailImageUrl, setKlingTailImageUrl] = useState('');
  
  // Backwards compatibility for single video selection
  useEffect(() => {
    if (selectedVideo && !previewVideos.includes(selectedVideo)) {
      setPreviewVideos([selectedVideo]);
    }
  }, [selectedVideo]);

  // Mirror the first reference into `inputImage`. The image-to-video generate
  // path reads `inputImage` as the primary image_url, so keeping it in sync lets
  // the multi-reference tray drive generation without rewriting that logic.
  useEffect(() => {
    setInputImage(uploadedReferences[0]?.url ?? null);
  }, [uploadedReferences]);

  // Mark references "entered" a frame after they mount so a newly added card
  // springs in (scale up from 0.2 + fade) via CSS transition.
  useEffect(() => {
    const ids = uploadedReferences.map((r) => r.id);
    const t = setTimeout(() => setMountedRefIds(ids), 20);
    return () => clearTimeout(t);
  }, [uploadedReferences]);
  
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
  }, []);

  // Check for API token availability immediately on initial render
  React.useEffect(() => {
    // API is now proxied through backend - no client-side key needed
  }, []);

  // Check API token and initialize Gemini SDK on mount
  useEffect(() => {
    setIsCheckingToken(true);
    const checkToken = async () => {
      // Try to use the token from .env file if available
      // Note: For Vite, environment variables need to be prefixed with VITE_
      // The variable should be in the .env file as VITE_GEMINI_API_TOKEN
      const envToken = import.meta.env.VITE_GEMINI_API_TOKEN || '';
      
      if (envToken) {
        console.log('Found Gemini API token in environment variables');
        window.GEMINI_API_TOKEN = envToken;
        API_TOKENS.GEMINI_API_TOKEN = envToken;
      }
      
      // For direct testing, you can uncomment and use this (replace with your actual token)
      const directToken = 'AIzaSyDMAai9Vwh1JrHFHAt3ZRhZ390x-3nKEjI';
      if (!API_TOKENS.GEMINI_API_TOKEN) {
        console.log('Using direct token for testing');
        window.GEMINI_API_TOKEN = directToken;
        API_TOKENS.GEMINI_API_TOKEN = directToken;
      }
      
      const tokens = checkApiTokens(); 
      const hasReplicateToken = tokens.replicate;
      setApiTokenAvailable(hasReplicateToken);
      setIsCheckingToken(false);
      
      // Initialize Gemini SDK
      if (API_TOKENS.GEMINI_API_TOKEN) {
        const initialized = initializeGeminiSDK(API_TOKENS.GEMINI_API_TOKEN);
        console.log('Gemini SDK initialized:', initialized);
        setGeminiInitialized(initialized);
      } else {
        console.log('No Gemini API token available');
        setGeminiInitialized(false);
      }
    };
    checkToken();
  }, []);
  
  const handleTokenSaved = () => {
    // Recheck token availability
    const tokens = checkApiTokens();
    const hasReplicateToken = tokens.replicate;
    setApiTokenAvailable(hasReplicateToken);
    
    // Initialize Gemini SDK if token is available
    if (API_TOKENS.GEMINI_API_TOKEN) {
      const initialized = initializeGeminiSDK(API_TOKENS.GEMINI_API_TOKEN);
      setGeminiInitialized(initialized);
    }
    
    if (hasReplicateToken) {
      // If token is now available, clear any error and start a new session
      setGenerationError(null);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      notifications.error('Please enter a prompt');
      return;
    }
    
    if (selectedMode === 'image-to-video' && !inputImage) {
      notifications.error('Please upload an image for image-to-video mode');
      return;
    }

    // Check if API token is available
    const tokens = checkApiTokens();
    if (!tokens.replicate) {
      notifications.error("API token is missing. Please add your API token to continue.");
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);
    setErrorDetails(null);
    
    try {
      // Check if this is a fal.ai model that uses the video generation service
      if (selectedModel === 'fal-ai/minimax/video-01-live' || selectedModel === 'fal-ai/veo2' || selectedModel === 'fal-ai/wan-t2v' || selectedModel === 'fal-ai/hunyuan-video' || selectedModel === 'fal-ai/luma-dream-machine/ray-2' || selectedModel === 'fal-ai/pika/v2.2/text-to-video' || selectedModel === 'fal-ai/kling-video/v1.6/pro/image-to-video' || selectedModel === 'fal-ai/kling-video/v2/master/image-to-video') {
        console.log(`Generating video with ${selectedModel}: ${prompt}`);
        
        // Prepare settings for the model
        const settings: any = {
          prompt: prompt.trim(),
        };

        // Add model-specific settings
        if (selectedModel === 'fal-ai/minimax/video-01-live') {
          settings.prompt_optimizer = promptOptimizer;
          settings.seed = seed >= 0 ? seed : undefined;
        } else if (selectedModel === 'fal-ai/veo2') {
          // Veo2 specific settings
          settings.duration = duration + 's'; // Convert number to string format (e.g., "5s")
          settings.aspect_ratio = aspectRatio;
        } else if (selectedModel === 'fal-ai/wan-t2v') {
          // Wan-T2V specific settings
          settings.aspect_ratio = aspectRatio;
          settings.resolution = wanResolution;
          settings.num_frames = wanNumFrames;
          settings.turbo_mode = wanTurboMode;
          settings.frames_per_second = wanFramesPerSecond;
          settings.enable_prompt_expansion = wanEnablePromptExpansion;
          settings.num_inference_steps = wanNumInferenceSteps;
          settings.negative_prompt = wanNegativePrompt;
          settings.enable_safety_checker = wanEnableSafetyChecker;
          settings.seed = seed >= 0 ? seed : undefined;
        } else if (selectedModel === 'fal-ai/hunyuan-video') {
          // Hunyuan Video specific settings
          settings.aspect_ratio = hunyuanAspectRatio;
          settings.resolution = hunyuanResolution;
          settings.num_frames = hunyuanNumFrames;
          settings.num_inference_steps = hunyuanNumInferenceSteps;
          settings.pro_mode = hunyuanProMode;
          settings.enable_safety_checker = hunyuanEnableSafetyChecker;
          settings.seed = seed >= 0 ? seed : undefined;
        } else if (selectedModel === 'fal-ai/luma-dream-machine/ray-2') {
          // Luma Dream Machine Ray-2 specific settings
          settings.aspect_ratio = lumaAspectRatio;
          settings.resolution = lumaResolution;
          settings.duration = lumaDuration;
          settings.loop = lumaLoop;
        } else if (selectedModel === 'fal-ai/pika/v2.2/text-to-video') {
          // Pika V2.2 specific settings
          settings.duration = pikaDuration;
          settings.aspect_ratio = pikaAspectRatio;
          settings.resolution = pikaResolution;
          settings.negative_prompt = pikaNegativePrompt;
          settings.seed = seed >= 0 ? seed : undefined;
        } else if (selectedModel === 'fal-ai/kling-video/v1.6/pro/image-to-video') {
          // Kling Video v1.6 Pro specific settings
          settings.duration = klingDuration;
          settings.aspect_ratio = klingAspectRatio;
          settings.negative_prompt = klingNegativePrompt;
          settings.cfg_scale = klingCfgScale;
          
          // Required image_url for image-to-video
          if (inputImage) {
            settings.image_url = inputImage;
          } else {
            notifications.error('Please upload an image for Kling Video v1.6 Pro image-to-video generation');
            setIsGenerating(false);
            return;
          }
          
          // Optional tail_image_url
          if (klingTailImageUrl.trim()) {
            settings.tail_image_url = klingTailImageUrl.trim();
          }
        } else if (selectedModel === 'fal-ai/kling-video/v2/master/image-to-video') {
          // Kling Video v2 Master specific settings
          settings.duration = klingDuration;
          settings.aspect_ratio = klingAspectRatio;
          settings.negative_prompt = klingNegativePrompt;
          settings.cfg_scale = klingCfgScale;
          
          // Required image_url for image-to-video
          if (inputImage) {
            settings.image_url = inputImage;
          } else {
            notifications.error('Please upload an image for Kling Video v2 Master image-to-video generation');
            setIsGenerating(false);
            return;
          }
        }

        // Generate video using the real fal.ai service
        const result = await videoGenerationService.generateVideo(selectedModel, settings);

        if (result.success && result.videos && result.videos.length > 0) {
          console.log("Video generation successful:", result.videos);
          
          // Use the generated video
          const generatedVideo = result.videos[0];
          const videoUrl = generatedVideo.url;

          // Add to history
          const newHistoryItem = {
            id: Date.now().toString(),
            prompt,
            video: videoUrl,
            timestamp: new Date(),
            metadata: {
              model: selectedModel,
              duration: generatedVideo.duration,
              seed: generatedVideo.seed,
              generationTime: result.metadata?.generationTime,
              modelVersion: result.metadata?.modelVersion,
              aspectRatio: selectedModel === 'fal-ai/veo2' ? aspectRatio : selectedModel === 'fal-ai/wan-t2v' ? aspectRatio : undefined
            }
          };

          // Update the UI
          setHistory(prev => [newHistoryItem, ...prev]);
          setSelectedVideo(videoUrl);
          setPreviewVideos([videoUrl]);

          // Initialize play state for the video
          const initialPlayState: {[key: string]: boolean} = {};
          initialPlayState['video-0'] = true;
          setIsPlaying(initialPlayState);

          const modelName = selectedModel === 'fal-ai/veo2' ? 'Google Veo2' : selectedModel === 'fal-ai/wan-t2v' ? 'Wan T2V' : selectedModel === 'fal-ai/hunyuan-video' ? 'Hunyuan Video' : selectedModel === 'fal-ai/luma-dream-machine/ray-2' ? 'Luma Dream Machine Ray-2' : selectedModel === 'fal-ai/pika/v2.2/text-to-video' ? 'Pika V2.2' : selectedModel === 'fal-ai/kling-video/v1.6/pro/image-to-video' ? 'Kling Video V1.6 Pro' : 'Kling Video V2 Master';
          notifications.success(`Video generated successfully with ${modelName}!`);
        } else {
          console.error('Video generation failed:', result.error);
          setGenerationError(result.error || 'Video generation failed');
          notifications.error(`Error: ${result.error || 'Video generation failed'}`);
        }
      } else {
        // For other models, use the existing mock implementation
        
        // Mock video URLs - in a real app, these would come from your API
        const mockVideos = [
          "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          "https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
          "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
          "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
          "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
          "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
          "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
          "https://storage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4"
        ];
        
        // Simulate API delay for mock models
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Create an array of generated videos based on numGenerations
        const generatedVideos: string[] = [];
        const videosToGenerate = Math.min(numGenerations, 4); // Cap at 4 videos maximum
        
        // Use a set to ensure we don't get duplicate videos
        const usedIndices = new Set<number>();
        
        for (let i = 0; i < videosToGenerate; i++) {
          let randomIndex;
          do {
            randomIndex = Math.floor(Math.random() * mockVideos.length);
          } while (usedIndices.has(randomIndex) && usedIndices.size < mockVideos.length);
          
          usedIndices.add(randomIndex);
          generatedVideos.push(mockVideos[randomIndex]);
        }
        
        // Use the first video as the main video for history and selection
        const primaryVideo = generatedVideos[0];
        
        // Add to history
        const newHistoryItem = {
          id: Date.now().toString(),
          prompt,
          video: primaryVideo,
          timestamp: new Date(),
          metadata: {
            model: selectedModel,
            duration,
            aspectRatio,
            mode: selectedMode,
            generatedCount: videosToGenerate
          }
        };
        
        // Update the UI with all generated videos
        setHistory(prev => [newHistoryItem, ...prev]);
        setSelectedVideo(primaryVideo);
        setPreviewVideos(generatedVideos);
        
        // Initialize play state for the first video
        const initialPlayState: {[key: string]: boolean} = {};
        initialPlayState['video-0'] = true;
        setIsPlaying(initialPlayState);
        
        notifications.success(`${videosToGenerate} video${videosToGenerate > 1 ? 's' : ''} generated successfully`);
      }
    } catch (error) {
      console.error('Error generating video:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      setGenerationError(errorMessage);
      notifications.error(`Error: ${errorMessage}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Function to trigger the hidden file input
  const handleImageUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Read a File into a data URL.
  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target?.result as string);
      reader.onerror = () => reject(new Error('Error reading file'));
      reader.readAsDataURL(file);
    });

  // Run the existing Gemini vision→prompt analysis for text-only models, so an
  // uploaded reference still seeds the prompt when the model can't take an image.
  const analyzeReferenceForTextModel = async (dataUrl: string, fileName: string) => {
    try {
      if (!geminiInitialized && API_TOKENS.GEMINI_API_TOKEN) {
        const initialized = initializeGeminiSDK(API_TOKENS.GEMINI_API_TOKEN);
        setGeminiInitialized(initialized);
        if (!initialized) throw new Error('Failed to initialize Gemini SDK');
      }
      const imageDescription = await analyzeImageWithGemini(dataUrl);
      if (imageDescription) {
        setPrompt(imageDescription);
      } else {
        throw new Error('No description received from Gemini');
      }
    } catch (error) {
      console.error('Error calling Gemini vision API:', error);
      setPrompt((prev) => prev || `Please add a description for the uploaded image "${fileName}".`);
      notifications.error('Could not analyze image with Gemini. Please check your API key.');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const remainingSlots = MAX_REFERENCES - uploadedReferences.length;
    if (remainingSlots <= 0) {
      notifications.error(`You can add up to ${MAX_REFERENCES} reference images.`);
      // Reset so selecting the same file again re-triggers onChange.
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsProcessingImage(true);
    try {
      const accepted = files.slice(0, remainingSlots);
      const dataUrls = await Promise.all(accepted.map(readFileAsDataUrl));
      const newRefs: UploadedReference[] = dataUrls.map((url, i) => ({
        id: `ref-${Date.now()}-${i}`,
        url,
      }));

      const isFirstReference = uploadedReferences.length === 0;
      setUploadedReferences((prev) => [...prev, ...newRefs]);

      // For text-only models, convert the first image to a prompt (legacy behavior).
      if (isFirstReference && !supportsDirectImageUpload()) {
        await analyzeReferenceForTextModel(dataUrls[0], accepted[0].name);
      }
    } catch (error) {
      console.error('Error processing reference image(s):', error);
      notifications.error('Error processing image');
    } finally {
      setIsProcessingImage(false);
      // Allow re-selecting the same file.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Remove a single reference from the tray.
  const handleRemoveReference = (id: string) => {
    setUploadedReferences((prev) => prev.filter((ref) => ref.id !== id));
  };

  // Clear every reference.
  const handleClearReferences = () => {
    setUploadedReferences([]);
  };

  // Insert a reference as an inline chip into the prompt editor.
  const handleInsertReferenceChip = (ref: UploadedReference) => {
    const index = uploadedReferences.findIndex((r) => r.id === ref.id) + 1;
    editorRef.current?.insertReference({ id: ref.id, url: ref.url, index: index || 1 });
  };

  // Updated supportsDirectImageUpload to check based on model data
  const supportsDirectImageUpload = () => {
    const modelInfo = modelFamilies
      .flatMap(family => family.submodels)
      .find(submodel => submodel.id === selectedModel);
    return modelInfo?.supportsImageUpload ?? false;
  };

  // Function to remove the input image (used by the compact clean-mode bar).
  const handleRemoveInputImage = () => {
    setUploadedReferences([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // Clear the file input
    }
  };

  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear your generation history?')) {
      setHistory([]);
      setSelectedVideo(null);
      setPreviewVideos([]);
      setIsPlaying({});
    }
  };

  // Add the handleKeyDown function
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { // Use metaKey for Mac compatibility
      e.preventDefault(); // Prevent default Enter behavior (newline)
      if (!isGenerating && !isProcessingImage && prompt.trim()) { // Check if not busy and prompt exists
        handleGenerate();
      }
    }
  };

  // Main return statement with conditional rendering
  return (
  <div className="flex flex-col h-full w-full min-w-0 min-h-0">
      {!apiTokenAvailable && (
        <ApiTokenNotice 
          serviceKey="replicate" 
          onTokenSaved={handleTokenSaved}
        />
      )}
      
      {isCleanMode ? (
        // --- Clean Mode Interface ---
        <div className="h-full w-full flex flex-col">
            {/* Placeholder for the main video preview area in clean mode */} 
            <div className="flex-1 bg-black/30 rounded-lg mb-2 flex items-center justify-center">
                <p className="text-white/50">Video Preview Area</p>
            </div>
            {/* Clean Mode Input Bar at the bottom - Corrected Props */}
            <CleanModeInputBar
                prompt={prompt}
                setPrompt={setPrompt}
                isGenerating={isGenerating}
                handleGenerate={handleGenerate}
                supportsImageUpload={supportsDirectImageUpload()}
                handleImageUpload={handleImageUpload}
                handleRemoveInputImage={handleRemoveInputImage}
                inputImage={inputImage}
                fileInputRef={fileInputRef}
                setShowAdvancedSettings={setShowAdvancedSettings}
            />
             {/* TODO: Add Clean Mode Advanced Settings Panel here, toggled by showAdvancedSettings */}
        </div>
      ) : (
        // --- Full Mode Interface ---
        // FULL INTERFACE (Existing Layout)
        <div className="flex flex-col-reverse h-full relative gap-3">
          {/* Bottom prompt bar (Dreamina-style floating composer) */}
          <div className="w-full flex-none px-2 pb-1">
            <div className="relative w-full max-w-3xl mx-auto bg-[#141414]/85 backdrop-blur-xl border border-white/10 rounded-2xl p-2.5 shadow-2xl shadow-black/40">
              
              {/* (model selector moved to the bottom toolbar) */}
              
              {/* Prompt composer — image references + rich editor */}
              <div className="relative">
                {/* Hidden multi-file input (persistent) */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  accept="image/*"
                  multiple
                  className="hidden"
                />

                {/* Reference images — tilted stacked pile that fans out on hover (Dreamina) */}
                <div className="flex items-center gap-2 mb-2">
                  {uploadedReferences.length > 0 && (
                    <div
                      className="relative flex-shrink-0"
                      style={{
                        height: REF_CARD,
                        width: referencesExpanded
                          ? uploadedReferences.length * (REF_CARD + REF_GAP) + REF_CARD
                          : Math.max(REF_CARD + (uploadedReferences.length - 1) * REF_PEEK, REF_CARD + 14),
                        transition: `width 0.3s ${REF_EASE}`,
                      }}
                    >
                      {uploadedReferences.map((ref, idx) => {
                        const entered = mountedRefIds.includes(ref.id);
                        const x = referencesExpanded ? idx * (REF_CARD + REF_GAP) : idx * REF_PEEK;
                        const rot = referencesExpanded ? 0 : refRotation(idx);
                        return (
                          <div
                            key={ref.id}
                            className="group/ref absolute top-0 left-0"
                            onMouseEnter={expandReferences}
                            onMouseLeave={collapseReferencesSoon}
                            style={{
                              width: REF_CARD,
                              height: REF_CARD,
                              transform: `translateX(${x}px) rotate(${rot}deg) scale(${entered ? 1 : 0.2})`,
                              opacity: entered ? 1 : 0,
                              zIndex: uploadedReferences.length - idx,
                              transition: `transform 0.3s ${REF_EASE}, opacity 0.3s ${REF_EASE}`,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => handleInsertReferenceChip(ref)}
                              disabled={isGenerating}
                              title="Insert into prompt"
                              className="relative w-full h-full rounded-md overflow-hidden border-[1.5px] border-white/40 bg-white/[0.06] block transition-transform duration-300 ease-in-out hover:-translate-y-1.5 focus:outline-none"
                            >
                              <img src={ref.url} alt={`Reference ${idx + 1}`} className="w-full h-full object-cover" draggable={false} />
                              <div className="absolute inset-0 bg-black/0 group-hover/ref:bg-black/25 transition-colors pointer-events-none" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleRemoveReference(ref.id); }}
                              disabled={isGenerating}
                              title="Remove reference"
                              style={{ transform: `rotate(${-rot}deg)` }}
                              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center bg-black/80 border border-white/30 text-white/80 opacity-0 group-hover/ref:opacity-100 hover:bg-red-600/80 transition-all z-10"
                            >
                              <X size={9} strokeWidth={2.5} />
                            </button>
                          </div>
                        );
                      })}

                      {/* Compact add button — tucked into the stack's bottom-right corner; morphs circle→square on hover */}
                      {uploadedReferences.length < MAX_REFERENCES && (
                        <button
                          type="button"
                          onClick={handleImageUploadClick}
                          onMouseEnter={keepReferencesExpanded}
                          onMouseLeave={collapseReferencesSoon}
                          disabled={isGenerating || isProcessingImage}
                          title="Add reference image"
                          style={{
                            left: referencesExpanded ? uploadedReferences.length * (REF_CARD + REF_GAP) : REF_CARD - 14,
                            top: referencesExpanded ? 0 : REF_CARD - 14,
                            width: referencesExpanded ? REF_CARD : 28,
                            height: referencesExpanded ? REF_CARD : 28,
                            borderRadius: 6,
                            transition: `left 0.3s ${REF_EASE}, top 0.3s ${REF_EASE}, width 0.3s ${REF_EASE}, height 0.3s ${REF_EASE}, border-radius 0.3s ${REF_EASE}, background-color 0.3s ${REF_EASE}`,
                          }}
                          className="group/add absolute z-30 flex flex-col items-center justify-center overflow-hidden bg-[#2e2e30] border-[0.5px] border-white/20 text-white/70 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Plus
                            size={14}
                            className="flex-shrink-0"
                            style={{ transform: referencesExpanded ? 'scale(1)' : 'scale(0.85)', transition: `transform 0.3s ${REF_EASE}` }}
                          />
                          <span
                            style={{
                              opacity: referencesExpanded ? 1 : 0,
                              transform: referencesExpanded ? 'scale(1)' : 'scale(0)',
                              maxHeight: referencesExpanded ? 16 : 0,
                              marginTop: referencesExpanded ? 2 : 0,
                              transition: `all 0.3s ${REF_EASE}`,
                            }}
                            className="text-[10px] leading-[14px] whitespace-nowrap overflow-hidden"
                          >
                            Reference
                          </span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Empty-state upload tile (full "Reference"); once refs exist, the compact + lives in the stack corner */}
                  {uploadedReferences.length === 0 && (
                    <button
                      type="button"
                      onClick={handleImageUploadClick}
                      disabled={isGenerating || isProcessingImage}
                      title="Add reference image"
                      style={{ width: REF_CARD, height: REF_CARD }}
                      className="group flex-shrink-0 flex flex-col items-center justify-center rounded-md bg-white/[0.03] text-white/50 hover:scale-110 hover:text-white/80 hover:bg-white/[0.06] transition-all duration-300 ease-in-out disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                      <Plus
                        size={15}
                        className="transition-transform duration-300 ease-in-out group-hover:scale-125"
                      />
                      <span className="text-[10px] leading-[14px] mt-0.5 whitespace-nowrap">Reference</span>
                    </button>
                  )}
                </div>

                {/* Rich prompt editor (TipTap, supports inline reference chips) */}
                <VideoPromptEditor
                  ref={editorRef}
                  value={prompt}
                  onChange={setPrompt}
                  onSubmit={() => { if (!isGenerating && !isProcessingImage && prompt.trim()) handleGenerate(); }}
                  disabled={isGenerating || isProcessingImage}
                  placeholder="Describe the video, or add an image reference…"
                />

                {/* Processing overlay */}
                {isProcessingImage && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-2xl z-20">
                    <div className="flex flex-col items-center">
                      <RotateCw size={24} className="text-white/80 animate-spin mb-2" />
                      <div className="text-sm text-white/80">Analyzing image…</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Advanced settings popover — slides up on open, down on close (⚙ toggles it) */}
              {settingsMounted && (
                <div
                  style={{
                    opacity: settingsVisible ? 1 : 0,
                    transform: settingsVisible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.98)',
                    transformOrigin: 'bottom center',
                    transition: 'opacity 0.3s cubic-bezier(0.16,0.84,0.3,1), transform 0.3s cubic-bezier(0.16,0.84,0.3,1)',
                  }}
                  className="absolute bottom-full mb-2 left-0 right-0 mx-auto max-w-3xl bg-[#141414]/95 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl shadow-black/50 max-h-[58vh] overflow-y-auto z-40 space-y-2 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
                >

              {/* Negative prompt for compatible models */}
              {(selectedModel === 'kling-video-v1-6') && (
                <div className="mt-2 space-y-2">
                  <label className="block text-xs text-white/70">Negative Prompt</label>
                  <textarea
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    placeholder="Things you don't want in the video"
                    className="w-full h-16 bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                    disabled={isGenerating}
                  />
                </div>
              )}
              
              {/* Credit usage info */}
              <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg px-1.5 py-2.5 mt-2 min-h-[40px] flex items-center">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center text-white/70">
                    <Info size={10} className="mr-1" />
                    <span className="text-xs">Credit usage</span>
                  </div>
                  <div className="text-xs">
                    {selectedModel.includes('wan') ? (
                      <>
                        <span className="text-white/90 font-medium">~150 credits</span>
                        <span className="text-white/50 ml-1">per video</span>
                        <div className="text-emerald-400 text-[10px] mt-0.5">Advanced T2V</div>
                      </>
                    ) : selectedModel.includes('veo2') ? (
                      <>
                        <span className="text-white/90 font-medium">~200 credits</span>
                        <span className="text-white/50 ml-1">per video</span>
                        <div className="text-purple-400 text-[10px] mt-0.5">Premium quality</div>
                      </>
                    ) : selectedModel.includes('minimax') || selectedModel.includes('hailuo') ? (
                      <>
                        <span className="text-white/90 font-medium">~100 credits</span>
                        <span className="text-white/50 ml-1">per video</span>
                        <div className="text-purple-400 text-[10px] mt-0.5">
                          {selectedModel.includes('hailuo') ? 'Mixed mode' : 'Fast generation'}
                        </div>
                      </>
                    ) : selectedModel.includes('hunyuan') ? (
                      <>
                        <span className="text-white/90 font-medium">~120 credits</span>
                        <span className="text-white/50 ml-1">per video</span>
                        <div className="text-amber-400 text-[10px] mt-0.5">Quality focused</div>
                      </>
                    ) : selectedModel.includes('luma') ? (
                      <>
                        <span className="text-white/90 font-medium">~180 credits</span>
                        <span className="text-white/50 ml-1">per video</span>
                        <div className="text-rose-400 text-[10px] mt-0.5">High-resolution</div>
                      </>
                    ) : selectedModel.includes('pika') ? (
                      <>
                        <span className="text-white/90 font-medium">~130 credits</span>
                        <span className="text-white/50 ml-1">per video</span>
                        <div className="text-sky-400 text-[10px] mt-0.5">Motion quality</div>
                      </>
                    ) : selectedModel.includes('kling') ? (
                      <>
                        <span className="text-white/90 font-medium">~160 credits</span>
                        <span className="text-white/50 ml-1">per video</span>
                        <div className="text-indigo-400 text-[10px] mt-0.5">Image-to-video</div>
                      </>
                    ) : (
                      <>
                        <span className="text-white/90 font-medium">~120 credits</span>
                        <span className="text-white/50 ml-1">per video</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Parameters controls */}
              <div className="mt-2">
                {/* Aspect Ratio Control */}
                <div className="mb-2 bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-white/70 text-xs">Aspect ratio</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      onClick={() => {
                        setAspectRatio('16:9');
                        setWidth(1024);
                        setHeight(576);
                      }}
                      className={`px-2 py-1.5 rounded-md text-xs ${ aspectRatio === '16:9' ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40' }`}
                    >
                      16:9
                    </button>
                    <button
                      onClick={() => {
                        setAspectRatio('9:16');
                        setWidth(576);
                        setHeight(1024);
                      }}
                      className={`px-2 py-1.5 rounded-md text-xs ${ aspectRatio === '9:16' ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40' }`}
                    >
                      9:16
                    </button>
                    <button
                      onClick={() => {
                        setAspectRatio('1:1');
                        setWidth(768);
                        setHeight(768);
                      }}
                      className={`px-2 py-1.5 rounded-md text-xs ${ aspectRatio === '1:1' ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40' }`}
                    >
                      1:1
                    </button>
                  </div>
                </div>
                
                {/* Duration control */}
                <div className="mb-2 bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-white/70 text-xs">Duration (seconds)</span>
                    <span className="text-white/70 text-xs">{duration}s</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max={selectedModel === 'kling-video-v1-6' ? 10 : selectedModel === 'veo-2' ? 8 : 5}
                    step="1"
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value))}
                    className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-blue-500" // Updated style
                    disabled={isGenerating}
                  />
                </div>
                
                {/* Number of Generations Control */}
                <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-white/70 text-xs">Number of videos</span>
                    <div className="flex items-center justify-end">
                      <button 
                        onClick={() => { if (numGenerations > 1) setNumGenerations(numGenerations - 1); }} 
                        disabled={numGenerations <= 1 || isGenerating}
                        className={`flex items-center justify-center h-6 w-6 rounded-md ${ numGenerations <= 1 || isGenerating ? 'text-white/30 cursor-not-allowed' : 'text-white/80 bg-black/30 hover:bg-black/50' }`}
                      >
                        <svg width="14" height="2" viewBox="0 0 14 2" xmlns="http://www.w3.org/2000/svg"><path d="M0 1h14" stroke="currentColor" strokeWidth="2"/></svg>
                      </button>
                      <div className="flex items-center justify-center w-8 text-white text-center text-xs"> {/* Adjusted size */}
                        {numGenerations}
                      </div>
                      <button 
                        onClick={() => { if (numGenerations < 4) setNumGenerations(numGenerations + 1); }} 
                        disabled={numGenerations >= 4 || isGenerating}
                        className={`flex items-center justify-center h-6 w-6 rounded-md ${ numGenerations >= 4 || isGenerating ? 'text-white/30 cursor-not-allowed' : 'text-white/80 bg-black/30 hover:bg-black/50' }`}
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="2"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
                
                {/* Seed Control */}
                <div className="mt-2 bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-white/70 text-xs">Seed</span>
                    <button 
                      onClick={() => setSeed(Math.floor(Math.random() * 1000000))}
                      className="text-xs text-blue-400 hover:text-blue-300"
                      disabled={isGenerating}
                    >
                      Random
                    </button>
                  </div>
                  <input
                    type="number"
                    value={seed >= 0 ? seed : ''}
                    onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : -1)}
                    placeholder="Random seed (-1 for random)" // Updated placeholder
                    className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                    disabled={isGenerating}
                  />
                </div>
              </div>
              
              {/* Model-specific settings (simplified) */}
              {/* Add Toggles for specific models if needed */}
              {hasAdvancedSettings(selectedModel) && (
                <div className="mt-2 bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2 space-y-1.5">
                  {(selectedModel === 'fal-ai/minimax/video-01-live' || selectedModel === 'hailuo-video-01-live') && (
                    <div className="flex items-center justify-between">
                      <label htmlFor="promptOptimizerToggle" className="text-white/70 text-xs flex-grow cursor-pointer">Prompt Optimizer</label>
                      <div className="relative inline-block w-8 align-middle select-none flex-shrink-0">
                        <input type="checkbox" id="promptOptimizerToggle" checked={promptOptimizer} onChange={(e) => setPromptOptimizer(e.target.checked)} className="sr-only peer" disabled={isGenerating} />
                        <div className="block h-4 bg-black/50 rounded-full w-8 peer-checked:bg-blue-600 transition duration-150 ease-in-out"></div>
                        <div className="absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white transition transform peer-checked:translate-x-4 duration-150 ease-in-out"></div>
                      </div>
                    </div>
                  )}
                   {selectedModel === 'luma-dream-machine-ray-2' && (
                    <div className="flex items-center justify-between">
                      <label htmlFor="loopVideoToggle" className="text-white/70 text-xs flex-grow cursor-pointer">Loop Video</label>
                      <div className="relative inline-block w-8 align-middle select-none flex-shrink-0">
                        <input type="checkbox" id="loopVideoToggle" checked={loopVideo} onChange={(e) => setLoopVideo(e.target.checked)} className="sr-only peer" disabled={isGenerating} />
                        <div className="block h-4 bg-black/50 rounded-full w-8 peer-checked:bg-blue-600 transition duration-150 ease-in-out"></div>
                        <div className="absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white transition transform peer-checked:translate-x-4 duration-150 ease-in-out"></div>
                      </div>
                    </div>
                  )}
                  {selectedModel === 'fal-ai/veo2' && (
                    <>
                      {/* Duration Control for Veo2 */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Duration</span>
                          <span className="text-white/50 text-xs">{duration}s</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {[5, 6, 7, 8].map(dur => (
                            <button
                              key={dur}
                              onClick={() => setDuration(dur)}
                              className={`px-2 py-1 rounded-md text-xs ${duration === dur ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {dur}s
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Aspect Ratio Control for Veo2 */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Aspect Ratio</span>
                          <span className="text-white/50 text-xs">{aspectRatio}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {['16:9', '9:16'].map(ratio => (
                            <button
                              key={ratio}
                              onClick={() => setAspectRatio(ratio)}
                              className={`px-2 py-1 rounded-md text-xs ${aspectRatio === ratio ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {ratio}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                  {selectedModel === 'fal-ai/hunyuan-video' && (
                    <>
                      {/* Aspect Ratio Control for Hunyuan Video */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Aspect Ratio</span>
                          <span className="text-white/50 text-xs">{hunyuanAspectRatio}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {['16:9', '9:16'].map(ratio => (
                            <button
                              key={ratio}
                              onClick={() => setHunyuanAspectRatio(ratio)}
                              className={`px-2 py-1 rounded-md text-xs ${hunyuanAspectRatio === ratio ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {ratio}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Resolution Control for Hunyuan Video */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Resolution</span>
                          <span className="text-white/50 text-xs">{hunyuanResolution}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {['480p', '580p', '720p'].map(res => (
                            <button
                              key={res}
                              onClick={() => setHunyuanResolution(res)}
                              className={`px-2 py-1 rounded-md text-xs ${hunyuanResolution === res ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {res}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Number of Frames Control for Hunyuan Video */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Number of Frames</span>
                          <span className="text-white/50 text-xs">{hunyuanNumFrames}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {['85', '129'].map(frames => (
                            <button
                              key={frames}
                              onClick={() => setHunyuanNumFrames(frames)}
                              className={`px-2 py-1 rounded-md text-xs ${hunyuanNumFrames === frames ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {frames}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Inference Steps Control for Hunyuan Video */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Inference Steps</span>
                          <span className="text-white/50 text-xs">{hunyuanNumInferenceSteps}</span>
                        </div>
                        <input
                          type="range"
                          min="2"
                          max="30"
                          step="1"
                          value={hunyuanNumInferenceSteps}
                          onChange={(e) => setHunyuanNumInferenceSteps(parseInt(e.target.value))}
                          className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-blue-500"
                          disabled={isGenerating}
                        />
                        <div className="text-xs text-white/50">Higher values = better quality, slower generation</div>
                      </div>
                      {/* Pro Mode Toggle for Hunyuan Video */}
                      <div className="flex items-center justify-between">
                        <label htmlFor="hunyuanProModeToggle" className="text-white/70 text-xs flex-grow cursor-pointer">Pro Mode (55 steps)</label>
                        <div className="relative inline-block w-8 align-middle select-none flex-shrink-0">
                          <input type="checkbox" id="hunyuanProModeToggle" checked={hunyuanProMode} onChange={(e) => setHunyuanProMode(e.target.checked)} className="sr-only peer" disabled={isGenerating} />
                          <div className="block h-4 bg-black/50 rounded-full w-8 peer-checked:bg-blue-600 transition duration-150 ease-in-out"></div>
                          <div className="absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white transition transform peer-checked:translate-x-4 duration-150 ease-in-out"></div>
                        </div>
                      </div>
                      {/* Safety Checker Toggle for Hunyuan Video */}
                      <div className="flex items-center justify-between">
                        <label htmlFor="hunyuanSafetyToggle" className="text-white/70 text-xs flex-grow cursor-pointer">Safety Checker</label>
                        <div className="relative inline-block w-8 align-middle select-none flex-shrink-0">
                          <input type="checkbox" id="hunyuanSafetyToggle" checked={hunyuanEnableSafetyChecker} onChange={(e) => setHunyuanEnableSafetyChecker(e.target.checked)} className="sr-only peer" disabled={isGenerating} />
                          <div className="block h-4 bg-black/50 rounded-full w-8 peer-checked:bg-blue-600 transition duration-150 ease-in-out"></div>
                          <div className="absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white transition transform peer-checked:translate-x-4 duration-150 ease-in-out"></div>
                        </div>
                      </div>
                    </>
                  )}
                  {selectedModel === 'fal-ai/luma-dream-machine/ray-2' && (
                    <>
                      {/* Aspect Ratio Control for Luma Dream Machine Ray-2 */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Aspect Ratio</span>
                          <span className="text-white/50 text-xs">{lumaAspectRatio}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {['16:9', '9:16', '4:3'].map(ratio => (
                            <button
                              key={ratio}
                              onClick={() => setLumaAspectRatio(ratio)}
                              className={`px-2 py-1 rounded-md text-xs ${lumaAspectRatio === ratio ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {ratio}
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-3 gap-1 mt-1">
                          {['3:4', '21:9', '9:21'].map(ratio => (
                            <button
                              key={ratio}
                              onClick={() => setLumaAspectRatio(ratio)}
                              className={`px-2 py-1 rounded-md text-xs ${lumaAspectRatio === ratio ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {ratio}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Resolution Control for Luma Dream Machine Ray-2 */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Resolution</span>
                          <span className="text-white/50 text-xs">{lumaResolution}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {['540p', '720p', '1080p'].map(res => (
                            <button
                              key={res}
                              onClick={() => setLumaResolution(res)}
                              className={`px-2 py-1 rounded-md text-xs ${lumaResolution === res ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {res} {res === '720p' ? '(2x)' : res === '1080p' ? '(4x)' : ''}
                            </button>
                          ))}
                        </div>
                        <div className="text-xs text-white/50">720p costs 2x more, 1080p costs 4x more</div>
                      </div>
                      {/* Duration Control for Luma Dream Machine Ray-2 */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Duration</span>
                          <span className="text-white/50 text-xs">{lumaDuration}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {['5s', '9s'].map(duration => (
                            <button
                              key={duration}
                              onClick={() => setLumaDuration(duration)}
                              className={`px-2 py-1 rounded-md text-xs ${lumaDuration === duration ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {duration} {duration === '9s' ? '(2x cost)' : ''}
                            </button>
                          ))}
                        </div>
                        <div className="text-xs text-white/50">9s duration costs 2x more than 5s</div>
                      </div>
                      {/* Loop Toggle for Luma Dream Machine Ray-2 */}
                      <div className="flex items-center justify-between">
                        <label htmlFor="lumaLoopToggle" className="text-white/70 text-xs flex-grow cursor-pointer">Seamless Loop</label>
                        <div className="relative inline-block w-8 align-middle select-none flex-shrink-0">
                          <input type="checkbox" id="lumaLoopToggle" checked={lumaLoop} onChange={(e) => setLumaLoop(e.target.checked)} className="sr-only peer" disabled={isGenerating} />
                          <div className="block h-4 bg-black/50 rounded-full w-8 peer-checked:bg-blue-600 transition duration-150 ease-in-out"></div>
                          <div className="absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white transition transform peer-checked:translate-x-4 duration-150 ease-in-out"></div>
                        </div>
                      </div>
                      <div className="text-xs text-white/50">When enabled, the end of the video blends seamlessly with the beginning for perfect loops</div>
                    </>
                  )}
                  {selectedModel === 'fal-ai/pika/v2.2/text-to-video' && (
                    <>
                      {/* Duration Control for Pika V2.2 */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Duration</span>
                          <span className="text-white/50 text-xs">{pikaDuration}s</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {[5, 6, 7, 8].map(dur => (
                            <button
                              key={dur}
                              onClick={() => setPikaDuration(dur)}
                              className={`px-2 py-1 rounded-md text-xs ${pikaDuration === dur ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {dur}s
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Aspect Ratio Control for Pika V2.2 */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Aspect Ratio</span>
                          <span className="text-white/50 text-xs">{pikaAspectRatio}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {['16:9', '9:16'].map(ratio => (
                            <button
                              key={ratio}
                              onClick={() => setPikaAspectRatio(ratio)}
                              className={`px-2 py-1 rounded-md text-xs ${pikaAspectRatio === ratio ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {ratio}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Resolution Control for Pika V2.2 */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Resolution</span>
                          <span className="text-white/50 text-xs">{pikaResolution}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {['720p', '1080p'].map(res => (
                            <button
                              key={res}
                              onClick={() => setPikaResolution(res)}
                              className={`px-2 py-1 rounded-md text-xs ${pikaResolution === res ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {res} {res === '1080p' ? '(2x cost)' : ''}
                            </button>
                          ))}
                        </div>
                        <div className="text-xs text-white/50">1080p costs 2x more than 720p</div>
                      </div>
                      {/* Negative Prompt Control for Pika V2.2 */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Negative Prompt</span>
                          <span className="text-white/50 text-xs">{pikaNegativePrompt}</span>
                        </div>
                        <textarea
                          value={pikaNegativePrompt}
                          onChange={(e) => setPikaNegativePrompt(e.target.value)}
                          placeholder="Things you don't want in the video"
                          className="w-full h-16 bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                          disabled={isGenerating}
                        />
                      </div>
                    </>
                  )}
                  {selectedModel === 'kling-video-v1-6' && (
                    <>
                      {/* Duration Control for Kling Video */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Duration</span>
                          <span className="text-white/50 text-xs">{klingDuration}s</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {[5, 6, 7, 8].map(dur => (
                            <button
                              key={dur}
                              onClick={() => setKlingDuration(dur.toString())}
                              className={`px-2 py-1 rounded-md text-xs ${klingDuration === dur.toString() ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {dur}s
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Aspect Ratio Control for Kling Video */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Aspect Ratio</span>
                          <span className="text-white/50 text-xs">{klingAspectRatio}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {['16:9', '9:16'].map(ratio => (
                            <button
                              key={ratio}
                              onClick={() => setKlingAspectRatio(ratio)}
                              className={`px-2 py-1 rounded-md text-xs ${klingAspectRatio === ratio ? 'bg-white/20 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
                              disabled={isGenerating}
                            >
                              {ratio}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Negative Prompt Control for Kling Video */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Negative Prompt</span>
                          <span className="text-white/50 text-xs">{klingNegativePrompt}</span>
                        </div>
                        <textarea
                          value={klingNegativePrompt}
                          onChange={(e) => setKlingNegativePrompt(e.target.value)}
                          placeholder="Things you don't want in the video"
                          className="w-full h-16 bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                          disabled={isGenerating}
                        />
                      </div>
                      {/* CFG Scale Control for Kling Video */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">CFG Scale</span>
                          <span className="text-white/50 text-xs">{klingCfgScale}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={klingCfgScale}
                          onChange={(e) => setKlingCfgScale(parseFloat(e.target.value))}
                          className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-blue-500"
                          disabled={isGenerating}
                        />
                        <div className="text-xs text-white/50">Higher values = more detailed and creative video</div>
                      </div>
                      {/* Tail Image URL Control for Kling Video */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white/70 text-xs">Tail Image URL</span>
                          <span className="text-white/50 text-xs">{klingTailImageUrl}</span>
                        </div>
                        <input
                          type="text"
                          value={klingTailImageUrl}
                          onChange={(e) => setKlingTailImageUrl(e.target.value)}
                          placeholder="Enter image URL"
                          className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                          disabled={isGenerating}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
              
                </div>
              )}

              {/* Bottom toolbar — Dreamina pill arrangement: model · aspect · duration · settings · generate */}
              <div className="flex items-center gap-2 mt-2">
                {/* Model pill (compact) */}
                <div className="flex-shrink-0 w-36 relative">
                  <ModelSelector selectedModel={selectedModel} onChange={setSelectedModel} disabled={isGenerating} />
                </div>

                {/* Reference mode select */}
                <ToolbarSelect
                  icon={<Wand2 size={13} className="text-white/50" />}
                  value={referenceMode}
                  onChange={setReferenceMode}
                  disabled={isGenerating}
                  title="Reference mode"
                  options={[
                    { value: 'omni', label: 'Omni reference' },
                    { value: 'image', label: 'Image reference' },
                    { value: 'style', label: 'Style reference' },
                    { value: 'character', label: 'Character reference' },
                  ]}
                />

                {/* Aspect ratio select */}
                <ToolbarSelect
                  icon={<Maximize size={13} className="text-white/50" />}
                  value={aspectRatio}
                  onChange={setAspectRatio}
                  disabled={isGenerating}
                  title="Aspect ratio"
                  options={[
                    { value: '16:9', label: '16:9' },
                    { value: '9:16', label: '9:16' },
                    { value: '1:1', label: '1:1' },
                  ]}
                />

                {/* Duration select */}
                <ToolbarSelect
                  icon={<Clock size={13} className="text-white/50" />}
                  value={String(duration)}
                  onChange={(v) => setDuration(parseInt(v, 10))}
                  disabled={isGenerating}
                  title="Duration"
                  options={[
                    { value: '3', label: '3s' },
                    { value: '4', label: '4s' },
                    { value: '5', label: '5s' },
                  ]}
                />

                {/* Number of videos select */}
                <ToolbarSelect
                  icon={<Film size={13} className="text-white/50" />}
                  value={String(numGenerations)}
                  onChange={(v) => setNumGenerations(parseInt(v, 10))}
                  disabled={isGenerating}
                  title="Number of videos"
                  options={[
                    { value: '1', label: '1 video' },
                    { value: '2', label: '2 videos' },
                    { value: '3', label: '3 videos' },
                    { value: '4', label: '4 videos' },
                  ]}
                />

                {/* Credit cost + Generate */}
                <div className="ml-auto flex items-center gap-2.5 flex-shrink-0">
                  <div className="flex items-center gap-1 text-xs" title="Estimated credit cost">
                    <img src="/xeno-credits-icon.svg" alt="" className="w-5 h-5 object-contain" />
                    <span className="font-medium text-white/85">{creditCostPerVideo(selectedModel) * numGenerations}</span>
                  </div>
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating || !prompt.trim() || (selectedMode === 'image-to-video' && !inputImage)}
                    className={`h-9 px-4 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
                      isGenerating
                        ? 'bg-[#a760ff]/40 text-white/70 cursor-not-allowed'
                        : prompt.trim() && (selectedMode !== 'image-to-video' || inputImage)
                          ? 'bg-[#a760ff] text-white hover:bg-[#b06fff]'
                          : 'bg-white/10 text-white/40 cursor-not-allowed'
                    }`}
                  >
                    {isGenerating ? (
                      <><RotateCw size={14} className="mr-1.5 animate-spin" />Generating…</>
                    ) : (
                      <><Send size={14} className="mr-1.5" />Generate</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          {/* Right side - Preview & History */}
          <div className="flex-1 min-h-0 px-2 flex flex-col">
            {/* Container 1: Preview Area */} 
             <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-4 flex flex-col flex-1 min-h-0"
                   style={{ minHeight: '320px' }}>
              {/* Preview Controls (Top Right) */}
              <div className="flex items-center justify-end mb-2 flex-shrink-0">
                {previewVideos.length > 0 && (
                  <div className="flex space-x-2">
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
              
              {/* Video display area */} 
               <div className="flex-1 relative rounded-lg overflow-hidden bg-black/20 flex items-center justify-center">
                {/* Video Container with Grid Layout for Multiple Videos */} 
                 <div className="absolute inset-0 flex items-center justify-center">
                  {isGenerating ? (
                    <div className="text-center z-10 p-4">
                       <div className="inline-block p-5 bg-blue-900/20 rounded-full shadow-lg mb-3">
                         <RotateCw className="w-8 h-8 animate-spin text-blue-400" />
                       </div>
                       <div className="text-sm text-white/80 font-medium">Generating...</div>
                    </div>
                  ) : (
                    previewVideos.length > 0 ? (
                      <div className={`relative w-full h-full ${previewVideos.length > 1 ? 'grid grid-cols-2 gap-1' : ''}`}> 
                         {previewVideos.map((videoUrl, index) => {
                          const videoKey = `video-${index}`;
                          const isVideoPlaying = isPlaying[videoKey] || false;
                          return (
                            <div key={videoKey} className="relative w-full h-full overflow-hidden border border-white/10 rounded-md group">
                               <div className="w-full h-full flex items-center justify-center bg-black">
                                <video 
                                  src={videoUrl} 
                                  controls={false}
                                  autoPlay={false}
                                  loop
                                  muted
                                  playsInline
                                  className="max-w-full max-h-full object-contain"
                                  ref={el => { 
                                    if (el) {
                                      if (isVideoPlaying) el.play().catch(e => console.error("Play error:", e));
                                      else el.pause();
                                    }
                                  }}
                                />
                              </div>
                               <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                                <div className="flex items-center space-x-4">
                                   <button 
                                    className="p-3 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
                                    onClick={() => setIsPlaying(prev => ({ ...prev, [videoKey]: !prev[videoKey] }))}
                                    title={isVideoPlaying ? "Pause" : "Play"}
                                  >
                                    {isVideoPlaying ? <Pause size={20} /> : <Play size={20} />}
                                  </button>
                                </div>
                              </div>
                               <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/70 via-black/50 to-transparent z-20">
                                <div className="flex justify-between items-center">
                                   {previewVideos.length > 1 && (
                                    <span className="text-[10px] bg-black/50 text-white/80 px-1.5 py-0.5 rounded">
                                      {index + 1}/{previewVideos.length}
                                    </span>
                                  )}
                                   <button 
                                    className="p-1 bg-white/10 hover:bg-white/20 rounded-md text-white/70 hover:text-white transition-colors ml-auto" // Use ml-auto to push right
                                    onClick={async () => { /* download logic */ 
                                      try {
                                        const response = await fetch(videoUrl);
                                        const blob = await response.blob();
                                        const url = window.URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.style.display = 'none';
                                        a.href = url;
                                        const filename = videoUrl.split('/').pop() || `generated-video-${Date.now()}-${index}.mp4`;
                                        a.download = filename;
                                        document.body.appendChild(a);
                                        a.click();
                                        window.URL.revokeObjectURL(url);
                                        document.body.removeChild(a);
                                      } catch (error) {
                                        console.error('Error downloading video:', error);
                                        notifications.error('Failed to download video');
                                      }
                                    }}
                                    title="Download Video"
                                  >
                                    <Download size={12} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })} 
                       </div>
                    ) : (
                       <div className="flex flex-col items-center text-center p-4">
                        <Video size={64} className="mx-auto mb-4 text-white/20" /> 
                         <p className="text-white/60">Video preview appears here</p>
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
            
            {/* Container 2: History Scrollable Area */} 
             <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 mt-2 overflow-hidden flex flex-col"
                   style={{ height: '120px', minHeight: '120px' }}>
               <div className="text-xs text-white/60 mb-1 px-1">Recent Generations</div>
               <div className="flex-1 overflow-x-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
                 <div className="flex space-x-2 h-full pb-1">
                   {history.length > 0 ? (
                     history.map((item) => (
                      <div 
                        key={item.id}
                        className={`relative flex-shrink-0 h-full aspect-video border rounded-lg overflow-hidden cursor-pointer group ${previewVideos.includes(item.video) ? 'border-blue-500 border-2' : 'border-white/10 hover:border-white/30'}`}
                        onClick={() => {
                          // Set this video as the current preview(s)
                           setSelectedVideo(item.video); // Keep for potential single-view logic
                           setPreviewVideos([item.video]); // Show only this one in preview
                          // Reset and play only this video
                           setIsPlaying({ [`video-0`]: true }); 
                         }}
                        title={`Preview: ${item.prompt}`}
                      >
                         <video 
                          src={item.video}
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          muted
                          preload="metadata" // Load only metadata for thumbnail
                         />
                         <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play size={24} className="text-white/80" />
                        </div>
                         {/* Optional: Show model/duration */} 
                         <span className="absolute bottom-1 left-1 bg-black/70 text-white/80 text-[9px] px-1 py-0.5 rounded">
                          {item.metadata?.model ? item.metadata.model.split('/').pop().substring(0,15) : 'Video'}
                           {item.metadata?.duration ? ` ${item.metadata.duration}s` : ''}
                         </span>
                      </div>
                     ))
                   ) : (
                     <div className="flex items-center justify-center w-full h-full text-white/50 text-sm">
                      <p>History will appear here</p>
                    </div>
                   )}
                 </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* TODO: Add Modal for Advanced Settings if needed for clean mode */}
      {/* {showAdvancedSettings && <SettingsModal onClose={() => setShowAdvancedSettings(false)} ... />} */}
    </div>
  );
};

export default VideoGenerationInterfaceCopy;

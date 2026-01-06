import React, { useState, useEffect, useRef } from 'react';
import { Video, Send, Download, Trash2, Sparkles, Plus, X, Info, RotateCw, Settings, ArrowUpRight, Wand2, Zap, Film, Monitor, Cpu } from 'lucide-react';
// TODO: Create and import a videoUpscaleService
import { checkApiTokens, API_TOKENS } from '../../../config/apiConfig';
import ApiTokenNotice from '../../common/ApiTokenNotice';
import { useLayout } from '../../../pages/Overview';

// Mock service for video upscaling
type MockVideoModelId = 'real-esrgan-video-x4plus' | 'real-esrgan-video-general-x4v3' | 'rife-4.6' | 'rife-4.15-lite' | 'topaz-proteus' | 'topaz-artemis' | 'waifu2x-video' | 'video-ai-enhancer' | 'frame-interpolation-ai' | 'dain-video' | 'st-gcn-video'; // Extended video model IDs

const mockVideoUpscaleService = {
  modelRegistry: {
    'real-esrgan-video-x4plus': { provider: 'mock', name: 'Real-ESRGAN Video x4+', defaultScale: 4, supportsFrameInterpolation: false },
    'real-esrgan-video-general-x4v3': { provider: 'mock', name: 'Real-ESRGAN Video General x4 v3', defaultScale: 4, supportsFrameInterpolation: false },
    'rife-4.6': { provider: 'mock', name: 'RIFE 4.6', defaultScale: 2, supportsFrameInterpolation: true, maxFps: 120 },
    'rife-4.15-lite': { provider: 'mock', name: 'RIFE 4.15 Lite', defaultScale: 2, supportsFrameInterpolation: true, maxFps: 60 },
    'topaz-proteus': { provider: 'mock', name: 'Topaz Proteus', defaultScale: 4, supportsDenoising: true },
    'topaz-artemis': { provider: 'mock', name: 'Topaz Artemis', defaultScale: 2, supportsDenoising: true, supportsDeinterlacing: true },
    'waifu2x-video': { provider: 'mock', name: 'Waifu2x Video', defaultScale: 2, supportsAnime: true },
    'video-ai-enhancer': { provider: 'mock', name: 'Video AI Enhancer', defaultScale: 4, supportsAIEnhancement: true },
    'frame-interpolation-ai': { provider: 'mock', name: 'Frame Interpolation AI', defaultScale: 1, supportsFrameInterpolation: true, maxFps: 240 },
    'dain-video': { provider: 'mock', name: 'DAIN Video', defaultScale: 2, supportsFrameInterpolation: true, maxFps: 60 },
    'st-gcn-video': { provider: 'mock', name: 'ST-GCN Video', defaultScale: 4, supportsMotionFlow: true },
  } as const,
  upscaleVideo: async (modelId: string, settings: any): Promise<{ success: boolean; videos?: { url: string; scale?: number }[]; error?: string; metadata?: any }> => {
    console.log(`[MockVideoUpscale] Upscaling with ${modelId}`, settings);
    
    // Simulate processing time based on model complexity
    const processingTime = modelId.includes('rife') ? 4000
                         : modelId.includes('topaz') ? 6000
                         : modelId.includes('ai-enhancer') ? 5000
                         : modelId.includes('frame-interpolation') ? 7000
                         : 3500;
    await new Promise(resolve => setTimeout(resolve, processingTime));

    // Lower failure rate for premium models
    const failureRate = modelId.includes('topaz') || modelId.includes('ai-enhancer') ? 0.05 : 0.12;
    if (Math.random() < failureRate) {
        const errorType = modelId.includes('rife') ? 'Frame interpolation error'
                         : modelId.includes('topaz') ? 'Topaz processing error'
                         : modelId.includes('ai-enhancer') ? 'AI enhancement error'
                         : 'Video processing error';
        return { success: false, error: `Mock video upscale failed: ${errorType}` };
    }
    
    // Simulate output video URL
    const outputUrl = settings.video_url;
    
    // Add model-specific metadata
    const metadata = {
      processingTime: processingTime / 1000,
      latency: 0.2,
      model: modelId,
      provider: 'mock',
      ...(modelId.includes('rife') && {
        enhancement_type: 'frame_interpolation',
        frame_interpolation: true,
        original_fps: settings.input_fps || 30,
        output_fps: settings.target_fps || 60,
        interpolation_quality: 'high'
      }),
      ...(modelId.includes('topaz') && {
        enhancement_type: 'professional_upscale',
        topaz_processing: true,
        noise_reduction: settings.denoise || true,
        deinterlacing: modelId.includes('artemis') ? (settings.deinterlace || false) : false,
        quality_boost: 'professional'
      }),
      ...(modelId.includes('ai-enhancer') && {
        enhancement_type: 'ai_powered',
        ai_enhancement: true,
        detail_enhancement: settings.detail_level || 'medium',
        artifact_reduction: true,
        quality_boost: 'ai_enhanced'
      }),
      ...(modelId.includes('waifu2x') && {
        enhancement_type: 'anime_optimized',
        anime_optimization: true,
        noise_reduction: settings.denoise || true,
        quality_boost: 'anime'
      })
    };
    
    return {
      success: true,
      videos: [{ url: outputUrl, scale: settings.scale }],
      metadata
    };
  },
  getModelDefaults: (modelId: string) => {
      if (modelId in mockVideoUpscaleService.modelRegistry) {
        return mockVideoUpscaleService.modelRegistry[modelId as MockVideoModelId];
      }
      return {};
  }
};
const videoUpscaleService = mockVideoUpscaleService; // Use mock service

// Interface for upscaled video results
interface UpscaledVideo {
    url: string;
    scale?: number;
}

// Interface for video upscale settings
interface VideoUpscaleSettings {
    video_url: string; // Input video data URL or source URL
    model: string;
    scale: number;
    prompt?: string; // Keep optional prompt
    // Add other video-specific settings (e.g., frame interpolation, noise reduction)
}

// Custom event for video upscale
export const VIDEO_UPSCALED_EVENT = 'video_upscaled';

// Simple notification helper (reused)
const notifications = {
  error: (message: string) => {
    console.error(`Error: ${message}`);
    alert("Error: " + message);
  },
  success: (message: string) => {
    console.log(`Success: ${message}`);
  }
};

// --- Video Model Definitions ---
interface UpscaleVideoModelFamily {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
  isNew?: boolean;
  isBeta?: boolean;
  submodels: UpscaleVideoSubModel[];
}

interface UpscaleVideoSubModel {
  id: string;
  name: string;
  description: string;
  defaultScale?: number;
  supportsFrameInterpolation?: boolean;
  supportsDenoising?: boolean;
  supportsDeinterlacing?: boolean;
  supportsAnime?: boolean;
  supportsAIEnhancement?: boolean;
  supportsMotionFlow?: boolean;
  maxFps?: number;
  isNew?: boolean;
  isBeta?: boolean;
}

const upscaleVideoModelFamilies: UpscaleVideoModelFamily[] = [
  {
    id: 'real-esrgan-video',
    name: 'Real-ESRGAN Video',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Sparkles size={16} className="text-green-400" /></div>,
    description: "Traditional video frame upscaling with Real-ESRGAN models optimized for video processing.",
    submodels: [
      {
        id: 'real-esrgan-video-x4plus',
        name: 'ESRGAN Video x4+',
        description: "High-quality 4x video frame upscaling, optimized for general video content.",
        defaultScale: 4,
        supportsFrameInterpolation: false,
        isNew: true,
      },
      {
        id: 'real-esrgan-video-general-x4v3',
        name: 'ESRGAN Video General x4 v3',
        description: "Alternative 4x model for general video content with improved temporal consistency.",
        defaultScale: 4,
        supportsFrameInterpolation: false,
      },
    ]
  },
  {
    id: 'rife-models',
    name: 'RIFE Frame Interpolation',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Film size={16} className="text-blue-400" /></div>,
    description: "Real-Time Intermediate Flow Estimation for video frame interpolation and smooth motion.",
    isNew: true,
    submodels: [
      {
        id: 'rife-4.6',
        name: 'RIFE 4.6',
        description: "Advanced frame interpolation model supporting up to 120fps output with superior motion estimation.",
        defaultScale: 2,
        supportsFrameInterpolation: true,
        maxFps: 120,
        isNew: true,
      },
      {
        id: 'rife-4.15-lite',
        name: 'RIFE 4.15 Lite',
        description: "Lightweight frame interpolation model for faster processing up to 60fps.",
        defaultScale: 2,
        supportsFrameInterpolation: true,
        maxFps: 60,
      },
    ]
  },
  {
    id: 'topaz-video',
    name: 'Topaz Video AI',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Monitor size={16} className="text-purple-400" /></div>,
    description: "Professional-grade video enhancement models for broadcast and production quality upscaling.",
    submodels: [
      {
        id: 'topaz-proteus',
        name: 'Topaz Proteus',
        description: "Professional 4x video upscaling with advanced noise reduction and detail enhancement.",
        defaultScale: 4,
        supportsDenoising: true,
        isBeta: true,
      },
      {
        id: 'topaz-artemis',
        name: 'Topaz Artemis',
        description: "Specialized for interlaced content with deinterlacing and 2x upscaling capabilities.",
        defaultScale: 2,
        supportsDenoising: true,
        supportsDeinterlacing: true,
        isBeta: true,
      },
    ]
  },
  {
    id: 'ai-enhancement',
    name: 'AI Video Enhancement',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Cpu size={16} className="text-amber-400" /></div>,
    description: "Advanced AI-powered video enhancement with intelligent detail restoration and artifact removal.",
    isNew: true,
    submodels: [
      {
        id: 'video-ai-enhancer',
        name: 'Video AI Enhancer',
        description: "AI-powered 4x video enhancement with intelligent detail restoration and artifact removal.",
        defaultScale: 4,
        supportsAIEnhancement: true,
        isNew: true,
      },
      {
        id: 'frame-interpolation-ai',
        name: 'Frame Interpolation AI',
        description: "Advanced AI frame interpolation supporting up to 240fps with motion-aware processing.",
        defaultScale: 1,
        supportsFrameInterpolation: true,
        maxFps: 240,
        isNew: true,
      },
    ]
  },
  {
    id: 'specialized-models',
    name: 'Specialized Models',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Wand2 size={16} className="text-rose-400" /></div>,
    description: "Specialized models for specific content types and advanced video processing techniques.",
    submodels: [
      {
        id: 'waifu2x-video',
        name: 'Waifu2x Video',
        description: "Optimized for anime and cartoon content with 2x upscaling and noise reduction.",
        defaultScale: 2,
        supportsAnime: true,
        supportsDenoising: true,
      },
      {
        id: 'dain-video',
        name: 'DAIN Video',
        description: "Depth-Aware video frame INterpolation for smooth 60fps output with motion analysis.",
        defaultScale: 2,
        supportsFrameInterpolation: true,
        maxFps: 60,
      },
      {
        id: 'st-gcn-video',
        name: 'ST-GCN Video',
        description: "Spatio-Temporal Graph Convolutional Networks for 4x upscaling with motion flow analysis.",
        defaultScale: 4,
        supportsMotionFlow: true,
        isBeta: true,
      },
    ]
  },
];

// --- Video Model Selector Component (Updated to match ImageEnhanceInterface style) ---
const UpscaleVideoModelSelector = ({
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
  const getModelInputType = (modelId: string): { type: 'Frame-Interp' | 'AI-Enhance' | 'Traditional'; color: string } => {
    switch (modelId) {
      case 'rife-4.6':
      case 'rife-4.15-lite':
      case 'frame-interpolation-ai':
      case 'dain-video':
        return { type: 'Frame-Interp', color: 'bg-blue-500/30 text-blue-300 border-blue-500/40' };
      case 'topaz-proteus':
      case 'topaz-artemis':
      case 'video-ai-enhancer':
      case 'st-gcn-video':
        return { type: 'AI-Enhance', color: 'bg-purple-500/30 text-purple-300 border-purple-500/40' };
      default:
        return { type: 'Traditional', color: 'bg-green-500/30 text-green-300 border-green-500/40' };
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
    for (const family of upscaleVideoModelFamilies) {
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
        className="w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-white/20 flex justify-between items-center"
        onClick={togglePanel}
        disabled={disabled}
      >
        <div className="flex items-center">
          {selectedDetails ? selectedDetails.family.icon : <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><Film size={16} className="text-blue-400" /></div>}
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
                {upscaleVideoModelFamilies.map(family => (
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
                          {family.isNew && <span className="ml-2 px-1.5 py-0.5 text-xs bg-green-500/30 text-green-300 rounded">NEW</span>}
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
                  {upscaleVideoModelFamilies.find(f => f.id === selectedFamily)?.name || 'Select Model'}
                </h3>
              </div>
              <div className="p-2">
                {upscaleVideoModelFamilies
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
                              {model.supportsFrameInterpolation && (
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Frame Interpolation"></div>
                              )}
                              <div className="w-1.5 h-1.5 rounded-full bg-red-400" title="Video Processing"></div>
                            </div>
                          </div>
                          
                          <p className={`text-xs leading-relaxed mb-1.5 transition-colors ${
                            selectedModel === model.id ? 'text-white/75' : 'text-white/65'
                          }`}>
                            {model.description}
                          </p>
                          
                          {/* Model-specific details - Right aligned */}
                          <div className="flex items-center justify-end gap-3 text-xs">
                            {/* Format info */}
                            <span className={`transition-colors ${
                              selectedModel === model.id ? 'text-white/60' : 'text-white/50'
                            }`}>
                              MP4/MOV
                            </span>
                            {/* Credit estimation based on model */}
                            {model.id.includes('topaz') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-purple-300' : 'text-purple-400/80'
                              }`}>
                                • Professional AI • ~800 credits
                              </span>
                            )}
                            {model.id.includes('rife') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-blue-300' : 'text-blue-400/80'
                              }`}>
                                • Frame Interpolation • ~160 credits
                              </span>
                            )}
                            {model.id.includes('video-ai-enhancer') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-amber-300' : 'text-amber-400/80'
                              }`}>
                                • AI Enhancement • ~600 credits
                              </span>
                            )}
                            {model.id.includes('frame-interpolation-ai') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-cyan-300' : 'text-cyan-400/80'
                              }`}>
                                • AI Interpolation • ~300 credits
                              </span>
                            )}
                            {model.id.includes('real-esrgan') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-green-300' : 'text-green-400/80'
                              }`}>
                                • Traditional • ~240 credits
                              </span>
                            )}
                            {model.id.includes('waifu2x') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-pink-300' : 'text-pink-400/80'
                              }`}>
                                • Anime Video • ~200 credits
                              </span>
                            )}
                            {model.id.includes('dain') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-indigo-300' : 'text-indigo-400/80'
                              }`}>
                                • Advanced Interp • ~400 credits
                              </span>
                            )}
                            {model.id.includes('st-gcn') && (
                              <span className={`transition-colors ${
                                selectedModel === model.id ? 'text-rose-300' : 'text-rose-400/80'
                              }`}>
                                • Motion Analysis • ~500 credits
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


// --- Main Video Upscale Interface Component ---
const VideoUpscaleInterface: React.FC = () => {
  const [inputVideo, setInputVideo] = useState<string | null>(null); // Renamed state
  const [isUpscaling, setIsUpscaling] = useState<boolean>(false);
  const [history, setHistory] = useState<Array<{ id: string; inputUrl: string; outputUrl: string; timestamp: Date; metadata?: any }>>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<{ inputUrl: string; outputUrl: string } | null>(null);
  const [previewVideo, setPreviewVideo] = useState<string | null>(null); // Renamed state
  const [upscaleError, setUpscaleError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null); // Ref for video player

  // Model and settings
  const [selectedModel, setSelectedModel] = useState<string>(upscaleVideoModelFamilies[0]?.submodels[0]?.id || ''); // Use video models

  // Initialize scaleFactor safely
  const initialModelDefaults = videoUpscaleService.getModelDefaults(selectedModel);
  const initialScale = ('defaultScale' in initialModelDefaults && typeof initialModelDefaults.defaultScale === 'number')
    ? initialModelDefaults.defaultScale as number
    : 2;
  const [scaleFactor, setScaleFactor] = useState<number>(initialScale);

  // State for optional prompt input (kept)
  const [showPromptInput, setShowPromptInput] = useState<boolean>(false);
  const [upscalePrompt, setUpscalePrompt] = useState<string>('');

  // Removed Zoom/Pan and Slider states - video player handles controls

  const [apiTokenAvailable, setApiTokenAvailable] = useState<boolean>(true);
  const [isCheckingToken, setIsCheckingToken] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);

  // Update settings when model changes
  useEffect(() => {
    const modelDefaults = videoUpscaleService.getModelDefaults(selectedModel);
    if (modelDefaults && 'defaultScale' in modelDefaults && typeof modelDefaults.defaultScale === 'number') {
      setScaleFactor(modelDefaults.defaultScale);
    } else {
      setScaleFactor(2);
    }
  }, [selectedModel]);

  // Load initial model
  useEffect(() => {
      if (!selectedModel && upscaleVideoModelFamilies.length > 0 && upscaleVideoModelFamilies[0].submodels.length > 0) {
          const initialModelId = upscaleVideoModelFamilies[0].submodels[0].id;
          setSelectedModel(initialModelId);
          const modelDefaults = videoUpscaleService.getModelDefaults(initialModelId);
          if (modelDefaults && 'defaultScale' in modelDefaults && typeof modelDefaults.defaultScale === 'number') {
              setScaleFactor(modelDefaults.defaultScale);
          } else {
               setScaleFactor(2);
          }
      }
  }, []);


  // --- Video Handling ---
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => { // Renamed function
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) { // Validate video type
        notifications.error('Please select a video file.');
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setInputVideo(dataUrl); // Update state
      setPreviewVideo(dataUrl); // Show input video initially
      setSelectedHistoryItem(null);
      // Reset video player state if needed (e.g., pause, reset time)
      if (previewVideoRef.current) {
          previewVideoRef.current.pause();
          previewVideoRef.current.currentTime = 0;
      }
    };
    reader.onerror = () => notifications.error("Error reading file");
    reader.readAsDataURL(file);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const removeInputVideo = () => { // Renamed function
    setInputVideo(null);
    setPreviewVideo(null);
    setSelectedHistoryItem(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
     // Reset video player state
      if (previewVideoRef.current) {
          previewVideoRef.current.pause();
          previewVideoRef.current.currentTime = 0;
          previewVideoRef.current.src = ''; // Clear source
      }
  };

  // --- Upscaling Logic ---
  const handleUpscale = async () => {
    if (!inputVideo) { // Check inputVideo
      notifications.error('Please upload a video to upscale.');
      return;
    }
    if (!selectedModel) {
        notifications.error('Please select an upscale model.');
        return;
    }

    setIsUpscaling(true);
    setUpscaleError(null);
    setIsLoading(true);

    try {
      const settings: VideoUpscaleSettings = { // Use VideoUpscaleSettings
        video_url: inputVideo, // Use video_url
        model: selectedModel,
        scale: scaleFactor,
      };

      // Add prompt if enabled
      if (showPromptInput && upscalePrompt.trim()) {
        settings.prompt = upscalePrompt.trim();
      }

      console.log('[VideoUpscale] Request:', settings);
      const result = await videoUpscaleService.upscaleVideo(selectedModel, settings); // Call video service
      console.log('[VideoUpscale] Result:', result);

      if (result.success && result.videos && result.videos.length > 0) { // Check result.videos
        const upscaledVideo = result.videos[0]; // Get video result

        setPreviewVideo(upscaledVideo.url); // Show the upscaled video
         // Add to history (adapt if needed)
          const newItem = {
              id: `upscale_vid_${Date.now()}`,
              inputUrl: inputVideo, // Store original video URL/data
              outputUrl: upscaledVideo.url,
              timestamp: new Date(),
              metadata: {
                  model: selectedModel,
                  scale: scaleFactor,
                  ...(result.metadata || {})
              }
          };
          setHistory(prev => [newItem, ...prev].slice(0, 20));
          setSelectedHistoryItem({ inputUrl: newItem.inputUrl, outputUrl: newItem.outputUrl });
          notifications.success('Video upscaled successfully');

      } else {
        setUpscaleError(result.error || 'Upscaling failed.');
        notifications.error(`Error: ${result.error || 'Upscaling failed'}`);
      }
    } catch (error) {
      console.error('Error upscaling video:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setUpscaleError(message);
      notifications.error(`Error: ${message}`);
    } finally {
      setIsLoading(false);
      setIsUpscaling(false);
    }
  };

  // --- History Management ---
  const handleSelectHistory = (item: { inputUrl: string; outputUrl: string }) => {
     setIsLoading(true);
     // No preloading for video, just set the sources
     setInputVideo(item.inputUrl);
     setPreviewVideo(item.outputUrl);
     setSelectedHistoryItem(item);
     setIsLoading(false);
     // Reset video player state
      if (previewVideoRef.current) {
          previewVideoRef.current.pause();
          previewVideoRef.current.currentTime = 0;
    }
  };
  
  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear the upscale history?')) {
      setHistory([]);
      setSelectedHistoryItem(null);
       if (previewVideo !== inputVideo) {
           setPreviewVideo(inputVideo); // Revert preview to current input or clear
           // Reset video player state
           if (previewVideoRef.current) {
              previewVideoRef.current.pause();
              previewVideoRef.current.currentTime = 0;
           }
       }
    }
  };

    const handleDeleteHistoryItem = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setHistory(prev => prev.filter(h => h.id !== id));
        const deletedItem = history.find(h => h.id === id);
        if (deletedItem && selectedHistoryItem?.outputUrl === deletedItem.outputUrl) {
            setSelectedHistoryItem(null);
            setPreviewVideo(inputVideo); // Revert preview to input video
            // Reset video player state
            if (previewVideoRef.current) {
                previewVideoRef.current.pause();
                previewVideoRef.current.currentTime = 0;
            }
        }
    };

    // Removed Zoom/Pan Logic

    // --- Render ---
  return (
          <div className="flex flex-col w-full h-full min-w-0 min-h-0 z-10">
      {/* Optional: Add API Token Notice */}
      {/*!apiTokenAvailable && (
        <ApiTokenNotice serviceKey="your_video_upscale_key" onTokenSaved={handleTokenSaved} />
      )*/}

      <div className="flex flex-col lg:flex-row h-full relative gap-2">
        {/* Left Panel (Controls) */}
        <div className="lg:w-[30%] lg:max-w-[350px] pr-1 pl-0">
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 space-y-2 h-full flex flex-col">
            <h2 className="text-base font-semibold text-white flex items-center"></h2> {/* Keep empty h2 */}
            
            <UpscaleVideoModelSelector
              selectedModel={selectedModel}
              onChange={setSelectedModel}
              disabled={isUpscaling}
            />
            
            <div className="mt-2"></div>
            
            {/* Video Input Area */}
            <div className="mt-2 space-y-2">
              <div className="relative">
                {!inputVideo ? (
                  <button
                    onClick={handleUploadClick}
                    className="w-full h-32 border-2 border-dashed border-white/20 rounded-lg flex flex-col items-center justify-center text-white/60 hover:bg-white/5 hover:border-white/30 transition-colors"
                  >
                    <Video size={32} className="mb-2" />
                    <span className="text-sm">Click to Upload Video</span>
                    <span className="text-xs mt-1">(or drag and drop)</span>
                  </button>
                ) : (
                  <div className="relative bg-black/30 rounded-lg overflow-hidden border border-white/10 group p-2">
                    <div className="flex justify-center">
                      <video 
                        src={inputVideo} 
                        className="max-h-20 max-w-full rounded object-contain cursor-pointer"
                        onClick={handleUploadClick}
                        controls={false}
                        muted
                        preload="metadata"
                      />
                    </div>
                    <button
                      onClick={removeInputVideo}
                      className="absolute top-1 right-1 p-1 bg-red-700/80 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                      title="Remove Video"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleVideoUpload}
                  accept="video/*"
                  className="hidden"
                />
              </div>
            </div>

            {/* Upscale Settings */}
            <div className="mt-2">
              {/* Optional Prompt Toggle */}
              <div className="mb-2 bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                <div className="flex items-center justify-between py-1">
                  <span className="text-white/70 text-xs flex items-center">
                    <Settings size={12} className="mr-1.5 text-blue-400"/> Add Prompt Guidance
                  </span>
                  <button
                    onClick={() => setShowPromptInput(!showPromptInput)}
                    disabled={isUpscaling}
                    className={`relative inline-flex items-center h-5 rounded-full w-9 transition-colors ${
                      showPromptInput ? 'bg-blue-600' : 'bg-black/40'
                    }`}
                  >
                    <span
                      className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform ${
                        showPromptInput ? 'translate-x-4.5' : 'translate-x-0.5'
                      }`}
                      style={{ transform: showPromptInput ? 'translateX(1.125rem)' : 'translateX(0.125rem)' }}
                    />
                  </button>
                </div>
              </div>
              
              {/* Optional Prompt Input Textarea */}
              {showPromptInput && (
                <div className="mb-2">
                  <textarea
                    value={upscalePrompt}
                    onChange={(e) => setUpscalePrompt(e.target.value)}
                    placeholder="Optional: Describe desired style or changes..."
                    className="w-full h-20 bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                    disabled={isUpscaling}
                  />
                </div>
              )}
              
              {/* Scale Factor */}
              <div className="mb-2 bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-white/70 text-xs">Scale Factor</span>
                  {selectedModel.includes('frame-interpolation') ? (
                    <div className="flex items-center text-white/60 text-xs">
                      <span className="text-amber-400">Frame Interpolation</span>
                      <span className="ml-1 text-white/40">(No Scaling)</span>
                    </div>
                  ) : selectedModel.includes('rife') ? (
                    <div className="flex items-center text-white/60 text-xs">
                      <span className="text-blue-400">Auto-Interpolation</span>
                      <span className="ml-1 text-white/40">(Smart FPS)</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end space-x-1">
                      {[2, 4, 8].map(factor => (
                        <button
                          key={factor}
                          onClick={() => setScaleFactor(factor)}
                          disabled={isUpscaling}
                          className={`px-3 py-1 rounded text-xs transition-colors ${
                            scaleFactor === factor
                              ? 'bg-white/20 text-white'
                              : 'bg-black/30 text-white/70 hover:bg-black/40'
                          }`}
                        >
                          {factor}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
                
            {/* Credit Usage Info */}
            <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg px-1.5 py-2.5 mt-2 min-h-[40px] flex items-center">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center text-white/70">
                  <Info size={10} className="mr-1 flex-shrink-0" />
                  <span className="text-xs flex-shrink-0">Credit usage</span>
                </div>
                <div className="text-xs text-right ml-2">
                  {selectedModel.includes('topaz-proteus') ? (
                    <>
                      <span className="text-white/90 font-medium">~800 credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-purple-400 text-[10px] mt-0.5">Professional enhancement</div>
                    </>
                  ) : selectedModel.includes('topaz-artemis') ? (
                    <>
                      <span className="text-white/90 font-medium">~400 credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-purple-400 text-[10px] mt-0.5">Deinterlacing + upscale</div>
                    </>
                  ) : selectedModel.includes('video-ai-enhancer') ? (
                    <>
                      <span className="text-white/90 font-medium">~600 credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-amber-400 text-[10px] mt-0.5">AI enhancement</div>
                    </>
                  ) : selectedModel.includes('frame-interpolation-ai') ? (
                    <>
                      <span className="text-white/90 font-medium">~300 credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-amber-400 text-[10px] mt-0.5">240fps interpolation</div>
                    </>
                  ) : selectedModel.includes('rife-4.6') ? (
                    <>
                      <span className="text-white/90 font-medium">~200 credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-blue-400 text-[10px] mt-0.5">120fps interpolation</div>
                    </>
                  ) : selectedModel.includes('rife-4.15-lite') ? (
                    <>
                      <span className="text-white/90 font-medium">~160 credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-blue-400 text-[10px] mt-0.5">60fps interpolation</div>
                    </>
                  ) : selectedModel.includes('real-esrgan') ? (
                    <>
                      <span className="text-white/90 font-medium">~{(scaleFactor * 60)} credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-green-400 text-[10px] mt-0.5">Traditional upscaling</div>
                    </>
                  ) : selectedModel.includes('waifu2x') ? (
                    <>
                      <span className="text-white/90 font-medium">~200 credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-pink-400 text-[10px] mt-0.5">Anime optimized</div>
                    </>
                  ) : selectedModel.includes('dain') ? (
                    <>
                      <span className="text-white/90 font-medium">~240 credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-rose-400 text-[10px] mt-0.5">Depth-aware interpolation</div>
                    </>
                  ) : selectedModel.includes('st-gcn') ? (
                    <>
                      <span className="text-white/90 font-medium">~400 credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-cyan-400 text-[10px] mt-0.5">Motion flow analysis</div>
                    </>
                  ) : (
                    <>
                      <span className="text-white/90 font-medium">~{(scaleFactor * 100)} credits</span>
                      <span className="text-white/50 ml-1">per upscale</span>
                      <div className="text-purple-400 text-[10px] mt-0.5">Video enhancement</div>
                    </>
                  )}
                </div>
              </div>
            </div>
                
            {/* Upscale Button */}
            <div className="mt-auto pt-2">
              <button
                onClick={handleUpscale}
                disabled={isUpscaling || !inputVideo || !selectedModel}
                className={`w-full p-3 rounded-lg text-white flex items-center justify-center text-xs font-semibold
                  ${
                    isUpscaling
                      ? 'bg-black/50 cursor-not-allowed'
                      : inputVideo && selectedModel
                        ? 'bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600'
                        : 'bg-zinc-800/40 hover:bg-zinc-800/60 border border-zinc-700/40 opacity-60'
                  }
                `}
              >
                {isUpscaling ? (
                  <>
                    <RotateCw size={14} className="mr-1.5 animate-spin" />
                    Upscaling...
                  </>
                ) : (
                  <>
                    <ArrowUpRight size={14} className="mr-1.5" />
                    Upscale Video
                  </>
                )}
              </button>
              {upscaleError && <p className="text-red-500 text-xs mt-2 text-center">Error: {upscaleError}</p>}
            </div>
          </div>
        </div>
        
        {/* Right Panel (Preview & History Bar) */}
        <div className="flex-1 lg:pl-2 lg:pr-0 pt-0 flex flex-col">
          {/* Container 1: Preview Area - Match Video Structure */}
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-4 flex flex-col"
               style={{ height: 'calc(100% - 120px - 8px)', minHeight: '400px' }}>
            
            {/* Preview Controls Area */}
            <div className="flex items-center justify-end mb-2 flex-shrink-0">
              {history.length > 0 && (
                <div className="flex space-x-2">
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

            {/* Preview display area */}
            <div className="flex-1 relative rounded-lg overflow-hidden bg-black/20 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center justify-center">
                {isLoading || isUpscaling ? (
                 <div className="text-center z-10 p-4">
                    <div className="inline-block p-5 bg-blue-900/20 rounded-full shadow-lg mb-3">
                        <RotateCw className="w-8 h-8 animate-spin text-blue-400" />
                    </div>
                    <div className="text-sm text-white/80 font-medium">
                        {isUpscaling ? 'Upscaling video...' : 'Loading video...'}
                    </div>
                  </div>
              ) : previewVideo ? (
                 // Display video using <video> tag
                 <div className="relative w-full h-full group"> {/* Added group for hover controls */}
                     <video
                        ref={previewVideoRef}
                        key={previewVideo} // Force re-render when src changes
                        src={previewVideo}
                        controls // Add basic player controls
                        className="w-full h-full object-contain"
                        preload="metadata" // Preload metadata for duration etc.
                        onError={(e) => { console.error('Preview video failed to load'); setUpscaleError('Preview video failed to load.'); }}
                     />
                      {/* Download Button (Hover) */}
                      <div className="absolute top-1 right-1 flex space-x-0.5 bg-black/70 p-0.5 rounded-md z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                         <button
                             className="p-1 hover:bg-white/10 rounded transition-colors text-white/80 hover:text-white"
                             onClick={async () => {
                                 if (previewVideo) {
                                     try {
                                         // Use fetch for potential CORS issues or direct link
                                         const response = await fetch(previewVideo);
                                         const blob = await response.blob();
                                         const url = window.URL.createObjectURL(blob);
                                         const a = document.createElement('a');
                                         a.style.display = 'none';
                                         a.href = url;
                                         // Create filename for video
                                         const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                                         const modelName = selectedModel.split('/').pop()?.replace(/[^a-z0-9]/gi, '-') || 'upscaled';
                                         // Guess extension based on common types or response header
                                         const extension = blob.type.split('/')[1] || 'mp4';
                                         a.download = `${modelName}_${scaleFactor}x_${timestamp}.${extension}`;
                                         document.body.appendChild(a);
                                         a.click();
                                         window.URL.revokeObjectURL(url);
                                         a.remove();
                                         notifications.success('Video downloaded');
                                     } catch (err) {
                                         console.error('Download failed:', err);
                                         // Fallback: Open in new tab might work for some sources
                                         // window.open(previewVideo, '_blank');
                                         notifications.error('Failed to download video. Try right-clicking the video.');
                                     }
                                 }
                             }}
                             title="Download Video"
                         >
                             <Download size={14} />
                         </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center p-4 text-white/40">
                  <Video size={64} className="mx-auto mb-4 opacity-50" />
                  <p>Upload a video to start</p>
                  <p className="text-sm mt-1">Upscaled preview will appear here</p>
                </div>
              )}
              </div>
            </div>
          </div>
          
          {/* Container 2: History Area */}
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 mt-2 overflow-hidden flex flex-col"
               style={{ height: '120px', minHeight: '120px' }}>
            {/* History Header & Clear Button */}
            <div className="flex justify-between items-center mb-1 px-1 flex-shrink-0">
              <div className="text-xs text-white/60">Recent Upscales</div>
              {history.length > 0 && (
                <button
                  onClick={handleClearHistory}
                  className="text-xs text-red-500/70 hover:text-red-500 transition-colors flex items-center"
                  title="Clear History"
                >
                  <Trash2 size={12} className="mr-0.5" /> Clear
                </button>
              )}
            </div>
            
            {/* History Scroll Area */}
            <div className="flex-1 overflow-x-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
              <div className="flex space-x-2 h-full pb-1">
                {history.length > 0 ? (
                  history.map((item) => (
                    <div 
                      key={item.id}
                      className={`relative flex-shrink-0 h-full aspect-video border rounded-lg overflow-hidden cursor-pointer group bg-black/30 transition-all
                        ${selectedHistoryItem?.outputUrl === item.outputUrl ? 'border-blue-500 border-2' : 'border-white/10 hover:border-white/30'}`}
                      onClick={() => handleSelectHistory({ inputUrl: item.inputUrl, outputUrl: item.outputUrl })}
                      title={`Upscaled ${item.metadata?.scale || '?'}x with ${item.metadata?.model?.split('/').pop() || 'model'}`}
                    >
                      {/* Video thumbnail placeholder */}
                      <div className="w-full h-full flex items-center justify-center bg-black">
                        <Video size={24} className="text-white/50" />
                      </div>
                      {/* Delete Button */}
                      <button
                        onClick={(e) => handleDeleteHistoryItem(item.id, e)}
                        className="absolute top-1 right-1 p-0.5 bg-red-600/80 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
                        title="Delete Item"
                      >
                        <X size={10} />
                      </button>
                      {/* Metadata */}
                      <span className="absolute bottom-1 left-1 bg-black/70 text-white/80 text-[9px] px-1 py-0.5 rounded">
                        {item.metadata?.model?.split('/').pop()?.substring(0,10) || 'Upscale'}
                        {item.metadata?.scale ? ` ${item.metadata.scale}x` : ''}
                      </span>
                    </div>
                  ))
                ) : (
                  /* Placeholder */
                  <div className="flex items-center justify-center w-full h-full text-white/50 text-sm">
                    <p>History will appear here</p>
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

// Export the main component
export default VideoUpscaleInterface;

// Optional: Add global Window type extension if needed
declare global {
  interface Window {
    // Define any specific API keys your video upscale service might need
  }
} 
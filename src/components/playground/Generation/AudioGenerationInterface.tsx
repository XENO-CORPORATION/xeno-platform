import React, { useState, useEffect, useRef } from 'react';
import { Music, Wand2, Info, Download, Loader, Settings, PlayCircle, PauseCircle, Volume2, Send, Trash2, RotateCw, Minus, Plus, ChevronDown, Sparkles, Film, RefreshCw, Headphones, Mic, Upload, X, Square, StopCircle } from 'lucide-react';
import { checkApiTokens, API_TOKENS } from '../../../config/apiConfig';
import ApiTokenNotice from '../../common/ApiTokenNotice';
import { generateAudio, isAudioModelSupported, MINIMAX_VOICES, MINIMAX_EMOTIONS, ORPHEUS_VOICES, ORPHEUS_EMOTIVE_TAGS, ELEVENLABS_VOICES, RESEMBLE_AI_VOICES, AudioModelSettings } from '../../../services/audioGenerationService';

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

// Define model families and their submodels for Audio
interface AudioModelFamily {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
  isNew?: boolean;
  isBeta?: boolean;
  submodels: AudioSubModel[];
}

interface AudioSubModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  type: 'music' | 'speech' | 'sfx' | 'all';
  isNew?: boolean;
  isBeta?: boolean;
  additionalInfo?: string;
  creditCost?: number;
}

// Enhanced audio model families with better organization
const audioModelFamilies: AudioModelFamily[] = [
  {
    id: 'minimax',
    name: 'MiniMax',
    icon: <div className="mr-2 rounded-lg bg-purple-500/20 border border-purple-500/30 p-2"><Music size={16} className="text-purple-400" /></div>,
    description: "Advanced AI music generation and high-quality text-to-speech synthesis with diverse voices and emotions.",
    submodels: [
      {
        id: 'fal-ai/minimax/speech-02-hd',
        name: 'Speech 02 HD',
        description: 'High-quality text-to-speech with multiple voice options, emotional control, and language support',
        provider: 'MiniMax',
        type: 'speech',
        creditCost: 60,
        isNew: true
      },
      {
        id: 'minimax-music', 
        name: 'MiniMax Music',
        description: 'Creates diverse musical compositions from text prompts with professional quality output',
        provider: 'MiniMax',
        type: 'music',
        creditCost: 80,
        isNew: true
      }
    ]
  },
  {
    id: 'orpheus',
    name: 'Orpheus',
    icon: <div className="mr-2 rounded-lg bg-orange-500/20 border border-orange-500/30 p-2"><Volume2 size={16} className="text-orange-400" /></div>,
    description: "Advanced text-to-speech with emotive expression and natural voice generation using creative controls.",
    isNew: true,
    submodels: [
      {
        id: 'fal-ai/orpheus-tts',
        name: 'Orpheus TTS',
        description: 'Expressive text-to-speech with emotive tags and creative temperature controls',
        provider: 'Orpheus',
        type: 'speech',
        creditCost: 50,
        isNew: true
      }
    ]
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    icon: <div className="mr-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 p-2"><Sparkles size={16} className="text-emerald-400" /></div>,
    description: "Professional voice synthesis and advanced sound effect generation with realistic audio output.",
    submodels: [
      {
        id: 'fal-ai/elevenlabs/tts/multilingual-v2',
        name: 'TTS Multilingual V2',
        description: 'Professional multilingual text-to-speech with advanced voice controls and 20+ voices',
        provider: 'ElevenLabs',
        type: 'speech',
        creditCost: 70,
        isNew: true
      },
      {
        id: 'fal-ai/elevenlabs/tts/turbo-v2.5',
        name: 'TTS Turbo V2.5',
        description: 'High-speed text-to-speech with optimized generation times and professional voice quality',
        provider: 'ElevenLabs',
        type: 'speech',
        creditCost: 60,
        isNew: true
      },
      {
        id: 'yue', 
        name: 'Yue',
        description: 'Open-source model that transforms lyrics into complete songs with vocal synthesis',
        provider: 'ElevenLabs',
        type: 'music',
        creditCost: 100,
        isBeta: true
      },
      {
        id: 'eleven-labs-sfx', 
        name: 'Sound Effects',
        description: 'Generates high-quality sound effects and ambient audio from detailed text descriptions',
        provider: 'ElevenLabs',
        type: 'sfx',
        creditCost: 60
      }
    ]
  },
  {
    id: 'stable-audio',
    name: 'Stable Audio',
    icon: <div className="mr-2 rounded-lg bg-blue-500/20 border border-blue-500/30 p-2"><RefreshCw size={16} className="text-blue-400" /></div>,
    description: "Stability AI's audio generation models for music, speech, and sound effects with customizable parameters.",
    isNew: true,
    submodels: [
      {
        id: 'stable-audio-v2',
        name: 'Stable Audio v2',
        description: 'Latest generation audio model with improved quality and extended duration support',
        provider: 'Stability AI',
        type: 'all',
        creditCost: 90,
        isNew: true
      }
    ]
  },
  {
    id: 'mmaudio',
    name: 'MMAudio V2',
    icon: <div className="mr-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30 p-2"><Film size={16} className="text-cyan-400" /></div>,
    description: "Advanced AI audio generation model capable of creating music, sound effects, and ambient audio with precise control over generation parameters.",
    isNew: true,
    submodels: [
      {
        id: 'fal-ai/mmaudio-v2/text-to-audio',
        name: 'Text-to-Audio',
        description: 'Generate music, sound effects, and ambient audio from text descriptions with advanced parameter control',
        provider: 'MMAudio',
        type: 'all',
        creditCost: 75,
        isNew: true
      }
    ]
  },
  {
    id: 'cassetteai',
    name: 'CassetteAI',
    icon: <div className="mr-2 rounded-lg bg-teal-500/20 border border-teal-500/30 p-2"><Volume2 size={16} className="text-teal-400" /></div>,
    description: "Specialized AI model for generating high-quality sound effects and foley audio with precise timing and realistic acoustic characteristics.",
    isNew: true,
    submodels: [
      {
        id: 'cassetteai/sound-effects-generator',
        name: 'Sound Effects Generator',
        description: 'Create realistic sound effects and foley audio from text descriptions with high-fidelity output',
        provider: 'CassetteAI',
        type: 'sfx',
        creditCost: 55,
        isNew: true
      }
    ]
  },
  {
    id: 'lyria',
    name: 'Lyria',
    icon: <div className="mr-2 rounded-lg bg-violet-500/20 border border-violet-500/30 p-2"><Headphones size={16} className="text-violet-400" /></div>,
    description: "Advanced AI text-to-music generation model capable of creating sophisticated musical compositions with detailed control over style and content.",
    isNew: true,
    submodels: [
      {
        id: 'fal-ai/lyria2',
        name: 'Lyria2',
        description: 'Generate complex musical compositions from text with advanced control over style, negative prompts, and reproducible seeds',
        provider: 'Lyria',
        type: 'music',
        creditCost: 85,
        isNew: true
      }
    ]
  },
  {
    id: 'resemble-ai',
    name: 'Resemble AI',
    icon: <div className="mr-2 rounded-lg bg-indigo-500/20 border border-indigo-500/30 p-2"><Mic size={16} className="text-indigo-400" /></div>,
    description: "Advanced AI voice technology offering both text-to-speech synthesis and speech-to-speech voice conversion with high-quality output and customizable voice characteristics.",
    isNew: true,
    submodels: [
      {
        id: 'resemble-ai/chatterboxhd/text-to-speech',
        name: 'ChatterboxHD Text-to-Speech',
        description: 'High-quality text-to-speech with emotion control, voice cloning capabilities, and advanced generation parameters',
        provider: 'Resemble AI',
        type: 'speech',
        creditCost: 60,
        isNew: true,
        additionalInfo: 'Supports predefined voices and zero-shot voice cloning from audio samples'
      },
      {
        id: 'resemble-ai/chatterboxhd/speech-to-speech',
        name: 'ChatterboxHD Speech-to-Speech',
        description: 'Transform existing speech audio into different target voices with high-quality voice conversion and optional upscaling to 48kHz',
        provider: 'Resemble AI',
        type: 'speech',
        creditCost: 65,
        isNew: true,
        additionalInfo: 'Supports predefined voices: Aurora, Blade, Britney, Carl, Cliff, Richard, Rico, Siobhan, Vicky'
      }
    ]
  }
];

// Enhanced Model Selector Component matching VideoGenerationInterface pattern
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
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  
  const animationStyles = isVisible ? {
    opacity: 1,
    transform: 'translateX(0)',
    transition: 'opacity 0.3s ease-out, transform 0.3s ease-out'
  } : {
    opacity: 0,
    transform: 'translateX(-20px)',
    transition: 'opacity 0.3s ease-out, transform 0.3s ease-out'
  };
  
  const togglePanel = () => {
    if (disabled) return;
    
    if (!isOpen) {
      setIsOpen(true);
      setTimeout(() => setIsVisible(true), 10);
    } else {
      setIsVisible(false);
      setTimeout(() => {
        setIsOpen(false);
        setSelectedFamilyId(null);
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
          setSelectedFamilyId(null);
        }, 300);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const findSelectedModelDetails = () => {
    for (const family of audioModelFamilies) {
      for (const model of family.submodels) {
        if (model.id === selectedModel) {
          return { family, model };
        }
      }
    }
    return null;
  };

  const selectedDetails = findSelectedModelDetails();
  
  const handleSelectFamily = (familyId: string) => {
    setSelectedFamilyId(familyId);
  };

  const handleSelectSubmodel = (modelId: string) => {
    onChange(modelId);
    setIsVisible(false);
    setTimeout(() => {
      setIsOpen(false);
      setSelectedFamilyId(null);
    }, 300);
  };

  return (
    <div className="relative">
      <button 
        ref={buttonRef}
        type="button"
        onClick={togglePanel}
        disabled={disabled}
        className={`w-full bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-white/20 flex justify-between items-center text-sm ${disabled ? 'opacity-70 cursor-not-allowed' : ''}`}
      >
        <div className="flex items-center">
          {selectedDetails ? selectedDetails.family.icon : <div className="mr-2 rounded-lg bg-purple-500/20 border border-purple-500/30 p-2"><Music size={16} className="text-purple-400" /></div>}
          <span>{selectedDetails ? selectedDetails.model.name : 'Select Model'}</span>
        </div>
        <ChevronDown 
          className={`w-4 h-4 transition-transform ${isOpen ? 'transform rotate-90' : 'transform -rotate-90'}`}
        />
      </button>
      
      {isOpen && (
        <div 
          ref={containerRef}
          className="absolute z-50 top-0 left-full ml-9 bg-[rgba(20,20,20,0.95)] border border-white/10 rounded-xl shadow-xl overflow-hidden w-[400px] backdrop-blur-sm"
          style={animationStyles}
        >
          {!selectedFamilyId ? (
            <div>
              <div className="p-3 border-b border-white/10 bg-black/20">
                <h3 className="text-sm font-medium text-white/80 text-center">Select Audio Model Family</h3>
              </div>
              <div className="p-2">
                {audioModelFamilies.map(family => (
                  <div
                    key={family.id}
                    className="rounded-lg p-3 hover:bg-white/5 cursor-pointer transition-all duration-200 border border-transparent hover:border-white/10"
                    onClick={() => handleSelectFamily(family.id)}
                  >
                    <div className="flex items-center">
                      {family.icon}
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center font-medium text-white">
                            {family.name}
                          </div>
                          <div className="flex items-center space-x-2">
                            {family.isNew && (
                              <span className="text-xs bg-green-600 text-white px-1.5 py-0.5 rounded uppercase font-bold">New</span>
                            )}
                            {family.isBeta && (
                              <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded uppercase font-bold">Beta</span>
                            )}
                            <ChevronDown className="w-4 h-4 transform -rotate-90 text-white/60" />
                          </div>
                        </div>
                        <div className="text-xs text-white/60 mt-1">{family.description}</div>
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
                  onClick={() => setSelectedFamilyId(null)}
                >
                  <ChevronDown className="w-4 h-4 mr-1 transform rotate-90" />
                </button>
                <h3 className="text-sm font-medium text-white/80">
                  {audioModelFamilies.find(f => f.id === selectedFamilyId)?.name || 'Select Model'}
                </h3>
              </div>
              <div className="p-2">
                {audioModelFamilies
                  .find(f => f.id === selectedFamilyId)?.submodels
                  .map((submodel, index, array) => (
                    <div 
                      key={submodel.id} 
                      className={`rounded-lg p-3 cursor-pointer transition-all duration-200 border ${
                        selectedModel === submodel.id
                          ? 'bg-purple-500/10 border-purple-500/40 shadow-md shadow-purple-500/10'
                          : 'border-white/10 hover:border-white/20 hover:bg-white/5'
                      } ${
                        index < array.length - 1 ? 'mb-2' : ''
                      }`}
                      onClick={() => handleSelectSubmodel(submodel.id)}
                    >
                      <div className="flex items-center">
                        <div className={`w-4 h-4 rounded-md mr-3 flex-shrink-0 border flex items-center justify-center transition-all duration-200 ${
                          selectedModel === submodel.id
                            ? 'border-purple-500 bg-purple-500'
                            : 'border-white/40 bg-transparent hover:border-white/60'
                        }`}>
                          {selectedModel === submodel.id && (
                            <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center flex-wrap gap-1.5">
                              <span className={`text-sm font-semibold transition-colors ${
                                selectedModel === submodel.id ? 'text-white' : 'text-white/90'
                              }`}>
                                {submodel.name}
                              </span>
                              <span className={`px-1.5 py-0.5 text-xs rounded font-medium border ${
                                submodel.type === 'music' ? 'bg-pink-600/30 text-pink-300 border-pink-500/40' : 
                                submodel.type === 'sfx' ? 'bg-teal-600/30 text-teal-300 border-teal-500/40' : 
                                submodel.type === 'speech' ? 'bg-orange-600/30 text-orange-300 border-orange-500/40' :
                                'bg-gray-600/30 text-gray-300 border-gray-500/40'
                              }`}>
                                {submodel.type}
                              </span>
                              {submodel.isNew && (
                                <span className="px-1.5 py-0.5 text-xs bg-green-600/30 text-green-300 rounded font-medium border border-green-500/40">
                                  NEW
                                </span>
                              )}
                              {submodel.isBeta && (
                                <span className="px-1.5 py-0.5 text-xs bg-blue-600/30 text-blue-300 rounded font-medium border border-blue-500/40">
                                  BETA
                                </span>
                              )}
                            </div>
                          </div>
                          
                          <p className={`text-xs leading-relaxed mb-1.5 transition-colors ${
                            selectedModel === submodel.id ? 'text-white/75' : 'text-white/65'
                          }`}>
                            {submodel.description}
                          </p>
                          
                          <div className="flex items-center justify-between text-xs">
                            <span className={`transition-colors ${
                              selectedModel === submodel.id ? 'text-white/60' : 'text-white/50'
                            }`}>
                              Provider: {submodel.provider}
                            </span>
                            {submodel.creditCost && (
                              <span className={`transition-colors ${
                                selectedModel === submodel.id ? 'text-purple-300' : 'text-purple-400/80'
                              }`}>
                                ~{submodel.creditCost} credits
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

// Model option interface
interface ModelOption {
  id: string;
  name: string;
  description: string;
  provider: string;
  type: 'music' | 'speech' | 'sfx' | 'all';
}

interface AudioPreview {
  url: string;
  type: 'audio' | 'mp3' | 'wav' | 'ogg';
  duration: number;
  waveform?: number[];
}

// History Item interface
interface AudioHistoryItem {
  id: string;
  audio: AudioPreview;
  prompt: string;
  timestamp: Date;
  metadata?: any;
}

const AudioGenerationInterface: React.FC = () => {
  // State variables for audio generation
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState('fal-ai/mmaudio-v2/text-to-audio');
  const [duration, setDuration] = useState(30);
  const [quality, setQuality] = useState('high');
  const [seed, setSeed] = useState<number>(-1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAudio, setGeneratedAudio] = useState<AudioPreview | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPromptThemeInput, setShowPromptThemeInput] = useState(false);
  const [promptTheme, setPromptTheme] = useState('');
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptGenerationSuccess, setPromptGenerationSuccess] = useState(false);
  const [apiTokenAvailable, setApiTokenAvailable] = useState<boolean>(false);
  const [isCheckingToken, setIsCheckingToken] = useState<boolean>(true);
  const [history, setHistory] = useState<AudioHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Minimax Speech specific controls
  const [voiceId, setVoiceId] = useState('Wise_Woman');
  const [emotion, setEmotion] = useState('neutral');
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [volume, setVolume] = useState(1);
  const [languageBoost, setLanguageBoost] = useState('auto');
  
  // Orpheus TTS specific controls
  const [orpheusVoice, setOrpheusVoice] = useState('tara');
  const [temperature, setTemperature] = useState(0.7);
  const [repetitionPenalty, setRepetitionPenalty] = useState(1.2);
  
  // ElevenLabs TTS specific controls
  const [elevenlabsVoice, setElevenlabsVoice] = useState('Rachel');
  const [stability, setStability] = useState(0.5);
  const [similarityBoost, setSimilarityBoost] = useState(0.75);
  const [style, setStyle] = useState(0);
  const [elevenlabsSpeed, setElevenlabsSpeed] = useState(1);
  const [timestamps, setTimestamps] = useState(false);
  
  // MMAudio V2 specific controls
  const [numSteps, setNumSteps] = useState(25);
  const [cfgStrength, setCfgStrength] = useState(4.5);
  const [maskAwayClip, setMaskAwayClip] = useState(false);
  const [negativePrompt, setNegativePrompt] = useState('');
  
  // Lyria2 specific controls
  const [lyriaNegativePrompt, setLyriaNegativePrompt] = useState('');
  
  // Resemble AI ChatterboxHD Speech-to-Speech specific controls
  const [sourceAudioUrl, setSourceAudioUrl] = useState('');
  const [resembleAiVoice, setResembleAiVoice] = useState('Aurora');
  const [targetVoiceAudioUrl, setTargetVoiceAudioUrl] = useState('');
  const [highQualityAudio, setHighQualityAudio] = useState(false);
  const [sourceAudioFile, setSourceAudioFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  
  // Resemble AI ChatterboxHD Text-to-Speech specific controls
  const [resembleTtsVoice, setResembleTtsVoice] = useState('Aurora');
  const [resembleTtsAudioUrl, setResembleTtsAudioUrl] = useState('');
  const [resembleTtsExaggeration, setResembleTtsExaggeration] = useState(0.5);
  const [resembleTtsTemperature, setResembleTtsTemperature] = useState(0.8);
  const [resembleTtsCfg, setResembleTtsCfg] = useState(0.5);
  const [resembleTtsHighQuality, setResembleTtsHighQuality] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Quality options for audio
  const qualityOptions = [
    { name: 'Standard', value: 'standard', description: 'Faster generation with good quality' },
    { name: 'High', value: 'high', description: 'Better quality with balanced generation time' },
    { name: 'Ultra', value: 'ultra', description: 'Best quality with longer generation time' }
  ];

  // Duration options for audio
  const durationPresets = [
    { value: 15, label: '15s' },
    { value: 30, label: '30s' },
    { value: 60, label: '1m' },
    { value: 120, label: '2m' },
    { value: 180, label: '3m' }
  ];
  
  // API is now proxied through backend - always available if user is logged in
  useEffect(() => {
    setIsCheckingToken(true);
    setApiTokenAvailable(true);
    setIsCheckingToken(false);
  }, []);
  
  const handleTokenSaved = () => {
    // API is now proxied through backend
    setApiTokenAvailable(true);

    if (hasToken) {
      // If token is now available, clear any error and start a new session
      console.log('Audio generation API token is now available');
    }
  };
  
  // Get selected model details for credit calculation
  const getSelectedModelDetails = () => {
    for (const family of audioModelFamilies) {
      for (const model of family.submodels) {
        if (model.id === selectedModel) {
          return model;
        }
      }
    }
    return null;
  };
  
  // Format duration in seconds to min:sec format
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Handle generating a prompt using AI
  const handleGeneratePrompt = async () => {
    setIsGeneratingPrompt(true);
    
    // Simulate AI-generated prompt with a timeout
    setTimeout(() => {
      const selectedModelObj = audioModelFamilies.find(f => f.submodels.some(sm => sm.id === selectedModel));
      let promptTemplates: string[] = [];
      
      // Set different templates based on model type
      const modelDetails = getSelectedModelDetails();
      if (selectedModel === 'cassetteai/sound-effects-generator') {
        promptTemplates = [
          "Dog barking loudly in the rain with distant thunder rumbling",
          "Car engine starting up and revving with exhaust backfire",
          "Footsteps walking on gravel path with leaves crunching underfoot",
          "Coffee machine brewing with steam hissing and water bubbling",
          "Door creaking open slowly with rusty hinges squeaking",
          "Wind howling through trees with branches swaying and rustling",
          "Clock ticking steadily with occasional mechanical clicking",
          "Fire crackling in fireplace with wood popping and burning",
          "Waves crashing on rocky shore with seagulls calling in distance",
          "Rain falling on rooftop with gutters dripping and splashing"
        ];
      } else if (selectedModel === 'fal-ai/lyria2') {
        promptTemplates = [
          "A lush, ambient soundscape featuring the serene sounds of a flowing river, complemented by the distant chirping of birds, and a gentle, melancholic piano melody that slowly unfolds",
          "Upbeat electronic dance track with pulsing synthesizers, driving bassline, and energetic drum patterns creating an exhilarating atmosphere",
          "Classical orchestral piece with soaring strings, majestic brass sections, and delicate woodwind passages evoking deep emotional resonance",
          "Jazz fusion composition featuring virtuosic saxophone improvisations over complex chord progressions with syncopated rhythms",
          "Cinematic ambient score with ethereal pads, subtle percussion, and haunting melodies perfect for dramatic storytelling",
          "Folk acoustic arrangement with fingerpicked guitar, gentle harmonies, and organic instrumental textures creating warmth and intimacy",
          "Modern hip-hop beat with innovative sound design, layered percussion, and atmospheric elements blending traditional and contemporary styles",
          "Minimalist ambient composition with slowly evolving textures, spacious reverbs, and contemplative melodic fragments"
        ];
      } else if (selectedModel === 'fal-ai/mmaudio-v2/text-to-audio') {
        promptTemplates = [
          "Gentle piano melody with soft strings accompaniment, relaxing and peaceful atmosphere",
          "Electronic dance music with energetic beats and synthesized bassline, uplifting and modern",
          "Nature sounds of flowing water and birds singing, creating a tranquil forest ambiance",
          "Jazz saxophone solo with walking bass and light percussion, smooth and sophisticated",
          "Orchestral cinematic score with dramatic crescendos and emotional violin sections",
          "Ambient electronic soundscape with ethereal pads and subtle percussion elements",
          "Classical guitar fingerpicking with warm acoustic tones, intimate and expressive",
          "Rain falling on leaves with distant thunder, creating a calming storm atmosphere"
        ];
      } else if (selectedModel === 'fal-ai/orpheus-tts') {
        promptTemplates = [
          "I just discovered something amazing! <gasp> You won't believe what I found in the attic today.",
          "Oh no, I think I left my keys inside the car again. <sigh> This is the third time this week!",
          "Welcome everyone to our special presentation. <chuckle> I hope you're as excited as I am about what we're going to share.",
          "The sunset over the mountains was absolutely breathtaking. <gasp> I've never seen anything so beautiful in my life.",
          "I'm sorry to keep you waiting. <cough> Let me get right to the important details we need to discuss."
        ];
      } else if (modelDetails?.type === 'speech' || selectedModel === 'fal-ai/minimax/speech-02-hd') {
        promptTemplates = [
          "Welcome to our presentation today. We'll be discussing the latest developments in artificial intelligence and how they impact our daily lives.",
          "In a world where technology advances rapidly, it's important to understand the fundamentals of machine learning and data science.",
          "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet.",
          "Ladies and gentlemen, thank you for joining us today. We have an exciting agenda ahead of us.",
          "Climate change represents one of the most significant challenges of our time, requiring immediate action and global cooperation."
        ];
      } else if (modelDetails?.type === 'music') {
        promptTemplates = [
          "GENRE music with INSTRUMENT as the main instrument, featuring MOOD and DETAIL",
          "A GENRE song with MOOD atmosphere and DETAIL elements",
          "INSTRUMENT-based GENRE track with MOOD feel, DETAIL",
          "Create a GENRE track that sounds MOOD with DETAIL"
        ];
      } else { // sfx or all
        promptTemplates = [
          "Sound effect of SUBJECT with DETAIL_1 and DETAIL_2",
          "Ambient sound of SUBJECT featuring DETAIL_1",
          "SUBJECT sounds with DETAIL_1 and DETAIL_2 qualities" 
        ];
      }
      
      // Variables for substitution depending on model type
      let substitutionValues: Record<string, string[]> = {};
      
      if (selectedModelObj?.submodels[0].type === 'music') {
        substitutionValues = {
          "GENRE": ['jazz', 'electronic', 'classical', 'rock', 'ambient', 'hip-hop', 'folk'],
          "INSTRUMENT": ['piano', 'guitar', 'synthesizer', 'drums', 'strings', 'saxophone', 'violin'],
          "MOOD": ['uplifting', 'melancholic', 'energetic', 'calm', 'dramatic', 'playful'],
          "DETAIL": ['with a strong bassline', 'with melodic elements', 'with crescendos', 'with a steady rhythm', 'with dynamic changes']
        };
      } else if (selectedModelObj?.submodels[0].type === 'speech') {
        substitutionValues = {
          "VOICE_TYPE": ['deep male', 'female', 'elderly', 'young', 'robotic', 'professional'],
          "TOPIC": ['a short story', 'a news bulletin', 'a poem', 'instructions', 'a scientific explanation'],
          "EMOTION": ['calm', 'enthusiastic', 'serious', 'joyful', 'solemn', 'neutral']
        };
      } else { // sfx or all
        substitutionValues = {
          "SUBJECT": ['forest', 'cityscape', 'ocean waves', 'machinery', 'spacecraft', 'rainfall', 'crowd'],
          "DETAIL_1": ['distant', 'prominent', 'subtle', 'echoing', 'layered', 'clear'],
          "DETAIL_2": ['natural reverb', 'stereo field', 'background elements', 'foreground focus', 'spatial depth']
        };
      }
      
      // Choose random template and make substitutions
      const template = promptTemplates[Math.floor(Math.random() * promptTemplates.length)];
      let generatedPrompt = template;
      
      // Use the theme if provided or make substitutions
      if (promptTheme) {
        if (selectedModel === 'cassetteai/sound-effects-generator') {
          const soundTypes = ['sound effect', 'foley audio', 'environmental sound', 'acoustic recording'];
          const randomType = soundTypes[Math.floor(Math.random() * soundTypes.length)];
          const descriptors = ['realistic', 'high-quality', 'detailed', 'layered', 'immersive'];
          const randomDescriptor = descriptors[Math.floor(Math.random() * descriptors.length)];
          generatedPrompt = `${promptTheme} ${randomType} with ${randomDescriptor} audio characteristics and natural acoustic properties`;
        } else if (selectedModel === 'fal-ai/lyria2') {
          const musicStyles = ['orchestral composition', 'electronic piece', 'ambient soundscape', 'jazz arrangement', 'cinematic score'];
          const randomStyle = musicStyles[Math.floor(Math.random() * musicStyles.length)];
          const descriptors = ['with rich harmonic progressions', 'featuring intricate melodic development', 'with dynamic textural layers', 'incorporating sophisticated rhythmic patterns'];
          const randomDescriptor = descriptors[Math.floor(Math.random() * descriptors.length)];
          generatedPrompt = `${promptTheme} ${randomStyle} ${randomDescriptor} and expressive musical storytelling`;
        } else if (selectedModel === 'fal-ai/mmaudio-v2/text-to-audio') {
          const audioTypes = ['music', 'ambient sounds', 'soundscape', 'audio composition'];
          const randomType = audioTypes[Math.floor(Math.random() * audioTypes.length)];
          generatedPrompt = `${promptTheme} ${randomType} with rich textures and dynamic elements, creating an immersive audio experience`;
        } else if (selectedModel === 'fal-ai/orpheus-tts') {
          const emotiveTags = ['<gasp>', '<chuckle>', '<sigh>', '<laugh>'];
          const randomTag = emotiveTags[Math.floor(Math.random() * emotiveTags.length)];
          generatedPrompt = `Let me tell you about ${promptTheme}. ${randomTag} This is truly fascinating and I think you'll find it as interesting as I do!`;
        } else if (modelDetails?.type === 'speech' || selectedModel === 'fal-ai/minimax/speech-02-hd') {
          generatedPrompt = `Today I'd like to talk about ${promptTheme}. This is an important topic that affects many aspects of our daily lives. Let me share some insights and perspectives on this subject.`;
        } else if (modelDetails?.type === 'music') {
          generatedPrompt = `${promptTheme} music with ${
            substitutionValues.MOOD[Math.floor(Math.random() * substitutionValues.MOOD.length)]
          } feel and ${
            substitutionValues.DETAIL[Math.floor(Math.random() * substitutionValues.DETAIL.length)]
          }`;
        } else {
          generatedPrompt = `Sound effect of ${promptTheme} with ${
            substitutionValues.DETAIL_1[Math.floor(Math.random() * substitutionValues.DETAIL_1.length)]
          } and ${
            substitutionValues.DETAIL_2[Math.floor(Math.random() * substitutionValues.DETAIL_2.length)]
          }`;
        }
      } else {
        // For specific models, pick appropriate templates
        if (selectedModel === 'cassetteai/sound-effects-generator') {
          generatedPrompt = promptTemplates[Math.floor(Math.random() * promptTemplates.length)];
        } else if (selectedModel === 'fal-ai/lyria2') {
          generatedPrompt = promptTemplates[Math.floor(Math.random() * promptTemplates.length)];
        } else if (selectedModel === 'fal-ai/mmaudio-v2/text-to-audio') {
          generatedPrompt = promptTemplates[Math.floor(Math.random() * promptTemplates.length)];
        } else if (selectedModel === 'fal-ai/orpheus-tts' || modelDetails?.type === 'speech' || selectedModel === 'fal-ai/minimax/speech-02-hd') {
          generatedPrompt = promptTemplates[Math.floor(Math.random() * promptTemplates.length)];
        } else {
          // Replace each placeholder with a random value for other models
          for (const [key, values] of Object.entries(substitutionValues)) {
            if (generatedPrompt.includes(key)) {
              const randomValue = values[Math.floor(Math.random() * values.length)];
              generatedPrompt = generatedPrompt.replace(key, randomValue);
            }
          }
        }
      }
      
      setPrompt(generatedPrompt);
      setIsGeneratingPrompt(false);
      setPromptGenerationSuccess(true);
      
      // Reset the success indicator after a delay
      setTimeout(() => {
        setPromptGenerationSuccess(false);
      }, 3000);
    }, 1500);
  };
  
  // Handle random seed
  const handleRandomSeed = () => {
    setSeed(Math.floor(Math.random() * 1000000));
  };

  // Audio upload and recording handlers for Resemble AI
  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      notifications.error('Please select an audio file.');
      return;
    }

    setSourceAudioFile(file);
    setRecordedAudioBlob(null); // Clear recorded audio if file is uploaded
    
    // Convert file to data URL for the API
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setSourceAudioUrl(dataUrl);
    };
    reader.onerror = () => notifications.error("Error reading file");
    reader.readAsDataURL(file);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const removeSourceAudio = () => {
    // Stop recording if active
    if (isRecording) {
      stopRecording();
    }
    
    setSourceAudioFile(null);
    setSourceAudioUrl('');
    setRecordedAudioBlob(null);
    setRecordingError(null);
    setRecordingDuration(0);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const startRecording = async () => {
    console.log("Starting audio recording...");
    setRecordingError(null);
    setRecordingDuration(0);
    
    // Check for microphone support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const error = 'Your browser does not support audio recording. Please use Chrome, Firefox, or Safari.';
      setRecordingError(error);
      notifications.error(error);
      return;
    }

    try {
      // Stop any existing recording first
      if (isRecording) {
        stopRecording();
        return;
      }

      // Get user media with specific audio constraints
      const audioConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(audioConstraints);
      streamRef.current = stream;
      console.log("Microphone access granted, stream obtained.");

      // Validate that we got audio tracks
      if (!stream.getAudioTracks().some(track => track.enabled && track.readyState === 'live')) {
        throw new Error('Failed to get a usable audio stream. Please check your microphone.');
      }

      // Determine the best supported MIME type
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus';
      }
      console.log(`Using MIME type: ${mimeType}`);

      // Initialize MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, { 
        mimeType: mimeType,
        audioBitsPerSecond: 128000 // 128kbps for good quality
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Set up event handlers
      mediaRecorder.ondataavailable = (event) => {
        console.log("MediaRecorder data available, size:", event.data.size);
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        console.log("MediaRecorder stopped, processing audio...");
        if (audioChunksRef.current.length === 0) {
          console.warn("No audio chunks recorded");
          setRecordingError('No audio was recorded. Please try again.');
          return;
        }

        // Create blob from chunks
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        console.log(`Recording complete. Blob size: ${blob.size} bytes, type: ${blob.type}`);
        
        if (blob.size === 0) {
          setRecordingError('Recording failed - no audio data captured.');
          return;
        }

        setRecordedAudioBlob(blob);
        setSourceAudioFile(null); // Clear uploaded file if recording
        
        // Convert blob to data URL for the API
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          setSourceAudioUrl(dataUrl);
          console.log("Audio converted to data URL successfully");
        };
        reader.onerror = () => {
          const error = 'Failed to process recorded audio.';
          setRecordingError(error);
          notifications.error(error);
        };
        reader.readAsDataURL(blob);
        
        // Clear chunks
        audioChunksRef.current = [];
      };

      mediaRecorder.onerror = (event: any) => {
        console.error('MediaRecorder error:', event);
        const error = `Recording error: ${event.error?.message || 'Unknown error'}`;
        setRecordingError(error);
        notifications.error(error);
        stopRecording();
      };

      mediaRecorder.onstart = () => {
        console.log("MediaRecorder started successfully");
        setIsRecording(true);
        setRecordingError(null);
        
        // Start duration timer
        recordingTimerRef.current = setInterval(() => {
          setRecordingDuration(prev => prev + 1);
        }, 1000);
      };

      // Start recording with time slices for better data handling
      mediaRecorder.start(1000); // 1 second chunks
      console.log("MediaRecorder.start() called");

    } catch (error: any) {
      console.error('Error starting recording:', error);
      let errorMessage = 'Failed to start recording.';
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage = 'Microphone access denied. Please allow microphone access and try again.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage = 'No microphone found. Please connect a microphone and try again.';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMessage = 'Microphone is in use by another application. Please close other apps using the microphone.';
      } else if (error.name === 'OverconstrainedError') {
        errorMessage = 'Microphone does not support the required audio settings.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setRecordingError(errorMessage);
      notifications.error(errorMessage);
      stopRecording();
    }
  };

  const stopRecording = () => {
    console.log("Stopping audio recording...");
    
    // Stop duration timer
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    
    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
        console.log("MediaRecorder stopped");
      } catch (error) {
        console.warn("Error stopping MediaRecorder:", error);
      }
    }
    
    // Stop and clean up media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log("Media track stopped");
      });
      streamRef.current = null;
    }
    
    // Reset recording state
    setIsRecording(false);
    
    // Clear refs
    mediaRecorderRef.current = null;
  };

  // Helper function to format recording duration
  const formatRecordingDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop recording if active
      if (isRecording) {
        stopRecording();
      }
      
      // Clear timer
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      
      // Stop media stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Handle selecting an item from history
  const handleSelectFromHistory = (item: AudioHistoryItem) => {
    setGeneratedAudio(item.audio);
    setPrompt(item.prompt);
    setSelectedModel(item.metadata?.model || selectedModel);
    setDuration(item.metadata?.duration || duration);
    setQuality(item.metadata?.quality || quality);
    setSeed(item.metadata?.seed === 'random' ? -1 : item.metadata?.seed || -1);
    
    // Restore model-specific settings
    if (item.metadata?.model === 'fal-ai/minimax/speech-02-hd') {
      if (item.metadata.voiceId) setVoiceId(item.metadata.voiceId);
      if (item.metadata.emotion) setEmotion(item.metadata.emotion);
      if (item.metadata.speed !== undefined) setSpeed(item.metadata.speed);
      if (item.metadata.pitch !== undefined) setPitch(item.metadata.pitch);
      if (item.metadata.volume !== undefined) setVolume(item.metadata.volume);
      if (item.metadata.languageBoost) setLanguageBoost(item.metadata.languageBoost);
    } else if (item.metadata?.model === 'fal-ai/orpheus-tts') {
      if (item.metadata.orpheusVoice) setOrpheusVoice(item.metadata.orpheusVoice);
      if (item.metadata.temperature !== undefined) setTemperature(item.metadata.temperature);
      if (item.metadata.repetitionPenalty !== undefined) setRepetitionPenalty(item.metadata.repetitionPenalty);
    } else if (item.metadata?.model === 'fal-ai/elevenlabs/tts/multilingual-v2' || item.metadata?.model === 'fal-ai/elevenlabs/tts/turbo-v2.5') {
      if (item.metadata.elevenlabsVoice) setElevenlabsVoice(item.metadata.elevenlabsVoice);
      if (item.metadata.stability !== undefined) setStability(item.metadata.stability);
      if (item.metadata.similarityBoost !== undefined) setSimilarityBoost(item.metadata.similarityBoost);
      if (item.metadata.style !== undefined) setStyle(item.metadata.style);
      if (item.metadata.elevenlabsSpeed !== undefined) setElevenlabsSpeed(item.metadata.elevenlabsSpeed);
      if (item.metadata.timestamps !== undefined) setTimestamps(item.metadata.timestamps);
    } else if (item.metadata?.model === 'fal-ai/mmaudio-v2/text-to-audio') {
      if (item.metadata.numSteps !== undefined) setNumSteps(item.metadata.numSteps);
      if (item.metadata.cfgStrength !== undefined) setCfgStrength(item.metadata.cfgStrength);
      if (item.metadata.maskAwayClip !== undefined) setMaskAwayClip(item.metadata.maskAwayClip);
      if (item.metadata.negativePrompt !== undefined) setNegativePrompt(item.metadata.negativePrompt);
    } else if (item.metadata?.model === 'fal-ai/lyria2') {
      if (item.metadata.lyriaNegativePrompt !== undefined) setLyriaNegativePrompt(item.metadata.lyriaNegativePrompt);
    } else if (item.metadata?.model === 'resemble-ai/chatterboxhd/text-to-speech') {
      if (item.metadata.resembleTtsVoice) setResembleTtsVoice(item.metadata.resembleTtsVoice);
      if (item.metadata.resembleTtsAudioUrl) setResembleTtsAudioUrl(item.metadata.resembleTtsAudioUrl);
      if (item.metadata.resembleTtsExaggeration !== undefined) setResembleTtsExaggeration(item.metadata.resembleTtsExaggeration);
      if (item.metadata.resembleTtsTemperature !== undefined) setResembleTtsTemperature(item.metadata.resembleTtsTemperature);
      if (item.metadata.resembleTtsCfg !== undefined) setResembleTtsCfg(item.metadata.resembleTtsCfg);
      if (item.metadata.resembleTtsHighQuality !== undefined) setResembleTtsHighQuality(item.metadata.resembleTtsHighQuality);
    }
    
    setIsPlaying(false);
  };

  // Handle clearing history
  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear your audio generation history?')) {
      setHistory([]);
      setGeneratedAudio(null);
      setIsPlaying(false);
    }
  };

  // Function to generate mock waveform data
  const generateMockWaveform = (length: number): number[] => {
    return Array.from({ length }, () => Math.random() * 0.8 + 0.1); // Values between 0.1 and 0.9
  };

  // Render Waveform (simplified visualization)
  const renderWaveform = (waveform: number[] | undefined, height: number = 60) => {
    if (!waveform || waveform.length === 0) {
      return <div className="h-full w-full bg-black/20 flex items-center justify-center text-white/30 text-xs">No waveform data</div>;
    }
    const width = 300; // Fixed width for simplicity
    const barWidth = width / waveform.length;
    
    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block">
        {waveform.map((value, index) => {
          const barHeight = value * height;
          const y = (height - barHeight) / 2;
          return (
            <rect 
              key={index} 
              x={index * barWidth} 
              y={y} 
              width={barWidth * 0.8} // Make bars slightly thinner
              height={barHeight} 
              fill="currentColor" // Use text color
              rx="1" // Slightly rounded bars
            />
          );
        })}
      </svg>
    );
  };

  // Handle audio playback
  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(e => console.error("Audio play error:", e));
    }
    setIsPlaying(!isPlaying);
  };
  
  // Listen to audio element events to update play state
  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    const handleAudioPlay = () => setIsPlaying(true);
    const handleAudioPause = () => setIsPlaying(false);
    const handleAudioEnded = () => setIsPlaying(false);

    audioElement.addEventListener('play', handleAudioPlay);
    audioElement.addEventListener('pause', handleAudioPause);
    audioElement.addEventListener('ended', handleAudioEnded);

    return () => {
      audioElement.removeEventListener('play', handleAudioPlay);
      audioElement.removeEventListener('pause', handleAudioPause);
      audioElement.removeEventListener('ended', handleAudioEnded);
    };
  }, [generatedAudio]);

  // Handle generating audio
  const handleGenerate = async () => {
    // Special validation for speech-to-speech model
    if (selectedModel === 'resemble-ai/chatterboxhd/speech-to-speech') {
      if (!sourceAudioUrl.trim() && !sourceAudioFile && !recordedAudioBlob) {
        notifications.error('Please upload an audio file or record audio for speech-to-speech conversion');
        return;
      }
    } else if (!prompt.trim()) {
      notifications.error('Please enter a prompt before generating');
      return;
    }
    
    // API token check no longer needed - backend handles auth

    setIsGenerating(true);
    setIsLoading(true);
    setGeneratedAudio(null);
    setIsPlaying(false);

    try {
      console.log("Generating Audio with settings:", { prompt, selectedModel, duration, quality, seed });
      
      // Check if this is a supported real model
      if (isAudioModelSupported(selectedModel)) {
        // Use real audio generation service
        const audioSettings: AudioModelSettings = {
          text: prompt, // Use text for TTS models
          prompt: prompt, // Fallback for music models
        };

        // Add model-specific settings for Minimax Speech
        if (selectedModel === 'fal-ai/minimax/speech-02-hd') {
          audioSettings.voice_setting = {
            voice_id: voiceId,
            speed: speed,
            vol: volume,
            pitch: pitch,
            emotion: emotion,
            english_normalization: false,
          };
          audioSettings.language_boost = languageBoost;
          audioSettings.output_format = 'url';
          audioSettings.audio_setting = {
            format: 'mp3',
            sample_rate: 32000,
            channel: 1,
            bitrate: 128000,
          };
        }
        
        // Add model-specific settings for Orpheus TTS
        else if (selectedModel === 'fal-ai/orpheus-tts') {
          audioSettings.voice = orpheusVoice;
          audioSettings.temperature = temperature;
          audioSettings.repetition_penalty = repetitionPenalty;
        }
        
        // Add model-specific settings for ElevenLabs TTS
        else if (selectedModel === 'fal-ai/elevenlabs/tts/multilingual-v2' || selectedModel === 'fal-ai/elevenlabs/tts/turbo-v2.5') {
          audioSettings.voice = elevenlabsVoice;
          audioSettings.stability = stability;
          audioSettings.similarity_boost = similarityBoost;
          audioSettings.style = style;
          audioSettings.speed = elevenlabsSpeed;
          audioSettings.timestamps = timestamps;
        }
        
        // Add model-specific settings for MMAudio V2
        else if (selectedModel === 'fal-ai/mmaudio-v2/text-to-audio') {
          audioSettings.num_steps = numSteps;
          audioSettings.duration = duration;
          audioSettings.cfg_strength = cfgStrength;
          audioSettings.mask_away_clip = maskAwayClip;
          audioSettings.negative_prompt = negativePrompt;
        }
        
        // Add model-specific settings for Lyria2
        else if (selectedModel === 'fal-ai/lyria2') {
          audioSettings.negative_prompt = lyriaNegativePrompt;
        }
        
        // Add model-specific settings for Resemble AI ChatterboxHD Speech-to-Speech
        else if (selectedModel === 'resemble-ai/chatterboxhd/speech-to-speech') {
          audioSettings.source_audio_url = sourceAudioUrl;
          audioSettings.target_voice = resembleAiVoice;
          audioSettings.target_voice_audio_url = targetVoiceAudioUrl || undefined;
          audioSettings.high_quality_audio = highQualityAudio;
        }
        
        // Add model-specific settings for Resemble AI ChatterboxHD Text-to-Speech
        else if (selectedModel === 'resemble-ai/chatterboxhd/text-to-speech') {
          audioSettings.voice = resembleTtsVoice;
          audioSettings.audio_url = resembleTtsAudioUrl || undefined;
          audioSettings.exaggeration = resembleTtsExaggeration;
          audioSettings.temperature = resembleTtsTemperature;
          audioSettings.cfg = resembleTtsCfg;
          audioSettings.high_quality_audio = resembleTtsHighQuality;
        }

        // Add seed if specified
        if (seed >= 0) {
          audioSettings.seed = seed;
        }

        const response = await generateAudio(selectedModel, audioSettings, (queueUpdate) => {
          console.log('Queue update:', queueUpdate);
        });

        if (response.success && response.audio) {
          const result: AudioPreview = {
            url: response.audio.url,
            type: 'mp3',
            duration: response.audio.duration || Math.round((response.audio.duration_ms || 30000) / 1000),
            waveform: generateMockWaveform((response.audio.duration || 30) * 10)
          };

          setGeneratedAudio(result);

          // Add to history
          const newHistoryItem: AudioHistoryItem = {
            id: Date.now().toString(),
            audio: result,
            prompt: prompt,
            timestamp: new Date(),
                          metadata: {
                model: selectedModel,
                duration: result.duration,
                quality: quality,
                seed: seed >= 0 ? seed : 'random',
                // Minimax settings
                voiceId: selectedModel === 'fal-ai/minimax/speech-02-hd' ? voiceId : undefined,
                emotion: selectedModel === 'fal-ai/minimax/speech-02-hd' ? emotion : undefined,
                speed: selectedModel === 'fal-ai/minimax/speech-02-hd' ? speed : undefined,
                pitch: selectedModel === 'fal-ai/minimax/speech-02-hd' ? pitch : undefined,
                volume: selectedModel === 'fal-ai/minimax/speech-02-hd' ? volume : undefined,
                languageBoost: selectedModel === 'fal-ai/minimax/speech-02-hd' ? languageBoost : undefined,
                // Orpheus settings
                orpheusVoice: selectedModel === 'fal-ai/orpheus-tts' ? orpheusVoice : undefined,
                temperature: selectedModel === 'fal-ai/orpheus-tts' ? temperature : undefined,
                repetitionPenalty: selectedModel === 'fal-ai/orpheus-tts' ? repetitionPenalty : undefined,
                // ElevenLabs settings
                elevenlabsVoice: (selectedModel === 'fal-ai/elevenlabs/tts/multilingual-v2' || selectedModel === 'fal-ai/elevenlabs/tts/turbo-v2.5') ? elevenlabsVoice : undefined,
                stability: (selectedModel === 'fal-ai/elevenlabs/tts/multilingual-v2' || selectedModel === 'fal-ai/elevenlabs/tts/turbo-v2.5') ? stability : undefined,
                similarityBoost: (selectedModel === 'fal-ai/elevenlabs/tts/multilingual-v2' || selectedModel === 'fal-ai/elevenlabs/tts/turbo-v2.5') ? similarityBoost : undefined,
                style: (selectedModel === 'fal-ai/elevenlabs/tts/multilingual-v2' || selectedModel === 'fal-ai/elevenlabs/tts/turbo-v2.5') ? style : undefined,
                elevenlabsSpeed: (selectedModel === 'fal-ai/elevenlabs/tts/multilingual-v2' || selectedModel === 'fal-ai/elevenlabs/tts/turbo-v2.5') ? elevenlabsSpeed : undefined,
                timestamps: (selectedModel === 'fal-ai/elevenlabs/tts/multilingual-v2' || selectedModel === 'fal-ai/elevenlabs/tts/turbo-v2.5') ? timestamps : undefined,
                // MMAudio V2 settings
                numSteps: selectedModel === 'fal-ai/mmaudio-v2/text-to-audio' ? numSteps : undefined,
                cfgStrength: selectedModel === 'fal-ai/mmaudio-v2/text-to-audio' ? cfgStrength : undefined,
                maskAwayClip: selectedModel === 'fal-ai/mmaudio-v2/text-to-audio' ? maskAwayClip : undefined,
                negativePrompt: selectedModel === 'fal-ai/mmaudio-v2/text-to-audio' ? negativePrompt : undefined,
                // Lyria2 settings
                lyriaNegativePrompt: selectedModel === 'fal-ai/lyria2' ? lyriaNegativePrompt : undefined,
                // Resemble AI TTS settings
                resembleTtsVoice: selectedModel === 'resemble-ai/chatterboxhd/text-to-speech' ? resembleTtsVoice : undefined,
                resembleTtsAudioUrl: selectedModel === 'resemble-ai/chatterboxhd/text-to-speech' ? resembleTtsAudioUrl : undefined,
                resembleTtsExaggeration: selectedModel === 'resemble-ai/chatterboxhd/text-to-speech' ? resembleTtsExaggeration : undefined,
                resembleTtsTemperature: selectedModel === 'resemble-ai/chatterboxhd/text-to-speech' ? resembleTtsTemperature : undefined,
                resembleTtsCfg: selectedModel === 'resemble-ai/chatterboxhd/text-to-speech' ? resembleTtsCfg : undefined,
                resembleTtsHighQuality: selectedModel === 'resemble-ai/chatterboxhd/text-to-speech' ? resembleTtsHighQuality : undefined,
              }
          };
          setHistory(prev => [newHistoryItem, ...prev]);

          const modelDetails = getSelectedModelDetails();
          const modelName = modelDetails?.name || 'Audio Model';
          notifications.success(`Audio generated successfully with ${modelName}!`);
        } else {
          throw new Error(response.error || 'Failed to generate audio');
        }
      } else {
        // Fallback to mock generation for unsupported models
        await new Promise(resolve => setTimeout(resolve, 3000));

        const mockAudioUrl = "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3"; 
        const mockDuration = duration;
        
        const result: AudioPreview = {
          url: mockAudioUrl,
          type: 'mp3',
          duration: mockDuration,
          waveform: generateMockWaveform(mockDuration * 10)
        };

        setGeneratedAudio(result);

        // Add to history
        const newHistoryItem: AudioHistoryItem = {
          id: Date.now().toString(),
          audio: result,
          prompt: prompt,
          timestamp: new Date(),
          metadata: {
            model: selectedModel,
            duration: duration,
            quality: quality,
            seed: seed >= 0 ? seed : 'random',
          }
        };
        setHistory(prev => [newHistoryItem, ...prev]);

        const modelDetails = getSelectedModelDetails();
        const modelName = modelDetails?.name || 'Audio Model';
        notifications.success(`Audio generated successfully with ${modelName}! (Mock)`);
      }

    } catch (error) {
      console.error('Error generating audio:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      notifications.error(`Error: ${errorMessage}`);
      setGeneratedAudio(null);
    } finally {
      setIsGenerating(false);
      setIsLoading(false);
    }
  };

  return (
  <div className="flex flex-col h-full w-full min-w-0 min-h-0">
      {!apiTokenAvailable && (
        <ApiTokenNotice 
          serviceKey="fal"
          onTokenSaved={handleTokenSaved}
        />
      )}
      
      <div className="flex flex-col lg:flex-row h-full relative">
        {/* Left side - Controls */}
        <div className="lg:w-[30%] lg:max-w-[350px] pr-1 pl-0">
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 space-y-2 h-full flex flex-col">
            <h2 className="text-base font-semibold text-white flex items-center"></h2> 

            <ModelSelector 
              selectedModel={selectedModel} 
              onChange={setSelectedModel}
              disabled={isGenerating}
            />
            
            {/* Spacer like in 3D interface */}
            <div className="mt-2 flex-shrink-0"></div>

            {/* Scrollable content area - This will take available space and scroll if needed */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent space-y-3 pr-1">
              {/* Prompt input - Hide for speech-to-speech model */}
              {selectedModel !== 'resemble-ai/chatterboxhd/speech-to-speech' && (
              <div className="space-y-2">
                <div className="relative">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe the audio you want to create..."
                    className="w-full h-24 bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                    disabled={isGenerating}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) handleGenerate(); }}
                  />
                </div>
              </div>
              )}
              
              {/* Enhanced Credit usage info matching VideoGenerationInterface pattern */}
              <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg px-1.5 py-2.5 min-h-[40px] flex items-center">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center text-white/70">
                    <Info size={10} className="mr-1" />
                    <span className="text-xs">Credit usage</span>
                  </div>
                  <div className="text-xs">
                    {(() => {
                      const modelDetails = getSelectedModelDetails();
                      const baseCost = modelDetails?.creditCost || 80;
                      const durationMultiplier = Math.max(1, Math.ceil(duration / 30));
                      const totalCost = baseCost * durationMultiplier;
                      
                      return (
                        <>
                          <span className="text-white/90 font-medium">~{totalCost} credits</span>
                          <span className="text-white/50 ml-1">per generation</span>
                          {modelDetails && (
                            <div className={`text-xs mt-0.5 ${
                              modelDetails.type === 'music' ? 'text-pink-400' :
                              modelDetails.type === 'sfx' ? 'text-teal-400' :
                              modelDetails.type === 'speech' ? 'text-orange-400' :
                              'text-purple-400'
                            }`}>
                              {modelDetails.type === 'music' ? 'Music generation' :
                               modelDetails.type === 'sfx' ? 'Sound effects' :
                               modelDetails.type === 'speech' ? 'Voice synthesis' :
                               'Multi-purpose audio'}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
              
                             {/* Audio generation settings - Hide duration and quality for speech-to-speech */}
               <div className="space-y-3">
                 {selectedModel !== 'resemble-ai/chatterboxhd/speech-to-speech' && (
                   <>
                 <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-white/70 text-xs">Duration</span>
                  <span className="text-white/70 text-xs">{formatDuration(duration)}</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="300"
                  step="5"
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value))}
                  className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-purple-500"
                  disabled={isGenerating}
                />
                <div className="flex justify-between mt-1">
                  {durationPresets.map((preset) => (
                    <button
                      key={preset.value}
                      onClick={() => setDuration(preset.value)}
                      className={`px-2 py-1 rounded-md text-xs transition-colors ${
                        duration === preset.value
                          ? 'bg-white/20 text-white'
                          : 'bg-black/30 text-white/70 hover:bg-black/40'
                      }`}
                      disabled={isGenerating}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="mb-2 bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-white/70 text-xs">Quality</span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {qualityOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setQuality(option.value)}
                      className={`px-2 py-1.5 rounded-md text-xs ${
                        quality === option.value
                          ? 'bg-white/20 text-white'
                          : 'bg-black/30 text-white/70 hover:bg-black/40'
                      }`}
                      disabled={isGenerating}
                      title={option.description}
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              </div>
                  </>
                 )}
              
              <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-white/70 text-xs">Seed</span>
                  <button 
                    onClick={handleRandomSeed}
                    className="text-xs text-purple-400 hover:text-purple-300"
                    disabled={isGenerating}
                    title="Use random seed"
                  >
                    Random
                  </button>
                </div>
                <input
                  type="number"
                  value={seed >= 0 ? seed : ''}
                  onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : -1)}
                  placeholder="Random (-1)"
                  min="-1"
                  className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                  disabled={isGenerating}
                />
              </div>
              
              {/* Minimax Speech Controls */}
              {selectedModel === 'fal-ai/minimax/speech-02-hd' && (
                <>
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-white/70 text-xs">Voice</span>
                    </div>
                    <select
                      value={voiceId}
                      onChange={(e) => setVoiceId(e.target.value)}
                      className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                      disabled={isGenerating}
                    >
                      {MINIMAX_VOICES.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-white/70 text-xs">Emotion</span>
                    </div>
                    <select
                      value={emotion}
                      onChange={(e) => setEmotion(e.target.value)}
                      className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                      disabled={isGenerating}
                    >
                      {MINIMAX_EMOTIONS.map((emotion) => (
                        <option key={emotion.id} value={emotion.id}>
                          {emotion.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-white/70 text-xs">Speed</span>
                      <span className="text-white/70 text-xs">{speed.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.1"
                      value={speed}
                      onChange={(e) => setSpeed(parseFloat(e.target.value))}
                      className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-purple-500"
                      disabled={isGenerating}
                    />
                    <div className="flex justify-between mt-1 text-xs text-white/50">
                      <span>0.5x</span>
                      <span>2x</span>
                    </div>
                  </div>
                  
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-white/70 text-xs">Pitch</span>
                      <span className="text-white/70 text-xs">{pitch > 0 ? '+' : ''}{pitch}</span>
                    </div>
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={pitch}
                      onChange={(e) => setPitch(parseInt(e.target.value))}
                      className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-purple-500"
                      disabled={isGenerating}
                    />
                    <div className="flex justify-between mt-1 text-xs text-white/50">
                      <span>-12</span>
                      <span>+12</span>
                    </div>
                  </div>
                  
                  <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-white/70 text-xs">Language</span>
                    </div>
                    <select
                      value={languageBoost}
                      onChange={(e) => setLanguageBoost(e.target.value)}
                      className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                      disabled={isGenerating}
                    >
                      <option value="auto">Auto Detect</option>
                      <option value="English">English</option>
                      <option value="Chinese">Chinese</option>
                      <option value="Chinese,Yue">Chinese (Cantonese)</option>
                      <option value="Spanish">Spanish</option>
                      <option value="French">French</option>
                      <option value="German">German</option>
                      <option value="Japanese">Japanese</option>
                      <option value="Korean">Korean</option>
                      <option value="Russian">Russian</option>
                      <option value="Arabic">Arabic</option>
                    </select>
                                     </div>
                 </>
               )}
               
               {/* Orpheus TTS Controls */}
               {selectedModel === 'fal-ai/orpheus-tts' && (
                 <>
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Voice</span>
                     </div>
                     <select
                       value={orpheusVoice}
                       onChange={(e) => setOrpheusVoice(e.target.value)}
                       className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isGenerating}
                     >
                       {ORPHEUS_VOICES.map((voice) => (
                         <option key={voice.id} value={voice.id}>
                           {voice.name}
                         </option>
                       ))}
                     </select>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Temperature</span>
                       <span className="text-white/70 text-xs">{temperature.toFixed(1)}</span>
                     </div>
                     <input
                       type="range"
                       min="0"
                       max="2"
                       step="0.1"
                       value={temperature}
                       onChange={(e) => setTemperature(parseFloat(e.target.value))}
                       className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-orange-500"
                       disabled={isGenerating}
                     />
                     <div className="flex justify-between mt-1 text-xs text-white/50">
                       <span>0.0</span>
                       <span>Creative</span>
                       <span>2.0</span>
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Repetition Penalty</span>
                       <span className="text-white/70 text-xs">{repetitionPenalty.toFixed(1)}</span>
                     </div>
                     <input
                       type="range"
                       min="1.1"
                       max="2"
                       step="0.1"
                       value={repetitionPenalty}
                       onChange={(e) => setRepetitionPenalty(parseFloat(e.target.value))}
                       className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-orange-500"
                       disabled={isGenerating}
                     />
                     <div className="flex justify-between mt-1 text-xs text-white/50">
                       <span>1.1</span>
                       <span>Stable</span>
                       <span>2.0</span>
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Emotive Tags</span>
                     </div>
                     <div className="grid grid-cols-2 gap-1 text-xs">
                       {ORPHEUS_EMOTIVE_TAGS.map((tag) => (
                         <button
                           key={tag.tag}
                           onClick={() => setPrompt(prev => prev + ' ' + tag.tag)}
                           className="px-2 py-1 bg-black/30 hover:bg-black/50 border border-white/10 rounded text-white/70 hover:text-white transition-colors"
                           disabled={isGenerating}
                           title={tag.description}
                         >
                           {tag.tag}
                         </button>
                       ))}
                     </div>
                   </div>
                 </>
               )}
               
               {/* ElevenLabs TTS Controls */}
               {(selectedModel === 'fal-ai/elevenlabs/tts/multilingual-v2' || selectedModel === 'fal-ai/elevenlabs/tts/turbo-v2.5') && (
                 <>
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Voice</span>
                     </div>
                     <select
                       value={elevenlabsVoice}
                       onChange={(e) => setElevenlabsVoice(e.target.value)}
                       className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isGenerating}
                     >
                       {ELEVENLABS_VOICES.map((voice) => (
                         <option key={voice.id} value={voice.id}>
                           {voice.name} ({voice.gender})
                         </option>
                       ))}
                     </select>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Stability</span>
                       <span className="text-white/70 text-xs">{stability.toFixed(2)}</span>
                     </div>
                     <input
                       type="range"
                       min="0"
                       max="1"
                       step="0.01"
                       value={stability}
                       onChange={(e) => setStability(parseFloat(e.target.value))}
                       className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-emerald-500"
                       disabled={isGenerating}
                     />
                     <div className="flex justify-between mt-1 text-xs text-white/50">
                       <span>Variable</span>
                       <span>Stable</span>
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Similarity Boost</span>
                       <span className="text-white/70 text-xs">{similarityBoost.toFixed(2)}</span>
                     </div>
                     <input
                       type="range"
                       min="0"
                       max="1"
                       step="0.01"
                       value={similarityBoost}
                       onChange={(e) => setSimilarityBoost(parseFloat(e.target.value))}
                       className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-emerald-500"
                       disabled={isGenerating}
                     />
                     <div className="flex justify-between mt-1 text-xs text-white/50">
                       <span>Low</span>
                       <span>High</span>
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Style</span>
                       <span className="text-white/70 text-xs">{style.toFixed(2)}</span>
                     </div>
                     <input
                       type="range"
                       min="0"
                       max="1"
                       step="0.01"
                       value={style}
                       onChange={(e) => setStyle(parseFloat(e.target.value))}
                       className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-emerald-500"
                       disabled={isGenerating}
                     />
                     <div className="flex justify-between mt-1 text-xs text-white/50">
                       <span>Natural</span>
                       <span>Exaggerated</span>
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Speed</span>
                       <span className="text-white/70 text-xs">{elevenlabsSpeed.toFixed(1)}x</span>
                     </div>
                     <input
                       type="range"
                       min="0.7"
                       max="1.2"
                       step="0.1"
                       value={elevenlabsSpeed}
                       onChange={(e) => setElevenlabsSpeed(parseFloat(e.target.value))}
                       className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-emerald-500"
                       disabled={isGenerating}
                     />
                     <div className="flex justify-between mt-1 text-xs text-white/50">
                       <span>0.7x</span>
                       <span>1.2x</span>
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Word Timestamps</span>
                       <button
                         onClick={() => setTimestamps(!timestamps)}
                         className={`px-2 py-1 rounded text-xs transition-colors ${
                           timestamps 
                             ? 'bg-emerald-600 text-white' 
                             : 'bg-black/30 text-white/70 hover:bg-black/50'
                         }`}
                         disabled={isGenerating}
                       >
                         {timestamps ? 'ON' : 'OFF'}
                       </button>
                     </div>
                     <p className="text-xs text-white/50">
                       Generate timing data for each word in the speech
                     </p>
                   </div>
                 </>
               )}
               
               {/* MMAudio V2 Controls */}
               {selectedModel === 'fal-ai/mmaudio-v2/text-to-audio' && (
                 <>
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Negative Prompt</span>
                     </div>
                     <textarea
                       value={negativePrompt}
                       onChange={(e) => setNegativePrompt(e.target.value)}
                       placeholder="What you don't want in the audio..."
                       className="w-full h-16 bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                       disabled={isGenerating}
                     />
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Generation Steps</span>
                       <span className="text-white/70 text-xs">{numSteps}</span>
                     </div>
                     <input
                       type="range"
                       min="4"
                       max="50"
                       step="1"
                       value={numSteps}
                       onChange={(e) => setNumSteps(parseInt(e.target.value))}
                       className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-cyan-500"
                       disabled={isGenerating}
                     />
                     <div className="flex justify-between mt-1 text-xs text-white/50">
                       <span>Fast (4)</span>
                       <span>Quality (50)</span>
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">CFG Strength</span>
                       <span className="text-white/70 text-xs">{cfgStrength.toFixed(1)}</span>
                     </div>
                     <input
                       type="range"
                       min="0"
                       max="20"
                       step="0.5"
                       value={cfgStrength}
                       onChange={(e) => setCfgStrength(parseFloat(e.target.value))}
                       className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-cyan-500"
                       disabled={isGenerating}
                     />
                     <div className="flex justify-between mt-1 text-xs text-white/50">
                       <span>Free (0)</span>
                       <span>Guided (20)</span>
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Mask Away Clip</span>
                       <button
                         onClick={() => setMaskAwayClip(!maskAwayClip)}
                         className={`px-2 py-1 rounded text-xs transition-colors ${
                           maskAwayClip 
                             ? 'bg-cyan-600 text-white' 
                             : 'bg-black/30 text-white/70 hover:bg-black/50'
                         }`}
                         disabled={isGenerating}
                       >
                         {maskAwayClip ? 'ON' : 'OFF'}
                       </button>
                     </div>
                     <p className="text-xs text-white/50">
                       Advanced audio processing option for enhanced quality
                     </p>
                   </div>
                 </>
               )}
               
               {/* Lyria2 Controls */}
               {selectedModel === 'fal-ai/lyria2' && (
                 <>
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Negative Prompt</span>
                     </div>
                     <textarea
                       value={lyriaNegativePrompt}
                       onChange={(e) => setLyriaNegativePrompt(e.target.value)}
                       placeholder="What to exclude from the music (e.g., vocals, slow tempo)..."
                       className="w-full h-16 bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                       disabled={isGenerating}
                     />
                     <div className="mt-1 text-xs text-white/50">
                       Specify elements to avoid in the generated music
                     </div>
                   </div>
                 </>
               )}
               
               {/* Resemble AI ChatterboxHD Speech-to-Speech Controls */}
               {selectedModel === 'resemble-ai/chatterboxhd/speech-to-speech' && (
                 <>
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Source Audio</span>
                       <span className="text-red-400 text-xs">*Required</span>
                     </div>
                     
                     {!sourceAudioFile && !recordedAudioBlob ? (
                       <div className="space-y-2">
                         {/* Upload Button */}
                         <button
                           onClick={handleUploadClick}
                           disabled={isGenerating || isRecording}
                           className="w-full h-32 border-2 border-dashed border-white/20 rounded-lg flex flex-col items-center justify-center text-white/60 hover:bg-white/5 hover:border-white/30 transition-colors disabled:opacity-50"
                         >
                           <Upload size={24} className="mb-2" />
                           <span className="text-xs">Upload Audio File</span>
                           <span className="text-xs mt-1 text-white/40">(MP3, WAV, M4A, etc.)</span>
                         </button>
                         
                         {/* Or Divider */}
                         <div className="flex items-center">
                           <div className="flex-1 h-px bg-white/10"></div>
                           <span className="px-2 text-xs text-white/40">or</span>
                           <div className="flex-1 h-px bg-white/10"></div>
                         </div>
                         
                         {/* Record Button */}
                         <button
                           onClick={isRecording ? stopRecording : startRecording}
                           disabled={isGenerating}
                           className={`w-full h-12 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
                             isRecording 
                               ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse' 
                               : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                           } disabled:opacity-50`}
                         >
                           {isRecording ? (
                             <>
                               <StopCircle size={16} className="mr-2" />
                               Stop Recording ({formatRecordingDuration(recordingDuration)})
                             </>
                           ) : (
                             <>
                               <Mic size={16} className="mr-2" />
                               Record Audio
                             </>
                           )}
                         </button>
                         
                         {/* Recording Error Display */}
                         {recordingError && (
                           <div className="mt-2 p-2 bg-red-900/20 border border-red-500/30 rounded-lg">
                             <div className="flex items-center text-red-400">
                               <X size={12} className="mr-1 flex-shrink-0" />
                               <span className="text-xs">{recordingError}</span>
                             </div>
                           </div>
                         )}
                       </div>
                     ) : (
                       <div className="relative bg-black/30 rounded-lg p-3 border border-white/10">
                         <div className="flex items-center justify-between">
                           <div className="flex items-center text-white/80">
                             <Volume2 size={16} className="mr-2 text-indigo-400" />
                             <span className="text-xs truncate max-w-[180px]">
                               {sourceAudioFile?.name || (recordedAudioBlob ? 'Recorded Audio' : 'Audio File')}
                             </span>
                           </div>
                           <button
                             onClick={removeSourceAudio}
                             disabled={isGenerating}
                             className="p-1 text-red-500 hover:text-red-400 disabled:opacity-50"
                             title="Remove Audio"
                           >
                             <X size={14} />
                           </button>
                         </div>
                         
                         {/* Audio Preview */}
                         {sourceAudioUrl && (
                           <audio 
                             controls 
                             className="w-full mt-2 h-8" 
                             style={{ height: '32px' }}
                           >
                             <source src={sourceAudioUrl} />
                             Your browser does not support audio playback.
                           </audio>
                         )}
                       </div>
                     )}
                     
                     <input
                       type="file"
                       ref={fileInputRef}
                       onChange={handleAudioUpload}
                       accept="audio/*"
                       className="hidden"
                     />
                     
                     <div className="mt-1 text-xs text-white/50">
                       Upload or record the audio you want to voice-convert
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Target Voice</span>
                     </div>
                     <select
                       value={resembleAiVoice}
                       onChange={(e) => setResembleAiVoice(e.target.value)}
                       className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isGenerating}
                     >
                       {RESEMBLE_AI_VOICES.map((voice) => (
                         <option key={voice.id} value={voice.id}>
                           {voice.name} - {voice.description}
                         </option>
                       ))}
                     </select>
                     <div className="mt-1 text-xs text-white/50">
                       Voice to convert the source audio to
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Custom Target Voice URL</span>
                       <span className="text-white/50 text-xs">Optional</span>
                     </div>
                     <input
                       type="url"
                       value={targetVoiceAudioUrl}
                       onChange={(e) => setTargetVoiceAudioUrl(e.target.value)}
                       placeholder="https://example.com/target-voice.wav"
                       className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isGenerating}
                     />
                     <div className="mt-1 text-xs text-white/50">
                       Custom voice audio URL (overrides selected voice)
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">High Quality Audio</span>
                       <button
                         onClick={() => setHighQualityAudio(!highQualityAudio)}
                         className={`px-2 py-1 rounded text-xs transition-colors ${
                           highQualityAudio 
                             ? 'bg-indigo-600 text-white' 
                             : 'bg-black/30 text-white/70 hover:bg-black/50'
                         }`}
                         disabled={isGenerating}
                       >
                         {highQualityAudio ? '48kHz' : '24kHz'}
                       </button>
                     </div>
                     <p className="text-xs text-white/50">
                       {highQualityAudio ? 'Higher quality but slower generation (48kHz)' : 'Standard quality with faster generation (24kHz)'}
                     </p>
                   </div>
                 </>
               )}
               
               {/* Resemble AI ChatterboxHD Text-to-Speech Controls */}
               {selectedModel === 'resemble-ai/chatterboxhd/text-to-speech' && (
                 <>
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Voice</span>
                     </div>
                     <select
                       value={resembleTtsVoice}
                       onChange={(e) => setResembleTtsVoice(e.target.value)}
                       className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isGenerating}
                     >
                       {RESEMBLE_AI_VOICES.map((voice) => (
                         <option key={voice.id} value={voice.id}>
                           {voice.name} - {voice.description}
                         </option>
                       ))}
                     </select>
                     <div className="mt-1 text-xs text-white/50">
                       Select a predefined voice for text-to-speech
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Custom Voice URL</span>
                       <span className="text-white/50 text-xs">Optional</span>
                     </div>
                     <input
                       type="url"
                       value={resembleTtsAudioUrl}
                       onChange={(e) => setResembleTtsAudioUrl(e.target.value)}
                       placeholder="https://example.com/voice-sample.wav"
                       className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                       disabled={isGenerating}
                     />
                     <div className="mt-1 text-xs text-white/50">
                       Voice cloning: URL to audio sample (overrides voice selection)
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Emotion Exaggeration</span>
                       <span className="text-white/70 text-xs">{resembleTtsExaggeration.toFixed(2)}</span>
                     </div>
                     <input
                       type="range"
                       min="0.25"
                       max="2"
                       step="0.05"
                       value={resembleTtsExaggeration}
                       onChange={(e) => setResembleTtsExaggeration(parseFloat(e.target.value))}
                       className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-indigo-500"
                       disabled={isGenerating}
                     />
                     <div className="flex justify-between mt-1 text-xs text-white/50">
                       <span>Subtle (0.25)</span>
                       <span>Dramatic (2.0)</span>
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">Temperature</span>
                       <span className="text-white/70 text-xs">{resembleTtsTemperature.toFixed(2)}</span>
                     </div>
                     <input
                       type="range"
                       min="0.05"
                       max="5"
                       step="0.05"
                       value={resembleTtsTemperature}
                       onChange={(e) => setResembleTtsTemperature(parseFloat(e.target.value))}
                       className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-indigo-500"
                       disabled={isGenerating}
                     />
                     <div className="flex justify-between mt-1 text-xs text-white/50">
                       <span>Deterministic (0.05)</span>
                       <span>Creative (5.0)</span>
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">CFG Scale</span>
                       <span className="text-white/70 text-xs">{resembleTtsCfg.toFixed(2)}</span>
                     </div>
                     <input
                       type="range"
                       min="0"
                       max="1"
                       step="0.05"
                       value={resembleTtsCfg}
                       onChange={(e) => setResembleTtsCfg(parseFloat(e.target.value))}
                       className="w-full h-1 bg-black/30 rounded-lg appearance-none cursor-pointer range-sm accent-indigo-500"
                       disabled={isGenerating}
                     />
                     <div className="flex justify-between mt-1 text-xs text-white/50">
                       <span>Expressive (0.0)</span>
                       <span>Guided (1.0)</span>
                     </div>
                     <div className="mt-1 text-xs text-white/40">
                       Lower values for expressive/dramatic speech
                     </div>
                   </div>
                   
                   <div className="bg-[rgba(20,20,20,0.5)] border border-white/10 rounded-lg p-2">
                     <div className="flex items-center justify-between mb-1.5">
                       <span className="text-white/70 text-xs">High Quality Audio</span>
                       <button
                         onClick={() => setResembleTtsHighQuality(!resembleTtsHighQuality)}
                         className={`px-2 py-1 rounded text-xs transition-colors ${
                           resembleTtsHighQuality 
                             ? 'bg-indigo-600 text-white' 
                             : 'bg-black/30 text-white/70 hover:bg-black/50'
                         }`}
                         disabled={isGenerating}
                       >
                         {resembleTtsHighQuality ? '48kHz' : '24kHz'}
                       </button>
                     </div>
                     <p className="text-xs text-white/50">
                       {resembleTtsHighQuality ? 'Higher quality but slower generation (48kHz)' : 'Standard quality with faster generation (24kHz)'}
                     </p>
                   </div>
                 </>
               )}
              </div>
            </div>

            {/* Generate Button - Always inside settings container */}
            <div className="mt-auto pt-2">
              <button
                onClick={handleGenerate}
                disabled={isGenerating || (selectedModel === 'resemble-ai/chatterboxhd/speech-to-speech' ? (!sourceAudioUrl.trim() && !sourceAudioFile && !recordedAudioBlob) : !prompt.trim())}
                className={`w-full p-3 rounded-lg text-white flex items-center justify-center text-xs font-semibold
                  ${
                    isGenerating
                      ? 'bg-black/50 cursor-not-allowed'
                      : (selectedModel === 'resemble-ai/chatterboxhd/speech-to-speech' ? (sourceAudioUrl.trim() || sourceAudioFile || recordedAudioBlob) : prompt.trim())
                        ? 'bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600'
                        : 'bg-zinc-800/40 hover:bg-zinc-800/60 border border-zinc-700/40 opacity-60'
                  }
                `}
              >
                {isGenerating ? (
                  <>
                    <RotateCw size={14} className="mr-1.5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Send size={14} className="mr-1.5" />
                    {selectedModel === 'resemble-ai/chatterboxhd/speech-to-speech' ? 'Convert Voice' : 'Generate Audio'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
        
        {/* Right side - Preview & History */}
        <div className="flex-1 lg:pl-2 lg:pr-0 pt-0 flex flex-col">
          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-4 flex flex-col" 
               style={{ height: 'calc(100% - 120px - 8px)', minHeight: '300px' }}>
            
            <div className="flex-1 relative rounded-lg overflow-hidden bg-black/20 flex items-center justify-center">
              {isLoading ? (
                <div className="flex flex-col items-center z-10 text-center">
                  <RotateCw size={24} className="animate-spin mb-2 text-white/80" />
                  <div className="text-sm text-white/80">Generating audio...</div>
                </div>
              ) : generatedAudio ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-4 text-white/80">
                   <audio ref={audioRef} src={generatedAudio.url} preload="auto" className="hidden"></audio>
                   
                   <button 
                    onClick={handlePlayPause} 
                    className="mb-4 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                    title={isPlaying ? "Pause" : "Play"}
                   >
                     {isPlaying ? <PauseCircle size={32} /> : <PlayCircle size={32} />}
                   </button>

                   <div className="w-full max-w-md h-[60px] mb-2">
                     {renderWaveform(generatedAudio.waveform)}
                   </div>

                   <p className="text-xs text-white/60 mb-4">
                     {formatDuration(generatedAudio.duration)} - {generatedAudio.type.toUpperCase()}
                   </p>

                   <a 
                     href={generatedAudio.url} 
                     download={`generated_audio_${Date.now()}.${generatedAudio.type}`}
                     className="inline-flex items-center px-3 py-1.5 bg-black/30 hover:bg-black/50 border border-white/10 rounded-md text-xs text-white/80 transition-colors"
                     title="Download Audio"
                   >
                     <Download size={14} className="mr-1" /> Download
                   </a>
                </div>
              ) : (
                 <div className="flex flex-col items-center text-center p-4">
                  <Music size={48} className="mx-auto mb-4 text-white/20" />
                  <p className="text-white/60">Generated audio preview appears here</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-2 mt-2 overflow-hidden flex flex-col"
               style={{ height: '120px', minHeight: '120px' }}>
            <div className="flex justify-between items-center mb-1 px-1">
                <div className="text-xs text-white/60">Recent Generations</div>
                {history.length > 0 && (
                    <button
                      onClick={handleClearHistory}
                      className="text-xs text-red-500/70 hover:text-red-500 transition-colors"
                      title="Clear History"
                    >
                      <Trash2 size={12} /> Clear
                    </button>
                )}
            </div>
            <div className="flex-1 overflow-x-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
              <div className="flex space-x-2 h-full pb-1">
                {history.length > 0 ? (
                  history.map((item) => (
                    <div 
                      key={item.id}
                      className={`relative flex-shrink-0 h-full w-32 border rounded-lg overflow-hidden cursor-pointer group p-2 flex flex-col justify-between
                        ${generatedAudio?.url === item.audio.url ? 'border-purple-500 border-2 bg-purple-900/10' : 'border-white/10 hover:border-white/30 bg-black/20 hover:bg-black/30'}`
                      }
                      onClick={() => handleSelectFromHistory(item)}
                      title={`Preview: ${item.prompt}`}
                    >
                      <div className="h-8 w-full text-purple-400/50 overflow-hidden">
                          {renderWaveform(item.audio.waveform, 32)}
                      </div>
                      <p className="text-[10px] text-white/70 leading-tight line-clamp-2 mt-1">
                        {item.prompt}
                      </p>
                      <div className="flex justify-between items-center mt-auto pt-1">
                        <span className="text-[9px] text-white/50">
                            {formatDuration(item.audio.duration)}
                        </span>
                         <span className="text-[9px] text-white/50">
                            {item.metadata?.model?.split('-').pop() || 'Audio'}
                         </span>
                      </div>
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
    </div>
  );
};

export default AudioGenerationInterface; 
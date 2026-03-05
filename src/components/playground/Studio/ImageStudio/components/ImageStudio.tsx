import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { 
  Send, Paperclip, Settings, Palette, History, 
  Plus, X, Trash2, Edit3, Copy, ThumbsUp, ThumbsDown,
  Download, Upload, FolderOpen, Cloud, HardDrive,
  Shuffle, Sliders, Image as ImageIcon, Type,
  Play, Scissors, Paintbrush, RotateCw, Maximize2, TrendingUp,
  ChevronDown, StopCircle, FolderUp, Link, FileClock, Clock,
  FileText, Mic, Video, Users, Calendar, Grid, List, Save,
  RefreshCw, ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
  ZoomIn, ZoomOut, RotateCcw, FlipHorizontal, FlipVertical,
  Eye, EyeOff, Layers, Square, Circle, Triangle, Star,
  Brush, Eraser, Lasso, Wand, Pipette, Ruler,
  Crop, Move, Hand, Crosshair, Filter, Contrast, Search,
  PaintBucket
} from 'lucide-react';

// Import types and utilities from our modular structure
import { 
  AttachedFile, 
  RecentFile, 
  ImageGenerationSession, 
  ChatMessage,
  ConversationImageState,
  ImageContext
} from '../core/types';
import { cleanText, parseResponse, useImagePreloader, URLObjectCache } from '../core/utils';
import { SAM2SegmentationEngine, SegmentationPoint, SegmentationMask } from '../core/segmentation.engine';
import { FullScreenImageViewer } from './FullScreenImageViewer';
import { ImagePlaceholder, OptimizedImage } from './OptimizedImage';
import { HistoryPanel, DeleteConfirmationModal } from './HistoryModal';
import { ChatMessages } from './ChatMessages';
import { useConversationHistory } from '../hooks/useConversationHistory';
import { useImageStudioDatabase } from '../hooks/useImageStudioDatabase';
import { CanvasViewer } from '../Canvas';
import ProjectManager from './ProjectManager';
import { imageStudioService } from '../../../../../services/imageStudioService';

// Preset Representation Helper - Descriptive SVG based thumbnails
const PresetThumbnail = ({ category, width, height }: { category: string, width: number, height: number }) => {
  // Normalize aspect ratio for visual representation
  const rawAspectRatio = width / height;
  // Constraint aspect ratio to reasonable bounds for display (min 0.4, max 2.5)
  const displayAspectRatio = Math.max(0.4, Math.min(2.5, rawAspectRatio));
  
  // Base dimensions for the thumbnail container
  const baseSize = 90;
  let drawWidth = baseSize;
  let drawHeight = baseSize;
  
  if (displayAspectRatio > 1) {
    drawHeight = baseSize / displayAspectRatio;
  } else {
    drawWidth = baseSize * displayAspectRatio;
  }
  
  // Center coordinates
  const offsetX = (100 - drawWidth) / 2;
  const offsetY = (100 - drawHeight) / 2;

  switch (category) {
    case 'Photo':
      return (
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-2xl">
          <rect x={offsetX} y={offsetY} width={drawWidth} height={drawHeight} rx="1" fill="#1e1e20" stroke="white" strokeOpacity="0.1" strokeWidth="1.5" />
          <path 
            d={`M${offsetX} ${offsetY + drawHeight * 0.7} L${offsetX + drawWidth * 0.3} ${offsetY + drawHeight * 0.4} L${offsetX + drawWidth * 0.6} ${offsetY + drawHeight * 0.6} L${offsetX + drawWidth * 0.8} ${offsetY + drawHeight * 0.45} L${offsetX + drawWidth} ${offsetY + drawHeight * 0.75} L${offsetX + drawWidth} ${offsetY + drawHeight} L${offsetX} ${offsetY + drawHeight} Z`} 
            fill="white"
            fillOpacity="0.05"
          />
          <circle cx={offsetX + drawWidth * 0.2} cy={offsetY + drawHeight * 0.25} r={drawWidth * 0.06} fill="white" fillOpacity="0.05" />
        </svg>
      );
    case 'Print':
      return (
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-2xl">
          <rect x={offsetX} y={offsetY} width={drawWidth} height={drawHeight} rx="0.5" fill="#1e1e20" stroke="white" strokeOpacity="0.1" strokeWidth="1.5" />
          <line x1={offsetX + drawWidth * 0.15} y1={offsetY + drawHeight * 0.2} x2={offsetX + drawWidth * 0.85} y2={offsetY + drawHeight * 0.2} stroke="white" strokeOpacity="0.05" strokeWidth="1.5" strokeDasharray="3 2" />
          <line x1={offsetX + drawWidth * 0.15} y1={offsetY + drawHeight * 0.4} x2={offsetX + drawWidth * 0.85} y2={offsetY + drawHeight * 0.4} stroke="white" strokeOpacity="0.05" strokeWidth="1.5" />
          <line x1={offsetX + drawWidth * 0.15} y1={offsetY + drawHeight * 0.6} x2={offsetX + drawWidth * 0.85} y2={offsetY + drawHeight * 0.6} stroke="white" strokeOpacity="0.05" strokeWidth="1.5" />
          <line x1={offsetX + drawWidth * 0.15} y1={offsetY + drawHeight * 0.8} x2={offsetX + drawWidth * 0.55} y2={offsetY + drawHeight * 0.8} stroke="white" strokeOpacity="0.05" strokeWidth="1.5" />
        </svg>
      );
    case 'Illustration':
      return (
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-2xl">
          <rect x={offsetX} y={offsetY} width={drawWidth} height={drawHeight} rx="2" fill="#1e1e20" stroke="white" strokeOpacity="0.1" strokeWidth="1.5" />
          <path 
            d={`M${offsetX + drawWidth * 0.3} ${offsetY + drawHeight * 0.7} L${offsetX + drawWidth * 0.7} ${offsetY + drawHeight * 0.3}`} 
            stroke="white" 
            strokeOpacity="0.1"
            strokeWidth="2.5" 
            strokeLinecap="round" 
          />
          <circle cx="50" cy="50" r={Math.min(drawWidth, drawHeight) * 0.25} fill="none" stroke="white" strokeOpacity="0.05" strokeWidth="1.5" strokeDasharray="5 4" />
        </svg>
      );
    case 'Web':
      return (
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-2xl">
          <rect x={offsetX} y={offsetY} width={drawWidth} height={drawHeight} rx="1.5" fill="#1e1e20" stroke="white" strokeOpacity="0.1" strokeWidth="1.5" />
          <rect x={offsetX} y={offsetY} width={drawWidth} height={drawHeight * 0.18} rx="1.5" fill="white" fillOpacity="0.05" />
          <circle cx={offsetX + drawWidth * 0.08} cy={offsetY + drawHeight * 0.09} r={drawWidth * 0.025} fill="white" fillOpacity="0.1" />
          <circle cx={offsetX + drawWidth * 0.16} cy={offsetY + drawHeight * 0.09} r={drawWidth * 0.025} fill="white" fillOpacity="0.1" />
          <circle cx={offsetX + drawWidth * 0.24} cy={offsetY + drawHeight * 0.09} r={drawWidth * 0.025} fill="white" fillOpacity="0.1" />
        </svg>
      );
    case 'Mobile':
      return (
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-2xl">
          <rect x={offsetX} y={offsetY} width={drawWidth} height={drawHeight} rx={Math.min(drawWidth, drawHeight) * 0.12} fill="#1e1e20" stroke="white" strokeOpacity="0.1" strokeWidth="1.5" />
          <rect x={offsetX + drawWidth * 0.35} y={offsetY + drawHeight * 0.06} width={drawWidth * 0.3} height={drawHeight * 0.03} rx={drawHeight * 0.015} fill="white" fillOpacity="0.05" />
          <circle cx="50" cy={offsetY + drawHeight * 0.9} r={drawHeight * 0.05} fill="none" stroke="white" strokeOpacity="0.05" strokeWidth="1.5" />
        </svg>
      );
    case 'Film':
      return (
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-2xl">
          <rect x={offsetX} y={offsetY} width={drawWidth} height={drawHeight} fill="#1e1e20" stroke="white" strokeOpacity="0.1" strokeWidth="1.5" />
          <rect x={offsetX + drawWidth * 0.08} y={offsetY + drawHeight * 0.18} width={drawWidth * 0.84} height={drawHeight * 0.64} fill="white" fillOpacity="0.03" />
          {[0.12, 0.31, 0.5, 0.69, 0.88].map((p, idx) => (
            <React.Fragment key={idx}>
              <rect x={offsetX + drawWidth * p - drawWidth * 0.03} y={offsetY + drawHeight * 0.04} width={drawWidth * 0.06} height={drawHeight * 0.09} rx="0.5" fill="white" fillOpacity="0.1" />
              <rect x={offsetX + drawWidth * p - drawWidth * 0.03} y={offsetY + drawHeight * 0.87} width={drawWidth * 0.06} height={drawHeight * 0.09} rx="0.5" fill="white" fillOpacity="0.1" />
            </React.Fragment>
          ))}
        </svg>
      );
    default:
      return <ImageIcon size={24} className="text-white/10" />;
  }
};

const ImageStudio: React.FC = () => {
  const navigate = useNavigate();
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();

  // Extract ALL state variables from the original file exactly as they are
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isRecentFilesOpen, setIsRecentFilesOpen] = useState(false);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStyleModalOpen, setIsStyleModalOpen] = useState(false);
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [styleReferenceImage, setStyleReferenceImage] = useState<File | null>(null);
  const [styleImagePreview, setStyleImagePreview] = useState<string | null>(null);
  
  // AI Segmentation state for main component
  const [isSegmentationLoading, setIsSegmentationLoading] = useState(false);

  // Performance optimization hooks
  const { preloadImages, preloadAllConversationImages } = useImagePreloader();

  // New state for advanced chat functionality
  const [showThinkingId, setShowThinkingId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [feedbackStatusMap, setFeedbackStatusMap] = useState<Record<string, 'liked' | 'disliked' | null>>({});

  // Full-screen image viewer state - Always start with new interface (canvas closed)
  const [isFullScreenImageOpen, setIsFullScreenImageOpen] = useState(false);
  const [fullScreenImageUrl, setFullScreenImageUrl] = useState<string | null>(null);
  const [viewerShowsDownloadButton, setViewerShowsDownloadButton] = useState(false);
  
  // Canvas Viewer state (new clean interface)
  const [isCanvasViewerOpen, setIsCanvasViewerOpen] = useState(false);
  const [canvasViewerImageUrl, setCanvasViewerImageUrl] = useState<string | null>(null);
  
  // Canvas state is preserved only for the current session/conversation
  const [imageEditHistory, setImageEditHistory] = useState<Array<{
    id: string;
    url: string;
    prompt: string;
    editType?: string;
    timestamp?: string;
    adjustments?: any;
    editMode?: string;
  }>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('xenostudio_canvas_edit_history');
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });

  // Image editing state in full-screen viewer
  const [imageEditText, setImageEditText] = useState('');
  const [showEditTools, setShowEditTools] = useState(false);
  const [isAnimatingTools, setIsAnimatingTools] = useState(false);
  const [isClosingTools, setIsClosingTools] = useState(false);
  const [selectedEditMode, setSelectedEditMode] = useState<'retouch' | 'resize' | 'upscale' | 'background' | 'adjust' | 'segmentation' | null>(null);

  // Tool preview state
  const [hoveredTool, setHoveredTool] = useState<string | null>(null);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [currentVideoUrl, setCurrentVideoUrl] = useState('');
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Model selection state
  const [selectedModel, setSelectedModel] = useState<'gpt-image-1' | 'flux-kontext'>('flux-kontext');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);

  // AI Image Generation Settings
  const [seed, setSeed] = useState<string>('');
  const [guidanceScale, setGuidanceScale] = useState<number>(7.5);
  const [syncMode, setSyncMode] = useState<string>('generation');
  const [numImages, setNumImages] = useState<number>(1);
  const [safetyTolerance, setSafetyTolerance] = useState<string>('2');
  const [outputFormat, setOutputFormat] = useState<string>('webp');
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');

  // Style Modal State (simplified)
  const [savedStyle, setSavedStyle] = useState<{
    type: 'image' | 'prompt' | 'preset' | null;
    content: string;
    name?: string;
  } | null>(null);
  const [activeStyleTab, setActiveStyleTab] = useState<'image' | 'prompt' | 'preset'>('image');
  const [stylePromptText, setStylePromptText] = useState('');
  const [selectedStylePreset, setSelectedStylePreset] = useState<string | null>(null);

  // Canvas Modal State (VideoStudio-compatible)
  const [isCanvasModalOpen, setIsCanvasModalOpen] = useState(false);
  const [canvasModalPosition, setCanvasModalPosition] = useState({ x: 0, y: 0 });
  
  // Canvas action menu state (matching VideoStudio)
  const [isCanvasActionMenuOpen, setIsCanvasActionMenuOpen] = useState(false);
  const [isCanvasHovered, setIsCanvasHovered] = useState(false);
  const [hasCanvasProject, setHasCanvasProject] = useState(false);
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const [isCanvasProjectSettingsOpen, setIsCanvasProjectSettingsOpen] = useState(false);
  const [canvasProjectName, setCanvasProjectName] = useState('Untitled Canvas');
  const [canvasProjectWidth, setCanvasProjectWidth] = useState(1024);
  const [canvasProjectHeight, setCanvasProjectHeight] = useState(1024);
  const [canvasProjectUnit, setCanvasProjectUnit] = useState<'pixels' | 'inches'>('pixels');
  const [canvasProjectResolution, setCanvasProjectResolution] = useState(72);
  const [canvasProjectColorMode, setCanvasProjectColorMode] = useState('RGB Color');
  const [canvasProjectColorProfile, setCanvasProjectColorProfile] = useState('sRGB IEC61966-2.1');
  const [canvasProjectPixelAspectRatio, setCanvasProjectPixelAspectRatio] = useState('Square Pixels');
  const [canvasBackgroundColor, setCanvasBackgroundColor] = useState('#ffffff');
  const [isTransparentBackground, setIsTransparentBackground] = useState(false);
  const [activePresetCategory, setActivePresetCategory] = useState('Photo');
  const [canvasProjectSettings, setCanvasProjectSettings] = useState<{
    name: string;
    width: number;
    height: number;
    unit: 'pixels' | 'inches';
    resolution: number;
    colorMode: string;
    colorProfile: string;
    pixelAspectRatio: string;
    backgroundColor: string;
  } | null>(null);

  // Canvas Style State (for full-screen image viewer)
  const [canvasSavedStyle, setCanvasSavedStyle] = useState<{
    type: 'image' | 'prompt' | 'preset' | null;
    content: string;
    name?: string;
  } | null>(null);

  // Multi-context conversational image generation state
  const [conversationImageState, setConversationImageState] = useState<ConversationImageState>({
    contexts: new Map(),
    nextContextId: 'A'
  });

  // Use the conversation history hook
  const historyHook = useConversationHistory(
    messages,
    setMessages,
    setInputValue,
    setAttachedFiles,
    setSelectedModel,
    setSeed,
    setAspectRatio,
    setNumImages
  );

  // Use the database integration hook
  const databaseHook = useImageStudioDatabase(
    messages,
    {
      model: selectedModel,
      seed: seed,
      guidanceScale: guidanceScale,
      aspectRatio: aspectRatio,
      numImages: numImages
    },
    {
      autoSaveEnabled: true,
      autoSaveInterval: 5000
    }
  );

  // Scroll management refs
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(messages.length);
  const shouldScrollToBottomRef = useRef(false);

  // All refs from the original file
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const recentFilesPanelRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const styleButtonRef = useRef<HTMLButtonElement>(null);
  const styleModalRef = useRef<HTMLDivElement>(null);
  const styleFileInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const canvasButtonRef = useRef<HTMLButtonElement>(null);
  const canvasActionMenuRef = useRef<HTMLDivElement>(null);
  const canvasModalRef = useRef<HTMLDivElement>(null);
  const canvasFileInputRef = useRef<HTMLInputElement>(null);

  // Corner radius coordination similar to Video Studio: Outer ≈ Inner + padding
  const [innerCornerRadiusPx, setInnerCornerRadiusPx] = useState<number>(12);

  useEffect(() => {
    const updateRadii = () => {
      const el = inputContainerRef.current;
      if (!el) return;
      const styles = window.getComputedStyle(el);
      const tl = parseFloat(styles.borderTopLeftRadius || '16');
      const paddingPx = 4;
      const outerPx = isNaN(tl) ? 16 : tl;
      const innerPx = Math.max(0, outerPx - paddingPx);
      setInnerCornerRadiusPx(innerPx);
    };
    updateRadii();
    window.addEventListener('resize', updateRadii);
    return () => window.removeEventListener('resize', updateRadii);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight + 5, 155)}px`;
    }
  }, [inputValue]);

  // Auto-create project for authenticated users on first message
  useEffect(() => {
    if (databaseHook.isAuthenticated && !databaseHook.currentProject && messages.length > 0) {
      const firstUserMessage = messages.find(msg => msg.sender === 'user');
      const projectTitle = firstUserMessage?.text?.slice(0, 50) || 'New Project';

      databaseHook.createProject({
        title: projectTitle,
        model: selectedModel,
        seed: seed || undefined,
        guidance_scale: guidanceScale,
        aspect_ratio: aspectRatio,
        num_images: numImages
      }).then(project => {
        if (project) {
          console.log('✅ Auto-created project:', project.id);
          navigate(`/overview/studio/image/${project.id}`, { replace: true });
        }
      }).catch(err => {
        console.error('❌ Failed to auto-create project:', err);
      });
    }
  }, [databaseHook.isAuthenticated, databaseHook.currentProject, messages.length]);

  // Load project from URL route parameter
  useEffect(() => {
    if (routeProjectId && routeProjectId !== databaseHook.currentProject?.id) {
      databaseHook.loadProject(routeProjectId).then(() => {
        databaseHook.loadSessionsFromDatabase();
      }).catch(err => {
        console.error('❌ Failed to load project from URL:', err);
        navigate('/overview/studio/image', { replace: true });
      });
    }
  }, [routeProjectId]);

  // URL cache for managing blob URLs
  const urlCache = useMemo(() => new URLObjectCache(), []);

  // Multi-context image generation helper functions
  const generateNextContextId = useCallback(() => {
    const current = conversationImageState.nextContextId;
    const nextChar = String.fromCharCode(current.charCodeAt(0) + 1);
    setConversationImageState(prev => ({
      ...prev,
      nextContextId: nextChar
    }));
    return current;
  }, [conversationImageState.nextContextId]);

  const addImageContext = useCallback((description: string, responseId: string, imageGenerationCallId: string, messageId: string) => {
    const contextId = generateNextContextId();
    const newContext: ImageContext = {
      id: contextId,
      description,
      responseId,
      imageGenerationCallId,
      createdAt: Date.now(),
      lastModified: Date.now(),
      messageId
    };

    setConversationImageState(prev => {
      const newContexts = new Map(prev.contexts);
      newContexts.set(contextId, newContext);
      return {
        ...prev,
        contexts: newContexts
      };
    });

    return contextId;
  }, [generateNextContextId]);

  const updateImageContext = useCallback((contextId: string, responseId: string, imageGenerationCallId: string) => {
    setConversationImageState(prev => {
      const newContexts = new Map(prev.contexts);
      const existingContext = newContexts.get(contextId);
      if (existingContext) {
        newContexts.set(contextId, {
          ...existingContext,
          responseId,
          imageGenerationCallId,
          lastModified: Date.now()
        });
      }
      return {
        ...prev,
        contexts: newContexts
      };
    });
  }, []);

  const findRelevantImageContext = useCallback((prompt: string): ImageContext | null => {
    const lowerPrompt = prompt.toLowerCase();
    const contexts = Array.from(conversationImageState.contexts.values());
    
    // Sort by most recently modified first
    contexts.sort((a, b) => b.lastModified - a.lastModified);
    
    console.log('🔍 Context matching for prompt:', prompt);
    console.log('🔍 Available contexts:', contexts.map(c => ({ id: c.id, description: c.description, lastModified: c.lastModified })));
    
    // Enhanced context matching logic
    for (const context of contexts) {
      const contextWords = context.description.toLowerCase().split(' ');
      
      // Check for direct subject references
      const hasDirectMatch = contextWords.some(word => 
        word.length > 3 && lowerPrompt.includes(word)
      );
      
      if (hasDirectMatch) {
        console.log(`🎯 Found direct context match: "${context.description}" for prompt: "${prompt}"`);
        return context;
      }
    }
    
    // Check for pronoun references that should match the most recent context
    const pronounReferences = ['it', 'them', 'they', 'this', 'that', 'these', 'those'];
    const hasPronounReference = pronounReferences.some(pronoun => 
      lowerPrompt.includes(pronoun)
    );
    
    if (hasPronounReference && contexts.length > 0) {
      console.log(`🔗 Found pronoun reference, using most recent context: "${contexts[0].description}"`);
      return contexts[0];
    }
    
    // Check for generic modification words that should apply to the most recent image
    const genericModifications = [
      'more realistic', 'more detailed', 'better quality', 'higher resolution',
      'brighter', 'darker', 'more colorful', 'less saturated'
    ];
    
    const hasGenericModification = genericModifications.some(mod => 
      lowerPrompt.includes(mod)
    );
    
    if (hasGenericModification && contexts.length > 0) {
      console.log(`🔧 Found generic modification, using most recent context: "${contexts[0].description}"`);
      return contexts[0];
    }
    
    // CRITICAL FIX: Check for modification verbs that indicate editing existing image
    const modificationVerbs = [
      'make', 'change', 'turn', 'paint', 'color', 'add', 'remove', 'replace',
      'modify', 'adjust', 'alter', 'transform', 'convert', 'set', 'put'
    ];
    
    const hasModificationVerb = modificationVerbs.some(verb => 
      lowerPrompt.includes(verb)
    );
    
    if (hasModificationVerb && contexts.length > 0) {
      console.log(`🔧 Found modification verb, using most recent context: "${contexts[0].description}"`);
      return contexts[0];
    }
    
    // Check for color/style changes that should apply to most recent image
    const colorStyleChanges = [
      'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'black', 'white', 'gray', 'grey',
      'bright', 'dark', 'light', 'colorful', 'vibrant', 'muted', 'pastel'
    ];
    
    const hasColorStyleChange = colorStyleChanges.some(color => 
      lowerPrompt.includes(color)
    );
    
    if (hasColorStyleChange && contexts.length > 0) {
      console.log(`🎨 Found color/style change, using most recent context: "${contexts[0].description}"`);
      return contexts[0];
    }
    
    console.log('❓ No relevant context found for prompt:', prompt);
    return null;
  }, [conversationImageState.contexts]);

  const detectMultiImageCombinationIntent = useCallback((prompt: string): boolean => {
    const lowerPrompt = prompt.toLowerCase();
    const combinationKeywords = [
      'combine', 'merge', 'blend', 'mix', 'put together', 'join',
      'all of them', 'all images', 'both images', 'all three', 'all four',
      'composite', 'collage', 'montage', 'together', 'all the images',
      'these images', 'those images', 'every image', 'each image',
      'side by side', 'overlay', 'superimpose', 'fuse', 'unite'
    ];
    
    const hasCombinationKeyword = combinationKeywords.some(keyword => lowerPrompt.includes(keyword));
    
    // Additional logic: if there are multiple contexts and the prompt mentions multiple items
    const hasMultipleContexts = conversationImageState.contexts.size > 1;
    const mentionsMultiple = /\b(both|all|these|those|two|three|four|multiple)\b/.test(lowerPrompt);
    
    // CRITICAL: Detect spatial relationship phrases that imply combining multiple objects
    // e.g., "put the dog on the couch", "place the cat next to the tree"
    const spatialRelationships = [
      'put .+ on', 'place .+ on', 'set .+ on', 'put .+ in', 'place .+ in',
      'put .+ next to', 'place .+ next to', 'put .+ beside', 'place .+ beside',
      'put .+ under', 'place .+ under', 'put .+ over', 'place .+ over',
      'put .+ behind', 'place .+ behind', 'put .+ in front of', 'place .+ in front of',
      'add .+ to', 'include .+ with', 'show .+ with', 'have .+ on'
    ];
    
    const hasSpatialRelationship = spatialRelationships.some(pattern => {
      const regex = new RegExp(pattern, 'i');
      return regex.test(lowerPrompt);
    });
    
    // Check if the prompt references multiple context subjects
    const contextSubjects = Array.from(conversationImageState.contexts.values())
      .map(ctx => ctx.description.toLowerCase().split(' '))
      .flat()
      .filter(word => word.length > 3);
    
    const referencedSubjects = contextSubjects.filter(subject => 
      lowerPrompt.includes(subject)
    );
    
    const referencesMultipleSubjects = referencedSubjects.length > 1;
    
    const result = hasCombinationKeyword || 
                   (hasMultipleContexts && mentionsMultiple) ||
                   (hasMultipleContexts && hasSpatialRelationship) ||
                   referencesMultipleSubjects;
    
    if (result) {
      console.log('🎨 Multi-image combination detected:', {
        hasCombinationKeyword,
        hasMultipleContexts,
        mentionsMultiple,
        hasSpatialRelationship,
        referencesMultipleSubjects,
        referencedSubjects,
        contextsCount: conversationImageState.contexts.size,
        prompt: prompt
      });
    }
    
    return result;
  }, [conversationImageState.contexts]);

  // Chat interaction handlers
  const handleEditUserMessage = (messageId: string, currentText: string) => {
    setEditingMessageId(messageId);
    setEditText(currentText);
  };

  const handleSaveEdit = () => {
    if (editingMessageId && editText.trim()) {
      setMessages(prev => prev.map(msg => 
        msg.id === editingMessageId 
          ? { ...msg, text: editText.trim() }
          : msg
      ));
      setEditingMessageId(null);
      setEditText('');
    }
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditText('');
  };

  const handleCopyUserMessage = (textToCopy: string, messageId: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopiedMessageId(messageId);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  const handleCopy = (textToCopy: string | undefined, messageId: string) => {
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    }
  };

  const handleLike = (messageId: string) => {
    setFeedbackStatusMap(prev => ({
      ...prev,
      [messageId]: prev[messageId] === 'liked' ? null : 'liked'
    }));
  };

  const handleDislike = (messageId: string) => {
    setFeedbackStatusMap(prev => ({
      ...prev,
      [messageId]: prev[messageId] === 'disliked' ? null : 'disliked'
    }));
  };

  // Optimized image rendering with lazy loading and caching
  const renderImageContainer = useCallback((message: ChatMessage) => {
    if (!message.isGeneratingImage && !message.imageData) {
      return null;
    }

    // Helper function to get the proper image URL
    const getImageUrl = () => {
      if (!message.imageData) return '';
      
      // Check if imageData is already a complete data URI or URL
      if (message.imageData.startsWith('http://') || message.imageData.startsWith('https://')) {
        return message.imageData; // Return URLs as-is
      }
      
      if (message.imageData.startsWith('data:')) {
        // Handle malformed nested data URIs from GPT Image 1
        if (message.imageData.includes('data:image/svg+xml;base64,data:image/png;base64,')) {
          console.warn('⚠️ Detected malformed nested data URI in ImageStudio, extracting PNG data...');
          // Extract the PNG data from the nested structure
          const pngMatch = message.imageData.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
          if (pngMatch && pngMatch[1]) {
            const pngBase64 = pngMatch[1].split('data:')[0]; // Remove any trailing nested data
            return `data:image/png;base64,${pngBase64}`;
          }
        }
        // Return as-is if it's already a valid data URI
        return message.imageData;
      }
      
      // If it's just base64 data, add the data URI prefix
      return `data:image/png;base64,${message.imageData}`;
    };

    const handleImageClick = () => {
      if (message.imageData) {
        const imageUrl = getImageUrl();
        console.log('🖼️ IMAGE CLICKED - Opening NEW CanvasViewer:', {
          component: 'CanvasViewer',
          imageUrl: imageUrl.substring(0, 50) + '...',
          timestamp: new Date().toISOString()
        });
        setCanvasViewerImageUrl(imageUrl);
        setIsCanvasViewerOpen(true);
      }
    };

    const containerClassName = `image-container ${message.isGeneratingImage && !message.imageData ? 'loading' : ''}`;

    return (
      <div className={containerClassName}>
        {message.isGeneratingImage && !message.imageData ? (
          <div className="flex items-center gap-2 py-4">
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
            <span className="text-gray-400 text-sm">
              Generating image...
              {message.queueStatus && (
                <span className="ml-2">
                  Status: {message.queueStatus}
                  {message.queuePosition && ` (Position in queue: ${message.queuePosition})`}
                </span>
              )}
            </span>
          </div>
        ) : message.imageData ? (
          <OptimizedImage
            src={getImageUrl()}
            alt="AI generated image"
            className="max-w-md rounded-md border border-gray-600 cursor-pointer mt-3"
            onClick={handleImageClick}
            placeholderWidth={400}
            placeholderHeight={300}
            placeholderAspectRatio="4/3"
          />
        ) : null}
      </div>
    );
  }, [setFullScreenImageUrl, setIsFullScreenImageOpen, setViewerShowsDownloadButton]);

  // Tool data with descriptions and video tutorials (exact from original)
  const toolsData = {
    segmentation: {
      name: 'AI Segmentation',
      shortcut: 'S',
      description: 'Uses AI to automatically segment and isolate objects or areas in your image. Perfect for precise selections and background removal.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: Scissors
    },
    brush: {
      name: 'Brush Tool',
      shortcut: 'B',
      description: 'Paints with the selected brush and color. Perfect for artistic edits and touch-ups.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: Paintbrush
    },
    crop: {
      name: 'Crop & Rotate Tool',
      shortcut: 'C',
      description: 'Crops and rotates your image. Remove unwanted areas and adjust orientation.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: RotateCw
    },
    adjust: {
      name: 'Adjustment Tool',
      shortcut: 'A',
      description: 'Adjusts brightness, contrast, and color. Fine-tune your image appearance.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: Sliders
    },
    transform: {
      name: 'Transform Tool',
      shortcut: 'T',
      description: 'Transforms and resizes objects. Scale, rotate, and manipulate your image elements.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: Maximize2
    },
    enhance: {
      name: 'Enhance Tool',
      shortcut: 'E',
      description: 'Enhances and upscales image quality. Improve resolution and detail clarity.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: TrendingUp
    }
  };

  // Extract all handler functions from the original file
  const handleGenerate = async () => {
    if (!inputValue.trim()) return;
    
    // Get the latest generated image from the conversation for automatic attachment
    const getLatestGeneratedImage = (): File | null => {
      // Look through messages in reverse order to find the most recent AI-generated image
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.sender === 'ai' && message.imageData) {
          // Convert the image URL to a File object for Flux Kontext Multi
          try {
            // For now, we'll use the imageData URL directly in the API call
            // The fluxKontextService should handle URL-based images
            return null; // We'll handle this differently in the API call
          } catch (error) {
            console.warn('Could not convert latest image to file:', error);
          }
        }
      }
      return null;
    };

    const latestGeneratedImage = getLatestGeneratedImage();
    const hasManualAttachments = attachedFiles.length > 0;
    const hasLatestImage = messages.some(msg => msg.sender === 'ai' && msg.imageData);
    
    // Detect if the user's message is about editing the existing image vs creating new content
    const detectImageEditingIntent = (prompt: string): boolean => {
      const lowerPrompt = prompt.toLowerCase();
      
      // Keywords that suggest image editing/modification
      const editingKeywords = [
        'change', 'edit', 'modify', 'adjust', 'alter', 'update', 'fix',
        'make it', 'make the', 'make this', 'turn it', 'turn the', 'turn this',
        'add', 'remove', 'replace', 'substitute', 'swap',
        'enhance', 'improve', 'refine', 'polish', 'upgrade',
        'darker', 'lighter', 'brighter', 'more', 'less', 'bigger', 'smaller',
        'different color', 'new color', 'change color', 'recolor',
        'style it', 'restyle', 'convert to', 'transform',
        'without the', 'remove the', 'delete the',
        'instead of', 'rather than', 'but with', 'except'
      ];
      
      // Keywords that suggest creating entirely new content
      const newContentKeywords = [
        'create a new', 'generate a new', 'make a new', 'show me a new',
        'create an image of', 'generate an image of', 'make an image of',
        'draw a', 'paint a', 'design a', 'build a',
        'i want to see', 'show me something', 'let me see',
        'completely different', 'totally different', 'something else entirely'
      ];
      
      // Check for explicit new content indicators first
      const hasNewContentKeywords = newContentKeywords.some(keyword => 
        lowerPrompt.includes(keyword)
      );
      
      if (hasNewContentKeywords) {
        return false; // Definitely want new content
      }
      
      // Check for editing keywords
      const hasEditingKeywords = editingKeywords.some(keyword => 
        lowerPrompt.includes(keyword)
      );
      
      // If the prompt is very short and doesn't contain editing keywords, 
      // it's likely a new concept
      if (prompt.trim().split(' ').length <= 3 && !hasEditingKeywords) {
        return false;
      }
      
      return hasEditingKeywords;
    };
    
    // Determine if this is an image editing request vs fresh generation
    const isImageEditRequest = hasLatestImage && !hasManualAttachments && detectImageEditingIntent(inputValue);
    
    // Debug logging for intent detection
    if (hasLatestImage && !hasManualAttachments) {
      const editIntent = detectImageEditingIntent(inputValue);
      console.log(`Intent Detection:`, {
        prompt: inputValue,
        hasLatestImage: hasLatestImage,
        editingIntent: editIntent,
        willUseImageToImage: isImageEditRequest
      });
    }
    
    // Create user message with attached images
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: inputValue,
      userImageAttachment: attachedFiles.length > 0 && attachedFiles[0].fileObject ? {
        file: attachedFiles[0].fileObject,
        name: attachedFiles[0].name,
        type: attachedFiles[0].type
      } : undefined
    };

    // Add user message to chat
    setMessages(prev => [...prev, userMessage]);

    // Create AI response message with generating state
    const aiMessage: ChatMessage = {
      id: `ai-${Date.now()}`,
      sender: 'ai',
      text: '',
      isGeneratingImage: true,
      queueStatus: undefined, // Will be updated with queue info
      queuePosition: undefined
    };

    // Add AI message to chat and trigger scroll to bottom
    shouldScrollToBottomRef.current = true;
    setMessages(prev => [...prev, aiMessage]);

    // Prepare style-enhanced prompt
    const getStylePrompt = (): string => {
      if (!savedStyle) return '';
      
      switch (savedStyle.type) {
        case 'prompt':
          return ` in the style of: ${savedStyle.content}`;
        case 'preset':
          const presetPrompts = {
            'photorealistic': ' in photorealistic style, highly detailed, professional photography',
            'artistic': ' in artistic style, creative and expressive',
            'vintage': ' in vintage style, retro aesthetic, aged look',
            'cyberpunk': ' in cyberpunk style, futuristic neon, high-tech',
            'watercolor': ' in watercolor painting style, soft and flowing',
            'minimalist': ' in minimalist style, clean and simple',
            'fantasy': ' in fantasy art style, magical and mystical',
            'anime': ' in anime art style, Japanese animation',
            'abstract': ' in abstract art style, non-representational',
            'noir': ' in film noir style, dark and dramatic'
          };
          return presetPrompts[savedStyle.content as keyof typeof presetPrompts] || '';
        case 'image':
          return ' using the provided style reference image';
        default:
          return '';
      }
    };

    // Store current generation state with style enhancement
    const basePrompt = inputValue.trim();
    const stylePrompt = getStylePrompt();
    const prompt = basePrompt + stylePrompt;
    let imageFiles = attachedFiles
      .filter(file => file.fileObject && file.type.startsWith('image/'))
      .map(file => file.fileObject!)
      .filter((file): file is File => file instanceof File);

    // Add style reference image if it exists and is of type 'image'
    if (savedStyle && savedStyle.type === 'image' && styleReferenceImage) {
      imageFiles.push(styleReferenceImage);
    }

    // If no manual attachments but we have a latest generated image, use it for image-to-image
    let latestImageUrl: string | null = null;
    if (imageFiles.length === 0 && isImageEditRequest) {
      // Find the latest generated image URL
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.sender === 'ai' && message.imageData) {
          latestImageUrl = message.imageData;
          break;
        }
      }
    }

    // Clear input and attached files
    setInputValue('');
    setAttachedFiles([]);
    setIsGenerating(true);

    // Store current request ID for cancellation
    let currentRequestId: string | null = null;
    let currentEndpoint: string | null = null;

    try {
      // Use the selected model for generation
      if (selectedModel === 'flux-kontext') {
        // Import the Flux Kontext service
        const { fluxKontextService } = await import('../../../../../services/fluxKontextService');
        
        // Determine which generation method to use based on attached images or latest generated image
        const hasManualImages = imageFiles.length > 0;
        const hasLatestImageForEdit = latestImageUrl !== null;
        const shouldUseImageToImage = hasManualImages || hasLatestImageForEdit;
        
        // Prepare generation options with current settings
        const options = {
          num_images: 1,
          aspect_ratio: aspectRatio as '21:9' | '16:9' | '4:3' | '3:2' | '1:1' | '2:3' | '3:4' | '9:16' | '9:21',
          output_format: 'jpeg' as 'jpeg' | 'png',
          guidance_scale: guidanceScale,
          safety_tolerance: '2' as '1' | '2' | '3' | '4' | '5' | '6',
          seed: seed ? parseInt(seed) : undefined,
        };

        let result: any;
        
        if (shouldUseImageToImage) {
          // Use multi/image-to-image endpoint
          if (hasManualImages) {
            console.log('Using Flux Kontext Multi (with manually attached images)');
            result = await fluxKontextService.generateFromTextAndImages(
              prompt,
              imageFiles,
              options,
              (queueUpdate) => {
                currentRequestId = queueUpdate.requestId;
                currentEndpoint = 'fal-ai/flux-pro/kontext/max/multi';
                
                // Update AI message with queue status
                setMessages(prev => prev.map(msg => 
                  msg.id === aiMessage.id 
                    ? {
                        ...msg,
                        queueStatus: queueUpdate.status,
                        queuePosition: queueUpdate.queue_position
                      }
                    : msg
                ));
              }
            );
          } else if (hasLatestImageForEdit && latestImageUrl) {
            console.log('Using Flux Kontext Multi (with latest generated image for editing)');
            // Use the latest generated image for image-to-image editing
            result = await fluxKontextService.generateFromTextAndImageUrls(
              prompt,
              [latestImageUrl],
              options,
              (queueUpdate: any) => {
                currentRequestId = queueUpdate.requestId;
                currentEndpoint = 'fal-ai/flux-pro/kontext/max/multi';
                
                // Update AI message with queue status
                setMessages(prev => prev.map(msg => 
                  msg.id === aiMessage.id 
                    ? {
                        ...msg,
                        queueStatus: queueUpdate.status,
                        queuePosition: queueUpdate.queue_position
                      }
                    : msg
                ));
              }
            );
          }
        } else {
          // Use text-to-image endpoint for fresh generation
          console.log('Using Flux Kontext Text-to-Image');
          result = await fluxKontextService.generateFromText(
            prompt,
            options,
            (queueUpdate) => {
              currentRequestId = queueUpdate.requestId;
              currentEndpoint = 'fal-ai/flux-pro/kontext/max/text-to-image';
              
              // Update AI message with queue status
              setMessages(prev => prev.map(msg => 
                msg.id === aiMessage.id 
                  ? {
                      ...msg,
                      queueStatus: queueUpdate.status,
                      queuePosition: queueUpdate.queue_position
                    }
                  : msg
              ));
            }
          );
        }

        if (result.success && result.images && result.images.length > 0) {
          // Successfully generated image
          const generatedImage = result.images[0];
          
          // Update AI message with generated image
          const generationMode = shouldUseImageToImage ? 'Multi' : 'Text-to-Image';
          setMessages(prev => prev.map(msg => 
            msg.id === aiMessage.id 
              ? {
                  ...msg,
                  isGeneratingImage: false,
                  text: `Image generated successfully using Flux Kontext ${generationMode}`,
                  imageData: generatedImage.url, // Use the actual image URL
                  modelIdUsed: 'flux-kontext',
                  queueStatus: undefined,
                  queuePosition: undefined
                }
              : msg
          ));

          // Handle session creation or update
          const now = Date.now();
          const finalAiMessage: ChatMessage = {
            ...aiMessage,
            isGeneratingImage: false,
            text: `Image generated successfully using Flux Kontext ${generationMode}`,
            imageData: generatedImage.url,
            modelIdUsed: 'flux-kontext',
            queueStatus: undefined,
            queuePosition: undefined
          };

          // Update session using the history hook
          const updatedMessages = [...messages.filter(msg => msg.id !== aiMessage.id), userMessage, finalAiMessage];
          const sessionSettings = {
            model: 'flux-kontext',
            seed: result.metadata?.seed?.toString(),
            guidanceScale: options.guidance_scale,
            aspectRatio: options.aspect_ratio,
            numImages: options.num_images
          };
          
          historyHook.createOrUpdateSession(updatedMessages, sessionSettings);
          
        } else {
          // Generation failed
          setMessages(prev => prev.map(msg => 
            msg.id === aiMessage.id 
              ? {
                  ...msg,
                  isGeneratingImage: false,
                  text: `❌ Failed to generate image: ${result.error || 'Unknown error'}`,
                  isError: true,
                  queueStatus: undefined,
                  queuePosition: undefined
                }
              : msg
          ));
        }

            } else if (selectedModel === 'gpt-image-1') {
        console.log('Using GPT Image 1 for conversational image generation');
        
        // Comprehensive intent detection system
        const analyzePromptIntent = (prompt: string) => {
          const lowerPrompt = prompt.toLowerCase().trim();
          
          // 1. STRONG REFERENCE INDICATORS (definitely referring to existing image)
          const strongReferencePatterns = [
            // Pronouns
            /\b(it|them|they|this|that|these|those)\b/,
            // Direct modifications
            /\b(make it|make them|make this|make that)\b/,
            // Color changes
            /\b(change|turn|make).*(color|blue|red|green|yellow|purple|orange|black|white|pink|brown|gray|grey)\b/,
            // Style changes
            /\b(more|less|very|extremely|super)\s+(realistic|detailed|colorful|bright|dark|dramatic|artistic|abstract)\b/,
            // Direct edits
            /\b(edit|modify|adjust|alter|update|fix|improve|enhance|refine|polish)\b/,
            // Comparative changes
            /\binstead of\b|rather than\b|but with\b|without the\b|remove the\b|add to\b/
          ];
          
          // 2. STRONG NEW IMAGE INDICATORS (definitely new image)
          const strongNewImagePatterns = [
            // Articles + nouns
            /^(a|an|the)\s+\w+/,
            // Creation verbs
            /^(generate|create|draw|make a|make an|show me|picture of|image of)\b/,
            // Multiple subjects
            /\b(and|with|plus|alongside)\b.*\b(dog|cat|car|person|house|tree|landscape|portrait)\b/,
            // Descriptive scenes
            /^(beautiful|stunning|amazing|incredible|fantastic)\s+\w+/
          ];
          
          // 3. Check for strong patterns first
          const hasStrongReference = strongReferencePatterns.some(pattern => pattern.test(lowerPrompt));
          const hasStrongNewImage = strongNewImagePatterns.some(pattern => pattern.test(lowerPrompt));
          
          // 4. If we have strong indicators, use them
          if (hasStrongReference && !hasStrongNewImage) {
            return { isReference: true, isNewImage: false, confidence: 'high' };
          }
          
          if (hasStrongNewImage && !hasStrongReference) {
            return { isReference: false, isNewImage: true, confidence: 'high' };
          }
          
          // 5. CONTEXTUAL ANALYSIS for ambiguous cases
          const contextualNewImageIndicators = [
            // Subject matter
            /\b(dog|cat|car|house|tree|person|woman|man|child|landscape|portrait|abstract|painting|photo|illustration|sunset|mountain|ocean|forest|city|building|flower|animal)\b/,
            // Descriptive adjectives for new scenes
            /\b(beautiful|stunning|majestic|serene|dramatic|vibrant|peaceful|mysterious|ancient|modern|futuristic)\b/,
            // Scene descriptions
            /\b(in the|on a|at the|under the|above the|beside the|near the)\b/
          ];
          
          const contextualReferenceIndicators = [
            // Modification words
            /\b(brighter|darker|lighter|bigger|smaller|clearer|sharper|softer|harder)\b/,
            // Quality improvements
            /\b(better|worse|higher|lower|increased|decreased|enhanced|reduced)\b/,
            // Style changes
            /\b(realistic|cartoonish|artistic|photographic|painted|sketched)\b/
          ];
          
          const hasContextualNew = contextualNewImageIndicators.some(pattern => pattern.test(lowerPrompt));
          const hasContextualReference = contextualReferenceIndicators.some(pattern => pattern.test(lowerPrompt));
          
          // 6. Make decision based on contextual analysis
          if (hasContextualReference && !hasContextualNew) {
            return { isReference: true, isNewImage: false, confidence: 'medium' };
          }
          
          if (hasContextualNew && !hasContextualReference) {
            return { isReference: false, isNewImage: true, confidence: 'medium' };
          }
          
          // 7. Default fallback - if we have existing contexts, lean towards reference
          const hasExistingContexts = conversationImageState.contexts.size > 0;
          if (hasExistingContexts) {
            return { isReference: true, isNewImage: false, confidence: 'low' };
          } else {
            return { isReference: false, isNewImage: true, confidence: 'low' };
          }
        };

        // Use the comprehensive analysis
        const intentAnalysis = analyzePromptIntent(basePrompt);
        const isFollowUpRequest = intentAnalysis.isReference;
        const isNewImageRequest = intentAnalysis.isNewImage;
        
        console.log('🧠 Intent Analysis:', {
          prompt: basePrompt,
          isReference: intentAnalysis.isReference,
          isNewImage: intentAnalysis.isNewImage,
          confidence: intentAnalysis.confidence,
          existingContexts: conversationImageState.contexts.size
        });
        
        // Multi-context conversation logic
        let previousResponseId: string | undefined;
        let previousImageGenerationCallId: string | undefined;
        let targetContextId: string | undefined;
        let isMultiImageCombination = false;
        
        isMultiImageCombination = detectMultiImageCombinationIntent(basePrompt);
        
        // Decision logic for conversation context
        if (isMultiImageCombination) {
          // User wants to combine multiple images - use main conversation context
          console.log('🎨 Detected multi-image combination request');
          console.log('🎨 Available contexts:', Array.from(conversationImageState.contexts.entries()).map(([id, ctx]) => ({
            id,
            description: ctx.description,
            imageGenerationCallId: ctx.imageGenerationCallId,
            isEdited: ctx.imageGenerationCallId.startsWith('edited_img_')
          })));
          previousResponseId = conversationImageState.conversationResponseId;
          // We'll send all contexts in the request
        } else if (isFollowUpRequest && !isNewImageRequest) {
          // This is a follow-up to modify an existing image - find the relevant context
          const relevantContext = findRelevantImageContext(basePrompt);
          if (relevantContext) {
            previousResponseId = relevantContext.responseId;
            previousImageGenerationCallId = relevantContext.imageGenerationCallId;
            targetContextId = relevantContext.id;
            console.log('🔄 Detected follow-up request, using context:', {
              contextId: relevantContext.id,
              description: relevantContext.description,
              responseId: previousResponseId,
              imageGenerationCallId: previousImageGenerationCallId
            });
          } else {
            console.log('❓ Follow-up detected but no relevant context found, creating new image');
          }
        } else if (isNewImageRequest) {
          // This is a new image request - will create new context
          console.log('🆕 Detected new image request, will create new context');
          previousResponseId = conversationImageState.conversationResponseId; // Use main conversation
          previousImageGenerationCallId = undefined;
        } else {
          // Ambiguous case - treat as new image
          console.log('❓ Ambiguous request detected, treating as new image');
          previousResponseId = conversationImageState.conversationResponseId;
          previousImageGenerationCallId = undefined;
        }
        
        // CRITICAL FIX: Check if we're trying to use an edited image context
        // If so, switch to image editing approach instead of conversational generation
        if (previousImageGenerationCallId && previousImageGenerationCallId.startsWith('edited_img_')) {
          console.log('🎨 Detected edited image context, switching to image editing approach');
          
          // Find the message with the edited image
          const relevantContext = conversationImageState.contexts.get(targetContextId!);
          const messageWithEditedImage = messages.find(msg => msg.id === relevantContext?.messageId);
          
          if (messageWithEditedImage && messageWithEditedImage.imageData) {
            console.log('🎨 Found edited image, using image editing endpoint');
            
            // Use the image editing endpoint instead
            const editResponse = await fetch('/api/chat/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                task: 'edit_image',
                imageData: messageWithEditedImage.imageData,
                prompt: basePrompt,
                model: 'gpt-image-1',
                outputFormat: 'png',
                quality: 'auto',
                size: 'auto',
                background: 'auto'
              })
            });

            if (!editResponse.ok) {
              const errorData = await editResponse.json();
              throw new Error(errorData.error || `Image edit request failed with status ${editResponse.status}`);
            }

            const editResult = await editResponse.json();

            if (editResult.imageData) {
              const newImageUrl = `data:image/png;base64,${editResult.imageData}`;
              
              // Create a new context for this edit
              const editedContextId = generateNextContextId();
              const editedContext: ImageContext = {
                id: editedContextId,
                description: `${relevantContext?.description || 'image'} (${basePrompt})`,
                responseId: `edited_${Date.now()}`,
                imageGenerationCallId: `edited_img_${Date.now()}`,
                createdAt: Date.now(),
                lastModified: Date.now(),
                messageId: aiMessage.id
              };
              
              // Add the new context
              setConversationImageState(prev => {
                const newContexts = new Map(prev.contexts);
                newContexts.set(editedContextId, editedContext);
                return {
                  ...prev,
                  contexts: newContexts
                };
              });

              // Update AI message with edited image
        setMessages(prev => prev.map(msg => 
          msg.id === aiMessage.id 
            ? {
                ...msg,
                isGeneratingImage: false,
                      text: `Image edited successfully using GPT Image 1 (Context: ${editedContext.id} - ${editedContext.description})`,
                      imageData: newImageUrl,
                      modelIdUsed: 'gpt-image-1',
                      responseId: editedContext.responseId,
                      imageGenerationCallId: editedContext.imageGenerationCallId,
                      imageContextId: editedContextId,
                      imageDescription: editedContext.description,
                queueStatus: undefined,
                queuePosition: undefined
              }
            : msg
        ));

              // Handle session creation or update
              const finalAiMessage: ChatMessage = {
                ...aiMessage,
                isGeneratingImage: false,
                text: `Image edited successfully using GPT Image 1 (Context: ${editedContext.id} - ${editedContext.description})`,
                imageData: newImageUrl,
                modelIdUsed: 'gpt-image-1',
                responseId: editedContext.responseId,
                imageGenerationCallId: editedContext.imageGenerationCallId,
                imageContextId: editedContextId,
                imageDescription: editedContext.description,
                queueStatus: undefined,
                queuePosition: undefined
              };

              const updatedMessages = [...messages.filter(msg => msg.id !== aiMessage.id), userMessage, finalAiMessage];
              const sessionSettings = {
                model: 'gpt-image-1',
                seed: '',
                guidanceScale: guidanceScale,
                aspectRatio: aspectRatio,
                numImages: 1
              };
              
              historyHook.createOrUpdateSession(updatedMessages, sessionSettings);
              
              console.log('🎨 Successfully edited image and created new context:', editedContextId);
              return; // Exit early, we're done
            } else {
              throw new Error('No image data received from image editing');
            }
          } else {
            console.error('🎨 Could not find message with edited image data');
            throw new Error('Could not find the edited image to use as context');
          }
        }

        // Prepare the API request with multi-context support (for non-edited images)
        const requestPayload: any = {
          task: 'image',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          ...(previousResponseId && { previousResponseId }),
          ...(previousImageGenerationCallId && { previousImageGenerationCallId })
        };

        // Add multi-context information for combination requests
        if (isMultiImageCombination && conversationImageState.contexts.size > 0) {
          const allContexts = Array.from(conversationImageState.contexts.values());
          
          // CRITICAL FIX: For combinations, always use the LATEST image data from messages
          // instead of relying on imageGenerationCallId which points to original versions
          const contextImages = [];
          
          for (const ctx of allContexts) {
            // Find the message that contains this context's current image
            const contextMessage = messages.find(msg => msg.imageContextId === ctx.id);
            
            if (contextMessage && contextMessage.imageData) {
              contextImages.push({
                contextId: ctx.id,
                description: ctx.description,
                imageData: contextMessage.imageData,
                isLatestVersion: true
              });
              console.log(`🎨 Including LATEST image data for context ${ctx.id}: ${ctx.description}`);
            } else {
              // Fallback: if we can't find the message, try to use the generation call ID
              // but this should rarely happen in normal workflow
              if (!ctx.imageGenerationCallId.startsWith('edited_img_')) {
                contextImages.push({
                  contextId: ctx.id,
                  description: ctx.description,
                  imageGenerationCallId: ctx.imageGenerationCallId,
                  isLatestVersion: false
                });
                console.log(`🎨 Fallback: Using generation call ID for context ${ctx.id}: ${ctx.description}`);
              }
            }
          }
          
          // Send all images as direct image data for combinations
          if (contextImages.length > 0) {
            requestPayload.combinationImages = contextImages;
          }
          
          console.log('🎨 Sending combination images:', {
            totalImages: contextImages.length,
            latestVersions: contextImages.filter(img => img.isLatestVersion).length,
            fallbackVersions: contextImages.filter(img => !img.isLatestVersion).length
          });
        }

        console.log('Calling conversational image generation API...');
        const response = await fetch('/api/chat/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload)
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `API request failed with status ${response.status}`);
        }

        const result = await response.json();

        if (result.imageData) {
          // Successfully generated image
          const imageUrl = `data:image/png;base64,${result.imageData}`;
          
          // Generate a brief description for context tracking
          const generateImageDescription = (prompt: string): string => {
            const words = prompt.toLowerCase().split(' ').filter(word => word.length > 2);
            const importantWords = words.filter(word => 
              !['the', 'and', 'with', 'for', 'make', 'create', 'generate', 'image', 'picture'].includes(word)
            );
            return importantWords.slice(0, 3).join(' ');
          };

          // Determine the appropriate success message and manage contexts
          const getSuccessMessage = () => {
            if (isMultiImageCombination) {
              const contextCount = (requestPayload.imageContexts?.length || 0) + (requestPayload.editedImages?.length || 0);
              return `Combined image created successfully using GPT Image 1 (${contextCount} images combined)`;
            } else if (isFollowUpRequest && !isNewImageRequest && targetContextId) {
              const context = conversationImageState.contexts.get(targetContextId);
              return `Image updated successfully using GPT Image 1 (Context: ${context?.id} - ${context?.description})`;
            } else if (isNewImageRequest || !targetContextId) {
              return `New image generated successfully using GPT Image 1 (Context: ${conversationImageState.nextContextId})`;
            } else {
              return `Image generated successfully using GPT Image 1 (conversational)`;
            }
          };

          // Manage image contexts
          let contextId: string;
          if (isMultiImageCombination) {
            // For multi-image combinations, create a new context that represents the combined result
            const combinedDescription = `combined (${Array.from(conversationImageState.contexts.values()).map(c => c.description).join(' + ')})`;
            contextId = addImageContext(combinedDescription, result.responseId, result.imageGenerationCallId, aiMessage.id);
            console.log('🎨 Created new combined context:', contextId, '->', combinedDescription);
          } else if (targetContextId) {
            // Update existing context
            updateImageContext(targetContextId, result.responseId, result.imageGenerationCallId);
            contextId = targetContextId;
          } else {
            // Create new context
            const description = generateImageDescription(basePrompt);
            contextId = addImageContext(description, result.responseId, result.imageGenerationCallId, aiMessage.id);
          }

          // Update main conversation response ID if this is the first image
          if (!conversationImageState.conversationResponseId) {
            setConversationImageState(prev => ({
              ...prev,
              conversationResponseId: result.responseId
            }));
          }

          // Update AI message with generated image and store conversation context
        setMessages(prev => prev.map(msg => 
          msg.id === aiMessage.id 
            ? {
                ...msg,
                isGeneratingImage: false,
                  text: getSuccessMessage(),
                  imageData: imageUrl,
                  modelIdUsed: 'gpt-image-1',
                  responseId: result.responseId, // Store for future follow-ups
                  imageGenerationCallId: result.imageGenerationCallId, // Store for context
                  imageContextId: contextId, // Store context ID
                  imageDescription: conversationImageState.contexts.get(contextId)?.description,
                queueStatus: undefined,
                queuePosition: undefined
              }
            : msg
        ));

          // Handle session creation or update
          const finalAiMessage: ChatMessage = {
            ...aiMessage,
            isGeneratingImage: false,
            text: getSuccessMessage(),
            imageData: imageUrl,
            modelIdUsed: 'gpt-image-1',
            responseId: result.responseId,
            imageGenerationCallId: result.imageGenerationCallId,
            imageContextId: contextId,
            imageDescription: conversationImageState.contexts.get(contextId)?.description,
            queueStatus: undefined,
            queuePosition: undefined
          };

          // Update session using the history hook
          const updatedMessages = [...messages.filter(msg => msg.id !== aiMessage.id), userMessage, finalAiMessage];
          const sessionSettings = {
            model: 'gpt-image-1',
            seed: '', // GPT Image 1 doesn't use seeds
            guidanceScale: guidanceScale,
            aspectRatio: aspectRatio,
            numImages: 1
          };
          
          historyHook.createOrUpdateSession(updatedMessages, sessionSettings);
        } else {
          throw new Error('No image data received from conversational image generation');
        }
      }

    } catch (error) {
      console.error('Error during generation:', error);
      
      // Update AI message with error
      setMessages(prev => prev.map(msg => 
        msg.id === aiMessage.id 
          ? {
              ...msg,
              isGeneratingImage: false,
              text: `❌ Error: ${error instanceof Error ? error.message : 'An unexpected error occurred'}`,
              isError: true,
              queueStatus: undefined,
              queuePosition: undefined
            }
          : msg
      ));
    } finally {
      setIsGenerating(false);
      currentRequestId = null;
      currentEndpoint = null;
    }
  };

  const handleStop = () => {
    setIsGenerating(false);
  };

  const toggleAttachMenu = () => {
    setIsAttachMenuOpen(!isAttachMenuOpen);
  };

  const toggleSettingsMenu = () => {
    setIsSettingsOpen(!isSettingsOpen);
  };

  const toggleHistory = () => {
    historyHook.toggleHistory();
  };

  const toggleStyleModal = () => {
    setIsStyleModalOpen(!isStyleModalOpen);
  };

  const toggleProjectManager = async () => {
    // If no current project exists and user is authenticated, create one
    if (databaseHook.isAuthenticated && !databaseHook.currentProject) {
      console.log('📂 No current project - creating one...');
      const project = await databaseHook.createProject({
        title: 'Untitled Project',
        model: selectedModel,
        seed: seed || undefined,
        guidance_scale: guidanceScale,
        aspect_ratio: aspectRatio,
        num_images: numImages
      });
      if (project) {
        navigate(`/overview/studio/image/${project.id}`, { replace: true });
      }
    }
    setIsProjectManagerOpen(!isProjectManagerOpen);
  };

  const handleLoadProject = async (project: any) => {
    console.log('📂 Loading project:', project.title);

    // Load project sessions (chat history)
    if (project.id) {
      try {
        const result = await databaseHook.loadProject(project.id);
        // The hook updates currentProject automatically

        // Load sessions for this project
        await databaseHook.loadSessionsFromDatabase();

        // Update URL to reflect the loaded project
        navigate(`/overview/studio/image/${project.id}`, { replace: true });

        console.log('✅ Project loaded successfully');
      } catch (error) {
        console.error('❌ Error loading project:', error);
      }
    }
  };

  const toggleModelDropdown = () => {
    setIsModelDropdownOpen(!isModelDropdownOpen);
  };

  const handleModelSelect = (model: 'gpt-image-1' | 'flux-kontext') => {
    setSelectedModel(model);
    setIsModelDropdownOpen(false);
  };

  const generateRandomSeed = () => {
    setSeed(Math.floor(Math.random() * 1000000).toString());
  };

  // File handling functions
  const handleUploadFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
      
      if (imageFiles.length === 0) {
        console.warn('No valid image files selected');
        return;
      }

      const newFiles: AttachedFile[] = imageFiles.map(file => ({
        id: `${file.name}-${file.lastModified}-${file.size}`,
        name: file.name,
        type: file.type,
        fileObject: file
      }));
      
      const now = Date.now();
      const newRecentFiles = imageFiles.map(file => ({
        id: `${file.name}-${file.lastModified}-${file.size}`,
        name: file.name,
        type: file.type,
        size: file.size,
        lastUsed: now,
        preview: URL.createObjectURL(file)
      }));

      setRecentFiles(prev => {
        const filtered = prev.filter(existingFile => 
          !newRecentFiles.some(newFile => newFile.name === existingFile.name)
        );
        return [...newRecentFiles, ...filtered].slice(0, 20);
      });
      
      setAttachedFiles(prev => [...prev, ...newFiles]);
      setIsAttachMenuOpen(false);
      setIsRecentFilesOpen(false);
    }
    if(event.target) {
      event.target.value = '';
    }
  };

  const handleRemoveAttachedFile = (fileIdToRemove: string) => {
    setAttachedFiles(prev => prev.filter(file => file.id !== fileIdToRemove));
  };

  const handleConnectDrive = () => {
    console.log('Connect Drive - Feature coming soon');
  };

  const handleConnectOneDrive = () => {
    console.log('Connect OneDrive - Feature coming soon');
  };

  const handleShowRecent = () => {
    setIsRecentFilesOpen(true);
  };

  const handleReattachRecentFile = async (recentFile: RecentFile) => {
    if (!recentFile.type.startsWith('image/')) {
      console.warn('Only image files can be attached');
      return;
    }
    
    const attachedFile: AttachedFile = {
      id: `recent-${recentFile.id}-${Date.now()}`,
      name: recentFile.name,
      type: recentFile.type,
    };
    
    setAttachedFiles(prev => [...prev, attachedFile]);
    
    setRecentFiles(prev => 
      prev.map(file => 
        file.id === recentFile.id 
          ? { ...file, lastUsed: Date.now() }
          : file
      ).sort((a, b) => b.lastUsed - a.lastUsed)
    );
    
    setIsAttachMenuOpen(false);
    setIsRecentFilesOpen(false);
  };

  const handleRemoveRecentFile = (fileId: string) => {
    setRecentFiles(prev => prev.filter(file => file.id !== fileId));
  };

  // Canvas handlers
  const handleStartNewProject = async () => {
    console.log('[Modal] Opening modal, current state:', isCanvasProjectSettingsOpen);
    setIsCanvasActionMenuOpen(false);

    // Create database project if authenticated
    if (databaseHook.isAuthenticated) {
      console.log('📂 Creating new database project...');
      const project = await databaseHook.createProject({
        title: 'New Canvas Project',
        model: selectedModel,
        seed: seed || undefined,
        guidance_scale: guidanceScale,
        aspect_ratio: aspectRatio,
        num_images: numImages
      });

      if (project) {
        console.log('✅ Database project created:', project.id);
        navigate(`/overview/studio/image/${project.id}`, { replace: true });

        // Set as active session so history updates work correctly
        historyHook.setActiveSessionId(project.id);

        // Reload history to show the new project
        historyHook.setGenerationHistory(prev => [
          {
            id: project.id,
            title: project.title,
            timestamp: new Date(project.created_at).getTime(),
            messages: [],
            model: project.model as 'gpt-image-1' | 'flux-kontext',
            seed: project.seed,
            aspectRatio: project.aspect_ratio,
            numImages: project.num_images,
            guidanceScale: project.guidance_scale,
            isFromDatabase: true
          },
          ...prev
        ]);
      }
    }

    setIsCanvasProjectSettingsOpen(true);
    console.log('[Modal] State setter called');
  };

  const handleUploadImageToCanvas = () => {
    setIsCanvasActionMenuOpen(false);
    canvasFileInputRef.current?.click();
  };

  // Wrapper for loading sessions that handles canvas projects
  const handleLoadSessionWrapper = async (sessionId: string) => {
    const session = historyHook.generationHistory.find(s => s.id === sessionId);

    if (session && session.isFromDatabase) {
      // If it's a database project, check if it has canvas data
      console.log('📂 Loading database project:', sessionId);
      navigate(`/overview/studio/image/${sessionId}`, { replace: true });

      try {
        const result = await imageStudioService.getProject(sessionId);

        if (result.success && result.project) {
          const project = result.project;
          console.log('🔍 Project data:', {
            hasCanvasData: !!project.canvas_data,
            canvasDataType: typeof project.canvas_data,
            canvasDataKeys: project.canvas_data ? Object.keys(project.canvas_data) : null,
            hasImageData: !!project.canvas_data?.imageData
          });

          // Check if this is a canvas project (has canvas_data with imageData)
          if (project.canvas_data?.imageData) {
            console.log('🎨 Opening canvas project with image');

            // Load the project into database hook
            await databaseHook.loadProject(sessionId);

            // Open the canvas viewer with the project's image from canvas_data
            setCanvasViewerImageUrl(project.canvas_data.imageData);
            
            // Restore canvas project settings
            if (project.canvas_data) {
              setCanvasProjectSettings({
                name: project.canvas_data.name || project.title,
                width: project.canvas_data.width || 1024,
                height: project.canvas_data.height || 1024,
                unit: project.canvas_data.unit || 'pixels',
                resolution: project.canvas_data.resolution || 72,
                colorMode: project.canvas_data.colorMode || 'RGB',
                colorProfile: project.canvas_data.colorProfile || 'sRGB',
                pixelAspectRatio: project.canvas_data.pixelAspectRatio || 'Square Pixels',
                backgroundColor: project.canvas_data.backgroundColor || '#ffffff'
              });
            }

            // Also load the session messages for the canvas project
            await historyHook.handleLoadSession(sessionId);

            setIsCanvasViewerOpen(true);
            setIsCanvasOpen(true);
            setHasCanvasProject(true);
            historyHook.setIsHistoryOpen(false);

            return; // Don't call the default handler
          }
        }
      } catch (error) {
        console.error('❌ Error loading canvas project:', error);
      }
    }

    // Default behavior for non-canvas projects or if canvas loading fails
    await historyHook.handleLoadSession(sessionId);
  };

  // Style modal handlers
  const handleStyleImageUpload = () => {
    styleFileInputRef.current?.click();
  };

  const handleStyleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        setStyleReferenceImage(file);
        const previewUrl = URL.createObjectURL(file);
        setStyleImagePreview(previewUrl);
      }
    }
    // Reset the input value so the same file can be selected again
    if (event.target) {
      event.target.value = '';
    }
  };

  const handleStyleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleStyleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        setStyleReferenceImage(file);
        const previewUrl = URL.createObjectURL(file);
        setStyleImagePreview(previewUrl);
      }
    }
  };

  const handleRemoveStyleImage = () => {
    if (styleImagePreview) {
      URL.revokeObjectURL(styleImagePreview);
    }
    setStyleReferenceImage(null);
    setStyleImagePreview(null);
  };

  const handleClearAllStyle = () => {
    // Clear saved style
    setSavedStyle(null);
    // Clear current editing state
    handleRemoveStyleImage();
    setStylePromptText('');
    setSelectedStylePreset(null);
  };

  // Canvas modal handlers (VideoStudio-style)
  const handleCanvasButtonClick = () => {
    if (isCanvasOpen) {
      setIsCanvasOpen(false);
      setIsCanvasActionMenuOpen(false);
    } else {
      // Toggle the inline action menu
      setIsCanvasActionMenuOpen(prev => !prev);
    }
  };

  // Helper function to create a new canvas session with an image
  const createCanvasSession = async (file: File) => {
    const imageUrl = URL.createObjectURL(file);
    
    // Create a new conversation with the uploaded image
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target?.result as string;
      const base64String = base64Data.split(',')[1]; // Remove data:image/...;base64, prefix
      
      // Create database project if authenticated
      if (databaseHook.isAuthenticated) {
        console.log('📂 Creating database project for uploaded image...');
        const project = await databaseHook.createProject({
          title: file.name,
          model: selectedModel,
          aspect_ratio: aspectRatio,
          num_images: numImages
        });

        if (project) {
          // Set as active session
          historyHook.setActiveSessionId(project.id);
          navigate(`/overview/studio/image/${project.id}`, { replace: true });

          // Update it with initial canvas data (using base64)
          await imageStudioService.updateProject(project.id, {
            canvas_data: {
              imageData: base64Data, // Store full base64
              name: file.name,
              lastModified: Date.now()
            }
          });
        }
      }

      // Create initial message with the uploaded image
      const initialMessage: ChatMessage = {
        id: `canvas-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        text: `Canvas session started with image: ${file.name}`,
        sender: 'user',
        userImageAttachment: {
          name: file.name,
          type: file.type,
          base64Data: base64String
        }
      };

      // Start new session and add the initial message
      historyHook.handleNewSession();
      setMessages([initialMessage]);
      
      // Create/update the session with the initial message
      setTimeout(() => {
        historyHook.createOrUpdateSession([initialMessage], {
          model: selectedModel,
          seed,
          aspectRatio,
          numImages,
          guidanceScale,
          syncMode,
          safetyTolerance,
          outputFormat
        });
      }, 100);
    };
    
    reader.readAsDataURL(file);
    
    // Open the NEW CanvasViewer with the image
    console.log('🎯 CANVAS SESSION - Opening NEW CanvasViewer for uploaded file');
    setCanvasViewerImageUrl(imageUrl);
    setIsCanvasViewerOpen(true);
    setIsCanvasModalOpen(false);
    
    // Set project state (VideoStudio-style)
    setHasCanvasProject(true);
    setIsCanvasOpen(true);
    setIsCanvasActionMenuOpen(false);
  };

  const handleCanvasImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      createCanvasSession(file);
    }
  };

  // Special function to properly close canvas and clear persistence
  const handleCanvasClose = () => {
    setIsFullScreenImageOpen(false);
    setFullScreenImageUrl(null);
    // Note: We don't remove imageEditHistory from localStorage as it should persist
    // for the current conversation session
  };

  const handleCanvasViewerClose = async () => {
    setIsCanvasViewerOpen(false);
    setCanvasViewerImageUrl(null);

    // Update VideoStudio-style state
    setIsCanvasOpen(false);
    setHasCanvasProject(false); // Reset so Canvas button shows menu again

    // Reload history to show the newly created/updated project
    if (databaseHook.isAuthenticated) {
      console.log('🔄 Reloading projects after canvas close...');
      try {
        const result = await imageStudioService.getProjects({
          limit: 50,
          sort: 'updated_at',
          order: 'DESC'
        });

        if (result.success && result.projects) {
          // Convert to session format and prepend to history
          const databaseProjects = result.projects.map(project => ({
            id: project.id,
            title: project.title,
            timestamp: new Date(project.created_at).getTime(),
            messages: [],
            model: project.model as 'gpt-image-1' | 'flux-kontext',
            seed: project.seed,
            aspectRatio: project.aspect_ratio,
            numImages: project.num_images,
            guidanceScale: project.guidance_scale,
            isFromDatabase: true
          }));

          // Merge with localStorage sessions
          const localStorageSessions = historyHook.generationHistory.filter(s => !s.isFromDatabase);
          historyHook.setGenerationHistory([...databaseProjects, ...localStorageSessions]);
          console.log(`✅ Reloaded ${databaseProjects.length} projects from database`);
        }
      } catch (error) {
        console.error('❌ Error reloading projects:', error);
      }
    }
  };

  const handleUnitChange = (newUnit: 'pixels' | 'inches') => {
    if (newUnit === canvasProjectUnit) return;
    
    if (newUnit === 'inches') {
      // Pixels to Inches
      setCanvasProjectWidth(Number((canvasProjectWidth / canvasProjectResolution).toFixed(3)));
      setCanvasProjectHeight(Number((canvasProjectHeight / canvasProjectResolution).toFixed(3)));
    } else {
      // Inches to Pixels
      setCanvasProjectWidth(Math.round(canvasProjectWidth * canvasProjectResolution));
      setCanvasProjectHeight(Math.round(canvasProjectHeight * canvasProjectResolution));
    }
    setCanvasProjectUnit(newUnit);
  };

  const handleCreateCanvasProject = async () => {
    let finalWidth = Number(canvasProjectWidth);
    let finalHeight = Number(canvasProjectHeight);
    
    if (canvasProjectUnit === 'inches') {
      finalWidth = Math.round(finalWidth * canvasProjectResolution);
      finalHeight = Math.round(finalHeight * canvasProjectResolution);
    }

    const width = Math.max(64, Math.min(8192, finalWidth || 1024));
    const height = Math.max(64, Math.min(8192, finalHeight || 1024));

    const settings = {
      name: canvasProjectName.trim() || 'Untitled Canvas',
      width,
      height,
      unit: canvasProjectUnit,
      resolution: canvasProjectResolution,
      colorMode: canvasProjectColorMode,
      colorProfile: canvasProjectColorProfile,
      pixelAspectRatio: canvasProjectPixelAspectRatio,
      backgroundColor: isTransparentBackground ? 'transparent' : canvasBackgroundColor
    };

    let blankCanvasUrl: string | null = null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        if (isTransparentBackground) {
          ctx.clearRect(0, 0, width, height);
        } else {
          ctx.fillStyle = canvasBackgroundColor || '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }
        blankCanvasUrl = canvas.toDataURL('image/png');
      }
    } catch (error) {
      console.warn('Unable to create blank canvas project image, defaulting to empty viewer.', error);
    }

    // Update database project with initial canvas settings if authenticated
    if (databaseHook.isAuthenticated && databaseHook.currentProject && blankCanvasUrl) {
      console.log('💾 Saving initial canvas to database project:', databaseHook.currentProject.id);
      try {
        const result = await imageStudioService.updateProject(
          databaseHook.currentProject.id,
          {
            title: settings.name,
            canvas_data: {
              ...settings,
              imageData: blankCanvasUrl, // Store base64 in JSONB field
              lastModified: Date.now(),
              created: Date.now()
            }
          }
        );

        if (result.success) {
          console.log('✅ Initial canvas saved to database');
        }
      } catch (error) {
        console.error('❌ Error saving initial canvas:', error);
      }
    }

    setCanvasProjectSettings(settings);
    setIsCanvasProjectSettingsOpen(false);
    setHasCanvasProject(true);
    setIsCanvasOpen(true);
    setIsCanvasViewerOpen(true);
    setCanvasViewerImageUrl(blankCanvasUrl);

    // Initialize conversation with a welcome message for the new canvas project
    const initialMessage: ChatMessage = {
      id: `canvas-init-${Date.now()}`,
      text: `Started a new canvas project: ${settings.name}`,
      sender: 'ai',
      imageData: blankCanvasUrl || undefined
    };
    setMessages([initialMessage]);
    
    // Update history immediately
    historyHook.createOrUpdateSession([initialMessage], {
      model: selectedModel,
      aspectRatio,
      guidanceScale,
      numImages
    });
  };

  const handleCanvasViewerImageUpdate = async (newImageUrl: string) => {
    // Keep track of updated messages to update history
    let updatedMessagesForHistory: ChatMessage[] | null = null;

    // Update the message with the new edited image
    setMessages(prevMessages => {
      const updated = prevMessages.map(msg => {
        if (msg.imageData && getImageUrlFromMessage(msg) === canvasViewerImageUrl) {
          // CRITICAL FIX: When updating the message with edited image,
          // we need to create a new image context for the edited version
          // so that follow-up requests use the edited image, not the original

          // If this message has an image context, we need to update it
          if (msg.imageContextId) {
            const existingContext = conversationImageState.contexts.get(msg.imageContextId);
            if (existingContext) {
              // Create a new context entry for the edited image
              // We'll generate new IDs since this is essentially a new image state
              const editedContextId = generateNextContextId();
              const editedContext: ImageContext = {
                id: editedContextId,
                description: `${existingContext.description} (edited)`,
                responseId: `edited_${Date.now()}`, // Temporary ID for edited images
                imageGenerationCallId: `edited_img_${Date.now()}`, // Temporary ID for edited images
                createdAt: Date.now(),
                lastModified: Date.now(),
                messageId: msg.id
              };

              // Add the new context
              setConversationImageState(prev => {
                const newContexts = new Map(prev.contexts);
                newContexts.set(editedContextId, editedContext);
                return {
                  ...prev,
                  contexts: newContexts
                };
              });

              console.log('🎨 Created new context for edited image:', {
                originalContextId: msg.imageContextId,
                newContextId: editedContextId,
                description: editedContext.description
              });

              // CRITICAL: Update main conversation response ID if this is the first image or if we don't have one
              if (!conversationImageState.conversationResponseId) {
                setConversationImageState(prev => ({
                  ...prev,
                  conversationResponseId: editedContext.responseId
                }));
                console.log('🎨 Updated main conversation response ID for edited image:', editedContext.responseId);
              }

              return {
                ...msg,
                imageData: newImageUrl,
                imageContextId: editedContextId, // Update to point to new context
                imageDescription: editedContext.description
              };
            }
          }

          return {
            ...msg,
            imageData: newImageUrl
          };
        }
        return msg;
      });
      
      updatedMessagesForHistory = updated;
      return updated;
    });

    // Update history immediately if we have messages
    if (updatedMessagesForHistory && updatedMessagesForHistory.length > 0) {
      historyHook.createOrUpdateSession(updatedMessagesForHistory);
    } else if (databaseHook.currentProject) {
      // If no messages but we have a project, update the project's timestamp in history
      historyHook.setGenerationHistory(prev => 
        prev.map(session => 
          session.id === databaseHook.currentProject?.id 
            ? { ...session, timestamp: Date.now() }
            : session
        )
      );
    }

    // Update the canvas viewer to show the new image
    setCanvasViewerImageUrl(newImageUrl);

    // Save canvas image to database project if authenticated and project exists
    if (databaseHook.isAuthenticated && databaseHook.currentProject) {
      console.log('💾 Saving canvas image to database project:', databaseHook.currentProject.id);
      try {
        // Preserve existing canvas metadata (width, height, etc.)
        const currentCanvasData = databaseHook.currentProject.canvas_data || {};
        
        const result = await imageStudioService.updateProject(
          databaseHook.currentProject.id,
          {
            status: 'completed',
            canvas_data: {
              ...currentCanvasData,
              imageData: newImageUrl, // Store base64 in JSONB field
              lastModified: Date.now()
            }
          }
        );

        if (result.success) {
          console.log('✅ Canvas image saved to database');
          
          // Also update the local project state in the hook to keep them in sync
          if (result.project) {
            databaseHook.updateCurrentProject(result.project);
          }
        } else {
          console.error('❌ Failed to save canvas image:', result.error);
        }
      } catch (error) {
        console.error('❌ Error saving canvas image:', error);
      }
    }
  };

  // Helper function to get image URL from message (needed for update handler)
  const getImageUrlFromMessage = (message: ChatMessage) => {
    if (!message.imageData) return '';
    
    if (message.imageData.startsWith('http://') || message.imageData.startsWith('https://')) {
      return message.imageData;
    }
    
    if (message.imageData.startsWith('data:')) {
      if (message.imageData.includes('data:image/svg+xml;base64,data:image/png;base64,')) {
        const pngMatch = message.imageData.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
        if (pngMatch && pngMatch[1]) {
          const pngBase64 = pngMatch[1].split('data:')[0];
          return `data:image/png;base64,${pngBase64}`;
        }
      }
      return message.imageData;
    }
    
    return `data:image/png;base64,${message.imageData}`;
  };

  // Update hasContentToSave function to include style reference
  const handleStyleSave = () => {
    if (activeStyleTab === 'image' && styleReferenceImage && styleImagePreview) {
      setSavedStyle({
        type: 'image',
        content: styleImagePreview, // Use the preview URL instead of file name
        name: styleReferenceImage.name
      });
    } else if (activeStyleTab === 'prompt' && stylePromptText.trim()) {
      setSavedStyle({
        type: 'prompt',
        content: stylePromptText.trim(),
        name: stylePromptText.slice(0, 20) + (stylePromptText.length > 20 ? '...' : '')
      });
    } else if (activeStyleTab === 'preset' && selectedStylePreset) {
      const presetNames = {
        'photorealistic': 'Photo',
        'artistic': 'Artistic',
        'vintage': 'Vintage',
        'cyberpunk': 'Cyber',
        'watercolor': 'Water',
        'minimalist': 'Minimal',
        'fantasy': 'Fantasy',
        'anime': 'Anime',
        'abstract': 'Abstract',
        'noir': 'Noir'
      };
      setSavedStyle({
        type: 'preset',
        content: selectedStylePreset,
        name: presetNames[selectedStylePreset as keyof typeof presetNames] || selectedStylePreset
      });
    }
    setIsStyleModalOpen(false);
  };

  // Check if current tab has content to save
  const hasContentToSave = () => {
    switch (activeStyleTab) {
      case 'image':
        return !!styleReferenceImage;
      case 'prompt':
        return !!stylePromptText.trim();
      case 'preset':
        return !!selectedStylePreset;
      default:
        return false;
    }
  };

  // Handle click outside to close modals
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Close attach menu
      if (
        isAttachMenuOpen &&
        attachMenuRef.current &&
        !attachMenuRef.current.contains(event.target as Node) &&
        attachButtonRef.current &&
        !attachButtonRef.current.contains(event.target as Node)
      ) {
        setIsAttachMenuOpen(false);
        setIsRecentFilesOpen(false);
      }

      // Close settings menu
      if (
        isSettingsOpen &&
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(event.target as Node) &&
        settingsButtonRef.current &&
        !settingsButtonRef.current.contains(event.target as Node)
      ) {
        setIsSettingsOpen(false);
      }

      // Close style modal
      if (
        isStyleModalOpen &&
        styleModalRef.current &&
        !styleModalRef.current.contains(event.target as Node) &&
        styleButtonRef.current &&
        !styleButtonRef.current.contains(event.target as Node)
      ) {
        setIsStyleModalOpen(false);
      }

      // Close canvas modal
      if (
        isCanvasModalOpen &&
        canvasModalRef.current &&
        !canvasModalRef.current.contains(event.target as Node) &&
        canvasButtonRef.current &&
        !canvasButtonRef.current.contains(event.target as Node)
      ) {
        setIsCanvasModalOpen(false);
      }
      
      // Close canvas action menu
      if (
        isCanvasActionMenuOpen &&
        canvasActionMenuRef.current &&
        !canvasActionMenuRef.current.contains(event.target as Node) &&
        canvasButtonRef.current &&
        !canvasButtonRef.current.contains(event.target as Node)
      ) {
        setIsCanvasActionMenuOpen(false);
      }

      // Close model dropdown
      if (
        isModelDropdownOpen &&
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(event.target as Node) &&
        modelButtonRef.current &&
        !modelButtonRef.current.contains(event.target as Node)
      ) {
        setIsModelDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isAttachMenuOpen, isSettingsOpen, isStyleModalOpen, isCanvasModalOpen, isCanvasActionMenuOpen, isModelDropdownOpen]);

  // Canvas interaction derived state
  const isCanvasModeActive = isCanvasActionMenuOpen || isCanvasProjectSettingsOpen || isCanvasViewerOpen || isCanvasOpen;

  // Extract the exact UI structure from the original file
  return (
    <>
      {/* Dynamic Glowing Border Styles and Tool Animations */}
      <style>{`
        .bento-card-container {
          position: relative;
        }
        
        .bento-card-container::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 1rem;
          padding: 2px;
          background: radial-gradient(
            circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
            rgba(255, 107, 53, 1) 0%,
            rgba(255, 107, 53, 0.3) 20%,
            transparent 50%
          );
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: exclude;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          opacity: 0;
          transition: opacity 0.3s ease;
          pointer-events: none;
          z-index: -1;
        }
        
        .bento-card-container:hover::before {
          opacity: 1;
        }

        /* Slider Styles */
        input[type="range"].slider::-webkit-slider-thumb {
          appearance: none;
          height: 16px;
          width: 16px;
          border-radius: 50%;
          background: #3b82f6;
          border: 2px solid #ffffff;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        input[type="range"].slider::-webkit-slider-track {
          height: 4px;
          border-radius: 2px;
          background: #4b5563;
          border: none;
        }
      `}</style>
      
  <div className="w-full h-full flex flex-col relative">
    {/* Canvas Interaction Blur Overlay - Persistent to prevent flicker */}
    <div 
      className="absolute top-0 left-0 w-full h-full z-[100]"
      style={{ 
        opacity: isCanvasModeActive ? 1 : 0,
        pointerEvents: isCanvasModeActive ? 'auto' : 'none',
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: isCanvasModeActive ? 'blur(8px) grayscale(1)' : 'none',
        WebkitBackdropFilter: isCanvasModeActive ? 'blur(8px) grayscale(1)' : 'none',
        transition: 'opacity 500ms ease-in-out'
      }}
      onClick={() => {
        if (isCanvasActionMenuOpen && !isCanvasProjectSettingsOpen && !isCanvasViewerOpen) {
          setIsCanvasActionMenuOpen(false);
        }
      }}
    />
        {messages.length === 0 ? (
          /* Centered Input Container - Initial State */
          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-4xl px-4 relative">
              {/* Header Text */}
              <div className="text-center mb-8">
                <h1 className="text-4xl font-bold text-white mb-2">Xeno Studio v2</h1>
                <p className="text-lg text-white/70">Create and edit with AI</p>
              </div>

              {/* Main Input Container - Enhanced with CSS Variables and Accessibility */}
              <section 
                ref={inputContainerRef}
                className="bg-[#19191a] border border-[#3a3a3d] rounded-2xl pb-6 px-6 pt-[1.75rem] shadow-2xl relative"
                style={{
                  '--base-radius': '16px',
                  '--inner-radius': '12px', 
                  '--button-radius': '8px',
                  '--small-radius': '4px',
                  '--spacing-xs': '0.5rem',
                  '--spacing-sm': '0.75rem', 
                  '--spacing-md': '1rem',
                  '--spacing-lg': '1.5rem'
                } as React.CSSProperties}
                role="region"
                aria-label="Image generation interface"
              >
                {/* Style Reference and Attached Files Row */}
                {(savedStyle || attachedFiles.length > 0) && (
                  <div className="flex items-center gap-2 mb-4 flex-wrap">
                                          {/* Style Reference Display */}
                      {savedStyle && (
                        <div className="flex items-center gap-1.5 relative group p-0.5">
                          {savedStyle.type === 'image' ? (
                            <img 
                              src={savedStyle.content} 
                              alt="Style reference" 
                              className="w-10 h-10 rounded object-cover flex-shrink-0 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out cursor-pointer"
                              onClick={() => {
                                setFullScreenImageUrl(savedStyle.content);
                                setIsFullScreenImageOpen(true);
                                setViewerShowsDownloadButton(false);
                              }}
                            />
                          ) : savedStyle.type === 'prompt' ? (
                            <div className="w-auto h-10 rounded flex items-center gap-1.5 px-2 bg-purple-600/20 border-2 border-purple-500/30 group-hover:border-purple-500/50 transition-colors duration-150 ease-in-out text-sm text-purple-200 cursor-pointer">
                              <Type size={16} className="text-purple-400" />
                              <span className="truncate max-w-32" title={savedStyle.content}>{savedStyle.name}</span>
                            </div>
                          ) : savedStyle.type === 'preset' ? (
                            <div className="w-auto h-10 rounded flex items-center gap-1.5 px-2 bg-blue-600/20 border-2 border-blue-500/30 group-hover:border-blue-500/50 transition-colors duration-150 ease-in-out text-sm text-blue-200 cursor-pointer">
                              <Palette size={16} className="text-blue-400" />
                              <span className="truncate" title={savedStyle.content}>{savedStyle.name}</span>
                            </div>
                          ) : null}
                          <button 
                            onClick={handleClearAllStyle}
                            className="w-5 h-5 flex items-center justify-center rounded-sm bg-zinc-700 hover:bg-zinc-600 text-white opacity-0 group-hover:opacity-100 absolute top-[-2px] right-[-2px] transition-opacity duration-150 ease-in-out flex-shrink-0"
                            aria-label="Remove style"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )}
                    
                    {/* Attached Files */}
                    {attachedFiles.map((file) => (
                      <div 
                        key={file.id}
                        className="flex items-center gap-1.5 relative group p-0.5"
                      >
                        {file.fileObject && file.type.startsWith('image/') ? (
                          <img 
                            src={URL.createObjectURL(file.fileObject)} 
                            alt={file.name} 
                            className="w-10 h-10 rounded object-cover flex-shrink-0 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out cursor-pointer"
                          />
                        ) : (
                          <div className="w-auto h-10 rounded flex items-center gap-1.5 px-2 bg-zinc-700/50 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out text-sm text-gray-200 cursor-pointer">
                            <FileText size={16} className="text-blue-400" />
                            <span className="truncate" title={file.name}>{file.name}</span>
                          </div>
                        )}
                        <button 
                          onClick={() => setAttachedFiles(prev => prev.filter(f => f.id !== file.id))}
                          className="w-5 h-5 flex items-center justify-center rounded-sm bg-zinc-700 hover:bg-zinc-600 text-white opacity-0 group-hover:opacity-100 absolute top-[-2px] right-[-2px] transition-opacity duration-150 ease-in-out flex-shrink-0"
                          aria-label="Remove file"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Input Form */}
                <form onSubmit={(e) => {
                  e.preventDefault();
                  if (inputValue.trim() && !isGenerating) {
                    handleGenerate();
                  }
                }} className="space-y-4">
                  
                  {/* Textarea Container with Enhanced Accessibility */}
                  <div className="relative">
                    <label htmlFor="content-input" className="sr-only">
                      Describe what you want to create
                    </label>
                    <textarea
                      id="content-input"
                      ref={textareaRef}
                      placeholder="Describe what you want to create..."
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (inputValue.trim() && !isGenerating) {
                            handleGenerate();
                          }
                        }
                      }}
                      className="
                        w-full bg-transparent text-white placeholder-gray-400 
                        px-4 py-4 pr-14 
                        outline-none resize-none 
                        border border-transparent
                        focus:border-[#4a4a4d] focus:bg-[#1e1e1f]
                        transition-all duration-200
                        text-base leading-relaxed
                        scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent
                      "
                      style={{ 
                        minHeight: '3.5rem', 
                        maxHeight: '9.75rem',
                        borderRadius: 'var(--inner-radius, 8px)'
                      }}
                      disabled={isGenerating}
                      rows={1}
                      aria-describedby="content-input-help"
                    />
                    <div id="content-input-help" className="sr-only">
                      Press Enter to generate, Shift+Enter for new line
                    </div>
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleHistory();
                      }}
                      className={`
                        absolute top-3 right-3 p-2 
                        transition-all duration-200
                        ${historyHook.isHistoryOpen 
                          ? 'text-white bg-zinc-700/70 shadow-sm' 
                          : 'text-gray-400 hover:text-white hover:bg-zinc-700/30'
                        }
                      `}
                      style={{ borderRadius: 'var(--small-radius, 2px)' }}
                      aria-label="Toggle history panel"
                      aria-expanded={historyHook.isHistoryOpen}
                    >
                      <Clock size={18} />
                    </button>
                  </div>
                 
                  {/* Controls Row */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {/* Attach Button */}
                      <div className="relative">
                        <button 
                          type="button"
                          ref={attachButtonRef}
                          onClick={toggleAttachMenu}
                          className="
                            flex items-center justify-center 
                            bg-[#19191a] border border-[#3a3a3d] 
                            p-2.5 text-gray-300 
                            hover:border-gray-500 hover:text-white hover:bg-[#1e1e1f]
                            focus:border-gray-500 focus:text-white focus:outline-none
                            transition-all duration-200 shadow-sm
                          "
                          style={{ borderRadius: 'var(--button-radius, 4px)' }}
                          aria-label="Attach reference files"
                          aria-expanded={isAttachMenuOpen}
                          aria-haspopup="menu"
                        >
                          <ImageIcon size={16} />
                        </button>

                        {/* Attach Menu Modal */}
                        <div 
                          ref={attachMenuRef}
                          className={`
                            absolute bottom-full left-0 mb-2 z-30 
                            w-64 bg-[#19191a] border border-[#3a3a3d] shadow-xl 
                            transition-all duration-200 ease-out origin-bottom-left 
                            ${
                              isAttachMenuOpen 
                                ? 'opacity-100 scale-100 visible' 
                                : 'opacity-0 scale-95 invisible' 
                            }
                          `}
                          style={{ borderRadius: 'var(--base-radius, 16px)' }}
                        >
                          <div className="p-2 space-y-1">
                            <button 
                              onClick={handleUploadFile} 
                              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-zinc-700/50 text-left"
                              style={{ borderRadius: 'var(--button-radius, 4px)' }}
                            >
                              <Upload size={18} />
                              <span>Upload an image</span>
                            </button>
                            <button 
                              disabled 
                              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-500 cursor-not-allowed text-left"
                              style={{ borderRadius: 'var(--button-radius, 4px)' }}
                            >
                              <Link size={18} className="text-gray-600" />
                              <span>Connect Google Drive</span>
                              <span className="ml-auto text-xs text-gray-600">Soon</span>
                            </button>
                            <button 
                              disabled 
                              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-500 cursor-not-allowed text-left"
                              style={{ borderRadius: 'var(--button-radius, 4px)' }}
                            >
                              <Link size={18} className="text-gray-600" />
                              <span>Connect Microsoft OneDrive</span>
                              <span className="ml-auto text-xs text-gray-600">Soon</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Canvas Button + Inline Action Buttons (VideoStudio-style) */}
                      <div className={`relative flex items-center gap-2 ${isCanvasActionMenuOpen ? 'z-[101]' : ''}`}>
                        <button
                          ref={canvasButtonRef}
                          onClick={handleCanvasButtonClick}
                          onMouseEnter={() => setIsCanvasHovered(true)}
                          onMouseLeave={() => setIsCanvasHovered(false)}
                          className="flex h-10 w-10 items-center justify-center bg-[#19191a] border border-[#3a3a3d] text-gray-300 hover:border-gray-500 hover:text-white transition-colors shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shrink-0"
                          style={{ borderRadius: 'var(--button-radius, 4px)' }}
                        >
                          <Layers size={16} />
                        </button>

                        {/* Hover Text */}
                        {!isCanvasActionMenuOpen && (
                          <div 
                            className={`absolute left-12 whitespace-nowrap text-xs text-white/50 transition-all duration-300 pointer-events-none ${isCanvasHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'}`}
                          >
                            Use project Canvas for studio like editing experience
                          </div>
                        )}
                        
                        {isCanvasActionMenuOpen && !isCanvasOpen && (
                          <div 
                            ref={canvasActionMenuRef}
                            className="flex items-center gap-2"
                          >
                            {/* Open Existing (if any) */}
                            {hasCanvasProject && (
                              <button
                                onClick={() => {
                                  setIsCanvasOpen(true);
                                  setIsCanvasActionMenuOpen(false);
                                }}
                                className="flex h-10 px-4 items-center justify-center bg-[#19191a] border border-[#3a3a3d] text-gray-300 hover:border-gray-500 hover:text-white transition-colors shadow-inner text-xs font-medium animate-in fade-in slide-in-from-left-2 duration-300 fill-mode-both"
                                style={{ borderRadius: 'var(--button-radius, 4px)', animationDelay: '0ms' }}
                              >
                                <Layers size={14} className="mr-2" />
                                <span>Open Existing</span>
                              </button>
                            )}

                            {/* New Project Button */}
                            <button
                              onClick={handleStartNewProject}
                              className="flex h-10 px-4 items-center justify-center bg-[#19191a] border border-[#3a3a3d] text-gray-300 hover:border-gray-500 hover:text-white transition-colors shadow-inner text-xs font-medium animate-in fade-in slide-in-from-left-2 duration-300 fill-mode-both"
                              style={{ borderRadius: 'var(--button-radius, 4px)', animationDelay: '100ms' }}
                            >
                              <Plus size={14} className="mr-2" />
                              <span>Create Project</span>
                            </button>
                            
                            {/* Upload Image Button */}
                            <button
                              onClick={() => {
                                setIsCanvasActionMenuOpen(false);
                                canvasFileInputRef.current?.click();
                              }}
                              className="flex h-10 px-4 items-center justify-center bg-[#19191a] border border-[#3a3a3d] text-gray-300 hover:border-gray-500 hover:text-white transition-colors shadow-inner text-xs font-medium animate-in fade-in slide-in-from-left-2 duration-300 fill-mode-both"
                              style={{ borderRadius: 'var(--button-radius, 4px)', animationDelay: '200ms' }}
                            >
                              <Upload size={14} className="mr-2" />
                              <span>Upload Image</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Model Selection Dropdown */}
                      <div className="relative">
                        <button 
                          ref={modelButtonRef}
                          onClick={toggleModelDropdown}
                          className="flex items-center gap-2 px-3 py-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg text-gray-300 hover:border-gray-500 hover:text-white transition-colors text-sm"
                        >
                          <span>{selectedModel === 'gpt-image-1' ? 'GPT Image 1' : 'Flux Kontext'}</span>
                          <ChevronDown size={14} className={`transition-transform duration-200 ${isModelDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {/* Model Dropdown */}
                        <div 
                          ref={modelDropdownRef}
                          className={`
                            absolute bottom-full left-0 mb-2 z-30 
                            w-40 bg-[#19191a] border border-[#3a3a3d] rounded-lg shadow-xl 
                            transition-all duration-200 ease-out origin-bottom-left 
                            ${isModelDropdownOpen 
                              ? 'opacity-100 scale-100 visible' 
                              : 'opacity-0 scale-95 invisible' 
                            }
                          `}
                        >
                          <div className="p-1">
                            <button 
                              onClick={() => handleModelSelect('gpt-image-1')}
                              className={`w-full flex items-center px-3 py-2 text-sm rounded-md text-left transition-colors ${
                                selectedModel === 'gpt-image-1' 
                                  ? 'bg-white text-black' 
                                  : 'text-gray-300 hover:bg-zinc-700/50'
                              }`}
                            >
                              GPT Image 1
                            </button>
                            <button 
                              onClick={() => handleModelSelect('flux-kontext')}
                              className={`w-full flex items-center px-3 py-2 text-sm rounded-md text-left transition-colors ${
                                selectedModel === 'flux-kontext' 
                                  ? 'bg-white text-black' 
                                  : 'text-gray-300 hover:bg-zinc-700/50'
                              }`}
                            >
                              Flux Kontext
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Generate Button */}
                      <button 
                        onClick={handleGenerate}
                        disabled={!inputValue.trim() || isGenerating}
                        className="bg-white text-black px-4 py-2 font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-10 flex items-center justify-center shadow-md"
                        style={{ borderRadius: 'var(--button-radius, 4px)' }}
                        aria-label="Generate image"
                      >
                        {isGenerating ? (
                          <>
                            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mr-1.5" />
                            <span>Generating...</span>
                          </>
                        ) : (
                          <>
                            <Send size={16} className="mr-1.5" />
                            <span>Generate</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </form>

                {/* History Panel - Dropdown below input container */}
                <HistoryPanel
                  isHistoryOpen={historyHook.isHistoryOpen}
                  sessions={historyHook.generationHistory}
                  activeSessionId={historyHook.activeSessionId}
                  searchTerm={historyHook.historySearchTerm}
                  onSearchChange={historyHook.setHistorySearchTerm}
                  onToggleHistory={historyHook.toggleHistory}
                  onLoadSession={handleLoadSessionWrapper}
                  editingSessionId={historyHook.editingSessionId}
                  editTitleText={historyHook.editTitleText}
                  onStartEdit={(sessionId, currentTitle) => {
                    historyHook.setEditingSessionId(sessionId);
                    historyHook.setEditTitleText(currentTitle);
                  }}
                  onSaveEdit={historyHook.handleSaveSessionTitle}
                  onCancelEdit={() => {
                    historyHook.setEditingSessionId(null);
                    historyHook.setEditTitleText('');
                  }}
                  onEditTitleChange={historyHook.setEditTitleText}
                  onDeleteSession={(sessionId, sessionTitle) => {
                    historyHook.setDeleteConfirmationModal({
                      isOpen: true,
                      sessionId,
                      sessionTitle
                    });
                  }}
                  onDeleteMultipleSessions={(sessionIds) => {
                    historyHook.handleDeleteMultipleSessions(sessionIds);
                  }}
                  position="below"
                />
              </section>
            </div>
          </div>
        ) : (
          /* Chat Interface - After first message */
          <>
            <ChatMessages 
              messages={messages}
              messagesContainerRef={messagesContainerRef}
              editingMessageId={editingMessageId}
              editText={editText}
              setEditText={setEditText}
              editInputRef={editInputRef}
              handleCancelEdit={handleCancelEdit}
              handleSaveEdit={handleSaveEdit}
              handleEditUserMessage={handleEditUserMessage}
              handleCopyUserMessage={handleCopyUserMessage}
              copiedMessageId={copiedMessageId}
              showThinkingId={showThinkingId}
              setShowThinkingId={setShowThinkingId}
              handleCopy={handleCopy}
              handleLike={handleLike}
              handleDislike={handleDislike}
              feedbackStatusMap={Object.fromEntries(
                Object.entries(feedbackStatusMap).filter(([_, value]) => value !== null)
              ) as Record<string, 'liked' | 'disliked'>}
              setCanvasViewerImageUrl={setCanvasViewerImageUrl}
              setIsCanvasViewerOpen={setIsCanvasViewerOpen}
              urlCache={urlCache}
              renderImageContainer={renderImageContainer}
            />
            
            {/* Bottom Input Container */}
            <div className="p-4">
              <div className="max-w-4xl mx-auto">
              <div
                className="relative bg-[#19191a] border border-[#3a3a3d] rounded-2xl p-4 shadow-lg"
                style={{
                  '--base-radius': '16px',
                  '--inner-radius': '12px',
                  '--button-radius': '8px',
                  '--small-radius': '4px',
                  '--spacing-xs': '0.5rem',
                  '--spacing-sm': '0.75rem',
                  '--spacing-md': '1rem',
                  '--spacing-lg': '1.5rem'
                } as React.CSSProperties}
              >
                  
                  {/* History Panel for Conversation Mode */}
                  <HistoryPanel
                    isHistoryOpen={historyHook.isHistoryOpen}
                    sessions={historyHook.generationHistory}
                    activeSessionId={historyHook.activeSessionId}
                    searchTerm={historyHook.historySearchTerm}
                    onSearchChange={historyHook.setHistorySearchTerm}
                    onToggleHistory={historyHook.toggleHistory}
                    onLoadSession={handleLoadSessionWrapper}
                    editingSessionId={historyHook.editingSessionId}
                    editTitleText={historyHook.editTitleText}
                    onStartEdit={(sessionId, currentTitle) => {
                      historyHook.setEditingSessionId(sessionId);
                      historyHook.setEditTitleText(currentTitle);
                    }}
                    onSaveEdit={historyHook.handleSaveSessionTitle}
                    onCancelEdit={() => {
                      historyHook.setEditingSessionId(null);
                      historyHook.setEditTitleText('');
                    }}
                    onEditTitleChange={historyHook.setEditTitleText}
                    onDeleteSession={(sessionId, sessionTitle) => {
                      historyHook.setDeleteConfirmationModal({
                        isOpen: true,
                        sessionId,
                        sessionTitle
                      });
                    }}
                    onDeleteMultipleSessions={(sessionIds) => {
                      historyHook.handleDeleteMultipleSessions(sessionIds);
                    }}
                    position="above"
                  />
                  
                  {/* Style Tag and Attached Files Display */}
                  {(savedStyle || attachedFiles.length > 0) && (
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      {/* Style Reference Display */}
                      {savedStyle && (
                        <div className="flex items-center gap-1.5 relative group p-0.5">
                          {savedStyle.type === 'image' ? (
                            <img 
                              src={savedStyle.content} 
                              alt="Style reference" 
                              className="w-10 h-10 rounded object-cover flex-shrink-0 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out cursor-pointer"
                              onClick={() => {
                                setFullScreenImageUrl(savedStyle.content);
                                setIsFullScreenImageOpen(true);
                                setViewerShowsDownloadButton(false);
                              }}
                            />
                          ) : savedStyle.type === 'prompt' ? (
                            <div className="w-auto h-10 rounded flex items-center gap-1.5 px-2 bg-purple-600/20 border-2 border-purple-500/30 group-hover:border-purple-500/50 transition-colors duration-150 ease-in-out text-sm text-purple-200 cursor-pointer">
                              <Type size={16} className="text-purple-400" />
                              <span className="truncate max-w-32" title={savedStyle.content}>{savedStyle.name}</span>
                            </div>
                          ) : savedStyle.type === 'preset' ? (
                            <div className="w-auto h-10 rounded flex items-center gap-1.5 px-2 bg-blue-600/20 border-2 border-blue-500/30 group-hover:border-blue-500/50 transition-colors duration-150 ease-in-out text-sm text-blue-200 cursor-pointer">
                              <Palette size={16} className="text-blue-400" />
                              <span className="truncate" title={savedStyle.content}>{savedStyle.name}</span>
                            </div>
                          ) : null}
                          <button 
                            onClick={handleClearAllStyle}
                            className="w-5 h-5 flex items-center justify-center rounded-sm bg-zinc-700 hover:bg-zinc-600 text-white opacity-0 group-hover:opacity-100 absolute top-[-2px] right-[-2px] transition-opacity duration-150 ease-in-out flex-shrink-0"
                            aria-label="Remove style"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )}
                      
                      {/* Attached Files */}
                      {attachedFiles.map((file) => (
                        <div 
                          key={file.id}
                          className="flex items-center gap-1.5 relative group p-0.5"
                        >
                          {file.fileObject && file.type.startsWith('image/') ? (
                            <img 
                              src={URL.createObjectURL(file.fileObject)} 
                              alt={file.name} 
                              className="w-10 h-10 rounded object-cover flex-shrink-0 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out cursor-pointer"
                            />
                          ) : (
                            <div className="w-auto h-10 rounded flex items-center gap-1.5 px-2 bg-zinc-700/50 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out text-sm text-gray-200 cursor-pointer">
                              <FileText size={16} className="text-blue-400" />
                              <span className="truncate" title={file.name}>{file.name}</span>
                            </div>
                          )}
                          <button 
                            onClick={() => setAttachedFiles(prev => prev.filter(f => f.id !== file.id))}
                            className="w-5 h-5 flex items-center justify-center rounded-sm bg-zinc-700 hover:bg-zinc-600 text-white opacity-0 group-hover:opacity-100 absolute top-[-2px] right-[-2px] transition-opacity duration-150 ease-in-out flex-shrink-0"
                            aria-label="Remove file"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Textarea Row */}
                  <div className="flex items-end relative">
                    <div className="flex-1 relative">
                      <textarea
                        ref={textareaRef}
                        placeholder="Continue the conversation..."
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (inputValue.trim() && !isGenerating) {
                              handleGenerate();
                            }
                          }
                        }}
                        className="w-full bg-transparent text-white placeholder-gray-400 pl-2 pr-12 py-2 outline-none resize-none focus:ring-0 border-none focus:outline-none focus:shadow-none text-base scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent"
                        style={{ maxHeight: '155px' }}
                        disabled={isGenerating}
                      />
                      <button 
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleHistory();
                        }}
                        className={`absolute top-1 right-1 w-10 h-10 inline-flex items-center justify-center transition-colors z-20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                          historyHook.isHistoryOpen 
                            ? 'text-white bg-zinc-700/50' 
                            : 'text-gray-400 hover:text-white hover:bg-gray-700/30'
                        }`}
                        style={{ borderRadius: 'var(--button-radius, 4px)', pointerEvents: 'auto' }}
                        aria-label="Toggle History"
                        type="button"
                        aria-controls="history-panel"
                      >
                        <Clock size={18} />
                      </button>
                    </div>
                  </div>
                  
                  {/* Controls Row */}
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2 relative">
                      {/* Attach Button */}
                      <div className="relative">
                        <button 
                          ref={attachButtonRef}
                          onClick={toggleAttachMenu}
                          className="flex h-10 w-10 items-center justify-center bg-[#19191a] border border-[#3a3a3d] text-gray-300 hover:border-gray-500 hover:text-white transition-colors shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                          style={{ borderRadius: 'var(--button-radius, 4px)' }}
                          aria-label="Attach file"
                          title="Attach reference images"
                        >
                          <ImageIcon size={16} />
                        </button>

                        {/* Attach Menu Modal */}
                        <div 
                          ref={attachMenuRef}
                          className={`
                            absolute bottom-full left-0 mb-2 z-30 
                            w-64 bg-[#19191a] border border-[#3a3a3d] shadow-xl 
                            transition-all duration-200 ease-out origin-bottom-left 
                            ${isAttachMenuOpen 
                              ? 'opacity-100 scale-100 visible' 
                              : 'opacity-0 scale-95 invisible' 
                            }
                          `}
                          style={{ borderRadius: 'var(--inner-radius, 12px)' }}
                          role="menu"
                        >
                          <div className="p-2 space-y-1">
                            <button onClick={handleUploadFile} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-zinc-700/50 transition-colors text-left" style={{ borderRadius: 'var(--button-radius, 4px)' }} role="menuitem">
                              <FolderUp size={18} />
                              <span>Upload an image</span>
                            </button>
                            <button onClick={handleConnectDrive} disabled className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-500 cursor-not-allowed transition-colors text-left" style={{ borderRadius: 'var(--button-radius, 4px)' }} role="menuitem">
                              <Link size={18} className="text-gray-600" />
                              <span>Connect Google Drive</span>
                              <span className="ml-auto text-xs text-gray-600">Soon</span>
                            </button>
                            <button onClick={handleConnectOneDrive} disabled className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-500 cursor-not-allowed transition-colors text-left" style={{ borderRadius: 'var(--button-radius, 4px)' }} role="menuitem">
                              <Link size={18} className="text-gray-600" />
                              <span>Connect Microsoft OneDrive</span>
                              <span className="ml-auto text-xs text-gray-600">Soon</span>
                            </button>
                            <button onClick={handleShowRecent} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-zinc-700/50 transition-colors text-left" style={{ borderRadius: 'var(--button-radius, 4px)' }} role="menuitem">
                              <FileClock size={18} />
                              <span>Recent files</span>
                            </button>

                            {/* Recent Files Panel */}
                            {isRecentFilesOpen && (
                              <div 
                                ref={recentFilesPanelRef}
                                className="mt-3 pt-3 border-t border-gray-600"
                              >
                                <div className="text-xs text-gray-400 mb-2">Recent Files</div>
                                {recentFiles.length === 0 ? (
                                  <div className="text-xs text-gray-500 py-2">
                                    No recent files
                                  </div>
                                ) : (
                                  <div className="space-y-1 max-h-32 overflow-y-auto">
                                    {recentFiles.filter(file => file.type.startsWith('image/')).map((file: RecentFile) => (
                                      <div key={file.id} className="flex items-center justify-between p-2 hover:bg-zinc-700/50 transition-colors text-xs" style={{ borderRadius: 'var(--small-radius, 2px)' }}>
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                          <FileText size={12} />
                                          <span className="truncate">{file.name}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <button
                                            onClick={() => handleReattachRecentFile(file)}
                                            className="p-1 text-gray-400 hover:text-white"
                                            title="Reattach"
                                          >
                                            <Plus size={12} />
                                          </button>
                                          <button
                                            onClick={() => handleRemoveRecentFile(file.id)}
                                            className="p-1 text-gray-400 hover:text-red-400"
                                            title="Remove"
                                          >
                                            <X size={12} />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Style Button */}
                      <div className="relative order-2">
                        <button 
                          ref={styleButtonRef}
                          onClick={toggleStyleModal}
                          className="flex h-10 w-10 items-center justify-center bg-[#19191a] border border-[#3a3a3d] text-gray-300 hover:border-gray-500 hover:text-white transition-colors shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                          style={{ borderRadius: 'var(--button-radius, 4px)' }}
                          aria-label="Style reference"
                          title="Add style reference"
                        >
                          <Palette size={16} />
                        </button>

                        {/* Style Modal */}
                        <div 
                          ref={styleModalRef}
                          className={`
                            absolute bottom-full right-0 mb-2 z-30 
                            w-80 h-80 bg-[#19191a] border border-[#3a3a3d] shadow-xl 
                            transition-all duration-200 ease-out origin-bottom-right 
                            ${isStyleModalOpen 
                              ? 'opacity-100 scale-100 visible' 
                              : 'opacity-0 scale-95 invisible' 
                            }
                          `}
                           style={{ borderRadius: 'var(--inner-radius, 12px)' }}
                        >
                          {/* Header with Tab Buttons */}
                          <div className="flex border-b border-[#3a3a3d] rounded-t-lg overflow-hidden">
                            {[
                              { key: 'image', label: 'Image' },
                              { key: 'prompt', label: 'Prompt' },
                              { key: 'preset', label: 'Preset' }
                            ].map((tab) => (
                              <button
                                key={tab.key}
                                onClick={() => setActiveStyleTab(tab.key as 'image' | 'prompt' | 'preset')}
                                className={`flex-1 py-2 px-3 text-xs font-medium transition-colors relative ${
                                  activeStyleTab === tab.key
                                    ? 'bg-white text-black'
                                    : 'text-gray-400 hover:text-gray-200 hover:bg-zinc-700/50'
                                }`}
                              >
                                {tab.label}
                                {/* Save icon - shows when this tab is active and has content */}
                                {activeStyleTab === tab.key && hasContentToSave() && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStyleSave();
                                    }}
                                    className="absolute right-1 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-200 rounded transition-colors"
                                    title="Save style"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                                      <polyline points="17,21 17,13 7,13 7,21"/>
                                      <polyline points="7,3 7,8 15,8"/>
                                    </svg>
                                  </button>
                                )}
                              </button>
                            ))}
                          </div>

                          <div className="p-4 h-[calc(100%-48px)] pb-4">
                            {/* Image Tab */}
                            {activeStyleTab === 'image' && (
                              <div 
                                className="w-full h-full relative"
                                onDragOver={handleStyleDragOver}
                                onDrop={handleStyleDrop}
                              >
                                {styleImagePreview ? (
                                  // Show uploaded image
                                  <div className="relative w-full h-full group">
                                    <img 
                                      src={styleImagePreview}
                                      alt="Style reference"
                                      className="w-full h-full object-cover rounded-lg border border-[#3a3a3d] cursor-pointer"
                                      onClick={() => {
                                        setFullScreenImageUrl(styleImagePreview);
                                        setIsFullScreenImageOpen(true);
                                        setViewerShowsDownloadButton(false);
                                      }}
                                    />
                                    <button
                                      onClick={handleRemoveStyleImage}
                                      className="absolute top-2 right-2 p-1.5 bg-black/70 rounded-full text-white/80 hover:text-white hover:bg-black/90 opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Remove style image"
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                ) : (
                                  // Show upload area
                                  <div 
                                    className="w-full h-full border-2 border-dashed border-[#3a3a3d] rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-gray-500 transition-colors"
                                    onClick={handleStyleImageUpload}
                                  >
                                    <ImageIcon size={32} className="text-gray-400 mb-3" />
                                    <p className="text-sm text-gray-300 text-center px-4 leading-relaxed">
                                      Upload or drag an image into this area to be used as style reference for your image
                                    </p>
                                    <p className="text-xs text-gray-500 mt-2">Click to browse files</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Prompt Tab */}
                            {activeStyleTab === 'prompt' && (
                              <div className="w-full h-full flex flex-col">
                                <label className="text-sm font-medium text-gray-300 mb-2">Style Description</label>
                                <textarea
                                  value={stylePromptText}
                                  onChange={(e) => setStylePromptText(e.target.value)}
                                  placeholder="Describe the style you want to apply (e.g., 'oil painting', 'cyberpunk', 'watercolor')..."
                                  className="flex-1 bg-[#2a2a2b] border border-[#3a3a3d] rounded-lg px-3 py-2 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-gray-500"
                                />
                              </div>
                            )}

                            {/* Preset Tab */}
                            {activeStyleTab === 'preset' && (
                              <div className="w-full h-full overflow-y-auto">
                                <div className="grid grid-cols-2 gap-2">
                                  {[
                                    { id: 'photorealistic', name: 'Photo', gradient: 'from-blue-500 to-green-500' },
                                    { id: 'artistic', name: 'Artistic', gradient: 'from-purple-500 to-pink-500' },
                                    { id: 'vintage', name: 'Vintage', gradient: 'from-amber-600 to-orange-500' },
                                    { id: 'cyberpunk', name: 'Cyber', gradient: 'from-cyan-500 to-purple-600' },
                                    { id: 'watercolor', name: 'Water', gradient: 'from-blue-300 to-indigo-400' },
                                    { id: 'minimalist', name: 'Minimal', gradient: 'from-gray-400 to-gray-600' },
                                    { id: 'fantasy', name: 'Fantasy', gradient: 'from-emerald-400 to-purple-500' },
                                    { id: 'anime', name: 'Anime', gradient: 'from-pink-400 to-rose-500' },
                                    { id: 'abstract', name: 'Abstract', gradient: 'from-red-500 to-yellow-500' },
                                    { id: 'noir', name: 'Noir', gradient: 'from-gray-800 to-black' }
                                  ].map((preset) => (
                                    <button
                                      key={preset.id}
                                      onClick={() => setSelectedStylePreset(preset.id)}
                                      className={`p-2 text-left rounded-lg border transition-colors ${
                                        selectedStylePreset === preset.id
                                          ? 'border-purple-500 bg-purple-500/20 text-white'
                                          : 'border-[#3a3a3d] bg-[#2a2a2b] text-gray-300 hover:border-gray-500 hover:bg-[#3a3a3b]'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        {/* Style Preview Square */}
                                        <div className={`w-6 h-6 rounded bg-gradient-to-br ${preset.gradient} flex-shrink-0`}></div>
                                        {/* Style Name */}
                                        <div className="font-medium text-xs">{preset.name}</div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Canvas Button + Inline Action Buttons (VideoStudio-style) */}
                      <div className={`relative order-1 flex items-center gap-2 ${isCanvasActionMenuOpen ? 'z-[101]' : ''}`}>
                        <button 
                          ref={canvasButtonRef}
                          onClick={handleCanvasButtonClick}
                          onMouseEnter={() => setIsCanvasHovered(true)}
                          onMouseLeave={() => setIsCanvasHovered(false)}
                          className="flex h-10 w-10 items-center justify-center bg-[#19191a] border border-[#3a3a3d] text-gray-300 hover:border-gray-500 hover:text-white transition-colors shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shrink-0"
                          style={{ borderRadius: 'var(--button-radius, 4px)' }}
                          aria-label="Canvas mode"
                        >
                          <Layers size={16} />
                        </button>

                        {/* Hover Text */}
                        {!isCanvasActionMenuOpen && (
                          <div 
                            className={`absolute left-12 whitespace-nowrap text-xs text-white/50 transition-all duration-300 pointer-events-none ${isCanvasHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'}`}
                          >
                            Use project Canvas for studio like editing experience
                          </div>
                        )}
                        
                        {isCanvasActionMenuOpen && !isCanvasOpen && (
                          <div 
                            ref={canvasActionMenuRef}
                            className="flex items-center gap-2"
                          >
                            {/* Open Existing (if any) */}
                            {hasCanvasProject && (
                              <button
                                onClick={() => {
                                  setIsCanvasOpen(true);
                                  setIsCanvasActionMenuOpen(false);
                                }}
                                className="flex h-10 px-4 items-center justify-center bg-[#19191a] border border-[#3a3a3d] text-gray-300 hover:border-gray-500 hover:text-white transition-colors shadow-inner text-xs font-medium animate-in fade-in slide-in-from-left-2 duration-300 fill-mode-both"
                                style={{ borderRadius: 'var(--button-radius, 4px)', animationDelay: '0ms' }}
                              >
                                <Layers size={14} className="mr-2" />
                                <span>Open Existing</span>
                              </button>
                            )}

                            {/* New Project Button */}
                            <button
                              onClick={handleStartNewProject}
                              className="flex h-10 px-4 items-center justify-center bg-[#19191a] border border-[#3a3a3d] text-gray-300 hover:border-gray-500 hover:text-white transition-colors shadow-inner text-xs font-medium animate-in fade-in slide-in-from-left-2 duration-300 fill-mode-both"
                              style={{ borderRadius: 'var(--button-radius, 4px)', animationDelay: '100ms' }}
                            >
                              <Plus size={14} className="mr-2" />
                              <span>Create Project</span>
                            </button>
                            
                            {/* Upload Image Button */}
                            <button
                              onClick={() => {
                                setIsCanvasActionMenuOpen(false);
                                canvasFileInputRef.current?.click();
                              }}
                              className="flex h-10 px-4 items-center justify-center bg-[#19191a] border border-[#3a3a3d] text-gray-300 hover:border-gray-500 hover:text-white transition-colors shadow-inner text-xs font-medium animate-in fade-in slide-in-from-left-2 duration-300 fill-mode-both"
                              style={{ borderRadius: 'var(--button-radius, 4px)', animationDelay: '200ms' }}
                            >
                              <Upload size={14} className="mr-2" />
                              <span>Upload Image</span>
                            </button>
                          </div>
                        )}
                      </div>

                    </div>

                    {/* Generate Button */}
                    <button 
                      onClick={handleGenerate}
                      disabled={!inputValue.trim() || isGenerating}
                      className="bg-white text-black h-10 px-4 font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-md"
                      style={{ borderRadius: 'var(--button-radius, 4px)' }}
                      aria-label="Generate image"
                    >
                      {isGenerating ? (
                        <>
                          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mr-1.5" />
                          <span>Generating...</span>
                        </>
                      ) : (
                        <>
                          <Send size={16} className="mr-1.5" />
                          <span>Generate</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* OLD Full-screen Image Viewer - DISABLED - Using new CanvasViewer instead */}
      {/* {isFullScreenImageOpen && (
        <FullScreenImageViewer
          imageUrl={fullScreenImageUrl}
          isOpen={isFullScreenImageOpen}
          onClose={handleCanvasClose}
          showDownloadButton={viewerShowsDownloadButton}
          imageEditText={imageEditText}
          setImageEditText={setImageEditText}
          showEditTools={showEditTools}
          setShowEditTools={setShowEditTools}
          isAnimatingTools={isAnimatingTools}
          setIsAnimatingTools={setIsAnimatingTools}
          isClosingTools={isClosingTools}
          setIsClosingTools={setIsClosingTools}
          selectedEditMode={selectedEditMode}
          setSelectedEditMode={setSelectedEditMode}
          imageEditHistory={imageEditHistory}
          setImageEditHistory={setImageEditHistory}
          setFullScreenImageUrl={setFullScreenImageUrl}
          canvasSavedStyle={canvasSavedStyle}
          setCanvasSavedStyle={setCanvasSavedStyle}
        />
      )} */}

      {/* Canvas Viewer (New Clean Interface) */}
      {isCanvasViewerOpen && (canvasViewerImageUrl || canvasProjectSettings) && (
        <CanvasViewer
          imageUrl={canvasViewerImageUrl}
          isOpen={isCanvasViewerOpen}
          onClose={handleCanvasViewerClose}
          onImageUpdate={handleCanvasViewerImageUpdate}
          showDownloadButton={true}
          projectSettings={canvasProjectSettings || undefined}
        />
      )}

      {(() => {
        console.log('[Modal] Render check - isCanvasProjectSettingsOpen:', isCanvasProjectSettingsOpen, 'window:', typeof window);
        return isCanvasProjectSettingsOpen && typeof window !== 'undefined';
      })() && (
          <div className="absolute inset-0 z-[2000] flex items-center justify-center">
                <div
                  className="absolute inset-0 bg-black/60"
                  onClick={() => setIsCanvasProjectSettingsOpen(false)}
                />
                <div className="relative z-[2001] w-full max-w-7xl h-fit max-h-[95vh] flex flex-col border border-[#242426] bg-[#141416] shadow-2xl rounded-sm">
                  <div className="py-2 px-4 border-b border-[#242426] bg-[#18181a] rounded-t-sm flex items-center gap-4">
                    <h3 className="text-lg font-semibold text-white">New Canvas Project</h3>
                    <div className="h-4 w-px bg-white/10" />
                    <p className="text-white/60 text-xs">Define the base document for your canvas workspace.</p>
                  </div>

                  <div className="flex-1 flex flex-row">
                    {/* Left Sidepanel: Project Settings */}
                    <div className="w-[380px] border-r border-[#242426] bg-[#18181a]/30 p-6 flex flex-col gap-5">
                      {/* Project Name */}
                      <div>
                        <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">Project Name</label>
                        <input
                          type="text"
                          value={canvasProjectName}
                          onChange={(e) => setCanvasProjectName(e.target.value)}
                          className="w-full bg-[#1b1b1d] border border-[#2c2c2f] rounded-sm px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                          placeholder="Untitled Canvas"
                        />
                      </div>

                      {/* Dimensions & Units */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">Width</label>
                          <input
                            type="number"
                            value={canvasProjectWidth}
                            onChange={(e) => setCanvasProjectWidth(Number(e.target.value))}
                            className="w-full bg-[#1b1b1d] border border-[#2c2c2f] rounded-sm px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">Height</label>
                          <input
                            type="number"
                            value={canvasProjectHeight}
                            onChange={(e) => setCanvasProjectHeight(Number(e.target.value))}
                            className="w-full bg-[#1b1b1d] border border-[#2c2c2f] rounded-sm px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                          />
                        </div>
                      </div>

                      {/* Unit Selector */}
                      <div>
                        <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">Units</label>
                        <select
                          value={canvasProjectUnit}
                          onChange={(e) => handleUnitChange(e.target.value as 'pixels' | 'inches')}
                          className="w-full bg-[#1b1b1d] border border-[#2c2c2f] rounded-sm px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/20 appearance-none"
                        >
                          <option value="pixels">Pixels</option>
                          <option value="inches">Inches</option>
                        </select>
                      </div>

                      {/* Resolution */}
                      <div>
                        <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">Resolution</label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            value={canvasProjectResolution}
                            onChange={(e) => {
                              const newRes = Number(e.target.value) || 72;
                              if (canvasProjectUnit === 'inches') {
                                // If in inches, changing resolution updates pixels but keeps inches the same
                                // So we don't need to change width/height state values since they represent inches here
                              }
                              setCanvasProjectResolution(newRes);
                            }}
                            className="flex-1 bg-[#1b1b1d] border border-[#2c2c2f] rounded-sm px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                          />
                          <div className="bg-[#242426] border border-[#2c2c2f] rounded-sm px-3 py-2 text-white/40 text-xs flex items-center">
                            Pixels/Inch
                          </div>
                        </div>
                      </div>

                      {/* Color Mode */}
                      <div>
                        <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">Color Mode</label>
                        <div className="flex gap-2">
                          <select
                            value={canvasProjectColorMode}
                            onChange={(e) => setCanvasProjectColorMode(e.target.value)}
                            className="flex-1 bg-[#1b1b1d] border border-[#2c2c2f] rounded-sm px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/20 appearance-none"
                          >
                            <option value="RGB Color">RGB Color</option>
                            <option value="CMYK Color">CMYK Color</option>
                            <option value="Grayscale">Grayscale</option>
                            <option value="Lab Color">Lab Color</option>
                          </select>
                          <div className="bg-[#242426] border border-[#2c2c2f] rounded-sm px-3 py-2 text-white/40 text-xs flex items-center">
                            8 bit
                          </div>
                        </div>
                      </div>

                      {/* Background Content */}
                      <div>
                        <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">Background Contents</label>
                        <div className="flex flex-col gap-3">
                          <div className="flex items-center gap-3">
                            <div 
                              className={`h-10 w-12 rounded-sm border border-[#2c2c2f] cursor-pointer overflow-hidden relative ${isTransparentBackground ? 'opacity-30' : ''}`}
                              style={{ backgroundColor: isTransparentBackground ? 'transparent' : canvasBackgroundColor }}
                            >
                              <input
                                type="color"
                                value={canvasBackgroundColor}
                                onChange={(e) => {
                                  setCanvasBackgroundColor(e.target.value);
                                  setIsTransparentBackground(false);
                                }}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                disabled={isTransparentBackground}
                              />
                              {isTransparentBackground && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                  {/* Transparent checkerboard placeholder */}
                                  <div className="w-full h-full" style={{ backgroundImage: 'linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)', backgroundSize: '10px 10px', backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0px' }}></div>
                                </div>
                              )}
                            </div>
                            <input
                              type="text"
                              value={isTransparentBackground ? 'Transparent' : canvasBackgroundColor}
                              onChange={(e) => {
                                if (e.target.value.toLowerCase() === 'transparent') {
                                  setIsTransparentBackground(true);
                                } else {
                                  setCanvasBackgroundColor(e.target.value);
                                  setIsTransparentBackground(false);
                                }
                              }}
                              className="flex-1 bg-[#1b1b1d] border border-[#2c2c2f] rounded-sm px-3 py-2 text-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-white/20"
                              placeholder="#ffffff or Transparent"
                            />
                          </div>
                          
                          <div className="flex gap-2">
                            <button
                              onClick={() => setIsTransparentBackground(false)}
                              className={`flex-1 py-1.5 rounded-sm border text-[10px] uppercase font-medium transition-colors ${!isTransparentBackground ? 'bg-white/10 border-white/20 text-white' : 'bg-transparent border-[#2c2c2f] text-white/40 hover:text-white/60'}`}
                            >
                              Color
                            </button>
                            <button
                              onClick={() => setIsTransparentBackground(true)}
                              className={`flex-1 py-1.5 rounded-sm border text-[10px] uppercase font-medium transition-colors ${isTransparentBackground ? 'bg-white/10 border-white/20 text-white' : 'bg-transparent border-[#2c2c2f] text-white/40 hover:text-white/60'}`}
                            >
                              Transparent
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Advanced Options Header */}
                      <div className="pt-2 border-t border-[#242426]">
                        <h4 className="text-[10px] font-semibold text-white/20 uppercase tracking-[0.2em]">Advanced Options</h4>
                      </div>

                      {/* Color Profile */}
                      <div>
                        <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">Color Profile</label>
                        <select
                          value={canvasProjectColorProfile}
                          onChange={(e) => setCanvasProjectColorProfile(e.target.value)}
                          className="w-full bg-[#1b1b1d] border border-[#2c2c2f] rounded-sm px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/20 appearance-none"
                        >
                          <option value="sRGB IEC61966-2.1">sRGB IEC61966-2.1</option>
                          <option value="Adobe RGB (1998)">Adobe RGB (1998)</option>
                          <option value="ProPhoto RGB">ProPhoto RGB</option>
                          <option value="Display P3">Display P3</option>
                          <option value="Don't Color Manage this Document">Don't Color Manage this Document</option>
                        </select>
                      </div>

                      {/* Pixel Aspect Ratio */}
                      <div>
                        <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">Pixel Aspect Ratio</label>
                        <select
                          value={canvasProjectPixelAspectRatio}
                          onChange={(e) => setCanvasProjectPixelAspectRatio(e.target.value)}
                          className="w-full bg-[#1b1b1d] border border-[#2c2c2f] rounded-sm px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/20 appearance-none"
                        >
                          <option value="Square Pixels">Square Pixels</option>
                          <option value="D1/DV NTSC (0.91)">D1/DV NTSC (0.91)</option>
                          <option value="D1/DV PAL (1.09)">D1/DV PAL (1.09)</option>
                          <option value="DVCPRO HD (1.5)">DVCPRO HD (1.5)</option>
                          <option value="Anamorphic 2:1 (2.0)">Anamorphic 2:1 (2.0)</option>
                        </select>
                      </div>
                    </div>

                    {/* Right Panel: Presets */}
                    <div className="flex-1 bg-[#09090b] flex flex-col overflow-hidden">
                      {/* Preset Categories Header */}
                      <div className="flex border-b border-[#242426] bg-[#141416] px-4 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                        {['Photo', 'Print', 'Illustration', 'Web', 'Mobile', 'Film'].map((cat) => (
                          <button
                            key={cat}
                            onClick={() => setActivePresetCategory(cat)}
                            className={`px-4 py-3 text-[11px] font-medium uppercase tracking-wider transition-colors border-b-2 whitespace-nowrap ${
                              activePresetCategory === cat
                                ? 'border-blue-500 text-white'
                                : 'border-transparent text-white/40 hover:text-white/70'
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>

                      {/* Preset Grid */}
                      <div className="flex-1 p-6 overflow-y-auto">
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                          {(() => {
                            const presetsData: Record<string, Array<{name: string, width: number, height: number, unit: string, resolution: number, colorMode?: string}>> = {
                              'Photo': [
                                { name: 'Default Size', width: 7, height: 5, unit: 'inches', resolution: 300, colorMode: 'RGB Color' },
                                { name: 'Landscape 2x3', width: 3, height: 2, unit: 'inches', resolution: 300, colorMode: 'RGB Color' },
                                { name: 'Landscape 4x6', width: 6, height: 4, unit: 'inches', resolution: 300, colorMode: 'RGB Color' },
                                { name: 'Landscape 5x7', width: 7, height: 5, unit: 'inches', resolution: 300, colorMode: 'RGB Color' },
                                { name: 'Landscape 8x10', width: 10, height: 8, unit: 'inches', resolution: 300, colorMode: 'RGB Color' },
                              ],
                              'Print': [
                                { name: 'Letter', width: 8.5, height: 11, unit: 'inches', resolution: 300, colorMode: 'CMYK Color' },
                                { name: 'Legal', width: 8.5, height: 14, unit: 'inches', resolution: 300, colorMode: 'CMYK Color' },
                                { name: 'Tabloid', width: 11, height: 17, unit: 'inches', resolution: 300, colorMode: 'CMYK Color' },
                                { name: 'A4', width: 8.27, height: 11.69, unit: 'inches', resolution: 300, colorMode: 'CMYK Color' },
                              ],
                              'Illustration': [
                                { name: '1000x1000', width: 1000, height: 1000, unit: 'pixels', resolution: 72, colorMode: 'RGB Color' },
                                { name: '2000x2000', width: 2000, height: 2000, unit: 'pixels', resolution: 300, colorMode: 'RGB Color' },
                                { name: 'Postcard', width: 6, height: 4, unit: 'inches', resolution: 300, colorMode: 'RGB Color' },
                                { name: 'Poster', width: 18, height: 24, unit: 'inches', resolution: 300, colorMode: 'RGB Color' },
                              ],
                              'Web': [
                                { name: 'Web Large', width: 1920, height: 1080, unit: 'pixels', resolution: 72, colorMode: 'RGB Color' },
                                { name: 'Web Medium', width: 1440, height: 900, unit: 'pixels', resolution: 72, colorMode: 'RGB Color' },
                                { name: 'Web Small', width: 1366, height: 768, unit: 'pixels', resolution: 72, colorMode: 'RGB Color' },
                                { name: 'Web Minimum', width: 1024, height: 768, unit: 'pixels', resolution: 72, colorMode: 'RGB Color' },
                              ],
                              'Mobile': [
                                { name: 'iPhone X', width: 1125, height: 2436, unit: 'pixels', resolution: 458, colorMode: 'RGB Color' },
                                { name: 'iPhone 8 Plus', width: 1080, height: 1920, unit: 'pixels', resolution: 401, colorMode: 'RGB Color' },
                                { name: 'iPhone 8', width: 750, height: 1334, unit: 'pixels', resolution: 326, colorMode: 'RGB Color' },
                                { name: 'Google Pixel 2 XL', width: 1440, height: 2880, unit: 'pixels', resolution: 538, colorMode: 'RGB Color' },
                              ],
                              'Film': [
                                { name: 'HDTV 1080p', width: 1920, height: 1080, unit: 'pixels', resolution: 72, colorMode: 'RGB Color' },
                                { name: 'DVCPRO HD 720p', width: 1280, height: 720, unit: 'pixels', resolution: 72, colorMode: 'RGB Color' },
                                { name: '4K UHD', width: 3840, height: 2160, unit: 'pixels', resolution: 72, colorMode: 'RGB Color' },
                                { name: '8K UHD', width: 7680, height: 4320, unit: 'pixels', resolution: 72, colorMode: 'RGB Color' },
                              ]
                            };
                            return (presetsData[activePresetCategory] || []).map((preset, idx) => (
                              <button
                                key={idx}
                                onClick={() => {
                                  setCanvasProjectWidth(preset.width);
                                  setCanvasProjectHeight(preset.height);
                                  setCanvasProjectUnit(preset.unit as 'pixels' | 'inches');
                                  setCanvasProjectResolution(preset.resolution);
                                  if (preset.colorMode) {
                                    setCanvasProjectColorMode(preset.colorMode);
                                  }
                                }}
                                className="group flex flex-col items-center p-2 transition-all duration-300 hover:opacity-100 opacity-70"
                              >
                                <div className="w-full h-24 flex items-center justify-center mb-1">
                                  <div className="w-full h-full flex items-center justify-center transition-transform duration-300 group-hover:scale-110">
                                    <PresetThumbnail category={activePresetCategory} width={preset.width} height={preset.height} />
                                  </div>
                                </div>
                                <div className="text-center">
                                  <div className="text-[11px] font-semibold text-white/90 truncate">{preset.name}</div>
                                  <div className="text-[9px] text-white/30 uppercase tracking-tight">
                                    {preset.width} x {preset.height} @ {preset.resolution} PPI
                                  </div>
                                </div>
                              </button>
                            ));
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-2 px-4 border-t border-[#242426] bg-[#18181a] rounded-b-sm">
                    <div className="text-white/60 text-sm">
                      {canvasProjectWidth} × {canvasProjectHeight} • Background {canvasBackgroundColor}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setIsCanvasProjectSettingsOpen(false)}
                        className="px-4 py-2 rounded-sm bg-[#1f1f21] border border-[#2c2c2f] text-white hover:border-[#3a3a40]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCreateCanvasProject}
                        className="px-4 py-2 rounded-sm bg-white text-black font-semibold hover:bg-gray-200 transition-colors shadow-md"
                      >
                        Create Project
                      </button>
                    </div>
                  </div>
                </div>
          </div>
      )}

      {/* All hidden inputs from original */}
      <input 
        type="file" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        accept="image/*"
        multiple
        onChange={handleFileSelected}
      />
      
      <input 
        type="file" 
        ref={canvasFileInputRef} 
        style={{ display: 'none' }} 
        accept="image/*"
        onChange={handleCanvasImageUpload}
      />

      <input 
        type="file" 
        ref={styleFileInputRef} 
        style={{ display: 'none' }} 
        accept="image/*"
        onChange={handleStyleFileSelected}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={historyHook.deleteConfirmationModal.isOpen}
        sessionId={historyHook.deleteConfirmationModal.sessionId}
        sessionTitle={historyHook.deleteConfirmationModal.sessionTitle}
        onConfirm={() => {
          if (historyHook.deleteConfirmationModal.sessionId) {
            historyHook.handleDeleteSession(historyHook.deleteConfirmationModal.sessionId);
          }
          historyHook.handleCancelDelete();
        }}
        onCancel={historyHook.handleCancelDelete}
      />
    </>
  );
};

export default ImageStudio; 
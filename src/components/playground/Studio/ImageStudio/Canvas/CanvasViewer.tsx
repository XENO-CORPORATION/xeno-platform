import React, { useState, useRef, useEffect } from 'react';
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
  Crop, Move, Hand, Crosshair, Filter, Contrast,
  Sun, Moon, Droplet, Zap, Wind, Sparkles,
  MousePointer, MousePointer2, Grab, GrabIcon,
  Bandage, Undo, Mountain, Search, Info, Cpu
} from 'lucide-react';
import {
  AdjustmentModal,
  EnhanceModal,
  SegmentationModal,
  TransformModal,
  BrushModal,
  RemoveModal,
  SelectionModal,
  TextModal,
  ShapeModal,
  SmartGuides,
  ColorPickerModal,
  LayersModal,
  LayersContent,
  type ImageAdjustments,
  type UpscaleModel,
  type BrushSettings,
  type AdvancedBrushSettings,
  type BlendMode,
  type Selection,
  type SelectionArea,
  type SelectionTool,
  type TextStyle,
  type ShapeStyle,
  type SmartGuidesType as SmartGuidesType
} from './tools';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Layer } from '../core/types';

interface CanvasProjectSettings {
  name: string;
  width: number;
  height: number;
  unit: string;
  resolution: number;
  colorMode: string;
  colorProfile: string;
  pixelAspectRatio: string;
  backgroundColor: string;
}

interface CanvasViewerProps {
  imageUrl: string | null;
  isOpen: boolean;
  onClose: () => void;
  onImageUpdate?: (newImageUrl: string) => void;
  showDownloadButton?: boolean;
  projectSettings?: CanvasProjectSettings;
}


const Ruler: React.FC<{
  type: 'horizontal' | 'vertical';
  scale: number;
  offset: number;
  length: number;
  unit: string;
  resolution: number;
  parScaleX: number;
}> = ({ type, scale, offset, length, unit, resolution, parScaleX }) => {
  const pixelsPerUnit = unit === 'inches' ? resolution : 100;
  const effectiveScale = type === 'horizontal' ? scale * parScaleX : scale;
  const increment = pixelsPerUnit * effectiveScale;
  const numMarks = Math.ceil(length / increment) + 2;
  const startIdx = Math.floor(-offset / increment);
  
  return (
    <div className={`absolute z-[10] overflow-hidden pointer-events-none bg-transparent border-none shadow-none ${type === 'horizontal' ? 'top-0 left-8 right-0 h-8' : 'top-8 left-0 bottom-0 w-8'}`}>
      <svg className="w-full h-full opacity-20">
        {Array.from({ length: numMarks }).map((_, i) => {
          const idx = startIdx + i;
          const pos = idx * increment + offset;
          return (
            <React.Fragment key={idx}>
              {type === 'horizontal' ? (
                <>
                  <line x1={pos + 32} y1="0" x2={pos + 32} y2="32" stroke="white" strokeWidth="1" />
                  <text x={pos + 36} y="12" fill="white" fontSize="8" fontWeight="bold">{idx}</text>
                </>
              ) : (
                <>
                  <line x1="0" y1={pos + 32} x2="32" y2={pos + 32} stroke="white" strokeWidth="1" />
                  <text x="2" y={pos + 44} fill="white" fontSize="8" fontWeight="bold" transform={`rotate(-90, 12, ${pos + 44})`}>{idx}</text>
                </>
              )}
              {Array.from({ length: 9 }).map((_, subIdx) => {
                const subPos = pos + (subIdx + 1) * (increment / 10);
                return type === 'horizontal' ? (
                  <line key={subIdx} x1={subPos + 32} y1="24" x2={subPos + 32} y2="32" stroke="white" strokeWidth="0.5" opacity="0.5" />
                ) : (
                  <line key={subIdx} x1="24" y1={subPos + 32} x2="32" y2={subPos + 32} stroke="white" strokeWidth="0.5" opacity="0.5" />
                );
              })}
            </React.Fragment>
          );
        })}
      </svg>
    </div>
  );
};

const CanvasViewer: React.FC<CanvasViewerProps> = ({
  imageUrl,
  isOpen,
  onClose,
  onImageUpdate,
  showDownloadButton = true,
  projectSettings
}) => {
  // Core state
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [currentImageUrl, setCurrentImageUrl] = useState(imageUrl);
  const [activeProjectSettings, setActiveProjectSettings] = useState<CanvasProjectSettings | undefined>(projectSettings);
  
  // Canvas and image refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);
  
  // Canvas viewport state
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [showControls, setShowControls] = useState(false);
  // Prevent edit history reset on internal image updates
  const isInternalImageUpdateRef = useRef(false);
  
  // Edit interface state
  const [showEditTools, setShowEditTools] = useState(false);
  const [isAnimatingTools, setIsAnimatingTools] = useState(false);
  const [isClosingTools, setIsClosingTools] = useState(false);
  const [selectedEditMode, setSelectedEditMode] = useState<'retouch' | 'resize' | 'enhance' | 'background' | 'adjust' | 'style' | 'segmentation' | null>(null);
  
  // NEW: Individual panel visibility states for multiple panels
  const [showAdjustPanel, setShowAdjustPanel] = useState(false);
  const [showEditToolsAdjustPanel, setShowEditToolsAdjustPanel] = useState(false);
  const [hoveredEditTool, setHoveredEditTool] = useState<string | null>(null);
  const [showEnhancePanel, setShowEnhancePanel] = useState(false);
  const [showSegmentationPanel, setShowSegmentationPanel] = useState(false);
  const [showTransformPanel, setShowTransformPanel] = useState(false);
  const [showBrushPanel, setShowBrushPanel] = useState(false);
  const [showRemovePanel, setShowRemovePanel] = useState(false);
  const [showSelectionPanel, setShowSelectionPanel] = useState(false);
  const [showTextPanel, setShowTextPanel] = useState(false);
  const [showShapePanel, setShowShapePanel] = useState(false);
  
  // NEW: Dynamic z-index system for panel layering
  const [panelZIndices, setPanelZIndices] = useState({
    adjust: 8011,
    style: 8011,
    enhance: 8011,
    segmentation: 8011,
    transform: 8011,
    brush: 8011,
    remove: 8011,
    selection: 8011,
    text: 8011,
    shape: 8011,
    colorPicker: 8011,
    layers: 8011
  });
  const [highestZIndex, setHighestZIndex] = useState(1001);
  
  // NEW: Bring panel to front when clicked or dragged
  const bringPanelToFront = (panelKey: string) => {
    const newZIndex = highestZIndex + 1;
    setPanelZIndices(prev => ({
      ...prev,
      [panelKey]: newZIndex
    }));
    setHighestZIndex(newZIndex);
  };
  
  // NEW: Check if panel is currently on top (highest z-index)
  const isPanelOnTop = (panelKey: string): boolean => {
    return panelZIndices[panelKey as keyof typeof panelZIndices] === Math.max(...Object.values(panelZIndices));
  };
  
  // Edit history state
  const [imageEditHistory, setImageEditHistory] = useState<Array<{
    id: string;
    url: string;
    prompt: string;
    editType?: string;
    timestamp?: string;
  }>>([]);
  const [currentActiveImageUrl, setCurrentActiveImageUrl] = useState<string | null>(imageUrl);
  
  // Tool preview state
  const [hoveredTool, setHoveredTool] = useState<string | null>(null);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [currentVideoUrl, setCurrentVideoUrl] = useState('');
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Tool descriptions for hover tooltips
  const toolDescriptions = {
    'model': 'Select the AI model to use for image editing - choose between GPT-4 Vision, Flux Kontext, Step1x Edit, and Ideogram V2 Edit models',
    'retouch': 'Activate Relight to use the IC-Light-v2 model and intelligently relight your image using natural language prompts',
    'reframe': 'Activate Reframe to resize and crop your image to custom dimensions while preserving important content',
    'background': 'Activate Background to seamlessly change or replace the background of your image while preserving the main subject',
    'adjust': 'Activate Adjust to fine-tune brightness, contrast, saturation, and other image properties',
    'style': 'Activate Style to select custom styles, presets, or reference images and apply them to your image edits'
  };
  
  // Controls dropdown state
  const [showControlsDropdown, setShowControlsDropdown] = useState(false);
  
  // Save state
  const [isSaved, setIsSaved] = useState(false);
  
  // Edit history navigation state
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1); // -1 means original image
  
  // Debug mode
  const [debugMode, setDebugMode] = useState<boolean>(false);

  // NEW: Model Selection State
  const [selectedModel, setSelectedModel] = useState<'seededit-v3' | 'gpt-image-1' | 'flux-kontext' | 'step1x-edit' | 'ideogram-v2-edit'>('seededit-v3');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);

  // NEW: Style Modal State
  const [isStyleModalOpen, setIsStyleModalOpen] = useState(false);
  const [savedStyle, setSavedStyle] = useState<{
    type: 'image' | 'prompt' | 'preset' | null;
    content: string;
    name?: string;
  } | null>(null);
  const [activeStyleTab, setActiveStyleTab] = useState<'image' | 'prompt' | 'preset'>('image');
  const [stylePromptText, setStylePromptText] = useState('');
  const [selectedStylePreset, setSelectedStylePreset] = useState<string | null>(null);
  const [styleReferenceImage, setStyleReferenceImage] = useState<File | null>(null);
  const [styleImagePreview, setStyleImagePreview] = useState<string | null>(null);
  const styleModalRef = useRef<HTMLDivElement>(null);
  const styleFileInputRef = useRef<HTMLInputElement>(null);

  // NEW: Relight Input State
  const [showRelightInput, setShowRelightInput] = useState(false);
  const [relightPrompt, setRelightPrompt] = useState('');
  const [isRelighting, setIsRelighting] = useState(false);
  const relightInputRef = useRef<HTMLTextAreaElement>(null);

  // NEW: Background Input State
  const [showBackgroundInput, setShowBackgroundInput] = useState(false);
  const [backgroundPrompt, setBackgroundPrompt] = useState('');
  const [isBackgrounding, setIsBackgrounding] = useState(false);
  const backgroundInputRef = useRef<HTMLTextAreaElement>(null);
  const [showBackgroundSubButtons, setShowBackgroundSubButtons] = useState(false);

  // NEW: Reframe Input State
  const [showReframeInput, setShowReframeInput] = useState(false);
  const [reframePrompt, setReframePrompt] = useState('');
  const [isReframing, setIsReframing] = useState(false);
  const reframeInputRef = useRef<HTMLTextAreaElement>(null);

  // NEW: Reframe Image Size State
  const [reframeAspectRatio, setReframeAspectRatio] = useState('landscape-16-9');
  const [reframeWidth, setReframeWidth] = useState(1024);
  const [reframeHeight, setReframeHeight] = useState(576);
  const [isCustomSize, setIsCustomSize] = useState(false);
  const [isAspectMenuOpen, setIsAspectMenuOpen] = useState(false);
  const aspectRatioOptions = [
    { value: 'landscape-16-9', label: 'Landscape 16:9' },
    { value: 'portrait-9-16', label: 'Portrait 9:16' },
    { value: 'square-1-1', label: 'Square 1:1' },
    { value: 'landscape-4-3', label: 'Landscape 4:3' },
    { value: 'portrait-3-4', label: 'Portrait 3:4' },
    { value: 'custom', label: 'Custom Size' },
  ];

  // NEW: Layers Container State
  const [isLayersOpen, setIsLayersOpen] = useState(false);
  const [isLayersAnimating, setIsLayersAnimating] = useState(false);
  const [isLayersReattaching, setIsLayersReattaching] = useState(false);
  const [layerOpacity, setLayerOpacity] = useState(100);
  
  // NEW: Layers Modal State
  const [layersModalPosition, setLayersModalPosition] = useState({ x: 96, y: 0 });
  const [isDraggingLayersModal, setIsDraggingLayersModal] = useState(false);
  const [isDraggingOpacity, setIsDraggingOpacity] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartOpacity, setDragStartOpacity] = useState(100);
  
  // ENHANCED: Layer System with real functionality
  const [layers, setLayers] = useState<Layer[]>([]);
  
  // NEW: Active layer management
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [layerCanvases, setLayerCanvases] = useState<Map<string, HTMLCanvasElement>>(new Map());
  
  // NEW: Brush drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastDrawPoint, setLastDrawPoint] = useState<{ x: number; y: number } | null>(null);
  const [brushPath, setBrushPath] = useState<Array<{ x: number; y: number; pressure?: number }>>([]);


  const [brushSettings, setBrushSettings] = useState<AdvancedBrushSettings>({
    // Basic settings
    size: 20,
    hardness: 100,
    opacity: 100,
    flow: 100,
    type: 'soft_round',
    color: '#ffffff',
    // Advanced settings
    spacing: 25,
    angleJitter: 0,
    sizeJitter: 0,
    opacityJitter: 0,
    scattering: 0,
    wetness: 0,
    smoothing: 0,
    blendMode: 'normal',
    // Dynamics
    dynamics: {
      sizePressure: false,
      opacityPressure: false,
      flowPressure: false,
      tiltAngle: 0,
      tiltElevation: 0
    },
    // Shape
    shape: {
      angle: 0,
      roundness: 100,
      flipX: false,
      flipY: false
    }
  });

  // NEW: Selection tool state
  const [currentSelection, setCurrentSelection] = useState<Selection | null>(null);
  const [selectionTool, setSelectionTool] = useState<SelectionTool>({
    type: 'rectangular'
  });

  // NEW: Text tool state
  const [textStyle, setTextStyle] = useState<TextStyle>({
    fontFamily: 'Arial',
    fontSize: 24,
    fontWeight: 'normal',
    fontStyle: 'normal',
    textAlign: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    textDecoration: 'none',
    textTransform: 'none',
    color: '#ffffff'
  });

  // NEW: Shape tool state
  const [shapeStyle, setShapeStyle] = useState<ShapeStyle>({
    fill: true,
    fillColor: '#ffffff',
    fillOpacity: 100,
    stroke: true,
    strokeColor: '#000000',
    strokeWidth: 2,
    strokeOpacity: 100
  });

  // NEW: Smart Guides state
  const [smartGuides, setSmartGuides] = useState<SmartGuidesType>({
    enabled: false,
    snapDistance: 10,
    showDistances: true,
    showAlignment: true,
    magneticAlignment: true,
    gridSize: 20,
    showGrid: false
  });

  // NEW: Image adjustment state
  const [imageAdjustments, setImageAdjustments] = useState<ImageAdjustments>({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    hue: 0,
    exposure: 0,
    highlights: 0,
    shadows: 0,
    vibrance: 0,
    warmth: 0,
    tint: 0
  });

  // NEW: Adjustment panel dragging state
  const [adjustmentPanelPosition, setAdjustmentPanelPosition] = useState({ x: 96, y: 0 }); // Start at left: 24 (6rem) + 72 (w-16 + gap)
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // NEW: Enhance panel state
  const [enhancePanelPosition, setEnhancePanelPosition] = useState({ x: 416, y: 0 });
  const [isDraggingEnhancePanel, setIsDraggingEnhancePanel] = useState(false);
  const [enhanceDragStartPos, setEnhanceDragStartPos] = useState({ x: 0, y: 0 });
  const enhanceDragOffsetRef = useRef({ x: 0, y: 0 });

  // NEW: Brush panel dragging state
  const [isDraggingBrushPanel, setIsDraggingBrushPanel] = useState(false);

  // NEW: Selection panel dragging state
  const [isDraggingSelectionPanel, setIsDraggingSelectionPanel] = useState(false);

  // NEW: Text panel dragging state
  const [isDraggingTextPanel, setIsDraggingTextPanel] = useState(false);

  // NEW: Brush cursor state
  const [brushCursorPosition, setBrushCursorPosition] = useState({ x: 0, y: 0 });
  const [showBrushCursor, setShowBrushCursor] = useState(false);
  const [isHoveringUI, setIsHoveringUI] = useState(false);

  // NEW: Enhanced coordinate and drag state (unused variables removed)
  const [selectedTool, setSelectedTool] = useState<string>('none'); // Start with no tool selected

  // Hide brush cursor when brush panel is closed
  useEffect(() => {
    if (!showBrushPanel) {
      setShowBrushCursor(false);
      setIsDrawing(false); // Also stop any ongoing drawing
    }
  }, [showBrushPanel]);

  // RESTORE: Back to working coordinate transformation for drawing
  const getCanvasCoordinates = (e: React.MouseEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    
    // Canvas coordinates relative to canvas element
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    
    // FIXED: Convert to image coordinates accounting for pan/zoom
    // The image coordinates should be what we would draw to on the original image
    const imageX = (canvasX - translateX) / scale;
    const imageY = (canvasY - translateY) / scale;
    
    // Optional debug logging (reduced for performance)
    if (process.env.NODE_ENV === 'development' && Math.random() < 0.01) {
      console.log('🔧 COORDS:', {
        canvas: { x: canvasX.toFixed(1), y: canvasY.toFixed(1) },
        image: { x: imageX.toFixed(1), y: imageY.toFixed(1) },
        scale: scale.toFixed(2)
      });
    }
    
    return {
      canvasX,
      canvasY,
      imageX,
      imageY
    };
  };

  // Simple brush cursor update (now handled by BrushModal)
  const updateBrushCursor = (e: React.MouseEvent) => {
    // INDUSTRY STANDARD: Always update cursor position using proper coordinate calculation
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Use getBoundingClientRect for accurate canvas-relative positioning
    const rect = canvas.getBoundingClientRect();
    const newPosition = { 
      x: e.clientX - rect.left, 
      y: e.clientY - rect.top 
    };
    
    setBrushCursorPosition(newPosition);
  };

  // Drag and drop state for layers
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]); // Multi-selection support
  
  // Responsive mouse-based drag system for immediate feedback
  const [isLayerDragging, setIsLayerDragging] = useState(false);
  const [layerDragStartY, setLayerDragStartY] = useState(0);
  const [layerDragCurrentY, setLayerDragCurrentY] = useState(0);
  const [layerDragThreshold] = useState(3); // pixels to move before drag starts
  const [draggedLayerElement, setDraggedLayerElement] = useState<HTMLElement | null>(null);
  const [dragStartLayerId, setDragStartLayerId] = useState<string | null>(null);

  // NEW: Enhance settings state
  const [selectedUpscaleModel, setSelectedUpscaleModel] = useState<string>('real-esrgan-x4plus');
  const [upscaleFactor, setUpscaleFactor] = useState<number>(4);
  const [isEnhancing, setIsEnhancing] = useState(false);

  // NEW: Color palette state
  const [isColorPaletteOpen, setIsColorPaletteOpen] = useState(false);
  
  // Color picker state
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [colorPickerType, setColorPickerType] = useState<'primary' | 'secondary'>('primary');
  const [primaryColor, setPrimaryColor] = useState('#ffffff');
  const [secondaryColor, setSecondaryColor] = useState('#000000');
  const [colorPickerPosition, setColorPickerPosition] = useState({ x: 0, y: 0 });
  const [isColorPickerDragging, setIsColorPickerDragging] = useState(false);

  // NEW: Tab menu state
  const [isTabMenuOpen, setIsTabMenuOpen] = useState(false);
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
  const [isFileDropdownOpen, setIsFileDropdownOpen] = useState(false);

  // NEW: UI element visibility states
  const [uiVisibility, setUiVisibility] = useState({
    topControls: true,
    chatContainer: true,
    tools: true,
    edits: true,
    layersButton: true,
    tabButton: true,
    closeButton: true,
    paletteButton: true
  });

  // NEW: Smart save/close button state
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showSaveButton, setShowSaveButton] = useState(false);
  const [isCloseDisabled, setIsCloseDisabled] = useState(false);
  const [saveCompleted, setSaveCompleted] = useState(false);

  // Model options for image editing
  const modelOptions = [
    { 
      id: 'seededit-v3', 
      name: 'SeedEdit v3', 
      description: 'Advanced seed-based image editing model with enhanced precision and control',
      category: 'SeedEdit'
    },
    { 
      id: 'gpt-image-1', 
      name: 'Image Gen 1', 
      description: 'OpenAI GPT-4 Vision with image editing capabilities',
      category: 'OpenAI'
    },
    { 
      id: 'flux-kontext', 
      name: 'FLUX.1 Kontext', 
      description: 'Advanced flux-based image editing model',
      category: 'Flux'
    },
    { 
      id: 'step1x-edit', 
      name: 'Step1X-Edit', 
      description: 'Next-generation AI image editing model',
      category: 'Step1X'
    },
    { 
      id: 'ideogram-v2-edit', 
      name: 'Ideogram V2 Edit', 
      description: 'Advanced Ideogram V2 image editing model',
      category: 'Ideogram'
    }
  ];

  // Upscale models (simplified from ImageEnhanceInterface)
  const upscaleModels: UpscaleModel[] = [
    { id: 'real-esrgan-x4plus', name: 'Real-ESRGAN x4+', defaultScale: 4, category: 'Traditional' },
    { id: 'real-esrgan-general-x4v3', name: 'Real-ESRGAN General x4', defaultScale: 4, category: 'Traditional' },
    { id: 'fal-ai/recraft/upscale/creative', name: 'Recraft Creative', defaultScale: 4, category: 'AI Creative' },
    { id: 'fal-ai/recraft/upscale/crisp', name: 'Recraft Crisp', defaultScale: 4, category: 'AI Crisp' },
    { id: 'fal-ai/creative-upscaler', name: 'FAL Creative', defaultScale: 2, category: 'AI Advanced' },
    { id: 'fal-ai/drct-super-resolution', name: 'DRCT Super-Res', defaultScale: 4, category: 'Super Resolution' },
    { id: 'fal-ai/clarity-upscaler', name: 'Clarity Upscaler', defaultScale: 2, category: 'AI Clarity' },
    { id: 'fal-ai/ideogram/upscale', name: 'Ideogram AI', defaultScale: 4, category: 'AI Intelligent' },
  ];

  // NEW: Check if adjustments have been made
  const hasAdjustments = () => {
    return imageAdjustments.brightness !== 100 ||
           imageAdjustments.contrast !== 100 ||
           imageAdjustments.saturation !== 100 ||
           imageAdjustments.hue !== 0 ||
           imageAdjustments.exposure !== 0 ||
           imageAdjustments.highlights !== 0 ||
           imageAdjustments.shadows !== 0 ||
           imageAdjustments.vibrance !== 0 ||
           imageAdjustments.warmth !== 0 ||
           imageAdjustments.tint !== 0;
  };

  // NEW: Reset adjustments to defaults
  const resetAdjustments = () => {
    setImageAdjustments({
      brightness: 100,
      contrast: 100,
      saturation: 100,
      hue: 0,
      exposure: 0,
      highlights: 0,
      shadows: 0,
      vibrance: 0,
      warmth: 0,
      tint: 0
    });
  };

  // NEW: Reset panel position to default
  const resetPanelPosition = () => {
    setAdjustmentPanelPosition(getAutoPanelPosition('adjust'));
  };

  // NEW: Reset enhance panel position to default
  const resetEnhancePanelPosition = () => {
    setEnhancePanelPosition(getAutoPanelPosition('enhance'));
  };

  // NEW: Mock upscale service (simplified from ImageEnhanceInterface)
  const mockUpscaleService = {
    upscaleImage: async (modelId: string, settings: any): Promise<{ success: boolean; images?: { url: string; scale?: number }[]; error?: string; metadata?: any }> => {
      console.log(`[UpscaleService] Upscaling with ${modelId}`, settings);
      
      // Simulate processing time
      const processingTime = modelId.includes('recraft') ? 2500 
                           : modelId === 'fal-ai/creative-upscaler' ? 3000
                           : modelId === 'fal-ai/drct-super-resolution' ? 2800
                           : modelId === 'fal-ai/clarity-upscaler' ? 3200
                           : modelId === 'fal-ai/ideogram/upscale' ? 3800
                           : 1500;
      await new Promise(resolve => setTimeout(resolve, processingTime));
      
      // Simulate success (high success rate for demo)
      if (Math.random() < 0.95) {
        return {
          success: true,
          images: [{ url: settings.image_url, scale: settings.scale }], // For demo, return same image
          metadata: {
            generationTime: processingTime / 1000,
            model: modelId,
            enhancement_type: 'upscale',
            provider: 'mock',
            scale: settings.scale
          }
        };
      } else {
        return { success: false, error: 'Mock upscale failed' };
      }
    }
  };

  // NEW: Apply adjustments as CSS filters and canvas operations
  const applyImageAdjustments = (ctx: CanvasRenderingContext2D) => {
    if (!hasAdjustments()) return;

    // Build CSS filter string for basic adjustments
    let filterString = '';
    
    // Basic adjustments
    if (imageAdjustments.brightness !== 100) {
      filterString += `brightness(${imageAdjustments.brightness}%) `;
    }
    if (imageAdjustments.contrast !== 100) {
      filterString += `contrast(${imageAdjustments.contrast}%) `;
    }
    if (imageAdjustments.saturation !== 100) {
      filterString += `saturate(${imageAdjustments.saturation}%) `;
    }
    if (imageAdjustments.hue !== 0) {
      filterString += `hue-rotate(${imageAdjustments.hue}deg) `;
    }

    // Advanced adjustments
    if (imageAdjustments.exposure !== 0) {
      // Exposure adjustment by modifying brightness
      const exposureAdjustment = 100 + (imageAdjustments.exposure * 0.8); // Scale down the effect
      filterString += `brightness(${exposureAdjustment}%) `;
    }

    // Apply warmth/tint through hue adjustments
    let warmthHue = 0;
    if (imageAdjustments.warmth !== 0) {
      // Warmth: negative values go towards blue, positive towards orange
      warmthHue += imageAdjustments.warmth * 0.3; // Scale the effect
    }
    if (imageAdjustments.tint !== 0) {
      // Tint: negative values go towards green, positive towards magenta  
      warmthHue += imageAdjustments.tint * 0.2; // Scale the effect
    }
    if (warmthHue !== 0) {
      filterString += `hue-rotate(${warmthHue}deg) `;
    }

    // Vibrance (similar to saturation but more subtle)
    if (imageAdjustments.vibrance !== 0) {
      const vibranceAdjustment = 100 + (imageAdjustments.vibrance * 0.5); // More subtle than saturation
      filterString += `saturate(${vibranceAdjustment}%) `;
    }

    ctx.filter = filterString.trim() || 'none';
  };

  // Tool data with descriptions and video tutorials
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
      description: 'Advanced brush tool with pressure sensitivity, texture brushes, and dynamic effects. Perfect for artistic edits and detailed painting.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: Paintbrush
    },
    remove: {
      name: 'Remove Tool',
      shortcut: 'R',
      description: 'Intelligently removes objects or unwanted areas from your image. Uses AI to seamlessly fill the removed areas with matching content.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: Bandage
    },
    adjust: {
      name: 'Adjustment Tool',
      shortcut: 'A',
      description: 'Comprehensive image adjustments including brightness, contrast, exposure, highlights, shadows, and color grading.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: Sliders
    },
    transform: {
      name: 'Transform Tool',
      shortcut: 'T',
      description: 'Transforms and resizes objects. Scale, rotate, and manipulate your image elements with precision.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: Maximize2
    },
    enhance: {
      name: 'Enhance Tool',
      shortcut: 'E',
      description: 'AI-powered enhancement and upscaling. Improve resolution, detail clarity, and overall image quality.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: TrendingUp
    },
    selection: {
      name: 'Selection Tools',
      shortcut: 'M',
      description: 'Professional selection tools including rectangular, elliptical, lasso, and magic wand. Create precise selections with feathering and anti-aliasing.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: Square
    },
    text: {
      name: 'Text Tool',
      shortcut: 'T',
      description: 'Add and edit text with advanced typography controls, effects, and text warping. Professional text editing capabilities.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: Type
    },
    shape: {
      name: 'Shape Tools',
      shortcut: 'U',
      description: 'Create vector shapes including rectangles, circles, polygons, stars, and custom paths. Full control over fills, strokes, and effects.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      icon: Circle
    }
  };

  // Update current image URL when prop changes
  useEffect(() => {
    if (!imageUrl) return;
    setCurrentImageUrl(imageUrl);
    setCurrentActiveImageUrl(imageUrl);
    setIsSaved(false);

    if (isInternalImageUpdateRef.current) {
      // Internal update: keep history intact
      isInternalImageUpdateRef.current = false;
      console.log('🖼️ Canvas Viewer: Image updated internally, preserving history');
      return;
    }

    // External image load: reset history
    setCurrentHistoryIndex(-1);
    setImageEditHistory([]);
    console.log('🖼️ Canvas Viewer: External image loaded, history reset');
  }, [imageUrl]);

  useEffect(() => {
    if (projectSettings) {
      setActiveProjectSettings(projectSettings);
    }
  }, [projectSettings]);

  // Load and draw image on canvas
  useEffect(() => {
    if (!currentActiveImageUrl || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas to full container size
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      console.log('🎨 Canvas Viewer: Image loaded and drawn', {
        width: img.width,
        height: img.height,
        src: currentActiveImageUrl.substring(0, 50) + '...'
      });
      
      setImageObj(img);
      setImageSize({ width: img.width, height: img.height });
      
      // Initialize layers if empty
      setLayers(prev => {
        if (prev.length === 0) {
          return [{
            id: 'background',
            name: 'Background',
            type: 'background',
            visible: true,
            opacity: 100,
            locked: true,
            blendMode: 'normal'
          }];
        }
        return prev;
      });

      // Center the image on initial load
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      
      // Calculate scale to fit image in view with some padding
      const scaleX = (canvasWidth * 0.8) / img.width;
      const scaleY = (canvasHeight * 0.8) / img.height;
      const initialScale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 100%
      
      setScale(initialScale);
      setTranslateX((canvasWidth - img.width * initialScale) / 2);
      setTranslateY((canvasHeight - img.height * initialScale) / 2);
    };
    
    img.onerror = (error) => {
      console.error('🎨 Canvas Viewer: Failed to load image', error);
    };
    
    img.src = currentActiveImageUrl;
  }, [currentActiveImageUrl]);

  // Handle canvas resize
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    const updateCanvasSize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      
      // Update canvas size state to trigger redraw
      setCanvasSize({ width: rect.width, height: rect.height });
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    
    // Prevent middle mouse button's default auto-scroll behavior
    const handleGlobalMiddleMouseDown = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    };
    
    document.addEventListener('mousedown', handleGlobalMiddleMouseDown, { capture: true, passive: false });
    
    return () => {
      window.removeEventListener('resize', updateCanvasSize);
      document.removeEventListener('mousedown', handleGlobalMiddleMouseDown, true);
    };
  }, [isOpen]);

  // Redraw canvas when state changes
  useEffect(() => {
    renderCompositeCanvas();
  }, [imageObj, scale, translateX, translateY, imageAdjustments, canvasSize, layers]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept space if user is typing in an input field
      const target = e.target as HTMLElement;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true';
      
      if (e.code === 'Space' && !isInputField) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
      
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        setIsShiftPressed(true);
      }

      // Tool shortcuts (only when not typing in input fields)
      if (!isInputField) {
        switch (e.key.toLowerCase()) {
          case 'a':
            if (e.shiftKey) {
              e.preventDefault();
              setShowAdjustPanel(!showAdjustPanel);
            }
            break;
          case 's':
            if (e.shiftKey) {
              e.preventDefault();
              setShowSegmentationPanel(!showSegmentationPanel);
            }
            break;
          case 'e':
            if (e.shiftKey) {
              e.preventDefault();
              setShowEnhancePanel(!showEnhancePanel);
            }
            break;
          case 'r':
            if (e.shiftKey && hasAdjustments()) {
              e.preventDefault();
              resetAdjustments();
            }
            break;
          case 'd':
            if (e.shiftKey && currentSelection) {
              e.preventDefault();
              setCurrentSelection(null);
              console.log('🎯 Selection cleared via Shift+D shortcut');
            }
            break;
          case 'escape':
            e.preventDefault();
            // Close video modal first, then controls dropdown, then panels
            if (showVideoModal) {
              setShowVideoModal(false);
            } else if (showControlsDropdown) {
              setShowControlsDropdown(false);
            } else {
              // Close all open panels
              setShowAdjustPanel(false);
              setShowEnhancePanel(false);
              setShowSegmentationPanel(false);
              setShowTransformPanel(false);
              setShowBrushPanel(false);
              setShowRemovePanel(false);
            }
            break;
          case 'p':
            if (e.shiftKey) {
              e.preventDefault();
              // Reset positions for all open panels
              if (showAdjustPanel) resetPanelPosition();
              if (showEnhancePanel) resetEnhancePanelPosition();
            }
            break;
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Don't intercept space if user is typing in an input field
      const target = e.target as HTMLElement;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true';
      
      if (e.code === 'Space' && !isInputField) {
        e.preventDefault();
        setIsSpacePressed(false);
      }
      
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        setIsShiftPressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedEditMode, hasAdjustments]);

  // Cleanup hover timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);



  // Mouse interaction handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Check if mouse is over any UI element
    const target = e.target as HTMLElement;
    const canvas = canvasRef.current;
    const isDirectlyOverCanvas = canvas && (target === canvas || target.closest('canvas') === canvas);
    
    // Check if mouse is over any UI element that should prevent interactions
    // Only check for specific interactive UI elements, not general styling classes
    const isOverAnyUI = target?.closest(`
      button, input, select, textarea, [role="button"], [role="slider"],
      .brush-modal-ui, [data-ui-element="true"], [data-brush-panel="true"],
      [class*="modal"][class*="bg-"], [class*="panel"][class*="bg-"]
    `.replace(/\s+/g, '')) !== null;
    
    if ((isSpacePressed && e.button === 0) || e.button === 1) { // Space + left click OR middle mouse button for panning
      e.preventDefault();
      e.stopPropagation();
      
      setIsDragging(true);
      setLastMousePos({ x: e.clientX, y: e.clientY });
    } else if (e.ctrlKey && e.button === 0 && isDirectlyOverCanvas) {
      // DEBUG: Test basic drawing functionality
      e.preventDefault();
      testDraw(e);
      return;
    } else if (showBrushPanel && e.button === 0 && isDirectlyOverCanvas && !isOverAnyUI) {
      // INDUSTRY STANDARD: Prevent all browser defaults during brush operations
      e.preventDefault();
      e.stopPropagation();
      
      console.log('🎨 BRUSH CLICK DETECTED:', { 
        showBrushPanel, 
        isDirectlyOverCanvas, 
        isOverAnyUI, 
        target: target.tagName,
        targetClasses: target.className,
        canvas: canvas?.tagName,
        brushHardness: brushSettings.hardness,
        layers: layers.length,
        activeLayerId,
        mousePos: { x: e.clientX, y: e.clientY },
        canvasRect: canvas?.getBoundingClientRect(),
        imageObj: !!imageObj
      });
      
      // Ensure we have an active layer or create one
      let targetLayerId = activeLayerId;
       if (!targetLayerId) {
         // No active layer - create one automatically
         if (layers.length === 0) {
           console.log('🎨 AUTO-CREATING: First layer for drawing');
           const newLayerId = handleCreateNewLayer();
           if (newLayerId) {
             targetLayerId = newLayerId;
           } else {
             console.error('🎨 ERROR: Failed to create new layer');
             return;
           }
         } else {
           // Select the topmost layer
           targetLayerId = layers[layers.length - 1].id;
           setActiveLayerId(targetLayerId);
           console.log('🎨 AUTO-SELECTING: Topmost layer for drawing', targetLayerId);
         }
       }
      
      if (targetLayerId) {
        console.log('🎨 DRAWING START: Using layer', targetLayerId);
        startDrawingOnLayer(e, targetLayerId);
      }
    } else if (isDirectlyOverCanvas && !isOverAnyUI && !showBrushPanel) {
      // Initialize drag state for pan operations (only when not using brush)
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const target = e.target as HTMLElement;
    
    // Check if we're over the canvas (more permissive check)
    const isOverCanvas = target === canvas || target.closest('canvas') === canvas;
    
    // INDUSTRY STANDARD: Always track cursor when brush panel open and over canvas
    if (showBrushPanel && isOverCanvas) {
      // ALWAYS update cursor position - this is the key fix!
      updateBrushCursor(e);
      setShowBrushCursor(true);
      
      // Prevent any interference with cursor tracking during drawing
      if (isDrawing) {
        e.preventDefault(); // Stop browser default behaviors
      }
    } else {
      setShowBrushCursor(false);
    }
    
    // Handle drawing operations - ALWAYS continue drawing when isDrawing is true, regardless of canvas detection
    if (isDrawing && showBrushPanel) {
      console.log('🎨 MOUSE MOVE: Continuing drawing', {
        isDrawing,
        showBrushPanel,
        isOverCanvas,
        target: target.tagName,
        mousePos: { x: e.clientX, y: e.clientY }
      });
      continueDrawing(e);
    }

    // Handle panning when NOT using brush tool
    if (isDragging && !showBrushPanel) {
      const deltaX = e.clientX - lastMousePos.x;
      const deltaY = e.clientY - lastMousePos.y;
      
      
      setTranslateX(prev => prev + deltaX);
      setTranslateY(prev => prev + deltaY);
      
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    if (isDrawing) {
      stopDrawing();
    }
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setShowBrushCursor(false); // Hide brush cursor when leaving canvas
    setIsDrawing(false); // Stop any drawing when leaving canvas
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Check if this is from middle mouse button auto-scroll
    if (e.buttons === 4) { // Middle mouse button held down
      return; // Don't zoom for middle mouse scroll
    }
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(5, scale * zoomFactor));

    // Zoom towards mouse position
    const scaleChange = newScale / scale;
    setTranslateX(prev => mouseX - (mouseX - prev) * scaleChange);
    setTranslateY(prev => mouseY - (mouseY - prev) * scaleChange);
    setScale(newScale);
  };

  // Control functions
  const handleResetView = () => {
    if (!imageObj || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const scaleX = (canvas.width * 0.8) / imageObj.width;
    const scaleY = (canvas.height * 0.8) / imageObj.height;
    const initialScale = Math.min(scaleX, scaleY, 1);
    
    setScale(initialScale);
    setTranslateX((canvas.width - imageObj.width * initialScale) / 2);
    setTranslateY((canvas.height - imageObj.height * initialScale) / 2);
  };

  const handleZoomIn = () => {
    setScale(prev => Math.min(5, prev * 1.2));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(0.1, prev / 1.2));
  };

  const handleDownload = () => {
    if (!currentActiveImageUrl) return;
    
    const link = document.createElement('a');
    link.download = `edited-image-${Date.now()}.png`;
    link.href = currentActiveImageUrl;
    link.click();
  };

  const handleReset = () => {
    if (imageUrl) {
      setCurrentImageUrl(imageUrl);
      setCurrentActiveImageUrl(imageUrl);
      setEditPrompt('');
      resetAdjustments(); // Also reset any applied adjustments
    }
  };

  const handleUndo = () => {
    if (imageEditHistory.length > 0) {
      const newHistory = [...imageEditHistory];
      newHistory.pop();
      setImageEditHistory(newHistory);
      
      if (newHistory.length > 0) {
        const lastEdit = newHistory[newHistory.length - 1];
        setCurrentActiveImageUrl(lastEdit.url);
      } else {
        setCurrentActiveImageUrl(imageUrl);
      }
    }
  };

  // NEW: Apply current adjustments to create a new image
  const applyAdjustmentsToImage = (): string | null => {
    if (!imageObj || !hasAdjustments()) return null;

    // Create a temporary canvas with the original image dimensions
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;

    // Set canvas size to match original image
    tempCanvas.width = imageObj.width;
    tempCanvas.height = imageObj.height;

    // Apply adjustments and draw the image
    if (hasAdjustments()) {
      applyImageAdjustments(tempCtx);
    }
    tempCtx.drawImage(imageObj, 0, 0);

    // Reset filter and get the image data
    tempCtx.filter = 'none';
    const adjustedImageUrl = tempCanvas.toDataURL('image/png');
    
    console.log('🎨 Canvas Viewer: Applied adjustments to image', {
      adjustments: imageAdjustments,
      hasAdjustments: hasAdjustments()
    });

    return adjustedImageUrl;
  };

  // NEW: Handle image enhancement/upscaling
  const handleEnhanceImage = async () => {
    if (!currentActiveImageUrl) {
      console.error('No image to enhance');
      return;
    }

    setIsEnhancing(true);

    try {
      const settings = {
        image_url: currentActiveImageUrl,
        model: selectedUpscaleModel,
        scale: upscaleFactor,
      };

      console.log('🎨 Canvas Viewer: Starting enhancement:', settings);
      const result = await mockUpscaleService.upscaleImage(selectedUpscaleModel, settings);

      if (result.success && result.images && result.images.length > 0) {
        const enhancedImageUrl = result.images[0].url;
        
        // Add to edit history
        addToEditHistory(`Enhanced with ${upscaleModels.find(m => m.id === selectedUpscaleModel)?.name || selectedUpscaleModel}`, 'enhancement');
        
        // Update the current active image
        setCurrentActiveImageUrl(enhancedImageUrl);
        
        // Notify parent component of the update
        if (onImageUpdate) {
          onImageUpdate(enhancedImageUrl);
        }
        
        console.log('🎨 Canvas Viewer: Enhancement completed successfully');
      } else {
        console.error('🎨 Canvas Viewer: Enhancement failed:', result.error);
      }
    } catch (error) {
      console.error('🎨 Canvas Viewer: Enhancement error:', error);
    } finally {
      setIsEnhancing(false);
    }
  };

  const addToEditHistory = (prompt: string, editType: string = 'ai-edit', saveToConversation: boolean = true) => {
    let urlToAdd = currentActiveImageUrl;
    
    // If this is an adjustment edit, apply the adjustments first
    if (editType === 'adjustment' && hasAdjustments()) {
      const adjustedUrl = applyAdjustmentsToImage();
      if (adjustedUrl) {
        urlToAdd = adjustedUrl;
        setCurrentActiveImageUrl(adjustedUrl);
        
        // Only notify parent component if we want to save to conversation
        if (saveToConversation && onImageUpdate) {
          onImageUpdate(adjustedUrl);
        }

        // Reset adjustments after applying them
        resetAdjustments();
      }
    }
    
    if (!urlToAdd) return;
    
    const newEdit = {
      id: `edit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      url: urlToAdd,
      prompt,
      editType,
      timestamp: new Date().toISOString()
    };
    
    // If we're not at the end of history, remove everything after current position
    const newHistory = currentHistoryIndex === -1 
      ? [newEdit] 
      : [...imageEditHistory.slice(0, currentHistoryIndex + 1), newEdit];
    
    setImageEditHistory(newHistory);
    setCurrentHistoryIndex(newHistory.length - 1);
    setIsSaved(false);
    
    console.log('📝 Canvas Viewer: Added to edit history:', {
      prompt,
      editType,
      totalEdits: newHistory.length,
      currentIndex: newHistory.length - 1,
      savedToConversation: saveToConversation
    });
  };

  const handleEditSubmit = async () => {
    if (!editPrompt.trim() || isEditing) return;

    setIsEditing(true);
    
    // Construct the final prompt with style if available
    let finalPrompt = editPrompt.trim();
    if (savedStyle) {
      switch (savedStyle.type) {
        case 'prompt':
          finalPrompt = `${finalPrompt}, in the style of: ${savedStyle.content}`;
          break;
        case 'preset':
          finalPrompt = `${finalPrompt}, in ${savedStyle.content} style`;
          break;
        case 'image':
          finalPrompt = `${finalPrompt}, using the attached style reference image`;
          break;
      }
    }
    
    console.log('🎨 Canvas Viewer: Starting edit with prompt:', finalPrompt);
    console.log('🎨 Canvas Viewer: Style applied:', savedStyle);

    try {
      // CRITICAL FIX: Instead of using the display canvas (which has black background and transforms),
      // create a clean canvas with just the original image data
      if (!imageObj) throw new Error('Image object not available');

      // Create a temporary canvas with the original image dimensions
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) throw new Error('Could not get canvas context');

      // Set canvas size to match original image
      tempCanvas.width = imageObj.width;
      tempCanvas.height = imageObj.height;

      // Draw the original image without any transforms or background
      tempCtx.drawImage(imageObj, 0, 0);

      // Get clean image data
      const imageDataUrl = tempCanvas.toDataURL('image/png');
      console.log('🎨 Canvas Viewer: Clean image data prepared, size:', imageDataUrl.length, 'dimensions:', imageObj.width, 'x', imageObj.height);

      // Send edit request to backend using the correct endpoint
      const response = await fetch('/api/chat/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task: 'edit_image',
          imageData: imageDataUrl,
          prompt: finalPrompt,
          model: selectedModel,
          outputFormat: 'png',
          quality: 'auto',
          size: 'auto',
          background: 'auto'
        }),
      });

      if (!response.ok) {
        throw new Error(`Edit request failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('🎨 Canvas Viewer: Edit successful', result);

      if (result.imageData) {
        const newImageUrl = `data:image/png;base64,${result.imageData}`;
        setCurrentImageUrl(newImageUrl);
        setCurrentActiveImageUrl(newImageUrl);
        
        // Add to edit history
        addToEditHistory(finalPrompt, 'ai-edit');
        
        // Notify parent component of the update
        if (onImageUpdate) {
          onImageUpdate(newImageUrl);
        }
        
        console.log('🎨 Canvas Viewer: Image updated successfully');
      } else {
        console.error('🎨 Canvas Viewer: No imageData in response:', result);
      }

      setEditPrompt('');
    } catch (error) {
      console.error('🎨 Canvas Viewer: Edit failed:', error);
    } finally {
      setIsEditing(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSubmit();
    }
  };

  const handleToggleEditTools = () => {
    if (showEditTools) {
      setIsClosingTools(true);
      setIsAnimatingTools(true);
      setTimeout(() => {
        setShowEditTools(false);
        setIsAnimatingTools(false);
        setIsClosingTools(false);
      }, 500);
    } else {
      setShowEditTools(true);
      setIsAnimatingTools(true);
      setTimeout(() => {
        setIsAnimatingTools(false);
      }, 500);
    }
  };

  const handleToolHover = (toolKey: string) => {
    // Don't show tooltips when any exclusive container is open
    if (isStyleModalOpen || showRelightInput || showBackgroundInput || isModelDropdownOpen || showBackgroundSubButtons) {
      return;
    }
    
    // Clear any existing timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoveredTool(toolKey);
  };

  // Separate hover handler for edit tools to prevent left panel preview
  const handleEditToolHover = (toolKey: string) => {
    // Don't show tooltips when any exclusive container is open
    if (isStyleModalOpen || showRelightInput || showBackgroundInput || isModelDropdownOpen || showBackgroundSubButtons) {
      return;
    }
    
    // Set hovered edit tool (separate from left tools hoveredTool)
    setHoveredEditTool(toolKey);
    
    // For non-adjust tools, also set the main hoveredTool for compatibility
    if (toolKey !== 'adjust') {
      // Clear any existing timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      setHoveredTool(toolKey);
    }
  };

  const handleEditToolLeave = () => {
    // Clear edit tool hover
    setHoveredEditTool(null);
    
    // Add a delay before hiding the main preview (for non-adjust tools)
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredTool(null);
    }, 150);
  };

  const handleToolLeave = () => {
    // Add a delay before hiding the preview
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredTool(null);
    }, 300); // 300ms delay
  };

  const handleTooltipHover = () => {
    // Keep tooltip visible when hovering over it
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  const handleTooltipLeave = () => {
    // Hide tooltip when leaving it
    setHoveredTool(null);
  };

  const handlePreviewHover = () => {
    // Clear timeout when hovering over preview
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  const handlePreviewLeave = () => {
    // Hide preview when leaving preview container
    setHoveredTool(null);
  };

  const handleVideoModalOpen = (videoUrl: string) => {
    setCurrentVideoUrl(videoUrl);
    setShowVideoModal(true);
  };

  const handleHistoryImageClick = (historyItem: {id: string, url: string, prompt: string}) => {
    console.log('🎯 Edit history layer clicked:', historyItem.id);
    
    // Find the index of this layer in the history
    const layerIndex = imageEditHistory.findIndex(edit => edit.id === historyItem.id);
    
    if (layerIndex !== -1) {
      setCurrentHistoryIndex(layerIndex);
    setCurrentActiveImageUrl(historyItem.url);
      setSelectedLayerId(historyItem.id);
      setIsSaved(false);
      
      const layerInfo = getLayerInfo(historyItem.id);
      console.log('📍 Selected:', layerInfo.displayName, '(', historyItem.id, ')');
    } else {
      console.log('❌ Layer not found in history:', historyItem.id);
    }
  };

  const handleEmptyLayerClick = (layer: {id: string, name: string, type: string}) => {
    console.log('🎯 Empty layer clicked:', layer.id, layer.name);
    
    // Select the empty layer
    setSelectedLayerId(layer.id);
    // Clear history selection since we're selecting an empty layer
    setCurrentHistoryIndex(-1);
    
    const layerInfo = getLayerInfo(layer.id);
    console.log('📍 Selected:', layerInfo.displayName, '(', layer.id, ')');
  };

  // Navigate through edit history
  const handleUndoEdit = () => {
    console.log('🔄 Undo attempt - current index:', currentHistoryIndex, 'history length:', imageEditHistory.length, 'canUndo:', canUndo, 'hasAdjustments:', hasAdjustments());
    
    // If we have unsaved adjustments, reset them first
    if (hasAdjustments()) {
      console.log('↶ Resetting unsaved adjustments');
      resetAdjustments();
      setIsSaved(false);
      return;
    }
    
    // Otherwise, navigate through edit history
    if (canUndo && currentHistoryIndex >= 0) {
      const newIndex = currentHistoryIndex - 1;
      setCurrentHistoryIndex(newIndex);
      
      if (newIndex === -1) {
        // Go back to original image
        console.log('↶ Going back to original image:', imageUrl);
        setCurrentActiveImageUrl(imageUrl);
      } else {
        // Go to previous edit
        console.log('↶ Going to previous edit at index:', newIndex, 'url:', imageEditHistory[newIndex].url.substring(0, 50) + '...');
        setCurrentActiveImageUrl(imageEditHistory[newIndex].url);
      }
      setIsSaved(false);
      
      console.log('↶ Canvas Viewer: Undo edit - moved to index:', newIndex, 'total history:', imageEditHistory.length);
    } else {
      console.log('❌ Cannot undo - currentIndex:', currentHistoryIndex, 'canUndo:', canUndo);
    }
  };

  const handleRedoEdit = () => {
    if (currentHistoryIndex < imageEditHistory.length - 1) {
      const newIndex = currentHistoryIndex + 1;
      setCurrentHistoryIndex(newIndex);
      setCurrentActiveImageUrl(imageEditHistory[newIndex].url);
      setIsSaved(false);
      
      console.log('↷ Canvas Viewer: Redo edit - moved to index:', newIndex, 'total history:', imageEditHistory.length);
    }
  };

  // Check if undo/redo is available
  // Can undo if we have unsaved adjustments OR if we're not at the original image and have history
  const canUndo = hasAdjustments() || (currentHistoryIndex >= 0 && imageEditHistory.length > 0);
  // Can redo if we're not at the latest edit
  const canRedo = currentHistoryIndex < imageEditHistory.length - 1;

  // NEW: Model Selection Functions
  const toggleModelDropdown = () => {
    setIsModelDropdownOpen(!isModelDropdownOpen);
  };

  const handleModelSelect = (modelId: 'seededit-v3' | 'gpt-image-1' | 'flux-kontext' | 'step1x-edit' | 'ideogram-v2-edit') => {
    setSelectedModel(modelId);
    setIsModelDropdownOpen(false);
  };

  // NEW: Style Modal Functions
  const toggleStyleModal = () => {
    setIsStyleModalOpen(!isStyleModalOpen);
  };

  const handleStyleImageUpload = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    styleFileInputRef.current?.click();
  };

  const handleStyleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setStyleReferenceImage(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        setStyleImagePreview(e.target.result as string);
      }
    };
    reader.readAsDataURL(file);

    if (event.target) {
      event.target.value = '';
    }
  };

  const handleStyleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
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

  const handleStyleSave = () => {
    if (activeStyleTab === 'image' && styleReferenceImage && styleImagePreview) {
      setSavedStyle({
        type: 'image',
        content: styleImagePreview,
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
        'oil-painting': 'Oil Paint',
        'watercolor': 'Watercolor',
        'digital-art': 'Digital',
        'anime': 'Anime',
        'cyberpunk': 'Cyberpunk',
        'vintage': 'Vintage',
        'minimalist': 'Minimal'
      };
      setSavedStyle({
        type: 'preset',
        content: selectedStylePreset,
        name: presetNames[selectedStylePreset as keyof typeof presetNames] || selectedStylePreset
      });
    }
    setIsStyleModalOpen(false);
  };

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

  const handleClearAllStyle = () => {
    setSavedStyle(null);
    handleRemoveStyleImage();
    setStylePromptText('');
    setSelectedStylePreset(null);
  };

  // NEW: Relight Functions
  const handleRelightSubmit = async () => {
    if (!relightPrompt.trim() || isRelighting) return;

    setIsRelighting(true);
    
    try {
      // Get the current image from canvas as base64
      if (!imageObj) throw new Error('Image object not available');

      // Create a temporary canvas with the original image dimensions
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) throw new Error('Could not get canvas context');

      // Set canvas size to match original image
      tempCanvas.width = imageObj.width;
      tempCanvas.height = imageObj.height;

      // Draw the original image without any transforms or background
      tempCtx.drawImage(imageObj, 0, 0);

      // Get clean image data
      const imageDataUrl = tempCanvas.toDataURL('image/png');
      
      console.log('🔥 Starting IC-Light-v2 relight with prompt:', relightPrompt.trim());

      // Send request to IC-Light-v2 via our backend
      const response = await fetch('/api/chat/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task: 'iclight_relight',
          imageData: imageDataUrl,
          prompt: relightPrompt.trim(),
          model: 'fal-ai/iclight-v2',
          // IC-Light-v2 specific parameters
          image_size: 'square_hd',
          num_inference_steps: 28,
          guidance_scale: 5,
          cfg: 1,
          lowres_denoise: 0.98,
          enable_hr_fix: false,
          sync_mode: true,
          num_images: 1,
          output_format: 'png',
          enable_safety_checker: true,
          negative_prompt: '',
          initial_latent: 'None'
        }),
      });

      if (!response.ok) {
        throw new Error(`IC-Light-v2 request failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('🔥 IC-Light-v2 relight successful', result);

      if (result.imageData) {
        const newImageUrl = `data:image/png;base64,${result.imageData}`;
        setCurrentImageUrl(newImageUrl);
        setCurrentActiveImageUrl(newImageUrl);
        
        // Add to edit history with relight-specific type
        addToEditHistory(`Relight: ${relightPrompt.trim()}`, 'ic-light-relight');
        
        // Notify parent component of the update
        if (onImageUpdate) {
          onImageUpdate(newImageUrl);
        }
        
        console.log('🔥 IC-Light-v2: Image updated successfully');
      } else if (result.images && result.images.length > 0) {
        // Handle fal.ai response format
        const imageUrl = result.images[0].url;
        
        // Convert external URL to base64 for consistency
        const imageResponse = await fetch(imageUrl);
        const imageBlob = await imageResponse.blob();
        const reader = new FileReader();
        
        reader.onload = () => {
          const base64Data = reader.result as string;
          setCurrentImageUrl(base64Data);
          setCurrentActiveImageUrl(base64Data);
          
          // Add to edit history
          addToEditHistory(`Relight: ${relightPrompt.trim()}`, 'ic-light-relight');
          
          // Notify parent component
          if (onImageUpdate) {
            onImageUpdate(base64Data);
          }
          
          console.log('🔥 IC-Light-v2: Image updated from URL successfully');
        };
        
        reader.readAsDataURL(imageBlob);
      } else {
        console.error('🔥 IC-Light-v2: No image data in response:', result);
        throw new Error('No image data received from IC-Light-v2');
      }

      // Clear the relight input after successful submission
      setRelightPrompt('');
      setShowRelightInput(false);
      
    } catch (error) {
      console.error('🔥 IC-Light-v2 relight failed:', error);
      // You might want to show an error message to the user here
    } finally {
      setIsRelighting(false);
    }
  };

  const handleRelightKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRelightSubmit();
    }
  };

  // NEW: Background Functions
  const handleBackgroundSubmit = async () => {
    if (!backgroundPrompt.trim() || isBackgrounding) return;

    setIsBackgrounding(true);
    
    try {
      // Get the current image from canvas as base64
      if (!imageObj) throw new Error('Image object not available');

      // Create a temporary canvas with the original image dimensions
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) throw new Error('Could not get canvas context');

      // Set canvas size to match original image
      tempCanvas.width = imageObj.width;
      tempCanvas.height = imageObj.height;

      // Draw the original image without any transforms or background
      tempCtx.drawImage(imageObj, 0, 0);

      // Get clean image data
      const imageDataUrl = tempCanvas.toDataURL('image/png');
      
      console.log('🌄 Starting IC-Light-v2 background change with prompt:', backgroundPrompt.trim());

      // Send request to IC-Light-v2 via our backend for background change
      const response = await fetch('/api/chat/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task: 'iclight_background',
          imageData: imageDataUrl,
          prompt: backgroundPrompt.trim(),
          model: 'fal-ai/iclight-v2',
          // IC-Light-v2 specific parameters for background change
          image_size: 'square_hd',
          num_inference_steps: 28,
          guidance_scale: 5,
          cfg: 1,
          lowres_denoise: 0.98,
          enable_hr_fix: false,
          sync_mode: true,
          num_images: 1,
          output_format: 'png',
          enable_safety_checker: true,
          negative_prompt: '',
          initial_latent: 'None',
          // For background change, we might need different settings
          background_threshold: 0.67
        }),
      });

      if (!response.ok) {
        throw new Error(`IC-Light-v2 background change failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('🌄 IC-Light-v2 background change successful', result);

      if (result.imageData) {
        const newImageUrl = `data:image/png;base64,${result.imageData}`;
        setCurrentImageUrl(newImageUrl);
        setCurrentActiveImageUrl(newImageUrl);
        
        // Add to edit history with background-specific type
        addToEditHistory(`Background: ${backgroundPrompt.trim()}`, 'ic-light-background');
        
        // Notify parent component of the update
        if (onImageUpdate) {
          onImageUpdate(newImageUrl);
        }
        
        console.log('🌄 IC-Light-v2: Background updated successfully');
      } else if (result.images && result.images.length > 0) {
        // Handle fal.ai response format
        const imageUrl = result.images[0].url;
        
        // Convert external URL to base64 for consistency
        const imageResponse = await fetch(imageUrl);
        const imageBlob = await imageResponse.blob();
        const reader = new FileReader();
        
        reader.onload = () => {
          const base64Data = reader.result as string;
          setCurrentImageUrl(base64Data);
          setCurrentActiveImageUrl(base64Data);
          
          // Add to edit history
          addToEditHistory(`Background: ${backgroundPrompt.trim()}`, 'ic-light-background');
          
          // Notify parent component
          if (onImageUpdate) {
            onImageUpdate(base64Data);
          }
          
          console.log('🌄 IC-Light-v2: Background updated from URL successfully');
        };
        
        reader.readAsDataURL(imageBlob);
      } else {
        console.error('🌄 IC-Light-v2: No image data in response:', result);
        throw new Error('No image data received from IC-Light-v2 background change');
      }

      // Clear the background input after successful submission
      setBackgroundPrompt('');
      setShowBackgroundInput(false);
      
    } catch (error) {
      console.error('🌄 IC-Light-v2 background change failed:', error);
      // You might want to show an error message to the user here
    } finally {
      setIsBackgrounding(false);
    }
  };

  const handleBackgroundKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleBackgroundSubmit();
    }
  };

  // NEW: Reframe Functions
  const handleReframeSubmit = async () => {
    if (isReframing) return;

    setIsReframing(true);
    const previousUrlBeforeReframe = currentActiveImageUrl;
    
    try {
      // Get the current image from canvas as base64
      if (!imageObj) throw new Error('Image object not available');

      // Create a temporary canvas with the original image dimensions
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) throw new Error('Could not get canvas context');

      // Set canvas size to match original image
      tempCanvas.width = imageObj.width;
      tempCanvas.height = imageObj.height;

      // Draw the original image without any transforms or background
      tempCtx.drawImage(imageObj, 0, 0);

      // Get clean image data
      const imageDataUrl = tempCanvas.toDataURL('image/png');
      
      console.log('🖼️ Starting reframe operation with size:', `${reframeWidth}x${reframeHeight}`);

      // For Ideogram API, we need a publicly accessible URL
      // Let's use a simple approach: convert to base64 and send directly
      // or use a public image hosting service
      
      // For now, let's try using the base64 data directly
      // Remove the data:image/png;base64, prefix
      const base64Data = imageDataUrl.split(',')[1];
      
      console.log('🖼️ Using base64 image data for reframe...');
      
      // We'll send the base64 data directly to our backend
      // which will handle the public URL conversion

      // Determine image size based on aspect ratio and dimensions
      let imageSize;
      if (reframeAspectRatio === 'landscape-16-9') {
        imageSize = 'landscape_16_9';
      } else if (reframeAspectRatio === 'portrait-9-16') {
        imageSize = 'portrait_16_9';
      } else if (reframeAspectRatio === 'square-1-1') {
        imageSize = 'square_hd';
      } else if (reframeAspectRatio === 'landscape-4-3') {
        imageSize = 'landscape_4_3';
      } else if (reframeAspectRatio === 'portrait-3-4') {
        imageSize = 'portrait_4_3';
      } else {
        // Custom size - use object format with width and height
        imageSize = {
          width: reframeWidth,
          height: reframeHeight
        };
      }

      // Call Ideogram V3 reframe API with base64 data
      const requestBody = {
        image_data: base64Data,
        image_size: imageSize,
        rendering_speed: 'BALANCED',
        num_images: 1,
        sync_mode: true
      };
      
      console.log('🖼️ Sending reframe request with base64 data...');
      
      const response = await fetch('/api/ideogram-reframe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('🖼️ Reframe API error response:', errorText);
        throw new Error(`Reframe operation failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('🖼️ Reframe operation successful', result);

      if (result.images && result.images.length > 0) {
        // Handle Ideogram V3 response format
        const reframedImageUrl = result.images[0].url;
        
        // Load the new image
        const newImage = new Image();
        newImage.crossOrigin = 'anonymous';
        
        newImage.onload = () => {
          // Update canvas with new image
          if (canvasRef.current) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              // Clear canvas
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              
              // Calculate new dimensions to fit canvas while maintaining aspect ratio
              const canvasAspect = canvas.width / canvas.height;
              const imageAspect = newImage.width / newImage.height;
              
              let drawWidth, drawHeight, offsetX, offsetY;
              
              if (imageAspect > canvasAspect) {
                // Image is wider than canvas
                drawWidth = canvas.width;
                drawHeight = canvas.width / imageAspect;
                offsetX = 0;
                offsetY = (canvas.height - drawHeight) / 2;
              } else {
                // Image is taller than canvas
                drawHeight = canvas.height;
                drawWidth = canvas.height * imageAspect;
                offsetX = (canvas.width - drawWidth) / 2;
                offsetY = 0;
              }
              
              // Draw the new image
              ctx.drawImage(newImage, offsetX, offsetY, drawWidth, drawHeight);
              
              // Update image object reference
              setImageObj(newImage);
              
              // Update the main image URL for local state and parent component
              // Add BOTH the previous state (if not the original) and the new reframed image to history
              const makeHistoryItem = (url: string, prompt: string, editType: string) => ({
                id: `edit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                url,
                prompt,
                editType,
                timestamp: new Date().toISOString()
              });

              // Base history up to current index
              const baseHistory = currentHistoryIndex === -1
                ? [...imageEditHistory]
                : [...imageEditHistory.slice(0, currentHistoryIndex + 1)];

              const updatedHistory: typeof imageEditHistory = [...baseHistory];

              // Store the immediate previous state as a history step (avoid duplicates)
              if (previousUrlBeforeReframe) {
                const alreadyPresent = updatedHistory.some(h => h.url === previousUrlBeforeReframe);
                if (!alreadyPresent) {
                  updatedHistory.push(
                    makeHistoryItem(previousUrlBeforeReframe, 'Before reframe', 'reframe-before')
                  );
                }
              }

              // Store the new reframed output (avoid immediate duplicate)
              const lastItem = updatedHistory[updatedHistory.length - 1];
              if (!lastItem || lastItem.url !== reframedImageUrl) {
                updatedHistory.push(
                  makeHistoryItem(reframedImageUrl, `Reframe: ${reframeWidth}x${reframeHeight}`, 'reframe')
                );
              }

              setImageEditHistory(updatedHistory);
              setCurrentHistoryIndex(updatedHistory.length - 1);
              setIsSaved(false);

              // Now update active image and notify parent (after history is updated) to avoid a duplicate add
              isInternalImageUpdateRef.current = true;
              setCurrentActiveImageUrl(reframedImageUrl);
              if (onImageUpdate) {
                onImageUpdate(reframedImageUrl);
              }
              
              console.log('🖼️ Reframe: Image updated successfully from Ideogram V3');
            }
          }
        };
        
        newImage.onerror = () => {
          throw new Error('Failed to load reframed image');
        };
        
        newImage.src = reframedImageUrl;
      } else {
        throw new Error('Reframe API returned invalid response');
      }
      
      setShowReframeInput(false);
      
    } catch (error) {
      console.error('🖼️ Reframe operation failed:', error);
      // Show error message to user (you can replace this with a proper toast notification)
      alert('Failed to reframe image. Please try again.');
    } finally {
      setIsReframing(false);
      // Always close the reframe input to prevent infinite loops
      setShowReframeInput(false);
    }
  };



  // NEW: Handle panel toggling for multiple panels
  const handlePanelToggle = (toolKey: string) => {
    switch (toolKey) {
      case 'model':
        // Close other exclusive containers first
        setShowRelightInput(false);
        setShowBackgroundInput(false);
        setShowBackgroundSubButtons(false);
        setIsStyleModalOpen(false);
        // Toggle model dropdown
        toggleModelDropdown();
        break;
      case 'retouch':
        // Close other exclusive containers first
        setShowBackgroundInput(false);
        setShowBackgroundSubButtons(false);
        setShowReframeInput(false);
        setIsStyleModalOpen(false);
        setIsModelDropdownOpen(false);
        // Toggle relight input
        setShowRelightInput(!showRelightInput);
        break;
      case 'reframe':
        // Close other exclusive containers first
        setShowRelightInput(false);
        setShowBackgroundInput(false);
        setShowBackgroundSubButtons(false);
        setIsStyleModalOpen(false);
        setIsModelDropdownOpen(false);
        // Toggle reframe input
        setShowReframeInput(!showReframeInput);
        break;
      case 'background':
        // Close other exclusive containers first
        setShowRelightInput(false);
        setShowReframeInput(false);
        setIsStyleModalOpen(false);
        setIsModelDropdownOpen(false);
        setShowBackgroundInput(false);
        // Only toggle sub-buttons, not the input directly
        setShowBackgroundSubButtons(!showBackgroundSubButtons);
        break;
      case 'style':
        // Close other exclusive containers first
        setShowRelightInput(false);
        setShowReframeInput(false);
        setShowBackgroundInput(false);
        setShowBackgroundSubButtons(false);
        setIsModelDropdownOpen(false);
        // Toggle style modal
        toggleStyleModal();
        break;
      case 'adjust':
        // Close other exclusive containers first
        setShowRelightInput(false);
        setShowReframeInput(false);
        setShowBackgroundInput(false);
        setShowBackgroundSubButtons(false);
        setIsStyleModalOpen(false);
        setIsModelDropdownOpen(false);
        // Toggle main adjust panel (from left tools panel)
        setShowAdjustPanel(!showAdjustPanel);
        if (!showAdjustPanel) {
          bringPanelToFront('adjust');
        }
        break;
      case 'enhance':
        setShowEnhancePanel(!showEnhancePanel);
        break;
      case 'segmentation':
        setShowSegmentationPanel(!showSegmentationPanel);
        break;
      case 'transform':
        setShowTransformPanel(!showTransformPanel);
        break;
      case 'brush':
        console.log('🎨 BRUSH TOOL: Current state:', { showBrushPanel, imageUrl: !!imageUrl });
        const newBrushState = !showBrushPanel;
        setShowBrushPanel(newBrushState);
        console.log('🎨 BRUSH TOOL: Setting showBrushPanel to:', newBrushState);
        if (newBrushState) {
          setSelectedTool('brush'); // Set for consistency, but drawing works based on showBrushPanel
          // Ensure brush uses current primary color
          setBrushSettings(prev => ({ ...prev, color: primaryColor }));
          bringPanelToFront('brush');
          console.log('🎨 BRUSH TOOL: Activated with primary color:', primaryColor);
        }
        break;
      case 'remove':
        setShowRemovePanel(!showRemovePanel);
        break;
      case 'selection':
        console.log('🎯 SELECTION TOOL: Current state:', { showSelectionPanel, imageUrl: !!imageUrl });
        const newState = !showSelectionPanel;
        setShowSelectionPanel(newState);
        console.log('🎯 SELECTION TOOL: Setting showSelectionPanel to:', newState);
        break;
      case 'text':
        setShowTextPanel(!showTextPanel);
        break;

      case 'shape':
        setShowShapePanel(!showShapePanel);
        break;
      default:
        // For tools without panels, just set as selected mode
        setSelectedEditMode(toolKey as any);
        break;
    }
  };

  // NEW: Layers Functions
  const handleLayersToggle = () => {
    if (isLayersDetached) {
      // If detached, close the modal
      setIsLayersDetached(false);
      setSelectedLayerId(null);
      setCurrentHistoryIndex(-1);
    } else if (!isLayersOpen) {
      // Opening: Start animation immediately, show content after delay
      setIsLayersOpen(true);
      setIsLayersAnimating(true);
      setTimeout(() => {
        setIsLayersAnimating(false);
      }, 300); // Match the CSS transition duration
    } else {
      // Closing: Hide content immediately, then close
      setIsLayersAnimating(true);
      setTimeout(() => {
        setIsLayersOpen(false);
        setIsLayersAnimating(false);
        setSelectedLayerId(null);
        setCurrentHistoryIndex(-1);
      }, 100); // Short delay for content to fade out
    }
  };

  const handleLayersDetach = (position: { x: number; y: number }, dragOffset?: { x: number; y: number }) => {
    setIsLayersDetached(true);
    setIsLayersOpen(false);
    
    // Use the provided drag offset or calculate a reasonable default
    const mouseOffset = dragOffset || { x: 128, y: 20 }; // Default offset if none provided
    
    console.log('🎨 LAYERS: Starting detach with:', { 
      position, 
      dragOffset: mouseOffset
    });
    
    // Set initial position - this is already correctly calculated in the detach function
    setLayersModalPosition({
      x: position.x,
      y: position.y
    });
    
    // Start dragging the modal immediately
    setIsDraggingLayersModal(true);
    
    // Add global mouse move handler for immediate dragging
    const handleImmediateDrag = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Calculate new position based on current cursor position minus the drag offset
      const newX = e.clientX - mouseOffset.x;
      const newY = e.clientY - mouseOffset.y;
      
      console.log('🔧 DRAG DEBUG:', {
        cursor: { x: e.clientX, y: e.clientY },
        offset: mouseOffset,
        calculated: { x: newX, y: newY },
        before_constraints: { x: newX, y: newY }
      });
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelWidth = 256;
      const panelHeight = 384;
      
      const constrainedX = Math.max(0, Math.min(newX, viewportWidth - panelWidth));
      const constrainedY = Math.max(0, Math.min(newY, viewportHeight - panelHeight));
      
      console.log('🔧 CONSTRAINTS:', {
        viewport: { width: viewportWidth, height: viewportHeight },
        panel: { width: panelWidth, height: panelHeight },
        constrained: { x: constrainedX, y: constrainedY },
        changed: { 
          x: constrainedX !== newX, 
          y: constrainedY !== newY 
        }
      });
      
      setLayersModalPosition({ x: constrainedX, y: constrainedY });
    };
    
    const handleImmediateMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingLayersModal(false);
      document.removeEventListener('mousemove', handleImmediateDrag, true);
      document.removeEventListener('mouseup', handleImmediateMouseUp, true);
    };
    
    // Use capture phase to ensure we get the events before any other handlers
    document.addEventListener('mousemove', handleImmediateDrag, true);
    document.addEventListener('mouseup', handleImmediateMouseUp, true);
  };

  const handleLayersReattach = () => {
    // Set reattaching state to disable animation
    setIsLayersReattaching(true);
    setIsLayersDetached(false);
    setIsLayersOpen(true);
    setIsModalOverlappingButton(false);
    
    // Reset reattaching state after a short delay to allow immediate positioning
    setTimeout(() => {
      setIsLayersReattaching(false);
    }, 50);
    
    console.log('🎨 LAYERS: Reattached layers modal to container');
  };

  const handleModalOverlapChange = (isOverlapping: boolean) => {
    setIsModalOverlappingButton(isOverlapping);
  };

  // NEW: Color palette functions
  const handleColorPaletteToggle = () => {
    console.log('🎨 Color palette toggle clicked! Current state:', isColorPaletteOpen);
    setIsColorPaletteOpen(!isColorPaletteOpen);
    console.log('🎨 Color palette should now be:', !isColorPaletteOpen);
  };

  const handleColorSelect = (colorType: 'primary' | 'secondary', event?: React.MouseEvent) => {
    console.log('🎨 Color button clicked:', colorType);
    console.log('🎨 Current state before:', { isColorPickerOpen, colorPickerType, primaryColor, secondaryColor });
    
    // Position the color picker at the top-right of the clicked button
    if (event) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const position = {
        x: rect.right + 10, // Position to the right of the button
        y: 50               // Position near the top of the screen
      };
      console.log('🎨 Setting position:', position, 'Button rect:', rect);
      setColorPickerPosition(position);
    }
    
    setColorPickerType(colorType);
    setIsColorPickerOpen(true);
    bringPanelToFront('colorPicker');
    
    console.log('🎨 Color picker should be opening now...');
  };

  const handleColorChange = (color: string) => {
    if (colorPickerType === 'primary') {
      setPrimaryColor(color);
      // Always update brush color when primary color changes
      setBrushSettings(prev => ({ ...prev, color }));
      console.log('🎨 Updated brush color to:', color);
    } else {
      setSecondaryColor(color);
    }
  };

  const handleColorPickerClose = () => {
    setIsColorPickerOpen(false);
  };

  // NEW: Tab menu functions
  const handleTabMenuToggle = () => {
    console.log('📋 Tab menu toggle clicked');
    setIsTabMenuOpen(!isTabMenuOpen);
  };

  const handleMenuItemClick = (menuItem: string) => {
    console.log('📋 Menu item clicked:', menuItem);

    if (menuItem === 'view') {
      setIsViewDropdownOpen(!isViewDropdownOpen);
      setIsFileDropdownOpen(false); // Close other dropdowns
    } else if (menuItem === 'file') {
      setIsFileDropdownOpen(!isFileDropdownOpen);
      setIsViewDropdownOpen(false); // Close other dropdowns
    }
    // TODO: Add Image menu logic
  };

  // CRITICAL FIX: Ensure tools are always visible when image is loaded
  useEffect(() => {
    if (imageUrl && !uiVisibility.tools) {
      console.log('🔧 AUTO-FIX: Enabling tools visibility for loaded image');
      setUiVisibility(prev => ({ ...prev, tools: true }));
    }
  }, [imageUrl]);

  // Sync brush color with primary color
  useEffect(() => {
    setBrushSettings(prev => ({ ...prev, color: primaryColor }));
    console.log('🎨 Synced brush color with primary color:', primaryColor);
  }, [primaryColor]);

  // NEW: Handle view dropdown toggle
  const handleViewDropdownToggle = () => {
    setIsViewDropdownOpen(!isViewDropdownOpen);
  };

  // NEW: Handle UI element visibility toggle
  const handleUiToggle = (elementKey: string) => {
    setUiVisibility(prev => {
      const newState = {
        ...prev,
        [elementKey]: !prev[elementKey as keyof typeof prev]
      };
      console.log('👁️ Toggled visibility for:', elementKey, 'New state:', newState[elementKey as keyof typeof newState]);
      return newState;
    });
  };

  // NEW: File menu handlers
  const handleNewFile = () => {
    console.log('📄 New File clicked');
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('You have unsaved changes. Create a new file?');
      if (!confirmed) return;
    }
    // Reset to blank canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = activeProjectSettings?.backgroundColor || '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        setCurrentImageUrl(canvas.toDataURL('image/png'));
        resetEditHistory();
      }
    }
    setIsFileDropdownOpen(false);
  };

  const handleOpenFile = () => {
    console.log('📂 Open File clicked');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const imageUrl = event.target?.result as string;
          setCurrentImageUrl(imageUrl);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
    setIsFileDropdownOpen(false);
  };

  const handleSaveFile = () => {
    console.log('💾 Save File clicked');
    handleSaveClick();
    setIsFileDropdownOpen(false);
  };

  const handleExportFile = (format: 'png' | 'jpg' | 'webp') => {
    console.log('📥 Export as', format);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const mimeType = format === 'jpg' ? 'image/jpeg' : `image/${format}`;
    const link = document.createElement('a');
    link.download = `canvas-export.${format}`;
    link.href = canvas.toDataURL(mimeType, 0.95);
    link.click();
    setIsFileDropdownOpen(false);
  };

  const handleCloseFile = () => {
    console.log('❌ Close File clicked');
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('You have unsaved changes. Close anyway?');
      if (!confirmed) return;
    }
    onClose();
    setIsFileDropdownOpen(false);
  };

  const handleSaveAsProject = () => {
    console.log('💾 Save As Project clicked');

    try {
      const canvas = canvasRef.current;
      if (!canvas) {
        alert('No canvas available to save');
        return;
      }

      // Create project data object
      const projectData = {
        version: '1.0',
        type: 'xenolabs-image-project',
        timestamp: Date.now(),
        project: {
          name: activeProjectSettings?.name || 'Untitled Project',
          width: activeProjectSettings?.width || canvas.width,
          height: activeProjectSettings?.height || canvas.height,
          backgroundColor: activeProjectSettings?.backgroundColor || '#ffffff'
        },
        canvas: {
          imageData: canvas.toDataURL('image/png'),
          width: canvas.width,
          height: canvas.height
        },
        history: {
          edits: editHistory.length,
          currentIndex: currentEditIndex
        },
        metadata: {
          created: Date.now(),
          lastModified: Date.now(),
          application: 'Xenolabs Image Studio',
          version: '1.0'
        }
      };

      // Convert to JSON and create blob
      const jsonString = JSON.stringify(projectData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      // Download file
      const link = document.createElement('a');
      link.href = url;
      link.download = `${activeProjectSettings?.name || 'project'}.xenproject`;
      link.click();

      // Cleanup
      URL.revokeObjectURL(url);

      console.log('✅ Project saved successfully');
      setIsFileDropdownOpen(false);
    } catch (error) {
      console.error('❌ Error saving project:', error);
      alert('Failed to save project file');
    }
  };

  const handleImportProject = () => {
    console.log('📂 Import Project clicked');

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xenproject,application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const projectData = JSON.parse(text);

        // Validate project file
        if (projectData.type !== 'xenolabs-image-project') {
          alert('Invalid project file format');
          return;
        }

        console.log('📂 Loading project:', projectData.project.name);

        // Restore project settings
        if (projectData.project) {
          setActiveProjectSettings({
            name: projectData.project.name,
            width: projectData.project.width,
            height: projectData.project.height,
            backgroundColor: projectData.project.backgroundColor
          });
        }

        // Load canvas image
        if (projectData.canvas?.imageData) {
          setCurrentImageUrl(projectData.canvas.imageData);

          // The image will be loaded by the existing useEffect that watches currentImageUrl
          console.log('✅ Project loaded successfully');
        }

        setIsFileDropdownOpen(false);
      } catch (error) {
        console.error('❌ Error loading project:', error);
        alert('Failed to load project file. Make sure it\'s a valid .xenproject file.');
      }
    };

    input.click();
    setIsFileDropdownOpen(false);
  };

  // NEW: Check if there are unsaved changes
  
  const getParScaleX = () => {
    if (!activeProjectSettings?.pixelAspectRatio) return 1;
    if (activeProjectSettings.pixelAspectRatio.includes('D1/DV PAL (1.09)')) return 1.09;
    if (activeProjectSettings.pixelAspectRatio.includes('D1/DV NTSC (0.91)')) return 0.91;
    if (activeProjectSettings.pixelAspectRatio.includes('Anamorphic 2:1 (2.0)')) return 2.0;
    if (activeProjectSettings.pixelAspectRatio.includes('HDV 1080 (1.33)')) return 1.333;
    return 1;
  };

  const checkForUnsavedChanges = () => {
    return hasAdjustments() || (currentActiveImageUrl !== imageUrl);
  };

  // NEW: Handle close button click (shows save button first)
  const handleCloseClick = () => {
    if (saveCompleted) {
      // Save has been completed, actually close now
      console.log('❌ Closing canvas after save completed');
      onClose();
    } else if (!showSaveButton) {
      // First click: show save button and disable close
      console.log('🔒 Showing save button, disabling close');
      setShowSaveButton(true);
      setIsCloseDisabled(true);
    }
    // If save button is showing but save not completed, do nothing (close is disabled)
  };

  // NEW: Handle save button click
  const handleSaveClick = () => {
    console.log('💾 Save button clicked');
    
    // Always save (even if no changes detected for double-check)
    if (hasAdjustments()) {
      addToEditHistory('Image adjustments applied', 'adjustment', true);
    } else if (currentActiveImageUrl && onImageUpdate) {
      // If no adjustments, just save current image
      onImageUpdate(currentActiveImageUrl);
    } else {
      // Force save even if no changes detected
      console.log('💾 Force saving current state');
      if (onImageUpdate && (currentActiveImageUrl || imageUrl)) {
        onImageUpdate(currentActiveImageUrl || imageUrl || '');
      }
    }
    
    // Show checkmark animation
    setShowCheckmark(true);
    setHasUnsavedChanges(false);
    
    // After checkmark, hide save button and enable close button
    setTimeout(() => {
      setShowCheckmark(false);
      setShowSaveButton(false); // Hide the save button
      setIsCloseDisabled(false);
      setSaveCompleted(true); // Mark save as completed
      console.log('✅ Save complete, save button hidden, close button enabled');
    }, 1500); // 1.5 seconds for checkmark display
  };

  // NEW: Opacity drag handlers
  const handleOpacityMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingOpacity(true);
    setDragStartX(e.clientX);
    setDragStartOpacity(layerOpacity);
    // Force cursor everywhere with !important
    document.documentElement.style.setProperty('cursor', 'ew-resize', 'important');
    document.body.style.setProperty('cursor', 'ew-resize', 'important');
    // Add universal selector to override all cursors
    const style = document.createElement('style');
    style.id = 'opacity-drag-cursor';
    style.textContent = '* { cursor: ew-resize !important; }';
    document.head.appendChild(style);
    // Disable text selection during drag
    document.body.style.userSelect = 'none';
  };

  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace('%', '');
    const numValue = parseInt(value) || 0;
    setLayerOpacity(Math.max(0, Math.min(100, numValue)));
  };

  // ENHANCED: Layer Management Functions
  const createLayerCanvas = (width: number, height: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }
    return canvas;
  };

  const handleCreateNewLayer = () => {
    if (!imageObj) {
      console.error('🎨 ERROR: Cannot create layer without image');
      return;
    }
    
    const newLayerId = `layer-${Date.now()}`;
    console.log('🎨 CREATING NEW LAYER:', {
      id: newLayerId,
      imageSize: { width: imageObj.width, height: imageObj.height },
      currentLayers: layers.length
    });
    
    // Create layer canvas with image dimensions, not canvas dimensions
    const layerCanvas = createLayerCanvas(imageObj.width, imageObj.height);
    
    if (!layerCanvas) {
      console.error('🎨 ERROR: Failed to create layer canvas');
      return;
    }
    
    console.log('🎨 LAYER CANVAS CREATED:', {
      canvas: { width: layerCanvas.width, height: layerCanvas.height },
      hasContext: !!layerCanvas.getContext('2d')
    });
    
    const newLayer = {
      id: newLayerId,
      name: `Empty Layer ${layers.length + 1}`,
      type: 'empty' as const,
      visible: true,
      opacity: 100,
      canvas: layerCanvas,
      isSelected: true,
      blendMode: 'normal' as const,
      locked: false
    };
    
    // Deselect other layers
    const updatedLayers = layers.map(layer => ({
      ...layer,
      isSelected: false
    }));
    
    console.log('🎨 UPDATING LAYERS STATE:', {
      previousLayers: layers.length,
      newTotalLayers: updatedLayers.length + 1
    });
    
    setLayers(prev => {
      const newLayers = [...updatedLayers, newLayer];
      console.log('🎨 LAYERS STATE UPDATED:', newLayers.map(l => ({ id: l.id, name: l.name, hasCanvas: !!l.canvas })));
      return newLayers;
    });
    setLayerCanvases(prev => new Map(prev).set(newLayerId, layerCanvas));
    setActiveLayerId(newLayerId);
    setSelectedLayerId(newLayerId); // Ensure both are synchronized
    
    console.log('🎨 LAYER CREATION COMPLETE:', {
      id: newLayerId,
      activeLayerId: newLayerId,
      selectedLayerId: newLayerId
    });
    
    return newLayerId;
  };

  const handleLayerSelect = (layerId: string) => {
    setActiveLayerId(layerId);
    setSelectedLayerId(layerId); // Ensure both are synchronized
    setLayers(prev => prev.map(layer => ({
      ...layer,
      isSelected: layer.id === layerId
    })));
  };

  const handleLayerVisibilityToggle = (layerId: string) => {
    setLayers(prev => prev.map(layer => 
      layer.id === layerId 
        ? { ...layer, visible: !layer.visible }
        : layer
    ));
    renderCompositeCanvas();
  };

  const handleLayerDelete = (layerId: string) => {
    setLayers(prev => prev.filter(layer => layer.id !== layerId));
    setLayerCanvases(prev => {
      const newMap = new Map(prev);
      newMap.delete(layerId);
      return newMap;
    });
    
    // If deleted layer was active, select another layer
    if (activeLayerId === layerId) {
      const remainingLayers = layers.filter(layer => layer.id !== layerId);
      if (remainingLayers.length > 0) {
        setActiveLayerId(remainingLayers[remainingLayers.length - 1].id);
      } else {
        setActiveLayerId(null);
      }
    }
    renderCompositeCanvas();
  };

  const handleLayerOpacityChange = (layerId: string, opacity: number) => {
    setLayers(prev => prev.map(layer => 
      layer.id === layerId 
        ? { ...layer, opacity }
        : layer
    ));
    renderCompositeCanvas();
  };

  // ENHANCED: Canvas Rendering System
  const renderCompositeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !imageObj) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear the main canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Save current transform
    ctx.save();
    
    // Apply viewport transform (zoom and pan)
    ctx.translate(translateX, translateY);
    ctx.scale(scale, scale);

    // Recursive function to render layers and groups
    const renderLayerRecursive = (layer: Layer, parentOpacity: number = 1) => {
      if (!layer.visible) return;

      const effectiveOpacity = parentOpacity * (layer.opacity / 100);
      
      ctx.save();
      ctx.globalAlpha = effectiveOpacity;
      
      if (layer.blendMode && layer.blendMode !== 'normal') {
        ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
      }

      if (layer.isGroup && layer.groupLayers) {
        // Render group contents (bottom to top)
        layer.groupLayers.forEach(subLayer => renderLayerRecursive(subLayer, effectiveOpacity));
      } else if (layer.canvas) {
        ctx.drawImage(layer.canvas, 0, 0);
      } else if (layer.type === 'background') {
        // Special handling for background layer
        if (hasAdjustments()) {
          applyImageAdjustments(ctx);
        }
        ctx.drawImage(imageObj, 0, 0);
      }

      ctx.restore();
    };

    // 1. Draw base image if not in layers (backwards compatibility or default)
    // If there's no background layer in the stack, draw it first
    const hasBackgroundLayer = layers.some(l => l.type === 'background');
    if (!hasBackgroundLayer) {
      ctx.save();
      if (hasAdjustments()) {
        applyImageAdjustments(ctx);
      }
      ctx.drawImage(imageObj, 0, 0);
      ctx.restore();
    }

    // 2. Render all layers in the stack (bottom to top)
    layers.forEach(layer => renderLayerRecursive(layer));

    // Restore transform
    ctx.restore();
  };

  // ADVANCED: Brush Engine System
  
  // Helper function to calculate distance between two points
  const getDistance = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  };

  // Helper function to apply jitter
  const applyJitter = (value: number, jitterAmount: number) => {
    const jitter = (Math.random() - 0.5) * 2 * (jitterAmount / 100);
    return value * (1 + jitter);
  };

  // Simple brush system - maximum performance
  
  // Fast drawing function
  const drawBrushStroke = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    const size = brushSettings.size;
    const opacity = brushSettings.opacity / 100;
    const color = brushSettings.color || '#ffffff';
    
    ctx.save();
    ctx.globalAlpha = opacity;
    
    if (brushSettings.hardness >= 80) {
      // Hard brush - solid circle
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, 2 * Math.PI);
      ctx.fill();
    } else {
      // Soft brush - simple gradient
      const radius = size / 2;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, `${color}00`);
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fill();
    }
    
    ctx.restore();
  };

  // Simple line drawing between points
  const drawLine = (ctx: CanvasRenderingContext2D, from: {x: number, y: number}, to: {x: number, y: number}) => {
    const size = brushSettings.size;
    const opacity = brushSettings.opacity / 100;
    const color = brushSettings.color || '#ffffff';
    
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    
    ctx.restore();
  };




  
  



  const startDrawing = (e: React.MouseEvent) => {
    if (!showBrushPanel) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    // If no layers exist and no active layer, create a new one automatically
    if (layers.length === 0 || !activeLayerId) {
      if (imageObj) {
        const newLayerId = handleCreateNewLayer();
        if (newLayerId) {
          // Use the new layer immediately
          setTimeout(() => startDrawingOnLayer(e, newLayerId), 0);
        }
        return;
      } else {
        console.warn('Cannot create layer without an image');
        return;
      }
    }

    startDrawingOnLayer(e, activeLayerId);
  };

  const startDrawingOnLayer = (e: React.MouseEvent, layerId: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Use proper coordinate transformation to image space
    const coordinates = getCanvasCoordinates(e, canvas);
    const imageX = coordinates.imageX;
    const imageY = coordinates.imageY;

    // Find and validate the target layer
    const targetLayer = layers.find(layer => layer.id === layerId);
    if (!targetLayer || !targetLayer.canvas || !imageObj) return;

    // Ensure layer canvas size matches image dimensions
    if (targetLayer.canvas.width !== imageObj.width || targetLayer.canvas.height !== imageObj.height) {
      targetLayer.canvas.width = imageObj.width;
      targetLayer.canvas.height = imageObj.height;
    }

    const layerCtx = targetLayer.canvas.getContext('2d');
    if (!layerCtx) return;

    // Set drawing state with image coordinates
    setIsDrawing(true);
    setActiveLayerId(layerId);
    setLastDrawPoint({ x: imageX, y: imageY });

    // Draw initial point
    drawBrushStroke(layerCtx, imageX, imageY);

    // Initial render will happen on stop drawing
  };

  // Ultra-simple continue drawing - maximum performance, no lag
  const continueDrawing = (e: React.MouseEvent) => {
    if (!isDrawing || !lastDrawPoint || !activeLayerId) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get coordinates
    const coordinates = getCanvasCoordinates(e, canvas);
    const currentPoint = { x: coordinates.imageX, y: coordinates.imageY };

    // Find active layer
    const targetLayer = layers.find(layer => layer.id === activeLayerId);
    if (!targetLayer || !targetLayer.canvas) return;

    const layerCtx = targetLayer.canvas.getContext('2d');
    if (!layerCtx) return;

    // Ensure canvas size is correct
    if (imageObj && targetLayer.canvas.width !== imageObj.width) {
      targetLayer.canvas.width = imageObj.width;
      targetLayer.canvas.height = imageObj.height;
    }

    // Simple distance check to prevent overpainting
    const distance = getDistance(lastDrawPoint, currentPoint);
    if (distance < 1) return; // Minimum 1px movement for responsiveness

    // Draw line between points
    drawLine(layerCtx, lastDrawPoint, currentPoint);
    
    // Update state
    setLastDrawPoint(currentPoint);
    
    // Don't render composite during drawing for performance
  };

  const stopDrawing = () => {
    // Reset drawing state
    setIsDrawing(false);
    setLastDrawPoint(null);
    
    // Only render composite once when drawing is complete
    renderCompositeCanvas();
  };

  // ENHANCED: Canvas and Layer Effects
  useEffect(() => {
    if (canvasRef.current && imageObj) {
      renderCompositeCanvas();
    }
  }, [layers, imageObj, imageAdjustments]);

  // No automatic background layer - the uploaded image IS the background

  const handleBrushToolClick = () => {
    setShowBrushPanel(true);
    setSelectedTool('brush'); // Set for consistency, but drawing works based on showBrushPanel
    // Ensure brush uses current primary color
    setBrushSettings(prev => ({ ...prev, color: primaryColor }));
    bringPanelToFront('brush');
    console.log('🎨 Brush tool activated with primary color:', primaryColor);
  };

  const handleBrushSettingChange = (setting: string, value: number | string) => {
    setBrushSettings((prev: AdvancedBrushSettings) => ({
      ...prev,
      [setting]: value
    }));
  };

  // NEW: Brush settings handlers
  const handleBrushSettingsChange = (settings: AdvancedBrushSettings) => {
    setBrushSettings(settings);
  };

  const handleBrushSave = () => {
    console.log('🎨 Brush settings saved:', brushSettings);
    // Add any save logic here
  };

  const handleBrushReset = () => {
    setBrushSettings({
      // Basic settings
      size: 20,
      hardness: 100,
      opacity: 100,
      flow: 100,
      type: 'soft_round',
      color: primaryColor, // Use current primary color instead of white
      // Advanced settings
      spacing: 25,
      angleJitter: 0,
      sizeJitter: 0,
      opacityJitter: 0,
      scattering: 0,
      wetness: 0,
      smoothing: 0,
      blendMode: 'normal',
      // Dynamics
      dynamics: {
        sizePressure: false,
        opacityPressure: false,
        flowPressure: false,
        tiltAngle: 0,
        tiltElevation: 0
      },
      // Shape
      shape: {
        angle: 0,
        roundness: 100,
        flipX: false,
        flipY: false
      }
    });
  };

  // NEW: Ensure brush color stays synchronized with primary color
  useEffect(() => {
    setBrushSettings(prev => ({ ...prev, color: primaryColor }));
    console.log('🔗 Brush color synchronized with primary color:', primaryColor);
  }, [primaryColor]);

  // NEW: Synchronize activeLayerId with selectedLayerId for painting
  useEffect(() => {
    if (selectedLayerId && selectedLayerId !== activeLayerId) {
      console.log('🔄 SYNC: Setting activeLayerId to match selectedLayerId:', selectedLayerId);
      setActiveLayerId(selectedLayerId);
    }
  }, [selectedLayerId, activeLayerId]);

  // NEW: Enhanced workflow logging for debugging
  useEffect(() => {
    console.log('🎯 WORKFLOW STATE:', {
      activeLayerId,
      selectedLayerId,
      primaryColor,
      brushColor: brushSettings.color,
      showBrushPanel,
      isColorPaletteOpen,
      isColorPickerOpen,
      layersCount: layers.length
    });
  }, [activeLayerId, selectedLayerId, primaryColor, brushSettings.color, showBrushPanel, isColorPaletteOpen, isColorPickerOpen, layers.length]);

  // Layer drag and drop handlers
  const handleLayerDragStart = (e: React.DragEvent, layerId: string) => {
    console.log('🎯 Drag start:', layerId, 'viewport size:', window.innerWidth, 'x', window.innerHeight);
    setDraggedLayerId(layerId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', layerId);
    
    // Get container bounds for relative positioning
    const container = (e.currentTarget as HTMLElement).closest('[data-layers-container]');
    const containerRect = container?.getBoundingClientRect();
    
    console.log('📍 Container bounds:', containerRect);
    
    // Create a simplified drag image to avoid Chrome issues
    const dragElement = e.currentTarget as HTMLElement;
    const rect = dragElement.getBoundingClientRect();
    
    // Use a simple, clean drag image
    const dragImage = document.createElement('div');
    dragImage.style.width = `${rect.width}px`;
    dragImage.style.height = `${rect.height}px`;
    dragImage.style.backgroundColor = 'rgba(59, 130, 246, 0.8)';
    dragImage.style.border = '2px solid #3b82f6';
    dragImage.style.borderRadius = '8px';
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    dragImage.style.left = '-1000px';
    dragImage.style.pointerEvents = 'none';
    dragImage.style.zIndex = '9999';
    dragImage.textContent = `Moving layer...`;
    dragImage.style.display = 'flex';
    dragImage.style.alignItems = 'center';
    dragImage.style.justifyContent = 'center';
    dragImage.style.color = 'white';
    dragImage.style.fontSize = '12px';
    dragImage.style.fontWeight = 'bold';
    
    document.body.appendChild(dragImage);
    
    // Use the center of the element as the drag point
    e.dataTransfer.setDragImage(dragImage, rect.width / 2, rect.height / 2);
    
    // Clean up the temporary drag image
    setTimeout(() => {
      if (document.body.contains(dragImage)) {
        document.body.removeChild(dragImage);
      }
    }, 100);
  };

  const handleLayerDragOver = (e: React.DragEvent, layerId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    
    if (draggedLayerId && draggedLayerId !== layerId) {
      // Get relative position within the container
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const container = target.closest('[data-layers-container]');
      const containerRect = container?.getBoundingClientRect();
      
      const relativeX = e.clientX - (containerRect?.left || 0);
      const relativeY = e.clientY - (containerRect?.top || 0);
      
      console.log('🎯 Drag over:', layerId, 'from:', draggedLayerId, 'at relative pos:', relativeX, relativeY);
      setDragOverLayerId(layerId);
    }
  };

  const handleLayerDragEnter = (e: React.DragEvent, layerId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedLayerId && draggedLayerId !== layerId) {
      setDragOverLayerId(layerId);
    }
  };

  const handleLayerDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Use a small delay to prevent flickering when moving between child elements
    setTimeout(() => {
      // Check if we're still over a valid drop target
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;
      
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        console.log('🎯 Drag leave confirmed');
        setDragOverLayerId(null);
      }
    }, 10);
  };

  const handleLayerDrop = (e: React.DragEvent, targetLayerId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Get relative position for better viewport compatibility
    const target = e.currentTarget as HTMLElement;
    const container = target.closest('[data-layers-container]');
    const containerRect = container?.getBoundingClientRect();
    
    const relativeX = e.clientX - (containerRect?.left || 0);
    const relativeY = e.clientY - (containerRect?.top || 0);
    
    console.log('🎯 Drop event triggered:', { 
      draggedLayerId, 
      targetLayerId, 
      clientX: e.clientX, 
      clientY: e.clientY,
      relativeX,
      relativeY,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      containerBounds: containerRect
    });
    
    if (!draggedLayerId) {
      console.log('❌ No dragged layer ID');
      setDraggedLayerId(null);
      setDragOverLayerId(null);
      return;
    }
    
    if (draggedLayerId === targetLayerId) {
      console.log('❌ Cannot drop on self');
      setDraggedLayerId(null);
      setDragOverLayerId(null);
      return;
    }

    // Check if we're dealing with edit history layers or empty layers
    const draggedInHistory = imageEditHistory.find(edit => edit.id === draggedLayerId);
    const targetInHistory = imageEditHistory.find(edit => edit.id === targetLayerId);
    const draggedInLayers = layers.find(layer => layer.id === draggedLayerId);
    const targetInLayers = layers.find(layer => layer.id === targetLayerId);

    if (draggedInHistory && targetInHistory) {
      // Both are edit history layers - reorder edit history
      const newHistory = [...imageEditHistory];
      const draggedIndex = newHistory.findIndex(edit => edit.id === draggedLayerId);
      const targetIndex = newHistory.findIndex(edit => edit.id === targetLayerId);

      console.log('🎯 Edit History Indices:', { draggedIndex, targetIndex });

      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [draggedItem] = newHistory.splice(draggedIndex, 1);
        newHistory.splice(targetIndex, 0, draggedItem);
        
        setImageEditHistory(newHistory);
        
        // Update current history index if needed
        if (currentHistoryIndex !== -1) {
          const currentEdit = imageEditHistory[currentHistoryIndex];
          const newIndex = newHistory.findIndex(edit => edit.id === currentEdit.id);
          setCurrentHistoryIndex(newIndex);
        }
        
        console.log('🎯 Edit history reordered successfully');
      }
    } else if (draggedInLayers && targetInLayers) {
      // Both are empty layers - reorder empty layers
      const newLayers = [...layers];
      const draggedIndex = newLayers.findIndex(layer => layer.id === draggedLayerId);
      const targetIndex = newLayers.findIndex(layer => layer.id === targetLayerId);

      console.log('🎯 Empty Layers Indices:', { draggedIndex, targetIndex });

      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [draggedItem] = newLayers.splice(draggedIndex, 1);
        newLayers.splice(targetIndex, 0, draggedItem);
        
        setLayers(newLayers);
        console.log('🎯 Empty layers reordered successfully');
      }
    } else {
      console.log('🚫 Cannot reorder between different layer types');
    }

    setDraggedLayerId(null);
    setDragOverLayerId(null);
  };

  const handleLayerDragEnd = (e: React.DragEvent) => {
    console.log('🎯 Drag end:', {
      draggedLayerId,
      dragOverLayerId,
      dropEffect: e.dataTransfer.dropEffect,
      clientX: e.clientX,
      clientY: e.clientY
    });
    setDraggedLayerId(null);
    setDragOverLayerId(null);
  };

  // Mouse-based drag handlers for immediate response
  const handleLayerMouseDown = (e: React.MouseEvent, layerId: string) => {
    console.log('🖱️ Mouse down on layer:', layerId);
    setLayerDragStartY(e.clientY);
    setDragStartLayerId(layerId);
    setDraggedLayerElement(e.currentTarget as HTMLElement);
    
    // Prevent text selection during potential drag
    e.preventDefault();
  };

  const handleLayerMouseMove = (e: React.MouseEvent) => {
    if (!dragStartLayerId || isLayerDragging) return;
    
    const deltaY = Math.abs(e.clientY - layerDragStartY);
    
    if (deltaY > layerDragThreshold) {
      console.log('🚀 Starting immediate drag for:', dragStartLayerId, 'delta:', deltaY);
      setIsLayerDragging(true);
      setDraggedLayerId(dragStartLayerId);
      setLayerDragCurrentY(e.clientY);
    }
  };

  const handleLayerMouseUp = (e: React.MouseEvent) => {
    if (isLayerDragging && draggedLayerId) {
      // Find the layer we're dropping on
      const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
      const layerElement = dropTarget?.closest('[data-layer-id]') as HTMLElement;
      const targetLayerId = layerElement?.getAttribute('data-layer-id');
      
      if (targetLayerId && targetLayerId !== draggedLayerId) {
        console.log('🎯 Mouse drop:', draggedLayerId, 'onto:', targetLayerId);
        performLayerReorder(draggedLayerId, targetLayerId);
      }
    }
    
    // Reset all drag states
    setIsLayerDragging(false);
    setDraggedLayerId(null);
    setDragOverLayerId(null);
    setDragStartLayerId(null);
    setDraggedLayerElement(null);
  };

  const performLayerReorder = (draggedId: string, targetId: string) => {
    console.log('🔄 Performing reorder:', draggedId, '->', targetId);
    
    // Check if we're dealing with edit history layers or empty layers
    const draggedInHistory = imageEditHistory.find(edit => edit.id === draggedId);
    const targetInHistory = imageEditHistory.find(edit => edit.id === targetId);
    const draggedInLayers = layers.find(layer => layer.id === draggedId);
    const targetInLayers = layers.find(layer => layer.id === targetId);

    if (draggedInHistory && targetInHistory) {
      // Both are edit history layers
      const newHistory = [...imageEditHistory];
      const draggedIndex = newHistory.findIndex(edit => edit.id === draggedId);
      const targetIndex = newHistory.findIndex(edit => edit.id === targetId);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [draggedItem] = newHistory.splice(draggedIndex, 1);
        newHistory.splice(targetIndex, 0, draggedItem);
        
        setImageEditHistory(newHistory);
        
        // Update current history index if needed
        if (currentHistoryIndex !== -1) {
          const currentEdit = imageEditHistory[currentHistoryIndex];
          const newIndex = newHistory.findIndex(edit => edit.id === currentEdit.id);
          setCurrentHistoryIndex(newIndex);
        }
        
        console.log('✅ Edit history reordered successfully');
      }
    } else if (draggedInLayers && targetInLayers) {
      // Both are empty layers
      const newLayers = [...layers];
      const draggedIndex = newLayers.findIndex(layer => layer.id === draggedId);
      const targetIndex = newLayers.findIndex(layer => layer.id === targetId);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [draggedItem] = newLayers.splice(draggedIndex, 1);
        newLayers.splice(targetIndex, 0, draggedItem);
        
        setLayers(newLayers);
        console.log('✅ Empty layers reordered successfully');
      }
    }
  };

  // Helper function to get layer information
  const getLayerInfo = (layerId: string) => {
    // Check if it's an edit history layer
    const historyLayer = imageEditHistory.find(edit => edit.id === layerId);
    if (historyLayer) {
      const historyIndex = imageEditHistory.findIndex(edit => edit.id === layerId);
      return {
        type: 'edit',
        index: historyIndex,
        displayName: `Edit Layer #${historyIndex + 1}`,
        layer: historyLayer
      };
    }
    
    // Check if it's an empty layer
    const emptyLayer = layers.find(layer => layer.id === layerId);
    if (emptyLayer) {
      const layerIndex = layers.findIndex(layer => layer.id === layerId);
      return {
        type: 'empty',
        index: layerIndex,
        displayName: `Empty Layer #${layerIndex + 1}`,
        layer: emptyLayer
      };
    }
    
    return {
      type: 'unknown',
      index: -1,
      displayName: 'Unknown Layer',
      layer: null
    };
  };

  // Calculate layer preview dimensions based on image aspect ratio
  const getLayerPreviewStyle = () => {
    if (!imageObj) {
      // Default rectangle if no image loaded
      return { width: '48px', height: '32px' }; // w-12 h-8
    }
    
    const aspectRatio = imageObj.width / imageObj.height;
    const maxWidth = 48; // 12 * 4px (w-12)
    const maxHeight = 32; // 8 * 4px (h-8)
    
    let width, height;
    
    if (aspectRatio > 1) {
      // Landscape: width is constrained
      width = maxWidth;
      height = maxWidth / aspectRatio;
      if (height > maxHeight) {
        height = maxHeight;
        width = maxHeight * aspectRatio;
      }
    } else {
      // Portrait or square: height is constrained
      height = maxHeight;
      width = maxHeight * aspectRatio;
      if (width > maxWidth) {
        width = maxWidth;
        height = maxWidth / aspectRatio;
      }
    }
    
    return { 
      width: `${Math.round(width)}px`, 
      height: `${Math.round(height)}px` 
    };
  };

  const TransparentPreview = ({ style }: { style: React.CSSProperties }) => (
    <div 
      className="rounded-sm flex items-center justify-center flex-shrink-0 relative overflow-hidden"
      style={style}
    >
      {/* Transparency checkerboard pattern */}
      <div 
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(45deg, #666 25%, transparent 25%), 
            linear-gradient(-45deg, #666 25%, transparent 25%), 
            linear-gradient(45deg, transparent 75%, #666 75%), 
            linear-gradient(-45deg, transparent 75%, #666 75%)
          `,
          backgroundSize: '8px 8px',
          backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
        }}
      />
      {/* Empty layer icon */}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="relative z-10 text-white/80">
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
        <path d="M9 9L15 15M15 9L9 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    </div>
  );

  // Calculate dynamic positioning to avoid collision between containers  
  const getEditHistoryPosition = () => {
    // Base transform for slide animation
    const baseTransform = uiVisibility.edits ? 'translateX(0)' : 'translateX(calc(100% + 2rem))';
    
    // Default position when layers is closed or still animating
    if (!isLayersOpen || isLayersAnimating) {
      return { top: '50%', transform: `${baseTransform} translateY(-50%)` };
    }
    
    // Calculate container positions and dimensions
    const layersHeight = 384; // h-96 = 24rem = 384px
    const editHistoryHeight = 320; // h-80 = 20rem = 320px  
    const padding = 16; // 1rem = 16px padding between containers
    const bottomOffset = 16; // bottom-4 = 1rem = 16px
    
    // Layers container position (bottom-right)
    const layersTop = window.innerHeight - bottomOffset - layersHeight;
    const layersBottom = window.innerHeight - bottomOffset;
    
    // Edit history default position (center-right)
    const editHistoryDefaultTop = (window.innerHeight - editHistoryHeight) / 2;
    const editHistoryDefaultBottom = editHistoryDefaultTop + editHistoryHeight;
    
    // Check for collision: if edit history overlaps with layers container
    const wouldCollide = editHistoryDefaultBottom + padding > layersTop;
    
    if (!wouldCollide) {
      // No collision, keep default center position
      return { top: '50%', transform: `${baseTransform} translateY(-50%)` };
    }
    
    // Collision detected, move edit history up to avoid overlap
    const editHistoryTop = Math.max(
      padding, // Minimum top padding from viewport
      layersTop - padding - editHistoryHeight
    );
    
    return { 
      top: `${editHistoryTop}px`, 
      transform: baseTransform
    };
  };

  // NEW: Check if a panel is currently open
  const isPanelOpen = (toolKey: string): boolean => {
    switch (toolKey) {
      case 'model':
        return isModelDropdownOpen;
      case 'retouch':
        return showRelightInput;
      case 'reframe':
        return showReframeInput;
      case 'background':
        return showBackgroundInput || showBackgroundSubButtons;
      case 'adjust':
        return showAdjustPanel;
      case 'style':
        return isStyleModalOpen || !!savedStyle;
      case 'enhance':
        return showEnhancePanel;
      case 'segmentation':
        return showSegmentationPanel;
      case 'transform':
        return showTransformPanel;
      case 'brush':
        return showBrushPanel;
      case 'remove':
        return showRemovePanel;
      case 'selection':
        return showSelectionPanel;
      case 'text':
        return showTextPanel;
      case 'shape':
        return showShapePanel;
      default:
        return selectedEditMode === toolKey;
    }
  };

  // NEW: Adjustment panel dragging handlers
  const handlePanelMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Bring adjustment panel to front when dragging starts
    bringPanelToFront('adjust');
    
    // Get the panel's current position in the viewport
    // Find the fixed positioned parent container (the one with absolute positioning based on adjustmentPanelPosition)
    const panelElement = e.currentTarget.closest('[style*="left:"]') as HTMLElement;
    if (!panelElement) {
      console.log('🐛 Panel element not found in handlePanelMouseDown');
      return;
    }
    
    const rect = panelElement.getBoundingClientRect();
    
    setIsDraggingPanel(true);
    setDragStartPos({ x: e.clientX, y: e.clientY });
    
    // Calculate the offset from mouse position to panel's top-left corner
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    
    console.log('🎯 Panel drag started:', {
      mousePos: { x: e.clientX, y: e.clientY },
      panelRect: { left: rect.left, top: rect.top },
      offset: dragOffsetRef.current
    });
  };

  // Add global mouse events for dragging
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDraggingPanel) return;
      
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;
      
      // Get viewport bounds to keep panel within screen
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelWidth = 320; // 80 * 4 = w-80
      const panelHeight = 600; // Approximate panel height
      
      // Constrain to viewport bounds
      const constrainedX = Math.max(0, Math.min(newX, viewportWidth - panelWidth));
      const constrainedY = Math.max(0, Math.min(newY, viewportHeight - panelHeight));
      
      setAdjustmentPanelPosition({ x: constrainedX, y: constrainedY });
      
      console.log('🖱️ Panel drag move:', {
        mouse: { x: e.clientX, y: e.clientY },
        calculated: { x: newX, y: newY },
        constrained: { x: constrainedX, y: constrainedY }
      });
    };

    const handleGlobalMouseUp = () => {
      console.log('🖱️ Panel drag ended');
      setIsDraggingPanel(false);
    };

    if (isDraggingPanel) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
      console.log('✅ Global drag event listeners added');
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
      if (isDraggingPanel) {
        console.log('🧹 Global drag event listeners removed');
      }
    };
  }, [isDraggingPanel]);

  // NEW: Opacity dragging global handlers
  useEffect(() => {
    const handleOpacityMouseMove = (e: MouseEvent) => {
      if (!isDraggingOpacity) return;
      
      const deltaX = e.clientX - dragStartX;
      const sensitivity = 0.5; // Adjust sensitivity as needed
      const newOpacity = Math.max(0, Math.min(100, dragStartOpacity + deltaX * sensitivity));
      setLayerOpacity(Math.round(newOpacity));
    };

    const handleOpacityMouseUp = () => {
      setIsDraggingOpacity(false);
      // Reset cursor properties
      document.documentElement.style.removeProperty('cursor');
      document.body.style.removeProperty('cursor');
      // Remove universal cursor override style
      const style = document.getElementById('opacity-drag-cursor');
      if (style) {
        style.remove();
      }
      // Re-enable text selection
      document.body.style.userSelect = '';
    };

    if (isDraggingOpacity) {
      document.addEventListener('mousemove', handleOpacityMouseMove);
      document.addEventListener('mouseup', handleOpacityMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleOpacityMouseMove);
      document.removeEventListener('mouseup', handleOpacityMouseUp);
    };
  }, [isDraggingOpacity, dragStartX, dragStartOpacity]);

  // NEW: Enhance panel dragging handlers
  const handleEnhancePanelMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
            e.stopPropagation();
    
    // Bring enhance panel to front when dragging starts
    bringPanelToFront('enhance');
    
    const panelElement = e.currentTarget.closest('[style*="left:"]') as HTMLElement;
    if (!panelElement) {
      console.log('🐛 Enhance panel element not found in handleEnhancePanelMouseDown');
      return;
    }
    
    const rect = panelElement.getBoundingClientRect();
    
    setIsDraggingEnhancePanel(true);
    setEnhanceDragStartPos({ x: e.clientX, y: e.clientY });
    
    enhanceDragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    
    console.log('🎯 Enhance panel drag started:', {
      mousePos: { x: e.clientX, y: e.clientY },
      panelRect: { left: rect.left, top: rect.top },
      offset: enhanceDragOffsetRef.current
    });
  };

  // Add global mouse events for enhance panel dragging
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDraggingEnhancePanel) return;
      
      const newX = e.clientX - enhanceDragOffsetRef.current.x;
      const newY = e.clientY - enhanceDragOffsetRef.current.y;
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelWidth = 320;
      const panelHeight = 600;
      
      const constrainedX = Math.max(0, Math.min(newX, viewportWidth - panelWidth));
      const constrainedY = Math.max(0, Math.min(newY, viewportHeight - panelHeight));
      
      setEnhancePanelPosition({ x: constrainedX, y: constrainedY });
      
      console.log('🖱️ Enhance panel drag move:', {
        mouse: { x: e.clientX, y: e.clientY },
        calculated: { x: newX, y: newY },
        constrained: { x: constrainedX, y: constrainedY }
      });
    };

    const handleGlobalMouseUp = () => {
      console.log('🖱️ Enhance panel drag ended');
      setIsDraggingEnhancePanel(false);
    };

    if (isDraggingEnhancePanel) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
      console.log('✅ Global enhance drag event listeners added');
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
      if (isDraggingEnhancePanel) {
        console.log('🧹 Global enhance drag event listeners removed');
      }
    };
  }, [isDraggingEnhancePanel]);

  // REMOVED: Global mouse tracking was conflicting with local canvas mouse handler
  // The canvas mouse move handler now manages brush cursor visibility properly

  // Global mouse tracking for responsive layer dragging
  useEffect(() => {
    if (!dragStartLayerId) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!dragStartLayerId) return;
      
      const deltaY = Math.abs(e.clientY - layerDragStartY);
      
      if (!isLayerDragging && deltaY > layerDragThreshold) {
        console.log('🚀 Starting immediate drag for:', dragStartLayerId, 'delta:', deltaY);
        setIsLayerDragging(true);
        setDraggedLayerId(dragStartLayerId);
        setLayerDragCurrentY(e.clientY);
      } else if (isLayerDragging) {
        setLayerDragCurrentY(e.clientY);
        
        // Update drag over state based on mouse position
        const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
        const layerElement = elementUnderMouse?.closest('[data-layer-id]') as HTMLElement;
        const hoveredLayerId = layerElement?.getAttribute('data-layer-id');
        
        if (hoveredLayerId && hoveredLayerId !== draggedLayerId) {
          setDragOverLayerId(hoveredLayerId);
        } else {
          setDragOverLayerId(null);
        }
      }
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (isLayerDragging && draggedLayerId) {
        // Find the layer we're dropping on
        const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
        const layerElement = dropTarget?.closest('[data-layer-id]') as HTMLElement;
        const targetLayerId = layerElement?.getAttribute('data-layer-id');
        
        if (targetLayerId && targetLayerId !== draggedLayerId) {
          console.log('🎯 Global mouse drop:', draggedLayerId, 'onto:', targetLayerId);
          performLayerReorder(draggedLayerId, targetLayerId);
        }
      }
      
      // Reset all drag states
      setIsLayerDragging(false);
      setDraggedLayerId(null);
      setDragOverLayerId(null);
      setDragStartLayerId(null);
      setDraggedLayerElement(null);
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [dragStartLayerId, isLayerDragging, layerDragStartY, layerDragThreshold, draggedLayerId]);

  // Monitor for unsaved changes
  useEffect(() => {
    const hasChanges = checkForUnsavedChanges();
    setHasUnsavedChanges(hasChanges);
  }, [imageAdjustments, currentActiveImageUrl, imageUrl]);

  // NEW: Additional panel positions for multiple panels
  const [segmentationPanelPosition, setSegmentationPanelPosition] = useState({ x: 416, y: 0 }); // 96 + 320 (panel width)
  const [transformPanelPosition, setTransformPanelPosition] = useState({ x: 736, y: 0 }); // 416 + 320
  const [brushPanelPosition, setBrushPanelPosition] = useState({ x: 96, y: 300 }); // Below adjust panel
  const [removePanelPosition, setRemovePanelPosition] = useState({ x: 416, y: 300 }); // Below enhance panel
  const [selectionPanelPosition, setSelectionPanelPosition] = useState({ x: 736, y: 300 }); // Below segmentation panel
  const [textPanelPosition, setTextPanelPosition] = useState({ x: 96, y: 600 }); // Row 3
  const [shapePanelPosition, setShapePanelPosition] = useState({ x: 416, y: 600 }); // Row 3

  // NEW: Get automatic panel position based on open panels
  const getAutoPanelPosition = (toolKey: string) => {
    const basePositions = {
      adjust: { x: 96, y: 0 },
      enhance: { x: 416, y: 0 },
      segmentation: { x: 736, y: 0 },
      transform: { x: 96, y: 300 },
      brush: { x: 416, y: 300 },
      remove: { x: 736, y: 300 },
      selection: { x: 736, y: 300 },
      text: { x: 96, y: 600 },
      shape: { x: 416, y: 600 }
    };
    return basePositions[toolKey as keyof typeof basePositions] || { x: 96, y: 0 };
  };

  // Detached layers modal state
  const [isLayersDetached, setIsLayersDetached] = useState(false);

  // Magnetic re-attach state
  const [isModalOverlappingButton, setIsModalOverlappingButton] = useState(false);

  // DEBUG: Simple test drawing function
  const testDraw = (e: React.MouseEvent) => {
    console.log('🧪 TEST DRAW CALLED');
    const canvas = canvasRef.current;
    if (!canvas) {
      console.log('🧪 TEST: No canvas ref');
      return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.log('🧪 TEST: No context');
      return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    console.log('🧪 TEST: Drawing red circle at', { x, y });
    
    ctx.save();
    ctx.fillStyle = 'red';
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  };

  // REWORKED DRAWING SYSTEM - Based on Modern HTML5 Canvas Best Practices
  
  // Drawing state machine for proper event handling
  const [drawingState, setDrawingState] = useState<'idle' | 'drawing' | 'ending'>('idle');
  
  // Stroke data for smooth drawing
  const [currentStroke, setCurrentStroke] = useState<{
    points: Array<{ x: number; y: number; pressure: number; time: number }>;
    layerId: string;
  } | null>(null);
  
  // Offscreen canvas for performance optimization
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Drawing performance optimization
  const lastDrawTime = useRef<number>(0);
  const drawingThrottleMs = 16; // 60fps target
  
  // Smooth stroke algorithm - based on industry best practices
  const smoothStroke = (points: Array<{ x: number; y: number; pressure: number }>) => {
    if (points.length < 2) return points;
    
    const smoothedPoints = [points[0]];
    
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];
      
      // Apply smoothing using quadratic interpolation
      const smoothedX = (prev.x + curr.x + next.x) / 3;
      const smoothedY = (prev.y + curr.y + next.y) / 3;
      const smoothedPressure = (prev.pressure + curr.pressure + next.pressure) / 3;
      
      smoothedPoints.push({
        x: smoothedX,
        y: smoothedY,
        pressure: smoothedPressure
      });
    }
    
    if (points.length > 1) {
      smoothedPoints.push(points[points.length - 1]);
    }
    
    return smoothedPoints;
  };
  
  // Create layer canvas with proper dimensions
  const createNewLayerCanvas = (width: number, height: number): HTMLCanvasElement => {
    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = width;
    layerCanvas.height = height;
    
    const ctx = layerCanvas.getContext('2d');
    if (ctx) {
      // Set high-quality rendering
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // Clear to transparent
      ctx.clearRect(0, 0, width, height);
    }
    
    return layerCanvas;
  };
  
  // Get coordinates in image space (not canvas space)
  const getImageCoordinates = (e: React.MouseEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    
    // Convert from canvas coordinates to image coordinates
    const imageX = (canvasX - translateX) / scale;
    const imageY = (canvasY - translateY) / scale;
    
    console.log('🎯 COORDINATES:', {
      mouse: { x: e.clientX, y: e.clientY },
      canvas: { x: canvasX, y: canvasY },
      image: { x: imageX, y: imageY },
      transform: { translateX, translateY, scale }
    });
    
    return { imageX, imageY };
  };
  

  
  // Handle mouse/touch down - start drawing
  const handleDrawingStart = (e: React.MouseEvent) => {
    if (!showBrushPanel || drawingState !== 'idle') return;
    
    const canvas = canvasRef.current;
    if (!canvas || !imageObj) return;
    
         // Get or create active layer
     let targetLayer = layers.find(layer => layer.id === activeLayerId);
     if (!targetLayer) {
       // Create new layer automatically
       const newLayerId = handleCreateNewLayer();
       if (!newLayerId) return;
       targetLayer = layers.find(layer => layer.id === newLayerId);
       if (!targetLayer) return;
     }
    
         // Ensure layer canvas exists and matches image dimensions
     if (!targetLayer.canvas || 
         targetLayer.canvas.width !== imageObj.width || 
         targetLayer.canvas.height !== imageObj.height) {
       targetLayer.canvas = createNewLayerCanvas(imageObj.width, imageObj.height);
     }
    
    // Get coordinates in image space
    const coords = getImageCoordinates(e, canvas);
    
    // Start new stroke
    const initialPoint = {
      x: coords.imageX,
      y: coords.imageY,
      pressure: 0.8,
      time: Date.now()
    };
    
    setCurrentStroke({
      points: [initialPoint],
      layerId: targetLayer.id
    });
    
    setDrawingState('drawing');
    setIsDrawing(true);
    
    console.log('🎨 DRAWING START:', {
      layerId: targetLayer.id,
      point: initialPoint,
      layerCanvas: {
        width: targetLayer.canvas.width,
        height: targetLayer.canvas.height
      }
    });
  };
  
  // Handle mouse/touch move - continue drawing
  const handleDrawingContinue = (e: React.MouseEvent) => {
    if (drawingState !== 'drawing' || !currentStroke || !imageObj) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Throttle drawing for performance
    const now = Date.now();
    if (now - lastDrawTime.current < drawingThrottleMs) return;
    lastDrawTime.current = now;
    
    // Get coordinates in image space
    const coords = getImageCoordinates(e, canvas);
    
    // Add point to current stroke
    const newPoint = {
      x: coords.imageX,
      y: coords.imageY,
      pressure: 0.8,
      time: now
    };
    
    const updatedStroke = {
      ...currentStroke,
      points: [...currentStroke.points, newPoint]
    };
    setCurrentStroke(updatedStroke);
    
    // Find target layer and draw on it
    const targetLayer = layers.find(layer => layer.id === currentStroke.layerId);
    if (targetLayer && targetLayer.canvas) {
      const ctx = targetLayer.canvas.getContext('2d');
      if (ctx) {
        // Clear layer and redraw entire stroke for smooth result
        ctx.clearRect(0, 0, targetLayer.canvas.width, targetLayer.canvas.height);
        drawSmoothStroke(ctx, updatedStroke.points);
      }
    }
    
    // Trigger composite render
    renderCompositeCanvas();
  };
  
  // Handle mouse/touch up - end drawing
  const handleDrawingEnd = () => {
    if (drawingState !== 'drawing' || !currentStroke) return;
    
    setDrawingState('ending');
    
    // Final render of the stroke
    const targetLayer = layers.find(layer => layer.id === currentStroke.layerId);
    if (targetLayer && targetLayer.canvas) {
      const ctx = targetLayer.canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, targetLayer.canvas.width, targetLayer.canvas.height);
        drawSmoothStroke(ctx, currentStroke.points);
        
        console.log('🎨 DRAWING END:', {
          layerId: currentStroke.layerId,
          pointCount: currentStroke.points.length,
          layerCanvas: {
            width: targetLayer.canvas.width,
            height: targetLayer.canvas.height
          }
        });
      }
    }
    
    // Clean up
    setCurrentStroke(null);
    setDrawingState('idle');
    setIsDrawing(false);
    
    // Final composite render
    renderCompositeCanvas();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* 1. Main Backdrop sibling */}
      <div className="fixed inset-0 w-full h-full bg-[#09090b] z-[8000] animate-in fade-in duration-500 overflow-hidden" />

      {/* 2. Main Canvas Container Viewport */}
      <div 
        ref={containerRef}
        className="fixed inset-0 z-[8001] overflow-hidden bg-transparent pointer-events-none"
        onClick={(e) => {
          e.stopPropagation();
          if (showControlsDropdown) setShowControlsDropdown(false);
        }}
      >
        {/* Simple cursor override when brush cursor is active */}
        {showBrushCursor && (
          <style>
            {`
              /* Hide cursor only on canvas when brush cursor is active */
              canvas {
                cursor: none !important;
              }
            `}
          </style>
        )}
        {/* Tab Menu Button - Top Left Corner */}
        {(imageUrl || activeProjectSettings) && (
          <div 
            className="fixed top-4 left-4 z-[8003] flex items-center gap-2 pointer-events-auto"
            onMouseEnter={() => setIsHoveringUI(true)}
            onMouseLeave={() => setIsHoveringUI(false)}
          >
            {/* Main Tab Button */}
              <button
              onClick={handleTabMenuToggle}
              className="w-12 h-12 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-all duration-200"
              title="Menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <rect x="3" y="3" width="7" height="7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <rect x="14" y="3" width="7" height="7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <rect x="14" y="14" width="7" height="7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <rect x="3" y="14" width="7" height="7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              
            {/* Expandable Menu Options */}
            {isTabMenuOpen && (
              <>
                <div className="h-6 w-px bg-white/10 ml-2 mr-1" />
                <div className="flex items-center gap-2 animate-in slide-in-from-left-2 duration-200">
                {/* File Menu Item */}
                <div className="relative">
                  <button
                    onClick={() => handleMenuItemClick('file')}
                    className="w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
                    title="File menu"
                  >
                    <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">File</span>
                  </button>

                  {/* File Dropdown Menu */}
                  {isFileDropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 w-48 bg-black/95 backdrop-blur-md border border-white/20 rounded-lg shadow-xl z-[8004] animate-in slide-in-from-top-2 duration-200">
                      <div className="p-2 space-y-1">
                        {/* New */}
                        <button
                          onClick={handleNewFile}
                          className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          New
                        </button>

                        {/* Open */}
                        <button
                          onClick={handleOpenFile}
                          className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          Open...
                        </button>

                        {/* Divider */}
                        <div className="h-px bg-white/10 my-1"></div>

                        {/* Save */}
                        <button
                          onClick={handleSaveFile}
                          className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2"
                        >
                          <Save className="w-3.5 h-3.5" />
                          Save
                        </button>

                        {/* Save As... */}
                        <button
                          onClick={handleSaveAsProject}
                          className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Save As...
                        </button>

                        {/* Divider */}
                        <div className="h-px bg-white/10 my-1"></div>

                        {/* Import Project */}
                        <button
                          onClick={handleImportProject}
                          className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          Import Project...
                        </button>

                        {/* Divider */}
                        <div className="h-px bg-white/10 my-1"></div>

                        {/* Export submenu header */}
                        <div className="px-3 py-1 text-xs text-white/50">Export As</div>

                        {/* Export PNG */}
                        <button
                          onClick={() => handleExportFile('png')}
                          className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2 pl-6"
                        >
                          <Download className="w-3.5 h-3.5" />
                          PNG
                        </button>

                        {/* Export JPG */}
                        <button
                          onClick={() => handleExportFile('jpg')}
                          className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2 pl-6"
                        >
                          <Download className="w-3.5 h-3.5" />
                          JPG
                        </button>

                        {/* Export WebP */}
                        <button
                          onClick={() => handleExportFile('webp')}
                          className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2 pl-6"
                        >
                          <Download className="w-3.5 h-3.5" />
                          WebP
                        </button>

                        {/* Divider */}
                        <div className="h-px bg-white/10 my-1"></div>

                        {/* Close */}
                        <button
                          onClick={handleCloseFile}
                          className="w-full px-3 py-2 text-left text-xs rounded transition-all duration-200 text-white hover:bg-white/10 flex items-center gap-2"
                        >
                          <X className="w-3.5 h-3.5" />
                          Close
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Image Menu Item */}
                <button
                  onClick={() => handleMenuItemClick('image')}
                  className="w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
                  title="Image menu"
                >
                  <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">Image</span>
                </button>

                {/* View Menu Item */}
                <div className="relative">
                  <button
                    onClick={() => handleMenuItemClick('view')}
                    className="w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
                    title="View menu"
                  >
                    <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">View</span>
                  </button>

                  {/* View Dropdown Menu */}
                  {isViewDropdownOpen && (
                    <div className="absolute top-full -left-14 mt-1 w-40 bg-black/95 backdrop-blur-md border border-white/20 rounded-lg shadow-xl z-[8004] animate-in slide-in-from-top-2 duration-200">
                      <div className="p-2 space-y-1">
                        {/* Top Controls Toggle */}
                        <button
                          onClick={() => handleUiToggle('topControls')}
                          className={`w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 ${
                            uiVisibility.topControls 
                              ? 'text-white bg-white/10 hover:bg-white/20' 
                              : 'text-white/50 hover:text-white/70 hover:bg-white/10'
                          }`}
                        >
                          Top Controls
                        </button>

                        {/* Chat Container Toggle */}
                        <button
                          onClick={() => handleUiToggle('chatContainer')}
                          className={`w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 ${
                            uiVisibility.chatContainer 
                              ? 'text-white bg-white/10 hover:bg-white/20' 
                              : 'text-white/50 hover:text-white/70 hover:bg-white/10'
                          }`}
                        >
                          Chat Container
                        </button>

                        {/* Tools Toggle */}
                        <button
                          onClick={() => handleUiToggle('tools')}
                          className={`w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 ${
                            uiVisibility.tools 
                              ? 'text-white bg-white/10 hover:bg-white/20' 
                              : 'text-white/50 hover:text-white/70 hover:bg-white/10'
                          }`}
                        >
                          Tools
                        </button>

                        {/* Edits Toggle */}
                        <button
                          onClick={() => handleUiToggle('edits')}
                          className={`w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 ${
                            uiVisibility.edits 
                              ? 'text-white bg-white/10 hover:bg-white/20' 
                              : 'text-white/50 hover:text-white/70 hover:bg-white/10'
                          }`}
                        >
                          Edits
                        </button>

                        {/* Smart Guides Toggle */}
                        <button
                          onClick={() => setSmartGuides(prev => ({ ...prev, enabled: !prev.enabled }))}
                          className={`w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 ${
                            smartGuides.enabled 
                              ? 'text-white bg-white/10 hover:bg-white/20' 
                              : 'text-white/50 hover:text-white/70 hover:bg-white/10'
                          }`}
                        >
                          Smart Guides
                        </button>

                        {/* Grid Toggle */}
                        <button
                          onClick={() => setSmartGuides(prev => ({ ...prev, showGrid: !prev.showGrid }))}
                          className={`w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 ${
                            smartGuides.showGrid 
                              ? 'text-white bg-white/10 hover:bg-white/20' 
                              : 'text-white/50 hover:text-white/70 hover:bg-white/10'
                          }`}
                        >
                          Grid
                        </button>


            </div>
          </div>
        )}
                </div>

                {/* Help Menu Item */}
                <button
                  onClick={() => handleMenuItemClick('help')}
                  className="w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
                  title="Help menu"
                >
                  <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">Help</span>
                </button>
              </div>
              </>
            )}
          </div>
        )}

        {/* Canvas Info Bar with Undo/Redo */}
        {(imageUrl || activeProjectSettings) && (
          <div 
            className={`absolute top-4 left-1/2 z-[8003] pointer-events-auto transition-all duration-300 ease-out ${
              !uiVisibility.topControls 
                ? 'transform -translate-x-1/2 -translate-y-full opacity-0' 
                : 'transform -translate-x-1/2 translate-y-0 opacity-100'
            }`}
            onMouseEnter={() => setIsHoveringUI(true)}
            onMouseLeave={() => setIsHoveringUI(false)}
          >
            <div className="bg-black/70 backdrop-blur-md px-4 py-1.5 flex items-center gap-4 rounded-full border border-white/20">
              {/* DOC Info */}
              {activeProjectSettings && (
                <div className="flex items-center gap-1.5 border-r border-white/10 pr-4 mr-1">
                  <span className="text-white/40 text-[10px]">DOC</span>
                  <span className="truncate max-w-[120px] font-medium text-[10px] text-white/80">{activeProjectSettings.name}</span>
                </div>
              )}

              {/* Undo Button - Left of Fit to Screen */}
              <button
                onClick={handleUndoEdit}
                disabled={!canUndo}
                className={`w-8 h-8 backdrop-blur-md border rounded-lg flex items-center justify-center transition-all ${
                  canUndo 
                    ? 'bg-white/20 border-white/40 text-white hover:bg-white/30' 
                    : 'bg-black/20 border-white/10 text-white/30 cursor-not-allowed'
                }`}
                title="Undo edit (go back)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M3 10H13C16.866 10 20 13.134 20 17V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M7 6L3 10L7 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* Fit to Screen Text */}
              <button
                onClick={handleResetView}
                className="text-white/80 text-sm hover:text-white transition-colors"
                title="Fit to screen"
              >
                Fit to Screen
              </button>
              
              {/* Zoom Out Button */}
              <button
                onClick={handleZoomOut}
                className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white transition-all"
                title="Zoom out"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M21 21L16.514 16.506M19 10.5C19 15.194 15.194 19 10.5 19S2 15.194 2 10.5 5.806 2 10.5 2 19 5.806 19 10.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 10.5H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
              
              {/* Zoom Percentage */}
              <span className="text-white/80 text-sm font-mono min-w-[3rem] text-center">
                {Math.round(scale * 100)}%
              </span>
              
              {/* Zoom In Button */}
              <button
                onClick={handleZoomIn}
                className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white transition-all"
                title="Zoom in"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M21 21L16.514 16.506M19 10.5C19 15.194 15.194 19 10.5 19S2 15.194 2 10.5 5.806 2 10.5 2 19 5.806 19 10.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M10.5 8V13M8 10.5H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
              
              {/* Controls Text */}
              <button
                onClick={() => setShowControlsDropdown(!showControlsDropdown)}
                className="text-white/80 text-sm hover:text-white transition-colors relative"
                title="Show controls help"
              >
                Controls
                <svg 
                  width="12" 
                  height="12" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  className={`inline ml-1 transition-transform ${showControlsDropdown ? 'rotate-180' : ''}`}
                >
                  <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* Redo Button - Right of Controls */}
              <button
                onClick={handleRedoEdit}
                disabled={!canRedo}
                className={`w-8 h-8 backdrop-blur-md border rounded-lg flex items-center justify-center transition-all ${
                  canRedo 
                    ? 'bg-white/20 border-white/40 text-white hover:bg-white/30' 
                    : 'bg-black/20 border-white/10 text-white/30 cursor-not-allowed'
                }`}
                title="Redo edit (go forward)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M21 10H11C7.134 10 4 13.134 4 17V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M17 6L21 10L17 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* Technical Stats */}
              {activeProjectSettings && (
                <div className="flex items-center gap-4 border-l border-white/10 pl-4 ml-1 text-[10px] text-white/80">
                  <div className="flex items-center gap-1.5 border-r border-white/10 pr-4">
                    <span className="text-white/40">RES</span>
                    <span className="font-mono">{activeProjectSettings.resolution} PPI</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/40">SIZE</span>
                    <div className="flex items-center gap-1">
                      <span className="font-mono">{activeProjectSettings.width} x {activeProjectSettings.height}</span>
                      <span className="text-white/40">{activeProjectSettings.unit === 'inches' ? 'in' : 'px'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Controls Dropdown */}
            {showControlsDropdown && (
              <div className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg p-4 w-80 shadow-2xl">
                <h3 className="text-white text-sm font-medium mb-3">Canvas Controls</h3>
                
                <div className="space-y-3">
                  {/* Pan Control */}
                  <div className="flex items-center justify-between">
                    <span className="text-white/70 text-sm">Pan canvas</span>
                    <div className="flex items-center gap-1">
                      <kbd className="px-2 py-1 bg-white/10 rounded text-xs font-mono text-white/80">Space</kbd>
                      <span className="text-white/60 text-xs">+ Drag or</span>
                      <kbd className="px-2 py-1 bg-white/10 rounded text-xs font-mono text-white/80">Mid</kbd>
                      <span className="text-white/60 text-xs">+ Drag</span>
                    </div>
                  </div>
                  
                  {/* Zoom Control */}
                  <div className="flex items-center justify-between">
                    <span className="text-white/70 text-sm">Zoom in/out</span>
                    <span className="text-white/60 text-xs">Mouse wheel</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        

        {/* Smart Save/Close Button - Top Right */}
        {(imageUrl || activeProjectSettings) && (
          <div 
            className="absolute top-4 right-4 z-[8003] flex items-center gap-2 pointer-events-auto"
            onMouseEnter={() => setIsHoveringUI(true)}
            onMouseLeave={() => setIsHoveringUI(false)}
          >
            {/* Expandable Save Button */}
            {showSaveButton && (
              <div className="animate-in slide-in-from-right-2 duration-200">
                <button
                  onClick={handleSaveClick}
                  className={`w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center transition-all duration-200 group ${
                    showCheckmark
                      ? 'bg-green-500/30 border-green-400/60 text-green-300'
                      : 'hover:bg-black/80'
                  }`}
                  title="Save before closing"
                >
                  {showCheckmark ? (
                    // Checkmark animation in save button
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="animate-pulse">
                  <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                    <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">Save</span>
              )}
            </button>
              </div>
            )}
            
            {/* Close Button */}
            <div className="h-6 w-px bg-white/10 ml-2 mr-1" />
            <button
              onClick={handleCloseClick}
              className={`w-10 h-10 backdrop-blur-md border rounded-lg flex items-center justify-center transition-all duration-300 ${
                isCloseDisabled
                  ? 'bg-black/30 border-white/10 text-white/30 cursor-not-allowed'
                  : 'bg-black/70 border-white/20 text-white/70 hover:text-white hover:bg-black/80'
              }`}
              title={
                isCloseDisabled 
                  ? "Save first before closing" 
                  : showSaveButton
                    ? "Click to close after saving"
                    : "Close canvas"
              }
              disabled={isCloseDisabled}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* Canvas Container */}
        <div className="relative w-full h-full">
          {debugMode ? (
            /* Debug Mode: Show raw AI-edited image without canvas processing */
            <div className="w-full h-full flex items-center justify-center bg-black">
              <div className="relative">
                <img
                  src={currentActiveImageUrl || imageUrl || ''}
                  alt="Raw AI-edited image"
                  className="max-w-full max-h-full object-contain"
                  style={{ imageRendering: 'auto' }}
                />
                <div className="absolute top-2 left-2 bg-green-500/80 text-white px-2 py-1 rounded text-xs font-mono">
                  RAW MODE - Pure AI Edit
                </div>
                <div className="absolute bottom-2 left-2 bg-black/80 text-white px-2 py-1 rounded text-xs">
                  No filters applied - showing original AI result
                </div>
              </div>
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              className={`block w-full h-full transition-all duration-300 pointer-events-auto ${
                isEditing ? 'blur-sm' : ''
              } ${
                (isSpacePressed || isDragging)
                  ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') 
                  : 'cursor-default'
              }`}
              style={{ 
                imageRendering: 'auto'
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onWheel={handleWheel}
              onContextMenu={(e) => e.preventDefault()} // Prevent right-click menu
            />
          )}
          
          {/* Image Editing Loading Overlay */}
          {isEditing && (
            <div className="absolute inset-0 flex items-center justify-center z-[8003] pointer-events-none">
              <div className="bg-black/70 backdrop-blur-md border border-white/20 rounded-2xl p-8 flex flex-col items-center gap-4 shadow-2xl pointer-events-auto">
                {/* Animated Loading Circle */}
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-white/20 rounded-full">
        {uiVisibility.rulers && activeProjectSettings && (
          <>
            <Ruler type="horizontal" scale={scale} offset={translateX - 32} length={canvasSize.width || 1000} unit={activeProjectSettings.unit} resolution={activeProjectSettings.resolution} parScaleX={getParScaleX()} />
            <Ruler type="vertical" scale={scale} offset={translateY - 32} length={canvasSize.height || 1000} unit={activeProjectSettings.unit} resolution={activeProjectSettings.resolution} parScaleX={getParScaleX()} />
            <div className="absolute top-0 left-0 w-8 h-8 z-[10] flex items-center justify-center pointer-events-none bg-transparent border-none shadow-none">
              <span className="text-[8px] text-white/10 uppercase font-bold">{activeProjectSettings.unit === "inches" ? "in" : "px"}</span>
            </div>
          </>
        )}
</div>
                  <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-white rounded-full animate-spin"></div>
                  <div className="absolute inset-2 w-12 h-12 border-2 border-transparent border-t-white/60 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
                </div>
                
                {/* Loading Text */}
                <div className="text-center">
                  <h3 className="text-white text-lg font-medium mb-1">Editing Image</h3>
                  <p className="text-white/70 text-sm">AI is processing your request...</p>
                </div>
                
                {/* Progress Dots */}
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '200ms' }}></div>
                  <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '400ms' }}></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tools Panel - Floating on the left */}
      {(imageUrl || activeProjectSettings) && (
        <div 
          className={`absolute top-1/2 left-4 transform -translate-y-1/2 z-[8002] transition-all duration-300 ease-out ${
            uiVisibility.tools ? 'translate-x-0' : '-translate-x-[calc(100%+2rem)]'
          }`}
          onMouseEnter={() => {
            setIsHoveringUI(true);
            // Debug log removed for performance
          }}
          onMouseLeave={() => setIsHoveringUI(false)}
        >
          <div 
            className="bg-black/70 backdrop-blur-md border border-white/20 rounded-lg w-16 h-fit"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-3 py-2 border-b border-white/10">
              <h3 className="text-white text-sm font-medium text-center opacity-80">Tools</h3>
            </div>
            
            {/* Content */}
            <div className="p-2">
              <div className="flex flex-col gap-2 items-center">
                {/* Tool Items */}
                {Object.entries(toolsData).map(([toolKey, tool]) => {
                  const IconComponent = tool.icon;
                  return (
                    <button 
                      key={toolKey}
                      className={`w-10 h-10 border rounded-md flex items-center justify-center transition-all duration-300 hover:scale-105 aspect-square relative ${
                        isPanelOpen(toolKey)
                          ? 'bg-white/20 border-white/40 text-white'
                          : 'bg-black/50 border-white/20 text-white/70 hover:text-white hover:bg-black/70 hover:border-white/50'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePanelToggle(toolKey);
                      }}
                      onMouseEnter={() => handleToolHover(toolKey)}
                      onMouseLeave={handleToolLeave}
                    >
                      <IconComponent className="w-4 h-4 transition-all duration-300" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tool Preview Container - Shows on hover */}
      {(imageUrl || activeProjectSettings) && hoveredTool && toolsData[hoveredTool as keyof typeof toolsData] && uiVisibility.tools && (
        <div 
          className={`absolute top-1/2 left-24 transform -translate-y-1/2 z-[8003] transition-all duration-300 ease-out ${
            uiVisibility.tools ? 'translate-x-0' : '-translate-x-[calc(100%+8rem)]'
          }`}
          onMouseEnter={(e) => {
            handlePreviewHover();
            setIsHoveringUI(true);
          }}
          onMouseLeave={(e) => {
            handlePreviewLeave();
            setIsHoveringUI(false);
          }}
        >
          <div className="bg-black/95 backdrop-blur-md border border-white/10 rounded-2xl w-80 shadow-2xl overflow-hidden">
            {/* Preview Animation Area */}
            <div className="p-4">
              <div className="h-32 bg-gradient-to-br from-gray-900/30 via-gray-800/30 to-gray-900/30 relative flex items-center justify-center border border-white/20 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 text-white/60">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white/40">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-sm font-medium">Preview Animation</span>
                </div>
              </div>
            </div>
            
            {/* Tool Info */}
            <div className="px-4 pb-4 pt-2">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-white text-lg font-semibold">
                  {toolsData[hoveredTool as keyof typeof toolsData].name}
                </h2>
                <div className="bg-white/10 text-white/70 text-xs font-mono px-2 py-1 rounded border border-white/20">
                  Shift + {toolsData[hoveredTool as keyof typeof toolsData].shortcut}
                </div>
              </div>
              
              <p className="text-white/70 text-sm leading-relaxed mb-4">
                {toolsData[hoveredTool as keyof typeof toolsData].description}
              </p>
              
              {/* Watch Video Button */}
                              <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleVideoModalOpen(toolsData[hoveredTool as keyof typeof toolsData].videoUrl);
                  }}
                  className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
                >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M8 5V19L19 12L8 5Z" fill="currentColor"/>
                </svg>
                Watch quick video
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Tutorial Modal */}
      {showVideoModal && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9000] flex items-center justify-center p-2 sm:p-4 md:p-6 lg:p-8"
          onClick={() => setShowVideoModal(false)}
          onMouseEnter={() => setIsHoveringUI(true)}
          onMouseLeave={() => setIsHoveringUI(false)}
        >
          <div 
            className="bg-black/90 backdrop-blur-md border border-white/20 rounded-2xl w-full h-full max-w-[95vw] max-h-[95vh] sm:max-w-[90vw] sm:max-h-[90vh] md:max-w-[85vw] md:max-h-[85vh] lg:max-w-[80vw] lg:max-h-[80vh] xl:max-w-[75vw] xl:max-h-[75vh] overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-white/10 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600/20 border border-blue-500/30 rounded-md flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-blue-400">
                    <path d="M8 5V19L19 12L8 5Z" fill="currentColor"/>
                  </svg>
                </div>
                <div>
                  <h2 className="text-white text-lg sm:text-xl font-semibold">Tool Tutorial</h2>
                  <p className="text-white/60 text-xs sm:text-sm">Learn how to use this tool effectively</p>
                </div>
              </div>
              <button
                onClick={() => setShowVideoModal(false)}
                className="text-white/60 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10"
                title="Close video"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            
            {/* Video Container */}
            <div className="flex-1 p-4 sm:p-6 flex flex-col min-h-0">
              <div className="flex-1 bg-gray-900 rounded-lg border border-white/10 flex items-center justify-center relative overflow-hidden min-h-[300px] sm:min-h-[400px] md:min-h-[500px]">
                {currentVideoUrl ? (
                  <video
                    controls
                    autoPlay
                    className="w-full h-full object-contain rounded-lg"
                    poster="/api/placeholder/800/450"
                  >
                    <source src={currentVideoUrl} type="video/mp4" />
                    Your browser does not support the video tag.
                  </video>
                ) : (
                  <div className="text-center text-white/60">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-white/40">
                        <path d="M8 5V19L19 12L8 5Z" fill="currentColor"/>
                      </svg>
                    </div>
                    <h3 className="text-xl sm:text-2xl font-medium mb-2">Tutorial Video</h3>
                    <p className="text-sm sm:text-base text-white/40">Video content will be available soon</p>
                  </div>
                )}
              </div>
              
              {/* Video Info */}
              <div className="mt-4 p-3 sm:p-4 bg-white/5 rounded-lg border border-white/10 flex-shrink-0">
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 bg-blue-400 rounded-full mt-2 flex-shrink-0"></div>
                  <div>
                    <h4 className="text-white text-sm font-medium mb-1">Quick Tips</h4>
                    <p className="text-white/70 text-xs sm:text-sm leading-relaxed">
                      This tutorial will show you how to effectively use the {hoveredTool && toolsData[hoveredTool as keyof typeof toolsData]?.name} tool. 
                      You can pause, rewind, or replay the video at any time to follow along at your own pace.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

              {/* Removed extra closing div */}

      {/* Tool Modals - Rendered outside main canvas container to avoid backdrop interference */}
      {/* Adjustment Modal */}
      <AdjustmentModal
        isVisible={imageUrl !== null && showAdjustPanel}
        position={adjustmentPanelPosition}
        zIndex={2000}
        isDragging={isDraggingPanel}
        imageAdjustments={imageAdjustments}
        onPositionChange={setAdjustmentPanelPosition}
        onDragStart={() => setIsDraggingPanel(true)}
        onDragEnd={() => setIsDraggingPanel(false)}
        onAdjustmentChange={(adjustments) => {
          setImageAdjustments(adjustments);
          setIsSaved(false); // Reset save state when adjustments change
        }}
        onSave={() => {
          // Create a new edit in the history without saving to conversation
          if (hasAdjustments()) {
            const adjustedUrl = applyAdjustmentsToImage();
            if (adjustedUrl) {
              const newEdit = {
                id: Date.now().toString(),
                url: adjustedUrl,
                prompt: 'Image adjustments applied',
                editType: 'adjustment' as const,
                timestamp: new Date().toISOString(),
                metadata: { adjustments: imageAdjustments }
              };
              
              const newIndex = currentHistoryIndex + 1;
              
              setImageEditHistory(prev => {
                const updated = [...prev.slice(0, newIndex), newEdit];
                console.log('🎯 Adding adjustment to history:', updated);
                return updated;
              });
              
              setCurrentHistoryIndex(newIndex);
              
              // Reset adjustments and mark as saved
              resetAdjustments();
              setIsSaved(true);
            }
          }
        }}
        onReset={resetAdjustments}
        onClose={() => setShowAdjustPanel(false)}
        onBringToFront={() => bringPanelToFront('adjust')}
        isOnTop={isPanelOnTop('adjust')}
      />

      {/* Enhance Modal */}
      <EnhanceModal
        isVisible={imageUrl !== null && showEnhancePanel}
        position={enhancePanelPosition}
        zIndex={2010}
        isDragging={isDraggingEnhancePanel}
        selectedUpscaleModel={selectedUpscaleModel}
        upscaleFactor={upscaleFactor}
        isEnhancing={isEnhancing}
        upscaleModels={upscaleModels}
        onPositionChange={setEnhancePanelPosition}
        onDragStart={() => setIsDraggingEnhancePanel(true)}
        onDragEnd={() => setIsDraggingEnhancePanel(false)}
        onModelChange={(modelId) => {
          setSelectedUpscaleModel(modelId);
          const model = upscaleModels.find(m => m.id === modelId);
          if (model) {
            setUpscaleFactor(model.defaultScale);
          }
        }}
        onScaleFactorChange={setUpscaleFactor}
        onEnhance={handleEnhanceImage}
        onReset={() => {
          setSelectedUpscaleModel('real-esrgan-x4plus');
          setUpscaleFactor(4);
        }}
        onClose={() => setShowEnhancePanel(false)}
        onBringToFront={() => bringPanelToFront('enhance')}
        isOnTop={isPanelOnTop('enhance')}
      />

      {/* Segmentation Modal */}
      <SegmentationModal
        isVisible={imageUrl !== null && showSegmentationPanel}
        position={segmentationPanelPosition}
        zIndex={2020}
        onClose={() => setShowSegmentationPanel(false)}
        onBringToFront={() => bringPanelToFront('segmentation')}
        isOnTop={isPanelOnTop('segmentation')}
        imageUrl={currentActiveImageUrl}
        canvasRef={canvasRef}
        onSegmentationComplete={(maskData, originalImage) => {
          // Create a new segmented image and add to edit history
          const newEdit = {
            id: `segmentation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            url: originalImage, // For now, we'll use the original image URL
            prompt: 'AI Segmentation applied',
            editType: 'segmentation',
            timestamp: new Date().toISOString()
          };
          
          const newHistory = currentHistoryIndex === -1 
            ? [newEdit] 
            : [...imageEditHistory.slice(0, currentHistoryIndex + 1), newEdit];
          
          setImageEditHistory(newHistory);
          setCurrentHistoryIndex(newHistory.length - 1);
          setIsSaved(false);
          
          console.log('🎯 Canvas Viewer: Added segmentation to edit history:', {
            totalEdits: newHistory.length,
            currentIndex: newHistory.length - 1
          });
        }}
      />

      {/* Transform Modal */}
      <TransformModal
        isVisible={imageUrl !== null && showTransformPanel}
        position={transformPanelPosition}
        zIndex={2030}
        onClose={() => setShowTransformPanel(false)}
        onBringToFront={() => bringPanelToFront('transform')}
        isOnTop={isPanelOnTop('transform')}
      />

      {/* Brush Modal */}
      <BrushModal
        isVisible={imageUrl !== null && showBrushPanel}
        position={brushPanelPosition}
        zIndex={panelZIndices.brush}
        isDragging={isDraggingBrushPanel}
        brushSettings={brushSettings}
        onPositionChange={(position) => setBrushPanelPosition(position)}
        onDragStart={() => setIsDraggingBrushPanel(true)}
        onDragEnd={() => setIsDraggingBrushPanel(false)}
        onBrushSettingsChange={handleBrushSettingsChange}
        onSave={handleBrushSave}
        onReset={handleBrushReset}
        onClose={() => setShowBrushPanel(false)}
        onBringToFront={() => bringPanelToFront('brush')}
        isOnTop={isPanelOnTop('brush')}
        onHover={setIsHoveringUI}
        canvasRef={canvasRef}
        imageObj={imageObj}
        scale={scale}
        translateX={translateX}
        translateY={translateY}
        onBrushStroke={(strokeData) => {
          console.log('🎨 BRUSH STROKE:', strokeData);
          // Handle brush stroke data here - perfect cursor alignment
        }}
      />

      {/* Remove Modal */}
      <RemoveModal
        isVisible={imageUrl !== null && showRemovePanel}
        position={removePanelPosition}
        zIndex={2050}
        onClose={() => setShowRemovePanel(false)}
        onBringToFront={() => bringPanelToFront('remove')}
        isOnTop={isPanelOnTop('remove')}
      />

      {/* Selection Modal */}
      <SelectionModal
        isVisible={imageUrl !== null && showSelectionPanel}
        position={selectionPanelPosition}
        zIndex={2060}
        isDragging={isDraggingSelectionPanel}
        onPositionChange={setSelectionPanelPosition}
        onDragStart={() => setIsDraggingSelectionPanel(true)}
        onDragEnd={() => setIsDraggingSelectionPanel(false)}
        onClose={() => setShowSelectionPanel(false)}
        onBringToFront={() => bringPanelToFront('selection')}
        onHover={setIsHoveringUI}
        isOnTop={isPanelOnTop('selection')}
        canvasRef={canvasRef}
        imageObj={imageObj}
        scale={scale}
        translateX={translateX}
        translateY={translateY}
        onSelectionChange={setCurrentSelection}
        currentSelection={currentSelection}
      />

      {/* Text Modal */}
      <TextModal
        isVisible={imageUrl !== null && showTextPanel}
        position={textPanelPosition}
        zIndex={2070}
        isDragging={isDraggingTextPanel}
        textStyle={textStyle}
        onPositionChange={setTextPanelPosition}
        onDragStart={() => setIsDraggingTextPanel(true)}
        onDragEnd={() => setIsDraggingTextPanel(false)}
        onTextStyleChange={setTextStyle}
        onAddText={(text, style) => {
          console.log('Adding text:', text, 'with style:', style);
          // Here you would add the text to the canvas as a new layer
        }}
        onSave={() => {
          console.log('Text style saved:', textStyle);
        }}
        onReset={() => {
          setTextStyle({
            fontFamily: 'Arial',
            fontSize: 24,
            fontWeight: 'normal',
            fontStyle: 'normal',
            textAlign: 'left',
            lineHeight: 1.2,
            letterSpacing: 0,
            textDecoration: 'none',
            textTransform: 'none',
            color: '#ffffff'
          });
        }}
        onClose={() => setShowTextPanel(false)}
        onBringToFront={() => bringPanelToFront('text')}
        isOnTop={isPanelOnTop('text')}
        onHover={setIsHoveringUI}
        canvasRef={canvasRef}
        imageObj={imageObj}
        scale={scale}
        translateX={translateX}
        translateY={translateY}
      />

      {/* Shape Modal */}
      <ShapeModal
        isVisible={imageUrl !== null && showShapePanel}
        position={shapePanelPosition}
        zIndex={2080}
        isDragging={false}
        shapeStyle={shapeStyle}
        onPositionChange={setShapePanelPosition}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onShapeStyleChange={setShapeStyle}
        onShapeSelect={(shapeType) => {
          console.log('Shape selected:', shapeType);
          // Here you would set the current shape drawing tool
        }}
        onSave={() => {
          console.log('Shape style saved:', shapeStyle);
        }}
        onReset={() => {
          setShapeStyle({
            fill: true,
            fillColor: '#ffffff',
            fillOpacity: 100,
            stroke: true,
            strokeColor: '#000000',
            strokeWidth: 2,
            strokeOpacity: 100
          });
        }}
        onClose={() => setShowShapePanel(false)}
        onBringToFront={() => bringPanelToFront('shape')}
        isOnTop={isPanelOnTop('shape')}
        onHover={setIsHoveringUI}
      />

      {/* Smart Guides */}
      <SmartGuides
        canvasRef={canvasRef}
        guides={smartGuides}
        onGuidesChange={setSmartGuides}
        scale={scale}
        translateX={translateX}
        translateY={translateY}
        imageSize={imageSize}
      />

      {/* Edit History Panel - Floating on the right */}
      {(imageUrl || activeProjectSettings) && (
        <div 
          className="absolute right-4 z-[8002] transition-all duration-300 ease-out"
          style={getEditHistoryPosition()}
          onMouseEnter={() => {
            setIsHoveringUI(true);
            // Debug log removed for performance
          }}
          onMouseLeave={() => setIsHoveringUI(false)}
        >
          <div 
            className="bg-black/70 backdrop-blur-md border border-white/20 rounded-lg w-16 h-80 overflow-y-scroll scrollbar-hide"
            style={{
              scrollbarWidth: 'none', // Firefox
              msOverflowStyle: 'none', // IE and Edge
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-3 py-2 border-b border-white/10">
              <h3 className="text-white text-sm font-medium text-center opacity-80">Edits</h3>
            </div>
            
            {/* Content */}
            <div className="p-2">
              <div className="flex flex-col gap-2 items-center">
                {/* Current Active Image */}
                <div 
                  className="relative group/item cursor-pointer flex items-center justify-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentActiveImageUrl(imageUrl);
                  }}
                  title="Original image"
                >
                  <img
                    src={imageUrl}
                    alt="Current image"
                    className={`w-10 h-10 object-cover rounded-md transition-all duration-300 aspect-square ${
                      currentActiveImageUrl === imageUrl 
                        ? 'border-2 border-white/80' 
                        : 'border border-white/20 hover:border-white/50'
                    }`}
                  />
                  <div className="absolute inset-0 bg-black/10 rounded-md"></div>
                </div>
                
                {/* Edit Iterations */}
                {imageEditHistory.map((historyItem, index) => (
                  <div
                    key={historyItem.id}
                    className="relative group/item cursor-pointer flex items-center justify-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleHistoryImageClick(historyItem);
                    }}
                    title={`Edit #${index + 1}: ${historyItem.prompt}${historyItem.editType ? ` (${historyItem.editType})` : ''}`}
                  >
                    <img
                      src={historyItem.url}
                      alt="Edit iteration"
                      className={`w-10 h-10 object-cover rounded-md transition-all duration-300 hover:scale-105 aspect-square ${
                        currentActiveImageUrl === historyItem.url 
                          ? 'border-2 border-white/80' 
                          : 'border border-white/20 hover:border-white/50'
                      }`}
                    />
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/item:opacity-100 rounded-md transition-opacity duration-200"></div>
                    
                    {/* Small edit type indicator */}
                    {historyItem.editType && (
                      <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${
                        historyItem.editType === 'ai-edit' ? 'bg-blue-500' :
                        historyItem.editType === 'adjustment' ? 'bg-green-500' :
                        historyItem.editType === 'enhancement' ? 'bg-orange-500' :
                        historyItem.editType === 'segmentation' ? 'bg-purple-500' :
                        'bg-gray-500'
                      }`}></div>
                    )}
                    
                    {/* Delete button - only show on hover */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const updatedHistory = imageEditHistory.filter(item => item.id !== historyItem.id);
                        setImageEditHistory(updatedHistory);
                        
                        // If deleted item was currently active, switch to original or last remaining edit
                        if (currentActiveImageUrl === historyItem.url) {
                          if (updatedHistory.length > 0) {
                            const lastEdit = updatedHistory[updatedHistory.length - 1];
                            setCurrentActiveImageUrl(lastEdit.url);
                          } else {
                            setCurrentActiveImageUrl(imageUrl);
                          }
                        }
                      }}
                      className="absolute -top-1 -left-1 opacity-0 group-hover/item:opacity-100 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-all duration-200"
                      title="Delete this edit"
                    >
                      <X size={8} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Edit Interface - Slim container */}
      <div 
        className={`absolute bottom-0 left-0 right-0 p-4 z-[8002] transition-all duration-300 ease-out ${
          uiVisibility.chatContainer ? 'translate-y-0' : 'translate-y-full'
        }`}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setIsHoveringUI(true)}
        onMouseLeave={() => setIsHoveringUI(false)}
      >
        <div className="max-w-4xl mx-auto">
          {/* Relight Input Container - Show when relight is active */}
          {showRelightInput && (
            <div className="relative mb-3">
              <div className="flex justify-center">
                <div className="bg-black/70 backdrop-blur-md border border-white/20 rounded-xl p-4 w-96">

                  <div className="flex items-center gap-3">
                    <textarea
                      ref={relightInputRef}
                      value={relightPrompt}
                      onChange={(e) => {
                        setRelightPrompt(e.target.value);
                        // Auto-resize
                        const target = e.target;
                        target.style.height = 'auto';
                        target.style.height = Math.min(Math.max(target.scrollHeight, 40), 100) + 'px';
                      }}
                      placeholder="Describe how you want to relight the image..."
                      disabled={isEditing}
                      className={`flex-1 bg-black/50 border border-white/20 rounded-lg text-white placeholder-gray-400 resize-none outline-none focus:outline-none focus:ring-2 focus:ring-white/50 text-sm leading-relaxed px-3 py-2 ${
                        isEditing ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                      style={{ 
                        minHeight: '40px',
                        maxHeight: '100px'
                      }}
                      onKeyDown={handleRelightKeyPress}
                    />
                    <button
                      onClick={handleRelightSubmit}
                      disabled={!relightPrompt.trim() || isEditing || isRelighting}
                      className={`p-2 bg-white/20 border border-white/30 rounded-lg transition-all duration-200 ${
                        relightPrompt.trim() && !isEditing && !isRelighting
                          ? 'text-white hover:bg-white/30' 
                          : 'text-white/30 cursor-not-allowed bg-white/10'
                      }`}
                      title={isRelighting ? "Relighting in progress..." : "Apply relight settings"}
                    >
                      {isRelighting ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="5"/>
                          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Background Input Container - Show when background is active */}
          {showBackgroundInput && (
            <div className="relative mb-3">
              <div className="flex justify-center">
                <div className="bg-black/70 backdrop-blur-md border border-white/20 rounded-xl p-4 w-96">
                  <div className="flex items-center gap-3">
                    <textarea
                      ref={backgroundInputRef}
                      value={backgroundPrompt}
                      onChange={(e) => {
                        setBackgroundPrompt(e.target.value);
                        // Auto-resize
                        const target = e.target;
                        target.style.height = 'auto';
                        target.style.height = Math.min(Math.max(target.scrollHeight, 40), 100) + 'px';
                      }}
                      placeholder="Describe the new background you want..."
                      disabled={isEditing}
                      className={`flex-1 bg-black/50 border border-white/20 rounded-lg text-white placeholder-gray-400 resize-none outline-none focus:outline-none focus:ring-2 focus:ring-white/50 text-sm leading-relaxed px-3 py-2 ${
                        isEditing ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                      style={{ 
                        minHeight: '40px',
                        maxHeight: '100px'
                      }}
                      onKeyDown={handleBackgroundKeyPress}
                    />
                    <button
                      onClick={handleBackgroundSubmit}
                      disabled={!backgroundPrompt.trim() || isEditing || isBackgrounding}
                      className={`p-2 bg-white/20 border border-white/30 rounded-lg transition-all duration-200 ${
                        backgroundPrompt.trim() && !isEditing && !isBackgrounding
                          ? 'text-white hover:bg-white/30' 
                          : 'text-white/30 cursor-not-allowed bg-white/10'
                      }`}
                      title={isBackgrounding ? "Changing background..." : "Apply background change"}
                    >
                      {isBackgrounding ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 11H1v12h22V11h-8l-2-3h-4l-2 3z"/>
                          <circle cx="12" cy="17" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Reframe Image Size Container - Show when reframe is active */}
          {showReframeInput && (
            <div className="relative mb-3">
              <div className="flex justify-center">
                <div className="bg-black/70 backdrop-blur-md border border-white/20 rounded-xl p-4 w-96" style={{ position: 'relative' }}>
                  <div className="space-y-3">
                    {/* Header with Apply Button */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h3 className="text-white text-sm font-medium">Image Size</h3>
                      </div>
                      
                      {/* Apply Button */}
                      <button
                        onClick={handleReframeSubmit}
                        disabled={isEditing || isReframing}
                        className={`px-3 py-1.5 bg-black/50 backdrop-blur-md border border-white/20 rounded-lg transition-all duration-200 ${
                          !isEditing && !isReframing
                            ? 'text-white/70 hover:text-white hover:bg-black/70 hover:border-white/30' 
                            : 'text-white/30 cursor-not-allowed bg-black/30'
                        }`}
                        title={isReframing ? "Reframing in progress..." : "Apply reframe settings"}
                      >
                        {isReframing ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <span className="text-xs">Reframing...</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/>
                              <path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/>
                            </svg>
                            <span className="text-xs">Apply Reframe</span>
                          </div>
                        )}
                      </button>
                    </div>

                    {/* Aspect Ratio Dropdown and Custom Size Inputs */}
                    <div className="flex items-center gap-3">
                      {/* Aspect Ratio Dropdown (opens upward) */}
                      <div className="relative flex-1">
                        <DropdownMenu open={isAspectMenuOpen} onOpenChange={setIsAspectMenuOpen}>
                          <DropdownMenuTrigger asChild>
                            <button
                              disabled={isEditing}
                              className={`w-full text-left bg-black/50 backdrop-blur-md border border-white/20 rounded-lg text-white font-medium text-sm px-3 py-2 outline-none transition-all duration-200 ${
                                isEditing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-black/70 hover:border-white/30'
                              }`}
                              onClick={() => setIsAspectMenuOpen((v) => !v)}
                            >
                              {aspectRatioOptions.find(o => o.value === reframeAspectRatio)?.label || 'Select ratio'}
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="top" align="center" sideOffset={8} className="z-[1005] bg-black/90 border border-white/20 text-white rounded-lg p-1 w-[var(--trigger-width,12rem)]">
                            {aspectRatioOptions.map((opt) => (
                              <DropdownMenuItem
                                key={opt.value}
                                className="px-3 py-1.5 text-sm hover:bg-white/10 rounded"
                                onClick={() => {
                                  setReframeAspectRatio(opt.value);
                                  if (opt.value === 'landscape-16-9') {
                                    setReframeWidth(1024); setReframeHeight(576);
                                  } else if (opt.value === 'portrait-9-16') {
                                    setReframeWidth(576); setReframeHeight(1024);
                                  } else if (opt.value === 'square-1-1') {
                                    setReframeWidth(1024); setReframeHeight(1024);
                                  } else if (opt.value === 'landscape-4-3') {
                                    setReframeWidth(1024); setReframeHeight(768);
                                  } else if (opt.value === 'portrait-3-4') {
                                    setReframeWidth(768); setReframeHeight(1024);
                                  } else if (opt.value === 'custom') {
                                    setIsCustomSize(true);
                                  }
                                  setIsAspectMenuOpen(false);
                                }}
                              >
                                {opt.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Width and Height Inputs */}
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={reframeWidth}
                          onChange={(e) => {
                            const width = parseInt(e.target.value) || 1024;
                            setReframeWidth(width);
                            
                            // Maintain aspect ratio if not custom
                            if (reframeAspectRatio !== 'custom') {
                              if (reframeAspectRatio === 'landscape-16-9') {
                                setReframeHeight(Math.round(width * 9 / 16));
                              } else if (reframeAspectRatio === 'portrait-9-16') {
                                setReframeHeight(Math.round(width * 16 / 9));
                              } else if (reframeAspectRatio === 'square-1-1') {
                                setReframeHeight(width);
                              } else if (reframeAspectRatio === 'landscape-4-3') {
                                setReframeHeight(Math.round(width * 3 / 4));
                              } else if (reframeAspectRatio === 'portrait-3-4') {
                                setReframeHeight(Math.round(width * 4 / 3));
                              }
                            }
                          }}
                          disabled={isEditing}
                          className={`w-20 bg-black/50 backdrop-blur-md border border-white/20 rounded-lg text-white text-sm px-2 py-2 text-center outline-none focus:ring-2 focus:ring-white/50 transition-all duration-200 ${
                            isEditing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-black/70 hover:border-white/30'
                          }`}
                        />
                        <span className="text-white/40 text-sm">×</span>
                        <input
                          type="number"
                          value={reframeHeight}
                          onChange={(e) => {
                            const height = parseInt(e.target.value) || 576;
                            setReframeHeight(height);
                            
                            // Maintain aspect ratio if not custom
                            if (reframeAspectRatio !== 'custom') {
                              if (reframeAspectRatio === 'landscape-16-9') {
                                setReframeWidth(Math.round(height * 16 / 9));
                              } else if (reframeAspectRatio === 'portrait-9-16') {
                                setReframeWidth(Math.round(height * 9 / 16));
                              } else if (reframeAspectRatio === 'square-1-1') {
                                setReframeWidth(height);
                              } else if (reframeAspectRatio === 'landscape-4-3') {
                                setReframeWidth(Math.round(height * 4 / 3));
                              } else if (reframeAspectRatio === 'portrait-3-4') {
                                setReframeWidth(Math.round(height * 3 / 4));
                              }
                            }
                          }}
                          disabled={isEditing}
                          className={`w-20 bg-black/50 backdrop-blur-md border border-white/20 rounded-lg text-white text-sm px-2 py-2 text-center outline-none focus:ring-2 focus:ring-white/50 transition-all duration-200 ${
                            isEditing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-black/70 hover:border-white/30'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Model Dropdown - Show when model is active */}
          {isModelDropdownOpen && (
            <div className="relative mb-3">
              <div className="flex justify-center">
                <div className="bg-black/70 backdrop-blur-md border border-white/20 rounded-xl p-4 w-80">
                  <div className="space-y-2">
                    <div className="text-white text-sm font-medium mb-3 text-center">Select AI Model</div>
                    {modelOptions.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => handleModelSelect(model.id as any)}
                        className={`w-full p-3 rounded-lg text-left transition-all duration-200 border ${
                          selectedModel === model.id
                            ? 'bg-white/20 border-white/40 text-white'
                            : 'bg-black/30 border-white/20 text-white/80 hover:bg-white/10 hover:border-white/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-sm">{model.name}</div>
                            <div className="text-xs text-white/60 mt-1">{model.category}</div>
                          </div>
                          {selectedModel === model.id && (
                            <div className="w-4 h-4 rounded-full bg-white flex items-center justify-center">
                              <div className="w-2 h-2 rounded-full bg-black"></div>
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-white/50 mt-2 leading-relaxed">
                          {model.description}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Edit Tools - Show when toggled or animating */}
          {(showEditTools || isAnimatingTools) && (
            <div className="relative">
            
            <div className="flex justify-center gap-2 mb-3">
              {[
                  { key: 'model', icon: Cpu, label: 'Model' },
                  { key: 'retouch', icon: RotateCcw, label: 'Relight' },
                  { key: 'reframe', icon: Crop, label: 'Reframe' },
                  { key: 'background', icon: Mountain, label: 'Background' },
                  { key: 'style', icon: Palette, label: 'Style' }
              ].map((tool, index) => {
                const Icon = tool.icon;
                return (
                    <div key={tool.key} className="relative">
                      {/* Background Sub-buttons - Show above Background button when active and bound to its position */}
                      {tool.key === 'background' && showBackgroundSubButtons && (
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 flex gap-2 z-[8004]">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              // Remove action - placeholder for now
                              console.log('Remove background clicked');
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-300 bg-black/70 backdrop-blur-md border border-white/20 text-white hover:bg-black/80 hover:border-white/30"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                            </svg>
                            Remove
                          </button>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              // Change action - open background input
                              setShowBackgroundInput(true);
                              setShowBackgroundSubButtons(false); // Hide sub-buttons when input is shown
                              // Focus the input after a short delay to ensure it's rendered
                              setTimeout(() => {
                                if (backgroundInputRef.current) {
                                  backgroundInputRef.current.focus();
                                }
                              }, 100);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-300 bg-black/70 backdrop-blur-md border border-white/20 text-white hover:bg-black/80 hover:border-white/30"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h5l2 3 2-3h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-7Z"/>
                            </svg>
                            Change
                          </button>
                        </div>
                      )}
                      
                      {/* Individual Tool Tooltip */}
                      {hoveredEditTool === tool.key && toolDescriptions[tool.key as keyof typeof toolDescriptions] && (
                        <div 
                          className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[8004]"
                          onMouseEnter={handleTooltipHover}
                          onMouseLeave={handleTooltipLeave}
                        >
                          <div className="bg-black/90 backdrop-blur-md border border-white/30 rounded-lg px-4 py-3 shadow-xl w-80">
                            <p className="text-white text-xs leading-relaxed text-center">
                              {toolDescriptions[tool.key as keyof typeof toolDescriptions]}
                            </p>
                            {/* Tooltip Arrow */}
                            <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                              <div className="border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-white/30"></div>
                            </div>
                          </div>
                        </div>
                      )}
                      
                  <button
                    onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                      setHoveredTool(null);
                      setHoveredEditTool(null);
                        handlePanelToggle(tool.key);
                    }}
                        onMouseEnter={() => handleEditToolHover(tool.key)}
                        onMouseLeave={handleEditToolLeave}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-300 ${
                      isPanelOpen(tool.key)
                        ? 'bg-white text-black'
                        : 'bg-black/50 text-white hover:bg-black/70'
                    }`}
                    style={{
                      animation: isClosingTools
                        ? `slideOutToRight 0.3s ease-out forwards ${(4 - index) * 100}ms`
                        : `slideInFromLeft 0.3s ease-out forwards ${index * 100}ms`,
                      opacity: isClosingTools ? 1 : 0,
                      transform: isClosingTools ? 'translateX(0)' : 'translateX(-20px)'
                    }}
                  >
                    <Icon size={14} />
                    {tool.label}
                  </button>
                    </div>
                );
              })}
              </div>
            </div>
          )}

          {/* Simplified Input Row */}
          <div className="flex items-center gap-3">
            {/* Tools Toggle Button */}
            <button
              onClick={handleToggleEditTools}
              className="p-3 bg-black/50 backdrop-blur-md border border-white/20 rounded-xl text-white/70 hover:text-white hover:bg-black/70 transition-all duration-200"
              title="Toggle chat tools"
            >
              <Sparkles size={18} />
            </button>

            {/* Stable Input Container */}
            <div className="relative bg-black/50 backdrop-blur-md border border-white/20 rounded-xl flex-1">
              <textarea
                ref={editTextareaRef}
                value={editPrompt}
                onChange={(e) => {
                  setEditPrompt(e.target.value);
                  // Auto-resize
                  const target = e.target;
                  target.style.height = 'auto';
                  target.style.height = Math.min(Math.max(target.scrollHeight, 52), 120) + 'px';
                }}
                placeholder={isEditing ? "Editing image..." : "Describe your edits..."}
                disabled={isEditing}
                className={`w-full bg-transparent text-white placeholder-gray-400 resize-none outline-none border-none focus:outline-none focus:ring-0 focus:border-none text-sm leading-relaxed px-4 py-3 block ${
                  isEditing ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                style={{ 
                  minHeight: '52px',
                  maxHeight: '120px'
                }}
                onKeyDown={handleKeyPress}
              />
              
              {/* Loading indicator overlay */}
              {isEditing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-xl">
                  <div className="flex items-center gap-2 text-white/70">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white/70 rounded-full animate-spin"></div>
                    <span className="text-sm">Editing...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Send Button */}
            <button
              onClick={handleEditSubmit}
              disabled={!editPrompt.trim() || isEditing}
              className={`p-3 bg-black/50 backdrop-blur-md border border-white/20 rounded-xl transition-all duration-200 ${
                editPrompt.trim() && !isEditing
                  ? 'text-white/70 hover:text-white hover:bg-black/70' 
                  : 'text-white/30 cursor-not-allowed'
              }`}
              title={isEditing ? "Editing in progress..." : "Send edit prompt"}
            >
              {isEditing ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white/70 rounded-full animate-spin"></div>
              ) : (
                <Send size={18} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Style Modal */}
      {isStyleModalOpen && (
        <div 
          ref={styleModalRef}
          className="fixed bottom-36 left-1/2 transform -translate-x-1/2 w-80 h-64 bg-[#19191a] border border-[#3a3a3d] rounded-lg shadow-xl z-[8003]"
          onMouseEnter={() => setIsHoveringUI(true)}
          onMouseLeave={() => setIsHoveringUI(false)}
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
                  onClick={() => setActiveStyleTab(tab.key as any)}
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

            <div className="p-3 h-[calc(100%-34px)]">
              {/* Image Tab */}
              {activeStyleTab === 'image' && (
                <div 
                  className="w-full h-full relative"
                  onDragOver={handleStyleDragOver}
                  onDrop={handleStyleDrop}
                >
                  {styleImagePreview ? (
                    <div className="relative w-full h-full group">
                      <img 
                        src={styleImagePreview}
                        alt="Style reference"
                        className="w-full h-full object-cover rounded-lg border border-[#3a3a3d] cursor-pointer"
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
                    <div 
                      className="w-full h-full border-2 border-dashed border-[#3a3a3d] rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-gray-500 transition-colors"
                      onClick={(e) => handleStyleImageUpload(e)}
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
                  <textarea
                    value={stylePromptText}
                    onChange={(e) => setStylePromptText(e.target.value)}
                    placeholder="Describe the style you want (e.g., 'oil painting', 'cyberpunk', 'watercolor')"
                    className="w-full h-full bg-[#2a2a2b] border border-[#3a3a3d] rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                  />
                </div>
              )}

              {/* Preset Tab */}
              {activeStyleTab === 'preset' && (
                <div className="w-full h-full overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
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
      )}

      {/* Color Palette Button - Bottom Left Corner */}
      {(imageUrl || activeProjectSettings) && (
        <div 
          className="fixed bottom-4 left-4 z-[8003] flex items-center gap-2"
          onMouseEnter={() => setIsHoveringUI(true)}
          onMouseLeave={() => setIsHoveringUI(false)}
        >
          {/* Main Color Palette Button */}
          <button
            onClick={handleColorPaletteToggle}
            className="w-12 h-12 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-all duration-200"
            title="Color palette"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="13.5" cy="6.5" r=".5" strokeWidth="2"/>
              <circle cx="17.5" cy="10.5" r=".5" strokeWidth="2"/>
              <circle cx="8.5" cy="7.5" r=".5" strokeWidth="2"/>
              <circle cx="6.5" cy="12.5" r=".5" strokeWidth="2"/>
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Expandable Color Options */}
          {isColorPaletteOpen && (
            <div className="flex items-center gap-2 animate-in slide-in-from-left-2 duration-200">
              {/* Primary Color Button */}
              <button
                onClick={(e) => handleColorSelect('primary', e)}
                className="w-8 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
                title="Primary color"
              >
                <div 
                  className="w-4 h-4 rounded border border-gray-300 group-hover:scale-110 transition-transform duration-200"
                  style={{ backgroundColor: primaryColor }}
                ></div>
              </button>

              {/* Secondary Color Button */}
              <button
                onClick={(e) => handleColorSelect('secondary', e)}
                className="w-8 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
                title="Secondary color"
              >
                <div 
                  className="w-4 h-4 rounded border border-gray-300 group-hover:scale-110 transition-transform duration-200"
                  style={{ backgroundColor: secondaryColor }}
                ></div>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Layers Button/Container - Bottom Right Corner */}
      {(imageUrl || activeProjectSettings) && (
        <div 
          className={`fixed bottom-4 right-4 z-[8003] ${
            isLayersReattaching ? '' : 'transition-all duration-300 ease-out'
          } ${
            isLayersOpen 
              ? 'w-64 h-96' 
              : 'w-12 h-12'
          } ${
            isModalOverlappingButton ? 'scale-110' : 'scale-100'
          }`}
          style={{
            transformOrigin: 'bottom right'
          }}
          onMouseEnter={() => setIsHoveringUI(true)}
          onMouseLeave={() => setIsHoveringUI(false)}
        >
          <div 
            className={`layers-container w-full h-full bg-black/90 border border-white/20 rounded-lg shadow-2xl transition-all duration-300 ease-out ${
              isModalOverlappingButton ? 'border-blue-400 bg-blue-900/20' : ''
            }`}
          >
            {!isLayersOpen ? (
              // Collapsed state - just the button
            <div 
                className="w-full h-full flex items-center justify-center cursor-pointer hover:bg-black/80 rounded-lg"
                onClick={handleLayersToggle}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 17L12 22L22 17" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12L12 17L22 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            ) : (
              // Expanded state - show layers content
              <LayersContent
                layers={layers}
                imageEditHistory={imageEditHistory}
                currentHistoryIndex={currentHistoryIndex}
                selectedLayerId={selectedLayerId}
                selectedLayerIds={selectedLayerIds}
                layerOpacity={layerOpacity}
                imageObj={imageObj}
                onLayersChange={setLayers}
                onLayerCanvasesChange={(canvases: { [key: string]: HTMLCanvasElement }) => {
                  // Merge with existing canvases
                  setLayerCanvases(prev => {
                    const next = new Map(prev);
                    Object.entries(canvases).forEach(([key, value]) => {
                      next.set(key, value);
                    });
                    return next;
                  });
                }}
                onActiveLayerChange={setActiveLayerId}
                onSelectedLayerChange={setSelectedLayerId}
                onSelectedLayerIdsChange={setSelectedLayerIds}
                onHistoryIndexChange={setCurrentHistoryIndex}
                onLayerOpacityChange={setLayerOpacity}
                onRenderComposite={renderCompositeCanvas}
                onClose={handleLayersToggle}
                onDetach={handleLayersDetach}
              />
            )}
                            </div>
                            </div>
      )}

      {/* Detached Layers Modal */}
      {isLayersDetached && (
        <LayersModal
          isVisible={isLayersDetached}
          position={layersModalPosition}
          zIndex={panelZIndices.layers}
          isDragging={isDraggingLayersModal}
          layers={layers}
          imageEditHistory={imageEditHistory}
          currentHistoryIndex={currentHistoryIndex}
          selectedLayerId={selectedLayerId}
          selectedLayerIds={selectedLayerIds}
          layerOpacity={layerOpacity}
          imageObj={imageObj}
          onPositionChange={setLayersModalPosition}
          onDragStart={() => setIsDraggingLayersModal(true)}
          onDragEnd={() => setIsDraggingLayersModal(false)}
          onClose={handleLayersToggle}
          onBringToFront={() => bringPanelToFront('layers')}
          isOnTop={isPanelOnTop('layers')}
          onHover={(isHovering) => setIsHoveringUI(isHovering)}
          onLayersChange={setLayers}
          onLayerCanvasesChange={(canvases: { [key: string]: HTMLCanvasElement }) => {
            // Merge with existing canvases
            setLayerCanvases(prev => {
              const next = new Map(prev);
              Object.entries(canvases).forEach(([key, value]) => {
                next.set(key, value);
              });
              return next;
            });
          }}
          onActiveLayerChange={setActiveLayerId}
          onSelectedLayerChange={setSelectedLayerId}
          onSelectedLayerIdsChange={setSelectedLayerIds}
          onHistoryIndexChange={setCurrentHistoryIndex}
          onLayerOpacityChange={setLayerOpacity}
          onRenderComposite={renderCompositeCanvas}
          onOverlapChange={handleModalOverlapChange}
          onReattach={handleLayersReattach}
        />
      )}

      {/* Custom Brush Cursor */}
      {showBrushCursor && (
        <div
          className="fixed pointer-events-none z-[9999]"
          style={{
            left: brushCursorPosition.x,
            top: brushCursorPosition.y,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {/* Outer circle - represents brush size with shape modifications */}
          <div
            className="border-2 border-white rounded-full"
            style={{
              width: `${Math.max(8, Math.min(200, brushSettings.size * scale))}px`,
              height: `${Math.max(8, Math.min(200, brushSettings.size * scale * (brushSettings.shape?.roundness ?? 100) / 100))}px`,
              borderColor: brushSettings.color !== '#ffffff' ? brushSettings.color : 'rgba(255, 255, 255, 0.8)',
              borderRadius: brushSettings.shape?.roundness !== 100 ? '50%' : '50%',
              boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.3)',
              transform: `rotate(${brushSettings.shape?.angle ?? 0}deg)`,
              transition: 'all 0.1s ease-out',
            }}
          />
          {/* Inner dot - center point */}
          <div
            className="absolute top-1/2 left-1/2 w-1 h-1 bg-white rounded-full"
            style={{
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.5)',
            }}
          />
          {/* Hardness indicator - inner circle for soft brushes */}
          {brushSettings.hardness < 100 && (
            <div
              className="absolute top-1/2 left-1/2 border border-white/40 rounded-full"
              style={{
                width: `${Math.max(4, (brushSettings.size * scale * brushSettings.hardness) / 100)}px`,
                height: `${Math.max(4, (brushSettings.size * scale * brushSettings.hardness * (brushSettings.shape?.roundness ?? 100)) / 10000)}px`,
                transform: `translate(-50%, -50%) rotate(${brushSettings.shape?.angle ?? 0}deg)`,
              }}
            />
          )}
        </div>
      )}

      {/* Color Picker Modal */}
      <ColorPickerModal
        isVisible={isColorPickerOpen}
        position={colorPickerPosition}
        zIndex={panelZIndices.colorPicker}
        isDragging={isColorPickerDragging}
        currentColor={colorPickerType === 'primary' ? primaryColor : secondaryColor}
        colorType={colorPickerType}
        onPositionChange={setColorPickerPosition}
        onDragStart={() => setIsColorPickerDragging(true)}
        onDragEnd={() => setIsColorPickerDragging(false)}
        onColorChange={handleColorChange}
        onClose={handleColorPickerClose}
        onBringToFront={() => bringPanelToFront('colorPicker')}
        isOnTop={isPanelOnTop('colorPicker')}
        onHover={(isHovering) => setIsHoveringUI(isHovering)}
        canvasRef={canvasRef}
      />

      {/* Hidden Style File Input */}
      <input 
        type="file" 
        ref={styleFileInputRef} 
        style={{ display: 'none' }} 
        accept="image/*"
        onChange={handleStyleFileSelected}
      />
    </>
  );
};

export default CanvasViewer;

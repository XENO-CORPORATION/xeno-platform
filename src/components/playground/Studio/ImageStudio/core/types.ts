// Core types and interfaces for ImageStudio

// Advanced AI Segmentation Types and Multi-Backend Support
export interface SegmentationPoint {
  x: number;
  y: number;
  type: 1 | 0; // 1 for positive, 0 for negative
  id: string;
}

// Extend Window interface for OpenCV
declare global {
  interface Window {
    cv?: any;
  }
}

export interface SegmentationMask {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  score: number;
  backend?: string; // Which backend generated this mask
}

// Image Cache Interface for Performance Optimization
export interface ImageCacheEntry {
  url: string;
  timestamp: number;
  preloaded: boolean;
  dimensions?: { width: number; height: number };
  blob?: Blob;
}

// Image placeholder configuration
export interface ImagePlaceholderProps {
  width?: number;
  height?: number;
  aspectRatio?: string;
  className?: string;
}

export type SegmentationBackend = 'mediapipe' | 'sam' | 'onnx' | 'tensorflowjs' | 'opencv' | 'enhanced';

export interface SegmentationConfig {
  backend: SegmentationBackend;
  modelPath?: string;
  threshold?: number;
  useGPU?: boolean;
  batchSize?: number;
}

// File management interfaces
export interface AttachedFile {
  id: string;
  name: string;
  type: string; // Mime type or simple type like 'image', 'pdf', 'doc'
  fileObject?: File; // Optional: Store the actual File object if needed later
}

export interface RecentFile {
  id: string;
  name: string;
  type: string;
  size: number;
  lastUsed: number;
  preview?: string;
}

export interface ImageGenerationSession {
  id: string;
  title: string; // First user prompt or generated title
  timestamp: number; // Unix timestamp (ms) for sorting
  messages: ChatMessage[];
  settings?: {
    model: string;
    seed?: string;
    guidanceScale?: number;
    aspectRatio?: string;
    numImages?: number;
    style?: any;
  };
  // Database integration fields
  isFromDatabase?: boolean; // Flag to identify database projects
  model?: 'gpt-image-1' | 'flux-kontext';
  seed?: string;
  aspectRatio?: string;
  numImages?: number;
  guidanceScale?: number;
}

export interface ChatMessage {
    id: string;
    sender: 'user' | 'ai';
    text: string; // User text OR Raw AI response text
    parsedAnswer?: string; // Parsed answer for AI (will contain markers)
    parsedThinking?: string | null; // Parsed thinking for AI
    hasThinking?: boolean; // Derived from parsing for AI
    isError?: boolean;
    isThinkingPlaceholder?: boolean; // Flag for temporary thinking message
    isDotPlaceholder?: boolean; // Flag for temporary pulsing dot placeholder
    thinkingDuration?: number; // Added thinking duration in seconds
    modelIdUsed?: string; // Added ID of model that generated the message (if thinking)
    searchInfo?: {
        queries: string[];
        sources: { uri: string; title: string }[]; // Full source list from API
        supports?: {
            startIndex?: number;
            endIndex?: number;
            text?: string;
            sourceIndices: number[];
            confidenceScore?: number;
        }[];
    } | null;
    // New fields for footnote style
    markerToSourceIndices?: Map<number, number[]>; // Maps marker number (1, 2, ...) to source indices [0, 1, ...]
    uniqueSourcesUsed?: { index: number; uri: string; title: string }[]; // List of sources actually referenced by markers
    thinkingContent?: string; // New field for thinking content
    imageData?: string; // Added field for storing generated image data (base64)
    isGeneratingImage?: boolean; // Flag for image generation in progress
    userImageAttachment?: { file?: File; name: string; type: string; base64Data?: string; }; // Updated for serialization
    userFileAttachment?: { file?: File; name: string; type: string; content?: string; encoding?: 'text' | 'base64' }; // Updated for serialization
    isCancelled?: boolean; // New field to indicate if the AI response was cancelled
    isXenoSearchCancelled?: boolean; // New field to indicate if cancelled due to Xeno Search failure
    answerTokenCount?: number; // NEW: Token count for the AI's answer
    isLoading?: boolean; // NEW: Flag for search loading state
    isXenoDeepSearchContainer?: boolean; // New flag to identify deep search containers
    queueStatus?: string; // Queue status for image generation
    queuePosition?: number; // Position in queue for image generation
    // Conversational image generation fields
    responseId?: string; // OpenAI Responses API response ID for follow-up requests
    imageGenerationCallId?: string; // Image generation call ID for context
    imageContextId?: string; // Unique identifier for this image context (A, B, C, etc.)
    imageDescription?: string; // Brief description of the image for context tracking
}

// Canvas style modal types
export interface CanvasStyle {
  type: 'image' | 'prompt' | 'preset' | null;
  content: string;
  name?: string;
}

// Edit modes for image editing
export type EditMode = 'retouch' | 'resize' | 'upscale' | 'background' | 'adjust' | 'segmentation';

// Image edit history
export interface ImageEditHistoryItem {
  id: string;
  url: string;
  prompt: string;
}

// Multi-context conversational image generation
export interface ImageContext {
  id: string; // A, B, C, etc.
  description: string; // Brief description for reference
  responseId: string; // Latest response ID for this context
  imageGenerationCallId: string; // Latest image generation call ID
  createdAt: number; // Timestamp
  lastModified: number; // Last edit timestamp
  messageId: string; // ID of the message containing this image
}

export interface Layer {
  id: string;
  name: string;
  type: 'background' | 'empty' | 'adjustment' | 'mask' | 'group' | 'image';
  visible: boolean;
  opacity: number;
  canvas?: HTMLCanvasElement;
  image?: HTMLImageElement;
  isSelected?: boolean;
  blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';
  locked?: boolean;
  // Group functionality
  isGroup?: boolean;
  groupLayers?: Layer[];
  isExpanded?: boolean;
  parentGroupId?: string;
  // Additional metadata
  metadata?: any;
}

export interface ConversationImageState {
  conversationResponseId?: string; // Main conversation response ID
  contexts: Map<string, ImageContext>; // Map of context ID to context data
  nextContextId: string; // Next available context ID (A, B, C...)
} 
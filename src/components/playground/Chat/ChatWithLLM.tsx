import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom'; // Import createPortal
import CodeBlockWithHeader from './CodeBlockWithHeader';
import ThinkingAnimation, { ThinkingAnimationInline } from './ThinkingAnimation';
import { getGroupedModels, GroupedModels, Model, FALLBACK_MODELS } from '@/services/modelService';
import { chatService } from '@/services/chatService';
import { chatComplete } from '@/services/aiService';
import { countMessageTokens, estimateTokens as quickEstimateTokens } from '@/services/tokenizerService';
import { userDataService } from '@/services/userDataService';
import { xenoSearchService, type XenoSearchResponse, type XenoSearchSource, type WebSocketProgress } from '@/services/xenoSearchService';
import type { Conversation as DBConversation, ChatMessage as DBChatMessage } from '@/services/chatService';
import { Send, ArrowLeftRight, Compass, Waves, Clock, X, ChevronDown, ChevronRight, Plus, Play, Download, Brain, Paperclip, FolderUp, Link, FileClock, FileImage, FileText, FilePenLine, MessageSquarePlus, SquarePen, Save, Check, RefreshCcw, Copy, ThumbsUp, ThumbsDown, Lightbulb, ChevronUp, Search, ExternalLink, Info, Feather, Target, Smile, BrainCircuit, MessageSquareX, Quote, Image, WandSparkles, FileX, Trash2, WrapText, StopCircle, Mic, Globe, Loader2, Settings, TrendingUp, CheckCircle, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
// import SourcePreview from './SourcePreview'; // This line should be removed
import XenoSourcePreview from './XenoSourcePreview';
import { Disclosure } from '@headlessui/react'
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu , DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox'; // Using Checkbox for simplicity
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

// Attach the web-session bearer token (same 'xenoos_auth_token' key the rest of the
// app uses) to auth-gated, same-origin backend routes (/api/chat/generate,
// /api/piston/*, /api/fetch-metadata, /api/v2/engine/*) so they don't 401.
// Spread-conditional: a logged-out caller sends no Authorization header (and
// correctly gets 401) rather than a literal "Bearer null".
function withAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('xenoos_auth_token') : null;
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

// Transient default until the live catalog loads (overridden by the fetch below).
// Uses a REAL endpoint model id — no fabricated fallback.
const DEFAULT_MODEL: Model = {
  id: "gpt-5.6-terra",
  name: "GPT-5.6 Terra",
  maxTokens: 200000,
  inputModalities: ['text', 'image', 'file'],
  outputModalities: ['text']
};

// =============================================================================
// MODEL CAPABILITY DETECTION HELPERS
// =============================================================================
// These helpers determine model capabilities dynamically based on model metadata
// instead of using hardcoded lists. Capabilities are determined by:
// 1. inputModalities - what the model can accept (text, image, file, audio, video)
// 2. outputModalities - what the model can produce (text, image, audio)
// 3. Model ID patterns for reasoning capabilities

// Check if a model supports image/file input (for attachments)
const modelSupportsVision = (model: Model): boolean => {
  // Use dynamic capability if available
  if (model.supportsVision !== undefined) {
    return model.supportsVision;
  }
  // Fallback to input modalities check
  const modalities = model.inputModalities || ['text'];
  return modalities.includes('image') || modalities.includes('file');
};

// Check if a model supports file upload
const modelSupportsFileUpload = (model: Model): boolean => {
  // Use dynamic capability if available
  if (model.supportsFileUpload !== undefined) {
    return model.supportsFileUpload;
  }
  // Fallback to input modalities check
  const modalities = model.inputModalities || ['text'];
  return modalities.includes('file') || modalities.includes('image');
};

// Check if a model has reasoning/thinking capabilities
// Get reasoning capability from model data or fallback to ID-based detection
const modelHasReasoningCapability = (modelId: string, model?: Model): 'alwaysOn' | 'toggleable' | 'disabled' => {
  // Use model's dynamic capability if available
  if (model?.supportsReasoning) {
    return model.supportsReasoning;
  }

  // Fallback to ID-based detection for models without metadata
  const id = modelId.toLowerCase();

  // Always-on reasoning models (can't be disabled)
  if (id.includes('deepseek') && (id.includes('r1') || id.includes('v3'))) return 'alwaysOn';
  if (id.includes('openai/o1') || id.includes('openai/o3') || id.includes('openai/o4')) return 'alwaysOn';
  if (id.includes('qwen') && id.includes('thinking')) return 'alwaysOn';
  if (id.includes(':thinking')) return 'alwaysOn'; // Any model with :thinking suffix

  // Toggleable reasoning models (reasoning controlled via API parameters)
  if (id.includes('gemini-2.5') || id.includes('gemini-3')) return 'toggleable';
  if (id.includes('grok-3') || id.includes('grok-4')) return 'toggleable';
  if (id.includes('claude-sonnet-4') || id.includes('claude-opus-4') || id.includes('claude-haiku-4')) return 'toggleable';
  if (id.includes('claude-3.7-sonnet') && !id.includes(':thinking')) return 'toggleable';
  if (id.includes('deepseek/')) return 'toggleable';
  if (id.includes('qwen/')) return 'toggleable';

  // All other models don't have explicit reasoning
  return 'disabled';
};

// Models that use :thinking suffix for reasoning (legacy approach)
// Most modern models use API parameters instead, so only these specific models need the suffix
const modelsWithThinkingSuffix: Record<string, string> = {
  'anthropic/claude-3.7-sonnet': 'anthropic/claude-3.7-sonnet:thinking',
  'google/gemini-2.5-flash-preview-05-20': 'google/gemini-2.5-flash-preview-05-20:thinking',
};

// Check if a model should show thinking display when reasoning was expected but markers are missing
const shouldForceThinkingDisplay = (modelId: string): boolean => {
  return modelHasReasoningCapability(modelId) !== 'disabled';
};

// Helper to format large token counts
const formatTokens = (tokens: number): string => {
  if (tokens >= 1000000) {
    const m = tokens / 1000000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(0)}k`;
  }
  return tokens.toString();
};

// Helper to find a model by ID from grouped models array
const findModelById = (groupedModels: GroupedModels[], modelId: string): Model | undefined => {
  for (const group of groupedModels) {
    const found = group.models.find(m => m.id === modelId);
    if (found) return found;
  }
  return undefined;
};

// Helper to get all models as flat array from grouped models
const getAllModels = (groupedModels: GroupedModels[]): Model[] => {
  return groupedModels.flatMap(group => group.models);
};

// Helper to format message timestamps
const formatMessageTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  if (isToday) return timeStr;
  if (isYesterday) return `Yesterday, ${timeStr}`;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

// Helper to format date separator label
const formatDateSeparator = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return 'Today';
  if (isYesterday) return 'Yesterday';
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
};

// Check if date separator should be shown before a message
const shouldShowDateSeparator = (currentMsg: ChatMessage, prevMsg: ChatMessage | undefined): boolean => {
  if (!currentMsg.timestamp) return false;
  if (!prevMsg || !prevMsg.timestamp) return true; // Show separator for first message with timestamp

  const currentDate = new Date(currentMsg.timestamp).toDateString();
  const prevDate = new Date(prevMsg.timestamp).toDateString();
  return currentDate !== prevDate;
};

// Helper function to get company name from model ID prefix (for display purposes)
const getCompanyNameFromModelId = (modelId: string): string => {
  if (modelId.startsWith('openai/')) return 'OpenAI';
  if (modelId.startsWith('anthropic/')) return 'Anthropic';
  if (modelId.startsWith('google/')) return 'Google';
  if (modelId.startsWith('meta-llama/')) return 'Meta';
  if (modelId.startsWith('mistralai/')) return 'Mistral';
  if (modelId.startsWith('deepseek/')) return 'DeepSeek';
  if (modelId.startsWith('qwen/')) return 'Alibaba';
  if (modelId.startsWith('x-ai/')) return 'xAI';
  return 'Other';
};

// Quick token estimate for instant feedback (use real API count for accuracy)
const estimateTokens = (text: string): number => {
  return quickEstimateTokens(text);
};

// Interface for attached file state
interface AttachedFile {
  id: string;
  name: string;
    type: string; // Mime type or simple type like 'image', 'pdf', 'doc'
    fileObject?: File; // Optional: Store the actual File object if needed later
}

// Interface for Chat Message state - Revert to simpler version
interface ChatMessage {
    id: string;
    sender: 'user' | 'ai';
    text: string; // User text OR Raw AI response text
    timestamp?: number; // Unix timestamp (ms) when message was created
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
}

// --- NEW: Interface for Conversation History Item ---
interface Conversation {
    id: string;
    title: string; // e.g., first user message snippet
    timestamp: number; // Unix timestamp (ms) for sorting
    messages: ChatMessage[];
    systemPrompt?: string; // --- Store the system prompt used for this convo --- 
}
// --- END NEW ---

// --- NEW: Standalone cleanText utility function ---
const cleanText = (text: string | null): string | null => {
    if (!text) return null;
    let cleaned = text.replace(/\n{3,}/g, '\n\n'); // Reduce multiple newlines
    const trimRegex = /^\s*([*_]{1,2})\s*|\s*([*_]{1,2})\s*$/g;
    cleaned = cleaned.replace(trimRegex, '').trim(); // Remove markdown markers and final trim
    return cleaned;
};
// --- END NEW --- 

// Helper function to parse combined response text
const parseResponse = (fullText: string, reasoningExpected: boolean = false): { thinking: string | null; answer: string; hasThinking: boolean } => {
    const trimmedText = fullText.trim();

    // First, check for <think> or <thinking> tags (DeepSeek, Qwen, etc.)
    const thinkTagRegex = /<think>([\s\S]*?)<\/think>/i;
    const thinkingTagRegex = /<thinking>([\s\S]*?)<\/thinking>/i;

    const thinkMatch = trimmedText.match(thinkTagRegex);
    const thinkingMatch = trimmedText.match(thinkingTagRegex);

    if (thinkMatch || thinkingMatch) {
        const match = thinkMatch || thinkingMatch;
        const thinkingContent = match![1].trim();
        // Remove the think tags from the answer
        const answer = trimmedText
            .replace(thinkTagRegex, '')
            .replace(thinkingTagRegex, '')
            .trim();
        return {
            thinking: cleanText(thinkingContent),
            answer: cleanText(answer) || '',
            hasThinking: true
        };
    }

    // Fall back to text markers
    const thinkingRegex = /^\s*(?:#{1,6}\s+)?\**?Thinking Process:\**?\s*/im;
    const answerRegex = /^\s*(?:#{1,6}\s+)?\**?Final Answer:\**?\s*/im;

    // If reasoning is not expected, clean the text by removing any markers and their content
    if (!reasoningExpected) {
        // Remove "Thinking Process:" and everything after it (including "Final Answer:" if present)
        const thinkingMatchIndex = trimmedText.search(thinkingRegex);
        if (thinkingMatchIndex !== -1) {
            // Found "Thinking Process:" - remove it and everything after
            const cleanAnswer = trimmedText.substring(0, thinkingMatchIndex).trim();
            return { thinking: null, answer: cleanText(cleanAnswer) || '', hasThinking: false };
        }

        // Remove "Final Answer:" marker if present
        const answerMatchIndex = trimmedText.search(answerRegex);
        if (answerMatchIndex !== -1) {
            const answerMarkerMatch = trimmedText.substring(answerMatchIndex).match(answerRegex);
            const answerStartIndex = answerMatchIndex + (answerMarkerMatch ? answerMarkerMatch[0].length : 0);
            const cleanAnswer = trimmedText.substring(0, answerMatchIndex).trim() + 
                              (answerStartIndex < trimmedText.length ? '\n\n' + trimmedText.substring(answerStartIndex).trim() : '');
            return { thinking: null, answer: cleanText(cleanAnswer) || '', hasThinking: false };
        }

        // No markers found, return the full text as clean answer
        return { thinking: null, answer: cleanText(trimmedText) || '', hasThinking: false };
    }

    // Original logic for when reasoning is expected
    const thinkingMatchIndex = trimmedText.search(thinkingRegex);
    const answerMatchIndex = trimmedText.search(answerRegex);

    let thinking: string | null = null;
    let answer = trimmedText; // Default to full text if no markers
    let hasThinking = false;

    if (thinkingMatchIndex !== -1) { // Found "Thinking Process:"
        hasThinking = true;
        const thinkingMarkerMatch = trimmedText.substring(thinkingMatchIndex).match(thinkingRegex);
        const thinkingStartIndex = thinkingMatchIndex + (thinkingMarkerMatch ? thinkingMarkerMatch[0].length : 0);
        
        if (answerMatchIndex !== -1 && answerMatchIndex > thinkingMatchIndex) { // Found "Final Answer:" after "Thinking Process:"
            const answerMarkerMatch = trimmedText.substring(answerMatchIndex).match(answerRegex);
            const answerStartIndex = answerMatchIndex + (answerMarkerMatch ? answerMarkerMatch[0].length : 0);

            thinking = trimmedText.substring(thinkingStartIndex, answerMatchIndex).trim();
            answer = trimmedText.substring(answerStartIndex).trim();
        } else {
            // "Thinking Process:" found, but "Final Answer:" is missing or misplaced.
            // Try to intelligently split the content into thinking and answer parts
            const contentAfterThinking = trimmedText.substring(thinkingStartIndex);
            
            // Look for natural break points that might separate thinking from answer
            // Common patterns: double newlines, or a clear shift in tone/content
            const paragraphs = contentAfterThinking.split(/\n\s*\n/);
            
            if (paragraphs.length > 1) {
                // If we have multiple paragraphs, assume the last substantial paragraph is the answer
                // and everything before it is thinking
                let answerStartParagraphIndex = paragraphs.length - 1;
                
                // Find the last paragraph that's substantial (more than just a short phrase)
                while (answerStartParagraphIndex > 0 && paragraphs[answerStartParagraphIndex].trim().length < 20) {
                    answerStartParagraphIndex--;
                }
                
                // If we found a reasonable split point
                if (answerStartParagraphIndex > 0) {
                    thinking = paragraphs.slice(0, answerStartParagraphIndex).join('\n\n').trim();
                    answer = paragraphs.slice(answerStartParagraphIndex).join('\n\n').trim();
                    console.log("[parseResponse] 'Thinking Process:' found without 'Final Answer:' marker. Intelligently split content into thinking and answer parts.");
                } else {
                    // Fallback: treat everything as thinking, but provide a helpful message as answer
                    thinking = contentAfterThinking.trim();
                    answer = "The model provided detailed reasoning above. Please refer to the 'Thoughts' section for the complete response.";
                    console.warn("[parseResponse] 'Thinking Process:' found, but couldn't intelligently split content. Using fallback approach.");
                }
            } else {
                // Single block of content - this might be all thinking or mixed content
                // Check if it looks like it contains an answer (e.g., starts with conclusive language)
                const conclusivePatterns = /^(in conclusion|to summarize|the answer is|based on|i can see|this image|the image shows)/i;
                
                if (conclusivePatterns.test(contentAfterThinking.trim())) {
                    // Looks like it might be an answer, so treat it as such
                    thinking = null;
                    answer = contentAfterThinking.trim();
                    hasThinking = false; // Reset since we're treating this as a direct answer
                    console.log("[parseResponse] 'Thinking Process:' marker found, but content appears to be a direct answer. Treating as answer only.");
                } else {
                    // Treat as thinking with a helpful fallback answer
                    thinking = contentAfterThinking.trim();
                    answer = "The model provided detailed reasoning above. Please refer to the 'Thoughts' section for the complete response.";
                    console.warn("[parseResponse] 'Thinking Process:' found, but 'Final Answer:' marker was missing. Captured thinking, using fallback answer message.");
                }
            }
        }
    } else if (answerMatchIndex !== -1) { // Only "Final Answer:" found
        const answerMarkerMatch = trimmedText.substring(answerMatchIndex).match(answerRegex);
        const answerStartIndex = answerMatchIndex + (answerMarkerMatch ? answerMarkerMatch[0].length : 0);
        answer = trimmedText.substring(answerStartIndex).trim();
        // thinking remains null, hasThinking remains false
    } else {
        // Neither marker found
        // answer is already trimmedText (the whole response), thinking is null, hasThinking is false

        // Only log a warning if reasoning was expected but markers weren't found
        if (reasoningExpected) {
            console.warn(
                "[parseResponse] Reasoning was expected, but no 'Thinking Process:' or 'Final Answer:' markers found. Treating full text as answer. Model might not use these markers. FullText:",
                JSON.stringify(fullText) // Log the actual fullText parameter
            );
            // 'answer' is already trimmedText, so no change needed here.
            // 'thinking' is already null.
            // 'hasThinking' remains false because no "Thinking Process:" marker was found by this function.
        }
        // If reasoning was not expected, this is normal - 'answer' is already the full trimmedText.
    }

    return { thinking: cleanText(thinking), answer: cleanText(answer) || '', hasThinking };
};

// --- Refactor highlightTextWithSources for Footnote Style ---
const highlightTextWithSources = (
  text: string,
  searchInfo: ChatMessage['searchInfo']
): {
  processedHtml: string;
  markerToSourceIndices: Map<number, number[]>;
  uniqueSourcesUsed: { index: number; uri: string; title: string }[];
} => {
  const supports = searchInfo?.supports;
  const allSources = searchInfo?.sources || [];
  
  const defaultReturn = { 
      processedHtml: text, 
      markerToSourceIndices: new Map(), 
      uniqueSourcesUsed: [] 
  };

  if (!supports || supports.length === 0 || !text) return defaultReturn;

  // 1. Group supports by segment and combine unique indices
  const segmentsMap = new Map<string, { startIndex: number; endIndex: number; indices: Set<number> }>();
  for (const support of supports) {
    if (support.startIndex === undefined || support.endIndex === undefined || !support.sourceIndices) continue;
    const key = `${support.startIndex}_${support.endIndex}`;
    if (!segmentsMap.has(key)) {
      segmentsMap.set(key, {
        startIndex: support.startIndex,
        endIndex: support.endIndex,
        indices: new Set<number>(),
      });
    }
    support.sourceIndices.forEach(idx => segmentsMap.get(key)?.indices.add(idx));
  }

  // 2. Assign unique marker numbers to unique sets of source indices
  const markerMap = new Map<string, number>(); // Key: sorted indices string (e.g., "0,2"), Value: marker number (1, 2,...)
  let nextMarker = 1;
  const markerToIndices = new Map<number, number[]>();
  const usedSourceIndices = new Set<number>();

  const getMarkerNumber = (indicesSet: Set<number>): number => {
    const sortedIndices = Array.from(indicesSet).sort((a, b) => a - b);
    const key = sortedIndices.join(',');
    if (!markerMap.has(key)) {
      const markerNum = nextMarker++;
      markerMap.set(key, markerNum);
      markerToIndices.set(markerNum, sortedIndices);
      // Track which sources are actually used by markers
      sortedIndices.forEach(idx => usedSourceIndices.add(idx));
    }
    return markerMap.get(key)!;
  };

  // 3. Convert segments map, assign markers, and sort for processing
  const uniqueSegments = Array.from(segmentsMap.values())
    .map(segment => ({
      ...segment,
      markerNumber: getMarkerNumber(segment.indices)
    }))
    .sort((a, b) => b.startIndex - a.startIndex);

  // 4. Process sorted unique segments and build the result string
  let resultHtml = text;
  const lines = text.split('\n'); // Split text into lines
  
  for (const segment of uniqueSegments) {
    const segmentText = text.substring(segment.startIndex, segment.endIndex);
    if (!segmentText) continue;

    // --- Check if segment is inside a markdown table --- 
    let isInsideTable = false;
    try {
      // Find the line number containing the start of the segment
      let charCount = 0;
      let startLineIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (segment.startIndex >= charCount && segment.startIndex < charCount + lines[i].length + 1) { // +1 for newline
          startLineIndex = i;
          break;
        }
        charCount += lines[i].length + 1; // +1 for newline character
      }
      
      // Check if the line starts with a pipe (simple table detection)
      if (startLineIndex !== -1 && lines[startLineIndex].trim().startsWith('|')) {
        isInsideTable = true;
        // console.log(`Skipping highlight for segment within table: "${segmentText.substring(0,20)}..." on line ${startLineIndex + 1}`);
      }
    } catch (e) {
      console.error("Error checking if segment is inside table:", e);
      // Proceed with highlighting if check fails
    }
    // --- End table check ---

    // Inject highlight span ONLY if not inside a table
    if (!isInsideTable) {
        const highlightedSegment = `<span class="source-highlight" data-marker-id="${segment.markerNumber}">${segmentText}</span>`;
        resultHtml = resultHtml.substring(0, segment.startIndex) + highlightedSegment + resultHtml.substring(segment.endIndex);
    } else {
        // If inside table, don't modify this segment in resultHtml
    }
  }
  
  // 5. Collect details of uniquely used sources
  const uniqueSources = Array.from(usedSourceIndices)
      .sort((a, b) => a - b)
      .map(index => ({ index, ...allSources[index] }))
      .filter(source => source.uri); // Ensure source exists

  return {
    processedHtml: resultHtml,
    markerToSourceIndices: markerToIndices,
    uniqueSourcesUsed: uniqueSources
  };
};

// Find where the CSS styles are defined in the component and add these styles:
// Add to the bottom of the file or where other styles are defined
const sourceHighlightStyle = `
  .source-highlight {
    background-color: rgba(59, 130, 246, 0.1);
    border-radius: 0.25rem; /* Added from inline style */
    padding: 0 0.25rem; /* Added from inline style */
  }
  
  .inline-source-citation {
    font-size: 0.75rem;
    color: #3b82f6;
    font-weight: 500;
    cursor: pointer;
    vertical-align: super;
    margin-left: 1px;
  }
`;

// CSS styles for source highlighting
const sourceHighlightStyles = `
  .source-highlight {
    background-color: rgba(59, 130, 246, 0.2); /* Slightly more opaque background */
    border-radius: 0.25rem;
    padding: 0 0.25rem;
    cursor: pointer;
    color: #d1d5db; /* text-gray-300 for general text inside */
  }

  .source-highlight a,
  .source-highlight a:hover,
  .source-highlight a:visited { /* Ensure visited links are also styled correctly */
    color: #93c5fd; /* text-blue-300 for links */
    text-decoration: underline; /* Explicitly underline links within highlights */
  }
  
  /* We're not using visible markers anymore */
  .source-marker {
    display: none; /* Hide the markers */
  }

  .source-preview-container {
    position: absolute;
    z-index: 50;
    width: 320px;
    max-height: 240px;
    overflow: hidden;
    background-color: #111113;
    border: 1px solid #1e1e21;
    border-radius: 8px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.8);
    pointer-events: none;
    opacity: 0;
    transform: translateY(5px);
    transition: opacity 0.2s ease, transform 0.2s ease;
  }
  
  .source-preview-container.visible {
    opacity: 1;
    transform: translateY(0);
  }
  
  .source-preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background-color: #141416;
    border-bottom: 1px solid #1e1e21;
  }
  
  .source-preview-content {
    padding: 10px 12px;
    font-size: 0.875rem;
    overflow-y: auto;
    max-height: 190px;
  }
  
  .source-preview-footer {
    display: flex;
    align-items: center;
    padding: 6px 12px;
    background-color: #141416;
    border-top: 1px solid #1e1e21;
    font-size: 0.75rem;
  }

  /* Image generation styles */
  .image-container {
    width: 100%;
    max-width: 512px; /* Maximum width for the final image */
    background-color: #111113; /* Fallback background */
    border: 1px solid #1e1e21; /* Fallback border */
    border-radius: 8px;
    overflow: hidden;
    margin: 8px 0; /* Align to left (removed auto for horizontal centering) */
    transition: all 0.3s ease-out; /* Smooth transitions for size changes */
  }

  .image-container.loading {
    /* Styles for when the image is loading */
    max-width: 256px; /* Smaller max-width for loading square */
    height: 256px; /* Explicit height for square */
    aspect-ratio: 1 / 1; /* Reinforce square shape */
    background-color: #141416; /* Loading background */
    border-color: #141416; /* Match background for loading */
    /* margin: 8px auto; REMOVED to align left */
  }

  .image-generation-loading {
    display: flex;
    flex-direction: column; /* Align spinner and text vertically */
    align-items: center;
    justify-content: center;
    /* Ensure it's square by setting height equal to max-width */
    width: 100%; /* Take full width of its parent, up to max-width */
    max-width: 256px;
    height: 256px; /* Make height equal to max-width for a square */
    background-color: #141416;
    aspect-ratio: 1 / 1; /* Keep for browsers that support it well */
    /* margin: 0 auto; REMOVED to align left within .image-container.loading */
  }

  .dots-grid-container {
    display: grid;
    grid-template-columns: repeat(10, 1fr); /* 10x10 grid */
    grid-template-rows: repeat(10, 1fr);
    width: 100%; /* Fill the square container */
    height: 100%;
    padding: 10%; /* Add some padding so dots are not on the edges */
    box-sizing: border-box;
  }

  .pulsing-dot {
    width: 80%; /* Relative to grid cell */
    height: 80%; /* Relative to grid cell */
    background-color: rgba(255, 255, 255, 0.3); /* Dimmer base color */
    border-radius: 50%;
    animation: pulse 1.5s infinite ease-in-out;
    place-self: center; /* Center dot in grid cell */
  }

  /* Stagger animation delays for a nicer effect */
  /* We can create more specific delays if needed, this is a basic example */
  .pulsing-dot:nth-child(7n + 1) { animation-delay: 0s; }
  .pulsing-dot:nth-child(7n + 2) { animation-delay: 0.1s; }
  .pulsing-dot:nth-child(7n + 3) { animation-delay: 0.2s; }
  .pulsing-dot:nth-child(7n + 4) { animation-delay: 0.3s; }
  .pulsing-dot:nth-child(7n + 5) { animation-delay: 0.4s; }
  .pulsing-dot:nth-child(7n + 6) { animation-delay: 0.5s; }


  @keyframes pulse {
    0%, 100% {
      transform: scale(0.5);
      background-color: rgba(255, 255, 255, 0.2);
    }
    50% {
      transform: scale(1);
      background-color: rgba(255, 255, 255, 0.6); /* Brighter when pulsed */
    }
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 4px solid rgba(255, 255, 255, 0.1);
    border-radius: 50%;
    border-top-color: #3b82f6;
    animation: spin 1s ease-in-out infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .generated-image {
    display: block;
    width: 100%;
    height: auto;
  }

  /* Full-screen Image Viewer Styles */
  .image-viewer-overlay {
    /* Ensures clicks on the semi-transparent background close it */
    cursor: pointer;
  }

  .image-viewer-overlay img {
    /* Prevent clicks on the image itself from closing the overlay (handled by stopPropagation) */
    cursor: default;
  }

  /* Context Panel Styles - Matching Word Interface */
  .context-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    background-color: #0a0a0b;
    border-left: 1px solid #2a2a2d;
    display: flex;
    flex-direction: column;
    z-index: 40;
    transition: transform 0.3s ease-in-out;
    transform: translateX(100%);
    overflow: hidden;
  }

  .context-panel.visible {
    transform: translateX(0);
  }

  .context-panel-drag-handle {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    background-color: transparent;
    z-index: 1;
  }

  .context-panel-drag-handle:hover {
    background-color: rgba(59, 130, 246, 0.2);
  }

  .main-content-transition {
    transition: padding-right 0.3s ease-in-out, right 0.3s ease-in-out, width 0.3s ease-in-out, margin-left 0.3s ease-in-out, left 0.3s ease-in-out;
  }

  .context-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    background-color: #0a0a0b;
    border-bottom: 1px solid #2a2a2d;
    flex-shrink: 0;
    gap: 12px;
  }

  .context-panel-title {
    font-size: 13px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.8);
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
    flex: 1;
    min-width: 0;
  }

  .context-panel-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .context-panel-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #0e0e10;
    border: 1px solid #1e1e21;
    border-radius: 8px;
    padding: 0 10px;
    height: 32px;
    color: rgba(255, 255, 255, 0.6);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    font-size: 13px;
    cursor: pointer;
    user-select: none;
  }

  .context-panel-btn:hover {
    border-color: #6b7280;
    color: rgba(255, 255, 255, 0.9);
    background-color: #141416;
  }

  .context-panel-btn:active {
    transform: scale(0.95);
    background-color: #2a2a2d;
    border-color: #555;
  }

  .context-panel-btn.active {
    border-color: #6b7280;
    color: rgba(255, 255, 255, 0.9);
    background-color: #141416;
  }

  .context-panel-btn.success {
    border-color: #22c55e;
    color: #22c55e;
    background-color: rgba(34, 197, 94, 0.1);
  }

  .context-panel-btn-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #0e0e10;
    border: 1px solid #1e1e21;
    border-radius: 8px;
    width: 32px;
    height: 32px;
    color: rgba(255, 255, 255, 0.6);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
    user-select: none;
  }

  .context-panel-btn-icon:hover {
    border-color: #6b7280;
    color: rgba(255, 255, 255, 0.9);
    background-color: #141416;
  }

  .context-panel-btn-icon:active {
    transform: scale(0.9);
    background-color: #2a2a2d;
    border-color: #555;
  }

  .context-panel-btn-icon.active {
    border-color: #6b7280;
    color: rgba(255, 255, 255, 0.9);
    background-color: #141416;
  }

  .context-panel-btn-icon.success {
    border-color: #22c55e;
    color: #22c55e;
    background-color: rgba(34, 197, 94, 0.1);
  }

  .context-panel-btn-icon.close:hover {
    border-color: #ef4444;
    color: #ef4444;
    background-color: rgba(239, 68, 68, 0.1);
  }

  .context-panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
    background-color: #0e0e10;
  }

  .context-panel-content pre {
    background-color: transparent;
    padding: 16px;
    margin: 0;
    overflow-x: auto;
  }

  .context-panel-content pre code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
    line-height: 1.6;
    color: #d4d4d4;
    background-color: transparent;
    padding: 0;
  }

  .context-panel-edit-area {
    width: 100%;
    height: 100%;
    background-color: #0e0e10;
    color: #d4d4d4;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
    line-height: 1.6;
    padding: 16px;
    border: none;
    outline: none;
    resize: none;
  }

  .context-panel-edit-area:focus {
    outline: none;
  }

  /* Custom Scrollbar for Context Panel */
  .context-panel-content::-webkit-scrollbar {
    width: 8px;
  }
  .context-panel-content::-webkit-scrollbar-track {
    background: #0e0e10;
    border-radius: 4px;
  }
  .context-panel-content::-webkit-scrollbar-thumb {
    background: #1e1e21;
    border-radius: 4px;
  }
  .context-panel-content::-webkit-scrollbar-thumb:hover {
    background: #555;
  }
  .context-panel-content {
    scrollbar-width: thin;
    scrollbar-color: #1e1e21 #0e0e10;
  }

  /* Global Focus Indicators for Accessibility */
  button:focus-visible,
  input:focus-visible,
  textarea:focus-visible,
  [role="button"]:focus-visible {
    outline: 2px solid rgba(156, 163, 175, 0.5);
    outline-offset: 2px;
  }

  .context-panel-btn:focus-visible,
  .context-panel-btn-icon:focus-visible {
    outline: 2px solid rgba(156, 163, 175, 0.5);
    outline-offset: 2px;
    border-color: #6b7280;
  }

  /* AI Response Generation Dots Animation */
  .ai-response-dots .dot {
    animation: ai-response-pulse 1.4s infinite ease-in-out;
  }

  .ai-response-dots .dot:nth-child(1) {
    animation-delay: 0s;
  }

  .ai-response-dots .dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .ai-response-dots .dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes ai-response-pulse {
    0%, 80%, 100% {
      transform: scale(0.6);
      opacity: 0.4;
    }
    40% {
      transform: scale(1);
      opacity: 1;
    }
  }

  /* Chat Font Size Classes */
  .chat-font-small {
    font-size: 13px;
    line-height: 1.5;
  }
  .chat-font-small .prose {
    font-size: 13px;
  }
  .chat-font-small pre, .chat-font-small code {
    font-size: 12px;
  }

  .chat-font-medium {
    font-size: 15px;
    line-height: 1.6;
  }
  .chat-font-medium .prose {
    font-size: 15px;
  }
  .chat-font-medium pre, .chat-font-medium code {
    font-size: 13px;
  }

  .chat-font-large {
    font-size: 17px;
    line-height: 1.7;
  }
  .chat-font-large .prose {
    font-size: 17px;
  }
  .chat-font-large pre, .chat-font-large code {
    font-size: 14px;
  }
`;

// Define PistonRuntime interface here if not already globally available or imported
interface PistonRuntime { // Add this interface definition
  language: string;
  version: string;
  aliases: string[];
  runtime?: string;
}

// Define CodeBlockExecutionState interface if not already globally available or imported
interface CodeBlockExecutionState { // For the new state in ChatWithLLM
  isRunning: boolean;
  output: string | null;
  error: string | null;
}

interface HoveredSourceInfo {
  sourceIdx: number;
  sourceInfo: { uri: string; title: string };
  position: { x: number; y: number };
  messageId: string; // ID of the message this source belongs to
  type: 'marker' | 'link' | 'search_result'; // Type of hover trigger
}

const POPUP_WIDTH = 300; // px
const POPUP_MAX_HEIGHT = 240; // px
const POPUP_OFFSET_X = 15; // px, to the right of cursor
const POPUP_OFFSET_Y = 10; // px, downwards from cursor
const VIEWPORT_PADDING = 10; // px, space from viewport edges

// Define SourcePreviewComponent here
const SourcePreviewComponent: React.FC<{
  hoveredSource: HoveredSourceInfo;
  sourcePreviewData: {
    loading: boolean;
    title: string;
    description: string;
    favicon: string;
    error: boolean;
    url?: string;
  } | null;
  sourcePreviewRef: React.RefObject<HTMLDivElement>;
  isMouseOverSourcePopup: React.MutableRefObject<boolean>;
  setHoveredSource: React.Dispatch<React.SetStateAction<HoveredSourceInfo | null>>; // Added prop
}> = ({ hoveredSource, sourcePreviewData, sourcePreviewRef, isMouseOverSourcePopup, setHoveredSource }) => { // Added prop
  if (!hoveredSource) return null;

  return (
    <div
      ref={sourcePreviewRef}
      className={`source-preview-container ${hoveredSource ? 'visible' : ''}`}
      style={{
        left: `${hoveredSource.position.x}px`,
        top: `${hoveredSource.position.y}px`,
      }}
      onMouseEnter={() => (isMouseOverSourcePopup.current = true)}
      onMouseLeave={() => { isMouseOverSourcePopup.current = false; setHoveredSource(null); }}
    >
      {sourcePreviewData?.loading ? (
        <div className="source-preview-content">Loading preview...</div>
      ) : sourcePreviewData?.error ? (
        <div className="source-preview-content">Error loading preview.</div>
      ) : sourcePreviewData ? (
        <>
          <div className="source-preview-header">
            {sourcePreviewData.favicon && <img src={sourcePreviewData.favicon} alt="" style={{ width: '16px', height: '16px', marginRight: '8px' }} />}
            <span style={{ fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {sourcePreviewData.title}
            </span>
          </div>
          <div className="source-preview-content" style={{ fontSize: '0.8rem', maxHeight: '150px', overflowY: 'auto' }}>
            {sourcePreviewData.description || 'No description available.'}
          </div>
          {sourcePreviewData.url && (
            <div className="source-preview-footer">
              <a href={sourcePreviewData.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: '#93c5fd' }}>
                {sourcePreviewData.url}
              </a>
            </div>
          )}
        </>
      ) : (
        <div className="source-preview-content">Loading...</div>
      )}
    </div>
  );
};

// Enhanced Xeno Search Loading Component with progress support
const XenoSearchLoadingAnimation: React.FC<{
  message?: string;
  progress?: number;
}> = ({ message, progress }) => {
  return (
    <div className="xeno-search-container">
      <div className="flex items-center gap-3">
        {/* Search Icon with animated ring */}
        <div className="xeno-search-icon-wrapper">
          <div className="xeno-search-ring"></div>
          <Search size={18} className="text-gray-300 relative z-10" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <span className="xeno-search-title">Xeno Search</span>
              {progress !== undefined && progress > 0 && progress < 100 && (
                <span className="text-xs font-medium text-gray-400">
                  {Math.round(progress)}%
                </span>
              )}
            </h4>
          </div>

          <p className="xeno-search-message">
            {message || 'Searching the web'}
            <span className="xeno-typing-dots"></span>
          </p>

          {/* Progress bar */}
          {progress !== undefined && progress > 0 && (
            <div className="mt-2 w-full">
              <div className="h-1 bg-[#2a2a2d] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-gray-400 to-white rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Enhanced Xeno Deep Search Animation Component (inline)
const XenoDeepSearchAnimationInline: React.FC<{
  phase?: string;
  progress?: number;
  message?: string;
  data?: any;
}> = ({ phase = 'initializing', progress = 0, message = 'Initializing deep search...', data }) => {
  const getPhaseIcon = (currentPhase: string) => {
    const icons: Record<string, any> = {
      'initializing': Clock,
      'initial_search': Search,
      'analyzing_sources': Brain,
      'extracting_links': Link,
      'following_links': Globe,
      'scraping_content': FileText,
      'generating_summaries': Brain,
      'creating_comprehensive_summary': TrendingUp,
      'completed': CheckCircle
    };
    return icons[currentPhase] || Clock;
  };

  const PhaseIcon = getPhaseIcon(phase);

  return (
    <div className="xeno-search-loading">
      <div className="w-full space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 text-blue-400 bg-blue-900/30 rounded-full flex items-center justify-center">
            <PhaseIcon size={20} className="animate-pulse" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-sm font-semibold text-white">
                🔍 Xeno Deep Search
              </h4>
              <span className="text-xs font-medium text-blue-400">
                {Math.round(progress)}%
              </span>
            </div>
            <p className="text-xs text-gray-300 mb-2">
              {message}
            </p>
            <div className="w-full bg-gray-700 rounded-full h-1.5">
              <div 
                className="bg-gradient-to-r from-blue-500 to-blue-600 h-1.5 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
        
        {data && (
          <div className="text-xs text-gray-400">
            {phase === 'analyzing_sources' && data.initial_sources_count && (
              <span>• Found {data.initial_sources_count} initial sources</span>
            )}
            {phase === 'extracting_links' && data.link_candidates && (
              <span>• Discovered {data.link_candidates.length} relevant links</span>
            )}
            {phase === 'scraping_content' && data.current_url && (
              <span>• Scraping: {new URL(data.current_url).hostname}</span>
            )}
            {phase === 'completed' && data.final_results && (
              <span>• Analyzed {data.final_results.total_sources} total sources</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Enhanced Definitions for Xeno Search (Based on Integration Guide) ---
interface XenoSource {
    url: string;
    title?: string;
    snippet?: string;
    raw_text?: string; 
    summary?: string; // Enhanced: AI-generated summary of the source
}

interface XenoSearchResultsData {
    query: string;
    search_type: 'normal' | 'deep'; // More specific typing
    summary?: string; // AI-generated overall summary
    sources?: XenoSource[];
    error?: string;
    processing_time?: number; // Enhanced: Track performance
    num_results?: number; // Enhanced: Track requested vs actual results
}

interface XenoSearchConfig {
    timeout: number;
    maxRetries: number;
    defaultNumResults: number;
    maxNumResults: number;
}

// Default configuration based on guide recommendations
const XENO_SEARCH_CONFIG: XenoSearchConfig = {
    timeout: 30000, // 30 seconds as recommended in guide
    maxRetries: 1,
    defaultNumResults: 5,
    maxNumResults: 10
};
// --- End Enhanced Definitions for Xeno Search ---

interface ChatWithLLMProps {
  interfaceId?: string;
  interfaceTitle?: string;
  onCreateNewInterface?: () => void;
  onCloseInterface?: (interfaceId: string) => void;
  isMultiInterface?: boolean;
  maxInterfacesReached?: boolean;
  isStandalone?: boolean; // True when rendered without OverviewTaskbar (e.g., xeno-chat.com)
}

const ChatWithLLM: React.FC<ChatWithLLMProps> = ({
  interfaceId = 'default',
  interfaceTitle = 'Chat 1',
  onCreateNewInterface,
  onCloseInterface,
  isMultiInterface = false,
  maxInterfacesReached = false,
  isStandalone = false
}) => {
  // Initialize inputValue from localStorage draft
  const [inputValue, setInputValue] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('xeno_chat_draft') || '';
      } catch {
        return '';
      }
    }
    return '';
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isTaskbarHidden, setIsTaskbarHidden] = useState(false);
  const historySidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'H') setIsTaskbarHidden(prev => !prev);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close history when entering multi-interface mode
  useEffect(() => {
    if (isMultiInterface && isHistoryOpen) setIsHistoryOpen(false);
  }, [isMultiInterface]);

  // Close history sidebar on click outside
  useEffect(() => {
    if (!isHistoryOpen) return;
    const handler = (e: MouseEvent) => {
      if (historySidebarRef.current && !historySidebarRef.current.contains(e.target as Node)) {
        setIsHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isHistoryOpen]);

  // Touch/swipe handling for mobile
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile on mount
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Swipe gesture handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || !isMobile) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const deltaTime = Date.now() - touchStartRef.current.time;
    const screenWidth = window.innerWidth;

    // Swipe thresholds
    const minSwipeDistance = 80; // Minimum horizontal swipe distance
    const maxVerticalDeviation = 50; // Maximum allowed vertical movement
    const maxSwipeTime = 400; // Maximum swipe duration in ms
    const leftEdgeZone = screenWidth * 0.25; // Left 25% of screen for opening gesture

    const isHorizontalSwipe = Math.abs(deltaY) < maxVerticalDeviation && deltaTime < maxSwipeTime;

    // Swipe right to open: must start from left 25% of screen, or from anywhere if history is open (to allow closing by swiping in opposite direction)
    const isSwipeRight = deltaX > minSwipeDistance && isHorizontalSwipe && touchStartRef.current.x < leftEdgeZone;

    // Swipe left to close: can start from anywhere when history is open
    const isSwipeLeft = deltaX < -minSwipeDistance && isHorizontalSwipe;

    if (isSwipeRight && !isHistoryOpen) {
      setIsHistoryOpen(true);
    } else if (isSwipeLeft && isHistoryOpen) {
      setIsHistoryOpen(false);
    }

    touchStartRef.current = null;
  }, [isMobile, isHistoryOpen]);

  const [isReasonToggled, setIsReasonToggled] = useState(true);
  const [isSearchToggled, setIsSearchToggled] = useState(false);
  const [searchProvider, setSearchProvider] = useState<'google' | 'brave'>('google');
  const [isSearchProviderDropdownOpen, setIsSearchProviderDropdownOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model>(DEFAULT_MODEL);
  const [groupedModels, setGroupedModels] = useState<GroupedModels[]>(FALLBACK_MODELS);
  const [isModelsLoading, setIsModelsLoading] = useState(true);
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isConversationSelectorOpen, setIsConversationSelectorOpen] = useState(false);
  const [isWideChatEnabled, setIsWideChatEnabled] = useState(false);
  const [chatAlignment, setChatAlignment] = useState<'center' | 'left' | 'right'>('center');
  const [chatFontSize, setChatFontSize] = useState<'small' | 'medium' | 'large'>(() => {
    if (typeof window !== 'undefined') {
      try {
        return (localStorage.getItem('xeno_chat_font_size') as 'small' | 'medium' | 'large') || 'medium';
      } catch {
        return 'medium';
      }
    }
    return 'medium';
  });
  
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isRecentFilesOpen, setIsRecentFilesOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [recentFiles, setRecentFiles] = useState<Array<{
    id: string;
    name: string;
    type: string;
    size: number;
    lastUsed: number;
    preview?: string;
  }>>([]);
  const [recentFilesSearchQuery, setRecentFilesSearchQuery] = useState('');
  const [isMessageSearchOpen, setIsMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [savedSystemPrompt, setSavedSystemPrompt] = useState('');
  const [isSystemPromptSaved, setIsSystemPromptSaved] = useState(false);
  const [isCustomPromptOpen, setIsCustomPromptOpen] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);

  // Predefined personas
  const PERSONAS = [
    { id: 'engineer', label: 'Engineer', prompt: 'You are an expert software engineer. Help with coding, debugging, system design, and technical problem-solving. Provide clear, efficient solutions with best practices.' },
    { id: 'lawyer', label: 'Lawyer', prompt: 'You are an experienced legal professional. Provide legal information, help draft documents, explain legal concepts, and offer guidance on legal matters. Note: This is not legal advice.' },
    { id: 'copywriter', label: 'Copywriter', prompt: 'You are a skilled copywriter and content creator. Help craft compelling copy, marketing content, blog posts, and creative writing with engaging tone and clear messaging.' },
  ];
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedAiMessageId, setCopiedAiMessageId] = useState<string | null>(null);
  // AI message editing state
  const [editingAiMessageId, setEditingAiMessageId] = useState<string | null>(null);
  const [editingAiContent, setEditingAiContent] = useState<string>('');
  // Code block editing state
  const [editingCodeBlockId, setEditingCodeBlockId] = useState<string | null>(null);
  const [editingCodeBlockMessageId, setEditingCodeBlockMessageId] = useState<string | null>(null);
  const [editingCodeContent, setEditingCodeContent] = useState<string>('');
  const [editingCodeLanguage, setEditingCodeLanguage] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [showThinkingId, setShowThinkingId] = useState<string | null>(null);
  const [thinkingPlaceholderId, setThinkingPlaceholderId] = useState<string | null>(null);
  const [liveTimerValue, setLiveTimerValue] = useState<number | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null); // Added state for AbortController

  // Queue system state
  const [queue, setQueue] = useState<QueueState>({ messages: [], isExpanded: false });

  // Real token count state (updated via API)
  const [realTokenCount, setRealTokenCount] = useState<number>(0); // Total including input
  const [conversationTokenCount, setConversationTokenCount] = useState<number>(0); // Conversation only (for compress threshold)
  const tokenCountDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // --- NEW: State for the ID of the AI refinement placeholder message ---
  const [aiRefinementPlaceholderId, setAiRefinementPlaceholderId] = useState<string | null>(null);
  // --- END NEW ---

  // Refs used in hover effects - DECLARE EARLIER
  const sourcePreviewRef = useRef<HTMLDivElement>(null);
  const isMouseOverSourcePopup = useRef(false); // MOVED EARLIER - KEEP THIS ONE
  const indicatorPreviewRef = useRef<HTMLDivElement>(null);
  const isMouseOverIndicatorPopup = useRef(false); // MOVED EARLIER - KEEP THIS ONE
  const modelTooltipRef = useRef<HTMLDivElement>(null);
  const feedbackPopupRef = useRef<HTMLDivElement>(null);
  const dislikePopupRef = useRef<HTMLDivElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null); // chatAreaRef is used in the hover useEffect

  // --- STATE ---
  // ... (other state variables) ...

  const [hoveredSource, setHoveredSource] = useState<HoveredSourceInfo | null>(null);
  // ... (rest of the state variables) ...

  const [hoveredIndicatorInfo, setHoveredIndicatorInfo] = useState<{
    nodeKey: string;
    sources: { index: number; uri: string; title: string }[];
    position: { x: number; y: number };
  } | null>(null);
  // const indicatorPreviewRef = useRef<HTMLDivElement>(null); // Moved up
  
  const [modelTooltipInfo, setModelTooltipInfo] = useState<{
    messageId: string;
    modelId: string;
    tokenCount: number | undefined; // NEW: Add tokenCount
    position: { x: number; y: number };
  } | null>(null);

  // State for inline message info display
  const [expandedInfoMessageId, setExpandedInfoMessageId] = useState<string | null>(null);
  // const modelTooltipRef = useRef<HTMLDivElement>(null); // Moved up

  const [feedbackPopupInfo, setFeedbackPopupInfo] = useState<{
    messageId: string;
    position: { x: number; y: number };
  } | null>(null);
  // const feedbackPopupRef = useRef<HTMLDivElement>(null); // Moved up

  const [dislikePopupInfo, setDislikePopupInfo] = useState<{
    messageId: string;
    position: { x: number; y: number };
  } | null>(null);
  // const dislikePopupRef = useRef<HTMLDivElement>(null); // Moved up

  const [feedbackStatusMap, setFeedbackStatusMap] = useState<Record<string, 'liked' | 'disliked' | null>>(() => {
    try {
      const saved = localStorage.getItem('xeno_feedback_status');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const topBarRef = useRef<HTMLDivElement>(null);
  const leftButtonsRef = useRef<HTMLDivElement>(null);
  const rightButtonsRef = useRef<HTMLDivElement>(null);
  const [showTopBarBackground, setShowTopBarBackground] = useState(false);

  const companyDropdownButtonRef = useRef<HTMLButtonElement>(null);
  const companyListContainerRef = useRef<HTMLDivElement>(null);
  const modelListContainerRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsModalRef = useRef<HTMLDivElement>(null);
  const conversationSelectorButtonRef = useRef<HTMLButtonElement>(null);
  const conversationSelectorDropdownRef = useRef<HTMLDivElement>(null);

  // const sourcePreviewRef = useRef<HTMLDivElement>(null); // Moved up

  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const recentFilesPanelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const systemPromptButtonRef = useRef<HTMLButtonElement>(null);
  const systemPromptPanelRef = useRef<HTMLDivElement>(null);
  // const chatAreaRef = useRef<HTMLDivElement>(null); // Moved up
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const thinkingStartTimeRef = useRef<number | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const [sourcePreviewData, setSourcePreviewData] = useState<{
    loading: boolean;
    title: string;
    description: string;
    favicon: string;
    error: boolean;
    url?: string; // Add the URL field
  } | null>(null);

  // Add a new state variable to store pre-fetched metadata
  const [sourceMetadataCache, setSourceMetadataCache] = useState<Record<string, any>>({});

  // Determine if the specific Gemini models are selected
  const isGeminiProSelected = selectedModel?.id === 'models/gemini-2.5-pro-exp-03-25';
  const isGeminiFlashSelected = selectedModel?.id === 'models/gemini-2.5-flash-preview-04-17'; // Only 2.5 Flash
  const isGemini20Flash = selectedModel?.id === 'google/gemini-2.0-flash-001'; // Added for 2.0 Flash

  // Add this state near other useState hooks in ChatWithLLM
  const [expandedSourcesMap, setExpandedSourcesMap] = useState<Record<string, boolean>>({});

  // --- NEW: State for Conversation History ---
  const [conversationHistory, setConversationHistory] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isDbAuthenticated, setIsDbAuthenticated] = useState<boolean>(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState<boolean>(true);
  const [isSyncingToDb, setIsSyncingToDb] = useState<boolean>(false);
  // --- END NEW ---

  // Ref to prevent double conversation creation
  const isCreatingConversationRef = useRef(false);
  // Ref to prevent double conversation updates
  const isUpdatingConversationRef = useRef(false);

  // --- NEW: State for Delete Confirmation Modal ---
  const [deleteConfirmationModal, setDeleteConfirmationModal] = useState<{ 
      isOpen: boolean; 
      conversationId: string | null; 
      conversationTitle: string | null; 
  }>({ isOpen: false, conversationId: null, conversationTitle: null });
  // --- END NEW ---

  // --- NEW: State for History Search --- 
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  // --- END NEW ---

  // --- NEW: State for Context Limit Warning ---
  const [isContextLimitReached, setIsContextLimitReached] = useState(false);
  const [contextLimitWarning, setContextLimitWarning] = useState('');
  // --- END NEW ---

  // --- NEW: State for Editing Conversation Title ---
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editTitleText, setEditTitleText] = useState<string>('');
  // --- END NEW ---

  // --- NEW: State for Piston Runtimes (managed by ChatWithLLM) ---
  const [pistonRuntimes, setPistonRuntimes] = useState<PistonRuntime[]>([]);
  const [pistonRuntimesLoading, setPistonRuntimesLoading] = useState(true);
  // --- END NEW PISTON STATE ---

  // --- NEW: State to manage execution state for all code blocks ---
  const [codeBlockExecutionStates, setCodeBlockExecutionStates] = useState<Record<string, CodeBlockExecutionState>>({});
  // --- END NEW CODE BLOCK EXECUTION STATE ---

  // --- NEW: Hover state for System Prompt button ---
  const [isSystemPromptButtonHovered, setIsSystemPromptButtonHovered] = useState(false);
  // --- NEW: Hover state for Model Selector button ---
  const [isModelSelectorButtonHovered, setIsModelSelectorButtonHovered] = useState(false);
  // --- END NEW HOVER STATE ---

  // --- NEW: State for image generation ---
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedImageData, setGeneratedImageData] = useState<string | null>(null);
  const [imageGenerationMessageId, setImageGenerationMessageId] = useState<string | null>(null);
  // --- END IMAGE GENERATION STATE ---

  // --- NEW: State for LLM-based Image Prompt Refinement ---
  const [isWaitingForRefinedPromptForMessageId, setIsWaitingForRefinedPromptForMessageId] = useState<string | null>(null);
  // --- END NEW ---

  // --- NEW: State for Full-screen Image Viewer ---
  const [isFullScreenImageOpen, setIsFullScreenImageOpen] = useState(false);
  const [fullScreenImageUrl, setFullScreenImageUrl] = useState<string | null>(null);
  const [viewerShowsDownloadButton, setViewerShowsDownloadButton] = useState(false); // New state for download button visibility
  // --- END Full-screen Image Viewer STATE ---

  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
  const metadataCache = useRef<Record<string, any>>({});

  // --- State for voice input ---
  const [isVoiceInputActive, setIsVoiceInputActive] = useState(false);
  const recognitionRef = useRef<any | null>(null); // Changed SpeechRecognition to any
  const finalTranscriptRef = useRef<string>('');

  // --- State for the right context panel ---
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false);
  const [contextPanelContent, setContextPanelContent] = useState<{
    type: 'file' | 'code' | 'context' | 'model-info';
    title: string;
    content: string;
    language?: string; // For syntax highlighting
  } | null>(null);
  
  // --- State for Xeno Search ---
  const [isXenoSearchEnabled, setIsXenoSearchEnabled] = useState(false);
  const [isXenoSearching, setIsXenoSearching] = useState(false);
  const [xenoSearchResults, setXenoSearchResults] = useState<XenoSearchResultsData | null>(null);
  const [isXenoSearchHovered, setIsXenoSearchHovered] = useState(false);
  const [isXenoDeepMode, setIsXenoDeepMode] = useState(false);
  // Search progress state for streaming updates
  const [searchProgress, setSearchProgress] = useState<{ message: string; progress: number }>({
    message: 'Searching the web',
    progress: 0
  });
  const hoverEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // --- State for Xeno Deep Search Progress ---
  const [deepSearchState, setDeepSearchState] = useState<{
    phase: string;
    progress: number;
    message: string;
    data: any;
    isActive: boolean;
  }>({
    phase: 'initializing',
    progress: 0,
    message: 'Initializing deep search...',
    data: null,
    isActive: false
  });
  // --- END state for right context panel ---
  const [contextPanelWidth, setContextPanelWidth] = useState(400); // Default width 400px
  const [contextPanelWrapEnabled, setContextPanelWrapEnabled] = useState(true); // For toggling text wrap in context panel
  const [isEditingContextPanel, setIsEditingContextPanel] = useState(false); // For editing content in context panel
  const [editedContextContent, setEditedContextContent] = useState(''); // Edited content
  const [contextPanelCopySuccess, setContextPanelCopySuccess] = useState(false); // Copy success feedback
  const [contextPanelSaveSuccess, setContextPanelSaveSuccess] = useState(false); // Save success feedback
  const isResizingContextPanel = useRef(false);
  const initialMouseX = useRef(0);
  const initialPanelWidth = useRef(0);

  // --- NEW: State for the animated ellipsis text ---
  const [ellipsisText, setEllipsisText] = useState('.');
  // --- END NEW ---

  // --- State for Xeno Search Results Display ---
  const [isXenoResultsExpanded, setIsXenoResultsExpanded] = useState(false);
  // Note: xenoSearchResults state is already defined elsewhere
  // --- End State for Xeno Search Results Display ---

  // --- START: MOVED HELPER FUNCTIONS ---
  // Helper function to extract the actual URL from Vertex AI search URLs
  const extractActualUrl = useCallback((originalUrl: string): string => {
    try {
      // Check if this is a Vertex AI search URL pattern
      const redirectPrefix = 'vertexaisearch.cloud.google.com/grounding-api-redirect/';
      if (originalUrl.includes(redirectPrefix)) {
        // Find the start of the expected query parameter manually
        const urlParamKey = '?url=';
        const urlParamIndex = originalUrl.indexOf(urlParamKey);

        if (urlParamIndex !== -1) {
          // Extract the substring after "?url="
          const encodedDestUrl = originalUrl.substring(urlParamIndex + urlParamKey.length);

          if (encodedDestUrl) { // Check if not empty
            const decodedUrl = decodeURIComponent(encodedDestUrl);

            // Validate if the decoded URL looks like a real URL
            if (decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://')) {
              return decodedUrl; // Return successfully decoded URL
            }
          }
        }
        // If ?url= pattern isn't found or decoding fails,
        // we fall through to returning the original URL below.
      }
    } catch (error) {
      // Catch potential errors from decodeURIComponent or string manipulation
      console.error("[extractActualUrl] Error parsing or extracting URL:", error, "Original URL:", originalUrl);
    }
    // If extraction failed for any reason (no match, no ?url=, decode error, validation fail),
    // return the original URL as per design limitation.
    return originalUrl;
  }, []);

  // Internal function to fetch metadata (no state updates)
  const fetchSourceMetadataInternal = useCallback(async (uri: string): Promise<any> => {
    try {
      // Extract the actual URL if this is a Vertex AI search URL
      const actualUrl = extractActualUrl(uri);

      // Call API to get metadata - pass the actual URL to the API endpoint
      const response = await fetch('/api/fetch-metadata', {
        method: 'POST',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: actualUrl })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch metadata');
      }

      const data = await response.json();
      // ADDED LOG
      // console.log('[RAW AI RESPONSE] data from backend:', data);

      // Log the object being returned - ensure actualUrl is used here
      const returnObject = {
        loading: false,
        title: data.title || 'No title available',
        description: data.description || 'No description available',
        favicon: data.favicon || '',
        error: false,
        url: actualUrl // Explicitly use the extracted actualUrl, not what might be in the response
      };
      // console.log("[fetchSourceMetadataInternal] Returning object:", returnObject);

      return returnObject;

    } catch (error) {
      console.error('Error fetching metadata:', error);
      return {
        loading: false,
        title: 'Error loading preview',
        description: 'Could not retrieve metadata for this source.',
        favicon: '',
        error: true
      };
    }
  }, [extractActualUrl]);

  // Update the existing fetchSourceMetadata function to use the cache
  const fetchSourceMetadata = useCallback(async (uri: string) => {
    const comparableUri = extractActualUrl(uri);
    if (metadataCache.current[comparableUri]) {
      setSourcePreviewData(metadataCache.current[comparableUri]);
      return;
    }
    if (isFetchingMetadata) return; // Prevent multiple fetches for the same hover rapidly

    setIsFetchingMetadata(true);
    setSourcePreviewData({ loading: true, title: '', description: '', favicon: '', error: false });
    try {
      const data = await fetchSourceMetadataInternal(comparableUri);
      metadataCache.current[comparableUri] = data;
      setSourcePreviewData(data);
    } catch (error) {
      const errorData = { loading: false, error: true, title: 'Error', description: 'Could not load preview.', favicon: '' };
      metadataCache.current[comparableUri] = errorData;
      setSourcePreviewData(errorData);
    }
    setIsFetchingMetadata(false);
  }, [isFetchingMetadata, extractActualUrl, fetchSourceMetadataInternal]);

  const calculateAdjustedPopupPosition = useCallback((mouseX: number, mouseY: number) => {
    let x = mouseX + POPUP_OFFSET_X;
    let y = mouseY + POPUP_OFFSET_Y;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Check right boundary
    if (x + POPUP_WIDTH + VIEWPORT_PADDING > viewportWidth) {
      x = mouseX - POPUP_WIDTH - POPUP_OFFSET_X; // Position to the left of cursor
    }
    // Check left boundary (if positioning to the left made it overflow left)
    if (x - VIEWPORT_PADDING < 0) {
      x = VIEWPORT_PADDING;
    }

    // Check bottom boundary
    if (y + POPUP_MAX_HEIGHT + VIEWPORT_PADDING > viewportHeight) {
      y = mouseY - POPUP_MAX_HEIGHT - POPUP_OFFSET_Y; // Position above cursor
    }
    // Check top boundary (if positioning above made it overflow top)
    if (y - VIEWPORT_PADDING < 0) {
      y = VIEWPORT_PADDING;
    }
    return { x, y };
  }, []); // Depends only on constants and window properties
  // --- END: MOVED HELPER FUNCTIONS ---

  // Queue system interfaces
interface QueuedMessage {
  id: string;
  text: string;
  attachedFiles: AttachedFile[];
  timestamp: number;
}

interface QueueState {
  messages: QueuedMessage[];
  isExpanded: boolean;
}

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [inputValue]);

  // Auto-save draft to localStorage (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      try {
        if (inputValue.trim()) {
          localStorage.setItem('xeno_chat_draft', inputValue);
        } else {
          localStorage.removeItem('xeno_chat_draft');
        }
      } catch (e) {
        // localStorage might be full or unavailable
      }
    }, 500); // Save after 500ms of inactivity

    return () => clearTimeout(timeoutId);
  }, [inputValue]);

  // Fetch available models from API on component mount
  useEffect(() => {
    const loadModels = async () => {
      try {
        setIsModelsLoading(true);
        console.log('🔄 Loading models from API...');
        const models = await getGroupedModels();
        setGroupedModels(models);

        // Default to gpt-5.6-terra, else gpt-5.5, else the first available.
        const flat = models.flatMap(g => g.models);
        const preferred = flat.find(m => m.id === 'gpt-5.6-terra')
          || flat.find(m => /gpt-5\.6-terra/.test(m.id))
          || flat.find(m => m.id === 'gpt-5.5')
          || flat[0];
        if (preferred) setSelectedModel(preferred);

        console.log(`✅ Loaded ${models.length} company groups with models`);
      } catch (error) {
        console.error('❌ Failed to load models, using fallback:', error);
        // Keep using FALLBACK_MODELS which is already set as initial state
      } finally {
        setIsModelsLoading(false);
      }
    };

    loadModels();
  }, []);

  // Effect to handle clicks outside menus and tooltips
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Close attach menu (existing logic)
      if (
        (isAttachMenuOpen || isRecentFilesOpen) &&
        attachButtonRef.current &&
        !attachButtonRef.current.contains(event.target as Node) &&
        attachMenuRef.current && 
        !attachMenuRef.current.contains(event.target as Node) &&
        (!recentFilesPanelRef.current || !recentFilesPanelRef.current.contains(event.target as Node))
      ) {
        setIsAttachMenuOpen(false);
        setIsRecentFilesOpen(false);
      }
      // Close system prompt panel (existing logic)
      if (
        isSystemPromptOpen &&
        systemPromptButtonRef.current &&
        !systemPromptButtonRef.current.contains(event.target as Node) &&
        systemPromptPanelRef.current &&
        !systemPromptPanelRef.current.contains(event.target as Node)
      ) {
          setIsSystemPromptOpen(false); 
      }
      // Close model info tooltip (existing logic)
      if (
        modelTooltipInfo &&
        modelTooltipRef.current &&
        !modelTooltipRef.current.contains(event.target as Node)
      ) {
        const infoButtonWasClicked = (event.target as HTMLElement).closest('[aria-label="Show model info"]');
        if (!infoButtonWasClicked) {
           setModelTooltipInfo(null); 
        }
      }
      // Close feedback popup
      if (
        feedbackPopupInfo &&
        feedbackPopupRef.current &&
        !feedbackPopupRef.current.contains(event.target as Node)
      ) {
        // Also check if the click was on the initial Like button
        const likeButtonWasClicked = (event.target as HTMLElement).closest('[aria-label="Like response"]');
        if (!likeButtonWasClicked) {
            setFeedbackPopupInfo(null);
        }
      }
      // Close DISLIKE feedback popup
      if (
        dislikePopupInfo &&
        dislikePopupRef.current &&
        !dislikePopupRef.current.contains(event.target as Node)
      ) {
        // Also check if the click was on the initial Dislike button
        const dislikeButtonWasClicked = (event.target as HTMLElement).closest('[aria-label="Dislike response"]');
        if (!dislikeButtonWasClicked) {
            setDislikePopupInfo(null);
        }
      }
      // Close company/model dropdowns (Updated Logic)
      if (
        isCompanyDropdownOpen && // Only need to check the main dropdown state
        companyDropdownButtonRef.current && 
        !companyDropdownButtonRef.current.contains(event.target as Node) &&
        // Only check the company list container ref
        (!companyListContainerRef.current || !companyListContainerRef.current.contains(event.target as Node))
        // (!modelListContainerRef.current || !modelListContainerRef.current.contains(event.target as Node)) // Remove check for model list ref
      ) {
          setIsCompanyDropdownOpen(false);
          // setIsModelListOpen(false); // Remove
          // setSelectedCompany(null); // Remove
          setExpandedCompanies(new Set()); // Reset expanded companies
      }
      // Close settings modal
      if (
        isSettingsModalOpen &&
        settingsButtonRef.current &&
        !settingsButtonRef.current.contains(event.target as Node) &&
        settingsModalRef.current &&
        !settingsModalRef.current.contains(event.target as Node)
      ) {
          setIsSettingsModalOpen(false);
      }
      // Close conversation selector dropdown
      if (
        isConversationSelectorOpen &&
        conversationSelectorButtonRef.current &&
        !conversationSelectorButtonRef.current.contains(event.target as Node) &&
        conversationSelectorDropdownRef.current &&
        !conversationSelectorDropdownRef.current.contains(event.target as Node)
      ) {
          setIsConversationSelectorOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  // Update dependencies - remove isModelListOpen
  }, [isAttachMenuOpen, isRecentFilesOpen, isSystemPromptOpen, modelTooltipInfo, feedbackPopupInfo, dislikePopupInfo, isCompanyDropdownOpen, isSettingsModalOpen, isConversationSelectorOpen]); 

  // --- NEW: useEffect for Hover Previews in Chat Area ---
  useEffect(() => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;

    const handleMouseOverChatArea = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // console.log('[MouseOver ChatArea] Event Fired! Target:', target);

      const highlightElement = target.closest('.source-highlight') as HTMLElement | null;
      const anchorElement = target.closest('a') as HTMLAnchorElement | null;

      // const offsetX = 15; // Pixels to offset to the right - Now using calculateAdjustedPopupPosition
      // const offsetY = 10; // Pixels to offset downwards - Now using calculateAdjustedPopupPosition

      let newHoveredSource: HoveredSourceInfo | null = null;

      if (highlightElement) {
        const markerId = Number(highlightElement.getAttribute('data-marker-id'));
        const messageElement = highlightElement.closest('[data-message-id]') as HTMLElement | null;
        const messageId = messageElement?.dataset.messageId;

        if (markerId && messageId && !isNaN(markerId)) {
          const selectedMessage = messages.find(m => m.id === messageId);
          if (selectedMessage?.uniqueSourcesUsed && selectedMessage?.markerToSourceIndices) {
            const sourceIndices = selectedMessage.markerToSourceIndices.get(markerId);
            if (sourceIndices && sourceIndices.length > 0) {
              const actualSourceIndex = sourceIndices[0];
              const source = selectedMessage.uniqueSourcesUsed.find((s: { index: number; uri: string; title: string }) => s.index === actualSourceIndex);
              if (source) {
                newHoveredSource = {
                  sourceIdx: actualSourceIndex,
                  sourceInfo: { uri: source.uri, title: source.title },
                  position: calculateAdjustedPopupPosition(event.clientX, event.clientY), // Use helper
                  messageId: messageId,
                  type: 'marker'
                };
                fetchSourceMetadata(source.uri);
              }
            }
          }
        }
      } else if (anchorElement) {
        const messageElement = anchorElement.closest('[data-message-id]') as HTMLElement | null;
        const messageId = messageElement?.dataset.messageId;
        const href = anchorElement.getAttribute('href');

        if (messageId && href) {
          const selectedMessage = messages.find(m => m.id === messageId);
          if (selectedMessage?.searchInfo?.sources) {
            const matchedSource = selectedMessage.searchInfo.sources.find(s => s.uri === href);
            if (matchedSource) {
              const sourceIndex = selectedMessage.searchInfo.sources.indexOf(matchedSource);
              newHoveredSource = {
                sourceIdx: sourceIndex,
                sourceInfo: matchedSource,
                position: calculateAdjustedPopupPosition(event.clientX, event.clientY), // Use helper
                messageId: messageId,
                type: 'link'
              };
              fetchSourceMetadata(matchedSource.uri);
            }
          }
        }
      }

      if (newHoveredSource) {
        setHoveredSource(newHoveredSource);
      } else if (!isMouseOverSourcePopup.current && (!anchorElement && !highlightElement)){
        // If mouse is not over a link/highlight and not over the popup, clear
        // setHoveredSource(null); // This might be too aggressive, let mouseout of chatarea handle it if necessary
      }
    };

    const handleMouseOutChatArea = (event: MouseEvent) => {
      const relatedTarget = event.relatedTarget as HTMLElement | null;
      if (sourcePreviewRef.current && sourcePreviewRef.current.contains(relatedTarget)) {
        return; // Don't hide if moving to the popup
      }
      // More robust check: if relatedTarget is null (mouse left window) or not part of chatArea, consider hiding
      if (!relatedTarget || !chatArea.contains(relatedTarget)) {
          if (!isMouseOverSourcePopup.current) {
            //   setHoveredSource(null); // Potentially hide if mouse leaves chat area entirely and not over popup
          }
      }
    };

    chatArea.addEventListener('mouseover', handleMouseOverChatArea);
    chatArea.addEventListener('mouseout', handleMouseOutChatArea);

    return () => {
      chatArea.removeEventListener('mouseover', handleMouseOverChatArea);
      chatArea.removeEventListener('mouseout', handleMouseOutChatArea);
    };
  // Ensure messages is a dependency if selectedMessage is derived from it for hover info
  // Added calculateAdjustedPopupPosition to dependencies as it's now a memoized callback
  }, [messages, isMouseOverSourcePopup, sourcePreviewRef, chatAreaRef, fetchSourceMetadata, calculateAdjustedPopupPosition]);
  // --- END NEW useEffect for Hover Previews ---

  // --- NEW: Load/Save History from localStorage or Database ---
  // Use a shared interface ID for all chat interfaces so they share conversation history
  const sharedInterfaceId = 'playground';

  useEffect(() => {
    const loadHistory = async () => {
      setIsHistoryLoading(true);
      const storageKey = `chatHistory_${sharedInterfaceId}`;
      const token = localStorage.getItem('xenoos_auth_token');
      const isAuthenticated = !!token;
      setIsDbAuthenticated(isAuthenticated);

      if (isAuthenticated) {
        try {
          // Try to load from database - use shared interface ID so all interfaces share history
          const { conversations } = await chatService.getConversations({
            interface_id: sharedInterfaceId,
          });

          if (conversations && conversations.length > 0) {
            // Convert database format to local format
            const localFormat: Conversation[] = conversations.map(conv => ({
              id: conv.id,
              title: conv.title,
              timestamp: conv.created_at ? new Date(conv.created_at).getTime() : Date.now(),
              messages: [], // Messages loaded on demand
              systemPrompt: conv.system_prompt,
            }));
            setConversationHistory(localFormat);
            console.log("Chat history loaded from database.");
          } else {
            // No database history, check localStorage for migration
            const savedHistory = localStorage.getItem(storageKey);
            if (savedHistory) {
              try {
                const parsedHistory: Conversation[] = JSON.parse(savedHistory);
                if (Array.isArray(parsedHistory) && parsedHistory.length > 0) {
                  setConversationHistory(parsedHistory);
                  console.log("Chat history loaded from localStorage (ready for sync).");
                }
              } catch (error) {
                console.error("Error parsing localStorage history:", error);
              }
            }
          }
        } catch (error) {
          console.error("Error loading from database, falling back to localStorage:", error);
          // Fallback to localStorage
          const savedHistory = localStorage.getItem(storageKey);
          if (savedHistory) {
            try {
              const parsedHistory: Conversation[] = JSON.parse(savedHistory);
              if (Array.isArray(parsedHistory)) {
                setConversationHistory(parsedHistory);
              }
            } catch (parseError) {
              console.error("Error parsing localStorage history:", parseError);
            }
          }
        }
      } else {
        // Not authenticated, use localStorage
        const savedHistory = localStorage.getItem(storageKey);
        if (savedHistory) {
          try {
            const parsedHistory: Conversation[] = JSON.parse(savedHistory);
            if (Array.isArray(parsedHistory)) {
              setConversationHistory(parsedHistory);
              console.log("Chat history loaded from localStorage.");
            } else {
              console.warn("Invalid chat history format found in localStorage. Ignored.");
              localStorage.removeItem(storageKey);
            }
          } catch (error) {
            console.error("Error parsing chat history from localStorage:", error);
            localStorage.removeItem(storageKey);
          }
        }
      }
      setIsHistoryLoading(false);
    };

    loadHistory();
  }, [sharedInterfaceId]); // Load history once (sharedInterfaceId is constant)

  // --- NEW: Load/Save User Settings from Database ---
  useEffect(() => {
    const loadSettings = async () => {
      const token = localStorage.getItem('xenoos_auth_token');
      if (!token) return;

      try {
        const settings = await userDataService.getSettings();
        if (settings.chat) {
          if (settings.chat.wideMode !== undefined) {
            setIsWideChatEnabled(settings.chat.wideMode);
          }
          if (settings.chat.alignment) {
            setChatAlignment(settings.chat.alignment);
          }
        }
        console.log("User settings loaded from database.");
      } catch (error) {
        console.error("Error loading user settings:", error);
      }
    };

    loadSettings();
  }, []);

  // Save settings to database when they change
  const saveSettingsToDb = useCallback(async (settingPath: string, value: unknown) => {
    const token = localStorage.getItem('xenoos_auth_token');
    if (!token) return;

    try {
      await userDataService.updateSetting(settingPath, value);
    } catch (error) {
      console.error("Error saving setting to database:", error);
    }
  }, []);

  // Debounced setting save
  const settingsSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedSaveSetting = useCallback((path: string, value: unknown) => {
    if (settingsSaveTimeoutRef.current) {
      clearTimeout(settingsSaveTimeoutRef.current);
    }
    settingsSaveTimeoutRef.current = setTimeout(() => {
      saveSettingsToDb(path, value);
    }, 500);
  }, [saveSettingsToDb]);

  // Watch for settings changes and save to database
  useEffect(() => {
    debouncedSaveSetting('chat,wideMode', isWideChatEnabled);
  }, [isWideChatEnabled, debouncedSaveSetting]);

  useEffect(() => {
    debouncedSaveSetting('chat,alignment', chatAlignment);
  }, [chatAlignment, debouncedSaveSetting]);
  // --- END User Settings ---

  // --- NEW: Load/Save Recent Files from Database ---
  useEffect(() => {
    const loadRecentFiles = async () => {
      const token = localStorage.getItem('xenoos_auth_token');

      if (token) {
        // Load from database if authenticated
        try {
          const dbFiles = await userDataService.getRecentFiles(20);
          if (dbFiles && dbFiles.length > 0) {
            const localFormat = dbFiles.map(f => ({
              id: f.id,
              name: f.original_name || f.filename,
              type: f.file_type || 'unknown',
              size: f.file_size || 0,
              lastUsed: f.last_used_at ? new Date(f.last_used_at).getTime() : Date.now(),
              preview: f.metadata?.preview as string | undefined,
            }));
            setRecentFiles(localFormat);
            console.log("Recent files loaded from database.");
          }
        } catch (error) {
          console.error("Error loading recent files from database:", error);
        }
      } else {
        // Fallback to localStorage if not authenticated
        const recentFilesKey = `recentFiles_${interfaceId}`;
        const savedRecentFiles = localStorage.getItem(recentFilesKey);
        if (savedRecentFiles) {
          try {
            const parsedRecentFiles = JSON.parse(savedRecentFiles);
            if (Array.isArray(parsedRecentFiles)) {
              const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
              const validRecentFiles = parsedRecentFiles
                .filter(file => file.lastUsed > sevenDaysAgo)
                .sort((a, b) => b.lastUsed - a.lastUsed)
                .slice(0, 20);
              setRecentFiles(validRecentFiles);
            }
          } catch (error) {
            console.error("Error parsing recent files from localStorage:", error);
            localStorage.removeItem(recentFilesKey);
          }
        }
      }
    };

    loadRecentFiles();
  }, [interfaceId]);

  // Track file usage in database
  const trackFileUsage = useCallback(async (file: { name: string; type: string; size: number; preview?: string }) => {
    const token = localStorage.getItem('xenoos_auth_token');
    if (!token) return;

    try {
      await userDataService.addFile({
        filename: file.name,
        original_name: file.name,
        file_type: file.type,
        file_size: file.size,
        metadata: file.preview ? { preview: file.preview } : {},
      });
    } catch (error) {
      console.error("Error tracking file usage:", error);
    }
  }, []);

  useEffect(() => {
    // Save recent files to localStorage as fallback (for non-authenticated users)
    const token = localStorage.getItem('xenoos_auth_token');
    if (!token && recentFiles.length > 0) {
      try {
        const recentFilesKey = `recentFiles_${interfaceId}`;
        localStorage.setItem(recentFilesKey, JSON.stringify(recentFiles));
      } catch (error) {
        console.error("Error saving recent files to localStorage:", error);
      }
    }
  }, [recentFiles, interfaceId]);

  useEffect(() => {
    // Save history whenever it changes (and has items)
    // Only save to localStorage - database saves happen on specific actions (create, update, delete)
    if (!isDbAuthenticated && conversationHistory.length > 0) {
      prepareHistoryForStorage(conversationHistory)
        .then(serializableHistory => {
        try {
            const storageKey = `chatHistory_${sharedInterfaceId}`;
            localStorage.setItem(storageKey, JSON.stringify(serializableHistory));
            // console.log("Chat history saved to localStorage with serialized attachments.");
        } catch (error) {
            console.error("Error saving chat history to localStorage:", error);
            // Handle potential storage full errors if necessary
        }
        })
        .catch(error => {
          console.error("Error preparing history for storage:", error);
        });
    }
     // If history becomes empty and not using database, remove from localStorage
     else if (!isDbAuthenticated) {
         const storageKey = `chatHistory_${sharedInterfaceId}`;
         if (localStorage.getItem(storageKey)) {
             localStorage.removeItem(storageKey);
         }
     }
  }, [conversationHistory, sharedInterfaceId, isDbAuthenticated]); // Run whenever conversationHistory changes
  // --- END NEW ---

  // Effect to scroll chat area to bottom when messages change
  useEffect(() => {
      if (chatAreaRef.current) {
          chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
      }
  }, [messages]);

  // Effect to resize edit textarea when editing starts or text changes
  useEffect(() => {
    const textarea = editInputRef.current;
    if (textarea && editingMessageId) {
      // Optional: Focus the textarea
      textarea.focus();
      // Auto-resize logic
      textarea.style.height = 'auto'; // Reset height
      textarea.style.height = `${textarea.scrollHeight}px`; // Set to content height
    }
  }, [editText, editingMessageId]); // Run when edit mode starts or text changes

  // Effect for Live Thinking Timer
  useEffect(() => {
    let timerInterval: NodeJS.Timeout | null = null;

    // Start timer only if a placeholder exists and start time is known
    if (thinkingPlaceholderId && thinkingStartTimeRef.current) {
      // Ensure timer starts from correct elapsed time if component re-renders
      const initialElapsed = Math.max(0, Math.floor((Date.now() - thinkingStartTimeRef.current) / 1000));
      setLiveTimerValue(initialElapsed);

      timerInterval = setInterval(() => {
         // Calculate elapsed time accurately each interval
         if (thinkingStartTimeRef.current) {
            const elapsed = Math.floor((Date.now() - thinkingStartTimeRef.current) / 1000);
             setLiveTimerValue(elapsed);
         } else {
             // Stop interval if start time ref got cleared unexpectedly
             if (timerInterval) clearInterval(timerInterval);
             setLiveTimerValue(null);
         }
      }, 1000); // Update every second
    } else {
        // If no placeholder, ensure timer is null
        setLiveTimerValue(null);
    }

    // Cleanup function
    return () => {
      if (timerInterval) {
        clearInterval(timerInterval);
      }
      // Reset placeholder ID when the trigger condition changes or component unmounts
      // This assumes handleGenerate sets placeholderId BEFORE triggering this effect
      if (!thinkingPlaceholderId) { // If the id was cleared by response handling
          setLiveTimerValue(null);
      }
       // We might not need to reset placeholderId here, handleGenerate should manage it?
       // Let's rely on the success/error path in handleGenerate to clear the ID state
       // after the corresponding setMessages update.
    };
  }, [thinkingPlaceholderId]); // Re-run effect when placeholder ID changes

  // --- NEW: Effect to check and warn for context limit ---
  useEffect(() => {
    const historyTokens = messages.reduce((acc, message) => {
      let messageTokens = 0;
      if (message.sender === 'user') {
        messageTokens = estimateTokens(message.text || '');
      } else { // AI message
        messageTokens = estimateTokens(message.parsedAnswer || message.text || '');
      }
      return acc + messageTokens;
    }, 0);

    const currentInputTokens = estimateTokens(inputValue);
    const systemTokens = estimateTokens(savedSystemPrompt);
    const prospectiveTotalTokens = historyTokens + currentInputTokens + systemTokens;
    const maxModelTokens = selectedModel.maxTokens;

    if (prospectiveTotalTokens > maxModelTokens) {
      setIsContextLimitReached(true);
      setContextLimitWarning(
        `Max context window of ${selectedModel.name} (${formatTokens(maxModelTokens)}) will be exceeded. Shorten your message or start a new chat.`
      );
    } else {
      setIsContextLimitReached(false);
      setContextLimitWarning('');
    }
  }, [messages, inputValue, savedSystemPrompt, selectedModel]);
  // --- END NEW EFFECT ---

  // --- NEW: Effect for Dynamic Top Bar Background ---
  useEffect(() => {
    const checkOverlap = () => {
      // Ensure all refs are available
      if (topBarRef.current && leftButtonsRef.current && rightButtonsRef.current) {
        // const topBarRect = topBarRef.current.getBoundingClientRect(); // No longer needed for this logic
        const leftRect = leftButtonsRef.current.getBoundingClientRect();
        const rightRect = rightButtonsRef.current.getBoundingClientRect();

        // --- NEW LOGIC v2 ---
        // Calculate the horizontal space between the button groups
        const spaceBetween = rightRect.left - leftRect.right;

        // Define a minimum space threshold before background appears
        const minimumSpaceThreshold = 700; // pixels (Adjust as needed)

        // Determine if the space is less than the threshold
        const shouldShowBackground = spaceBetween < minimumSpaceThreshold;
        // --- END NEW LOGIC v2 ---

        // Update state only if it changes
        setShowTopBarBackground(currentValue => {
          if (shouldShowBackground !== currentValue) {
            // Updated console log for clarity
            // console.log(`Background Trigger: ${shouldShowBackground}. Space Between: ${spaceBetween.toFixed(2)}, Threshold: ${minimumSpaceThreshold}`);
            return shouldShowBackground;
          }
          return currentValue;
        });
      }
    };

    // Initial check
    checkOverlap();

    // Use ResizeObserver if available
    if (typeof ResizeObserver !== 'undefined' && topBarRef.current) {
      const resizeObserver = new ResizeObserver(checkOverlap);
      resizeObserver.observe(topBarRef.current);

      // Cleanup function
      return () => {
        if (topBarRef.current) {
          resizeObserver.unobserve(topBarRef.current);
        }
        resizeObserver.disconnect();
      };
    } else {
      // Fallback to window resize listener (less efficient)
      window.addEventListener('resize', checkOverlap);
      return () => window.removeEventListener('resize', checkOverlap);
    }

  }, []); // Run only once on mount to set up observers/listeners
  // --- END NEW ---

  // --- NEW: Effect to animate ellipsisText for the refinement placeholder ---
  useEffect(() => {
    let animationInterval: NodeJS.Timeout | null = null;
    if (messages.some(msg => msg.id === aiRefinementPlaceholderId && msg.isThinkingPlaceholder)) {
      animationInterval = setInterval(() => {
        setEllipsisText(prev => {
          if (prev === '...') return '.';
          if (prev === '..') return '...';
          if (prev === '.') return '..';
          return '.';
        });
      }, 500); // Adjust speed as needed
    } else {
      if (animationInterval) {
        clearInterval(animationInterval);
      }
      setEllipsisText('.'); // Reset when not active
    }
    return () => {
      if (animationInterval) {
        clearInterval(animationInterval);
      }
    };
  }, [messages, aiRefinementPlaceholderId]); // Re-run if messages or the ID changes
  // --- END NEW ---

  // --- NEW: useEffect to fetch Piston Runtimes ONCE on ChatWithLLM mount ---
  useEffect(() => {
    setPistonRuntimesLoading(true);
    const fetchPistonRuntimes = async () => {
      try {
        const response = await fetch('/api/piston/runtimes', { headers: withAuthHeaders() });
        if (!response.ok) {
          // Silently handle Piston service not being available in development
          setPistonRuntimes([]);
          setPistonRuntimesLoading(false);
          return;
        }
        const data: PistonRuntime[] = await response.json();
        setPistonRuntimes(data);
        console.log(`[ChatWithLLM] Successfully loaded ${data.length} code execution runtimes.`);
      } catch (error) {
        // Piston service is optional - fail silently in development
        setPistonRuntimes([]);
      } finally {
        setPistonRuntimesLoading(false);
      }
    };
    fetchPistonRuntimes();
  }, []); // Empty dependency array ensures this runs only once
  // --- END NEW PISTON RUNTIMES useEffect ---

  // --- NEW: Effect for Web Speech API (SpeechRecognition) ---
  useEffect(() => {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      console.warn('Web Speech API is not supported in this browser.');
      return;
    }

    recognitionRef.current = new SpeechRecognitionAPI();
    const recognition = recognitionRef.current;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US'; // Or make this configurable

    recognition.onstart = () => {
      // console.log('Voice recognition started.');
    };

    recognition.onend = () => {
      // console.log('Voice recognition ended.');
      setIsVoiceInputActive(false);
      // finalTranscriptRef.current = ''; // Resetting here might be too soon if user clicks send quickly
    };

    recognition.onerror = (event: any) => { // Changed event type to any
      console.error('Speech recognition error:', event.error);
      // Handle common errors more gracefully
      if (event.error === 'no-speech' || event.error === 'audio-capture' || event.error === 'not-allowed') {
        // Optionally, provide user feedback here
      }
      setIsVoiceInputActive(false);
    };

    recognition.onresult = (event: any) => { // Changed SpeechRecognitionEvent to any
      let interimTranscript = '';
      // Keep the existing input value if we are appending to it
      // This will be refined when starting recognition
      let currentFinalTranscript = finalTranscriptRef.current;

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          currentFinalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      finalTranscriptRef.current = currentFinalTranscript; // Update the ref with the latest final part
      setInputValue(currentFinalTranscript + interimTranscript);
    };

    // Cleanup on component unmount
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        if (isVoiceInputActive) { // Check if it was active before trying to stop
            recognitionRef.current.stop();
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount. isVoiceInputActive is intentionally omitted from deps for cleanup logic.

  const handleToggleVoiceInput = () => {
    if (!recognitionRef.current) {
      console.error('Speech recognition not initialized.');
      // Optionally, alert the user or disable the button if not supported.
      return;
    }

    if (isVoiceInputActive) {
      recognitionRef.current.stop();
      // isVoiceInputActive will be set to false by the onend handler
    } else {
      // When starting, preserve existing input and append to it
      finalTranscriptRef.current = inputValue; 
      recognitionRef.current.start();
      setIsVoiceInputActive(true);
    }
  };

  // --- Reusable Function to Fetch AI Response ---
  // MODIFIED: Added explicit return type annotation and structural fixes
  const fetchAiResponse = async (
    currentHistory: ChatMessage[],
    currentSystemPrompt: string | null | undefined,
    currentModel: Model,
    taskArg?: 'image' | 'refine_image_prompt', // RENAMED: Changed 'task' to 'taskArg' to avoid conflicts
    // <<< MODIFIED: Add xenoContext parameter >>>
    xenoContext?: { summary?: string; sources?: XenoSource[] },
    // <<< NEW: Add direct xenoSearchInfo parameter >>>
    xenoSearchInfo?: ChatMessage['searchInfo']
  ): Promise<ChatMessage | { refinedPromptText: string; modelIdUsed: string } | { imageData: string; modelIdUsed: string } | undefined> => {

    // *** DIAGNOSTIC LOGGING: Track task parameter value ***
    console.log(`>>> [FETCHAIRESPONSE ENTRY] Received taskArg:`, taskArg);
    
    if (isLoading && taskArg !== 'refine_image_prompt') {
      // console.log('[fetchAiResponse] Already loading, returning early for taskArg:', taskArg);
      return undefined; // Explicit return
    }

    if (taskArg !== 'image') {
    setIsLoading(true);
    }

    setShowThinkingId(null); 
    setThinkingPlaceholderId(null); 
    thinkingStartTimeRef.current = null; 
    isCreatingConversationRef.current = false; // Reset guard before potential creation
    isUpdatingConversationRef.current = false; // Reset update guard too
    
    const localPlaceholderId = `placeholder-${Date.now()}`;
    let placeholderMessageToAdd: ChatMessage | null = null;
    // --- Declare variables needed later within try block ---
    let updatedMessage: ChatMessage;
    let fullTextResponse: string = '';

    // --- Determine base model ID and initial search logic ---
    const baseModelId = currentModel.id;
    const isGpt4oAndSearchActive = baseModelId === "openai/gpt-4o-2024-11-20" && isSearchToggled;

    if (isSearchToggled && baseModelId === "openai/gpt-4o-2024-11-20") {
        console.log(`[API Prep] GPT-4o selected with search. Will determine final model ID after reasoning state calculation.`);
    }

    // --- Refactored Capability Check (using dynamic helper) ---
    const modelId = currentModel.id;
    const reasoningCapability = modelHasReasoningCapability(modelId);

    const effectiveReasoningState =
        reasoningCapability === 'alwaysOn' ? true :
        reasoningCapability === 'disabled' ? false :
        isReasonToggled;

    // --- Determine actual model ID to use for the API ---
    // Only specific models use the :thinking suffix; others use API parameters for reasoning
    let actualModelIdForApi = baseModelId;
    if (taskArg !== 'image' && isGpt4oAndSearchActive) {
        actualModelIdForApi = "openai/gpt-4o-search-preview";
    } else if (taskArg !== 'image' && effectiveReasoningState && modelsWithThinkingSuffix[baseModelId]) {
        // Only these specific models use :thinking suffix
        actualModelIdForApi = modelsWithThinkingSuffix[baseModelId];
    }
    // For other toggleable models (Claude 4.x, Grok, etc.), reasoning is controlled via API params
    // The effectiveReasoningState will be passed in the payload

    // --- Determine Placeholder & API Flags based on Capability --- 
    const isGpt41 = currentModel.id === 'gpt-4.1';
    const is20Flash = currentModel.id === 'google/gemini-2.0-flash-001';
    
    // Helper function to check if a model is excluded from reasoning processing
    const isModelExcludedFromReasoning = (modelId: string): boolean => {
        const modelsToExcludeMarkers = [
            'anthropic/claude-3.5-sonnet:beta'
        ];
        return modelsToExcludeMarkers.some(excludedModel => modelId.includes(excludedModel));
    };
    
    const isGeminiSearchActive = is20Flash && isSearchToggled;
    const isGpt41SearchActive = isGpt41 && isSearchToggled; 
    const isAnySearchActive = (taskArg !== 'image') && (isGeminiSearchActive || isGpt41SearchActive || isGpt4oAndSearchActive);
        
    // Only show thinking placeholder if reasoning is enabled AND the model is not excluded
    const shouldTriggerThinkingPlaceholder = (taskArg !== 'image') && effectiveReasoningState && !isModelExcludedFromReasoning(currentModel.id);
    const isSpecialStateActive = (taskArg !== 'image') && (shouldTriggerThinkingPlaceholder || isAnySearchActive);
        
    // console.log(`[API Prep] Model: ${modelId}, Capability: ${reasoningCapability}, ToggleState: ${isReasonToggled}`);
    // MODIFIED LOG
    // console.log(`[API CALL] effectiveReasoningState for this call:`, effectiveReasoningState); 
    // console.log(`           -> shouldTriggerThinkingPlaceholder: ${shouldTriggerThinkingPlaceholder}, isAnySearchActive: ${isAnySearchActive}`);
        
    // console.log(`[API Prep] Model: ${modelId}, Capability: ${reasoningCapability}, ToggleState: ${isReasonToggled}`);
    // console.log(`           -> effectiveReasoningState for this call: ${effectiveReasoningState}`); 
    // console.log(`           -> shouldTriggerThinkingPlaceholder: ${shouldTriggerThinkingPlaceholder}, isAnySearchActive: ${isAnySearchActive}`);
    
    // --- Create Placeholder ---
    if (isSpecialStateActive) { 
        thinkingStartTimeRef.current = Date.now(); 
        setLiveTimerValue(0); 
        const placeholderText = isAnySearchActive ? "Searching" : "Thinking"; 
        placeholderMessageToAdd = {
            id: localPlaceholderId,
            sender: 'ai',
            text: placeholderText, 
            isThinkingPlaceholder: true,
            isDotPlaceholder: false, 
        };
        setThinkingPlaceholderId(localPlaceholderId); 
    } else {
        placeholderMessageToAdd = {
            id: localPlaceholderId,
            sender: 'ai',
            text: '',
            isThinkingPlaceholder: false,
            isDotPlaceholder: true, 
        };
    }
    // Only add a new placeholder message if the taskArg is NOT 'image'
    // (as generateImage handles its own UI updates for the image message)
    // AND if it's not a refine_image_prompt task, because handleGenerate creates
    // a specific placeholder for that step ("Okay, let me figure out...").
    if (taskArg !== 'image' && taskArg !== 'refine_image_prompt') {
    setMessages(prev => [...prev, placeholderMessageToAdd!]);
    }

    // --- Construct API messages with new structure ---
    const apiMessagesPromises = currentHistory
        .filter(msg => !msg.isThinkingPlaceholder) 
        .map(async msg => {
            type ApiMessagePart =
              | { type: 'text'; text: string }
              | { type: 'image'; media_type: string; data: string } // Base64 data
              | { type: 'file'; media_type: string; name: string; data_type: 'text' | 'base64'; data: string };

            const messagePayload: { role: string; parts: ApiMessagePart[] } = {
            role: msg.sender === 'user' ? 'user' : 'model',
                parts: []
            };

            const textContent = msg.sender === 'user' ? msg.text : (msg.parsedAnswer || msg.text);
            if (textContent && textContent.trim() !== '') {
                messagePayload.parts.push({ type: 'text', text: textContent });
            }

            // Add user image attachment if present
            if (msg.sender === 'user' && msg.userImageAttachment && msg.userImageAttachment.file) {
                try {
                    const base64Image = await fileToBase64(msg.userImageAttachment.file);
                    const base64Data = base64Image.split(',')[1];
                    messagePayload.parts.push({
                        type: 'image',
                        media_type: msg.userImageAttachment.type,
                        data: base64Data
                    });
                } catch (error) {
                    console.error("Error converting user image to base64 for API payload:", error);
                    messagePayload.parts.push({ type: 'text', text: `[Error processing image: ${msg.userImageAttachment.name}]` });
                }
            }
            
            // Add user file attachment if present (separate condition to allow both image and file)
            if (msg.sender === 'user' && msg.userFileAttachment && msg.userFileAttachment.file) {
                const file = msg.userFileAttachment.file;
                const isCommonTextType = file.type.startsWith('text/') ||
                                     [ '.md', '.json', '.csv', '.xml', '.html', '.css', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.cs', '.php', '.rb', '.go', '.swift', '.kt', '.rs', '.toml', '.yaml', '.yml'].some(ext => file.name.toLowerCase().endsWith(ext));

                if (isCommonTextType) {
                    try {
                        const textContent = await file.text();
                        messagePayload.parts.push({
                            type: 'file',
                            media_type: file.type || 'application/octet-stream',
                            name: file.name,
                            data_type: 'text',
                            data: textContent
                        });
                    } catch (error) {
                        console.error(`Error reading text file ${file.name}:`, error);
                        messagePayload.parts.push({ type: 'text', text: `[Error processing file: ${file.name}]` });
                    }
                } else {
                    try {
                        const base64File = await fileToBase64(file);
                        const base64Data = base64File.split(',')[1];
                        messagePayload.parts.push({
                            type: 'file',
                            media_type: file.type || 'application/octet-stream',
                            name: file.name,
                            data_type: 'base64',
                            data: base64Data
                        });
                    } catch (error) {
                        console.error(`Error converting file ${file.name} to base64:`, error);
                        messagePayload.parts.push({ type: 'text', text: `[Error processing file: ${file.name}]` });
                    }
                }
            }

            // NEW: Add AI-generated image if present in an AI message
            if (msg.sender === 'ai' && msg.imageData) {
                // console.log(`[API Prep] Adding AI-generated image to payload for AI message ID ${msg.id}`);
                messagePayload.parts.push({
                    type: 'image',
                    media_type: 'image/png',
                    data: msg.imageData
                });
            }

            if (msg.sender === 'user' && messagePayload.parts.length === 0) {
                messagePayload.parts.push({ type: 'text', text: '[User message content not available]' });
            }

            return messagePayload;
        });

    const resolvedApiMessages = await Promise.all(apiMessagesPromises);
        
    // --- Updated Payload Construction --- 
    // If xenoContext is provided, use it to modify systemPrompt
    let finalSystemPrompt = savedSystemPrompt;
    if (xenoContext?.summary) {
        finalSystemPrompt = xenoContext.summary;
        console.log('[API Prep] Using Xeno Search augmented prompt:', finalSystemPrompt.substring(0, 150) + '...');
    }

    // *** DIAGNOSTIC LOGGING: Track task value before payload construction ***
    console.log(`>>> [FETCHAIRESPONSE INTERNAL] taskArg value being used for payload:`, taskArg);
    
    const payload = {
        messages: resolvedApiMessages,
        systemPrompt: finalSystemPrompt || undefined,
        selectedModelId: actualModelIdForApi,
        effectiveReasoningState: effectiveReasoningState,
        useSearchTool: undefined as (boolean | undefined),
        task: taskArg // Ensure taskArg is used here
    };

    // Create a log-safe version of the payload
    const payloadForLogging = JSON.parse(JSON.stringify(payload));
    if (payloadForLogging.messages && Array.isArray(payloadForLogging.messages)) {
        payloadForLogging.messages.forEach((msg: any) => {
            if (msg.parts && Array.isArray(msg.parts)) {
                msg.parts.forEach((part: any) => {
                    if (part.type === 'image' && part.data && typeof part.data === 'string') {
                        part.data = part.data.substring(0, 50) + '... [truncated for logging]';
                    }
                    // Also check for file parts that might have base64 data if that becomes an issue
                    if (part.type === 'file' && part.data_type === 'base64' && part.data && typeof part.data === 'string') {
                         part.data = part.data.substring(0, 50) + '... [base64 file truncated for logging]';
                    }
                    // Truncate AI text content in payload for logging
                    if (part.type === 'text' && part.text && typeof part.text === 'string' && part.text.length > 50) {
                        part.text = part.text.substring(0, 50) + '... [AI text truncated for logging]';
                    }
                });
            }
        });
    }
    console.log('[ChatWithLLM] Sending payload to /api/chat/generate (images/files truncated):', JSON.stringify(payloadForLogging));

    const modelsSupportingSearch = [
        'google/gemini-2.5-flash-preview-05-20',
        'google/gemini-2.5-pro-preview',
        'openai/gpt-4.1',
        'openai/gpt-4o-2024-11-20',
    ];
    if (isSearchToggled && modelsSupportingSearch.includes(selectedModel.id)) {
        payload.useSearchTool = true;
    }
    // --- End Updated Payload Construction --- 

    const controller = new AbortController();
    setAbortController(controller);

    try {
        const reasoningStateForThisCall = effectiveReasoningState;

        const response = await fetch('/api/chat/generate', {
            method: 'POST',
            headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload),
            signal: controller.signal, // Pass the signal to fetch
        });

        if (!response.ok) {
            const errorText = await response.text(); 
            let errorData = {};
            try {
                errorData = JSON.parse(errorText); 
            } catch (parseError) {
                errorData = { error: `API request failed with status ${response.status}. Non-JSON response: ${errorText}` };
            }
            const errorMessageText = (errorData as any).error || `API request failed with status ${response.status}`;
            throw new Error(errorMessageText);
        }

        const data = await response.json();

        // --- NEW: Handle Refined Prompt Response Directly ---
        if (taskArg === 'refine_image_prompt' && data && typeof data.refinedPromptText === 'string') {
            console.log(`[fetchAiResponse] Received refined prompt directly from backend (truncated): "${data.refinedPromptText.substring(0, 50)}${data.refinedPromptText.length > 50 ? '... [refined prompt truncated for logging]' : ''}"`);
            return { 
                refinedPromptText: data.refinedPromptText,
                modelIdUsed: data.modelIdUsed || actualModelIdForApi 
            };
        }
        // --- END NEW: Handle Refined Prompt Response Directly ---

        // --- NEW: Handle Image Generation Response Directly ---
        if (taskArg === 'image' && data && typeof data.imageData === 'string') {
            // console.log(`[fetchAiResponse] Received image data directly from backend.`);
            return { 
                imageData: data.imageData,
                modelIdUsed: data.modelIdUsed || 'gpt-image-1' // Default to gpt-image-1 if not specified
            };
        }
        // --- END NEW: Handle Image Generation Response Directly ---

        // Assign raw text response if available (for standard chat flow)
        fullTextResponse = data.text || '';

        let duration = 0;
        if (thinkingStartTimeRef.current) {
            duration = Math.round((Date.now() - thinkingStartTimeRef.current) / 1000);
            thinkingStartTimeRef.current = null; 
        }

        // --- NEW: Handle Refined Prompt Response (early return) ---
        if (isWaitingForRefinedPromptForMessageId) {
            const refinedPromptMessageId = isWaitingForRefinedPromptForMessageId;
            setIsWaitingForRefinedPromptForMessageId(null); // Reset state first

            let refinedPromptText = '';
            // Extract the refined prompt text (assuming it's in data.text or data.answer)
            if (reasoningStateForThisCall && data.answer !== undefined) {
                refinedPromptText = data.answer || '';
            } else if (data.text) {
                refinedPromptText = data.text;
            } else {
                console.error("LLM failed to return a refined prompt. Response data:", data);
                setMessages(prevMessages =>
                    prevMessages.map(msg =>
                        msg.id === refinedPromptMessageId
                        ? { ...msg, text: "Error: Could not get a description for the image.", isError: true, isThinkingPlaceholder: false, isGeneratingImage: false }
                        : msg
                    )
                );
                return; // Exit early
            }

            refinedPromptText = cleanText(refinedPromptText.trim()) || "A generic artistic image";
            console.log(`Received refined prompt from LLM (truncated): "${refinedPromptText.substring(0, 50)}${refinedPromptText.length > 50 ? '... [refined prompt truncated for logging]' : ''}"`);

            // Update the placeholder message
            setMessages(prevMessages =>
                prevMessages.map(msg =>
                    msg.id === refinedPromptMessageId
                    ? {
                        ...msg,
                        text: `Generating image with prompt: "${refinedPromptText}"`,
                        isThinkingPlaceholder: false,
                        isGeneratingImage: true,
                        imageData: undefined,
                        isError: false
                      }
                    : msg
                )
            );

            // Call the actual image generation service
            await generateImage(refinedPromptText, refinedPromptMessageId, selectedModel.id);
            return; // IMPORTANT: Exit after handling refined prompt
        }
        // --- END NEW: Handle Refined Prompt Response ---

        // --- Process regular AI response ---
        let thinking: string | null = null;
        let answer: string = '';
        let localHasThinking: boolean = false; 
        let rawTextForState: string = '';

        // --- Response Processing ---
        if (data.reasoningProcessed) { // Use backend's decision about reasoning processing
            if (data.thinking && data.answer) {
                // Qwen/Deepseek R1-style response with separate thinking and answer fields
                thinking = data.thinking;
                answer = data.answer;
                localHasThinking = !!thinking;
                rawTextForState = localHasThinking ? `Thinking Process:\n${thinking}\n\nFinal Answer:\n${answer}` : answer;
            } else if (data.text) {
                 const parseResult = parseResponse(data.text, true); // Pass true since reasoning is expected
                // MODIFIED LOG
                // console.log(`[FRONTEND PARSING] parseResponse output:`, parseResult);
                // console.log(`[Debug] Frontend parseResponse result for ${selectedModel.id} (Reasoning ON):`, parseResult);
                thinking = parseResult.thinking;
                answer = parseResult.answer;
                localHasThinking = parseResult.hasThinking;
                rawTextForState = data.text;
            } else {
                // This case should ideally not be hit if task === 'refine_image_prompt' was handled above.
                // If it's a regular chat and reasoningProcessed is true but no text/thinking/answer, it's an error.
                console.error("[Error] Invalid response format from server when reasoning was processed but no content provided.");
                throw new Error("Invalid response format from server when reasoning was expected (and not refine task)."); 
            }
        } else { // data.reasoningProcessed is FALSE
            // console.log(`[Debug] Frontend handling response with reasoningProcessed: FALSE`);
            // If task was 'refine_image_prompt', it should have been handled above and returned.
            // This block is for regular chat messages when reasoning is off.
            if (data.text !== undefined) { // Check if data.text is defined (can be an empty string)
                // console.log(`[Debug] Using raw text directly as answer since reasoning was FALSE.`);
                let rawAnswer = data.text; 
                const parseResult = parseResponse(rawAnswer, false); // Pass false since reasoning is not expected
                answer = parseResult.answer;
                // console.log(`[Debug] Cleaned answer (Reasoning OFF):`, answer);
                thinking = null;
                localHasThinking = false;
                rawTextForState = rawAnswer;
            } else {
                 console.error("[Error] Invalid response format from server when reasoning was FALSE (expected text field).");
                 throw new Error("Invalid response format from server."); 
            }
        }

        // --- Highlighting logic ---
        let finalAnswer = answer;
        let markerMap = new Map<number, number[]>();
        let sourcesUsed: { index: number; uri: string; title: string }[] = [];
        
        // ---- START MODIFICATION: Determine finalSearchInfo ----
        let finalSearchInfoToUse: ChatMessage['searchInfo'] = data.searchInfo || null;

        // PRIORITY 1: Use directly passed xenoSearchInfo (fixes state timing issue)
        if (xenoSearchInfo) {
            finalSearchInfoToUse = xenoSearchInfo;
            setPendingXenoSearchInfo(null); // Clear state since we're using direct parameter
        }
        // PRIORITY 2: Use pending state info (fallback for backwards compatibility)
        else if (xenoContext && pendingXenoSearchInfo) {
            finalSearchInfoToUse = pendingXenoSearchInfo;
            setPendingXenoSearchInfo(null); // Clear after use
        } else if (pendingXenoSearchInfo) {
            // Fallback: if pending info exists but xenoContext wasn't passed (should be rare)
            finalSearchInfoToUse = pendingXenoSearchInfo;
            setPendingXenoSearchInfo(null);
        }
        // ---- END MODIFICATION ----
        
        if (finalSearchInfoToUse?.sources && finalSearchInfoToUse.sources.length > 0) {
            const highlightResult = highlightTextWithSources(answer, finalSearchInfoToUse);
            finalAnswer = highlightResult.processedHtml;
            markerMap = highlightResult.markerToSourceIndices;
            sourcesUsed = highlightResult.uniqueSourcesUsed;

            // Fetch metadata for ALL sources (not just cited ones) so favicons show in Web Sources
            const allSourcesWithUrls = finalSearchInfoToUse.sources.map(source => ({
                originalUri: source.uri,
                actualUrl: source.uri ? extractActualUrl(source.uri) : ''
            }));
            const sourcesToFetch = allSourcesWithUrls.filter(sourceInfo => sourceInfo.actualUrl && !sourceMetadataCache[sourceInfo.actualUrl]);
            if (sourcesToFetch.length > 0) {
                const fetchPromises = sourcesToFetch.map(async (sourceInfo) => {
                   try {
                     const metadata = await fetchSourceMetadataInternal(sourceInfo.actualUrl);
                     return { uri: sourceInfo.actualUrl, metadata };
                   } catch (error) {
                     console.error(`Error pre-fetching metadata for ${sourceInfo.actualUrl} (from ${sourceInfo.originalUri}):`, error);
                     return { uri: sourceInfo.actualUrl, metadata: { error: true } };
                   }
                 });
                 Promise.all(fetchPromises).then((results) => {
                   const newCacheEntries = results.reduce((acc, { uri, metadata }) => {
                     if (uri) { acc[uri] = metadata; }
                     return acc;
                   }, {} as Record<string, any>);
                   setSourceMetadataCache(prevCache => ({ ...prevCache, ...newCacheEntries }));
                 });
            }
        }

        // --- Force thinking display for specific models when reasoning was active ---
        // For certain models, we want the "Thoughts" UI section to appear even if parseResponse 
        // didn't find explicit markers, allowing the UI to show appropriate fallback messages
        if (reasoningStateForThisCall && // If reasoning was active for this API call
            !localHasThinking &&         // AND parseResponse found no "Thinking Process:" marker
            shouldForceThinkingDisplay(data.modelIdUsed || actualModelIdForApi) // AND it's a reasoning-capable model
        ) {
            // For these models, conceptually, thinking did occur (a reasoning model was used).
            // Override localHasThinking to true so the UI "Thoughts" section renders
            // and can display its specific fallback message.
            localHasThinking = true;
            console.log(`[fetchAiResponse] Forcing thinking display for model ${data.modelIdUsed || actualModelIdForApi} - reasoning was active but no markers found`);
            // `thinking` (and thus `thinkingContent`) will remain null, triggering the fallback in the UI.
        }

        // --- Construct final AI message object ---
        // console.log("[TokenCountDebug] Text for answerTokenCount (finalAnswer):", finalAnswer);
        // console.log("[TokenCountDebug] Raw text from AI (rawTextForState):", rawTextForState);
        // if (thinking) {
            // console.log("[TokenCountDebug] Parsed thinking content:", thinking);
        // }

        updatedMessage = { // Assign to the variable declared earlier
                id: `ai-${Date.now()}`,
                sender: 'ai',
            text: rawTextForState,
            timestamp: Date.now(),
            parsedAnswer: finalAnswer,
            parsedThinking: thinking,
            hasThinking: localHasThinking,
                thinkingDuration: shouldTriggerThinkingPlaceholder ? duration : undefined,
            modelIdUsed: data.modelIdUsed || actualModelIdForApi,
            searchInfo: finalSearchInfoToUse, // Use the determined search info
            markerToSourceIndices: markerMap,
            uniqueSourcesUsed: sourcesUsed,
            thinkingContent: thinking ?? undefined,
            imageData: data.imageData || undefined, // Handle potential image data from API
            isGeneratingImage: taskArg === 'image' ? false : undefined, // Set generating flag based on task
            answerTokenCount: estimateTokens(finalAnswer || ''), // NEW: Store token count
            isXenoDeepSearchContainer: false, // New flag to identify deep search containers
            isLoading: false, // FIX: Explicitly set loading to false when response is complete
        };

        // --- Track usage in database ---
        if (data.usage && userDataService.isAuthenticated()) {
            const modelId = data.modelIdUsed || actualModelIdForApi;
            const provider = modelId.split('/')[0] || 'unknown';
            userDataService.trackUsage({
                model_id: modelId,
                provider: provider,
                prompt_tokens: data.usage.prompt_tokens || 0,
                completion_tokens: data.usage.completion_tokens || 0,
            }).catch(error => {
                console.error("Error tracking usage:", error);
            });
        }

        // Reset expanded thoughts if the *final* response doesn't have thinking content
        if (!updatedMessage.hasThinking) {
            setShowThinkingId(null);
        }
            
        // --- Update Messages State and History ---
        // First, update the messages state
        setMessages(prevMessages => {
            const newMessages = [...prevMessages.filter(msg => msg.id !== localPlaceholderId), updatedMessage];
            return newMessages;
        });

        // Then, update the conversation history separately to prevent double updates
        const now = Date.now();
        // Use currentHistory (the parameter) instead of messages (stale state)
        if (activeConversationId) {
            if (!isUpdatingConversationRef.current) {
                isUpdatingConversationRef.current = true;
                const updatedMessages = [...currentHistory.filter(msg => msg.id !== localPlaceholderId), updatedMessage];

                // Update local state
                setConversationHistory(prevHistory =>
                    prevHistory.map(convo =>
                        convo.id === activeConversationId
                            ? {
                                ...convo,
                                messages: updatedMessages,
                                timestamp: now,
                                systemPrompt: savedSystemPrompt || undefined
                              }
                            : convo
                    )
                );

                // If authenticated, also add the new message to database
                if (isDbAuthenticated) {
                    // Add the AI response message to the database
                    // Save parsedAnswer (the displayed content) as content, not raw text
                    chatService.addMessage(activeConversationId, {
                        role: 'assistant',
                        content: updatedMessage.parsedAnswer || updatedMessage.text,
                        model_id: updatedMessage.modelIdUsed || updatedMessage.modelId,
                        thinking: updatedMessage.thinkingContent,
                        has_thinking: !!updatedMessage.thinkingContent,
                    }).catch(error => {
                        console.error("Error adding message to database:", error);
                    });
                }

                // console.log("Updated conversation in history:", activeConversationId);
                // Reset guard after state update
                setTimeout(() => {
                    isUpdatingConversationRef.current = false;
                }, 100);
            }
        } else {
            // Use currentHistory (the parameter) instead of messages (stale state)
            if (currentHistory.length >= 1 && !isCreatingConversationRef.current) {
                isCreatingConversationRef.current = true;
                const firstUserMessage = currentHistory.find(m => m.sender === 'user');
                const title = firstUserMessage?.text.substring(0, 40) || "Untitled Chat";
                const conversationMessages = [...currentHistory.filter(msg => msg.id !== localPlaceholderId), updatedMessage];

                if (isDbAuthenticated) {
                    // Create in database - use shared interface ID so all interfaces share history
                    try {
                        const dbConversation = await chatService.createConversation({
                            title,
                            model_id: selectedModel.id,
                            system_prompt: savedSystemPrompt || undefined,
                            interface_id: sharedInterfaceId,
                        });

                        if (dbConversation) {
                            // Add messages to the conversation
                            // For AI messages, save parsedAnswer (displayed content) instead of raw text
                            const messagesToSync = conversationMessages.map(msg => ({
                                role: msg.sender === 'ai' ? 'assistant' as const : 'user' as const,
                                content: msg.sender === 'ai' ? (msg.parsedAnswer || msg.text) : msg.text,
                                model_id: msg.modelIdUsed || msg.modelId,
                                thinking: msg.thinkingContent,
                                has_thinking: !!msg.thinkingContent,
                            }));
                            await chatService.addMessagesBatch(dbConversation.id, messagesToSync);

                            const newConversation: Conversation = {
                                id: dbConversation.id,
                                title: title,
                                timestamp: now,
                                messages: conversationMessages,
                                systemPrompt: savedSystemPrompt || undefined
                            };

                            setConversationHistory(prevHistory => [newConversation, ...prevHistory]);
                            setActiveConversationId(dbConversation.id);
                            console.log("Created new conversation in database:", dbConversation.id);
                        }
                    } catch (error) {
                        console.error("Error creating conversation in database:", error);
                        // Fallback to local-only
                        const newConvoId = `convo-${now}`;
                        const newConversation: Conversation = {
                            id: newConvoId,
                            title: title,
                            timestamp: now,
                            messages: conversationMessages,
                            systemPrompt: savedSystemPrompt || undefined
                        };
                        setConversationHistory(prevHistory => [newConversation, ...prevHistory]);
                        setActiveConversationId(newConvoId);
                    }
                } else {
                    // Not authenticated, use local storage
                    const newConvoId = `convo-${now}`;
                    const newConversation: Conversation = {
                        id: newConvoId,
                        title: title,
                        timestamp: now,
                        messages: conversationMessages,
                        systemPrompt: savedSystemPrompt || undefined
                    };

                    setConversationHistory(prevHistory => [newConversation, ...prevHistory]);
                    setActiveConversationId(newConvoId);
                    // console.log("Created new conversation in history:", newConvoId);
                }
                // Reset guard
                setTimeout(() => {
                    isCreatingConversationRef.current = false;
                }, 100);
            }
        }

        setThinkingPlaceholderId(null); // Clear placeholder ID state

        // === START MOVED BLOCK ===
        // This logic now runs *within* the try block, before the catch

        // Return refined prompt data if that was the task
        if (taskArg === 'refine_image_prompt') {
          // This path is already handled earlier with an explicit return,
          // but adding it defensively here. Ensure the earlier return remains.
          // If this path is reached, it means the earlier return didn't happen.
          console.warn("[fetchAiResponse] Reached unexpected point for refine_image_prompt task.");
          const { answer: refinedPromptText } = parseResponse(fullTextResponse, false); // Parse the raw text, reasoning not expected for refine task
          return { refinedPromptText, modelIdUsed: actualModelIdForApi };
        }

        // Return the fully constructed/updated AI message object for other tasks
        return updatedMessage;

        // === END MOVED BLOCK ===


    } catch (error: any) {
        console.error('Error details in fetchAiResponse catch block:', error);
        setPendingXenoSearchInfo(null); // Clear on error
        if (error.name === 'AbortError') {
            console.log('Fetch aborted by user.');
            setMessages(prevMessages => prevMessages.map(msg => 
                msg.id === localPlaceholderId 
                ? { ...msg, text: '[Request Cancelled by user]', isError: false, isThinkingPlaceholder: false, isDotPlaceholder: false, isCancelled: true } 
                : msg
            ));
        } else {
            let duration = 0;
            if (thinkingStartTimeRef.current) {
                duration = Math.round((Date.now() - thinkingStartTimeRef.current) / 1000);
                thinkingStartTimeRef.current = null;
            }
            const wasSpecialPlaceholder = messages.find(msg => msg.id === localPlaceholderId)?.isThinkingPlaceholder ?? false;
            const errorMessage: ChatMessage = {
                id: `error-${Date.now()}`,
                sender: 'ai',
                text: `Error: ${error.message || 'Could not get response.'}`, 
                isError: true,
                hasThinking: false,
                thinkingDuration: wasSpecialPlaceholder ? duration : undefined, 
                modelIdUsed: wasSpecialPlaceholder ? selectedModel.id : undefined,
            };
            
            setMessages(prev => {
                const filtered = prev.filter(msg => msg.id !== localPlaceholderId);
                return [...filtered, errorMessage];
            });
        }
        setThinkingPlaceholderId(null);
        return undefined; // Return undefined on error

    } finally {
        // Ensure loading state is reset regardless of success or error
        if (taskArg !== 'refine_image_prompt') {
        setIsLoading(false); 
    }
        // Reset guards potentially here as well, though resetting at the start of the function might be safer
        isCreatingConversationRef.current = false;
        isUpdatingConversationRef.current = false;
        setAbortController(null); // Reset abort controller
    }

    // This point should ideally not be reached if try/catch handles returns,
    // but adding a fallback return.
    return undefined;
  };
  // --- End Reusable Function ---

  const handleStopGeneration = () => {
    if (abortController) {
      abortController.abort();
      console.log("User initiated stop generation.");
      
      // Check if there's a search results message that should be removed
      setMessages(prev => {
        // Find the last search results message (with searchInfo and isLoading false)
        let searchResultsIndex = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          const msg = prev[i];
          if (msg.sender === 'ai' && 
              msg.searchInfo && 
              !msg.isLoading && 
              !msg.parsedAnswer && 
              !msg.text) {
            searchResultsIndex = i;
            break;
          }
        }
        
        if (searchResultsIndex !== -1) {
          // Remove the search results message
          console.log("Removing search results message due to stop generation");
          return prev.filter((_, index) => index !== searchResultsIndex);
        }
        
        return prev;
      });
    }
  };

  // Queue system functions
  const addToQueue = () => {
    if (!inputValue.trim() && attachedFiles.length === 0) return;
    
    const queuedMessage: QueuedMessage = {
      id: `queue-${Date.now()}-${Math.random()}`,
      text: inputValue,
      attachedFiles: [...attachedFiles],
      timestamp: Date.now()
    };
    
    setQueue(prev => ({
      ...prev,
      messages: [...prev.messages, queuedMessage]
    }));
    
    // Clear input after adding to queue
    setInputValue('');
    setAttachedFiles([]);
  };

  const removeFromQueue = (messageId: string) => {
    setQueue(prev => ({
      ...prev,
      messages: prev.messages.filter(msg => msg.id !== messageId)
    }));
  };

  const toggleQueueExpansion = () => {
    setQueue(prev => ({
      ...prev,
      isExpanded: !prev.isExpanded
    }));
  };

  const processQueue = async () => {
    if (queue.messages.length === 0 || isLoading) return;
    
    const nextMessage = queue.messages[0];
    
    // Set the input values from the queued message
    setInputValue(nextMessage.text);
    setAttachedFiles(nextMessage.attachedFiles);
    
    // Remove from queue
    removeFromQueue(nextMessage.id);
    
    // Trigger generation
    await handleGenerate();
  };

  // Effect to process queue when generation finishes
  useEffect(() => {
    if (!isLoading && queue.messages.length > 0) {
      processQueue();
    }
  }, [isLoading, queue.messages.length]);

  // Function to generate image using the main chat API endpoint
  const generateImage = async (prompt: string, messageId: string, imageModelId: string) => {
    console.log(`[ChatWithLLM] generateImage calling /api/chat/generate for message ${messageId} using model ${imageModelId} with prompt: \"${prompt}\"`);

    setMessages(prevMessages =>
      prevMessages.map(msg =>
        msg.id === messageId
          ? {
              ...msg,
              isGeneratingImage: true,
              isThinkingPlaceholder: false,
              text: `Initializing image generation for: \"${prompt}\"`, // Initial placeholder text
              parsedAnswer: undefined,
              imageData: undefined,
              isError: false,
              isCancelled: false // Ensure isCancelled is initially false
            }
          : msg
      )
    );

    const controllerForThisRequest = abortController; // Capture the controller instance

    try {
      const imagePromptMessage: ChatMessage = {
        id: `user-prompt-for-${messageId}`,
        sender: 'user',
        text: prompt,
      };

      const imageModel = findModelById(groupedModels, imageModelId);
      if (!imageModel) {
        throw new Error(`Image model with ID ${imageModelId} not found.`);
      }

      const aiImageResponse = await fetchAiResponse(
        [imagePromptMessage],
        null,
        imageModel,
        'image',
        undefined,
        undefined
      ) as { imageData: string; modelIdUsed: string } | undefined; // Adjusted expected type

      // Check for abort *after* fetchAiResponse has completed or aborted
      if (controllerForThisRequest?.signal.aborted) {
        console.log(`[ChatWithLLM] Image generation for message ${messageId} was aborted by user.`);
        setMessages(prevMessages =>
          prevMessages.map(msg =>
            msg.id === messageId
              ? {
                  ...msg,
                  isGeneratingImage: false,
                  isError: false,
                  text: "Image generation aborted.", // Consistent with other cancelled text
                  imageData: undefined,
                  isCancelled: true,       // Set the flag
                  isThinkingPlaceholder: false, // Ensure placeholders are cleared
                  parsedAnswer: "Image generation aborted."
                }
              : msg
          )
        );
        return; // Exit after handling abort
      }

      if (aiImageResponse?.imageData) {
           // console.log(`[ChatWithLLM] Image data received via fetchAiResponse for message ${messageId}`);
             setMessages(prevMessages =>
                prevMessages.map(msg =>
                msg.id === messageId
                    ? {
                        ...msg,
                        imageData: aiImageResponse.imageData,
                        isGeneratingImage: false,
                        text: msg.text?.includes('Initializing') || msg.text?.includes('Generating image') ? `Image generated for prompt: \"${prompt}\"` : msg.text,
                        parsedAnswer: msg.text?.includes('Initializing') || msg.text?.includes('Generating image') ? `Image generated for prompt: \"${prompt}\"` : msg.parsedAnswer,
                        modelIdUsed: aiImageResponse.modelIdUsed || imageModelId,
                        isCancelled: false
                    }
                    : msg
                )
            );
      } else { // Covers undefined aiImageResponse (not aborted) or if it returned text/error
            const errorTextFromResponse = (aiImageResponse as any)?.text; // Attempt to get text if it was an error object from fetchAiResponse
            const errorMsg = errorTextFromResponse || 'Error generating image: Unexpected response or format.';
            console.error(`[ChatWithLLM] Image generation failed or returned unexpected for message ${messageId}: ${errorMsg}`);
            setMessages(prevMessages =>
                prevMessages.map(msg =>
                msg.id === messageId && !msg.isError 
                    ? { 
                        ...msg, 
                        isError: true, 
                        isGeneratingImage: false, 
                        text: errorMsg,
                        parsedAnswer: errorMsg,
                        isCancelled: false 
                      } 
                    : msg
                )
            );
      }

    } catch (error) {
      console.error(`Error in generateImage flow for message ${messageId}:`, error);
      setMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.id === messageId && !msg.isError
            ? {
                ...msg,
                isError: true,
                isGeneratingImage: false,
                text: `Error generating image: ${error instanceof Error ? error.message : 'Unknown error'}`,
                parsedAnswer: `Error generating image: ${error instanceof Error ? error.message : 'Unknown error'}`,
                isCancelled: false
              }
            : msg
        )
      );
    } finally {
       // isLoading state is handled by fetchAiResponse's finally block for the overall request
       // However, ensure isGeneratingImage specific to this messageId is false if not already handled
       setMessages(prev => prev.map(m => m.id === messageId && m.isGeneratingImage ? {...m, isGeneratingImage: false} : m));
    }
  };

  const handleGenerate = async () => {
    const canSend = inputValue.trim() || attachedFiles.length > 0;
    if (!canSend || isLoading) return;
    if (isContextLimitReached) return;

    // Prepare the new user message
    const userTextToSend = inputValue.trim();
    const filesToSend = [...attachedFiles]; // Capture files before clearing

    // console.log('handleGenerate called with text:', userTextToSend); // Original log, can be kept or removed
    const messageId = `user-${Date.now()}`;

    // --- Prepare newUserMessage with potential image/file attachment ---
    let userImageAttachmentPayload: ChatMessage['userImageAttachment'] = undefined;
    const firstImageFile = filesToSend.find(f => f.fileObject && f.type.startsWith('image/'));
    if (firstImageFile && firstImageFile.fileObject) {
      userImageAttachmentPayload = {
        file: firstImageFile.fileObject,
        name: firstImageFile.name,
        type: firstImageFile.type,
      };
      // console.log('Attaching image to user message:', firstImageFile.name);
    }

    let userFileAttachmentPayload: ChatMessage['userFileAttachment'] = undefined;
    // Allow file attachment regardless of whether there's also an image
      const firstNonImageFile = filesToSend.find(f => f.fileObject && !f.type.startsWith('image/'));
      if (firstNonImageFile && firstNonImageFile.fileObject) {
        userFileAttachmentPayload = {
          file: firstNonImageFile.fileObject,
          name: firstNonImageFile.name,
          type: firstNonImageFile.type,
        };
      console.log('Attaching non-image file to user message:', firstNonImageFile.name);
    }

    const newUserMessage: ChatMessage = {
        id: messageId,
        sender: 'user',
        text: userTextToSend || 'Attached file(s)',
        timestamp: Date.now(),
        userImageAttachment: userImageAttachmentPayload,
        userFileAttachment: userFileAttachmentPayload,
    };
    // --- End user message preparation ---

    setInputValue('');
    setAttachedFiles([]);

    let currentMessageHistory: ChatMessage[] = [...messages, newUserMessage];
    setMessages(currentMessageHistory);

    // Save user message to database if authenticated and there's an active conversation
    if (isDbAuthenticated && activeConversationId) {
      chatService.addMessage(activeConversationId, {
        role: 'user',
        content: newUserMessage.text,
      }).catch(error => {
        console.error("Error adding user message to database:", error);
      });
    }

    // --- Image Generation Intent Detection (Revised Logic with DEBUG logs) ---
    const userTextForProcessing = userTextToSend.toLowerCase().trim();
    // console.log('[INTENT DEBUG] Starting intent detection for:', userTextForProcessing);

    // --- NEW: Add checks to PREVENT image generation for long/code-like inputs ---
    const MAX_LENGTH_FOR_IMAGE_INTENT = 300; // Max characters for a typical image prompt
    const MIN_CODE_INDICATORS_FOR_NO_IMAGE = 8; // Min number of code-like tokens to flag as code
    const CODE_INDICATOR_REGEX = /(import|export|function|class|const|let|var|return|=>|\{|\}|\[|\]|\(|\)|;|:|componentDidMount|useEffect|useState|render|<[a-zA-Z_][\w.:-]*(\s|\/>|>|<\/[a-zA-Z_][\w.:-]*>))/gi;

    let isLikelyCodeOrLongText = false;

    if (userTextToSend.length > MAX_LENGTH_FOR_IMAGE_INTENT) {
        isLikelyCodeOrLongText = true;
        // console.log('[INTENT DEBUG] Input too long for image intent:', userTextToSend.length, 'chars');
    } else {
        const codeIndicators = (userTextToSend.match(CODE_INDICATOR_REGEX) || []).length;
        if (codeIndicators >= MIN_CODE_INDICATORS_FOR_NO_IMAGE) {
            isLikelyCodeOrLongText = true;
            // console.log('[INTENT DEBUG] Input has too many code indicators for image intent:', codeIndicators);
        }
    }
    // --- END NEW CHECKS ---

    const baseImageVerbs = ["generate", "create", "make", "draw", "paint", "sketch"];
    const imageNounVariations = ["image", "an image", "a image", "picture", "a picture", "an picture", "photo", "a photo", "an photo", "drawing", "a drawing", "an drawing", "illustration", "an illustration", "a illustration", "art", "an art", "a art", "pic", "a pic", "an pic", "painting", "a painting", "an painting", "sketch", "a sketch", "an sketch"];
    const prepositionsForSubject = ["of", "about", "with", "depicting", "showing", "featuring", "for"];
    const contextualSubjectKeywords = ["this", "that", "it", "them", "those", "the previous one", "the current topic", "the former", "the latter", "previous", "above"];

    let extractedDirectPrompt: string | null = null;
    let isPotentialImageRefinement: boolean = false;

    // Stage 1: Try to find a direct command with a clear subject.
    verbLoop: for (const verb of baseImageVerbs) {
        for (const noun of imageNounVariations) {
            for (const prep of prepositionsForSubject) {
                const commandPatternStart = `${verb} ${noun} ${prep} `;
                if (userTextForProcessing.startsWith(commandPatternStart)) {
                    // console.log('[INTENT DEBUG] STAGE 1 Candidate commandPatternStart:', commandPatternStart, 'for input:', userTextForProcessing);
                    const potentialSubject = userTextToSend.substring(commandPatternStart.length).trim();
                    if (potentialSubject) {
                        if (contextualSubjectKeywords.includes(potentialSubject.toLowerCase())) {
                            // console.log('[INTENT DEBUG] STAGE 1 MATCH on commandPatternStart with contextual subject:', commandPatternStart);
                            isPotentialImageRefinement = true;
                            // console.log(`[Intent] Path 2 trigger (Stage 1): Direct command with contextual subject: "${userTextForProcessing}"`); // Original log
                            break verbLoop;
                        } else {
                            // console.log('[INTENT DEBUG] STAGE 1 MATCH on commandPatternStart with explicit subject:', commandPatternStart);
                            extractedDirectPrompt = potentialSubject;
                            // console.log(`[Intent] Path 1 trigger (Stage 1): Direct command with explicit subject: "${extractedDirectPrompt}" from input "${userTextForProcessing}"`); // Original log
                            break verbLoop;
                        }
                    }
                }
            }
        }
    }

    // Stage 2: If not a clear direct command from Stage 1, check for commands needing refinement.
    if (!extractedDirectPrompt && !isPotentialImageRefinement) {
        verbLoop2: for (const verb of baseImageVerbs) {
            for (const noun of imageNounVariations) {
                const commandPatternNoPrep = `${verb} ${noun} `;
                if (userTextForProcessing.startsWith(commandPatternNoPrep)) {
                    // console.log('[INTENT DEBUG] STAGE 2 Candidate commandPatternNoPrep:', commandPatternNoPrep, 'for input:', userTextForProcessing);
                    const potentialSubjectNoPrep = userTextToSend.substring(commandPatternNoPrep.length).trim();
                    if (potentialSubjectNoPrep) {
                        // console.log('[INTENT DEBUG] STAGE 2 MATCH on commandPatternNoPrep:', commandPatternNoPrep);
                        isPotentialImageRefinement = true;
                        // console.log(`[Intent] Path 2 trigger (Stage 2): Command followed by likely subject/context (no prep): "${userTextForProcessing}"`); // Original log
                        break verbLoop2;
                    }
                }
                if (userTextForProcessing === `${verb} ${noun}`) {
                    // console.log('[INTENT DEBUG] STAGE 2 Candidate exact verb+noun:', `${verb} ${noun}`, 'for input:', userTextForProcessing);
                    // console.log('[INTENT DEBUG] STAGE 2 MATCH on exact verb+noun:', `${verb} ${noun}`);
                    isPotentialImageRefinement = true;
                    // console.log(`[Intent] Path 2 trigger (Stage 2): Exact verb+noun command: "${userTextForProcessing}"`); // Original log
                    break verbLoop2;
                }
            }
        }
    }

    // Stage 3: Broader check for inclusion of image-related verbs/nouns if nothing specific caught yet.
    // --- MODIFICATION: Only run Stage 3 if input is NOT likely code/long text AND Stages 1 & 2 didn't find anything ---
    if (!isLikelyCodeOrLongText && !extractedDirectPrompt && !isPotentialImageRefinement) {
        const baseNounsForRegex = ["image", "picture", "photo", "drawing", "illustration", "art", "pic", "painting", "sketch"];
        const containsVerbCheck = baseImageVerbs.some(verb => new RegExp(`\\b${verb}\\b`, 'i').test(userTextForProcessing));
        const containsNounCheck = baseNounsForRegex.some(noun => new RegExp(`\\b${noun}\\b`, 'i').test(userTextForProcessing));
        const containsContextualWordCheck = contextualSubjectKeywords.some(csWord => new RegExp(`\\b${csWord.replace(/\s+/g, '\\s+')}\\b`, 'i').test(userTextForProcessing));

        // console.log(`[INTENT DEBUG] STAGE 3 Checks: userText='${userTextForProcessing}', containsVerb=${containsVerbCheck}, containsNoun=${containsNounCheck}, containsContextualWord=${containsContextualWordCheck}`);

        if (containsVerbCheck && containsNounCheck) {
            // console.log('[INTENT DEBUG] STAGE 3 MATCH on containsVerb && containsNoun');
            isPotentialImageRefinement = true;
            // console.log(`[Intent] Path 2 trigger (Stage 3): General inclusion of image verb & noun (whole words): "${userTextForProcessing}"`); // Original log
        } else if ((userTextForProcessing === "draw" || userTextForProcessing === "paint" || userTextForProcessing === "sketch") && !filesToSend.length) {
            // console.log('[INTENT DEBUG] STAGE 3 MATCH on single image verb command (draw/paint/sketch)');
            isPotentialImageRefinement = true;
            // console.log(`[Intent] Path 2 trigger (Stage 3): Single image verb command: "${userTextForProcessing}"`); // Original log
        } else if (containsVerbCheck && containsContextualWordCheck && !containsNounCheck) {
            // console.log('[INTENT DEBUG] STAGE 3 MATCH on containsVerb && containsContextualWord && !containsNoun');
            isPotentialImageRefinement = true;
            // console.log(`[Intent] Path 2 trigger (Stage 3): Verb + Contextual word (whole words, no explicit noun): "${userTextForProcessing}"`); // Original log
        }
    }
    // --- End Image Generation Intent Detection ---

    // console.log('[INTENT DEBUG] Final check: isPotentialImageRefinement =', isPotentialImageRefinement, 'extractedDirectPrompt =', extractedDirectPrompt);
    // console.log('[INTENT DEBUG] isLikelyCodeOrLongText =', isLikelyCodeOrLongText);

    if (extractedDirectPrompt) {
        // console.log('[INTENT DEBUG] Path Taken: Direct Image Command (Path 1)');
        // ... rest of Path 1 logic
        const aiImageMessage: ChatMessage = {
            id: `ai-image-${Date.now()}`,
            sender: 'ai',
            text: `Generating image with prompt: "${extractedDirectPrompt}"`,
            isGeneratingImage: true
        };
        // Add the placeholder for the image being generated to the message history
        currentMessageHistory = [...currentMessageHistory, aiImageMessage];
        setMessages(currentMessageHistory);
        // Call generateImage with the extracted prompt and the ID of the placeholder message
        await generateImage(extractedDirectPrompt, aiImageMessage.id, selectedModel.id);

    } else if (isPotentialImageRefinement && !isLikelyCodeOrLongText) { // MODIFIED: Add !isLikelyCodeOrLongText guard
        // console.log('[INTENT DEBUG] Path Taken: Potential Image Refinement (Path 2)');
        // ... rest of Path 2 logic
        const newAiRefinementPlaceholderId = `ai-refine-${Date.now()}`;
        setAiRefinementPlaceholderId(newAiRefinementPlaceholderId); // Use state setter

        const aiRefinementPlaceholder: ChatMessage = {
            id: newAiRefinementPlaceholderId, // Use the new ID
            sender: 'ai',
            text: 'Okay, let me figure out a good description for the image...', // Base text, ellipsis will be dynamic
            isThinkingPlaceholder: true, // This identifies it for the animation effect
        };
        // Add the refinement placeholder to message history
        currentMessageHistory = [...currentMessageHistory, aiRefinementPlaceholder];
        setMessages(currentMessageHistory);

        // Construct history for the LLM to refine the prompt (history before the placeholder)
        const historyForRefinement = currentMessageHistory.slice(0, -1);

        // console.log("Requesting prompt refinement from LLM with history:", historyForRefinement);
        const refinementResponse = await fetchAiResponse(historyForRefinement, systemPrompt, selectedModel, "refine_image_prompt", undefined, undefined);

        if (refinementResponse && 'refinedPromptText' in refinementResponse && refinementResponse.refinedPromptText) {
            const refinedPrompt = refinementResponse.refinedPromptText;
            // console.log('[ChatWithLLM HandleGenerate] Path 2: Got refined prompt:', refinedPrompt);
            // Call generateImage with the refined prompt, using the placeholder's ID
            await generateImage(refinedPrompt, newAiRefinementPlaceholderId, selectedModel.id);
        } else {
            console.error('[ChatWithLLM HandleGenerate] Path 2: Failed to get refined prompt or invalid response.', refinementResponse);
            setMessages(prev => prev.map(msg =>
                msg.id === newAiRefinementPlaceholderId
                ? { ...msg, text: "Sorry, I couldn't figure out what image to generate. Please try being more specific.", isThinkingPlaceholder: false, isError: true, isGeneratingImage: false }
                : msg
            ));
        }
    } else {
        // console.log('[INTENT DEBUG] Path Taken: Regular Chat Message (Path 3)');
        // ... rest of Path 3 logic (or if it was flagged as code/long text and didn't match Path 1)
        // First clear any previous Xeno Search results
        setXenoSearchResults(null);

        // Check if Xeno Search is enabled AND we have searchable content
        if (isXenoSearchEnabled && (userTextToSend || userImageAttachmentPayload || userFileAttachmentPayload)) {
            // Deep search mode uses WebSocket for real-time progress updates
            if (isXenoDeepMode) {
                // === XENO DEEP MODE IMPLEMENTATION ===
                console.log(`[Xeno Deep] Starting deep analysis for content`);
                setIsXenoSearching(true);

                // Initialize deep search state
                setDeepSearchState({
                    phase: 'initializing',
                    progress: 0,
                    message: 'Initializing deep search...',
                    data: null,
                    isActive: true
                });

                // Generate enhanced search query from multimodal input
                const enhancedQuery = await generateEnhancedSearchQuery(
                    userTextToSend,
                    userImageAttachmentPayload?.file,
                    userFileAttachmentPayload ? {
                        id: 'temp',
                        name: userFileAttachmentPayload?.name || 'unknown',
                        type: userFileAttachmentPayload?.type || 'unknown',
                        fileObject: userFileAttachmentPayload?.file
                    } : undefined
                );

                console.log(`[Xeno Deep] Enhanced query: "${enhancedQuery.query}" (type: deep)`);

                // Generate a unique search ID for WebSocket tracking
                const searchId = `search-${Date.now()}`;
                console.log(`[Xeno Deep] Using search ID: ${searchId}`);

                // Create a deep search progress message
                const deepSearchMessageId = `deep-search-${Date.now()}`;
                const deepSearchMessage: ChatMessage = {
                    id: deepSearchMessageId,
                    sender: 'ai',
                    text: '',
                    searchInfo: {
                        queries: [enhancedQuery.query],
                        sources: [],
                        supports: []
                    },
                    isLoading: true,
                    isXenoDeepSearchContainer: true,
                };

                // Add the deep search message to history
                setMessages(prev => [...prev, deepSearchMessage]);

                try {
                    let finalResults: any = null;

                    // Use xenoSearchService to connect to WebSocket for progress updates
                    const ws = xenoSearchService.connectToProgressWebSocket(searchId, (progressUpdate: WebSocketProgress) => {
                        console.log('[Xeno Deep] Received update:', progressUpdate);

                        if (progressUpdate.type === 'progress') {
                            const { phase, progress, message, sources_found } = progressUpdate.data;

                            // Update deep search state for UI
                            setDeepSearchState({
                                phase,
                                progress,
                                message,
                                data: { sources_found },
                                isActive: phase !== 'completed'
                            });

                            // Update the deep search message with progress
                            setMessages(prev => prev.map(msg =>
                                msg.id === deepSearchMessageId
                                    ? {
                                        ...msg,
                                        text: `🔍 Deep Search Progress: ${Math.round(progress)}% - ${message}`,
                                      }
                                    : msg
                            ));
                        } else if (progressUpdate.type === 'complete') {
                            // Mark completion
                            setDeepSearchState(prev => ({
                                ...prev,
                                phase: 'completed',
                                progress: 100,
                                message: 'Deep search completed',
                                isActive: false
                            }));
                        } else if (progressUpdate.type === 'error') {
                            console.error('[Xeno Deep] Error from WebSocket:', progressUpdate.data.message);
                        }
                    });

                    // Wait for WebSocket to open then start the deep search
                    ws.onopen = async () => {
                        console.log('[Xeno Deep] WebSocket connected, starting deep search...');

                        // Use xenoSearchService for the deep search request
                        try {
                            const xenoData = await xenoSearchService.searchGeneral({
                                query: enhancedQuery.query.trim(),
                                search_type: 'deep',
                                num_results: XENO_SEARCH_CONFIG.defaultNumResults,
                            });

                            console.log('[Xeno Deep] Search completed:', {
                                sources_count: xenoData.sources?.length || 0,
                                has_summary: !!xenoData.summary
                            });

                            finalResults = {
                                total_sources: xenoData.sources?.length || 0,
                                sources: xenoData.sources,
                                comprehensive_summary: xenoData.summary
                            };

                            // Close the WebSocket since we have results
                            ws.close();
                        } catch (searchError) {
                            console.error('[Xeno Deep] Search error:', searchError);
                            ws.close();
                        }
                    };

                    ws.onclose = async () => {
                        console.log('[Xeno Deep] WebSocket closed');
                        setIsXenoSearching(false);
                        setDeepSearchState(prev => ({ ...prev, isActive: false }));

                        if (finalResults && finalResults.sources?.length > 0) {
                            console.log('[Xeno Deep] Final results received:', {
                                total_sources: finalResults.total_sources,
                                sources_count: finalResults.sources?.length || 0,
                                has_summary: !!finalResults.comprehensive_summary
                            });

                            // Transform results for LLM context
                            const formattedSources = finalResults.sources?.map((source: XenoSearchSource, index: number) => {
                                return `SOURCE ${index + 1}: ${source.title || 'Untitled'}
URL: ${source.url}
SUMMARY: ${source.summary || source.snippet || 'No summary available'}
CONTENT PREVIEW:
${source.raw_text ? source.raw_text.substring(0, 1000) : source.snippet || 'No content preview'}
----------
`;
                            }).join('\n') || '';

                            // Create augmented prompt for LLM
                            const augmentedPrompt = `
[XENO DEEP SEARCH RESULTS - COMPREHENSIVE ANALYSIS]

Original Query: "${userTextToSend}"
Enhanced Search Query: "${enhancedQuery.query}"
Search Type: Deep Analysis
Total Sources Analyzed: ${finalResults.total_sources || 0}

${enhancedQuery.context ? `
MULTIMODAL CONTEXT:
${enhancedQuery.context}

` : ''}${finalResults.comprehensive_summary ? `
COMPREHENSIVE SUMMARY:
${finalResults.comprehensive_summary}

` : ''}DETAILED SOURCE ANALYSIS:
${formattedSources}

RESPONSE INSTRUCTIONS:
1. PRIMARY SOURCE: Use the comprehensive deep search results above as your primary information source
2. DEEP ANALYSIS: This is a thorough analysis of ${finalResults.total_sources} sources including linked content
3. COMPREHENSIVE: Address all aspects of the query using the detailed source analysis
4. CITATIONS: Reference sources using [SOURCE 1], [SOURCE 2], etc. format
5. SYNTHESIS: Combine insights from multiple sources to provide comprehensive understanding
6. STRUCTURED: Use clear headings, bullet points, and organized formatting
7. CURRENCY: This information includes recent and deep-linked content
8. AUTHORITATIVE: Prioritize information from the comprehensive summary and detailed sources

USER INPUT: ${userTextToSend || 'See multimodal context above'}

Please provide a comprehensive, well-structured response using this deep search analysis.
[/XENO DEEP SEARCH RESULTS]
`;

                            // Prepare context for LLM
                            const xenoContextForLLM = {
                                summary: augmentedPrompt,
                                sources: finalResults.sources
                            };

                            // Transform search info for display
                            const transformedSearchInfo = {
                                queries: [enhancedQuery.query],
                                sources: finalResults.sources?.map((source: XenoSearchSource) => ({
                                    uri: source.url,
                                    title: source.title || source.url
                                })) || [],
                                supports: []
                            };

                            // Update the search message with final results
                            setMessages(prev => prev.map(msg =>
                                msg.id === deepSearchMessageId
                                    ? {
                                        ...msg,
                                        isLoading: false,
                                        text: `🔍 Deep Search Completed: Analyzed ${finalResults.total_sources} sources`,
                                        searchInfo: transformedSearchInfo
                                      }
                                    : msg
                            ));

                            // Get the latest message history for LLM call
                            const updatedMessageHistory = await new Promise<ChatMessage[]>(resolve => {
                                setMessages(current => { resolve(current); return current; });
                            });

                            // Call LLM with deep search context
                            console.log('[Xeno Deep] Calling AI with context:', {
                                has_xenoContext: !!xenoContextForLLM,
                                context_summary_length: xenoContextForLLM?.summary?.length || 0,
                                context_sources_count: xenoContextForLLM?.sources?.length || 0
                            });
                            await fetchAiResponse(updatedMessageHistory, systemPrompt, selectedModel, undefined, xenoContextForLLM, transformedSearchInfo);
                        } else {
                            // Handle case where no results were received
                            setMessages(prev => prev.map(msg =>
                                msg.id === deepSearchMessageId
                                    ? {
                                        ...msg,
                                        isLoading: false,
                                        isError: true,
                                        text: '🔍 Deep Search failed to complete successfully'
                                      }
                                    : msg
                            ));
                        }
                    };

                    ws.onerror = (error) => {
                        console.error('[Xeno Deep] WebSocket error:', error);
                        setIsXenoSearching(false);
                        setDeepSearchState(prev => ({ ...prev, isActive: false }));

                        setMessages(prev => prev.map(msg =>
                            msg.id === deepSearchMessageId
                                ? {
                                    ...msg,
                                    isLoading: false,
                                    isError: true,
                                    text: '🔍 Deep Search connection failed. Please try again.'
                                  }
                                : msg
                        ));
                    };

                } catch (error) {
                    console.error('[Xeno Deep] Error starting deep search:', error);
                    setIsXenoSearching(false);
                    setDeepSearchState(prev => ({ ...prev, isActive: false }));

                    setMessages(prev => prev.map(msg =>
                        msg.id === deepSearchMessageId
                            ? {
                                ...msg,
                                isLoading: false,
                                isError: true,
                                text: `🔍 Deep Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                              }
                            : msg
                    ));
                }
                return;
            } else {
                // === XENO SEARCH MODE IMPLEMENTATION (EXISTING) ===
                console.log(`[Xeno Search] Starting multimodal search for content`);
                setIsXenoSearching(true);
                const searchStartTime = Date.now();

                // Generate enhanced search query from multimodal input
                const enhancedQuery = await generateEnhancedSearchQuery(
                    userTextToSend,
                    userImageAttachmentPayload?.file,
                    userFileAttachmentPayload ? { 
                        id: 'temp', 
                        name: userFileAttachmentPayload?.name || 'unknown', 
                        type: userFileAttachmentPayload?.type || 'unknown', 
                        fileObject: userFileAttachmentPayload?.file 
                    } : undefined
                );

                console.log(`[Xeno Search] Enhanced query: "${enhancedQuery.query}" (type: ${isXenoDeepMode ? 'deep' : 'normal'}, results: ${XENO_SEARCH_CONFIG.defaultNumResults})`);

                // Create a search results message with loading state
                const searchResultsMessageId = `search-results-${Date.now()}`;
                const searchResultsMessage: ChatMessage = {
                    id: searchResultsMessageId,
                    sender: 'ai',
                    text: '',
                    searchInfo: {
                        queries: [enhancedQuery.query],
                        sources: [],
                        supports: []
                    },
                    isLoading: true, // Add loading flag to show "Searching..." state
                };
                
                // Add the search results message to history
                setMessages(prev => [...prev, searchResultsMessage]);

                // Define variables to hold Xeno context and search info for the LLM
                let xenoContextForLLM: { summary?: string; sources?: XenoSource[] } | undefined = undefined;
                let transformedSearchInfo: ChatMessage['searchInfo'] | undefined = undefined;

                try {
                    // Reset search progress
                    const providerName = searchProvider === 'google' ? 'Google' : 'Brave';
                    setSearchProgress({ message: `Searching with ${providerName}...`, progress: 0 });

                    // Use the multi-provider search helper
                    const searchResult = await performProviderSearch(
                        enhancedQuery.query.trim(),
                        searchProvider,
                        Math.min(Math.max(XENO_SEARCH_CONFIG.defaultNumResults, 1), XENO_SEARCH_CONFIG.maxNumResults)
                    );

                    // Create a compatible data structure
                    const xenoData = {
                        sources: searchResult.sources,
                        summary: searchResult.summary,
                        error: searchResult.error
                    };

                    // Check if we have sources before updating the search results message
                    const hasSearchSources = xenoData.sources && xenoData.sources.length > 0;

                    if (hasSearchSources) {
                        // Update the search results message with Xeno results
                        setMessages(prev => prev.map(msg =>
                            msg.id === searchResultsMessageId
                                ? {
                                    ...msg,
                                    isLoading: false,
                                    searchInfo: {
                                        queries: [userTextToSend],
                                        sources: xenoData.sources.map(source => ({
                                            uri: source.url,
                                            title: source.title || source.url
                                        })),
                                        supports: []
                                    }
                                  }
                                : msg
                        ));
                    } else {
                        // No sources found - remove the search results message entirely
                        console.log('[Xeno Search] No sources, removing search results message');
                        setMessages(prev => prev.filter(msg => msg.id !== searchResultsMessageId));
                    }

                    if (xenoData.error) {
                        console.error("Xeno Search Error:", xenoData.error);

                        // Show error message from service
                        const errorMessage = `🔍 Search failed: ${xenoData.error}`;

                        // Update search results message to show error state
                        setMessages(prev => prev.map(msg =>
                            msg.id === searchResultsMessageId
                                ? {
                                    ...msg,
                                    isLoading: false,
                                    isError: true,
                                    text: errorMessage
                                  }
                                : msg
                        ));

                        setPendingXenoSearchInfo(null); // Clear if there was an error
                        return; // Exit early, don't call fetchAiResponse
                    } else {
                        // Performance monitoring based on guide recommendations
                        const searchDuration = Date.now() - searchStartTime;
                        console.log(`[Xeno Search] Completed successfully in ${searchDuration}ms. Found ${xenoData.sources?.length || 0} sources.`);
                        
                        // Save successful search results
                        setXenoSearchResults(xenoData);

                        // ---- START MODIFICATION: Transform and store for next AI message ----
                        // Only set searchInfo if there are actual sources to show
                        const hasSources = xenoData.sources && xenoData.sources.length > 0;

                        if (hasSources) {
                            transformedSearchInfo = {
                                queries: xenoData.query ? [xenoData.query] : [],
                                sources: xenoData.sources.map(source => ({
                                    uri: source.url,
                                    title: source.title || source.url, // Use URL as fallback title
                                })),
                                supports: [], // Xeno search won't have LLM-generated text-linked supports
                            };

                            console.log("[DEBUG] Setting pending Xeno search info:", {
                                queries: transformedSearchInfo.queries,
                                sourcesCount: transformedSearchInfo.sources?.length || 0,
                                sources: transformedSearchInfo.sources?.map(s => ({ uri: s.uri, title: s.title })) || []
                            });

                            setPendingXenoSearchInfo(transformedSearchInfo);
                        } else {
                            // No sources found (e.g., factual query skipped search)
                            // Clear any pending search info so no search container shows
                            console.log("[DEBUG] No sources found, clearing search info");
                            setPendingXenoSearchInfo(null);
                            transformedSearchInfo = null;
                        }
                        // ---- END MODIFICATION ----

                        // Only create augmented prompt and context if there are actual sources
                        if (hasSources) {
                            // Format sources with detailed information
                            const formattedSources = xenoData.sources.map((source, index) => {
                                return `SOURCE ${index + 1}: ${source.title || 'Untitled'}
URL: ${source.url}
DATE: [Extract date from content if available]
CONTENT:
${source.raw_text ? source.raw_text.substring(0, 2000) : source.snippet || 'No content available'}
----------
`;
                            }).join('\n');

                            // Enhanced augmented prompt based on integration guide recommendations with multimodal context
                            const augmentedPrompt = `
[XENO SEARCH CONTEXT - REAL-TIME WEB RESULTS WITH MULTIMODAL INPUT]

Original Query: "${userTextToSend}"
Enhanced Search Query: "${enhancedQuery.query}"
Search Type: ${xenoData.search_type || 'normal'}
Results Found: ${xenoData.sources.length} sources
${xenoData.processing_time ? `Processing Time: ${xenoData.processing_time}ms` : ''}

${enhancedQuery.context ? `
MULTIMODAL CONTEXT:
${enhancedQuery.context}

` : ''}${xenoData.summary ? `
SEARCH SUMMARY:
${xenoData.summary}

` : ''}WEB SEARCH RESULTS:
${formattedSources}

RESPONSE INSTRUCTIONS:
1. PRIMARY SOURCE: Use the search results above as your primary information source
2. MULTIMODAL CONTEXT: Consider the attached images/files when interpreting search results
3. CURRENCY: This information is more recent than your training data - prioritize it
4. CITATIONS: Reference sources using [SOURCE 1], [SOURCE 2], etc. format
5. CONTRADICTIONS: If sources conflict, present multiple viewpoints clearly
6. GAPS: If search results don't fully answer the query, state what's missing
7. STRUCTURE: Use clear headings, bullet points, and organized formatting
8. COMPREHENSIVENESS: Address all aspects of the user's query and any attached content
9. ACCURACY: Only make claims that can be supported by the provided sources

USER INPUT: ${userTextToSend || 'See multimodal context above'}

Please provide a well-structured response using this search context and any multimodal information provided.
[/XENO SEARCH CONTEXT]
`;

                            // Prepare context for LLM prompt augmentation with the structured prompt
                            xenoContextForLLM = {
                                summary: augmentedPrompt,  // Use the augmented prompt as the summary
                                sources: xenoData.sources  // Still include sources in original format for reference
                            };
                        } else {
                            // No sources - don't augment prompt, let AI answer naturally
                            console.log('[Xeno Search] No sources found, AI will answer without search context');
                            xenoContextForLLM = null;
                        }

                        // console.log('[ChatWithLLM HandleGenerate] Xeno Search successful, transformed searchInfo prepared.');
                }
            } catch (error) {
                console.error("Failed to call Xeno Search API:", error);
                
                // Update search results message to show error state  
                setMessages(prev => prev.map(msg => 
                    msg.id === searchResultsMessageId 
                        ? { 
                            ...msg, 
                            isLoading: false, 
                            isError: true,
                            text: 'Search service temporarily unavailable' 
                          }
                        : msg
                ));
                
                // Determine specific error message based on error type (guide recommendations)
                let errorMessage = '🔍 Search service unavailable. Please try again later.';
                if (error instanceof Error) {
                    if (error.name === 'TimeoutError') {
                        errorMessage = '🔍 Search request timed out. Please try again with a simpler query.';
                    } else if (error.message.includes('Failed to fetch') || error.message.includes('ECONNREFUSED')) {
                        errorMessage = '🔍 Cannot connect to search service. Please check your connection and try again.';
                    } else if (error.message.includes('ENOTFOUND')) {
                        errorMessage = '🔍 Search service is not accessible. Please try again later.';
                    } else if (error.message.includes('unavailable')) {
                        errorMessage = '🔍 Search service is temporarily unavailable. Using standard response.';
                    }
                }
                
                                    // Update search results message to show error state
                    setMessages(prev => prev.map(msg => 
                        msg.id === searchResultsMessageId 
                            ? { 
                                ...msg, 
                                isLoading: false, 
                    isError: true,
                                text: errorMessage 
                              }
                            : msg
                    ));
                
                setPendingXenoSearchInfo(null); // Clear on error
                return; // Exit early, don't call fetchAiResponse
            } finally {
                setIsXenoSearching(false);
            }

            // Now call fetchAiResponse with the xenoContextForLLM if available
            // Get the latest message history (might include error messages)
            const updatedMessageHistory = await new Promise<ChatMessage[]>(resolve => {
                setMessages(current => { resolve(current); return current; });
            });
            
            // Don't pass search info to AI message since it's displayed in the dedicated container
            await fetchAiResponse(updatedMessageHistory, systemPrompt, selectedModel, undefined, xenoContextForLLM, undefined);
            } // End of Xeno Search mode (else block)
        } else {
            // Standard LLM call without Xeno Search
            setPendingXenoSearchInfo(null); // Ensure it's clear if Xeno wasn't used
            // console.log('[ChatWithLLM HandleGenerate] Xeno Search not enabled, sending directly to LLM API');
            await fetchAiResponse(currentMessageHistory, systemPrompt, selectedModel, undefined, undefined, undefined); // Explicitly pass undefined for task, xenoContext, and xenoSearchInfo
        }
    }
  };

  // --- NEW: Function to Load a Conversation from History ---
  const handleLoadConversation = async (conversationId: string) => {
    const conversationToLoad = conversationHistory.find(convo => convo.id === conversationId);
    if (conversationToLoad) {
        // console.log("Loading conversation:", conversationId);
        setActiveConversationId(conversationId);

        // Always load from database when authenticated to ensure fresh data
        if (isDbAuthenticated) {
          try {
            const fullConversation = await chatService.getConversation(conversationId);
            if (fullConversation && fullConversation.messages) {
              // Convert database message format to local format
              const localMessages: ChatMessage[] = fullConversation.messages.map((msg: DBChatMessage, index: number) => {
                const isAi = msg.role === 'assistant';
                return {
                  id: msg.id || `msg-${index}`,
                  sender: isAi ? 'ai' as const : 'user' as const,
                  text: msg.content,
                  // For AI messages, content is the parsedAnswer (displayed content)
                  parsedAnswer: isAi ? msg.content : undefined,
                  modelId: msg.model_id,
                  modelIdUsed: msg.model_id,
                  thinkingContent: msg.thinking,
                  hasThinking: msg.has_thinking,
                };
              });
              setMessages(localMessages);

              // Update cache in conversation history
              setConversationHistory(prevHistory =>
                prevHistory.map(convo =>
                  convo.id === conversationId
                    ? { ...convo, messages: localMessages }
                    : convo
                )
              );
            } else {
              setMessages(conversationToLoad.messages || []);
            }
          } catch (error) {
            console.error("Error loading conversation from database:", error);
            setMessages(conversationToLoad.messages || []);
          }
        } else {
          setMessages(conversationToLoad.messages || []);
        }

        // --- Load System Prompt ---
        const loadedPrompt = conversationToLoad.systemPrompt || '';
        setSystemPrompt(loadedPrompt);
        setSavedSystemPrompt(loadedPrompt);
        setIsSystemPromptOpen(false); // Close prompt panel if open
        // --- End Load System Prompt ---
        setIsHistoryOpen(false); // Close history panel after loading
        // Optional: Reset input, system prompt, etc. or load them from conversation if saved
        setInputValue('');
        setShowThinkingId(null);
        // Sync toggles based on the *last used model* in the loaded conversation?
        // For simplicity, let's sync to the currently selected model for now.
        syncTogglesForModel(selectedModel);
    } else {
        console.error("Could not find conversation to load:", conversationId);
    }
  };

  // --- Refresh current conversation from database ---
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshConversation = async () => {
    if (!activeConversationId || !isDbAuthenticated || isRefreshing) return;

    setIsRefreshing(true);
    try {
      // Force reload from database
      const fullConversation = await chatService.getConversation(activeConversationId);
      if (fullConversation && fullConversation.messages) {
        // Convert database message format to local format
        const localMessages: ChatMessage[] = fullConversation.messages.map((msg: DBChatMessage, index: number) => {
          const isAi = msg.role === 'assistant';
          return {
            id: msg.id || `msg-${index}`,
            sender: isAi ? 'ai' as const : 'user' as const,
            text: msg.content,
            parsedAnswer: isAi ? msg.content : undefined,
            modelId: msg.model_id,
            modelIdUsed: msg.model_id,
            thinkingContent: msg.thinking,
            hasThinking: msg.has_thinking,
          };
        });
        setMessages(localMessages);

        // Update cache in conversation history
        setConversationHistory(prevHistory =>
          prevHistory.map(convo =>
            convo.id === activeConversationId
              ? { ...convo, messages: localMessages }
              : convo
          )
        );
        console.log(`[Refresh] Reloaded ${localMessages.length} messages for conversation ${activeConversationId}`);
      }
    } catch (error) {
      console.error("Error refreshing conversation:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Fetch fresh conversation list from database for the selector dropdown
  const [selectorConversations, setSelectorConversations] = useState<Conversation[]>([]);
  const [isSelectorLoading, setIsSelectorLoading] = useState(false);
  const [conversationSearchQuery, setConversationSearchQuery] = useState('');

  const fetchConversationsForSelector = async () => {
    if (!isDbAuthenticated) return;

    setIsSelectorLoading(true);
    try {
      const { conversations } = await chatService.getConversations({
        interface_id: sharedInterfaceId,
      });

      if (conversations && conversations.length > 0) {
        const localFormat: Conversation[] = conversations.map(conv => ({
          id: conv.id,
          title: conv.title,
          timestamp: conv.created_at ? new Date(conv.created_at).getTime() : Date.now(),
          messages: [],
          systemPrompt: conv.system_prompt,
        }));
        setSelectorConversations(localFormat);
      } else {
        setSelectorConversations([]);
      }
    } catch (error) {
      console.error("Error fetching conversations for selector:", error);
      setSelectorConversations([]);
    } finally {
      setIsSelectorLoading(false);
    }
  };

  // Fetch conversations when selector opens
  useEffect(() => {
    if (isConversationSelectorOpen) {
      fetchConversationsForSelector();
    }
  }, [isConversationSelectorOpen]);
  // --- END NEW ---

  const toggleHistory = () => {
    setIsHistoryOpen(!isHistoryOpen);
  };


  const toggleSearch = () => {
    const newSearchState = !isSearchToggled;
    setIsSearchToggled(newSearchState);
    console.log(`[Search Toggle] Search ${newSearchState ? 'ENABLED' : 'DISABLED'} for model: ${selectedModel.id}`);
  };
  
  // Toggle function for Xeno Search
  const toggleXenoSearch = () => {
    const newXenoSearchState = !isXenoSearchEnabled;
    setIsXenoSearchEnabled(newXenoSearchState);
    const currentMode = isXenoDeepMode ? 'Xeno Deep' : 'Xeno Search';
    console.log(`[Xeno Search Toggle] ${currentMode} ${newXenoSearchState ? 'ENABLED' : 'DISABLED'}`);
  };

  // Compact conversation using AI summarization when switching to smaller context models
  const compactConversation = async (newModel: Model) => {
    const totalUsedTokens = activeConversationTokenCount + currentInputAndSystemTokens;
    if (messages.length === 0 || totalUsedTokens <= newModel.maxTokens) {
      return; // No need to compact
    }

    console.log(`🗜️ Compacting conversation: ${totalUsedTokens} tokens -> ${newModel.maxTokens} max`);
    setIsLoading(true);

    try {
      // Always use Gemini Flash for compacting - fast, cheap, 1M context
      const compactingModel = 'gpt-5.4-mini';
      console.log(`📦 Using Gemini Flash for compacting`);

      // Build conversation text for summarization
      const conversationText = messages
        .map(m => `${m.sender === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
        .join('\n\n');

      const result = await chatComplete({
        model: compactingModel,
        path: 'premium',
        messages: [
          {
            role: 'system',
            content: `You are a conversation summarizer. Create a concise summary of the following conversation.
Focus on:
1. Main topics discussed
2. Key questions asked and answers given
3. Important decisions or conclusions reached

Keep the summary under 500 words. Preserve essential context needed to continue the conversation.`
          },
          {
            role: 'user',
            content: `Summarize this conversation:\n\n${conversationText}`
          }
        ],
        maxTokens: 1000,
      });

      const summary = result.content || 'Previous conversation summary.';

      // Create compacted messages: summary message only
      const compactedMessages: ChatMessage[] = [
        {
          id: `summary-${Date.now()}`,
          sender: 'ai',
          text: `**📋 Conversation Summary (compacted for ${newModel.name}):**\n\n${summary}\n\n---\n\n*The conversation has been compressed to fit within the context window. You can continue chatting from here.*`,
        }
      ];

      setMessages(compactedMessages);
      console.log(`✅ Conversation compacted successfully`);

    } catch (error) {
      console.error('Failed to compact conversation:', error);
      // On error, just warn the user but allow the switch
      const warningMessage: ChatMessage = {
        id: `warning-${Date.now()}`,
        sender: 'ai',
        text: `⚠️ **Note:** Switched to ${newModel.name} which has a smaller context window. Some conversation history may not fit.`,
        isError: true,
      };
      setMessages(prev => [...prev, warningMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleModelSelect = async (model: Model) => {
    const previousModel = selectedModel;
    setSelectedModel(model);
    setIsCompanyDropdownOpen(false); // Close company dropdown
    setExpandedCompanies(new Set()); // Reset expanded state
    setShowThinkingId(null); // Reset expanded thoughts on model change

    // --- Refactored Logic to sync toggle state based on capability ---
    syncTogglesForModel(model); // Use the helper function

    // Check if we need to compact the conversation
    const totalUsedTokens = activeConversationTokenCount + currentInputAndSystemTokens;
    if (model.maxTokens < previousModel.maxTokens && totalUsedTokens > model.maxTokens) {
      await compactConversation(model);
    }
  };

  // Toggle System Prompt Panel
  const toggleSystemPrompt = () => {
      if (isCustomPromptOpen) {
        setIsCustomPromptOpen(false);
      } else {
        setIsSystemPromptOpen(!isSystemPromptOpen);
      }
  };

  // Handle persona selection
  const handlePersonaSelect = (personaId: string) => {
    const persona = PERSONAS.find(p => p.id === personaId);
    if (persona) {
      setSelectedPersona(personaId);
      setSystemPrompt(persona.prompt);
      setSavedSystemPrompt(persona.prompt);
      setIsSystemPromptOpen(false);
      setIsCustomPromptOpen(false);
    }
  };

  // Handle custom prompt selection
  const handleCustomPromptOpen = () => {
    setSelectedPersona('custom');
    setIsCustomPromptOpen(true);
  };

  // Updated handler for Save/Clear System Prompt action
  const handleSaveOrClearSystemPrompt = () => {
    const currentPrompt = systemPrompt.trim();

    if (currentPrompt !== savedSystemPrompt && currentPrompt !== '') {
      // --- Save Action ---
      // console.log("Saving System Prompt:", currentPrompt);
      setSavedSystemPrompt(currentPrompt);
      setIsSystemPromptSaved(true); // Show confirmation checkmark
    setTimeout(() => {
          setIsSystemPromptSaved(false); // Hide confirmation after delay
      }, 1500); // Show checkmark for 1.5 seconds
    } else if (currentPrompt === savedSystemPrompt && currentPrompt !== '') {
      // --- Clear Action ---
      // console.log("Clearing System Prompt.");
      setSystemPrompt(''); // Clear the input field
      setSavedSystemPrompt(''); // Reset the saved state
      setSelectedPersona(null); // Reset persona selection
      // No checkmark needed for clear
    }
    // If currentPrompt is empty, do nothing (button should be disabled)
  };

  // Clear system prompt and reset persona
  const handleClearSystemPrompt = () => {
    setSystemPrompt('');
    setSavedSystemPrompt('');
    setSelectedPersona(null);
    setIsSystemPromptOpen(false);
    setIsCustomPromptOpen(false);
  };

  // Placeholder for New Chat action
  const handleNewChat = () => {
      setMessages([]); // Clear current messages
      setActiveConversationId(null); // Set active ID to null (indicates new chat)
      setInputValue(''); // Clear the input field
      // Optional: Clear other states like system prompt, toggles, attachments if desired
      setSystemPrompt('');
      setSavedSystemPrompt('');
      setIsSystemPromptOpen(false);
      setAttachedFiles([]);
      setShowThinkingId(null);
      // Reset toggles based on the selected model's capabilities after clearing
      syncTogglesForModel(selectedModel);
  };

  // Export conversation as markdown
  const handleExportConversation = () => {
    if (messages.length === 0) return;

    let markdown = '# Conversation Export\n\n';
    markdown += `*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;

    messages.forEach((msg) => {
      if (msg.isThinkingPlaceholder || msg.isDotPlaceholder) return;

      const timestamp = msg.timestamp
        ? `*${formatMessageTime(msg.timestamp)}*`
        : '';

      if (msg.sender === 'user') {
        markdown += `## 👤 User ${timestamp}\n\n${msg.text}\n\n`;
      } else {
        const modelName = msg.modelIdUsed?.split('/').pop() || 'AI';
        markdown += `## 🤖 ${modelName} ${timestamp}\n\n`;

        // Include thinking content if present
        if (msg.hasThinking && msg.thinkingContent) {
          markdown += `<details>\n<summary>💭 Thinking Process</summary>\n\n${msg.thinkingContent}\n\n</details>\n\n`;
        }

        // Main response
        markdown += `${msg.parsedAnswer || msg.text}\n\n`;

        // Include sources if present
        if (msg.searchInfo?.sources && msg.searchInfo.sources.length > 0) {
          markdown += `**Sources:**\n`;
          msg.searchInfo.sources.forEach((source, idx) => {
            markdown += `${idx + 1}. [${source.title}](${source.uri})\n`;
          });
          markdown += '\n';
        }
      }

      markdown += '---\n\n';
    });

    // Create and trigger download
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `conversation-${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // --- NEW Helper Function to Sync Toggles ---
  // (Extracted from handleModelSelect to be reusable)
  // Uses dynamic modelHasReasoningCapability helper instead of hardcoded lists
  const syncTogglesForModel = (model: Model) => {
     const capability = modelHasReasoningCapability(model.id);
     if (capability === 'alwaysOn') setIsReasonToggled(true);
     else if (capability === 'disabled') setIsReasonToggled(false);
     // toggleable: keep current state (user preference persists across model switches)
  };
  // --- END NEW Helper --- 

  // --- NEW: Delete Confirmation Modal Component --- 
  const DeleteConfirmationModalComponent: React.FC = () => {
    if (!deleteConfirmationModal.isOpen || !deleteConfirmationModal.conversationId || deleteConfirmationModal.conversationTitle === null) {
        return null;
    }

    const handleConfirm = () => {
        if (deleteConfirmationModal.conversationId) {
            handleDeleteConversation(deleteConfirmationModal.conversationId);
        }
        handleCancelDelete(); // Close modal after action
    };

    return (
        <div className="absolute inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#111113] border border-[#1e1e21] rounded-lg shadow-xl max-w-sm w-full overflow-hidden">
                {/* Header */}
                <div className="p-4">
                    <h2 className="text-lg font-semibold text-white">Delete chat?</h2>
                </div>

                {/* Divider */}
                <hr className="border-t border-[#1e1e21]" />

                {/* Content */}
                <div className="p-4">
                    <p className="text-sm text-gray-300">
                        This will delete <strong className="text-white">{deleteConfirmationModal.conversationTitle}</strong>.
                    </p>
                </div>

                {/* Footer with Buttons */}
                <div className="flex justify-end gap-3 bg-[#0e0e10]/50 px-4 py-3 border-t border-[#1e1e21]">
                    <button 
                        onClick={handleCancelDelete}
                        className="px-4 py-1.5 rounded-md text-sm font-medium text-gray-300 bg-[#1e1e21] hover:bg-[#2a2a2d] transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleConfirm}
                        className="px-4 py-1.5 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
  };
  // --- END NEW Modal Component --- 

  // --- Real token count via API (debounced) ---
  // Keep showing last known count until new one arrives (no jumping)
  useEffect(() => {
    // Clear previous debounce
    if (tokenCountDebounceRef.current) {
      clearTimeout(tokenCountDebounceRef.current);
    }

    // Debounce the API call by 300ms
    tokenCountDebounceRef.current = setTimeout(async () => {
      try {
        const normalizedMessages = messages.map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.sender === 'user'
            ? (msg.text || '')
            : (msg.parsedAnswer || msg.text || '')
        }));

        // First, get conversation-only token count (for compress threshold)
        const conversationResult = await countMessageTokens(
          normalizedMessages,
          selectedModel?.id || 'gpt-4',
          savedSystemPrompt
        );
        setConversationTokenCount(conversationResult.total);

        // Then get total including input
        if (inputValue.trim()) {
          const messagesWithInput = [...normalizedMessages, { role: 'user', content: inputValue }];
          const totalResult = await countMessageTokens(
            messagesWithInput,
            selectedModel?.id || 'gpt-4',
            savedSystemPrompt
          );
          setRealTokenCount(totalResult.total);
        } else {
          setRealTokenCount(conversationResult.total);
        }
      } catch (error) {
        console.warn('[TokenCount] Error fetching real token count:', error);
        // On error, use quick estimate as fallback
        const conversationFallback = messages.reduce((acc, msg) => {
          const text = msg.sender === 'user' ? (msg.text || '') : (msg.parsedAnswer || msg.text || '');
          return acc + estimateTokens(text);
        }, 0) + estimateTokens(savedSystemPrompt);
        setConversationTokenCount(conversationFallback);
        setRealTokenCount(conversationFallback + estimateTokens(inputValue));
      }
    }, 300);

    return () => {
      if (tokenCountDebounceRef.current) {
        clearTimeout(tokenCountDebounceRef.current);
      }
    };
  }, [messages, inputValue, savedSystemPrompt, selectedModel?.id]);

  // Use real token count (keeps last known value until new one arrives)
  const activeConversationTokenCount = realTokenCount; // Total for display
  const currentInputAndSystemTokens = 0; // Already included in realTokenCount
  // --- END TOKEN CALCULATION ---

  // Toggle Attach Menu
  const toggleAttachMenu = () => {
    const newState = !isAttachMenuOpen;
    setIsAttachMenuOpen(newState);
    if (!newState) {
       setIsRecentFilesOpen(false);
    }
  };

  // Update handler to trigger file input click
  const handleUploadFile = () => { 
    fileInputRef.current?.click(); 
  };
  
  // Handle file selection from the hidden input
  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
        const newFiles: AttachedFile[] = Array.from(files).map(file => ({
            id: `${file.name}-${file.lastModified}-${file.size}`,
            name: file.name,
            type: file.type || 'unknown',
            fileObject: file 
        }));
        
        // Add files to recent files list
        const now = Date.now();
        const newRecentFiles = Array.from(files).map(file => ({
          id: `${file.name}-${file.lastModified}-${file.size}`,
          name: file.name,
          type: file.type || 'unknown',
          size: file.size,
          lastUsed: now,
          preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
        }));

        setRecentFiles(prev => {
          // Remove any existing files with the same name and add new ones
          const filtered = prev.filter(existingFile => 
            !newRecentFiles.some(newFile => newFile.name === existingFile.name)
          );
          // Add new files at the beginning and limit to 20 most recent
          return [...newRecentFiles, ...filtered].slice(0, 20);
        });
        
        setAttachedFiles(prev => [...prev, ...newFiles]);
        setIsAttachMenuOpen(false); // Close menus
        setIsRecentFilesOpen(false);
    }
    if(event.target) {
        event.target.value = '';
    }
  };

  // Handle removing an attached file
  const handleRemoveAttachedFile = (fileIdToRemove: string) => {
      setAttachedFiles(prev => prev.filter(file => file.id !== fileIdToRemove));
  };

  // Placeholder handlers for other attach options (re-added)
  const handleConnectDrive = () => { 
    console.log('Connect Drive - Feature coming soon'); 
    // setIsAttachMenuOpen(false); setIsRecentFilesOpen(false); 
  };
  const handleConnectOneDrive = () => { 
    console.log('Connect OneDrive - Feature coming soon'); 
    // setIsAttachMenuOpen(false); setIsRecentFilesOpen(false); 
  };
  const handleShowRecent = () => { 
    setIsRecentFilesOpen(true); // Keep attach menu open when opening recent
  }; 

  // Handle re-attaching a recent file
  const handleReattachRecentFile = async (recentFile: typeof recentFiles[0]) => {
    console.log('[Recent Files] Re-attaching file:', recentFile.name);
    
    // Create a new AttachedFile object without the actual File object
    // Since we can't recreate the File object from localStorage data,
    // we'll create a virtual file representation
    const attachedFile: AttachedFile = {
      id: `recent-${recentFile.id}-${Date.now()}`,
      name: recentFile.name,
      type: recentFile.type,
      // Note: fileObject will be undefined for recent files
      // The UI should handle this gracefully by showing metadata only
    };
    
    setAttachedFiles(prev => [...prev, attachedFile]);
    
    // Update the lastUsed timestamp for this recent file
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

  // Handle removing a file from recent files
  const handleRemoveRecentFile = (fileId: string) => {
    setRecentFiles(prev => prev.filter(file => file.id !== fileId));
  };
  
  // --- Placeholder Handlers for AI Message Actions ---
  const handleRegenerate = async (messageIdToRegenerate: string) => { // Make async
    // console.log('Regenerate clicked for message:', messageIdToRegenerate);

    const targetMessageIndex = messages.findIndex(msg => msg.id === messageIdToRegenerate);
    if (targetMessageIndex === -1) {
      console.error("Cannot regenerate: Original message not found.");
      return;
    }

    const historyForRegeneration = messages.slice(0, targetMessageIndex);
    if (historyForRegeneration.length === 0 || historyForRegeneration[historyForRegeneration.length - 1].sender !== 'user') {
      console.error("Cannot regenerate: Preceding history is invalid or empty.");
      return;
    }

    // console.log("Regenerating based on history:", historyForRegeneration);
    setMessages(historyForRegeneration); // Remove regenerated and subsequent messages
    await fetchAiResponse(historyForRegeneration, systemPrompt, selectedModel, undefined, undefined, undefined); // Explicitly pass undefined for task, xenoContext, and xenoSearchInfo
  };

  const handleXenoSearchRetry = async (messageIdToRegenerate: string) => {
    // console.log('Xeno Search retry clicked for message:', messageIdToRegenerate);

    const targetMessageIndex = messages.findIndex(msg => msg.id === messageIdToRegenerate);
    if (targetMessageIndex === -1) {
      console.error("Cannot retry Xeno Search: Original message not found.");
      return;
    }

    const historyForRegeneration = messages.slice(0, targetMessageIndex);
    if (historyForRegeneration.length === 0 || historyForRegeneration[historyForRegeneration.length - 1].sender !== 'user') {
      console.error("Cannot retry Xeno Search: Preceding history is invalid or empty.");
      return;
    }

    // Get the original user prompt that triggered the search
    const lastUserMessage = historyForRegeneration[historyForRegeneration.length - 1];
    const originalPrompt = lastUserMessage.text;

    console.log(`[Xeno Search Retry] Retrying search for original prompt: "${originalPrompt}"`);

    // Remove cancelled message and restart the process
    setMessages(historyForRegeneration);
    
    // Clear any previous Xeno Search results
    setXenoSearchResults(null);

    // Start Xeno Search process again
    console.log(`[Xeno Search Retry] Starting search for query: "${originalPrompt}" (type: ${isXenoDeepMode ? 'deep' : 'normal'}, results: ${XENO_SEARCH_CONFIG.defaultNumResults})`);
    setIsXenoSearching(true);
    const searchStartTime = Date.now();

    // Create a search results message with loading state
    const searchResultsMessageId = `search-results-${Date.now()}`;
    const searchResultsMessage: ChatMessage = {
        id: searchResultsMessageId,
        sender: 'ai',
        text: '',
        searchInfo: {
            queries: [originalPrompt],
            sources: [],
            supports: []
        },
        isLoading: true, // Add loading flag to show "Searching..." state
    };
    
    // Add the search results message to history
    setMessages(prev => [...prev, searchResultsMessage]);

    // Define variables to hold Xeno context and search info for the LLM
    let xenoContextForLLM: { summary?: string; sources?: XenoSource[] } | undefined = undefined;
    let transformedSearchInfo: ChatMessage['searchInfo'] | undefined = undefined;

    try {
        // Use xenoSearchService for retry search requests
        const xenoData = await xenoSearchService.searchGeneral({
            query: originalPrompt.trim(),
            search_type: isXenoDeepMode ? 'deep' : 'normal',
            num_results: Math.min(Math.max(XENO_SEARCH_CONFIG.defaultNumResults, 1), XENO_SEARCH_CONFIG.maxNumResults),
        });

        // Update the search results message with Xeno results
        setMessages(prev => prev.map(msg =>
            msg.id === searchResultsMessageId
                ? {
                    ...msg,
                    isLoading: false,
                    searchInfo: {
                        queries: [originalPrompt],
                        sources: xenoData.sources?.map(source => ({
                            uri: source.url,
                            title: source.title || source.url
                        })) || [],
                        supports: []
                    }
                  }
                : msg
        ));

        if (xenoData.error) {
            console.error("Xeno Search Retry Error:", xenoData.error);

            // Show error message from service
            const errorMessage = `🔍 Search failed: ${xenoData.error}`;

            // Update search results message to show error state
            setMessages(prev => prev.map(msg =>
                msg.id === searchResultsMessageId
                    ? {
                        ...msg,
                        isLoading: false,
                        isError: true,
                        text: errorMessage
                      }
                    : msg
            ));

            setPendingXenoSearchInfo(null); // Clear if there was an error
            return; // Exit early, don't call fetchAiResponse
        }

        // Process successful search results
        const searchDuration = Date.now() - searchStartTime;
        console.log(`[Xeno Search Retry] Search completed in ${searchDuration}ms`);

        if (xenoData.sources && xenoData.sources.length > 0) {
            xenoContextForLLM = {
                summary: xenoData.summary,
                sources: xenoData.sources
            };

            transformedSearchInfo = {
                queries: [originalPrompt],
                sources: xenoData.sources.map(source => ({
                    uri: source.url,
                    title: source.title || source.url
                })),
                supports: []
            };

            console.log(`[Xeno Search Retry] Found ${xenoData.sources.length} sources for context`);
        } else {
            console.log('[Xeno Search Retry] No sources found in search results');
        }

        // Store the transformed search info for later use by the AI response
        setPendingXenoSearchInfo(transformedSearchInfo || null);

    } catch (error) {
        console.error("Failed to call Xeno Search API on retry:", error);
        
        // Update search results message to show error state  
        setMessages(prev => prev.map(msg => 
            msg.id === searchResultsMessageId 
                ? { 
                    ...msg, 
                    isLoading: false, 
                    isError: true,
                    text: 'Search service temporarily unavailable' 
                  }
                : msg
        ));
        
        // Determine specific error message based on error type (guide recommendations)
        let errorMessage = '🔍 Search service unavailable. Please try again later.';
        if (error instanceof Error) {
            if (error.name === 'TimeoutError') {
                errorMessage = '🔍 Search request timed out. Please try again with a simpler query.';
            } else if (error.message.includes('Failed to fetch') || error.message.includes('ECONNREFUSED')) {
                errorMessage = '🔍 Cannot connect to search service. Please check your connection and try again.';
            } else if (error.message.includes('ENOTFOUND')) {
                errorMessage = '🔍 Search service is not accessible. Please try again later.';
            } else if (error.message.includes('unavailable')) {
                errorMessage = '🔍 Search service is temporarily unavailable. Using standard response.';
            }
        }
        
        // Update search results message to show error state
        setMessages(prev => prev.map(msg => 
            msg.id === searchResultsMessageId 
                ? { 
                    ...msg, 
                    isLoading: false, 
                    isError: true,
                    text: errorMessage 
                  }
                : msg
        ));
        
        setPendingXenoSearchInfo(null); // Clear on error
        return; // Exit early, don't call fetchAiResponse
    } finally {
        setIsXenoSearching(false);
    }

    // Now call fetchAiResponse with the xenoContextForLLM if available
    // Get the latest message history (might include error messages)
    const updatedMessageHistory = await new Promise<ChatMessage[]>(resolve => {
        setMessages(current => { resolve(current); return current; });
    });
    
    // Don't pass search info to AI message since it's displayed in the dedicated container
    await fetchAiResponse(updatedMessageHistory, systemPrompt, selectedModel, undefined, xenoContextForLLM, undefined);
  };

  const handleTryWithoutSearch = async (messageIdToRegenerate: string) => {
    // Check if Xeno Search is still enabled - if so, retry with search instead
    if (isXenoSearchEnabled) {
      console.log('[handleTryWithoutSearch] Xeno Search is still enabled, retrying with search instead');
      return handleXenoSearchRetry(messageIdToRegenerate);
    }

    // console.log('Try without search clicked for message:', messageIdToRegenerate);

    const targetMessageIndex = messages.findIndex(msg => msg.id === messageIdToRegenerate);
    if (targetMessageIndex === -1) {
      console.error("Cannot try without search: Original message not found.");
      return;
    }

    const historyForRegeneration = messages.slice(0, targetMessageIndex);
    if (historyForRegeneration.length === 0 || historyForRegeneration[historyForRegeneration.length - 1].sender !== 'user') {
      console.error("Cannot try without search: Preceding history is invalid or empty.");
      return;
    }

    // Temporarily disable Xeno Search
    const wasXenoSearchEnabled = isXenoSearchEnabled;
    setIsXenoSearchEnabled(false);

    // Remove cancelled message and proceed without search
    setMessages(historyForRegeneration);
    
    try {
      await fetchAiResponse(historyForRegeneration, systemPrompt, selectedModel, undefined, undefined, undefined);
    } finally {
      // Restore Xeno Search state
      setIsXenoSearchEnabled(wasXenoSearchEnabled);
    }
  };

  // Modify handleCopy to accept the parsed answer specifically AND the message ID
  const handleCopy = (textToCopy: string | undefined, messageId: string) => { // Add messageId parameter
    if (!textToCopy) { 
        console.warn('Attempted to copy undefined text.');
        return; 
    }
    navigator.clipboard.writeText(textToCopy).then(() => {
      // console.log('Copied AI text to clipboard for message:', messageId);
      setCopiedAiMessageId(messageId); // Show confirmation for this AI message
      setTimeout(() => {
          setCopiedAiMessageId(null); // Clear confirmation after delay
      }, 1500); // 1.5 seconds
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  };

  // --- AI Message Edit Handlers ---
  const handleEditAiMessage = (messageId: string, currentContent: string) => {
    setEditingAiMessageId(messageId);
    setEditingAiContent(currentContent || '');
  };

  const handleCancelAiEdit = () => {
    setEditingAiMessageId(null);
    setEditingAiContent('');
  };

  const handleSaveAiEdit = async () => {
    if (!editingAiMessageId) return;

    const messageIndex = messages.findIndex(msg => msg.id === editingAiMessageId);
    if (messageIndex === -1) {
      console.error('Could not find AI message to save edit for');
      handleCancelAiEdit();
      return;
    }

    const updatedMessage: ChatMessage = {
      ...messages[messageIndex],
      parsedAnswer: editingAiContent,
      text: editingAiContent, // Also update text to keep in sync
    };

    // Update local state
    const updatedMessages = [...messages];
    updatedMessages[messageIndex] = updatedMessage;
    setMessages(updatedMessages);

    // Update conversation history cache
    if (activeConversationId) {
      setConversationHistory(prevHistory =>
        prevHistory.map(convo =>
          convo.id === activeConversationId
            ? { ...convo, messages: updatedMessages }
            : convo
        )
      );

      // Save to database if authenticated
      if (isDbAuthenticated) {
        try {
          await chatService.updateMessage(editingAiMessageId, {
            content: editingAiContent,
          });
          console.log('[AI Edit] Message updated in database');
        } catch (error) {
          console.error('[AI Edit] Failed to save to database:', error);
        }
      }
    }

    handleCancelAiEdit();
  };
  // --- End AI Message Edit Handlers ---

  // --- Code Block Edit Handlers ---
  const handleEditCodeBlock = (codeBlockId: string, currentCode: string, language: string) => {
    // Extract message ID from code block ID (format: messageId-code-lineNumber)
    const messageId = codeBlockId.split('-code-')[0];
    setEditingCodeBlockId(codeBlockId);
    setEditingCodeBlockMessageId(messageId);
    setEditingCodeContent(currentCode);
    setEditingCodeLanguage(language);
  };

  const handleCancelCodeEdit = () => {
    setEditingCodeBlockId(null);
    setEditingCodeBlockMessageId(null);
    setEditingCodeContent('');
    setEditingCodeLanguage('');
  };

  const handleSaveCodeEdit = async () => {
    if (!editingCodeBlockId || !editingCodeBlockMessageId) return;

    const messageIndex = messages.findIndex(msg => msg.id === editingCodeBlockMessageId);
    if (messageIndex === -1) {
      console.error('Could not find message to save code edit for');
      handleCancelCodeEdit();
      return;
    }

    const message = messages[messageIndex];
    const originalContent = message.parsedAnswer || message.text || '';

    // Find and replace the code block in the markdown
    // We need to find code blocks and replace the one that matches
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let blockIndex = 0;
    const codeBlockLineNumber = parseInt(editingCodeBlockId.split('-code-')[1] || '0');

    let updatedContent = originalContent;
    let match;
    const matches: { start: number; end: number; lang: string; code: string; lineNumber: number }[] = [];

    // Find all code blocks with their positions
    while ((match = codeBlockRegex.exec(originalContent)) !== null) {
      // Calculate approximate line number for this code block
      const textBefore = originalContent.substring(0, match.index);
      const lineNumber = textBefore.split('\n').length;
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        lang: match[1] || 'plaintext',
        code: match[2],
        lineNumber
      });
      blockIndex++;
    }

    // Find the matching code block by line number (closest match)
    let targetBlock = matches.find(m => m.lineNumber === codeBlockLineNumber);
    if (!targetBlock && matches.length > 0) {
      // Fallback: find closest match
      targetBlock = matches.reduce((closest, current) => {
        return Math.abs(current.lineNumber - codeBlockLineNumber) < Math.abs(closest.lineNumber - codeBlockLineNumber)
          ? current
          : closest;
      });
    }

    if (targetBlock) {
      // Rebuild the code block with the new content
      const newCodeBlock = '```' + (editingCodeLanguage || targetBlock.lang) + '\n' + editingCodeContent + '```';
      updatedContent = originalContent.substring(0, targetBlock.start) + newCodeBlock + originalContent.substring(targetBlock.end);
    } else {
      console.error('Could not find code block to update');
      handleCancelCodeEdit();
      return;
    }

    // Update the message
    const updatedMessage: ChatMessage = {
      ...message,
      parsedAnswer: updatedContent,
      text: updatedContent,
    };

    // Update local state
    const updatedMessages = [...messages];
    updatedMessages[messageIndex] = updatedMessage;
    setMessages(updatedMessages);

    // Update conversation history cache
    if (activeConversationId) {
      setConversationHistory(prevHistory =>
        prevHistory.map(convo =>
          convo.id === activeConversationId
            ? { ...convo, messages: updatedMessages }
            : convo
        )
      );

      // Save to database if authenticated
      if (isDbAuthenticated) {
        try {
          await chatService.updateMessage(editingCodeBlockMessageId, {
            content: updatedContent,
          });
          console.log('[Code Block Edit] Message updated in database');
        } catch (error) {
          console.error('[Code Block Edit] Failed to save to database:', error);
        }
      }
    }

    handleCancelCodeEdit();
  };
  // --- End Code Block Edit Handlers ---

  // Rename and modify to open the feedback popup
  const handleOpenFeedbackPopup = (event: React.MouseEvent<HTMLButtonElement>, messageId: string) => {
    // console.log('Like clicked, opening feedback for message:', messageId);
    const rect = event.currentTarget.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const estimatedPopupHeight = 210; // Estimate based on 5 items + padding
    const gap = 5; // Gap between button and popup

    const x = rect.left + window.scrollX;
    let y;
    if (rect.top < viewportHeight / 2) {
      y = rect.bottom + window.scrollY + gap;
    } else {
      y = rect.top + window.scrollY - estimatedPopupHeight - gap;
    }

    setFeedbackPopupInfo({
      messageId,
      position: { x, y },
    });
  };

  const handleLike = (messageId: string) => {
    // Toggle like status
    setFeedbackStatusMap(prev => {
      const currentStatus = prev[messageId];
      const newStatus = currentStatus === 'liked' ? null : 'liked';
      const newMap = { ...prev, [messageId]: newStatus };
      // Persist to localStorage
      try {
        localStorage.setItem('xeno_feedback_status', JSON.stringify(newMap));
      } catch (e) {
        console.error('Failed to save feedback to localStorage:', e);
      }
      return newMap;
    });
  };

  const handleDislike = (messageId: string) => {
    // Toggle dislike status
    setFeedbackStatusMap(prev => {
      const currentStatus = prev[messageId];
      const newStatus = currentStatus === 'disliked' ? null : 'disliked';
      const newMap = { ...prev, [messageId]: newStatus };
      // Persist to localStorage
      try {
        localStorage.setItem('xeno_feedback_status', JSON.stringify(newMap));
      } catch (e) {
        console.error('Failed to save feedback to localStorage:', e);
      }
      return newMap;
    });
  };
  // --- End Feedback Handlers ---

  // --- Placeholder Handlers for User Message Actions ---
  const handleEditUserMessage = (messageId: string, currentText: string) => {
    setEditingMessageId(messageId);
    setEditText(currentText);
    setCopiedMessageId(null); // Ensure copy state is cleared if editing starts
  };

  const handleCopyUserMessage = (textToCopy: string, messageId: string) => {
    if (editingMessageId) return; // Don't allow copy while editing
    navigator.clipboard.writeText(textToCopy).then(() => {
      // console.log('Copied user text to clipboard:', textToCopy); 
      setCopiedMessageId(messageId); // Show confirmation
      setTimeout(() => {
          setCopiedMessageId(null);
      }, 1500);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  };

  const handleSaveEdit = async () => { // Make async
      if (!editingMessageId) return;
      
      const editedIndex = messages.findIndex(msg => msg.id === editingMessageId);
      if (editedIndex === -1) {
          console.error('Could not find message to save edit for');
          setEditingMessageId(null);
          setEditText('');
          return;
      }
      
      const updatedMessage: ChatMessage = { 
          ...messages[editedIndex], 
          text: editText
      };
      
      const truncatedHistory = [...messages.slice(0, editedIndex), updatedMessage];
      
      setMessages(truncatedHistory); // Update state immediately
      
      setEditingMessageId(null); // Clear edit state
      setEditText('');
      
      await fetchAiResponse(truncatedHistory, systemPrompt, selectedModel, undefined, undefined, undefined); // Explicitly pass undefined for task, xenoContext, and xenoSearchInfo
  };

  const handleCancelEdit = () => {
      setEditingMessageId(null);
      setEditText('');
  };
  
  // --- Event Delegation Handlers (Updated for hidden markers) ---
  const hidePopupTimerRef = useRef<NodeJS.Timeout | null>(null); // Ref for the hide timer
  const hoveredElementRef = useRef<HTMLElement | null>(null); // Ref to store the element that triggered the popup

  // Callback to clear the hide timer
  const clearHideTimer = useCallback(() => {
    if (hidePopupTimerRef.current) {
      clearTimeout(hidePopupTimerRef.current);
      hidePopupTimerRef.current = null;
    }
  }, []);

  // Callback to start the hide timer
  const startHideTimer = useCallback(() => {
    clearHideTimer(); // Clear any existing timer first
    hidePopupTimerRef.current = setTimeout(() => {
      if (!isMouseOverSourcePopup.current) {
        setHoveredSource(null);
        hoveredElementRef.current = null; // Clear the hovered element ref
      }
      hidePopupTimerRef.current = null;
    }, 1000); // 1 second delay
  }, [clearHideTimer]);

  // Handler for source hover (from source list in search results)
  const handleSourceHover = useCallback((
    event: React.MouseEvent,
    sourceIdx: number,
    sourceInfo: { uri: string; title: string },
    messageId: string
  ) => {
    clearHideTimer();
    const adjustedPosition = calculateAdjustedPopupPosition(event.clientX, event.clientY);
    setHoveredSource({
      sourceIdx,
      sourceInfo,
      position: adjustedPosition,
      messageId: messageId,
      type: 'search_result'
    });
    fetchSourceMetadata(sourceInfo.uri);
    hoveredElementRef.current = event.currentTarget as HTMLElement;
  }, [fetchSourceMetadata, calculateAdjustedPopupPosition, clearHideTimer]);

  // Handler for source hover end
  const handleSourceHoverEnd = (event: React.MouseEvent<HTMLElement>) => {
    if (sourcePreviewRef.current && sourcePreviewRef.current.contains(event.relatedTarget as Node)) {
      return; // Don't hide if moving to the popup
    }
    // More robust check: if relatedTarget is null (mouse left window) or not part of chatArea, consider hiding
    if (!event.relatedTarget || (chatAreaRef.current && !chatAreaRef.current.contains(event.relatedTarget as Node))) {
          if (!isMouseOverSourcePopup.current) {
            //   setHoveredSource(null); // Potentially hide if mouse leaves chat area entirely and not over popup
          }
      }
  };

  const handleSourcePopupMouseEnter = useCallback(() => {
    isMouseOverSourcePopup.current = true;
    clearHideTimer();
  }, [clearHideTimer]);

  const handleSourcePopupMouseLeave = useCallback(() => {
    isMouseOverSourcePopup.current = false;
    startHideTimer();
  }, [startHideTimer]);

  // Effect for hover previews in the main chat area
  useEffect(() => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;

    const handleMouseOverChatArea = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const highlightElement = target.closest('.source-highlight') as HTMLElement | null;
      const anchorElement = target.closest('a') as HTMLAnchorElement | null;
      let newHoveredSourceInfo: HoveredSourceInfo | null = null;
      let newHoveredElement: HTMLElement | null = null;

      if (highlightElement || anchorElement) {
        clearHideTimer();
        newHoveredElement = highlightElement || anchorElement;
      }

      const offsetX = 15;
      const offsetY = 10;
      const adjustedPosition = calculateAdjustedPopupPosition(event.clientX + offsetX, event.clientY + offsetY);

      if (highlightElement) {
        const markerId = Number(highlightElement.getAttribute('data-marker-id'));
        const messageElement = highlightElement.closest('[data-message-id]') as HTMLElement | null;
        const messageId = messageElement?.dataset.messageId;
        if (markerId && messageId && !isNaN(markerId)) {
          const selectedMessage = messages.find(m => m.id === messageId);
          if (selectedMessage?.uniqueSourcesUsed && selectedMessage?.markerToSourceIndices) {
            const sourceIndices = selectedMessage.markerToSourceIndices.get(markerId);
            if (sourceIndices && sourceIndices.length > 0) {
              const actualSourceIndex = sourceIndices[0];
              const source = selectedMessage.uniqueSourcesUsed.find((s: { index: number; uri: string; title: string }) => s.index === actualSourceIndex);
              if (source) {
                newHoveredSourceInfo = { sourceIdx: actualSourceIndex, sourceInfo: { uri: source.uri, title: source.title }, position: adjustedPosition, messageId: messageId, type: 'marker' };
                fetchSourceMetadata(source.uri);
              }
            }
          }
        }
      } else if (anchorElement) {
        const messageElement = anchorElement.closest('[data-message-id]') as HTMLElement | null;
        const messageId = messageElement?.dataset.messageId;
        const href = anchorElement.getAttribute('href');
        if (messageId && href) {
          const selectedMessage = messages.find(m => m.id === messageId);
          if (selectedMessage?.searchInfo?.sources) {
            const matchedSource = selectedMessage.searchInfo.sources.find(s => s.uri === href);
            if (matchedSource) {
              const sourceIndex = selectedMessage.searchInfo.sources.indexOf(matchedSource);
              newHoveredSourceInfo = { sourceIdx: sourceIndex, sourceInfo: matchedSource, position: adjustedPosition, messageId: messageId, type: 'link' };
              fetchSourceMetadata(matchedSource.uri);
            }
          }
        }
      }

      if (newHoveredSourceInfo) {
        setHoveredSource(newHoveredSourceInfo);
        hoveredElementRef.current = newHoveredElement;
      }
    };

    chatArea.addEventListener('mouseover', handleMouseOverChatArea);

    const handleGeneralMouseOut = (event: MouseEvent) => {
        const relatedTarget = event.relatedTarget as HTMLElement | null;
        if (chatArea && !chatArea.contains(relatedTarget) && !isMouseOverSourcePopup.current) {
            startHideTimer();
        }
    };
    chatArea.addEventListener('mouseout', handleGeneralMouseOut);

    return () => {
      chatArea.removeEventListener('mouseover', handleMouseOverChatArea);
      chatArea.removeEventListener('mouseout', handleGeneralMouseOut);
      clearHideTimer();
    };
  }, [messages, fetchSourceMetadata, calculateAdjustedPopupPosition, clearHideTimer, startHideTimer]);

  // New useEffect to manage mouseout listener on the specific hovered element
  useEffect(() => {
    const currentHoveredEl = hoveredElementRef.current;

    const handleMouseOutOfSpecificElement = (event: MouseEvent) => {
      const relatedTarget = event.relatedTarget as HTMLElement | null;
      if (sourcePreviewRef.current && sourcePreviewRef.current.contains(relatedTarget)) {
        return;
      }
      startHideTimer();
    };

    if (currentHoveredEl) {
      currentHoveredEl.addEventListener('mouseout', handleMouseOutOfSpecificElement);
    }

    return () => {
      if (currentHoveredEl) {
        currentHoveredEl.removeEventListener('mouseout', handleMouseOutOfSpecificElement);
      }
    };
  }, [hoveredElementRef.current, startHideTimer, sourcePreviewRef]);

  // Image Generation Component
  const ImageContainer: React.FC<{ message: ChatMessage }> = ({ message }) => {
    if (!message.isGeneratingImage && !message.imageData) {
      return null;
    }

    // Helper function to get the proper image URL
    const getImageUrl = () => {
      if (!message.imageData) return '';
      
      // Check if imageData is already a complete data URI
      if (message.imageData.startsWith('data:')) {
        // Handle malformed nested data URIs from GPT Image 1
        if (message.imageData.includes('data:image/svg+xml;base64,data:image/png;base64,')) {
          console.warn('⚠️ Detected malformed nested data URI, extracting PNG data...');
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
        setFullScreenImageUrl(imageUrl);
        setIsFullScreenImageOpen(true);
        setViewerShowsDownloadButton(true); // Ensure download button is shown for AI images
      }
    };

    // console.log('Rendering ImageContainer:',
    //   message.isGeneratingImage ? 'Loading animation' : 'Generated image',
    //   'Message ID:', message.id,
    //   'isGeneratingImage:', message.isGeneratingImage,
    //   'has imageData:', !!message.imageData
    //   );

    const containerClassName = `image-container ${message.isGeneratingImage && !message.imageData ? 'loading' : ''}`;

    return (
      <div className={containerClassName}>
        {message.isGeneratingImage && !message.imageData ? (
          <div className="image-generation-loading">
            {/* <div style={{color: 'white', fontSize: '20px', textAlign: 'center', padding: '20px'}}>IMAGE CONTAINER LOADING TEST</div> REMOVED DEBUG TEXT */}
            <div className="dots-grid-container">
              {Array.from({ length: 100 }).map((_, index) => (
                <div key={index} className="pulsing-dot" />
              ))}
            </div>
          </div>
        ) : message.imageData ? (
          <img
            src={getImageUrl()}
            alt="AI generated image"
            className="generated-image cursor-pointer"
            onClick={handleImageClick}
          />
        ) : null}
      </div>
    );
  };
  
  // --- Define handlers and preview component INSIDE ChatWithLLM ---
  const handleIndicatorMouseEnter = (
    event: React.MouseEvent<HTMLSpanElement>,
    nodeKey: string,
    sourcesForNode: { index: number; uri: string; title: string }[]
  ) => {
    const x = event.clientX + 15;
    const y = event.clientY + 10;
    // console.log(`Indicator Hover: nodeKey=${nodeKey}`);
    // console.log(`  Raw Mouse Coords (clientX, clientY): ${event.clientX}, ${event.clientY}`);
    // console.log(`  Calculated Popup Coords (x, y): ${x}, ${y}`);
    setHoveredIndicatorInfo({
      nodeKey,
      sources: sourcesForNode,
      position: { x, y }
    });
  };

  const handleIndicatorMouseLeave = () => {
    setTimeout(() => {
      if (!isMouseOverIndicatorPopup.current) {
        setHoveredIndicatorInfo(null);
        if (!hoveredSource) {
          setSourcePreviewData(null);
        }
      }
    }, 50);
  };

  const handleIndicatorPopupMouseEnter = () => {
    isMouseOverIndicatorPopup.current = true;
  };
  const handleIndicatorPopupMouseLeave = () => {
    isMouseOverIndicatorPopup.current = false;
    setHoveredIndicatorInfo(null);
  };

  // Handler for showing the model info tooltip
  const handleShowModelInfo = (
    event: React.MouseEvent<HTMLButtonElement>,
    messageId: string,
    modelId: string,
    tokenCount: number | undefined // NEW: Add tokenCount
  ) => {
    if (modelTooltipInfo?.messageId === messageId) {
      setModelTooltipInfo(null);
    } else {
      const rect = event.currentTarget.getBoundingClientRect();
      // Position to the right of the button, slightly above its vertical center
      const x = rect.right + window.scrollX + 8; // 8px to the right
      const y = rect.top + window.scrollY + (rect.height / 2) - 15; // Adjusted Y for slight upward shift

      setModelTooltipInfo({
        messageId,
        modelId,
        tokenCount, // Pass tokenCount
        position: { x, y },
      });
    }
  };

  // Component to render Xeno Search results - COMMENTED OUT
  /*
  const XenoSearchResultsDisplay: React.FC<{results: XenoSearchResultsData}> = ({ results }) => {
    if (!results || (results.error && !results.sources && !results.summary)) return null;

    const hasValidSources = results.sources && results.sources.length > 0;
    const sourceCount = hasValidSources ? results.sources!.length : 0;
    const displayedSources = isXenoResultsExpanded ? 
      (results.sources || []) : 
      (results.sources?.slice(0, 2) || []);

    return (
      <div className="xeno-search-results w-full p-4 my-3 rounded-lg transition-all duration-300 ease-in-out">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center text-blue-400 font-medium">
            <div className="flex-shrink-0 w-6 h-6 bg-blue-500/10 mr-2 rounded-full flex items-center justify-center">
              <Globe size={14} className="text-blue-400" />
            </div>
            <span>Xeno Web Search</span>
            {sourceCount > 0 && (
              <span className="ml-2 px-1.5 py-0.5 bg-blue-900/20 text-blue-400 text-xs rounded-full">
                {sourceCount} {sourceCount === 1 ? 'source' : 'sources'}
              </span>
            )}
          </div>
          <button 
            onClick={() => setIsXenoResultsExpanded(!isXenoResultsExpanded)}
            className="p-1 text-gray-400 hover:text-white transition-colors"
            aria-label={isXenoResultsExpanded ? "Collapse search results" : "Expand search results"}
          >
            {isXenoResultsExpanded ? (
              <ChevronUp size={16} />
            ) : (
              <ChevronDown size={16} />
            )}
          </button>
        </div>
        
        {results.summary && isXenoResultsExpanded && (
          <div className="mb-3 px-3 py-2 bg-[#111113] rounded-md border border-[#1e1e21]">
            <p className="text-xs text-gray-300 italic">{results.summary}</p>
          </div>
        )}
        
        {hasValidSources && (
          <div>
            {!isXenoResultsExpanded && (
              <div className="text-xs font-medium mb-2 text-gray-400 flex items-center justify-between">
                <span>Web Sources:</span>
                {sourceCount > 2 && (
                  <span className="text-gray-500 text-xs">
                    +{sourceCount - 2} more
                  </span>
                )}
              </div>
            )}
            <div className="space-y-2">
              {displayedSources.map((source, index) => (
                <div key={index}>
                  <XenoSourcePreview 
                    source={source} 
                    index={index} 
                    isExpanded={isXenoResultsExpanded} 
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        
        {results.error && !results.sources && !results.summary && (
          <div className="px-4 py-3 bg-red-900/20 rounded-md border border-red-800/30">
            <p className="text-xs text-red-400 flex items-center">
              <X size={12} className="mr-1 flex-shrink-0" />
              Error: {results.error}
            </p>
          </div>
        )}

        {hasValidSources && sourceCount > 2 && !isXenoResultsExpanded && (
          <button
            onClick={() => setIsXenoResultsExpanded(true)}
            className="w-full mt-3 text-center py-1.5 text-xs text-gray-400 hover:text-white hover:bg-[#1e1e21] rounded-md transition-colors border border-gray-700/30"
          >
            Show all {sourceCount} sources
          </button>
        )}
        
        {isXenoResultsExpanded && (
          <button
            onClick={() => setIsXenoResultsExpanded(false)}
            className="w-full mt-3 text-center py-1.5 text-xs text-gray-400 hover:text-white hover:bg-[#1e1e21] rounded-md transition-colors border border-gray-700/30"
          >
            Show less
          </button>
        )}
      </div>
    );
  };
  */
  
  const IndicatorPreviewPopup = () => {
    if (!hoveredIndicatorInfo) return null;
    // console.log(`Popup Rendering: Using position`, hoveredIndicatorInfo.position);
    const popupStyle: React.CSSProperties = {
      position: 'absolute',
      left: 0,
      top: 0,
      transform: `translate3d(${hoveredIndicatorInfo.position.x}px, ${hoveredIndicatorInfo.position.y}px, 0)`,
      willChange: 'transform',
      zIndex: 9999,
      width: '300px',
      backgroundColor: '#111113',
      border: '1px solid #1e1e21',
      borderRadius: '8px',
      boxShadow: '0 5px 15px rgba(0, 0, 0, 0.5)',
      color: 'white',
      fontSize: '0.8rem',
      pointerEvents: 'auto',
      opacity: 1,
      transition: 'opacity 0.1s ease',
      isolation: 'isolate',
      backfaceVisibility: 'hidden',
      contain: 'layout',
    };
    
    return (
      <div 
        ref={indicatorPreviewRef} 
        style={popupStyle} 
        className="indicator-preview-popup"
        onMouseEnter={handleIndicatorPopupMouseEnter}
        onMouseLeave={handleIndicatorPopupMouseLeave}
      >
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #1e1e21', fontWeight: 500 }}>
          Sources for this section
        </div>
        <ul style={{ listStyle: 'none', padding: '8px 10px', margin: 0, maxHeight: '150px', overflowY: 'auto' }}>
          {hoveredIndicatorInfo.sources.map((source, idx: number) => (
            <li key={source.index} style={{ marginBottom: idx < hoveredIndicatorInfo.sources.length - 1 ? '5px' : '0' }}>
              <a
                href={source.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 hover:underline"
                title={source.uri}
                style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                 [{source.index + 1}] {source.title || new URL(source.uri).hostname}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  // --- End definitions inside ChatWithLLM ---
  
  // --- Tooltip Component --- 
  const ModelInfoTooltip = () => {
    if (!modelTooltipInfo) return null;

    const mainContainerStyle: React.CSSProperties = {
      position: 'absolute', 
      left: `${modelTooltipInfo.position.x}px`,
      top: `${modelTooltipInfo.position.y}px`,
      zIndex: 100,
      display: 'flex',
      flexDirection: 'row', // Changed to row for side-by-side layout
      gap: '4px', // Space between the two containers
    };

    const individualContainerStyle: React.CSSProperties = {
      background: 'rgba(51, 51, 51, 0.9)',
      color: 'white',
      padding: '4px 8px', // Slightly reduced padding for individual boxes
      borderRadius: '4px',
      fontSize: '0.75rem', // Slightly smaller font
      boxShadow: '0 2px 5px rgba(0,0,0,0.5)',
      whiteSpace: 'nowrap',
    };

    const modelName = findModelById(groupedModels, modelTooltipInfo.modelId)?.name || modelTooltipInfo.modelId;

    return (
      <div ref={modelTooltipRef} style={mainContainerStyle}>
        <div style={individualContainerStyle}>Model: {modelName}</div>
        {modelTooltipInfo.tokenCount !== undefined && (
          <div style={individualContainerStyle}>Tokens: {modelTooltipInfo.tokenCount}</div>
        )}
      </div>
    );
  };
  
  // --- Feedback Popup Component --- 
  const FeedbackPopup = () => {
    if (!feedbackPopupInfo) return null;

    const { messageId, position } = feedbackPopupInfo;

    const handleFeedbackSubmit = (feedbackType: string) => {
      setFeedbackStatusMap(prev => {
        const newMap = { ...prev, [messageId]: 'liked' as const };
        try {
          localStorage.setItem('xeno_feedback_status', JSON.stringify(newMap));
        } catch (e) {
          console.error('Failed to save feedback to localStorage:', e);
        }
        return newMap;
      });
      setFeedbackPopupInfo(null);
    };

    const feedbackOptions = [
      { label: 'Helpful answer', icon: ThumbsUp, type: 'helpful' },
      { label: 'Well-written response', icon: Feather, type: 'well-written' },
      { label: 'Accurate information', icon: Target, type: 'accurate' },
      { label: 'Funny response', icon: Smile, type: 'funny' },
      { label: 'Good use of memory', icon: BrainCircuit, type: 'memory' },
    ];

    const popupStyle: React.CSSProperties = {
      position: 'absolute',
      left: `${position.x}px`,
      top: `${position.y}px`,
      zIndex: 100,
      width: '220px',
      background: '#1a1a1d',
      color: '#e4e4e7',
      borderRadius: '12px',
      boxShadow: '0 5px 15px rgba(0,0,0,0.4)',
      overflow: 'hidden',
    };

    return (
      <div ref={feedbackPopupRef} style={popupStyle}>
        <ul className="p-2 space-y-1">
          {feedbackOptions.map((option) => (
            <li key={option.type}>
              <button
                onClick={() => handleFeedbackSubmit(option.type)}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md text-left transition-colors hover:bg-[#2a2a2d]"
              >
                <option.icon size={16} className="text-gray-400" />
                <span>{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  
  // --- Dislike Feedback Popup Component --- 
  const DislikeFeedbackPopup = () => {
    if (!dislikePopupInfo) return null;

    const { messageId, position } = dislikePopupInfo;

    const handleDislikeFeedbackSubmit = (feedbackType: string) => {
      setFeedbackStatusMap(prev => {
        const newMap = { ...prev, [messageId]: 'disliked' as const };
        try {
          localStorage.setItem('xeno_feedback_status', JSON.stringify(newMap));
        } catch (e) {
          console.error('Failed to save feedback to localStorage:', e);
        }
        return newMap;
      });
      setDislikePopupInfo(null);
    };

    const dislikeOptions = [
      { label: 'Wanted something else', icon: ThumbsDown, type: 'wanted-else' },
      { label: 'Incorrect answer', icon: MessageSquareX, type: 'incorrect' }, 
      { label: 'Biased answer', icon: Quote, type: 'biased' }, 
      { label: 'Wanted image', icon: Image, type: 'wanted-image' },
      { label: 'Bad style / tone', icon: WandSparkles, type: 'bad-style' }, 
      { label: 'Wanted to search', icon: Search, type: 'wanted-search' },
      { label: 'Incorrect memory', icon: FileX, type: 'incorrect-memory' }, 
    ];

    const popupStyle: React.CSSProperties = {
      position: 'absolute',
      left: `${position.x}px`,
      top: `${position.y}px`,
      zIndex: 100,
      width: '220px',
      background: '#1a1a1d',
      color: '#e4e4e7',
      borderRadius: '12px',
      boxShadow: '0 5px 15px rgba(0,0,0,0.4)',
      overflow: 'hidden',
    };

    return (
      <div ref={dislikePopupRef} style={popupStyle}>
        <ul className="p-2 space-y-1">
          {dislikeOptions.map((option) => (
            <li key={option.type}>
              <button
                onClick={() => handleDislikeFeedbackSubmit(option.type)}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md text-left transition-colors hover:bg-[#2a2a2d]"
              >
                <option.icon size={16} className="text-gray-400" />
                <span>{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  
  // Handler for opening the DISLIKE feedback popup
  const handleOpenDislikePopup = (event: React.MouseEvent<HTMLButtonElement>, messageId: string) => {
    // console.log('Dislike clicked, opening feedback for message:', messageId);
    const rect = event.currentTarget.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const estimatedPopupHeight = 260; // Estimate based on 7 items + padding
    const gap = 5; 

    const x = rect.left + window.scrollX;
    let y;
    if (rect.top < viewportHeight / 2) {
      y = rect.bottom + window.scrollY + gap;
    } else {
      y = rect.top + window.scrollY - estimatedPopupHeight - gap;
    }

    setDislikePopupInfo({ // Set state for dislike popup
      messageId,
      position: { x, y },
    });
  };
  
  // Function to smoothly scroll to bottom
  const scrollToBottom = () => {
    chatAreaRef.current?.scrollTo({
      top: chatAreaRef.current.scrollHeight,
      behavior: 'smooth',
    });
  };

  // Auto-scroll to bottom when messages change or during loading
  useEffect(() => {
    // Small delay to ensure DOM has updated
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 50);
    return () => clearTimeout(timer);
  }, [messages, isLoading]);

  // Effect for scroll detection
  useEffect(() => {
    const chatArea = chatAreaRef.current;

    const handleScroll = () => {
      if (!chatArea) return;
      const { scrollTop, scrollHeight, clientHeight } = chatArea;
      const threshold = 200;
      const shouldBeVisible = scrollHeight - scrollTop > clientHeight + threshold;

      if (shouldBeVisible !== showScrollToBottom) {
        // console.log(`Scroll button should be visible: ${shouldBeVisible}`);
        setShowScrollToBottom(shouldBeVisible);
      }
    };

    if (chatArea) {
      chatArea.addEventListener('scroll', handleScroll);
      handleScroll(); // Initial check
    }

    return () => {
      if (chatArea) {
        chatArea.removeEventListener('scroll', handleScroll);
      }
    };
  }, [showScrollToBottom]);
  
  // --- NEW: Function to Delete a Conversation from History ---
  const handleDeleteConversation = async (conversationIdToDelete: string) => {
    // console.log("Attempting to delete conversation:", conversationIdToDelete);

    // Delete from database if authenticated
    if (isDbAuthenticated) {
      try {
        await chatService.deleteConversation(conversationIdToDelete);
        console.log("Deleted conversation from database:", conversationIdToDelete);
      } catch (error) {
        console.error("Error deleting conversation from database:", error);
      }
    }

    const updatedHistory = conversationHistory.filter(convo => convo.id !== conversationIdToDelete);
    setConversationHistory(updatedHistory);

    if (activeConversationId === conversationIdToDelete) {
        // console.log("Active conversation deleted. Resetting chat view.");
        handleNewChat();
    }

    if (updatedHistory.length === 0) {
        setActiveConversationId(null);
    }
  };
  // --- END NEW ---

  // --- NEW: Handler to Cancel Deletion ---
  const handleCancelDelete = () => {
      setDeleteConfirmationModal({ isOpen: false, conversationId: null, conversationTitle: null });
  };
  // --- END NEW ---

  // --- NEW: Function to Save Edited Conversation Title ---
  const handleSaveConversationTitle = async () => {
      if (!editingConversationId || !editTitleText.trim()) {
          setEditingConversationId(null);
          setEditTitleText('');
          return;
      }
      // console.log("Saving title for:", editingConversationId, "New title:", editTitleText);

      // Update in database if authenticated
      if (isDbAuthenticated) {
        try {
          await chatService.updateConversation(editingConversationId, {
            title: editTitleText.trim(),
          });
        } catch (error) {
          console.error("Error updating conversation title in database:", error);
        }
      }

      setConversationHistory(prevHistory =>
          prevHistory.map(convo =>
              convo.id === editingConversationId
                  ? { ...convo, title: editTitleText.trim(), timestamp: Date.now() }
                  : convo
          )
      );
      setEditingConversationId(null);
      setEditTitleText('');
  };
  // --- END NEW ---

  // --- NEW: Handler functions for Code Block Execution (to be passed as props) ---
  const handleCodeBlockRun = async (codeBlockId: string, language: string, code: string, availableRuntimes: PistonRuntime[]) => {
    // console.log(`[ChatWithLLM] handleCodeBlockRun for ID: ${codeBlockId}, Lang: ${language}`);

    setCodeBlockExecutionStates(prev => ({
      ...prev,
      [codeBlockId]: { isRunning: true, output: null, error: null }
    }));

    const matchingRuntimes = availableRuntimes.filter(rt =>
      rt.language === language || rt.aliases.includes(language)
    );

    if (matchingRuntimes.length === 0) {
      console.error(`[ChatWithLLM] No Piston runtime for ${language} for block ${codeBlockId}`);
    setCodeBlockExecutionStates(prev => ({
      ...prev,
        [codeBlockId]: { isRunning: false, output: null, error: `Execution environment not found for language: ${language}` }
    }));
      return;
    }
    const runtimeToUse = matchingRuntimes[0];

    try {
      const response = await fetch('/api/piston/execute', {
        method: 'POST',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          language: runtimeToUse.language,
          version: runtimeToUse.version,
          files: [{ content: code }],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `Request failed with status ${response.status}` }));
        throw new Error(errorData.message || 'Execution request failed');
      }
      const result = await response.json();

      if (result.run && (result.run.stdout || result.run.stderr)) {
        setCodeBlockExecutionStates(prev => ({
          ...prev,
          [codeBlockId]: { isRunning: false, output: result.run.stdout || null, error: result.run.stderr || null }
        }));
      } else if (result.compile && (result.compile.stdout || result.compile.stderr)) {
        setCodeBlockExecutionStates(prev => ({
          ...prev,
          [codeBlockId]: { isRunning: false, output: result.compile.stdout || null, error: `Compile Error:\n${result.compile.stderr || 'Unknown compile error'}` }
        }));
      } else {
        throw new Error(result.message || 'Unknown error during execution');
      }
    } catch (error: any) {
      console.error(`[ChatWithLLM] Failed to execute code for block ${codeBlockId}:`, error);
      setCodeBlockExecutionStates(prev => ({
        ...prev,
        [codeBlockId]: { isRunning: false, output: null, error: `Execution failed: ${error.message || 'Unknown error'}` }
      }));
    }
  };

  const handleCodeBlockCloseOutput = (codeBlockId: string) => {
    // console.log(`[ChatWithLLM] Closing output for ID: ${codeBlockId}`);
    setCodeBlockExecutionStates(prev => ({
      ...prev,
      [codeBlockId]: { ...(prev[codeBlockId] || { isRunning: false, output: null, error: null }), output: null, error: null }
    }));
  };
  // --- END NEW HANDLER FUNCTIONS ---

  // --- NEW: Full-screen Image Viewer Component ---
  const FullScreenImageViewer: React.FC<{
    imageUrl: string | null;
    isOpen: boolean;
    onClose: () => void;
    showDownloadButton?: boolean;
  }> = ({ imageUrl, isOpen, onClose, showDownloadButton }) => {
    if (!isOpen || !imageUrl) return null;

    return (
      <div
        className="absolute inset-0 z-[1000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 image-viewer-overlay"
        onClick={onClose}
      >
        <div className="group absolute top-4 right-4 z-[1001] w-16 h-16 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 ease-in-out -z-10"></div>
          { (showDownloadButton === undefined || showDownloadButton === true) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const link = document.createElement('a');
                link.href = imageUrl;
                link.download = `generated-image-${Date.now()}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
              className="relative z-10 p-2 rounded-md text-white hover:bg-white/10 active:scale-95 transition-all duration-150 ease-in-out"
              title="Download Image"
            >
              <Download size={20} />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="relative z-10 p-2 ml-1 rounded-md text-white hover:bg-white/10 active:scale-95 transition-all duration-150 ease-in-out"
            title="Close Fullscreen"
          >
            <X size={24} />
          </button>
        </div>
        <div
          className="relative max-w-full max-h-full flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={imageUrl}
            alt="Fullscreen AI generated image"
            className="block max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
          />
        </div>
      </div>
    );
  };
  // --- END Full-screen Image Viewer Component ---

  // Function to show file in context panel
  const handleShowFileInContextPanel = (fileData: AttachedFile | { name: string, type: string, content: string, encoding: 'base64' | 'text' }) => {
    // Disable context panel in multi-interface mode
    if (isMultiInterface) {
      console.log('[Context Panel] Disabled in multi-interface mode');
      return;
    }
    console.log('[Context Panel] handleShowFileInContextPanel called with:', fileData);
    
    if ('fileObject' in fileData && fileData.fileObject) {
      // Handling live AttachedFile
      const file = fileData as AttachedFile;
      console.log('[Context Panel] Processing live file:', file.name, 'Type:', file.type);
      
      if (!file.fileObject) {
        console.warn('[Context Panel] File object is missing');
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          let language = 'plaintext';
          if (file.name.endsWith('.html') || file.name.endsWith('.htm')) language = 'html';
          else if (file.name.endsWith('.js')) language = 'javascript';
          else if (file.name.endsWith('.jsx')) language = 'jsx';
          else if (file.name.endsWith('.ts')) language = 'typescript';
          else if (file.name.endsWith('.tsx')) language = 'tsx';
          else if (file.name.endsWith('.css')) language = 'css';
          else if (file.name.endsWith('.json')) language = 'json';
          else if (file.name.endsWith('.py')) language = 'python';
          else if (file.name.endsWith('.md')) language = 'markdown';
          // Add more language detections as needed

          console.log('[Context Panel] Setting content for file:', file.name, 'Language:', language);
          setContextPanelContent({
            type: 'file',
            title: file.name,
            content: e.target.result as string,
            language
          });
          setIsContextPanelOpen(true);
          console.log('[Context Panel] Panel should now be open');
        } else {
          console.error('[Context Panel] FileReader result is empty');
        }
      };
      
      reader.onerror = (error) => {
        console.error('[Context Panel] Error reading file:', error);
      };
      
      reader.readAsText(file.fileObject);
    } else {
      // Handling serialized file data from history
      console.log('[Context Panel] Processing serialized file data');
      const serializedFile = fileData as { name: string, type: string, content: string, encoding: 'base64' | 'text' };
      let displayContent = `File: ${serializedFile.name}\nType: ${serializedFile.type}\n\n`;
      let language = 'plaintext';

      if (serializedFile.encoding === 'text') {
        displayContent = serializedFile.content;
        // Determine language for syntax highlighting from name/type
        if (serializedFile.name.endsWith('.html') || serializedFile.name.endsWith('.htm')) language = 'html';
        else if (serializedFile.name.endsWith('.js')) language = 'javascript';
        else if (serializedFile.name.endsWith('.jsx')) language = 'jsx';
        else if (serializedFile.name.endsWith('.ts')) language = 'typescript';
        else if (serializedFile.name.endsWith('.tsx')) language = 'tsx';
        else if (serializedFile.name.endsWith('.css')) language = 'css';
        else if (serializedFile.name.endsWith('.json')) language = 'json';
        else if (serializedFile.name.endsWith('.py')) language = 'python';
        else if (serializedFile.name.endsWith('.md')) language = 'markdown';
        // Add more language detections as needed

      } else if (serializedFile.encoding === 'base64') {
        if (serializedFile.type === 'application/pdf') {
          displayContent += 'This is a PDF file. Content preview is not available for historic PDFs in the context panel.';
        } else {
          displayContent += 'Content is stored in binary (base64) format and cannot be directly previewed as text here.';
        }
      }

      console.log('[Context Panel] Setting content for serialized file:', serializedFile.name, 'Language:', language);
      setContextPanelContent({
        type: 'file',
        title: serializedFile.name,
        content: displayContent,
        language: language
      });
      setIsContextPanelOpen(true);
      console.log('[Context Panel] Panel should now be open');
    }
  };

  // Context Panel Component - Matching Word Interface Style
  const ContextPanel = () => {
    if (!contextPanelContent) return null;

    const codeStyle: React.CSSProperties = {
      whiteSpace: contextPanelWrapEnabled ? 'pre-wrap' : 'pre',
      wordBreak: contextPanelWrapEnabled ? 'break-all' : 'normal',
    };

    const handleStartEdit = () => {
      setEditedContextContent(contextPanelContent.content);
      setIsEditingContextPanel(true);
    };

    const handleSaveEdit = () => {
      if (contextPanelContent) {
        setContextPanelContent({
          ...contextPanelContent,
          content: editedContextContent
        });
      }
      setIsEditingContextPanel(false);
      // Show success feedback
      setContextPanelSaveSuccess(true);
      setTimeout(() => setContextPanelSaveSuccess(false), 1500);
    };

    const handleCancelEdit = () => {
      setIsEditingContextPanel(false);
      setEditedContextContent('');
    };

    const handleCopyContent = async () => {
      try {
        await navigator.clipboard.writeText(isEditingContextPanel ? editedContextContent : contextPanelContent.content);
        // Show success feedback
        setContextPanelCopySuccess(true);
        setTimeout(() => setContextPanelCopySuccess(false), 1500);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    };

    return (
      <div
        className={`context-panel ${isContextPanelOpen ? 'visible' : ''}`}
        style={{ width: `${contextPanelWidth}px` }}
      >
        <div className="context-panel-drag-handle" onMouseDown={handleMouseDownOnDragHandle} />

        {/* Header */}
        <div className="context-panel-header">
          <div className="context-panel-title">
            <FileText size={14} className="flex-shrink-0 opacity-60" />
            <span className="truncate">{contextPanelContent.title}</span>
          </div>
          <div className="context-panel-actions">
            {/* Edit / Save / Cancel buttons */}
            {isEditingContextPanel ? (
              <>
                <button
                  className={`context-panel-btn ${contextPanelSaveSuccess ? 'success' : ''}`}
                  onClick={handleSaveEdit}
                  title="Save changes"
                >
                  <Check size={14} className="mr-1.5" style={{ transition: 'transform 0.2s ease' }} />
                  <span>{contextPanelSaveSuccess ? 'Saved!' : 'Save'}</span>
                </button>
                <button
                  className="context-panel-btn-icon close"
                  onClick={handleCancelEdit}
                  title="Cancel editing"
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <button
                  className={`context-panel-btn ${contextPanelSaveSuccess ? 'success' : ''}`}
                  onClick={handleStartEdit}
                  title="Edit content"
                >
                  {contextPanelSaveSuccess ? (
                    <Check size={14} className="mr-1.5" />
                  ) : (
                    <Pencil size={14} className="mr-1.5" />
                  )}
                  <span>{contextPanelSaveSuccess ? 'Saved!' : 'Edit'}</span>
                </button>
                <button
                  className={`context-panel-btn-icon ${contextPanelCopySuccess ? 'success' : ''}`}
                  onClick={handleCopyContent}
                  title={contextPanelCopySuccess ? "Copied!" : "Copy content"}
                >
                  {contextPanelCopySuccess ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  className={`context-panel-btn-icon ${contextPanelWrapEnabled ? 'active' : ''}`}
                  onClick={() => setContextPanelWrapEnabled(!contextPanelWrapEnabled)}
                  title={contextPanelWrapEnabled ? "Disable text wrapping" : "Enable text wrapping"}
                >
                  <WrapText size={14} />
                </button>
              </>
            )}
            <button
              className="context-panel-btn-icon close"
              onClick={() => {
                setIsContextPanelOpen(false);
                setIsEditingContextPanel(false);
              }}
              title="Close panel"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="context-panel-content">
          {isEditingContextPanel ? (
            <textarea
              className="context-panel-edit-area"
              value={editedContextContent}
              onChange={(e) => setEditedContextContent(e.target.value)}
              autoFocus
            />
          ) : (
            contextPanelContent.type === 'file' || contextPanelContent.type === 'code' ? (
              <pre>
                <code style={codeStyle}>{contextPanelContent.content}</code>
              </pre>
            ) : (
              <div className="text-sm text-gray-300 p-4" style={codeStyle}>
                {contextPanelContent.content}
              </div>
            )
          )}
        </div>
      </div>
    );
  };

  const MIN_PANEL_WIDTH = 200;
  const MAX_PANEL_WIDTH = 800;

  const handleMouseDownOnDragHandle = (e: React.MouseEvent) => {
    isResizingContextPanel.current = true;
    initialMouseX.current = e.clientX;
    initialPanelWidth.current = contextPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizingContextPanel.current) return;
    const deltaX = e.clientX - initialMouseX.current;
    let newWidth = initialPanelWidth.current - deltaX;

    if (newWidth < MIN_PANEL_WIDTH) newWidth = MIN_PANEL_WIDTH;
    if (newWidth > MAX_PANEL_WIDTH) newWidth = MAX_PANEL_WIDTH;

    setContextPanelWidth(newWidth);
  };

  const handleMouseUp = () => {
    isResizingContextPanel.current = false;
    document.body.style.cursor = 'default';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };

  // Cleanup effect for hover timeout
  useEffect(() => {
    return () => {
      if (hoverEndTimeoutRef.current) {
        clearTimeout(hoverEndTimeoutRef.current);
      }
    };
  }, []);

  // Vision/file support is now determined dynamically by modelSupportsVision(selectedModel)
  // based on the model's inputModalities from the API

  // Helper function to convert a File object to a base64 string
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  // --- NEW: Helper to check for common text file types ---
  const isCommonTextFile = (file: File): boolean => {
    if (file.type.startsWith('text/')) return true;
    const commonTextExtensions = [
      '.md', '.json', '.csv', '.xml', '.html', '.htm', '.css',
      '.js', '.jsx', '.ts', '.tsx',
      '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.php',
      '.rb', '.go', '.swift', '.kt', '.rs',
      '.sh', '.bat', '.ps1',
      '.toml', '.yaml', '.yml', '.ini', '.log',
      '.sql', '.r', '.tex'
    ];
    return commonTextExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
  };

  // --- NEW: Function to prepare conversation history for localStorage ---
  const prepareHistoryForStorage = async (history: Conversation[]): Promise<Conversation[]> => {
    const serializableHistory = JSON.parse(JSON.stringify(history)); // Deep copy

    for (const conversation of serializableHistory) {
      for (const message of conversation.messages) {
        // Serialize image attachments
        if (message.userImageAttachment && message.userImageAttachment.file instanceof File) {
            try {
                const liveFileObject = message.userImageAttachment.file;
                const base64Url = await fileToBase64(liveFileObject);
                const base64Data = base64Url.split(',')[1];
                message.userImageAttachment = { // Replace file with serializable data
                    name: liveFileObject.name,
                    type: liveFileObject.type,
                    base64Data: base64Data, // Store base64 data
                };
                delete message.userImageAttachment.file; // Remove the File object
            } catch (error) {
                console.error("Error serializing image attachment for history:", error);
                delete message.userImageAttachment; // Remove problematic attachment
            }
        } else if (message.userImageAttachment && message.userImageAttachment.file) {
            // If file is not an instance of File (might already be processed/corrupted), log and remove
             console.warn("Found non-File object in userImageAttachment.file during serialization, removing:", message.userImageAttachment);
            delete message.userImageAttachment;
        }

        // Serialize file attachments
        if (message.userFileAttachment && message.userFileAttachment.file instanceof File) {
            try {
                const liveFileObject = message.userFileAttachment.file;
                if (isCommonTextFile(liveFileObject)) {
                    const textContent = await liveFileObject.text();
                    message.userFileAttachment = { // Replace file with serializable data
                        name: liveFileObject.name,
                        type: liveFileObject.type,
                        content: textContent,
                        encoding: 'text',
                    };
                } else {
                    const base64Url = await fileToBase64(liveFileObject);
                    const base64Data = base64Url.split(',')[1];
                    message.userFileAttachment = { // Replace file with serializable data
                        name: liveFileObject.name,
                        type: liveFileObject.type,
                        content: base64Data,
                        encoding: 'base64',
                    };
                }
                delete message.userFileAttachment.file; // Remove the File object
            } catch (error) {
                console.error("Error serializing file attachment for history:", error);
                delete message.userFileAttachment; // Remove problematic attachment
            }
        } else if (message.userFileAttachment && message.userFileAttachment.file) {
             // If file is not an instance of File, log and remove
            console.warn("Found non-File object in userFileAttachment.file during serialization, removing:", message.userFileAttachment);
            delete message.userFileAttachment;
        }

        // <<< ADDED: Remove AI-generated image data before saving to localStorage >>>
        if (message.imageData) {
          // console.log(`[LocalStoragePrep] Removing imageData for message ID ${message.id} to save space.`);
          delete message.imageData;
        }
        
        // Clean up temporary UI-only flags that shouldn't be persisted
        if (message.isXenoSearchCancelled !== undefined) {
          // Keep the flag for proper restoration of cancelled state
        }
        // <<< END ADDED SECTION >>>
      }
    }
    return serializableHistory;
  };
  


  // New state for Xeno SearchInfo
  const [pendingXenoSearchInfo, setPendingXenoSearchInfo] = useState<ChatMessage['searchInfo'] | null>(null);

  // Helper function to extract information from image attachments using vision models
  const extractImageInformation = async (imageFile: File): Promise<string> => {
    try {
      console.log(`[Multimodal Search] Extracting information from image: ${imageFile.name}`);
      
      // Convert image to base64 for API call
      const base64Image = await fileToBase64(imageFile);
      const base64Data = base64Image.split(',')[1];
      
      // Use a vision-capable model to describe the image
      const allModels = getAllModels(groupedModels);
      const visionModel = allModels.find(m =>
        m.id === 'openai/gpt-4o-2024-11-20' ||
        m.id === 'anthropic/claude-3.5-sonnet:beta' ||
        m.id === 'google/gemini-2.5-flash-preview-05-20'
      ) || selectedModel;
      
      const visionResponse = await fetch('/api/chat/generate', {
        method: 'POST',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          messages: [{
            role: 'user',
            parts: [
              { 
                type: 'text', 
                text: 'Analyze this image and provide a detailed description including: objects, people, text, activities, location/setting, colors, and any other relevant details that would be useful for web searching. Be concise but comprehensive.' 
              },
              { 
                type: 'image', 
                media_type: imageFile.type, 
                data: base64Data 
              }
            ]
          }],
          selectedModelId: visionModel.id,
          effectiveReasoningState: false,
          task: 'extract_image_info'
        })
      });
      
      if (!visionResponse.ok) {
        throw new Error(`Vision API failed: ${visionResponse.status}`);
      }
      
      const result = await visionResponse.json();
      const description = result.text || result.answer || 'Unable to analyze image';
      
      console.log(`[Multimodal Search] Image analysis complete: ${description.substring(0, 100)}...`);
      return description;
      
    } catch (error) {
      console.error(`[Multimodal Search] Error analyzing image ${imageFile.name}:`, error);
      return `Image file: ${imageFile.name} (analysis unavailable)`;
    }
  };

  // Helper function to extract information from file attachments
  const extractFileInformation = async (fileAttachment: AttachedFile): Promise<string> => {
    try {
      console.log(`[Multimodal Search] Extracting information from file: ${fileAttachment.name}`);
      
      if (!fileAttachment.fileObject) {
        return `File: ${fileAttachment.name} (content unavailable)`;
      }
      
      const file = fileAttachment.fileObject;
      
      // Handle text files
      if (isCommonTextFile(file)) {
        const textContent = await file.text();
        const truncatedContent = textContent.length > 2000 
          ? textContent.substring(0, 2000) + '...[content truncated]'
          : textContent;
        return `File: ${file.name}\nContent:\n${truncatedContent}`;
      }
      
      // Handle other file types with metadata
      const fileInfo = {
        name: file.name,
        type: file.type,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        lastModified: new Date(file.lastModified).toLocaleDateString()
      };
      
      return `File: ${fileInfo.name} (${fileInfo.type}, ${fileInfo.size}, modified: ${fileInfo.lastModified})`;
      
    } catch (error) {
      console.error(`[Multimodal Search] Error processing file ${fileAttachment.name}:`, error);
      return `File: ${fileAttachment.name} (processing error)`;
    }
  };

  // Enhanced function to generate search query from multimodal input
  const generateEnhancedSearchQuery = async (
    userText: string,
    imageFile?: File,
    fileAttachment?: AttachedFile
  ): Promise<{ query: string; context: string }> => {
    // Declare these at function scope so they're available in catch block
    let contextParts: string[] = [];
    let searchableInfo: string[] = [];
    
    try {
      console.log('[Multimodal Search] Generating enhanced search query...');
      
      // Add user text
      if (userText.trim()) {
        contextParts.push(`User Query: ${userText}`);
        searchableInfo.push(userText);
      }
      
      // Extract image information if present
      if (imageFile) {
        const imageInfo = await extractImageInformation(imageFile);
        contextParts.push(`Image Content: ${imageInfo}`);
        searchableInfo.push(imageInfo);
      }
      
      // Extract file information if present
      if (fileAttachment) {
        const fileInfo = await extractFileInformation(fileAttachment);
        contextParts.push(`File Content: ${fileInfo}`);
        searchableInfo.push(fileInfo);
      }
      
      // If we have multimodal content, use AI to synthesize an optimal search query
      if (searchableInfo.length > 1 || imageFile || fileAttachment) {
        console.log('[Multimodal Search] Using AI to synthesize optimal search query...');
        
        const synthesisPrompt = `Based on the following information, generate 2-5 specific and effective web search queries that would help find relevant, current information. Focus on the most important concepts, entities, and topics mentioned.

${contextParts.join('\n\n')}

Provide the search queries as a comma-separated list, each query should be 3-8 words and focus on searchable terms. Avoid overly complex or lengthy queries.`;

        const allModelsForSynthesis = getAllModels(groupedModels);
        const synthesisModel = allModelsForSynthesis.find(m =>
          m.id === 'openai/gpt-4o-2024-11-20' ||
          m.id === 'anthropic/claude-3.5-sonnet:beta'
        ) || selectedModel;
        
        const synthesisResponse = await fetch('/api/chat/generate', {
          method: 'POST',
          headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            messages: [{
              role: 'user',
              parts: [{ type: 'text', text: synthesisPrompt }]
            }],
            selectedModelId: synthesisModel.id,
            effectiveReasoningState: false,
            task: 'generate_search_query'
          })
        });
        
        if (synthesisResponse.ok) {
          const result = await synthesisResponse.json();
          const synthesizedQueries = result.text || result.answer || '';
          
          // Extract the best query (first one) or fall back to original text
          const queries = synthesizedQueries.split(',').map((q: string) => q.trim());
          const enhancedQuery = queries[0] || userText || 'multimodal content search';
          
          console.log(`[Multimodal Search] Generated enhanced query: "${enhancedQuery}"`);
          
          return {
            query: enhancedQuery,
            context: contextParts.join('\n\n')
          };
        }
      }
      
      // Fallback to original user text if synthesis fails or no multimodal content
      return {
        query: userText || 'search query',
        context: contextParts.join('\n\n')
      };
      
    } catch (error) {
      console.error('[Multimodal Search] Error generating enhanced query:', error);
      return {
        query: userText || 'search query',
        context: contextParts.join('\n\n')
      };
    }
  };

  // Multi-provider search helper function (Google & Brave only)
  const performProviderSearch = async (
    query: string,
    provider: 'google' | 'brave',
    numResults: number = 10
  ): Promise<{ sources: XenoSource[]; summary?: string; error?: string }> => {
    try {
      console.log(`[Search] Performing ${provider} search for: "${query}"`);

      // Use Google or Brave search endpoints
      const endpoint = provider === 'google'
        ? '/api/v2/engine/google-search'
        : '/api/v2/engine/brave-search';

      const body = provider === 'google'
        ? { query, num_results: numResults }
        : { query, count: numResults };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`${provider} search failed: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      // Transform results to XenoSource format
      const sources: XenoSource[] = results.map((r: any) => ({
        url: r.url,
        title: r.title || 'Untitled',
        snippet: r.snippet || r.description || '',
        summary: r.description || r.snippet || ''
      }));

      console.log(`[${provider} Search] Found ${sources.length} results`);
      return { sources };
    } catch (error) {
      console.error(`[${provider} Search] Error:`, error);
      return {
        sources: [],
        error: error instanceof Error ? error.message : 'Search failed'
      };
    }
  };

  return (
    <>
      {/* Add source preview styles */}
      <style>
        {`
          .hide-scrollbar::-webkit-scrollbar {
            display: none; /* WebKit (Chrome, Safari, Edge) */
          }
          .hide-scrollbar {
            -ms-overflow-style: none;  /* IE and Edge (legacy) */
            scrollbar-width: none;  /* Firefox */
          }
          
          /* Add new styles for inline source citations */
          .inline-source-citation {
            display: inline-flex;
            font-size: 0.75rem; /* text-xs */
            color: #60a5fa; /* text-blue-400 */
            font-weight: 500; /* font-medium */
            margin-left: 0.25rem; /* ml-1 */
          }
          
          /* Style for highlighted source text segments */
          .source-highlight {
            position: relative;
            background-color: rgba(59, 130, 246, 0.1); /* bg-blue-500/10 */
            border-radius: 0.25rem; /* rounded */
            padding: 0 0.25rem; /* px-1 */
          }

          /* Add styles for the popup with isolation property */
          .indicator-preview-popup {
            isolation: isolate; /* Create a new stacking context */
            backface-visibility: hidden; /* Prevent Firefox issues */
            contain: layout; /* Improve performance */
            transition: opacity 0.15s ease; /* Smooth transition for better UX */
          }

          /* Make all links inside popups have proper cursor */
          .indicator-preview-popup a,
          .source-preview-container a {
            cursor: pointer;
          }

          ${sourceHighlightStyles}
          
          /* Add custom Prose overrides */
          .prose h1 { /* Added rule for h1 */
             color: white;
             font-size: 1.5em; /* Optional: Adjust size */
             font-weight: 600;
             margin-top: 1.75rem;
             margin-bottom: 1rem;
          }
          .prose h2 { /* Added rule for h2 */
             color: white;
             font-size: 1.25em; /* Optional: Make h2 slightly larger */
             font-weight: 600;
             margin-top: 1.5rem;
             margin-bottom: 0.75rem;
          }
          .prose h3 { 
            font-size: 1.1em; /* Slightly larger than default prose-sm h3 */
            font-weight: 600; 
            margin-top: 1.25rem;
            margin-bottom: 0.5rem;
            color: #e5e7eb; /* Lighter gray */
          }
          .prose ul, .prose ol {
            margin-top: 0.5rem;
            margin-bottom: 0.75rem;
            padding-left: 1.25rem; /* Adjust indentation */
          }
          .prose li {
            margin-top: 0.2rem;
            margin-bottom: 0.2rem;
          }
          .prose li::marker {
             color: #9ca3af; /* gray-400 */
          }
          .prose hr {
            margin-top: 1.5rem;
            margin-bottom: 1.5rem;
            border-color: rgba(75, 85, 99, 0.5); /* gray-600 at 50% opacity */
            border-top-width: 1px; /* Ensure border width is set */
          }
          .prose table {
            width: 100%;
            margin-top: 1rem;
            margin-bottom: 1rem;
            font-size: 0.875rem; /* text-sm */
            border-collapse: collapse;
            border: 1px solid #4b5563; /* gray-600 */
          }
          .prose th, .prose td {
            border: 1px solid #4b5563; /* gray-600 */
            padding: 0.5rem 0.75rem; /* Adjust padding */
            text-align: left;
          }
          .prose th {
            background-color: rgba(55, 65, 81, 0.5); /* gray-700/50 */
            font-weight: 600;
            color: white; /* Explicitly set text color to white */
          }
          .prose strong {
             color: #ffffff; 
             font-weight: 600;
          }
          .prose blockquote {
            border-left: 4px solid #6b7280; /* gray-500 */
            padding-left: 1rem;
            font-style: italic;
            color: #9ca3af; /* gray-400 */
            margin-top: 1rem;
            margin-bottom: 1rem;
          }
          /* End custom Prose overrides */

          /* Xeno Search Container Styles */
          .xeno-search-container {
            background: linear-gradient(135deg, #111113 0%, #1f1f22 100%);
            border: 1px solid #2a2a2d;
            border-radius: 12px;
            padding: 16px;
            margin: 8px 0;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          }

          .xeno-search-icon-wrapper {
            position: relative;
            width: 40px;
            height: 40px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          }

          .xeno-search-ring {
            position: absolute;
            inset: 0;
            border-radius: 10px;
            border: 2px solid transparent;
            border-top-color: rgba(255, 255, 255, 0.4);
            animation: spin-ring 1.2s linear infinite;
          }

          @keyframes spin-ring {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          .xeno-search-title {
            color: #fff;
          }

          .xeno-search-message {
            font-size: 13px;
            color: #9ca3af;
            margin: 0;
            line-height: 1.4;
          }

          .xeno-typing-dots {
            display: inline-block;
            position: relative;
          }

          .xeno-typing-dots::after {
            content: '';
            animation: typing-dots 1.5s steps(4, end) infinite;
          }

          @keyframes typing-dots {
            0%, 20% { content: ''; }
            40% { content: '.'; }
            60% { content: '..'; }
            80%, 100% { content: '...'; }
          }

          /* Xeno Sources Container Styles */
          .xeno-sources-container {
            background: linear-gradient(135deg, #111113 0%, #1f1f22 100%);
            border: 1px solid #2a2a2d;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          }

          .xeno-sources-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            cursor: pointer;
            transition: background-color 0.2s ease;
            border-bottom: 1px solid transparent;
          }

          .xeno-sources-header:hover {
            background-color: rgba(255, 255, 255, 0.03);
          }

          .xeno-sources-container:has(.xeno-sources-list) .xeno-sources-header {
            border-bottom-color: #2a2a2d;
          }

          .xeno-sources-icon {
            width: 36px;
            height: 36px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          }

          .xeno-sources-title {
            font-size: 14px;
            font-weight: 600;
            color: #fff;
          }

          .xeno-sources-list {
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 280px;
            overflow-y: auto;
          }

          .xeno-source-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid transparent;
            transition: all 0.2s ease;
            text-decoration: none;
          }

          .xeno-source-item:hover {
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.1);
          }

          .xeno-source-favicon {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: #111113;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            overflow: hidden;
          }

          .xeno-source-number {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 700;
            background: rgba(255, 255, 255, 0.1);
            color: #d1d5db;
            border-radius: 4px;
            padding: 2px 6px;
            min-width: 20px;
          }

          /* Remove action buttons from search containers */
          .search-results-container .action-buttons {
            display: none !important;
          }

          /* Add styles for pulsating dots */
          .ai-response-dots {
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .ai-response-dots .dot {
            width: 6px;
            height: 6px;
            margin: 0 2px;
            background-color: #9ca3af;
            border-radius: 50%;
            animation: pulsate 1.5s infinite;
          }

          @keyframes pulsate {
            0% {
              transform: scale(1);
              opacity: 1;
            }
            50% {
              transform: scale(1.2);
              opacity: 0.7;
            }
            100% {
              transform: scale(1);
              opacity: 1;
            }
          }

          /* AI Response Generation Dots Animation */
          .ai-response-dots .dot {
            animation: ai-response-pulse 1.4s infinite ease-in-out;
          }

          .ai-response-dots .dot:nth-child(1) {
            animation-delay: 0s;
          }

          .ai-response-dots .dot:nth-child(2) {
            animation-delay: 0.2s;
          }

          .ai-response-dots .dot:nth-child(3) {
            animation-delay: 0.4s;
          }

          @keyframes ai-response-pulse {
            0%, 80%, 100% {
              transform: scale(0.6);
              opacity: 0.4;
            }
            40% {
              transform: scale(1);
              opacity: 1;
            }
          }

          /* Mobile Responsive Styles */
          @media (max-width: 768px) {
            /* Prevent overscroll/bounce on mobile */
            .chat-mobile-container {
              overscroll-behavior: none;
              -webkit-overflow-scrolling: touch;
              touch-action: pan-y;
              position: fixed;
              inset: 0;
            }
            .chat-top-bar {
              padding: 0.5rem !important;
            }
            .chat-top-bar-buttons {
              gap: 0.25rem !important;
            }
            .chat-button-text {
              display: none !important;
            }
            .chat-button-mobile-only {
              display: flex !important;
            }
            .chat-model-selector {
              width: 2.5rem !important;
              padding: 0.375rem !important;
            }
            .chat-model-selector span {
              display: none !important;
            }
            .chat-system-prompt-btn {
              width: 2.5rem !important;
              padding: 0.375rem !important;
            }
            .chat-system-prompt-btn span {
              display: none !important;
            }
            .chat-message-bubble {
              max-width: 90% !important;
            }
            .chat-input-container {
              padding: 0.75rem !important;
            }
            .chat-input-controls {
              flex-wrap: wrap;
              gap: 0.5rem;
            }
            /* Full width sidebar on mobile */
            .chat-history-sidebar {
              width: 100% !important;
              max-width: 100% !important;
              left: 0 !important;
            }
            .chat-history-sidebar-closed {
              left: -100% !important;
            }
            /* On mobile, sidebar overlays - don't shift main content */
            .main-content-transition {
              margin-left: 0 !important;
            }
            /* Prevent scrolling of body when sidebar is open */
            .chat-sidebar-open {
              overflow: hidden !important;
            }
          }

          @media (max-width: 480px) {
            .chat-history-sidebar {
              width: 100% !important;
              max-width: 100% !important;
            }
            .main-content-transition {
              margin-left: 0 !important;
            }
            .chat-message-bubble {
              max-width: 95% !important;
            }
            .chat-top-bar {
              padding: 0.375rem !important;
            }
          }
        `}
      </style>
      {/* Main container with conditional padding for context panel and history sidebar */}
      <div
        ref={chatContainerRef}
        className={`relative flex flex-col h-full text-white overflow-hidden main-content-transition ${isMobile ? 'chat-mobile-container' : ''} ${isMobile && isHistoryOpen ? 'chat-sidebar-open' : ''}`}
        style={{
          paddingRight: isContextPanelOpen ? `${contextPanelWidth}px` : '0px'
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Top Bar - matches PDF/Word interface style */}
        <div
          ref={topBarRef}
          className={`chat-top-bar absolute top-0 left-0 z-10 flex flex-col px-4 py-2 md:px-4 md:py-2 main-content-transition bg-[#0a0a0b] ${isMultiInterface ? 'px-2 py-1' : ''}`}
          style={{ right: isContextPanelOpen && !isMultiInterface ? `${contextPanelWidth}px` : '0px', backgroundColor: '#0a0a0b' }}
        >
          {/* Buttons row */}
          <div className={`relative flex flex-shrink-0 items-center justify-between`}>
          {/* Left side - History, System Prompt, Clear/Save */}
          <div ref={leftButtonsRef} className={`chat-top-bar-buttons relative flex items-center ${isMultiInterface ? 'gap-1' : 'gap-2 md:gap-2'} transition-all duration-300 ease-in-out`}
            style={{ marginLeft: !isMultiInterface && isHistoryOpen && !isMobile ? (isTaskbarHidden ? '272px' : '264px') : '0px' }}>
              {/* History — hidden in multi-interface mode (each panel has its own conversation selector) */}
              {!isMultiInterface && (
              <button
                  onClick={toggleHistory}
                  className={`flex items-center justify-center border border-white/[0.08] rounded-lg px-3 py-1.5 text-white/80 hover:border-white/20 hover:bg-black/20 transition-colors h-9 ${isHistoryOpen ? 'border-gray-500' : ''}`}
                  aria-label="Toggle History"
              >
                  <Lightbulb size={16} />
              </button>
              )}
              {/* System Prompt */}
              <div className="relative">
                <button
                  ref={systemPromptButtonRef}
                  onClick={toggleSystemPrompt}
                  onMouseEnter={() => setIsSystemPromptButtonHovered(true)}
                  onMouseLeave={() => setIsSystemPromptButtonHovered(false)}
                  className={`chat-system-prompt-btn flex items-center justify-center gap-2 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-white/20 hover:bg-black/20 transition-colors h-9 ${isMultiInterface ? 'w-[8rem]' : 'w-auto md:w-[10rem]'} ${selectedPersona ? 'border-gray-500' : ''}`}
                >
                  <FilePenLine size={16} className="flex-shrink-0" />
                  <span className="truncate hidden md:inline">
                    {selectedPersona && selectedPersona !== 'custom'
                      ? PERSONAS.find(p => p.id === selectedPersona)?.label
                      : selectedPersona === 'custom'
                        ? 'Custom'
                        : (isMultiInterface ? 'System' : 'System Prompt')}
                  </span>
                </button>
                {(isSystemPromptButtonHovered && !isSystemPromptOpen && !isCustomPromptOpen) && (
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 pointer-events-none">
                    <ChevronDown size={16} className="text-gray-500" />
                  </div>
                )}
                <div
                  ref={systemPromptPanelRef}
                  className={`absolute top-full left-0 mt-[10px] z-20 flex flex-col gap-2 transition-all duration-200 ease-out origin-top-left ${isSystemPromptOpen && !isCustomPromptOpen ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible pointer-events-none'}`}
                >
                  {PERSONAS.map((persona) => (
                    <button key={persona.id} onClick={() => handlePersonaSelect(persona.id)}
                      className={`flex items-center justify-center border rounded-lg px-3 py-1.5 text-sm transition-colors h-9 ${isMultiInterface ? 'w-[8rem]' : 'w-[10rem]'} ${selectedPersona === persona.id ? 'border-gray-500 text-white' : 'border-[#1e1e21] text-gray-400 hover:border-white/20 hover:bg-black/20 hover:text-white'}`}
                    >{persona.label}</button>
                  ))}
                  <button onClick={() => { setIsSystemPromptOpen(false); setIsCustomPromptOpen(true); }}
                    className={`flex items-center justify-center border rounded-lg px-3 py-1.5 text-sm transition-colors h-9 ${isMultiInterface ? 'w-[8rem]' : 'w-[10rem]'} ${selectedPersona === 'custom' ? 'border-gray-500 text-white' : 'border-[#1e1e21] text-gray-400 hover:border-white/20 hover:bg-black/20 hover:text-white'}`}
                  >Custom</button>
                  {selectedPersona && (
                    <button onClick={handleClearSystemPrompt}
                      className="flex items-center justify-center border rounded-lg px-3 py-1.5 text-sm transition-colors h-9 ${isMultiInterface ? 'w-[8rem]' : 'w-[10rem]'} border-[#1e1e21] text-gray-400 hover:border-red-500/50 hover:text-red-400"
                    >Clear</button>
                  )}
                </div>
                {/* Custom Prompt Input */}
                <div className={`absolute top-full left-0 mt-[10px] z-20 bg-[#0e0e10] border border-[#2a2a2d] rounded-lg shadow-xl overflow-hidden transition-all duration-200 ease-out origin-top-left ${isCustomPromptOpen ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible pointer-events-none'}`}
                  style={{ width: '18rem' }}>
                  <textarea placeholder="Enter custom system prompt..." value={systemPrompt} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSystemPrompt(e.target.value)}
                    className="w-full h-32 p-3 text-sm text-gray-200 placeholder-gray-500 outline-none bg-[#0e0e10] border-b border-[#2a2a2d] scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent resize-none" />
                  <div className="flex gap-2 p-2">
                    <button onClick={() => { setIsCustomPromptOpen(false); setIsSystemPromptOpen(true); }}
                      className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-white/[0.08] text-gray-400 hover:border-white/20 hover:bg-black/20 hover:text-white transition-colors">Back</button>
                    <button onClick={() => { setSavedSystemPrompt(systemPrompt); setIsCustomPromptOpen(false); setSelectedPersona('custom'); setIsSystemPromptSaved(true); setTimeout(() => setIsSystemPromptSaved(false), 1500); }}
                      disabled={!systemPrompt.trim()}
                      className={`flex-1 px-3 py-1.5 text-sm rounded-lg border transition-colors ${systemPrompt.trim() ? 'border-white/[0.08] text-gray-400 hover:border-white/20 hover:bg-black/20 hover:text-white' : 'border-white/[0.04] text-gray-600 cursor-not-allowed'}`}>Save</button>
                  </div>
                </div>
              </div>
              {/* Clear/Save — hidden in multi-interface */}
              {!isMultiInterface && (
              <button
                  onClick={selectedPersona ? handleClearSystemPrompt : undefined}
                  className={`flex items-center justify-center border border-white/[0.08] rounded-lg px-3 py-1.5 transition-colors h-9 ${selectedPersona ? 'text-gray-400 hover:border-red-500/50 hover:text-red-400 hover:bg-black/20 cursor-pointer' : 'text-gray-600 cursor-default'}`}
                  disabled={!selectedPersona}
              >
                  {selectedPersona ? <X size={16} /> : <Save size={16} />}
              </button>
              )}
                      </div>

          {/* Center - Token Count (mobile only, non-multi-interface) - absolutely centered */}
          {isMobile && !isMultiInterface && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
              {(() => {
                const totalUsedTokens = realTokenCount;
                const maxTokens = selectedModel?.maxTokens || 200000;
                const totalUsagePercent = totalUsedTokens / maxTokens;
                const isNearLimit = totalUsagePercent > 0.9;
                const isOverLimit = totalUsagePercent > 1;
                return (
                  <span className={`text-xs tabular-nums ${isOverLimit ? 'text-red-400' : isNearLimit ? 'text-orange-400' : 'text-gray-400'}`}>
                    {totalUsedTokens.toLocaleString()} / {maxTokens.toLocaleString()}
                  </span>
                );
              })()}
            </div>
          )}

          {/* Center - Conversation Selector (only in multi-interface mode) - absolutely centered */}
          {isMultiInterface && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
              <button
                ref={conversationSelectorButtonRef}
                onClick={() => setIsConversationSelectorOpen(!isConversationSelectorOpen)}
                className={`flex items-center justify-center gap-2 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-white/20 hover:bg-black/20 transition-colors h-9 max-w-[14rem] ${isConversationSelectorOpen ? 'border-gray-500' : ''}`}
              >
                <MessageSquarePlus size={16} className="text-gray-500 flex-shrink-0" />
                <span className="truncate max-w-[10rem]">
                  {activeConversationId
                    ? (conversationHistory.find(c => c.id === activeConversationId)?.title || 'Select Chat')
                    : 'New Chat'}
                </span>
                <ChevronDown size={14} className={`text-gray-500 flex-shrink-0 transition-transform ${isConversationSelectorOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Conversation Selector Dropdown */}
              <div
                ref={conversationSelectorDropdownRef}
                className={`
                  absolute top-full left-1/2 -translate-x-1/2 mt-[10px] z-20
                  transition-all duration-200 ease-out origin-top
                  ${isConversationSelectorOpen
                    ? 'opacity-100 scale-100 visible'
                    : 'opacity-0 scale-95 invisible pointer-events-none'
                  }
                  bg-[#0e0e10] border border-[#2a2a2d] rounded-lg shadow-xl
                  w-64 max-h-80 overflow-hidden
                `}
              >
                {/* Search */}
                <div className="p-2 border-b border-[#2a2a2d]">
                  <div className="relative">
                    <Search size={14} className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-500" />
                    <input
                      type="text"
                      placeholder="Search conversations..."
                      value={conversationSearchQuery}
                      onChange={(e) => setConversationSearchQuery(e.target.value)}
                      className="w-full bg-[#0a0a0b] border border-[#1e1e21] rounded-md py-1.5 pl-7 pr-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-500"
                    />
                  </div>
                </div>

                {/* Conversation List */}
                <div className="overflow-y-auto max-h-56 hide-scrollbar">
                  {isSelectorLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 size={20} className="text-gray-500 animate-spin" />
                    </div>
                  ) : selectorConversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-4 text-center">
                      <Clock size={20} className="text-gray-600 mb-2" />
                      <p className="text-gray-500 text-xs">No conversations yet</p>
                    </div>
                  ) : (() => {
                    const filteredConversations = selectorConversations
                      .filter(convo =>
                        !conversationSearchQuery.trim() ||
                        convo.title.toLowerCase().includes(conversationSearchQuery.toLowerCase())
                      )
                      .sort((a, b) => b.timestamp - a.timestamp);

                    return filteredConversations.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-4 text-center">
                        <Search size={20} className="text-gray-600 mb-2" />
                        <p className="text-gray-500 text-xs">No matches found</p>
                      </div>
                    ) : (
                      <div className="py-1">
                        {filteredConversations.map(convo => (
                          <button
                            key={convo.id}
                            onClick={() => {
                              handleLoadConversation(convo.id);
                              setIsConversationSelectorOpen(false);
                              setConversationSearchQuery('');
                            }}
                            className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                              activeConversationId === convo.id
                                ? 'bg-[#2a2a2d] text-white'
                                : 'text-gray-300 hover:bg-[#2a2a2d]/50'
                            }`}
                          >
                            <p className="truncate text-xs">{convo.title}</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">
                              {new Date(convo.timestamp).toLocaleDateString()}
                            </p>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* New Chat option */}
                <div className="border-t border-[#2a2a2d] p-2">
                  <button
                    onClick={() => {
                      handleNewChat();
                      setIsConversationSelectorOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-[#2a2a2d]/50 rounded-md transition-colors"
                  >
                    <Plus size={14} />
                    <span>New Conversation</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Right side - New Chat, Model Selector & Settings */}
          <div ref={rightButtonsRef} className={`chat-top-bar-buttons flex items-center ${isMultiInterface ? 'gap-1' : 'gap-1 md:gap-2'} main-content-transition`}>
              {/* Refresh button - visible in multi-interface mode when there's an active conversation */}
              {isMultiInterface && activeConversationId && (
                <button
                    onClick={handleRefreshConversation}
                    disabled={isRefreshing}
                    className={`flex items-center justify-center border border-white/[0.08] rounded-lg px-3 py-1.5 text-white/80 hover:border-white/20 hover:bg-black/20 transition-colors h-9 ${isRefreshing ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Refresh conversation"
                >
                    <RefreshCcw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                </button>
              )}
              <button
                  onClick={handleNewChat}
                  className="flex items-center justify-center border border-white/[0.08] rounded-lg px-3 py-1.5 text-white/80 hover:border-white/20 hover:bg-black/20 transition-colors h-9"
                  aria-label="Start New Chat"
              >
                  <SquarePen size={16} />
              </button>
              <div className="relative flex-shrink-0">
                <button
                      ref={companyDropdownButtonRef}
                      onClick={() => {
                          setIsCompanyDropdownOpen(!isCompanyDropdownOpen);
                      }}
                  onMouseEnter={() => setIsModelSelectorButtonHovered(true)}
                  onMouseLeave={() => setIsModelSelectorButtonHovered(false)}
                  className={`chat-model-selector flex items-center justify-center gap-2 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-white/20 hover:bg-black/20 transition-colors h-9 ${isMultiInterface ? 'w-[8rem]' : 'w-auto md:w-[10rem]'}`}
                >
                  {isModelsLoading ? (
                    <Loader2 size={16} className="text-gray-500 flex-shrink-0 animate-spin" />
                  ) : modelHasReasoningCapability(selectedModel.id, selectedModel) !== 'disabled' && isReasonToggled ? (
                    <BrainCircuit size={16} className="text-white/70 flex-shrink-0" />
                  ) : (
                    <Brain size={16} className="text-gray-500 flex-shrink-0" />
                  )}
                  <span className="truncate hidden md:inline">{selectedModel.name}</span>
                </button>
                {(isModelSelectorButtonHovered && !isCompanyDropdownOpen) && (
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 pointer-events-none">
                    <ChevronDown size={16} className="text-gray-500" />
                  </div>
                )}
                  <div
                     ref={companyListContainerRef}
                     style={{ right: '-48px' }}
                     className={`
                        absolute top-full mt-[10px] z-20
                        transition-all duration-200 ease-out origin-top-right
                        ${isCompanyDropdownOpen
                          ? 'opacity-100 scale-100 visible'
                          : 'opacity-0 scale-95 invisible'
                        }
                        w-72 bg-[#111113] border border-[#1e1e21] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)]
                        max-h-[60vh] overflow-hidden flex flex-col
                `}>
                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto">
                    <div>
                          {groupedModels.length === 0 && (
                            <div className="px-4 py-8 text-center text-sm text-white/40">
                              {isModelsLoading ? 'Loading models…' : 'No models available on the endpoint.'}
                            </div>
                          )}
                          {groupedModels.map((group) => {
                              const isExpanded = expandedCompanies.has(group.companyName);
                              return (
                                  <div key={group.companyName}>
                                      <div
                                          onClick={() => {
                                              setExpandedCompanies(prev => {
                                                  if (prev.has(group.companyName)) {
                                                      return new Set();
                                                  } else {
                                                      return new Set([group.companyName]);
                                                  }
                                              });
                                          }}
                                          className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-white/[0.03] transition-colors border-b border-[#1e1e21]/50"
                                      >
                                          <span className="text-[12px] font-semibold text-white/50 uppercase tracking-wider">
                                            {group.companyName}
                                          </span>
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}><path d="M6 9l6 6 6-6" /></svg>
                                      </div>

                                      {/* Expanded Models List */}
                                      {isExpanded && group.models.map((model) => (
                                        <div
                                          key={model.id}
                                          onClick={() => handleModelSelect(model)}
                                          className={`px-3 py-2 flex items-center justify-between cursor-pointer transition-colors border-l-2 ${
                                            selectedModel.id === model.id
                                              ? 'bg-[#a760ff]/10 text-white border-[#a760ff]'
                                              : 'text-gray-400 hover:bg-white/[0.05] hover:text-white border-transparent'
                                          }`}
                                        >
                                          <div className="flex items-center gap-2 flex-1 min-w-0">
                                            <span className="text-[13px] truncate">
                                              {model.name}
                                            </span>
                                            {modelHasReasoningCapability(model.id, model) !== 'disabled' && (
                                              <Brain size={13} className="text-white/25 flex-shrink-0" />
                                            )}
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <span className="text-[11px] text-white/25">{formatTokens(model.maxTokens)}</span>
                                            {selectedModel.id === model.id && (
                                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                  </div>
                              );
                          })}
                      </div>
                    </div>
                  </div>
            </div>
            {/* Message Search Button */}
            {messages.length > 0 && (
              <button
                onClick={() => {
                  setIsMessageSearchOpen(!isMessageSearchOpen);
                  if (isMessageSearchOpen) setMessageSearchQuery('');
                }}
                className={`flex items-center justify-center border rounded-lg px-3 py-1.5 text-white/80 hover:border-white/20 hover:bg-black/20 transition-colors h-9 ${
                  isMessageSearchOpen ? 'border-gray-500' : 'border-[#1e1e21]'
                }`}
                aria-label="Search messages"
              >
                <Search size={16} />
              </button>
            )}
            <div className="relative flex-shrink-0">
              <button
                  ref={settingsButtonRef}
                  onClick={() => setIsSettingsModalOpen(!isSettingsModalOpen)}
                  className="flex items-center gap-2 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-white/20 hover:bg-black/20 transition-colors h-9"
                  aria-label="Settings"
              >
                  <Settings size={16} />
              </button>
              <div
                 ref={settingsModalRef}
                 className={`
                    absolute top-full right-0 mt-[10px] z-20
                    transition-all duration-200 ease-out origin-top-right
                    ${isSettingsModalOpen
                      ? 'opacity-100 scale-100 visible'
                      : 'opacity-0 scale-95 invisible'
                    }
                    bg-[#0e0e10] border border-[#2a2a2d] rounded-lg shadow-xl
                    overflow-hidden
            `}
            style={{ width: 'calc(36px + 10rem + 36px + 24px)' }}>
              {/* Layout Section */}
              <div className="p-3">
                {/* Alignment Options - Hidden on mobile */}
                {!isMobile && (
                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={() => setChatAlignment(chatAlignment === 'left' ? 'center' : 'left')}
                      className={`flex-1 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        chatAlignment === 'left'
                          ? 'bg-[#0e0e10] border-gray-500 text-white'
                          : 'border-white/[0.08] text-gray-400 hover:border-white/20 hover:bg-black/20 hover:text-white'
                      }`}
                    >
                      Left
                    </button>
                    <button
                      onClick={() => setChatAlignment('center')}
                      className={`flex-1 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        chatAlignment === 'center'
                          ? 'bg-[#0e0e10] border-gray-500 text-white'
                          : 'border-white/[0.08] text-gray-400 hover:border-white/20 hover:bg-black/20 hover:text-white'
                      }`}
                    >
                      Center
                    </button>
                    <button
                      onClick={() => setChatAlignment(chatAlignment === 'right' ? 'center' : 'right')}
                      className={`flex-1 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        chatAlignment === 'right'
                          ? 'bg-[#0e0e10] border-gray-500 text-white'
                          : 'border-white/[0.08] text-gray-400 hover:border-white/20 hover:bg-black/20 hover:text-white'
                      }`}
                    >
                      Right
                    </button>
                  </div>
                )}

                {/* Wide Toggle - Hidden on mobile */}
                {!isMobile && (
                  <button
                    onClick={() => setIsWideChatEnabled(!isWideChatEnabled)}
                    className={`w-full px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      isWideChatEnabled
                        ? 'bg-[#0e0e10] border-gray-500 text-white'
                        : 'border-white/[0.08] text-gray-400 hover:border-white/20 hover:bg-black/20 hover:text-white'
                    }`}
                  >
                    Wide
                  </button>
                )}

                {/* Font Size Control */}
                <div className={`flex gap-2 items-center ${!isMobile ? 'mt-3' : ''}`}>
                  <span className="text-xs text-gray-500 mr-1">Text</span>
                  <button
                    onClick={() => {
                      setChatFontSize('small');
                      try { localStorage.setItem('xeno_chat_font_size', 'small'); } catch {}
                    }}
                    className={`flex-1 px-2 py-1.5 rounded-lg border transition-colors ${
                      chatFontSize === 'small'
                        ? 'bg-[#0e0e10] border-gray-500 text-white'
                        : 'border-white/[0.08] text-gray-400 hover:border-white/20 hover:bg-black/20 hover:text-white'
                    }`}
                  >
                    <span className="text-[10px]">A</span>
                  </button>
                  <button
                    onClick={() => {
                      setChatFontSize('medium');
                      try { localStorage.setItem('xeno_chat_font_size', 'medium'); } catch {}
                    }}
                    className={`flex-1 px-2 py-1.5 rounded-lg border transition-colors ${
                      chatFontSize === 'medium'
                        ? 'bg-[#0e0e10] border-gray-500 text-white'
                        : 'border-white/[0.08] text-gray-400 hover:border-white/20 hover:bg-black/20 hover:text-white'
                    }`}
                  >
                    <span className="text-xs">A</span>
                  </button>
                  <button
                    onClick={() => {
                      setChatFontSize('large');
                      try { localStorage.setItem('xeno_chat_font_size', 'large'); } catch {}
                    }}
                    className={`flex-1 px-2 py-1.5 rounded-lg border transition-colors ${
                      chatFontSize === 'large'
                        ? 'bg-[#0e0e10] border-gray-500 text-white'
                        : 'border-white/[0.08] text-gray-400 hover:border-white/20 hover:bg-black/20 hover:text-white'
                    }`}
                  >
                    <span className="text-sm">A</span>
                  </button>
                </div>
              </div>

              {/* Divider - Hidden on mobile */}
              {!isMobile && <div className="border-t border-[#2a2a2d]" />}

              {/* Interface Section - Hidden on mobile */}
              {!isMobile && (
                <div className="p-3">
                  <div className="space-y-2">
                    <button
                      onClick={() => {
                        if (onCreateNewInterface && !maxInterfacesReached) {
                          onCreateNewInterface();
                          setIsSettingsModalOpen(false);
                        }
                      }}
                      disabled={maxInterfacesReached}
                      className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        maxInterfacesReached
                          ? 'border-white/[0.04] text-gray-600 cursor-not-allowed'
                          : 'border-white/[0.08] text-gray-400 hover:border-white/20 hover:bg-black/20 hover:text-white'
                      }`}
                    >
                      <Plus size={14} />
                      <span>New Interface</span>
                    </button>

                    {isMultiInterface && onCloseInterface && (
                      <button
                        onClick={() => {
                          onCloseInterface(interfaceId);
                          setIsSettingsModalOpen(false);
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm rounded-lg border bg-[#0e0e10] border-[#1e1e21] text-gray-400 hover:border-red-500/50 hover:text-red-400 transition-colors"
                      >
                        <X size={14} />
                        <span>Close Interface</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Export Section */}
              {messages.length > 0 && (
                <>
                  <div className="border-t border-[#2a2a2d]" />
                  <div className="p-3">
                    <button
                      onClick={() => {
                        handleExportConversation();
                        setIsSettingsModalOpen(false);
                      }}
                      className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-white/[0.08] text-gray-400 hover:border-white/20 hover:bg-black/20 hover:text-white transition-colors"
                    >
                      <Download size={14} />
                      <span>Export as Markdown</span>
                    </button>
                  </div>
                </>
              )}
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* Message Search Bar */}
        {isMessageSearchOpen && (
          <div className="w-full px-4 py-2 bg-[#0a0a0b] border-b border-[#2a2a2d]">
            <div className={`${isMultiInterface ? 'max-w-full' : (isWideChatEnabled ? 'max-w-[67.5rem]' : 'max-w-[45rem]')} mx-auto`}>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search in conversation..."
                  value={messageSearchQuery}
                  onChange={(e) => setMessageSearchQuery(e.target.value)}
                  autoFocus
                  className="w-full bg-[#0e0e10] border border-[#1e1e21] rounded-lg py-2 pl-10 pr-10 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-500"
                />
                {messageSearchQuery && (
                  <button
                    onClick={() => setMessageSearchQuery('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              {messageSearchQuery && (
                <p className="text-xs text-gray-500 mt-1.5 ml-1">
                  {messages.filter(m =>
                    !m.isThinkingPlaceholder && !m.isDotPlaceholder &&
                    (m.text?.toLowerCase().includes(messageSearchQuery.toLowerCase()) ||
                     m.parsedAnswer?.toLowerCase().includes(messageSearchQuery.toLowerCase()))
                  ).length} matches found
                </p>
              )}
            </div>
          </div>
        )}

        {/* Chat Messages Area */}
        <div
          ref={chatAreaRef}
          translate="no"
          className="hide-scrollbar flex-grow w-full overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent px-2 pt-16 pb-16 main-content-transition notranslate"
        >
                        <div className={`${isMultiInterface ? 'max-w-full px-2' : (isWideChatEnabled ? 'max-w-[67.5rem]' : 'max-w-[45rem]')} w-full space-y-2 overflow-hidden ${
                          isMultiInterface ? 'mx-auto' : (
                            chatAlignment === 'left' ? 'ml-0 mr-auto' :
                            chatAlignment === 'right' ? 'ml-auto mr-0' :
                            'mx-auto'
                          )
                        } ${
                          chatFontSize === 'small' ? 'chat-font-small' :
                          chatFontSize === 'large' ? 'chat-font-large' :
                          'chat-font-medium'
                        }`}>
              {/* Display Xeno Search Results if available -- REMOVED */}
              {/* {xenoSearchResults && !isXenoSearching && (
                <div className="w-full mb-4 px-2">
                  <XenoSearchResultsDisplay results={xenoSearchResults} />
                </div>
              )} */}
            
            {messages.length === 0 ? (
                 <p className="text-center text-gray-500 pt-24">No messages yet. Start chatting!</p>
              ) : (
                 messages.map((message, index) => {
                    // Moved these declarations up to be available for all conditions
                    const isUser = message.sender === 'user';
                    const isLastMessage = index === messages.length - 1;
                    const isLastAiMessage = isLastMessage && !isUser;
                    let firstMessageTopMargin = index === 0 ? 'mt-4' : '';
                    if (index === 0 && showTopBarBackground) {
                        firstMessageTopMargin = 'mt-[5rem]';
                    }

                    // Search highlight logic
                    const messageMatchesSearch = messageSearchQuery.trim() &&
                      !message.isThinkingPlaceholder && !message.isDotPlaceholder &&
                      (message.text?.toLowerCase().includes(messageSearchQuery.toLowerCase()) ||
                       message.parsedAnswer?.toLowerCase().includes(messageSearchQuery.toLowerCase()));

                    // Date separator logic
                    const prevMessage = index > 0 ? messages[index - 1] : undefined;
                    const showDateSeparator = shouldShowDateSeparator(message, prevMessage);
                    const dateSeparatorElement = showDateSeparator && message.timestamp ? (
                      <div key={`date-sep-${message.id}`} className="flex items-center justify-center my-4">
                        <div className="flex items-center gap-3 text-[11px] text-gray-500">
                          <div className="w-12 h-px bg-[#2a2a2d]" />
                          <span>{formatDateSeparator(message.timestamp)}</span>
                          <div className="w-12 h-px bg-[#2a2a2d]" />
                        </div>
                      </div>
                    ) : null;

                    if (message.isThinkingPlaceholder) {
                        // Animated thinking placeholder with live timer
                        const isRefinementPlaceholder = message.id === aiRefinementPlaceholderId;
                        return (
                            <div key={message.id} className="flex justify-start w-full pl-[1.125rem]">
                                {isRefinementPlaceholder ? (
                                    <div className="flex items-center gap-2 bg-[#0e0e10] border border-[#1e1e21] rounded-lg px-3 py-1.5 text-sm">
                                        <span className="flex h-2 w-2 relative mr-1">
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-500 animate-pulse"></span>
                                        </span>
                                        <span className="text-gray-400">Okay, let me figure out{ellipsisText}</span>
                                    </div>
                                ) : (
                                    <ThinkingAnimation
                                        duration={liveTimerValue || 0}
                                        isLive={true}
                                    />
                                )}
                            </div>
                        );
                    } else if (message.isDotPlaceholder) {
                        return (
                            <div key={message.id} className="flex justify-start w-full pl-[1.125rem] py-2">
                                <span className="w-2 h-2 bg-gray-500 rounded-full animate-pulse" />
                            </div>
                        );
                    } else if (message.isCancelled) {
                        return (
                            <div key={message.id} className="group relative flex justify-start w-full">
                                <div className="flex items-center"> {/* Flex row for both elements */}
                                    <div className="flex items-center gap-2 bg-[#0e0e10] border border-[#1e1e21] rounded-lg px-3 py-1.5 text-sm text-gray-400 italic">
                                        <MessageSquareX size={16} className="mr-1 flex-shrink-0" /> 
                                        <span>{message.isXenoSearchCancelled ? message.text : 'Request Aborted'}</span>
                                    </div>
                                    <div 
                                        onClick={() => message.isXenoSearchCancelled ? handleTryWithoutSearch(message.id) : handleRegenerate(message.id)}
                                        className="ml-3 text-xs font-sans font-medium text-gray-400 hover:text-white cursor-pointer opacity-0 group-hover:opacity-100 transition-all duration-150 ease-in-out"
                                    >
                                        {message.isXenoSearchCancelled 
                                            ? (isXenoSearchEnabled ? 'Try again' : 'Try without search')
                                            : 'Try Again'
                                        }
                                    </div>
                                </div>
                            </div>
                        );
                    }
                    
                    // const isUser = message.sender === 'user'; // Moved up
                    const isThinkingVisible = !isUser && showThinkingId === message.id;
                    // const isLastMessage = index === messages.length - 1; // Moved up
                    // const isLastAiMessage = isLastMessage && !isUser; // Moved up
                    // let firstMessageTopMargin = index === 0 ? 'mt-4' : ''; // Moved up
                    // if (index === 0 && showTopBarBackground) { // Moved up
                    //     firstMessageTopMargin = 'mt-[5rem]'
                    // }

                    return (
                        <React.Fragment key={message.id}>
                          {dateSeparatorElement}
                          <div
                            className={`flex w-full ${isUser ? 'justify-end pr-4' : 'justify-start'} ${firstMessageTopMargin} ${
                              messageMatchesSearch ? 'bg-yellow-500/5 border-l-2 border-yellow-500/50 -ml-0.5 pl-0.5' : ''
                            }`}
                          >
                           {isUser ? (
                               editingMessageId === message.id ? (
                                     <div
                                         className="chat-message-bubble flex flex-col bg-[#0e0e10] border border-[#1e1e21] rounded-2xl rounded-br-none p-3 max-w-[90%] md:max-w-[75%] w-full text-white overflow-hidden"
                                     >
                                         <textarea
                                             ref={editInputRef}
                                             value={editText}
                                             onChange={(e) => setEditText(e.target.value)}
                                               className="w-full bg-transparent text-sm leading-snug text-white outline-none resize-none focus:ring-0 border-none focus:outline-none focus:shadow-none whitespace-pre-wrap scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent focus:outline-none"
                                               rows={1}
                                               style={{ overflowY: 'hidden' }}
                                           />
                                           <div className="flex items-center justify-end gap-2 mt-1.5 self-end">
                                               <button onClick={handleCancelEdit} className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1" aria-label="Cancel edit">
                                                   Cancel
                                               </button>
                                               <button onClick={handleSaveEdit} className="text-sm bg-gray-400 text-zinc-900 px-3 py-1 rounded-md font-semibold hover:bg-gray-300 transition-colors" aria-label="Save changes">
                                                   Save
                                               </button>
                                           </div>
                                       </div>
                                  ) : (
                                     <div data-message-id={message.id} className="chat-message-bubble group flex flex-col items-end max-w-[90%] md:max-w-[75%] min-w-0">
                                           <div
                                              className="bg-[#0e0e10] border border-[#1e1e21] rounded-2xl rounded-br-none p-3 text-white overflow-hidden"
                                           >
                                               <p className="text-sm leading-snug whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{message.text}</p>
                                           </div>
                                           {message.userImageAttachment && (message.userImageAttachment.file || message.userImageAttachment.base64Data) && (
                                             <div className="mt-2 ml-auto mr-0 max-w-[150px]">
                                               <img
                                                 src={message.userImageAttachment.file
                                                        ? URL.createObjectURL(message.userImageAttachment.file)
                                                        : `data:${message.userImageAttachment.type};base64,${message.userImageAttachment.base64Data}`}
                                                 alt={message.userImageAttachment.name}
                                                 className="max-w-full h-auto rounded-lg border border-[#1e1e21] cursor-pointer"
                                                 onClick={() => {
                                                   if (message.userImageAttachment) {
                                                      if (message.userImageAttachment.file) {
                                                        setFullScreenImageUrl(URL.createObjectURL(message.userImageAttachment.file));
                                                      } else if (message.userImageAttachment.base64Data) {
                                                        setFullScreenImageUrl(`data:${message.userImageAttachment.type};base64,${message.userImageAttachment.base64Data}`);
                                                      }
                                                      setIsFullScreenImageOpen(true);
                                                      setViewerShowsDownloadButton(true);
                                                   }
                                                 }}
                                                 onLoad={(e) => { if (message.userImageAttachment?.file) { URL.revokeObjectURL((e.target as HTMLImageElement).src); } }}
                                               />
                                             </div>
                                           )}
                                           {message.userFileAttachment && (message.userFileAttachment.file || message.userFileAttachment.content) && (
                                            <div
                                              className="mt-2 ml-auto mr-0 max-w-[250px] p-2 flex items-center gap-2 bg-[#2a2a2d]/50 border border-[#1e1e21]/50 rounded-lg cursor-pointer hover:bg-[#2a2a2d] transition-colors"
                                              onClick={() => {
                                                if (message.userFileAttachment) {
                                                  if (message.userFileAttachment.file) {
                                                    const fileToShow: AttachedFile = {
                                                      id: `user-attached-${message.userFileAttachment.name}-${message.id}`,
                                                      name: message.userFileAttachment.name,
                                                      type: message.userFileAttachment.type,
                                                      fileObject: message.userFileAttachment.file
                                                    };
                                                    handleShowFileInContextPanel(fileToShow);
                                                  } else {
                                                    // File from history, pass the serialized structure directly
                                                    handleShowFileInContextPanel(message.userFileAttachment as any);
                                                  }
                                                }
                                              }}
                                            >
                                              <FileText size={18} className="text-blue-400 flex-shrink-0" />
                                              <span className="text-sm text-gray-300 truncate" title={message.userFileAttachment.name}>
                                                {message.userFileAttachment.name}
                                              </span>
                                            </div>
                                           )}
                                           <div className="flex items-center justify-end gap-2 mt-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-150">
                                               {message.timestamp && (
                                                   <span className="text-[11px] text-gray-600 mr-1">{formatMessageTime(message.timestamp)}</span>
                                               )}
                                               <button onClick={() => handleEditUserMessage(message.id, message.text)} className="p-1 text-gray-400 hover:text-gray-200 rounded-md" aria-label="Edit message">
                                                   <SquarePen size={14} />
                                               </button>
                                               <button onClick={() => handleCopyUserMessage(message.text, message.id)} className="p-1 text-gray-400 hover:text-gray-200 rounded-md" aria-label="Copy message">
                                                    {copiedMessageId === message.id ? (
                                                         <Check size={14} className="text-green-400" />
                                                     ) : (
                                                         <Copy size={14} />
                                                     )}
                                               </button>
                                           </div>
                                       </div>
                                   )
                               ) : (
                                   // --- AI Message ---
                                   <div data-message-id={message.id} className={`group flex flex-col items-start w-full space-y-2 pr-4`}>

                                      {/* Full message edit mode - transforms entire container into input box */}
                                      {editingAiMessageId === message.id ? (
                                        <div className="w-full bg-[#0e0e10] border border-[#1e1e21] rounded-2xl p-4">
                                          <div className="flex items-center gap-2 mb-3">
                                            <Pencil size={14} className="text-gray-500" />
                                            <span className="text-sm text-gray-400">Editing Response</span>
                                            <span className="text-xs text-gray-600 ml-auto">Markdown supported</span>
                                          </div>
                                          <textarea
                                            value={editingAiContent}
                                            onChange={(e) => setEditingAiContent(e.target.value)}
                                            className="w-full min-h-[300px] max-h-[600px] p-4 bg-[#121214] border border-[#1e1e21] rounded-xl text-white text-sm resize-y focus:outline-none focus:border-gray-500 leading-relaxed"
                                            placeholder="Edit AI response..."
                                            autoFocus
                                            spellCheck={false}
                                          />
                                          <div className="flex items-center justify-end gap-2 mt-3">
                                            <button
                                              onClick={handleCancelAiEdit}
                                              className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5 transition-colors"
                                            >
                                              Cancel
                                            </button>
                                            <button
                                              onClick={handleSaveAiEdit}
                                              className="text-sm bg-gray-400 text-zinc-900 px-4 py-1.5 rounded-md font-semibold hover:bg-gray-300 transition-colors"
                                            >
                                              Save
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                      <>
                                      {/* 1. Thoughts (Expanded) */}
                                      {message.hasThinking && showThinkingId === message.id && (
                                          <div className="w-full pl-[1.125rem] mb-4">
                                          <div className="flex flex-col w-full bg-[#0e0e10] border border-[#1e1e21] rounded-lg overflow-hidden">
                                              {/* Header */}
                                              <div
                                                  onClick={() => setShowThinkingId(null)}
                                                  className="flex items-center justify-between w-full px-4 py-2.5 cursor-pointer hover:bg-[#0e0e10]/50 transition-colors"
                                              >
                                                  <div className="flex items-center gap-2">
                                                      <Lightbulb size={16} className="text-gray-500" />
                                                      <span className="text-sm text-gray-200">
                                                          Thoughts
                                                          {message.thinkingDuration !== undefined && message.thinkingDuration >= 0 && (
                                                              <span className="text-gray-500 ml-2">{message.thinkingDuration}s</span>
                                                          )}
                                                      </span>
                                                  </div>
                                                  <ChevronUp size={16} className="text-gray-500" />
                                              </div>

                                              {/* Content */}
                                              <div className="px-4 pb-4">
                                                  <div className="pt-3 border-t border-[#1e1e21] w-full text-sm prose prose-sm prose-invert max-w-none text-gray-300 prose-p:my-2 prose-li:my-0.5 prose-ol:pl-5 prose-ul:pl-5 prose-headings:text-gray-200 prose-headings:font-medium leading-relaxed"> 
                                                {message.thinkingContent ? (
                                                              <ReactMarkdown 
                                                                  remarkPlugins={[remarkGfm]}
                                                                  rehypePlugins={[rehypeRaw]}
                                                          components={{ 
                                                              pre: ({children}: any) => <>{children}</>, 
                                                          code({node, inline, className, children, ...props}: any) {
                                                                  const match = /language-(\w+)/.exec(className || ""); 
                                                                  if (!inline) { 
                                                                      const codeString = String(children).replace(/\n$/, ""); 
                                                                      if (codeString.includes("\n")) { 
                                                                      const blockIndex = node?.position?.start?.line ?? (node?.index ?? Date.now());
                                                                      const codeBlockId = `${message.id}-thinking-code-${blockIndex}`;
                                                                      return <CodeBlockWithHeader
                                                                                language={match ? match[1] : "plaintext"}
                                                                                code={codeString}
                                                                                runtimes={pistonRuntimes}
                                                                                runtimesLoading={pistonRuntimesLoading}
                                                                                codeBlockId={codeBlockId}
                                                                                executionState={codeBlockExecutionStates[codeBlockId]}
                                                                                onRunCode={handleCodeBlockRun}
                                                                                onCloseOutput={handleCodeBlockCloseOutput}
                                                                                onEditCode={handleEditCodeBlock}
                                                                                isEditing={editingCodeBlockId === codeBlockId}
                                                                                editingCode={editingCodeBlockId === codeBlockId ? editingCodeContent : ''}
                                                                                onEditCodeChange={setEditingCodeContent}
                                                                                onSaveCodeEdit={handleSaveCodeEdit}
                                                                                onCancelCodeEdit={handleCancelCodeEdit}
                                                                             />;
                                                                      } else { 
                                                                          return <code className="bg-[#232021] rounded px-2 py-1 font-mono text-[15px] text-[#f6b98b] align-middle max-w-full">{codeString}</code>; 
                                                                      } 
                                                                  } 
                                                                  return <code className={className} {...props}>{children}</code>; 
                                                              }, 
                                                          }} 
                                                      > 
                                                          {message.thinkingContent || ''} 
                                                              </ReactMarkdown>
                                                  ) : (
                                                      <p className="text-gray-400 italic text-sm">
                                                          {message.modelIdUsed?.includes('google/gemini-2.5-pro') 
                                                              ? "Gemini 2.5 Pro provided a direct answer. Its detailed thought process wasn't explicitly formatted in this instance."
                                                              : message.modelIdUsed?.includes('x-ai/grok')
                                                                  ? "Grok provided a direct answer. Its detailed thought process wasn't explicitly formatted in this instance."
                                                                  : "[Thinking process not provided or markers not found in API response]"
                                                          }
                                                      </p>
                                                  )}
                                              </div>
                                          </div>
                                      </div>
                                      </div>
                                      )}

                                      {/* 1. Thoughts (Collapsed Header) */}
                                      {message.hasThinking && showThinkingId !== message.id && (
                                          <div className="w-full pl-[1.125rem] mb-4">
                                              <div
                                                  onClick={() => setShowThinkingId(message.id)}
                                                  className="flex items-center justify-between w-full bg-[#0e0e10] border border-[#1e1e21] rounded-lg px-4 py-2.5 cursor-pointer hover:border-white/20 hover:bg-black/20 transition-colors"
                                              >
                                                  <div className="flex items-center gap-2">
                                                      <Lightbulb size={16} className="text-gray-500" />
                                                      <span className="text-sm text-gray-200">
                                                          Thoughts
                                                          {message.thinkingDuration !== undefined && message.thinkingDuration >= 0 && (
                                                              <span className="text-gray-500 ml-2">{message.thinkingDuration}s</span>
                                                          )}
                                                      </span>
                                                  </div>
                                                  <ChevronDown size={16} className="text-gray-500" />
                                              </div>
                                          </div>
                                      )}
 
                                      {/* 2. Grounding Info Box - Xeno Search Sources */}
                                      {/* Show Xeno Search Loading Animation or Results - Only when Xeno Search was actually used */}
                                      {((message.isLoading && message.searchInfo && isXenoSearchEnabled) ||
                                        (message.searchInfo && (message.searchInfo.queries?.length > 0 || message.searchInfo.sources?.length > 0) &&
                                         (isXenoSearchEnabled || isXenoSearching || xenoSearchResults))) ? (
                                          message.isLoading ? (
                                              <div className="w-full pl-[1.125rem]">
                                                  {message.isXenoDeepSearchContainer ? (
                                                      // Deep search container: show animation only when active
                                                      deepSearchState.isActive ? (
                                                          <XenoDeepSearchAnimationInline
                                                              phase={deepSearchState.phase}
                                                              progress={deepSearchState.progress}
                                                              message={deepSearchState.message}
                                                              data={deepSearchState.data}
                                                          />
                                                      ) : null  // Don't show anything when deep search is inactive
                                                  ) : (
                                                      // Regular Xeno search: show loading animation with progress
                                                      <XenoSearchLoadingAnimation
                                                          message={searchProgress.message}
                                                          progress={searchProgress.progress}
                                                      />
                                                  )}
                                              </div>
                                          ) : (
                                          <div className="w-full pl-[1.125rem]">
                                              <div className="xeno-sources-container">
                                                {(() => {
                                                    if (!message.searchInfo?.sources || message.searchInfo.sources.length === 0) return null;
                                                    const isExpanded = expandedSourcesMap[message.id];
                                                    const sources = message.searchInfo.sources;
                                                    const sourceCount = sources.length;

                                                    return (
                                                        <>
                                                            {/* Header - always visible */}
                                                            <div
                                                                className="xeno-sources-header"
                                                                onClick={() => setExpandedSourcesMap(prev => ({ ...prev, [message.id]: !prev[message.id] }))}
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <div className="xeno-sources-icon">
                                                                        <Globe size={16} className="text-gray-300" />
                                                                    </div>
                                                                    <div>
                                                                        <div className="xeno-sources-title">Web Sources</div>
                                                                        <div className="text-xs text-gray-400">{sourceCount} page{sourceCount !== 1 ? 's' : ''} found</div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-3">
                                                                    {/* Favicon stack */}
                                                                    <div className="flex -space-x-1.5">
                                                                        {sources.slice(0, 4).map((source, idx) => {
                                                                            const actualUrl = extractActualUrl(source.uri);
                                                                            const favicon = sourceMetadataCache[actualUrl]?.favicon;
                                                                            return (
                                                                                <div key={idx} className="w-6 h-6 rounded-full bg-[#2a2a2d] border-2 border-[#111113] flex items-center justify-center overflow-hidden shadow-sm">
                                                                                    {favicon ? (
                                                                                        <img src={favicon} alt="" className="w-4 h-4 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                                                    ) : (
                                                                                        <div className="w-3 h-3 bg-gray-500 rounded-full" />
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                        {sourceCount > 4 && (
                                                                            <div className="w-6 h-6 rounded-full bg-[#1e1e21] border-2 border-[#111113] flex items-center justify-center text-xs text-gray-300 font-medium shadow-sm">
                                                                                +{sourceCount - 4}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <ChevronDown size={16} className={`text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                                                </div>
                                                            </div>

                                                            {/* Expanded sources list */}
                                                            {isExpanded && (
                                                                <div className="xeno-sources-list">
                                                                    {sources.map((source, idx) => {
                                                                        const actualUrl = extractActualUrl(source.uri);
                                                                        const favicon = sourceMetadataCache[actualUrl]?.favicon;
                                                                        let domain = '';
                                                                        try { domain = new URL(source.uri).hostname; } catch {}

                                                                        return (
                                                                            <a
                                                                                key={idx}
                                                                                href={source.uri}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                className="xeno-source-item group"
                                                                                onClick={(e) => e.stopPropagation()}
                                                                            >
                                                                                <div className="xeno-source-favicon">
                                                                                    {favicon ? (
                                                                                        <img src={favicon} alt="" className="w-4 h-4 object-cover rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                                                    ) : (
                                                                                        <Globe size={14} className="text-gray-500" />
                                                                                    )}
                                                                                </div>
                                                                                <div className="flex-1 min-w-0">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className="xeno-source-number">
                                                                                            {idx + 1}
                                                                                        </span>
                                                                                        <span className="text-sm font-medium text-gray-100 truncate group-hover:text-white transition-colors">
                                                                                            {source.title || domain}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div className="text-xs text-gray-500 mt-0.5 truncate flex items-center gap-1">
                                                                                        <ExternalLink size={10} className="text-gray-600" />
                                                                                        {domain}
                                                                                    </div>
                                                                                </div>
                                                                                <ExternalLink size={14} className="text-gray-600 group-hover:text-white transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100" />
                                                                            </a>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                              </div>
                                          </div>
                                      )) : null}

                                      {/* 3. AI Answer Text */}
                                      <div className={`w-full pl-[1.125rem] ${message.searchInfo && (message.searchInfo.queries?.length > 0 || message.searchInfo.sources?.length > 0) ? 'mt-3' : ''}`}>
                                          {/* Show pulsating dot when AI is generating response - but NOT for search-only messages */}
                                          {!message.isError &&
                                           !message.parsedAnswer &&
                                           !message.isLoading &&
                                           !message.isGeneratingImage &&
                                           !message.imageData &&
                                           message.sender === 'ai' &&
                                           !message.isThinkingPlaceholder &&
                                           !message.isDotPlaceholder &&
                                           !(message.searchInfo && message.searchInfo.sources && message.searchInfo.sources.length > 0 && !message.text) && (
                                              <div className="flex items-center gap-2 py-2">
                                                  <div className="flex items-center space-x-1 ai-response-dots">
                                                      <div className="w-2 h-2 rounded-full bg-gray-400 dot"></div>
                                                      <div className="w-2 h-2 rounded-full bg-gray-400 dot"></div>
                                                      <div className="w-2 h-2 rounded-full bg-gray-400 dot"></div>
                                                  </div>
                                                  <span className="text-gray-400 text-sm">Generating response...</span>
                                              </div>
                                          )}

                                          {message.isError && message.text && (
                                              <div className={`prose prose-sm prose-invert max-w-none text-red-400 prose-strong:text-red-300 prose-p:my-1.5 prose-li:my-0.5 prose-ol:pl-5 prose-ul:pl-5`}>
                                                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{message.text}</ReactMarkdown> 
                                              </div>
                                          )}

                                          {(message.isGeneratingImage || message.imageData) && (
                                              <ImageContainer message={message} />
                                          )}

                                          {!message.isError && message.parsedAnswer && (
                                                  <div className="prose prose-sm max-w-none dark:!prose-invert text-white prose-strong:text-white prose-strong:font-bold prose-code:text-[#f6b98b] prose-code:px-2 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-[15px] prose-code:font-normal prose-code:font-medium prose-code:before:content-none prose-code:after:content-none prose-pre:bg-[#18171b] prose-pre:rounded-lg prose-pre:border prose-pre:border-[#232021] prose-pre:p-4 prose-pre:font-mono prose-pre:text-white prose-pre:text-[15px] prose-pre:overflow-x-auto">
                                                   <ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeRaw]}
  components={{
    pre: ({children}: any) => <>{children}</>,
                                                        code({node, inline, className, children, ...props}: any) {
      const match = /language-(\w+)/.exec(className || "");
      if (!inline) {
        const codeString = String(children).replace(/\n$/, "");
        if (codeString.includes("\n")) {
                                                              const blockIndex = node?.position?.start?.line ?? (node?.index ?? Date.now());
                                                              const codeBlockId = `${message.id}-code-${blockIndex}`;

                                                              return <CodeBlockWithHeader
                                                                        language={match ? match[1] : "plaintext"}
                                                                        code={codeString}
                                                                        runtimes={pistonRuntimes}
                                                                        runtimesLoading={pistonRuntimesLoading}
                                                                        codeBlockId={codeBlockId}
                                                                        executionState={codeBlockExecutionStates[codeBlockId]}
                                                                        onRunCode={handleCodeBlockRun}
                                                                        onCloseOutput={handleCodeBlockCloseOutput}
                                                                        onEditCode={handleEditCodeBlock}
                                                                        isEditing={editingCodeBlockId === codeBlockId}
                                                                        editingCode={editingCodeBlockId === codeBlockId ? editingCodeContent : ''}
                                                                        onEditCodeChange={setEditingCodeContent}
                                                                        onSaveCodeEdit={handleSaveCodeEdit}
                                                                        onCancelCodeEdit={handleCancelCodeEdit}
                                                                     />;
        } else {
                                                                      return <code className="bg-[#232021] rounded px-2 py-1 font-mono text-[15px] text-[#f6b98b] align-middle max-w-full">{codeString}</code>;
                                                                  }
                                                              }
                                                              return <code className={className} {...props}>{children}</code>;
    },
  }}
>
  {message.parsedAnswer}
</ReactMarkdown>
                                               </div>
                                          )}
                                      </div>
                                       
                                      {/* 4. Action Buttons */}
                                      {!message.isError && !message.isLoading && message.parsedAnswer && (
                                          <div
                                              className={`flex items-center justify-between pl-3 action-buttons
                                                ${isLastAiMessage
                                                  ? 'opacity-100 visible'
                                                  : 'opacity-0 group-hover:opacity-100 invisible group-hover:visible transition-opacity duration-150'
                                                }`}
                                           >
                                              <div className="flex items-center gap-2">
                                                  <button onClick={() => handleRegenerate(message.id)} className="p-1 text-gray-400 hover:text-gray-200 rounded-md" aria-label="Regenerate response"><RefreshCcw size={14} /></button>
                                                  <button
                                                      onClick={() => handleCopy(message.parsedAnswer, message.id)}
                                                      className="p-1 text-gray-400 hover:text-gray-200 rounded-md"
                                                      aria-label="Copy response"
                                                      disabled={copiedAiMessageId === message.id}
                                                  >
                                                      {copiedAiMessageId === message.id ? (
                                                          <Check size={14} className="text-green-400" />
                                                      ) : (
                                                       <Copy size={14} />
                                                      )}
                                                   </button>
                                                  <button
                                                      onClick={() => handleEditAiMessage(message.id, message.parsedAnswer || message.text || '')}
                                                      className="p-1 text-gray-400 hover:text-gray-200 rounded-md"
                                                      aria-label="Edit response"
                                                      disabled={editingAiMessageId !== null}
                                                  >
                                                      <Pencil size={14} />
                                                   </button>
                                                  <button
                                                      onClick={(e) => handleOpenFeedbackPopup(e, message.id)}
                                                      className={`p-1 rounded-md ${
                                                          feedbackStatusMap[message.id] === 'liked'
                                                              ? 'text-green-500 hover:text-green-400'
                                                              : 'text-gray-400 hover:text-gray-200'
                                                      }`}
                                                      aria-label="Like response"
                                                  >
                                                       <ThumbsUp size={14} />
                                                   </button>
                                                  <button
                                                      onClick={(e) => handleOpenDislikePopup(e, message.id)}
                                                      className={`p-1 rounded-md ${
                                                          feedbackStatusMap[message.id] === 'disliked'
                                                              ? 'text-red-500 hover:text-red-400'
                                                              : 'text-gray-400 hover:text-gray-200'
                                                      }`}
                                                      aria-label="Dislike response"
                                                  >
                                                       <ThumbsDown size={14} />
                                                   </button>
                                                  {message.modelIdUsed && (
                                                      <button
                                                          onClick={() => setExpandedInfoMessageId(
                                                              expandedInfoMessageId === message.id ? null : message.id
                                                          )}
                                                          className={`p-1 rounded-md ${
                                                              expandedInfoMessageId === message.id
                                                                  ? 'text-gray-200'
                                                                  : 'text-gray-400 hover:text-gray-200'
                                                          }`}
                                                          aria-label="Show model info"
                                                      >
                                                          <Info size={14} />
                                                   </button>
                                                  )}
                                              </div>
                                              {/* Inline Info Display */}
                                              {expandedInfoMessageId === message.id && message.modelIdUsed && (
                                                  <div className="flex items-center gap-3 text-xs text-gray-500">
                                                      {message.timestamp && (
                                                          <span className="text-gray-600">{formatMessageTime(message.timestamp)}</span>
                                                      )}
                                                      <span>{message.modelIdUsed.split('/').pop()}</span>
                                                      {message.answerTokenCount !== undefined && (
                                                          <span>{message.answerTokenCount} tokens</span>
                                                      )}
                                                  </div>
                                              )}
                                          </div>
                                      )}
                                      </>
                                      )}
                                 </div>
                             )}
                          </div>
                        </React.Fragment>
                       );
                   })
               )}
              </div>
              </div>

        {/* Scroll to Bottom Button */}
        {showScrollToBottom && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-20 right-4 z-20 p-2 text-gray-400 bg-[#0e0e10]/80 hover:bg-[#2a2a2d] rounded-full shadow-lg hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
            style={{ right: isContextPanelOpen ? `calc(${contextPanelWidth}px + 1rem)` : '1rem' }} // Adjust position based on panel
            aria-label="Scroll to bottom"
          >
            <ChevronDown size={20} />
          </button>
        )}

        {/* Bottom Input Section */}
        <div className={`${isMultiInterface ? 'max-w-full px-2' : (isWideChatEnabled ? 'max-w-[72rem]' : 'max-w-3xl')} w-full relative px-2 md:px-4 pb-2 md:pb-4 absolute bottom-0 left-0 right-0 z-10 ${
          isMultiInterface ? 'mx-auto' : (
            chatAlignment === 'left' ? 'ml-0 mr-auto' :
            chatAlignment === 'right' ? 'ml-auto mr-0' :
            'mx-auto'
          )
        }`}
             style={{ right: isContextPanelOpen && !isMultiInterface ? `${contextPanelWidth}px` : '0px' }} // Adjust right edge (not in multi-interface)
        >
          {/* Queue Container */}
          {queue.messages.length > 0 && (
            <div className="mb-3 bg-[#0e0e10] border border-[#1e1e21] rounded-lg shadow-md">
              <div className="w-full flex items-center justify-between p-3 text-left text-gray-300 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{queue.messages.length} in queue</span>
                </div>
                <button
                  onClick={toggleQueueExpansion}
                  className="p-1 hover:bg-[#2a2a2d] transition-colors rounded"
                >
                  <ChevronDown 
                    size={16} 
                    className={`transition-transform duration-200 ${queue.isExpanded ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>
              
              {queue.isExpanded && (
                <div className="px-3 pb-3 space-y-2">
                  {queue.messages.map((queuedMessage, index) => (
                    <div 
                      key={queuedMessage.id}
                      className="flex items-center justify-between p-2 bg-[#0e0e10]/80 rounded-md border border-[#1e1e21]/50"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="w-4 h-4 rounded-full border-2 border-[#1e1e21] flex-shrink-0"></div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-300 truncate">
                            {queuedMessage.text || `Task ${index + 1}`}
                          </div>
                          {queuedMessage.attachedFiles.length > 0 && (
                            <div className="text-xs text-gray-500 mt-1">
                              {queuedMessage.attachedFiles.length} file(s) attached
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => removeFromQueue(queuedMessage.id)}
                        className="p-1 text-gray-400 hover:text-red-400 hover:bg-red-900/30 rounded transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Input Box Area */}
          <div className="chat-input-container relative bg-[#0e0e10] border border-[#1e1e21] rounded-xl p-2.5 md:p-3 input-box-top-fade" style={{ boxShadow: '0 -20px 40px 10px #0a0a0b' }}>
            {isContextLimitReached && (
              <div className="mb-3 p-2.5 border border-red-600/70 bg-red-900/30 rounded-lg text-red-400 text-xs shadow-md">
                {contextLimitWarning}
              </div>
            )}
            {attachedFiles.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2 border-b border-[#2a2a2d] pb-3">
                    {attachedFiles.map((file) => (
                        <div
                            key={file.id}
                            className="flex items-center relative group"
                        >
                            {file.fileObject && file.type.startsWith('image/') ? (
                                <div className="relative">
                                    <img
                                        src={URL.createObjectURL(file.fileObject)}
                                        alt={file.name}
                                        className="w-11 h-11 rounded-lg object-cover flex-shrink-0 border border-[#1e1e21] group-hover:border-[#6b7280] transition-all duration-200 ease-out cursor-pointer group-hover:scale-[1.02]"
                                        onClick={() => {
                                            if (file.fileObject) {
                                                setFullScreenImageUrl(URL.createObjectURL(file.fileObject));
                                                setIsFullScreenImageOpen(true);
                                                setViewerShowsDownloadButton(false);
                                            }
                                        }}
                                    />
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemoveAttachedFile(file.id);
                                        }}
                                        className="w-[18px] h-[18px] flex items-center justify-center rounded-md bg-[#0e0e10] border border-[#1e1e21] text-gray-400 hover:text-white hover:border-red-500 hover:bg-red-500/20 opacity-0 group-hover:opacity-100 absolute top-[-6px] right-[-6px] transition-all duration-200 ease-out active:scale-90"
                                        aria-label="Remove file"
                                    >
                                        <X size={10} />
                                    </button>
                                </div>
                            ) : (
                                <div className="relative">
                                    <div
                                        className={`h-11 rounded-lg flex items-center gap-2 px-3 bg-[#0e0e10] border border-[#1e1e21] group-hover:border-[#6b7280] transition-all duration-200 ease-out text-[13px] text-gray-300 group-hover:text-white ${file.fileObject ? 'cursor-pointer group-hover:scale-[1.01]' : 'cursor-default opacity-70'}`}
                                        onClick={() => {
                                            if (file.fileObject) {
                                                handleShowFileInContextPanel(file);
                                            }
                                        }}
                                    >
                                        <FileText size={14} className={file.fileObject ? "text-gray-400 group-hover:text-gray-300" : "text-gray-600"} />
                                        <span className="truncate max-w-[140px]" title={file.name}>{file.name}</span>
                                        {!file.fileObject && (
                                            <span className="text-[11px] text-gray-600 ml-0.5">(recent)</span>
                                        )}
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemoveAttachedFile(file.id);
                                        }}
                                        className="w-[18px] h-[18px] flex items-center justify-center rounded-md bg-[#0e0e10] border border-[#1e1e21] text-gray-400 hover:text-white hover:border-red-500 hover:bg-red-500/20 opacity-0 group-hover:opacity-100 absolute top-[-6px] right-[-6px] transition-all duration-200 ease-out active:scale-90"
                                        aria-label="Remove file"
                                    >
                                        <X size={10} />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                  </div>
                )}

            {/* Textarea Row */}
            <div className="flex items-end relative">
              <textarea
                ref={textareaRef}
                placeholder="Type your message here..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  // Enter without Shift sends the message
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const canSend = inputValue.trim() || attachedFiles.length > 0;
                    if (canSend && !isLoading && !isContextLimitReached) {
                      handleGenerate();
                    }
                  }
                  // Shift+Enter adds a new line (default behavior)
                }}
                className="w-full bg-transparent text-white placeholder-gray-400 pl-2 pr-4 py-1 outline-none resize-none flex-grow focus:ring-0 border-none focus:outline-none focus:shadow-none text-sm scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent"
                style={{ maxHeight: '120px' }}
              />
            </div>
            
            {/* Controls Row */}
            <div className="chat-input-controls flex items-center justify-between mt-1.5 md:mt-2 gap-2">
              <div className="flex items-center gap-1 md:gap-2 relative">
                  {/* Attach Button */}
                  <div className="relative">
                      <button
                          ref={attachButtonRef}
                          onClick={toggleAttachMenu}
                          className="flex items-center justify-center border border-white/[0.08] rounded-lg p-2 text-gray-300 hover:border-white/20 hover:bg-black/20 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-white/[0.08] disabled:hover:bg-transparent disabled:hover:text-gray-300 transition-colors"
                          aria-label="Attach file"
                          disabled={!modelSupportsVision(selectedModel)}
                      >
                          <Paperclip size={16} />
                      </button>
                      {/* Attach Menu */}
                      <div 
                          ref={attachMenuRef}
                          className={`
                              absolute bottom-full left-0 mb-2 z-30 
                              w-64 bg-[#0e0e10] border border-[#1e1e21] rounded-lg shadow-xl 
                              transition-all duration-200 ease-out origin-bottom-left 
                              ${isAttachMenuOpen 
                                  ? 'opacity-100 scale-100 visible' 
                                  : 'opacity-0 scale-95 invisible' 
                              }
                          `}
                       >
                           <div className="p-2 space-y-1">
                               <button onClick={handleUploadFile} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-[#2a2a2d] rounded-md text-left">
                                   <FolderUp size={18} />
                                   <span>Upload a file</span>
                               </button>
                               <div className="border-t border-[#1e1e21] mx-1 my-1"></div>
                               <button onClick={handleShowRecent} className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-300 hover:bg-[#2a2a2d] rounded-md text-left">
                                   <div className="flex items-center gap-3">
                                      <FileClock size={18} />
                                      <span>Recent</span>
                          </div>
                                   <ChevronDown size={16} className="transform -rotate-90 text-gray-400" /> 
                            </button>
                           </div>
                         </div>
                        {/* Recent Files Panel */}
                         <div 
                            ref={recentFilesPanelRef}
                            className={`
                                hide-scrollbar
                                absolute bottom-full left-full ml-2 mb-2 z-30 
                                w-72 bg-[#0e0e10] border border-[#1e1e21] rounded-lg shadow-xl 
                                max-h-[300px] overflow-y-auto 
                                transition-all duration-200 ease-out origin-bottom-left 
                                ${isRecentFilesOpen && isAttachMenuOpen 
                                    ? 'opacity-100 scale-100 visible' 
                                    : 'opacity-0 scale-95 invisible' 
                                }
                            `}
                            style={{ left: 'calc(16rem + 0.5rem)' }} // Adjust positioning if needed
                          >
                                 <div className="p-2 space-y-1">
                                     {/* Recent Files Search */}
                                     {recentFiles.length > 3 && (
                                       <div className="relative mb-2">
                                         <Search size={14} className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-500" />
                                         <input
                                           type="text"
                                           placeholder="Search files..."
                                           value={recentFilesSearchQuery}
                                           onChange={(e) => setRecentFilesSearchQuery(e.target.value)}
                                           className="w-full bg-[#0a0a0b] border border-[#1e1e21] rounded-md py-1.5 pl-7 pr-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-500"
                                         />
                                       </div>
                                     )}
                                     {recentFiles.length === 0 ? (
                                       <div className="px-3 py-6 text-center text-gray-500 text-sm">
                                         <FileClock size={24} className="mx-auto mb-2 text-gray-600" />
                                         <p>No recent files</p>
                                         <p className="text-xs mt-1">Files you attach will appear here</p>
                                       </div>
                                     ) : (
                                       recentFiles
                                         .filter(file =>
                                           !recentFilesSearchQuery.trim() ||
                                           file.name.toLowerCase().includes(recentFilesSearchQuery.toLowerCase())
                                         )
                                         .map((file: typeof recentFiles[0]) => (
                                         <div key={file.id} className="group flex items-center justify-between px-2 py-1.5 text-sm text-gray-300 hover:bg-[#2a2a2d] rounded-md cursor-pointer">
                                           <div 
                                             className="flex items-center gap-2 overflow-hidden flex-1" 
                                             onClick={() => handleReattachRecentFile(file)}
                                           >
                                             {file.type.startsWith('image/') && file.preview ? (
                                               <img src={file.preview} alt="Preview" className="w-6 h-6 rounded object-cover flex-shrink-0" />
                                             ) : file.type === 'application/pdf' || file.name.endsWith('.pdf') ? (
                                               <FileText size={16} className="text-red-400 flex-shrink-0" />
                                             ) : file.type.startsWith('text/') || file.name.match(/\.(txt|md|json|csv|xml|html|css|js|ts|jsx|tsx|py|java|c|cpp|cs|php|rb|go|swift|kt|rs|toml|yaml|yml)$/i) ? (
                                               <FileText size={16} className="text-blue-400 flex-shrink-0" />
                                             ) : (
                                               <FileText size={16} className="text-gray-400 flex-shrink-0" />
                                             )}
                                             <div className="flex flex-col overflow-hidden">
                                                <span className="truncate" title={file.name}>{file.name}</span>
                                               <span className="text-xs text-gray-500">
                                                 {(file.size / 1024).toFixed(1)} KB · {new Date(file.lastUsed).toLocaleDateString()}
                                               </span>
                                             </div>
                                           </div>
                                           <button 
                                             onClick={(e) => {
                                               e.stopPropagation();
                                               handleRemoveRecentFile(file.id);
                                             }}
                                             className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                           >
                                                 <X size={14} />
                                             </button>
                                         </div>
                                       ))
                                     )}
                          </div>
                        </div>
                      </div>
                      {/* Reasoning toggle */}
                      {modelHasReasoningCapability(selectedModel.id, selectedModel) === 'toggleable' && (
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsReasonToggled(prev => !prev);
                          }}
                          className={`flex items-center justify-center border border-white/[0.08] rounded-lg p-2 cursor-pointer select-none hover:bg-black/20 ${isReasonToggled ? 'text-white/70' : 'text-white/15'}`}
                        >
                          <Brain size={16} />
                        </button>
                      )}
              </div>
                  <div className="flex items-center space-x-3">
                     {/* Token Context Window Display with Compress Button - Hidden on mobile (shown in header instead) */}
                     {!isMobile && (() => {
                       const totalUsedTokens = activeConversationTokenCount + currentInputAndSystemTokens;
                       const maxTokens = selectedModel?.maxTokens || 200000;
                       // Use conversation-only tokens for compress threshold (not input)
                       const conversationUsagePercent = conversationTokenCount / maxTokens;
                       const totalUsagePercent = totalUsedTokens / maxTokens;
                       const canCompress = conversationUsagePercent > 0.9 && messages.length > 0;
                       const isNearLimit = totalUsagePercent > 0.9;
                       const isOverLimit = totalUsagePercent > 1;

                       if (canCompress) {
                         // Show compress button only when CONVERSATION history is near limit
                         return (
                           <button
                             onClick={() => compactConversation(selectedModel)}
                             disabled={isLoading}
                             className="group text-xs text-orange-400 hover:text-orange-300 transition-all cursor-pointer disabled:opacity-50 tabular-nums"
                           >
                             <span className="group-hover:hidden">
                               {totalUsedTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens
                             </span>
                             <span className="hidden group-hover:inline font-medium">
                               Compress
                             </span>
                           </button>
                         );
                       }
                       return (
                         <span className={`text-xs tabular-nums ${isOverLimit ? 'text-red-400' : isNearLimit ? 'text-orange-400' : 'text-gray-400'}`}>
                           {totalUsedTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens
                         </span>
                       );
                     })()}

                  {isLoading ? (
                    // While generating: Queue (if typing) else Stop — both 40x40 to match Send/Voice.
                    (inputValue.trim() || attachedFiles.length > 0) ? (
                      <button
                        onClick={addToQueue}
                        title="Add this message to the queue"
                        className="w-10 h-10 rounded-lg bg-[#2a2a2d] text-white hover:bg-[#3a3a3d] flex items-center justify-center transition-colors"
                      >
                        <Plus size={18} />
                      </button>
                    ) : (
                      <button
                        onClick={handleStopGeneration}
                        title="Stop generating"
                        className="w-10 h-10 rounded-lg bg-[#2a2a2d] text-white hover:bg-[#3a3a3d] flex items-center justify-center transition-colors"
                      >
                        <StopCircle size={18} />
                      </button>
                    )
                  ) : (inputValue.trim() || attachedFiles.length > 0) ? (
                    <button
                      onClick={handleGenerate}
                      className="w-10 h-10 rounded-lg bg-[#a760ff] hover:bg-[#b578ff] flex items-center justify-center transition-all shadow-md disabled:opacity-40"
                      disabled={isContextLimitReached}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                    </button>
                  ) : (
                    <button
                      onClick={handleToggleVoiceInput}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all relative ${isVoiceInputActive ? 'bg-[#2a2a2d]/70' : 'bg-[#0e0e10] hover:bg-[#2a2a2d]'}`}
                      aria-label={isVoiceInputActive ? 'Stop voice input' : 'Start voice input'}
                    >
                      {isVoiceInputActive && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="animate-ping h-3.5 w-3.5 rounded-full bg-red-500 opacity-75"></span>
                        </span>
                      )}
                      <Mic size={18} className={`relative ${isVoiceInputActive ? 'text-red-500' : 'text-gray-400'}`} />
                    </button>
                  )}
                </div>
                </div>
          </div>
        </div>

        {/* Hidden File Input */}
        <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileSelected}
            style={{ display: 'none' }} 
            multiple
        />
        
        {/* Portals for Popups/Modals */}
        {hoveredSource && createPortal(
            <SourcePreviewComponent
              hoveredSource={hoveredSource}
              sourcePreviewData={sourcePreviewData}
              sourcePreviewRef={sourcePreviewRef}
              isMouseOverSourcePopup={isMouseOverSourcePopup}
              setHoveredSource={setHoveredSource} // Pass the prop
            />,
            document.body
          )}
        {hoveredIndicatorInfo && createPortal(
            <IndicatorPreviewPopup />,
            document.body
        )}
        {modelTooltipInfo && createPortal(<ModelInfoTooltip />, document.body)}
        {feedbackPopupInfo && createPortal(<FeedbackPopup />, document.body)}
        {dislikePopupInfo && createPortal(<DislikeFeedbackPopup />, document.body)}
        {deleteConfirmationModal.isOpen && createPortal(<DeleteConfirmationModalComponent />, document.body)}
        {isFullScreenImageOpen && createPortal(
          <FullScreenImageViewer
            imageUrl={fullScreenImageUrl}
            isOpen={isFullScreenImageOpen}
            onClose={() => setIsFullScreenImageOpen(false)}
            showDownloadButton={viewerShowsDownloadButton}
          />,
          document.body
        )}

        {/* History Sidebar - Slides in from left */}
        {/* In multi-interface mode: render inside the interface container */}
        {/* In single interface mode: render via portal to document.body */}
        {(() => {
          const historySidebarContent = (
            <>
              <div
                ref={historySidebarRef}
                className={`chat-history-sidebar ${isMultiInterface ? 'absolute' : 'fixed'} z-[50] transition-all duration-300 ease-in-out ${isMultiInterface ? 'w-60' : 'w-[260px]'} bg-[#0e0e10] border border-[#1e1e21] rounded-lg overflow-hidden ${!isHistoryOpen && isMobile ? 'chat-history-sidebar-closed' : ''}`}
                style={{
                  top: '12px',
                  bottom: '12px',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
                  left: isMobile
                    ? (isHistoryOpen ? '12px' : '-100%')
                    : (isMultiInterface
                        ? (isHistoryOpen ? '12px' : '-260px')
                        : (isHistoryOpen ? (isTaskbarHidden ? '8px' : '60px') : (isTaskbarHidden ? '-268px' : '-212px'))),
                  pointerEvents: isHistoryOpen ? 'auto' : 'none'
                }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
              {/* Sidebar content — matches bento demo */}
              <div className="flex flex-col h-full overflow-hidden">
                {/* Search */}
                <div className="p-2.5 border-b border-[#1e1e21]">
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#141416] border border-[#1e1e21] cursor-pointer hover:border-[#1e1e21] transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                    <input
                      type="search"
                      placeholder="Search..."
                      value={historySearchTerm}
                      onChange={(e) => setHistorySearchTerm(e.target.value)}
                      className="w-full bg-transparent text-[11px] text-gray-300 placeholder-white/25 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Conversation list */}
                <div className="flex-1 overflow-y-auto px-1.5 py-1.5 space-y-0.5 hide-scrollbar">
                  {conversationHistory.length === 0 ? (
                    <div className="px-2 py-8 text-center">
                      <p className="text-[12px] text-white/20">No conversations yet</p>
                    </div>
                  ) : (
                    conversationHistory
                      .filter(convo => {
                        const searchTermLower = historySearchTerm.toLowerCase();
                        if (!searchTermLower) return true;
                        if (convo.title.toLowerCase().includes(searchTermLower)) return true;
                        return convo.messages.some(message =>
                          message.text.toLowerCase().includes(searchTermLower)
                        );
                      })
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .map(convo => {
                        const isActive = activeConversationId === convo.id;
                        return (
                          <div key={convo.id} className={`px-2.5 py-1.5 rounded-md text-[13px] truncate cursor-pointer transition-colors group relative ${isActive ? 'text-white/90 bg-white/[0.05]' : 'text-white/40 hover:text-white/60'}`}
                            onClick={() => { if (editingConversationId !== convo.id) { handleLoadConversation(convo.id); toggleHistory(); } }}
                          >
                            {editingConversationId === convo.id ? (
                              <input
                                id={`edit-title-${convo.id}-${interfaceId}`}
                                type="text"
                                value={editTitleText}
                                onChange={(e) => setEditTitleText(e.target.value)}
                                onBlur={handleSaveConversationTitle}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.preventDefault(); handleSaveConversationTitle(); }
                                  else if (e.key === 'Escape') { setEditingConversationId(null); setEditTitleText(''); }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full bg-[#0e0e10] border border-[#1e1e21] rounded px-2 py-0.5 text-[13px] text-white focus:outline-none focus:border-gray-500"
                              />
                            ) : convo.title}
                            {/* Hover actions */}
                            <div className={`absolute top-1/2 right-1 transform -translate-y-1/2 flex items-center gap-0.5 transition-opacity duration-150 ${editingConversationId === convo.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                              {editingConversationId === convo.id ? (
                                <button onClick={(e) => { e.stopPropagation(); handleSaveConversationTitle(); }} className="p-1 text-green-400 hover:bg-green-600/20 rounded" aria-label="Confirm rename"><Check size={12} /></button>
                              ) : (
                                <>
                                  <button onClick={(e) => { e.stopPropagation(); setEditingConversationId(convo.id); setEditTitleText(convo.title); setTimeout(() => document.getElementById(`edit-title-${convo.id}-${interfaceId}`)?.focus(), 50); }} className="p-1 text-white/20 hover:text-white/50 rounded" aria-label="Rename"><FilePenLine size={12} /></button>
                                  <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmationModal({ isOpen: true, conversationId: convo.id, conversationTitle: convo.title }); }} className="p-1 text-white/20 hover:text-red-400 rounded" aria-label="Delete"><Trash2 size={12} /></button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            </div>
            </>
          );

          // In multi-interface mode, render inline; in single mode, use portal
          return isMultiInterface ? historySidebarContent : createPortal(historySidebarContent, document.body);
        })()}

        {/* Context Panel - Only show in single interface mode */}
        {!isMultiInterface && <ContextPanel />}
      </div>
    </>
  );
};

export default ChatWithLLM;

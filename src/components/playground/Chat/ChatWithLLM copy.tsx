import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom'; // Import createPortal
import CodeBlockWithHeader from './CodeBlockWithHeader';
import { Send, ArrowLeftRight, Compass, Waves, Clock, X, ChevronDown, Plus, Play, Download, Brain, Paperclip, FolderUp, Link, FileClock, FileImage, FileText, FilePenLine, MessageSquarePlus, SquarePen, Save, Check, RefreshCcw, Copy, ThumbsUp, ThumbsDown, Lightbulb, ChevronUp, Search, ExternalLink, Info, Feather, Target, Smile, BrainCircuit, MessageSquareX, Quote, Image, WandSparkles, FileX, Trash2, WrapText, StopCircle, Mic, Globe, Loader2, Settings, TrendingUp, CheckCircle } from 'lucide-react'; // Added Mic, StopCircle, Globe, Loader2
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

// Updated Model List for OpenRouter
const mockModels = [
  // --- OpenAI Models --- 
  { id: "openai/o3", name: "o3", maxTokens: 200000 },
  { id: "openai/o4-mini-high", name: "o4 mini high", maxTokens: 128000 },
  { id: "openai/gpt-4o-2024-11-20", name: "GPT-4o", maxTokens: 128000 },
  { id: "openai/gpt-4.1", name: "GPT-4.1", maxTokens: 128000 },
  
  // --- Anthropic Models --- 
  { id: "anthropic/claude-opus-4", name: "Claude Opus 4", maxTokens: 200000 },
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", maxTokens: 200000 },
  { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet", maxTokens: 200000 },
  { id: "anthropic/claude-3.5-sonnet:beta", name: "Claude 3.5 Sonnet", maxTokens: 200000 },
  { id: "anthropic/claude-3.5-haiku:beta", name: "Claude 3.5 Haiku Beta", maxTokens: 200000 },

  // --- Google Models --- 
  { id: "google/gemini-2.5-pro-preview", name: "Gemini 2.5 Pro Preview", maxTokens: 1048576 },
  { id: "google/gemini-2.5-flash-preview-05-20", name: "Gemini 2.5 Flash Preview", maxTokens: 1048576 },
  { id: "google/gemma-3n-e4b-it:free", name: "Gemma 3n", maxTokens: 32768 },

  // --- Meta Models --- 
  { id: "meta-llama/llama-4-scout:free", name: "Llama 4 Scout", maxTokens: 32768 },
  { id: "meta-llama/llama-4-maverick:free", name: "Llama 4 Maverick", maxTokens: 32768 },

  // --- Mistral Models --- 
  { id: "mistralai/mistral-medium-3", name: "Mistral Medium 3", maxTokens: 32768 },
  { id: "mistralai/mistral-small-3.1-24b-instruct:free", name: "Mistral Small 3.1", maxTokens: 32768 },
  
  // --- DeepSeek Models --- 
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1", maxTokens: 128000 },
  { id: "deepseek/deepseek-chat-v3-0324:free", name: "DeepSeek V3", maxTokens: 163840 },
  
  // --- Qwen Models --- 
  { id: "qwen/qwen3-235b-a22b:free", name: "Qwen3 235B", maxTokens: 40960 },
  { id: "qwen/qwq-32b:free", name: "QWQ 32B", maxTokens: 131072 },
  
  // --- X-AI Models --- 
  { id: "x-ai/grok-3-beta", name: "Grok 3 Beta", maxTokens: 32768 },
  { id: "x-ai/grok-3-mini-beta", name: "Grok 3 Mini Beta", maxTokens: 32768 },
];

// Define models for which we force thinking display if reasoning was on but markers are missing
const modelsToForceThinkingDisplay = [
    'google/gemini-2.5-pro-preview',
    'google/gemini-2.5-flash-preview-05-20',
    'google/gemini-2.5-flash-preview-05-20:thinking',
    'x-ai/grok-3-beta',
    'x-ai/grok-3-mini-beta',
    'anthropic/claude-3.7-sonnet:thinking',
    'deepseek/deepseek-r1'
];

// Helper to format large token counts
const formatTokens = (tokens: number): string => {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(0)}k`;
  } 
  return tokens.toString();
};

// Helper function to get company name from model ID prefix
const getCompanyNameFromModelId = (modelId: string): string => {
  if (modelId.startsWith('openai/')) return 'OpenAI';
  if (modelId.startsWith('anthropic/')) return 'Anthropic';
  if (modelId.startsWith('google/')) return 'Google';
  if (modelId.startsWith('meta-llama/')) return 'Meta';
  if (modelId.startsWith('mistralai/')) return 'Mistral';
  if (modelId.startsWith('deepseek/')) return 'Deepseek';
  if (modelId.startsWith('qwen/')) return 'Alibaba'; // Renamed Qwen
  if (modelId.startsWith('x-ai/')) return 'xAI';
  // Add more mappings as needed
  return 'Other'; // Fallback
};

// Group models by company
interface CompanyModels {
  companyName: string;
  models: typeof mockModels; // Array of model objects
}

const groupedModels = mockModels.reduce<CompanyModels[]>((acc, model) => {
  const companyName = getCompanyNameFromModelId(model.id);
  let companyGroup = acc.find(group => group.companyName === companyName);
  if (!companyGroup) {
    companyGroup = { companyName, models: [] };
    acc.push(companyGroup);
  }
  companyGroup.models.push(model);
  return acc;
}, []);

// Sort companies (optional, but nice)
groupedModels.sort((a, b) => a.companyName.localeCompare(b.companyName));
// Sort models within each company (optional)
groupedModels.forEach(group => {
  group.models.sort((a, b) => a.name.localeCompare(b.name));
});

// TODO: Replace with actual tokenizer library (e.g., tiktoken) for accurate count
const estimateTokens = (text: string): number => {
  // Very rough estimate: average 4 chars per token
  return Math.ceil(text.length / 4);
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
    const thinkingRegex = /^\s*(?:#{1,6}\s+)?\**?Thinking Process:\**?\s*/im;
    const answerRegex = /^\s*(?:#{1,6}\s+)?\**?Final Answer:\**?\s*/im;
    const trimmedText = fullText.trim();

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
    background-color: #1f1f20;
    border: 1px solid #3a3a3d;
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
    background-color: #252526;
    border-bottom: 1px solid #3a3a3d;
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
    background-color: #252526;
    border-top: 1px solid #3a3a3d;
    font-size: 0.75rem;
  }

  /* Image generation styles */
  .image-container {
    width: 100%;
    max-width: 512px; /* Maximum width for the final image */
    background-color: #1f1f20; /* Fallback background */
    border: 1px solid #3a3a3d; /* Fallback border */
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
    background-color: #252526; /* Loading background */
    border-color: #252526; /* Match background for loading */
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
    background-color: #252526;
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

  /* Context Panel Styles */
  .context-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    /* width: 400px; */ /* Removed fixed width, will be set by inline style */
    background-color: #1f1f20;
    border-left: 1px solid #3a3a3d;
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
    left: -2px; /* Position slightly outside to be on the edge */
    top: 0;
    bottom: 0;
    width: 5px; /* Wider draggable area */
    cursor: col-resize;
    background-color: transparent; /* Make it invisible but draggable */
    z-index: 1; /* Ensure it's above the panel content for dragging */
  }

  /* Add transition to main content */
  .main-content-transition {
    transition: padding-right 0.3s ease-in-out, right 0.3s ease-in-out, width 0.3s ease-in-out;
  }

  .context-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background-color: #252526;
    border-bottom: 1px solid #3a3a3d;
  }

  .context-panel-title {
    font-size: 16px;
    font-weight: 600;
    color: #e4e4e7;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .context-panel-close {
    padding: 6px;
    color: #a1a1aa;
    border-radius: 4px;
    transition: all 0.2s ease;
  }

  .context-panel-close:hover {
    background-color: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }

  .context-panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .context-panel-content code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.9em;
    padding: 2px 4px;
    background-color: #2d2d30;
    color: #e1e1e6;
    border-radius: 3px;
  }

  .context-panel-content pre {
    background-color: #2d2d30;
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto; /* This allows horizontal scroll if a single line is too long despite wrapping */
    margin: 12px 0;
  }

  .context-panel-content pre code {
    background-color: transparent;
    padding: 0;
    /* white-space: pre-wrap; */ /* Removed static style, will be dynamic */
    font-size: 14px;
    line-height: 1.5;
    /* word-break: break-all; */ /* Removed static style, will be dynamic */
  }

  /* Custom Scrollbar for Context Panel Content */
  .context-panel-content::-webkit-scrollbar {
    width: 8px;
  }
  .context-panel-content::-webkit-scrollbar-track {
    background: #252526; /* Dark gray track background */
    border-radius: 4px;
  }
  .context-panel-content::-webkit-scrollbar-thumb {
    background: #3a3a3d; /* Slightly lighter gray thumb */
    border-radius: 4px;
  }
  .context-panel-content::-webkit-scrollbar-thumb:hover {
    background: #555555; /* Lighter gray on hover */
  }
  .context-panel-content {
    scrollbar-width: thin; /* For Firefox */
    scrollbar-color: #3a3a3d #252526; /* thumb track - For Firefox */
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

// Enhanced Xeno Search Loading Component
const XenoSearchLoadingAnimation: React.FC = () => {
  return (
    <div className="xeno-search-loading">
      <div className="xeno-loading-spinner"></div>
      <div className="xeno-search-text-container">
        <span className="xeno-search-text">
          Search through the web<span className="xeno-typing-dots"></span>
        </span>
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

const ChatWithLLM: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isReasonToggled, setIsReasonToggled] = useState(true);
  const [isSearchToggled, setIsSearchToggled] = useState(false);
  const [selectedModel, setSelectedModel] = useState(mockModels[0]);
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  
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
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [savedSystemPrompt, setSavedSystemPrompt] = useState('');
  const [isSystemPromptSaved, setIsSystemPromptSaved] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedAiMessageId, setCopiedAiMessageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showThinkingId, setShowThinkingId] = useState<string | null>(null);
  const [thinkingPlaceholderId, setThinkingPlaceholderId] = useState<string | null>(null);
  const [liveTimerValue, setLiveTimerValue] = useState<number | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null); // Added state for AbortController

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

  const [feedbackStatusMap, setFeedbackStatusMap] = useState<Record<string, 'liked' | 'disliked' | null>>({});
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const topBarRef = useRef<HTMLDivElement>(null);
  const leftButtonsRef = useRef<HTMLDivElement>(null);
  const rightButtonsRef = useRef<HTMLDivElement>(null);
  const [showTopBarBackground, setShowTopBarBackground] = useState(false);

  const companyDropdownButtonRef = useRef<HTMLButtonElement>(null);
  const companyListContainerRef = useRef<HTMLDivElement>(null);
  const modelListContainerRef = useRef<HTMLDivElement>(null);

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
        headers: { 'Content-Type': 'application/json' },
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


  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [inputValue]);

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
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  // Update dependencies - remove isModelListOpen
  }, [isAttachMenuOpen, isRecentFilesOpen, isSystemPromptOpen, modelTooltipInfo, feedbackPopupInfo, dislikePopupInfo, isCompanyDropdownOpen]); 

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

  // --- NEW: Load/Save History from localStorage ---
  useEffect(() => {
    // Load history on initial mount
    const savedHistory = localStorage.getItem('chatHistory');
    if (savedHistory) {
      try {
        const parsedHistory: Conversation[] = JSON.parse(savedHistory);
        // Basic validation (check if it's an array)
        if (Array.isArray(parsedHistory)) {
             // Further validation could be added here (e.g., check structure of items)
             setConversationHistory(parsedHistory);
             // console.log("Chat history loaded from localStorage.");
             // Optional: Load the last conversation on startup
             // if (parsedHistory.length > 0) {
             //    const lastConversation = parsedHistory[0]; // Assuming sorted newest first later
             //    setActiveConversationId(lastConversation.id);
             //    setMessages(lastConversation.messages);
             // }
        } else {
            console.warn("Invalid chat history format found in localStorage. Ignored.");
            localStorage.removeItem('chatHistory'); // Clear invalid data
        }
      } catch (error) {
        console.error("Error parsing chat history from localStorage:", error);
        localStorage.removeItem('chatHistory'); // Clear corrupted data
      }
    }
  }, []); // Empty dependency array ensures this runs only once on mount

  // --- NEW: Load/Save Recent Files from localStorage ---
  useEffect(() => {
    // Load recent files on initial mount
    const savedRecentFiles = localStorage.getItem('recentFiles');
    if (savedRecentFiles) {
      try {
        const parsedRecentFiles = JSON.parse(savedRecentFiles);
        if (Array.isArray(parsedRecentFiles)) {
          // Filter out files older than 7 days and limit to 20 most recent
          const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
          const validRecentFiles = parsedRecentFiles
            .filter(file => file.lastUsed > sevenDaysAgo)
            .sort((a, b) => b.lastUsed - a.lastUsed)
            .slice(0, 20);
          setRecentFiles(validRecentFiles);
        }
      } catch (error) {
        console.error("Error parsing recent files from localStorage:", error);
        localStorage.removeItem('recentFiles');
      }
    }
  }, []);

  useEffect(() => {
    // Save recent files whenever they change
    if (recentFiles.length > 0) {
      try {
        localStorage.setItem('recentFiles', JSON.stringify(recentFiles));
      } catch (error) {
        console.error("Error saving recent files to localStorage:", error);
      }
    }
  }, [recentFiles]);

  useEffect(() => {
    // Save history whenever it changes (and has items)
    if (conversationHistory.length > 0) {
      prepareHistoryForStorage(conversationHistory)
        .then(serializableHistory => {
        try {
            localStorage.setItem('chatHistory', JSON.stringify(serializableHistory));
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
     // If history becomes empty, remove it from storage
     else if (localStorage.getItem('chatHistory')) { 
         localStorage.removeItem('chatHistory');
     }
  }, [conversationHistory]); // Run whenever conversationHistory state updates
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
        const response = await fetch('/api/piston/runtimes');
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
    currentModel: typeof mockModels[0],
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

    // --- Refactored Capability Check --- 
    const modelId = currentModel.id;
    const reasonAlwaysOnModels = [
        'qwen/qwq-32b:free', 'qwen/qwen3-235b-a22b:free',
        'deepseek/deepseek-r1', 'google/gemini-2.5-pro-preview',
        'openai/o4-mini-high', 'openai/o3'
    ];
    const reasonToggleableModels = [
        'anthropic/claude-3.7-sonnet', 'google/gemini-2.5-flash-preview-05-20',
        'x-ai/grok-3-beta', 'x-ai/grok-3-mini-beta'
    ];

    let reasoningCapability: 'alwaysOn' | 'toggleable' | 'disabled';
    if (reasonAlwaysOnModels.includes(modelId)) reasoningCapability = 'alwaysOn';
    else if (reasonToggleableModels.includes(modelId)) reasoningCapability = 'toggleable';
    else reasoningCapability = 'disabled';

    const effectiveReasoningState = 
        reasoningCapability === 'alwaysOn' ? true :
        reasoningCapability === 'disabled' ? false :
        isReasonToggled;

    // --- Determine actual model ID to use for the API ---
    // Handle toggleable reasoning models that use different IDs when reasoning is enabled
    const toggleableReasoningModelsWithThinking: Record<string, string> = {
        'anthropic/claude-3.7-sonnet': 'anthropic/claude-3.7-sonnet:thinking',
        'google/gemini-2.5-flash-preview-05-20': 'google/gemini-2.5-flash-preview-05-20:thinking'
    };
    
    let actualModelIdForApi = baseModelId;
    if (taskArg !== 'image' && isGpt4oAndSearchActive) {
        actualModelIdForApi = "openai/gpt-4o-search-preview";
    } else if (taskArg !== 'image' && effectiveReasoningState && toggleableReasoningModelsWithThinking[baseModelId]) {
        actualModelIdForApi = toggleableReasoningModelsWithThinking[baseModelId];
    }

    // --- Determine Placeholder & API Flags based on Capability --- 
    const isGpt41 = currentModel.id === 'gpt-4.1';
    const is20Flash = currentModel.id === 'google/gemini-2.0-flash-001';
    
    // Helper function to check if a model is excluded from reasoning processing
    const isModelExcludedFromReasoning = (modelId: string): boolean => {
        const modelsToExcludeMarkers = [
            'anthropic/claude-3.5-sonnet:beta',
            'deepseek/deepseek-chat-v3-0324:free'
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
            headers: { 'Content-Type': 'application/json' },
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
                console.log("[Debug] Received structured reasoning response with separate thinking/answer fields.");
                thinking = data.thinking;
                answer = data.answer;
                localHasThinking = !!thinking;
                rawTextForState = localHasThinking ? `Thinking Process:\n${thinking}\n\nFinal Answer:\n${answer}` : answer;
            } else if (data.text) {
                 // console.log(`[Debug] Parsing raw text from backend as reasoning was TRUE.`);
                 // ADDED LOG - Show only first 50 characters of AI response for debugging
                 console.log('[FRONTEND PARSING] Raw data.text for parseResponse (truncated):', data.text.substring(0, 50) + (data.text.length > 50 ? '... [AI response truncated for logging]' : ''));
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

        console.log("[DEBUG] fetchAiResponse searchInfo determination:", {
            hasXenoContext: !!xenoContext,
            hasDirectXenoSearchInfo: !!xenoSearchInfo,
            hasPendingXenoSearchInfo: !!pendingXenoSearchInfo,
            hasDataSearchInfo: !!data.searchInfo,
            directInfoSources: xenoSearchInfo?.sources?.length || 0,
            pendingInfoSources: pendingXenoSearchInfo?.sources?.length || 0
        });

        // PRIORITY 1: Use directly passed xenoSearchInfo (fixes state timing issue)
        if (xenoSearchInfo) {
            console.log("[fetchAiResponse] Using directly passed Xeno search info with", xenoSearchInfo.sources?.length, "sources");
            finalSearchInfoToUse = xenoSearchInfo;
            setPendingXenoSearchInfo(null); // Clear state since we're using direct parameter
        }
        // PRIORITY 2: Use pending state info (fallback for backwards compatibility)
        else if (xenoContext && pendingXenoSearchInfo) {
            console.log("[fetchAiResponse] Using pending Xeno search info for the AI message with", pendingXenoSearchInfo.sources?.length, "sources");
            finalSearchInfoToUse = pendingXenoSearchInfo;
            setPendingXenoSearchInfo(null); // Clear after use
        } else if (pendingXenoSearchInfo) {
            // Fallback: if pending info exists but xenoContext wasn't passed (should be rare)
            console.warn("[fetchAiResponse] Pending Xeno search info found without xenoContext. Using it anyway.");
            finalSearchInfoToUse = pendingXenoSearchInfo;
            setPendingXenoSearchInfo(null);
        }

        console.log("[DEBUG] Final searchInfo to use:", {
            hasFinalSearchInfo: !!finalSearchInfoToUse,
            finalSearchInfoSources: finalSearchInfoToUse?.sources?.length || 0,
            finalSearchInfoQueries: finalSearchInfoToUse?.queries?.length || 0
        });
        // ---- END MODIFICATION ----
        
        if (finalSearchInfoToUse?.sources && finalSearchInfoToUse.sources.length > 0) {
            const highlightResult = highlightTextWithSources(answer, finalSearchInfoToUse);
            finalAnswer = highlightResult.processedHtml;
            markerMap = highlightResult.markerToSourceIndices;
            sourcesUsed = highlightResult.uniqueSourcesUsed;
            if (sourcesUsed.length > 0) {
                 const sourcesWithActualUrls = sourcesUsed.map(source => ({
                    originalUri: source.uri,
                    actualUrl: source.uri ? extractActualUrl(source.uri) : ''
                 }));
                 const sourcesToFetch = sourcesWithActualUrls.filter(sourceInfo => sourceInfo.actualUrl && !sourceMetadataCache[sourceInfo.actualUrl]);
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
        }

        // --- Force thinking display for specific models when reasoning was active ---
        // For certain models, we want the "Thoughts" UI section to appear even if parseResponse 
        // didn't find explicit markers, allowing the UI to show appropriate fallback messages
        if (reasoningStateForThisCall && // If reasoning was active for this API call
            !localHasThinking &&         // AND parseResponse found no "Thinking Process:" marker
            modelsToForceThinkingDisplay.includes(data.modelIdUsed || actualModelIdForApi) // AND it's one of these specific models
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
        };

        console.log("[DEBUG] Final AI message constructed:", {
            messageId: updatedMessage.id,
            hasSearchInfo: !!updatedMessage.searchInfo,
            searchInfoQueries: updatedMessage.searchInfo?.queries?.length || 0,
            searchInfoSources: updatedMessage.searchInfo?.sources?.length || 0,
            searchInfoSourceTitles: updatedMessage.searchInfo?.sources?.map(s => s.title) || []
        });

        // Debug log with truncated AI response content for logging
        const updatedMessageForLogging = JSON.parse(JSON.stringify(updatedMessage));
        if (updatedMessageForLogging.parsedAnswer && updatedMessageForLogging.parsedAnswer.length > 50) {
            updatedMessageForLogging.parsedAnswer = updatedMessageForLogging.parsedAnswer.substring(0, 50) + '... [AI answer truncated for logging]';
        }
        if (updatedMessageForLogging.text && updatedMessageForLogging.text.length > 50) {
            updatedMessageForLogging.text = updatedMessageForLogging.text.substring(0, 50) + '... [AI text truncated for logging]';
        }
        if (updatedMessageForLogging.thinkingContent && updatedMessageForLogging.thinkingContent.length > 50) {
            updatedMessageForLogging.thinkingContent = updatedMessageForLogging.thinkingContent.substring(0, 50) + '... [AI thinking truncated for logging]';
        }
        if (updatedMessageForLogging.parsedThinking && updatedMessageForLogging.parsedThinking.length > 50) {
            updatedMessageForLogging.parsedThinking = updatedMessageForLogging.parsedThinking.substring(0, 50) + '... [AI thinking truncated for logging]';
        }
        console.log(`[Debug] Final updatedMessage object constructed for ${selectedModel.id} (AI content truncated):`, JSON.stringify(updatedMessageForLogging));

        // Reset expanded thoughts if the *final* response doesn't have thinking content
        if (!updatedMessage.hasThinking) {
            setShowThinkingId(null);
        }
            
        // --- Update Messages State and History ---
        setMessages(prevMessages => {
            const newMessages = [...prevMessages.filter(msg => msg.id !== localPlaceholderId), updatedMessage]; // Use updatedMessage
                
                const now = Date.now();
                if (activeConversationId) {
                if (!isUpdatingConversationRef.current) {
                    isUpdatingConversationRef.current = true;
                        setConversationHistory(prevHistory => 
                            prevHistory.map(convo => 
                                convo.id === activeConversationId 
                                    ? { 
                                        ...convo, 
                                        messages: newMessages, 
                                        timestamp: now, 
                                    systemPrompt: savedSystemPrompt || undefined
                                      } 
                                    : convo
                            )
                        );
                        // console.log("Updated conversation in history:", activeConversationId);
                    // Reset guard after state update (or in a useEffect based on conversationHistory)
                    }
                } else {
                    if (newMessages.length >= 2 && !isCreatingConversationRef.current) { 
                    isCreatingConversationRef.current = true;
                        const newConvoId = `convo-${now}`;
                        const firstUserMessage = newMessages.find(m => m.sender === 'user');
                    const title = firstUserMessage?.text.substring(0, 40) || "Untitled Chat";
                        
                        const newConversation: Conversation = {
                            id: newConvoId,
                            title: title,
                            timestamp: now,
                            messages: newMessages,
                        systemPrompt: savedSystemPrompt || undefined
                        };
                        
                        setConversationHistory(prevHistory => [newConversation, ...prevHistory]);
                        setActiveConversationId(newConvoId);
                        // console.log("Created new conversation in history:", newConvoId);
                    // Reset guard
                }
            }

            return newMessages;
        });

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

      const imageModel = mockModels.find(m => m.id === imageModelId);
      if (!imageModel) {
        throw new Error(`Image model with ID ${imageModelId} not found in mockModels.`);
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
        userImageAttachment: userImageAttachmentPayload,
        userFileAttachment: userFileAttachmentPayload,
    };
    // --- End user message preparation ---

    setInputValue('');
    setAttachedFiles([]);

    let currentMessageHistory: ChatMessage[] = [...messages, newUserMessage];
    setMessages(currentMessageHistory);

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
            // TEMPORARILY DISABLE DEEP SEARCH - always use regular search
            if (false && isXenoDeepMode) { // Changed: if (isXenoDeepMode) to if (false && isXenoDeepMode)
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

                // FIXED: Generate a single consistent search ID for both WebSocket and API
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
                    isXenoDeepSearchContainer: true, // Add flag to identify deep search containers
                };
                
                // Add the deep search message to history
                setMessages(prev => [...prev, deepSearchMessage]);

                try {
                    // Start deep search with WebSocket connection using consistent search ID
                    const wsUrl = `ws://localhost:8000/ws/deep-search/${searchId}`;
                    const ws = new WebSocket(wsUrl);
                    
                    let finalResults: any = null;
                    let searchPhase = 'initializing';
                    let searchProgress = 0;
                    let searchMessage = 'Initializing deep search...';
                    
                    ws.onopen = async () => {
                        console.log('[Xeno Deep] WebSocket connected');
                        
                        // Start the deep search process using the same search ID
                        const response = await fetch('http://localhost:8000/api/start-deep-search', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                query: enhancedQuery.query.trim(),
                                search_type: 'deep',
                                num_results: 5,
                                search_id: searchId // FIXED: Use the same searchId
                            }),
                        });

                        if (!response.ok) {
                            throw new Error(`Deep search API failed: ${response.status}`);
                        }
                    };

                    ws.onmessage = (event) => {
                        try {
                            const update = JSON.parse(event.data);
                            console.log('[Xeno Deep] Received update:', update);
                            
                            if (update.type === 'progress_update') {
                                const { phase, progress, message, data } = update.data;
                                searchPhase = phase;
                                searchProgress = progress;
                                searchMessage = message;
                                
                                // Update deep search state for UI
                                setDeepSearchState({
                                    phase,
                                    progress,
                                    message,
                                    data,
                                    isActive: phase !== 'completed'
                                });
                                
                                // Update the deep search message with progress
                                setMessages(prev => prev.map(msg => 
                                    msg.id === deepSearchMessageId 
                                        ? { 
                                            ...msg, 
                                            text: `🔍 Deep Search Progress: ${Math.round(progress)}% - ${message}`,
                                            searchInfo: {
                                                ...msg.searchInfo!,
                                                // Update with current data if available
                                                sources: data?.final_results?.sources?.map((source: any) => ({
                                                    uri: source.url,
                                                    title: source.title
                                                })) || msg.searchInfo!.sources
                                            }
                                          }
                                        : msg
                                ));
                                
                                // Store final results when completed
                                if (phase === 'completed' && data?.final_results) {
                                    finalResults = data.final_results;
                                }
                            }
                        } catch (error) {
                            console.error('[Xeno Deep] Error parsing WebSocket message:', error);
                        }
                    };

                    ws.onclose = async () => {
                        console.log('[Xeno Deep] WebSocket closed');
                        setIsXenoSearching(false);
                        setDeepSearchState(prev => ({ ...prev, isActive: false }));
                        
                        if (finalResults) {
                            console.log('[Xeno Deep] Final results received:', {
                                total_sources: finalResults.total_sources,
                                sources_count: finalResults.sources?.length || 0,
                                has_summary: !!finalResults.comprehensive_summary
                            });
                            
                            // Transform results for LLM context
                            const formattedSources = finalResults.sources?.map((source: any, index: number) => {
                                return `SOURCE ${index + 1}: ${source.title || 'Untitled'}
URL: ${source.url}
SUMMARY: ${source.summary || source.snippet || 'No summary available'}
CONTENT PREVIEW:
${source.snippet ? source.snippet.substring(0, 1000) : 'No content preview'}
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
Initial Sources: ${finalResults.initial_sources || 0}
Deep Sources: ${finalResults.deep_sources || 0}

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
                                sources: finalResults.sources?.map((source: any) => ({
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
                    const response = await fetch('/api/xeno-search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            query: enhancedQuery.query.trim(),
                            search_type: isXenoDeepMode ? 'deep' : 'normal',
                            num_results: Math.min(Math.max(XENO_SEARCH_CONFIG.defaultNumResults, 1), XENO_SEARCH_CONFIG.maxNumResults),
                        }),
                        signal: AbortSignal.timeout(XENO_SEARCH_CONFIG.timeout), // Add timeout based on guide
                    });
                    
                    const xenoData: XenoSearchResultsData = await response.json();

                    // Update the search results message with Xeno results
                    setMessages(prev => prev.map(msg => 
                        msg.id === searchResultsMessageId 
                            ? { 
                                ...msg, 
                                isLoading: false,
                                searchInfo: {
                                    queries: [userTextToSend],
                                    sources: xenoData.sources?.map(source => ({
                                        uri: source.url,
                                        title: source.title || source.url
                                    })) || [],
                                    supports: []
                                }
                              }
                            : msg
                    ));

                    if (!response.ok || xenoData.error) {
                        console.error("Xeno Search Error:", xenoData.error || response.statusText);
                        
                        // Determine specific error message based on guide's error handling
                        let errorMessage = 'Xeno Search Service Unavailable, try again later';
                        if (response.status === 503) {
                            errorMessage = '🔍 Search service is temporarily unavailable. Please try again later.';
                        } else if (response.status === 400) {
                            errorMessage = '🔍 Invalid search query. Please try a different search term.';
                        } else if (response.status === 500) {
                            errorMessage = '🔍 Search processing failed. Please try again later.';
                        } else if (response.status === 504) {
                            errorMessage = '🔍 Search request timed out. Please try again with a simpler query.';
                        } else if (xenoData.error) {
                            errorMessage = `🔍 Search failed: ${xenoData.error}`;
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
                    
                        setPendingXenoSearchInfo(null); // Clear if there was an error
                        return; // Exit early, don't call fetchAiResponse
                    } else {
                        // Performance monitoring based on guide recommendations
                        const searchDuration = Date.now() - searchStartTime;
                        console.log(`[Xeno Search] Completed successfully in ${searchDuration}ms. Found ${xenoData.sources?.length || 0} sources.`);
                        
                        // Save successful search results
                        setXenoSearchResults(xenoData);
                        
                        // ---- START MODIFICATION: Transform and store for next AI message ----
                        transformedSearchInfo = {
                            queries: xenoData.query ? [xenoData.query] : [],
                            sources: xenoData.sources?.map(source => ({
                                uri: source.url,
                                title: source.title || source.url, // Use URL as fallback title
                            })) || [],
                            supports: [], // Xeno search won't have LLM-generated text-linked supports
                        };
                        
                        console.log("[DEBUG] Setting pending Xeno search info:", {
                            queries: transformedSearchInfo.queries,
                            sourcesCount: transformedSearchInfo.sources?.length || 0,
                            sources: transformedSearchInfo.sources?.map(s => ({ uri: s.uri, title: s.title })) || []
                        });
                        
                        setPendingXenoSearchInfo(transformedSearchInfo);
                        // ---- END MODIFICATION ----
                        
                        // Format sources with detailed information
                        const formattedSources = xenoData.sources?.map((source, index) => {
                            return `SOURCE ${index + 1}: ${source.title || 'Untitled'}
URL: ${source.url}
DATE: [Extract date from content if available]
CONTENT:
${source.raw_text ? source.raw_text.substring(0, 2000) : source.snippet || 'No content available'}
----------
`;
                        }).join('\n') || '';
                        
                        // Enhanced augmented prompt based on integration guide recommendations with multimodal context
                        const augmentedPrompt = `
[XENO SEARCH CONTEXT - REAL-TIME WEB RESULTS WITH MULTIMODAL INPUT]

Original Query: "${userTextToSend}"
Enhanced Search Query: "${enhancedQuery.query}"
Search Type: ${xenoData.search_type || 'normal'}
Results Found: ${xenoData.sources?.length || 0} sources
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
  const handleLoadConversation = (conversationId: string) => {
    const conversationToLoad = conversationHistory.find(convo => convo.id === conversationId);
    if (conversationToLoad) {
        // console.log("Loading conversation:", conversationId);
        setActiveConversationId(conversationId);
        setMessages(conversationToLoad.messages);
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
  // --- END NEW ---

  const toggleHistory = () => {
    setIsHistoryOpen(!isHistoryOpen);
  };

  const toggleReason = () => {
    setIsReasonToggled(!isReasonToggled);
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

  const handleModelSelect = (model: typeof mockModels[0]) => {
    setSelectedModel(model);
    setIsCompanyDropdownOpen(false); // Close company dropdown
    setExpandedCompanies(new Set()); // Reset expanded state
    setShowThinkingId(null); // Reset expanded thoughts on model change

    // --- Refactored Logic to sync toggle state based on capability --- 
    syncTogglesForModel(model); // Use the helper function
  };

  // Toggle System Prompt Panel
  const toggleSystemPrompt = () => {
      setIsSystemPromptOpen(!isSystemPromptOpen);
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
      // No checkmark needed for clear
    }
    // If currentPrompt is empty, do nothing (button should be disabled)
  };

  // Placeholder for New Chat action
  const handleNewChat = () => {
      // console.log("New Chat button clicked - Starting new conversation.");
      setMessages([]); // Clear current messages
      setActiveConversationId(null); // Set active ID to null (indicates new chat)
      setInputValue(''); // Clear the input field
      // Optional: Clear other states like system prompt, toggles, attachments if desired
      setSystemPrompt('');
      setSavedSystemPrompt('');
      setIsSystemPromptOpen(false);
      setAttachedFiles([]);
      setShowThinkingId(null);
      // Reset toggles based on the default model's capabilities after clearing
      syncTogglesForModel(mockModels[0]); // Assuming mockModels[0] is the default
  };

  // --- NEW Helper Function to Sync Toggles --- 
  // (Extracted from handleModelSelect to be reusable)
  const syncTogglesForModel = (model: typeof mockModels[0]) => {
     const modelId = model.id; 

     const reasonAlwaysOnModels = [
         'qwen/qwq-32b:free', 'qwen/qwen3-235b-a22b:free',
         'deepseek/deepseek-r1', 'google/gemini-2.5-pro-preview',
         'openai/o4-mini-high', 'openai/o3'
     ];
     const reasonToggleableModels = [
         'anthropic/claude-3.7-sonnet', 'google/gemini-2.5-flash-preview-05-20',
         'x-ai/grok-3-beta', 'x-ai/grok-3-mini-beta'
     ];

     let reasoningCapability: 'alwaysOn' | 'toggleable' | 'disabled';
     let newReasonToggleState: boolean;

     if (reasonAlwaysOnModels.includes(modelId)) {
         reasoningCapability = 'alwaysOn';
         newReasonToggleState = true;
     } else if (reasonToggleableModels.includes(modelId)) {
         reasoningCapability = 'toggleable';
         newReasonToggleState = true; // Default toggleable to ON
     } else {
         reasoningCapability = 'disabled';
         newReasonToggleState = false;
     }
     setIsReasonToggled(newReasonToggleState);

     // Also reset search toggle (always start OFF for new chat/model select)
     // Only disable search if the model doesn't support it
     const searchEnabledModels = [
         'openai/gpt-4o-2024-11-20',
         'openai/gpt-4.1',
         'google/gemini-2.5-flash-preview-05-20',
         'google/gemini-2.5-pro-preview',
         'deepseek/deepseek-chat-v3-0324:free',
         'deepseek/deepseek-r1',
         'qwen/qwen3-235b-a22b:free',
         'qwen/qwq-32b:free',
         'x-ai/grok-3-beta',
         'x-ai/grok-3-mini-beta'
     ];
     const isSearchPossible = searchEnabledModels.includes(modelId);
     if (!isSearchPossible) {
     setIsSearchToggled(false);
     } // Don't automatically turn OFF search if the model supports it, keep user preference

     console.log(`[Sync] Toggles synced for model: ${modelId}. Reason Capability: ${reasoningCapability}. Reason Toggle set to: ${newReasonToggleState}. Search Possible: ${isSearchPossible}. Search Toggle State: ${isSearchToggled}`);
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
        <div className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#1f1f20] border border-[#3a3a3d] rounded-lg shadow-xl max-w-sm w-full overflow-hidden">
                {/* Header */}
                <div className="p-4">
                    <h2 className="text-lg font-semibold text-white">Delete chat?</h2>
                </div>

                {/* Divider */}
                <hr className="border-t border-[#3a3a3d]" />

                {/* Content */}
                <div className="p-4">
                    <p className="text-sm text-gray-300">
                        This will delete <strong className="text-white">{deleteConfirmationModal.conversationTitle}</strong>.
                    </p>
                </div>

                {/* Footer with Buttons */}
                <div className="flex justify-end gap-3 bg-zinc-800/30 px-4 py-3 border-t border-[#3a3a3d]">
                    <button 
                        onClick={handleCancelDelete}
                        className="px-4 py-1.5 rounded-md text-sm font-medium text-gray-300 bg-zinc-600/50 hover:bg-zinc-600/80 transition-colors"
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

  // --- NEW: Calculate total tokens for the active conversation messages ---
  const activeConversationTokenCount = messages.reduce((acc, message) => {
    let messageTokens = 0;
    if (message.sender === 'user') {
      messageTokens = estimateTokens(message.text || '');
    } else { // AI message
      // Use parsedAnswer for AI if available, otherwise fall back to text (e.g., for errors or raw unparsed)
      messageTokens = estimateTokens(message.parsedAnswer || message.text || '');
    }
    return acc + messageTokens;
  }, 0);
  // --- END NEW CALCULATION ---

  // --- NEW: Calculate tokens for the current input and saved system prompt ---
  const currentInputAndSystemTokens = estimateTokens(inputValue) + estimateTokens(savedSystemPrompt);
  // --- END NEW CALCULATION FOR INPUT ---

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
        const response = await fetch('/api/xeno-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: originalPrompt.trim(),
                search_type: isXenoDeepMode ? 'deep' : 'normal',
                num_results: Math.min(Math.max(XENO_SEARCH_CONFIG.defaultNumResults, 1), XENO_SEARCH_CONFIG.maxNumResults),
            }),
            signal: AbortSignal.timeout(XENO_SEARCH_CONFIG.timeout), // Add timeout based on guide
        });
        
        const xenoData: XenoSearchResultsData = await response.json();

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

        if (!response.ok || xenoData.error) {
            console.error("Xeno Search Retry Error:", xenoData.error || response.statusText);
            
            // Determine specific error message based on guide's error handling
            let errorMessage = 'Xeno Search Service Unavailable, try again later';
            if (response.status === 503) {
                errorMessage = '🔍 Search service is temporarily unavailable. Please try again later.';
            } else if (response.status === 400) {
                errorMessage = '🔍 Invalid search query. Please try a different search term.';
            } else if (response.status === 500) {
                errorMessage = '🔍 Search processing failed. Please try again later.';
            } else if (response.status === 504) {
                errorMessage = '🔍 Search request timed out. Please try again with a simpler query.';
            } else if (xenoData.error) {
                errorMessage = `🔍 Search failed: ${xenoData.error}`;
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
    // console.log('Like clicked for message:', messageId);
    // TODO: Add logic to record feedback
  };

  const handleDislike = (messageId: string) => {
    // console.log('Dislike clicked for message:', messageId);
    // TODO: Add logic to record feedback
  };
  // --- End Placeholder Handlers ---

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
          <div className="mb-3 px-3 py-2 bg-[#1a1a1c] rounded-md border border-[#3a3a3d]">
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
            className="w-full mt-3 text-center py-1.5 text-xs text-gray-400 hover:text-white hover:bg-[#3a3a40] rounded-md transition-colors border border-gray-700/30"
          >
            Show all {sourceCount} sources
          </button>
        )}
        
        {isXenoResultsExpanded && (
          <button
            onClick={() => setIsXenoResultsExpanded(false)}
            className="w-full mt-3 text-center py-1.5 text-xs text-gray-400 hover:text-white hover:bg-[#3a3a40] rounded-md transition-colors border border-gray-700/30"
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
      position: 'fixed',
      left: 0,
      top: 0,
      transform: `translate3d(${hoveredIndicatorInfo.position.x}px, ${hoveredIndicatorInfo.position.y}px, 0)`,
      willChange: 'transform',
      zIndex: 9999,
      width: '300px',
      backgroundColor: '#1f1f20',
      border: '1px solid #3a3a3d',
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
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #3a3a3d', fontWeight: 500 }}>
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

    const modelName = mockModels.find(m => m.id === modelTooltipInfo.modelId)?.name || modelTooltipInfo.modelId;

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
      // console.log(`Feedback submitted for message ${messageId}: ${feedbackType}`);
      setFeedbackStatusMap(prev => ({ ...prev, [messageId]: 'liked' }));
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
      background: '#2d2d2f',
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
                className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md text-left transition-colors hover:bg-zinc-600/70"
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
      // console.log(`Dislike feedback submitted for message ${messageId}: ${feedbackType}`);
      setFeedbackStatusMap(prev => ({ ...prev, [messageId]: 'disliked' })); 
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
      background: '#2d2d2f',
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
                className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md text-left transition-colors hover:bg-zinc-600/70"
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
  const handleDeleteConversation = (conversationIdToDelete: string) => {
    // console.log("Attempting to delete conversation:", conversationIdToDelete);
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
  const handleSaveConversationTitle = () => {
      if (!editingConversationId || !editTitleText.trim()) {
          setEditingConversationId(null);
          setEditTitleText('');
          return;
      }
      // console.log("Saving title for:", editingConversationId, "New title:", editTitleText);
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
        headers: { 'Content-Type': 'application/json' },
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
        className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 image-viewer-overlay"
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

  // Context Panel Component
  const ContextPanel = () => {
    if (!contextPanelContent) return null;

    const codeStyle: React.CSSProperties = {
      whiteSpace: contextPanelWrapEnabled ? 'pre-wrap' : 'pre',
      wordBreak: contextPanelWrapEnabled ? 'break-all' : 'normal',
    };

    return (
      <div
        className={`context-panel ${isContextPanelOpen ? 'visible' : ''}`}
        style={{ width: `${contextPanelWidth}px` }}
      >
        <div className="context-panel-drag-handle" onMouseDown={handleMouseDownOnDragHandle} />
        <div className="context-panel-header">
          <div className="context-panel-title">
            {contextPanelContent.type === 'file' && <FileText size={18} />}
            {contextPanelContent.type === 'code' && <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-xs text-white">{"</>"}</div>}
            {contextPanelContent.type === 'context' && <Info size={18} />}
            {contextPanelContent.type === 'model-info' && <Brain size={18} />}
            <span className="truncate">{contextPanelContent.title}</span>
          </div>
          <div className="flex items-center">
            <button
              className="context-panel-close mr-1"
              onClick={() => setContextPanelWrapEnabled(!contextPanelWrapEnabled)}
              title={contextPanelWrapEnabled ? "Disable text wrapping" : "Enable text wrapping"}
            >
              <WrapText size={18} />
            </button>
            <button
              className="context-panel-close"
              onClick={() => setIsContextPanelOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="context-panel-content">
          {contextPanelContent.type === 'file' || contextPanelContent.type === 'code' ? (
            <pre>
              <code style={codeStyle}>{contextPanelContent.content}</code>
            </pre>
          ) : (
            <div className="text-sm text-gray-300 whitespace-pre-wrap">
              {contextPanelContent.content}
            </div>
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

  // --- List of models known to support direct image input ---
  const imageSupportingModelIds = [
    'openai/gpt-4o-2024-11-20',
    'anthropic/claude-opus-4',
    'anthropic/claude-sonnet-4',
    'anthropic/claude-3.7-sonnet',
    'anthropic/claude-3.5-sonnet:beta',
    'anthropic/claude-3.5-haiku:beta',
    'google/gemini-2.5-pro-preview',
    'google/gemini-2.5-flash-preview-05-20',
    'mistralai/mistral-medium-3'
  ];
  // --- END ---

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
      const visionModel = mockModels.find(m => 
        m.id === 'openai/gpt-4o-2024-11-20' || 
        m.id === 'anthropic/claude-3.5-sonnet:beta' ||
        m.id === 'google/gemini-2.5-flash-preview-05-20'
      ) || mockModels[0];
      
      const visionResponse = await fetch('/api/chat/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

        const synthesisModel = mockModels.find(m => 
          m.id === 'openai/gpt-4o-2024-11-20' || 
          m.id === 'anthropic/claude-3.5-sonnet:beta'
        ) || mockModels[0];
        
        const synthesisResponse = await fetch('/api/chat/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

          /* Xeno Search Loading Animation Styles */
          .xeno-search-loading {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 1rem;
            background: linear-gradient(135deg, #1a1a1c 0%, #232426 100%);
            border: 1px solid #3a3a3d;
            border-radius: 0.75rem;
            margin: 0.5rem 0;
          }

          .xeno-loading-spinner {
            width: 20px;
            height: 20px;
            border: 2px solid rgba(59, 130, 246, 0.2);
            border-top: 2px solid #3b82f6;
            border-radius: 50%;
            animation: spin-loader 1s linear infinite;
            flex-shrink: 0;
          }

          @keyframes spin-loader {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          .xeno-search-text-container {
            position: relative;
            overflow: hidden;
            font-size: 0.875rem;
            font-weight: 500;
            color: #4b5563; /* Dark gray base text */
          }

          .xeno-search-text {
            position: relative;
            display: inline-block;
          }

          .xeno-search-text::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, 
              transparent 0%, 
              rgba(255, 255, 255, 0.8) 40%, 
              rgba(255, 255, 255, 1) 50%, 
              rgba(255, 255, 255, 0.8) 60%, 
              transparent 100%);
            mix-blend-mode: overlay;
            animation: sweep-text-beam 2s ease-in-out infinite;
            z-index: 1;
            pointer-events: none;
          }

          @keyframes sweep-text-beam {
            0% { left: -100%; }
            50% { left: 100%; }
            100% { left: 100%; }
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
        `}
      </style>
      {/* Main container with conditional padding for context panel */}
      <div
        ref={chatContainerRef}
        className={`relative flex flex-col h-full text-white overflow-hidden main-content-transition`}
        style={{ paddingRight: isContextPanelOpen ? `${contextPanelWidth}px` : '0px' }}
      >
        {/* Top Bar */}
        <div
          ref={topBarRef}
          className={`absolute top-0 left-0 z-10 flex flex-shrink-0 items-center justify-between px-4 pt-4 pb-0 main-content-transition ${showTopBarBackground ? 'bg-[#121212] !p-4 top-bar-fading-shadow' : 'bg-transparent'}`}
          style={{ right: isContextPanelOpen ? `${contextPanelWidth}px` : '0px' }}
        >
          {/* Left side buttons */}
          <div ref={leftButtonsRef} className="flex items-center gap-2">
              <div className="relative">
              <button 
                      ref={systemPromptButtonRef}
                      onClick={toggleSystemPrompt}
                  onMouseEnter={() => setIsSystemPromptButtonHovered(true)}
                  onMouseLeave={() => setIsSystemPromptButtonHovered(false)}
                  className="flex items-center justify-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-gray-500 transition-colors h-9 w-[13rem]"
              >
                  <FilePenLine size={16} className="flex-shrink-0" />
                      <span>System Prompt</span>
              </button>
                <div className={`absolute left-1/2 -translate-x-1/2 top-full mt-1 pointer-events-none transition-opacity duration-200 ease-in-out ${(isSystemPromptButtonHovered && !isSystemPromptOpen) ? 'opacity-100' : 'opacity-0'}`}>
                  <ChevronDown size={16} className={`text-gray-500 transition-transform duration-200 ease-in-out ${isSystemPromptOpen ? 'rotate-180' : ''}`} />
                </div>
                  <div
                    ref={systemPromptPanelRef}
                    className={`
                      absolute top-full left-0 mt-[10px] z-20 
                    w-[13rem]
                      transition-all duration-200 ease-out origin-top-left 
                      ${isSystemPromptOpen 
                        ? 'opacity-100 scale-100 visible' 
                        : 'opacity-0 scale-95 invisible' 
                      }
                    `}
                  >
                     <textarea
                       placeholder="Enter system prompt (e.g., You are a helpful assistant...)"
                       value={systemPrompt}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSystemPrompt(e.target.value)}
                       className="w-full h-32 p-2 text-sm text-gray-200 placeholder-gray-500 outline-none 
                                  bg-[#1f1f20] border border-[#3a3a3d] rounded-lg shadow-xl 
                                  scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent 
                                resize"
                     />
                  </div>
              </div>
              <button 
                  onClick={handleSaveOrClearSystemPrompt}
                  className="flex items-center justify-center bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-white/80 hover:border-gray-500 transition-colors h-9"
                  aria-label={
                      systemPrompt.trim() !== '' && systemPrompt === savedSystemPrompt 
                          ? "Clear System Prompt" 
                          : "Save System Prompt"
                  }
                  disabled={
                      isSystemPromptSaved ||
                      (systemPrompt.trim() === '' && savedSystemPrompt === '')
                  }
              >
                  {isSystemPromptSaved ? (
                      <Check size={16} className="text-white" />
                  ) : systemPrompt.trim() !== '' && systemPrompt !== savedSystemPrompt ? (
                      <Save size={16} /> 
                  ) : systemPrompt.trim() !== '' && systemPrompt === savedSystemPrompt ? (
                      <X size={16} className="text-gray-400 hover:text-red-400" />
                  ) : (
                      <Save size={16} className="text-gray-600" /> 
                  )}
              </button>
                      </div>

          {/* Right side buttons */}
          <div ref={rightButtonsRef} className="flex items-center gap-2 main-content-transition">
              <button 
                  onClick={handleNewChat}
                  className="flex items-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-gray-500 transition-colors h-9"
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
                  className="flex items-center justify-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-gray-500 transition-colors h-9 w-[13rem]"
                >
                  <Brain size={16} className="text-gray-400 flex-shrink-0" />
                  <span className="truncate">{selectedModel.name}</span>
                </button>
                <div className={`absolute left-1/2 -translate-x-1/2 top-full mt-1 pointer-events-none transition-opacity duration-200 ease-in-out ${(isModelSelectorButtonHovered && !isCompanyDropdownOpen) ? 'opacity-100' : 'opacity-0'}`}>
                  <ChevronDown size={16} className={`text-gray-500 transition-transform duration-200 ease-in-out ${isCompanyDropdownOpen ? 'rotate-180' : ''}`} />
                </div>
                  <div 
                     ref={companyListContainerRef}
                     className={` 
                        absolute top-full right-0 mt-[10px] z-20 
                  transition-all duration-200 ease-out origin-top-right 
                        ${isCompanyDropdownOpen 
                    ? 'opacity-100 scale-100 visible' 
                    : 'opacity-0 scale-95 invisible' 
                  }
                        w-64 bg-[#1f1f20] border border-[#3a3a3d] rounded-lg shadow-xl
                        max-h-[70vh] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent
                `}>
                  <div className="py-1">
                          {groupedModels.map((group) => { 
                              const isExpanded = expandedCompanies.has(group.companyName);
                              const isActiveCompany = getCompanyNameFromModelId(selectedModel.id) === group.companyName;
                              return (
                                  <div key={group.companyName} className="border-b border-zinc-700/50 last:border-b-0">
                                      <button 
                                          onClick={() => { 
                                              setExpandedCompanies(prev => { 
                                                  const newSet = new Set(prev); 
                                                  if (newSet.has(group.companyName)) { 
                                                      newSet.delete(group.companyName); 
                                                  } else { 
                                                      newSet.add(group.companyName); 
                                                  } 
                                                  return newSet; 
                                              }); 
                                          }} 
                                          className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between transition-colors ${ 
                                              isActiveCompany ? 'text-white font-medium' : 'text-gray-300' 
                                          } ${isExpanded ? 'bg-zinc-700/30' : 'hover:bg-zinc-700/50'}`}
                                      > 
                                          <span>{group.companyName}</span> 
                                          <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                      </button>
                                      {isExpanded && (
                                          <div className="pl-4 pr-2 pb-2 pt-1 bg-[#1f1f20]">
                                              {group.models.map((model) => ( 
                      <button 
                        key={model.id}
                        onClick={() => handleModelSelect(model)}
                                                      className={`w-full text-left px-3 py-1.5 my-0.5 text-sm flex items-center gap-2 rounded-md ${ 
                                                          selectedModel.id === model.id 
                                                          ? 'bg-zinc-600/50 text-white' 
                                                          : 'text-gray-400 hover:bg-zinc-600/50 hover:text-gray-200'
                                                      }`}
                                                      title={`Max Tokens: ${model.maxTokens}`} 
                                                  >
                        {model.name} 
                                                      {selectedModel.id === model.id && <Check size={14} className="ml-auto text-green-400" />} 
                      </button>
                    ))}
                    </div>
                                      )}
                </div>
                              );
                          })} 
                      </div> 
                  </div>
            </div>
          </div>
        </div>
        
        {/* Chat Messages Area */}
        <div 
          ref={chatAreaRef} 
          className="hide-scrollbar flex-grow w-full overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent px-2 pt-4 pb-16 main-content-transition"
        >
                        <div className="max-w-[45rem] mx-auto w-full space-y-2">
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
                    
                    // DEBUG: Log message state during render
                    // console.log('[Chat UI Render] Processing message:', JSON.parse(JSON.stringify(message)));

                    // DEBUG: Log message state during render
                    // console.log('[Chat UI Render] Processing message:', JSON.parse(JSON.stringify(message)));
                    // Add detailed check for Thoughts container rendering factors
                    // console.log(`[UI RENDER THOUGHTS CHECK] Message ID: ${message.id}, hasThinking: ${message.hasThinking}, thinkingContent: ${message.thinkingContent ? 'Exists' : 'Empty/Null'}, showThinkingId: ${showThinkingId}`);

                    // Moved these declarations up to be available for all conditions
                    const isUser = message.sender === 'user';
                    const isLastMessage = index === messages.length - 1;
                    const isLastAiMessage = isLastMessage && !isUser;
                    let firstMessageTopMargin = index === 0 ? 'mt-4' : '';
                    if (index === 0 && showTopBarBackground) {
                        firstMessageTopMargin = 'mt-[5rem]';
                    }

                    if (message.isThinkingPlaceholder) {
                        // Default thinking placeholder
                        return (
                            <div key={message.id} className="flex justify-start w-full">
                                <div className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm">
                                    <span className="flex h-2 w-2 relative mr-1">
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-500"></span> 
                                    </span>
                                    <span className="text-gray-400">
                                        {message.id === aiRefinementPlaceholderId 
                                            ? <>Okay, let me figure out{ellipsisText}</> 
                                            : <>{message.text}{liveTimerValue !== null ? `... ${liveTimerValue}s` : '...'}</>}
                                    </span>
                                </div>
                            </div>
                        );
                    } else if (message.isDotPlaceholder) {
                        return (
                            <div key={message.id} className="flex justify-start w-full pl-[1.125rem] py-2">
                                <span className="flex h-2 w-2 relative">
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-500 animate-pulse"></span> 
                                </span>
                            </div>
                        );
                    } else if (message.isCancelled) {
                        return (
                            <div key={message.id} className="group relative flex justify-start w-full">
                                <div className="flex items-center"> {/* Flex row for both elements */}
                                    <div className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-gray-400 italic">
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
                        <div 
                            key={message.id} 
                            className={`flex w-full ${isUser ? 'justify-end pr-4' : 'justify-start'} ${firstMessageTopMargin}`}
                        >
                           {isUser ? (
                               editingMessageId === message.id ? (
                                     <div 
                                         className="flex flex-col bg-[#19191a] border border-[#3a3a3d] rounded-2xl rounded-br-none p-3 max-w-[75%] w-full text-white"
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
                                     <div data-message-id={message.id} className="group flex flex-col items-end max-w-[75%]">
                                           <div 
                                              className="bg-[#19191a] border border-[#3a3a3d] rounded-2xl rounded-br-none p-3 text-white"
                                           >
                                               <p className="text-sm leading-snug whitespace-pre-wrap">{message.text}</p>
                                           </div>
                                           {message.userImageAttachment && (message.userImageAttachment.file || message.userImageAttachment.base64Data) && (
                                             <div className="mt-2 ml-auto mr-0 max-w-[150px]">
                                               <img
                                                 src={message.userImageAttachment.file
                                                        ? URL.createObjectURL(message.userImageAttachment.file)
                                                        : `data:${message.userImageAttachment.type};base64,${message.userImageAttachment.base64Data}`}
                                                 alt={message.userImageAttachment.name}
                                                 className="max-w-full h-auto rounded-lg border border-zinc-600 cursor-pointer"
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
                                              className="mt-2 ml-auto mr-0 max-w-[250px] p-2 flex items-center gap-2 bg-zinc-700/30 border border-zinc-600/50 rounded-lg cursor-pointer hover:bg-zinc-700/50 transition-colors"
                                              onClick={() => {
                                                console.log('[UI Click] Message file clicked:', message.userFileAttachment?.name);
                                                if (message.userFileAttachment) {
                                                  if (message.userFileAttachment.file) {
                                                    console.log('[UI Click] Message file has live file object');
                                                    const fileToShow: AttachedFile = {
                                                      id: `user-attached-${message.userFileAttachment.name}-${message.id}`,
                                                      name: message.userFileAttachment.name,
                                                      type: message.userFileAttachment.type,
                                                      fileObject: message.userFileAttachment.file
                                                    };
                                                    handleShowFileInContextPanel(fileToShow);
                                                  } else {
                                                    console.log('[UI Click] Message file is serialized data');
                                                    // File from history, pass the serialized structure directly
                                                    handleShowFileInContextPanel(message.userFileAttachment as any);
                                                  }
                                                } else {
                                                  console.warn('[UI Click] No file attachment found in message');
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
                                      
                                      {/* 1. Thoughts (Expanded) */}
                                      {message.hasThinking && showThinkingId === message.id && ( 
                                          <div 
                                              onClick={() => setShowThinkingId(null)} 
                                              className={`flex flex-col w-full bg-[#19191a] border border-[#3a3a3d] rounded-2xl px-4 py-3 transition-all duration-200 cursor-pointer hover:border-gray-500 overflow-hidden mb-4 max-h-none`}
                                          >
                                              <div className="flex items-center justify-between w-full">
                                                  <div className="flex items-center gap-3"> 
                                                      <Lightbulb size={18} className={'text-yellow-400'}/> 
                                                      <div className="flex flex-col">
                                                          <span className="text-base font-medium text-gray-100">
                                                              Thoughts 
                                                              {message.thinkingDuration !== undefined && message.thinkingDuration >= 0 && <span className="font-semibold"> for {message.thinkingDuration}s</span>} 
                                                          </span> 
                                                          <div className="flex flex-col mt-0.5">
                                                              <span className="text-xs text-gray-400">
                                                                  Review the step-by-step process 
                                                              </span>
                                                              {message.modelIdUsed?.includes('google/gemini-2.5-pro') && !message.thinkingContent && (
                                                                  <span className="text-xs text-orange-400">
                                                                      (Gemini sometimes provides a direct answer without explicit markers)
                                                                  </span>
                                                              )} 
                                                              {(message.modelIdUsed?.includes('x-ai/grok')) && !message.thinkingContent && (
                                                                  <span className="text-xs text-orange-400">
                                                                      (Grok sometimes provides a direct answer without explicit markers)
                                                                  </span>
                                                              )}
                                                              {!(message.modelIdUsed?.includes('google/gemini-2.5-pro') || message.modelIdUsed?.includes('x-ai/grok')) && 
                                                                  message.modelIdUsed && modelsToForceThinkingDisplay.includes(message.modelIdUsed) && !message.thinkingContent && (
                                                                  <span className="text-xs text-orange-400">
                                                                      (Raw reasoning markers not found in response)
                                                                  </span>
                                                              )}
                                                          </div>
                                                      </div>
                                                  </div>
                                                  <button onClick={(e) => { e.stopPropagation(); setShowThinkingId(null); }} className="p-1 text-gray-400 hover:text-white hover:bg-zinc-700 rounded-full" aria-label="Close Thoughts">
                                                    <X size={18} />
                                                  </button>
                                              </div>
                                              <div className="mt-3 pt-3 border-t border-zinc-700/50 w-full text-sm prose prose-sm prose-invert max-w-none text-gray-300 prose-p:my-1.5 prose-li:my-0.5 prose-ol:pl-5 prose-ul:pl-5"> 
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
                                                      )}

                                      {/* 1. Thoughts (Collapsed Header) */}
                                      {message.hasThinking && showThinkingId !== message.id && (
                                        <div 
                                            onClick={() => setShowThinkingId(message.id)} 
                                            className={`flex flex-col w-full bg-[#19191a] border border-[#3a3a3d] rounded-2xl px-4 py-3 transition-all duration-200 cursor-pointer hover:border-gray-500 overflow-hidden max-h-[80px]`}
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <div className="flex items-center gap-3"> 
                                                    <Lightbulb size={18} className={'text-gray-500'}/> 
                                                    <div className="flex flex-col">
                                                        <span className="text-base font-medium text-gray-100">
                                                            Thoughts 
                                                            {message.thinkingDuration !== undefined && message.thinkingDuration >= 0 && <span className="font-semibold"> for {message.thinkingDuration}s</span>} 
                                                        </span> 
                                                        <div className="flex flex-col mt-0.5">
                                                            <span className="text-xs text-gray-400">
                                                                Click to expand
                                                            </span>
                                                            {message.modelIdUsed?.includes('google/gemini-2.5-pro') && !message.thinkingContent && (
                                                                <span className="text-xs text-orange-400">
                                                                    (Gemini sometimes provides a direct answer without explicit markers)
                                                                </span>
                                                            )}
                                                            {(message.modelIdUsed?.includes('x-ai/grok')) && !message.thinkingContent && (
                                                                <span className="text-xs text-orange-400">
                                                                    (Grok sometimes provides a direct answer without explicit markers)
                                                                </span>
                                                            )}
                                                            {!(message.modelIdUsed?.includes('google/gemini-2.5-pro') || message.modelIdUsed?.includes('x-ai/grok')) && 
                                                                message.modelIdUsed && modelsToForceThinkingDisplay.includes(message.modelIdUsed) && !message.thinkingContent && (
                                                                <span className="text-xs text-orange-400">
                                                                    (Raw reasoning markers not found in response)
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <ChevronDown size={20} className={`text-gray-400 transition-transform duration-200`} /> 
                                                      </div>
                                                  </div>
                                              )}
 
                                      {/* 2. Grounding Info Box */}
                                      {(() => {
                                          // Debug logging for search info rendering
                                          if (message.sender === 'ai' && !message.isError) {
                                              console.log(`[DEBUG UI] Message ${message.id} searchInfo check:`, {
                                                  hasSearchInfo: !!message.searchInfo,
                                                  queries: message.searchInfo?.queries?.length || 0,
                                                  sources: message.searchInfo?.sources?.length || 0,
                                                  shouldShow: !!(message.searchInfo && (message.searchInfo.queries?.length > 0 || message.searchInfo.sources?.length > 0))
                                              });
                                          }
                                          return null;
                                      })()}
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
                                                      // Regular Xeno search: always show loading animation
                                                      <XenoSearchLoadingAnimation />
                                                  )}
                                              </div>
                                          ) : (
                                          <div className="w-full pl-[1.125rem]">
                                              <div 
                                                    className="bg-[#1f1f20]/50 border border-[#3a3a3d]/60 rounded-lg p-3 space-y-2 cursor-pointer transition-colors hover:border-[#555] search-results-container"
                                                onClick={() => {
                                                    setExpandedSourcesMap(prev => ({ ...prev, [message.id]: !prev[message.id] }));
                                                }}
                                              >
                                                {(() => {
                                                    if (!message.searchInfo?.sources || message.searchInfo.sources.length === 0) return null;
                                                    const isExpanded = expandedSourcesMap[message.id];
                                                    const sources = message.searchInfo.sources;
                                                    const sourceCount = sources.length;
                                                    if (!isExpanded) {
                                                        const iconsToShow = sources.slice(0, 5);
                                                        const iconOverlap = '0.5rem'; 
                                                        const iconTotalWidth = '1rem'; 
                                                        const iconCount = iconsToShow.length;
                                                        const containerWidth = iconCount > 0 ? `calc((${iconCount - 1} * ${iconOverlap}) + ${iconTotalWidth})` : '0px';
                                                        return (
                                                            <div className="flex items-center gap-2 text-xs p-1.5 rounded-md" title="Click to expand sources">
                                                                <div className="relative flex-shrink-0" style={{ width: containerWidth, height: iconTotalWidth }}>
                                                                    {iconsToShow.map((source, idx) => {
                                                                        const actualUrl = extractActualUrl(source.uri);
                                                                        const favicon = sourceMetadataCache[actualUrl]?.favicon;
                                                                        const fallbackIcon = <div className="w-4 h-4 rounded-full bg-zinc-600 border border-zinc-500" />;
                                                                        return (
                                                                            <div key={idx} className="absolute top-0" style={{ left: `calc(${idx} * ${iconOverlap})`, zIndex: 5 - idx }}>
                                                                                {favicon ? <img src={favicon} alt="" className="w-4 h-4 rounded-full border border-zinc-500 bg-zinc-700 object-cover" onError={(e) => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).style.display = 'none'; }} /> : fallbackIcon}
                                                                            </div>
                                                                        );
                                                                    })} 
                                                                </div>
                                                                <span className="text-gray-300 font-medium">{sourceCount} web page{sourceCount !== 1 ? 's' : ''}</span>
                                                                <ChevronDown size={14} className="ml-auto text-gray-400" />
                                                            </div>
                                                        );
                                                    } else {
                                                        return (
                                                            <div className="flex items-start gap-2 text-xs">
                                                                <Link size={14} className="text-gray-400 flex-shrink-0 mt-0.5" /> 
                                                                <span className="text-gray-400 mt-0.5">Sources:</span>
                                                                <ul className="list-none pl-0 flex flex-wrap gap-x-3 gap-y-1 mt-0">
                                                                    {sources.map((source, idx) => { 
                                                                        const citationCount = message.searchInfo?.supports?.filter(sup => sup.sourceIndices?.includes(idx)).length || 0;
                                                                        return (
                                                                            <li key={idx} className="flex items-center">
                                                                                <span
                                                                                    className="inline-flex items-center justify-center text-xs bg-blue-500/20 text-blue-400 font-medium rounded-md px-1.5 py-0.5 mr-1 cursor-pointer"
                                                                                    onMouseEnter={(e) => handleSourceHover(e, idx, source, message.id)}
                                                                                    onMouseLeave={handleSourceHoverEnd}
                                                                                >[{idx + 1}]</span>
                                                                                <a
                                                                                    href={source.uri}
                                                                                    target="_blank" rel="noopener noreferrer"
                                                                                    className="text-blue-400 hover:text-blue-300 hover:underline"
                                                                                    title={source.uri}
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                    onMouseEnter={(e) => handleSourceHover(e, idx, source, message.id)}
                                                                                    onMouseLeave={handleSourceHoverEnd}
                                                                                >
                                                                                    {source.title || (source.uri ? new URL(source.uri).hostname : 'Invalid URL')} 
                                                                                    {citationCount > 0 && <span className="text-gray-400 font-normal ml-1">+{citationCount}</span>}
                                                                                </a>
                                                                            </li>
                                                                        );
                                                                    })} 
                                                                </ul>
                                                            </div>
                                                        );
                                                    }
                                                })()}
                                              </div>
                                          </div>
                                      )) : null}

                                      {/* 3. AI Answer Text */}
                                      <div className={`w-full pl-[1.125rem] ${message.searchInfo && (message.searchInfo.queries?.length > 0 || message.searchInfo.sources?.length > 0) ? 'mt-3' : ''}`}> 
                                          {/* Show pulsating dot when AI is generating response */}
                                          {!message.isError && !message.parsedAnswer && !message.isLoading && !message.isGeneratingImage && !message.imageData && message.sender === 'ai' && !message.isThinkingPlaceholder && !message.isDotPlaceholder && (
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

                                          {!message.isError && message.parsedAnswer && (() => { 
                                              return ( 
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
                                          ); 
                                          })()}
                                      </div>
                                       
                                      {/* 4. Action Buttons */}
                                      {!message.isError && !message.isLoading && message.parsedAnswer && (
                                          <div 
                                              className={`flex items-center gap-2 pl-3 action-buttons
                                                ${isLastAiMessage 
                                                  ? 'opacity-100 visible' 
                                                  : 'opacity-0 group-hover:opacity-100 invisible group-hover:visible transition-opacity duration-150'
                                                }`}
                                           >
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
                                                      onClick={(e) => {
                                                          if (message.modelIdUsed) { 
                                                              handleShowModelInfo(e, message.id, message.modelIdUsed, message.answerTokenCount);
                                                          }
                                                      }} 
                                                      className="p-1 text-gray-400 hover:text-gray-200 rounded-md" 
                                                      aria-label="Show model info"
                                                  > 
                                                      <Info size={14} /> 
                                               </button>
                                              )} 
                                          </div>
                                      )}
                                 </div>
                             )}
                          </div>
                       );
                   })
               )}
              </div>
              </div>

        {/* Scroll to Bottom Button */}
        {showScrollToBottom && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-20 right-4 z-20 p-2 text-gray-400 bg-zinc-800/50 hover:bg-zinc-700/70 rounded-full shadow-lg hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
            style={{ right: isContextPanelOpen ? `calc(${contextPanelWidth}px + 1rem)` : '1rem' }} // Adjust position based on panel
            aria-label="Scroll to bottom"
          >
            <ChevronDown size={20} />
          </button>
        )}

        {/* Bottom Input Section */}
        <div className="max-w-3xl mx-auto w-full relative px-4 pb-4 
                        absolute bottom-0 left-0 right-0 z-10"
             style={{ right: isContextPanelOpen ? `${contextPanelWidth}px` : '0px' }} // Adjust right edge
        >
          {/* History Panel */}
          <div className={`
            absolute bottom-full left-0 right-0 mb-3 z-10
            bg-[#19191a]/95 backdrop-blur-sm border border-[#3a3a3d] rounded-xl shadow-2xl 
            max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-zinc-800 
            hide-scrollbar
            transition-all duration-300 ease-in-out
            ${isHistoryOpen 
              ? 'opacity-100 translate-y-0 visible'
              : 'opacity-0 translate-y-4 invisible'
            }
          `}>
            {/* History Header */}
            <div className="sticky top-0 bg-zinc-800/90 backdrop-blur-sm py-2 px-4 flex justify-between items-center gap-4 border-b border-zinc-700 z-10">
              <h3 className="text-lg font-semibold text-white flex-shrink-0">History</h3>
              <div className="relative flex-grow mx-2">
                 <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 pointer-events-none" />
                 <input 
                    type="search"
                    placeholder="Search history..."
                    value={historySearchTerm}
                    onChange={(e) => setHistorySearchTerm(e.target.value)}
                    className="w-full bg-zinc-700/50 border border-zinc-600 rounded-md py-1.5 pl-9 pr-3 text-sm text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors h-8"
                 />
              </div>
              <div className="flex items-center flex-shrink-0">
                <button 
                  onClick={toggleHistory}
                  className="p-1 text-gray-400 hover:text-white hover:bg-zinc-700 rounded-md transition-colors"
                  aria-label="Close History"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* History List */}
            <div className="p-4 space-y-2">
              {conversationHistory.length === 0 ? (
              <p className="text-center text-gray-500 text-sm py-8">No history yet.</p>
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
                           let messageSnippet: string | null = null;
                           const searchTermLower = historySearchTerm.toLowerCase();
                           if (searchTermLower && !convo.title.toLowerCase().includes(searchTermLower)) {
                               const matchingMessage = convo.messages.find(message => 
                                   message.text.toLowerCase().includes(searchTermLower)
                               );
                               if (matchingMessage) {
                                   const contextLength = 25;
                                   const index = matchingMessage.text.toLowerCase().indexOf(searchTermLower);
                                   if (index !== -1) {
                                       const start = Math.max(0, index - contextLength);
                                       const end = Math.min(matchingMessage.text.length, index + searchTermLower.length + contextLength);
                                       const prefix = start > 0 ? "... " : "";
                                       const suffix = end < matchingMessage.text.length ? " ..." : "";
                                       const rawSnippet = matchingMessage.text.substring(start, end);
                                       const regex = new RegExp(historySearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                                       messageSnippet = rawSnippet.replace(regex, match => `<strong class="text-blue-300 font-semibold">${match}</strong>`);
                                       messageSnippet = prefix + messageSnippet + suffix;
                                   }
                               }
                           }
                       
                           return (
                               <div 
                                   key={convo.id}
                                   className={`group block w-full rounded-lg transition-colors relative ${ 
                                       activeConversationId === convo.id 
                                           ? 'bg-zinc-700/60'
                                           : 'hover:bg-zinc-700/40'
                                   }`}
                               >
                                   <button 
                                       onClick={() => editingConversationId !== convo.id && handleLoadConversation(convo.id)}
                                       className={`block w-full text-left p-3 ${activeConversationId === convo.id ? 'cursor-default' : ''}`}
                                       disabled={editingConversationId === convo.id}
                                    >
                                       <div className="pr-16">
                                           {editingConversationId === convo.id ? (
                                               <input 
                                                   id={`edit-title-${convo.id}`}
                                                   type="text"
                                                   value={editTitleText}
                                                   onChange={(e) => setEditTitleText(e.target.value)}
                                                   onBlur={handleSaveConversationTitle}
                                                   onKeyDown={(e) => {
                                                       if (e.key === 'Enter') {
                                                           e.preventDefault(); 
                                                           handleSaveConversationTitle();
                                                       } else if (e.key === 'Escape') {
                                                           setEditingConversationId(null); 
                                                           setEditTitleText('');
                                                       } 
                                                   }}
                                                   onClick={(e) => e.stopPropagation()}
                                                   className="w-full bg-zinc-600 border border-zinc-500 rounded px-2 py-0.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                               />
                                           ) : (
                                               <p className="text-sm font-medium text-gray-200 truncate">
                                                   {convo.title}
                                                   <span className="text-gray-500 text-xs ml-2">
                                                       / {formatTokens(convo.messages.reduce((acc, msg) => acc + estimateTokens(msg.sender === 'user' ? msg.text : (msg.parsedAnswer || msg.text || '')), 0))} Tokens
                                                   </span>
                                               </p>
                                           )}
                                           <p className="text-xs text-gray-400 mt-1 flex items-center flex-wrap"> 
                                               <span className="mr-2 flex-shrink-0">{new Date(convo.timestamp).toLocaleString()}</span> 
                                               {activeConversationId === convo.id && (
                                                                                                      <span className="mr-2 flex-shrink-0 px-1.5 py-0.5 rounded bg-green-800/50 text-green-300 text-[10px] font-medium">
                                                       Current
                                                   </span>
                                               )}
                                               {messageSnippet && (
                                                    <span 
                                                        className="text-gray-500 italic truncate" 
                                                        dangerouslySetInnerHTML={{ __html: messageSnippet }}
                                                    />
                                               )}
                                           </p>
                                       </div>
                                   </button>
                                   <div className={`absolute top-1/2 right-3 transform -translate-y-1/2 flex items-center gap-1 transition-opacity duration-150 ${ 
                                       editingConversationId === convo.id 
                                           ? 'opacity-100 visible'
                                           : 'opacity-0 invisible group-hover:opacity-100 group-hover:visible'
                                       }`}
                                    >
                                       {editingConversationId === convo.id ? (
                                           <button 
                                               onClick={(e) => { 
                                                   e.stopPropagation(); 
                                                   handleSaveConversationTitle(); 
                                               }} 
                                               className="p-1.5 text-green-400 hover:text-white hover:bg-green-600/50 rounded-md" 
                                               aria-label="Confirm rename"
                                           >
                                               <Check size={14} />
                                           </button>
                                       ) : (
                                           <>
                                               <button onClick={(e) => { e.stopPropagation(); console.log('Share:', convo.id); }} className="p-1.5 text-gray-400 hover:text-white hover:bg-zinc-600/50 rounded-md" aria-label="Share conversation">
                                                   <ExternalLink size={14} />
                                               </button>
                                               <button 
                                                   onClick={(e) => { 
                                                       e.stopPropagation(); 
                                                       // console.log('Edit:', convo.id);
                                                       setEditingConversationId(convo.id); 
                                                       setEditTitleText(convo.title);
                                                       setTimeout(() => {
                                                           const inputElement = document.getElementById(`edit-title-${convo.id}`);
                                                           inputElement?.focus();
                                                       }, 50); 
                                                   }} 
                                                   className={`p-1.5 rounded-md transition-colors text-gray-400 hover:text-white hover:bg-zinc-600/50`} 
                                                   aria-label="Edit conversation title"
                                                >
                                                   <FilePenLine size={14} />
                                               </button>
                                               <button 
                                                   onClick={(e) => { 
                                                       e.stopPropagation(); 
                                                       const title = conversationHistory.find(c => c.id === convo.id)?.title || 'this chat';
                                                       setDeleteConfirmationModal({ isOpen: true, conversationId: convo.id, conversationTitle: title });
                                                   }} 
                                                   className="p-1.5 text-red-500/70 hover:text-red-400 hover:bg-red-900/30 rounded-md" 
                                                   aria-label="Delete conversation"
                                                >
                                                   <Trash2 size={14} />
                                               </button>
                                           </>
                                       )}
                                   </div>
                               </div>
                           );
                       })
               )}
            </div>
          </div>

          {/* Input Box Area */}
          <div className="relative bg-[#19191a] border border-[#3a3a3d] rounded-2xl p-4 shadow-lg input-box-top-fade">
            {isContextLimitReached && (
              <div className="mb-3 p-2.5 border border-red-600/70 bg-red-900/30 rounded-lg text-red-400 text-xs shadow-md">
                {contextLimitWarning}
              </div>
            )}
            {attachedFiles.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2 border-b border-[#3a3a3d] pb-2">
                    {attachedFiles.map((file) => (
                        <div 
                            key={file.id}
                            className={'flex items-center gap-1.5 relative group p-0.5'}
                        >
                            {file.fileObject && file.type.startsWith('image/') ? (
                                <img 
                                    src={URL.createObjectURL(file.fileObject)} 
                                    alt={file.name} 
                                    className="w-10 h-10 rounded-md object-cover flex-shrink-0 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out cursor-pointer"
                                    onClick={() => {
                                        if (file.fileObject) {
                                            setFullScreenImageUrl(URL.createObjectURL(file.fileObject));
                                            setIsFullScreenImageOpen(true);
                                            setViewerShowsDownloadButton(false);
                                        }
                                    }}
                                />
                            ) : (
                                <div
                                    className={`w-auto h-10 rounded-md flex items-center gap-1.5 px-2 bg-zinc-700/50 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out text-sm text-gray-200 ${file.fileObject ? 'cursor-pointer' : 'cursor-default'}`}
                                    onClick={() => {
                                        console.log('[UI Click] Input box file clicked:', file.name);
                                        if (file.fileObject) {
                                            handleShowFileInContextPanel(file);
                                        }
                                    }}
                                >
                                    <FileText size={16} className={file.fileObject ? "text-blue-400" : "text-gray-500"} />
                                    <span className="truncate" title={file.name}>{file.name}</span>
                                    {!file.fileObject && (
                                        <span className="text-xs text-gray-500 ml-1">(recent)</span>
                                    )}
                                </div>
                            )}
                            <button 
                                onClick={() => handleRemoveAttachedFile(file.id)}
                                className={'w-5 h-5 flex items-center justify-center rounded bg-zinc-700 hover:bg-zinc-600 text-white opacity-0 group-hover:opacity-100 absolute top-[-2px] right-[-2px] transition-opacity duration-150 ease-in-out flex-shrink-0'}
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
              <textarea
                ref={textareaRef}
                placeholder="Type your message here..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full bg-transparent text-white placeholder-gray-400 pl-2 pr-10 py-2 outline-none resize-none flex-grow focus:ring-0 border-none focus:outline-none focus:shadow-none text-base scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent"
                style={{ maxHeight: '150px' }}
              />
              <button 
                onClick={toggleHistory}
                className="absolute top-1 right-1 p-2 text-gray-400 hover:text-white transition-colors"
                aria-label="Toggle History"
              >
                <Clock size={18} />
              </button>
            </div>
            
            {/* Controls Row */}
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2 relative">
                  {/* Attach Button */}
                  <div className="relative">
                      <button 
                          ref={attachButtonRef}
                          onClick={toggleAttachMenu}
                          className="flex items-center justify-center bg-[#19191a] border border-[#3a3a3d] rounded-lg p-2 text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-[#3a3a3d] disabled:hover:text-gray-300 transition-colors shadow-inner"
                          aria-label="Attach file"
                          disabled={!imageSupportingModelIds.includes(selectedModel.id)}
                          title={imageSupportingModelIds.includes(selectedModel.id) ? "Attach file" : "File/image attachment not supported by this model"}
                      >
                          <Paperclip size={16} />
                      </button>
                      {/* Attach Menu */}
                      <div 
                          ref={attachMenuRef}
                          className={`
                              absolute bottom-full left-0 mb-2 z-30 
                              w-64 bg-[#19191a] border border-[#3a3a3d] rounded-lg shadow-xl 
                              transition-all duration-200 ease-out origin-bottom-left 
                              ${isAttachMenuOpen 
                                  ? 'opacity-100 scale-100 visible' 
                                  : 'opacity-0 scale-95 invisible' 
                              }
                          `}
                       >
                           <div className="p-2 space-y-1">
                               <button onClick={handleUploadFile} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-zinc-700/50 rounded-md text-left">
                                   <FolderUp size={18} />
                                   <span>Upload a file</span>
                               </button>
                               <button onClick={handleConnectDrive} disabled className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-500 cursor-not-allowed rounded-md text-left">
                                   <Link size={18} className="text-gray-600" />
                                   <span>Connect Google Drive</span>
                                   <span className="ml-auto text-xs text-gray-600">Soon</span>
                               </button>
                               <button onClick={handleConnectOneDrive} disabled className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-500 cursor-not-allowed rounded-md text-left">
                                   <Link size={18} className="text-gray-600" />
                                   <span>Connect Microsoft OneDrive</span>
                                   <span className="ml-auto text-xs text-gray-600">Soon</span>
                               </button>
                               <div className="border-t border-[#3a3a3d] mx-1 my-1"></div>
                               <button onClick={handleShowRecent} className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-300 hover:bg-zinc-700/50 rounded-md text-left">
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
                                w-72 bg-[#19191a] border border-[#3a3a3d] rounded-lg shadow-xl 
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
                                     {recentFiles.length === 0 ? (
                                       <div className="px-3 py-6 text-center text-gray-500 text-sm">
                                         <FileClock size={24} className="mx-auto mb-2 text-gray-600" />
                                         <p>No recent files</p>
                                         <p className="text-xs mt-1">Files you attach will appear here</p>
                                       </div>
                                     ) : (
                                       recentFiles.map((file: typeof recentFiles[0]) => (
                                         <div key={file.id} className="group flex items-center justify-between px-2 py-1.5 text-sm text-gray-300 hover:bg-zinc-700/50 rounded-md cursor-pointer">
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
                                             title="Remove from recent files"
                                           >
                                                 <X size={14} />
                                             </button>
                                         </div>
                                       ))
                                     )}
                          </div>
                        </div>
                      </div>
                      {/* Toggle Button Group with Settings */}
                      <div className="flex items-center">
                        {/* Original Toggle Button Group - solid background */}
                      <div className="flex items-center bg-[#19191a] border border-[#3a3a3d] rounded-lg px-1 py-1 shadow-inner relative z-20">
                        {/* Reason Toggle */}
                        {(() => { 
                            const modelId = selectedModel.id;
                            const reasonAlwaysOnModels = ['qwen/qwq-32b:free', 'qwen/qwen3-235b-a22b:free', 'deepseek/deepseek-r1', 'google/gemini-2.5-pro-preview', 'openai/o4-mini-high', 'openai/o3'];
                            const reasonToggleableModels = ['anthropic/claude-3.7-sonnet', 'google/gemini-2.5-flash-preview-05-20', 'x-ai/grok-3-beta', 'x-ai/grok-3-mini-beta'];
                            let reasoningCapability: 'alwaysOn' | 'toggleable' | 'disabled';
                            if (reasonAlwaysOnModels.includes(modelId)) reasoningCapability = 'alwaysOn';
                            else if (reasonToggleableModels.includes(modelId)) reasoningCapability = 'toggleable';
                            else reasoningCapability = 'disabled';
                            const isVisuallyActive = (reasoningCapability === 'alwaysOn') || (reasoningCapability === 'toggleable' && isReasonToggled);
                            const isClickable = reasoningCapability === 'toggleable';
                            const isDisabledVisual = reasoningCapability === 'disabled';
                            let title = '';
                            if (reasoningCapability === 'alwaysOn') title = 'Reasoning is always active for this model';
                            else if (reasoningCapability === 'toggleable') title = 'Toggle thinking process output';
                            else title = 'Reasoning output not supported for this model';
                            let buttonClass = `px-3 py-1 rounded-md text-sm font-medium transition-colors `;
                            if (isDisabledVisual) buttonClass += 'text-gray-500 cursor-not-allowed';
                            else if (isVisuallyActive) { buttonClass += 'bg-gray-300 text-zinc-900 shadow-sm'; if (!isClickable) buttonClass += ' cursor-not-allowed'; }
                            else buttonClass += 'text-gray-300 hover:bg-zinc-600';
                            return (<button onClick={isClickable ? toggleReason : undefined} disabled={!isClickable} className={buttonClass}>Reason</button>);
                        })()}
                        <div className="w-px h-4 bg-zinc-600 mx-1"></div>
                                                    {/* Xeno Search Toggle - Enhanced with Guide's Recommendations */}
                        <button 
                           onClick={toggleXenoSearch} 
                             onMouseEnter={() => {
                               if (hoverEndTimeoutRef.current) {
                                 clearTimeout(hoverEndTimeoutRef.current);
                                 hoverEndTimeoutRef.current = null;
                               }
                               setIsXenoSearchHovered(true);
                             }}
                             onMouseLeave={() => {
                               hoverEndTimeoutRef.current = setTimeout(() => {
                                 setIsXenoSearchHovered(false);
                               }, 300);
                             }}
                             className={`flex items-center gap-1 px-3 py-1 rounded-md text-sm font-medium transition-all duration-200 relative ${isXenoSearchEnabled ? 'bg-gray-300 text-zinc-900 shadow-sm' : 'text-gray-300 hover:bg-zinc-600'}`}
                             style={{ zIndex: 15 }}>
                           <Globe size={14} className="mr-1" />
                           {/* {isXenoDeepMode ? 'Xeno Deep' : 'Xeno Search'} */}
                           Xeno Search
                          </button> 
                        </div>
                        
                                {/* Xeno Search Settings Button - slides from behind Xeno Search button */}
        {/* <button
          className={`w-6 h-6 flex items-center justify-center rounded-r-md bg-[#19191a] border border-[#3a3a3d] text-sm font-medium transition-all duration-300 ease-out bg-zinc-600 text-gray-300 hover:bg-zinc-500 ${isXenoSearchHovered ? '-ml-px' : '-ml-6'}`}
                          style={{ 
                            zIndex: isXenoSearchHovered ? 10 : 5,
                            transform: isXenoSearchHovered ? 'translateX(0)' : 'translateX(-20px)'
                          }}
                          onMouseEnter={() => {
                            if (hoverEndTimeoutRef.current) {
                              clearTimeout(hoverEndTimeoutRef.current);
                              hoverEndTimeoutRef.current = null;
                            }
                            setIsXenoSearchHovered(true);
                          }}
                          onMouseLeave={() => {
                            hoverEndTimeoutRef.current = setTimeout(() => {
                              setIsXenoSearchHovered(false);
                            }, 300);
                          }}
                                    onClick={(e) => {
            e.stopPropagation();
            setIsXenoDeepMode(!isXenoDeepMode);
            console.log(`[Xeno Mode Toggle] Switched to ${!isXenoDeepMode ? 'Xeno Deep' : 'Xeno Search'} mode`);
                      }}
                        >
                          <ArrowLeftRight size={10} />
                        </button> */}
                </div>
              </div>
                  <div className="flex items-center space-x-3">
                     <span className="text-xs text-gray-400 tabular-nums">
                       {currentInputAndSystemTokens} Tokens
                     </span> 

                    {/* Voice Input Button - MOVED HERE */}
                    <button
                      onClick={handleToggleVoiceInput}
                      className={`p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-zinc-700/50 transition-colors relative ${isVoiceInputActive ? 'bg-zinc-700/70' : 'bg-[#19191a]'}`}
                      aria-label={isVoiceInputActive ? 'Stop voice input' : 'Start voice input'}
                      title={isVoiceInputActive ? 'Stop voice input' : 'Start voice input'}
                    >
                      {/* Pinging element - rendered when active, behind the icon */}
                      {isVoiceInputActive && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="animate-ping h-3.5 w-3.5 rounded-full bg-red-500 opacity-75"></span>
                        </span>
                      )}
                      {/* Mic icon - sits on top of the ping */}
                      <Mic size={18} className={`relative ${isVoiceInputActive ? 'text-red-500' : 'text-gray-400'}`} />
                    </button>

                  {isLoading ? (
                    <button
                      onClick={handleStopGeneration}
                      className="flex items-center justify-center px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-400 h-10 shadow-md"
                      title="Stop Generation"
                    >
                      <StopCircle size={18} />
                      <span className="ml-1.5 text-sm font-semibold">Stop</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleGenerate}
                      className="bg-gray-400 text-zinc-900 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-10 flex items-center justify-center shadow-md"
                      disabled={(!inputValue.trim() && attachedFiles.length === 0) || isContextLimitReached}
                    >
                        <span>Send</span>
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
        {createPortal(<ModelInfoTooltip />, document.body)} 
        {createPortal(<FeedbackPopup />, document.body)} 
        {createPortal(<DislikeFeedbackPopup />, document.body)} 
        {createPortal(<DeleteConfirmationModalComponent />, document.body)} 
        {isFullScreenImageOpen && createPortal(
          <FullScreenImageViewer
            imageUrl={fullScreenImageUrl}
            isOpen={isFullScreenImageOpen}
            onClose={() => setIsFullScreenImageOpen(false)}
            showDownloadButton={viewerShowsDownloadButton}
          />,
          document.body
        )}

        {/* Context Panel */}
        <ContextPanel />
      </div>
    </>
  );
};

export default ChatWithLLM;

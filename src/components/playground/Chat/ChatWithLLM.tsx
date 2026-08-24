import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom'; // Import createPortal
import { Button, IconButton, ListRow, MenuItem, MessageBubble, Spinner, Tab, Textarea, TextInput, useDialog, useGooPill, useMenu, useTabs } from '@xenosystem/elements-react';
// The palettes and the preference that picks one live outside this file now: the CSS at the entry
// point, the resolution beside it. This component still OWNS the switcher — it is the only thing that
// writes these keys — but owning a setting never meant being the only place allowed to read it.
import {
  CHAT_THEME_STORAGE_KEY,
  CHAT_THEME_BRIGHTNESS_STORAGE_KEY,
  THEME_BRIGHTNESS_STEP,
  VISUAL_CHAT_THEME_OPTIONS,
  buildChatThemeStyle,
  getThemePreviewTokens,
  getClosestVisualTheme,
  getRelativeLuminance,
  getVisualThemePosition,
  normalizeThemeBrightness,
  type ChatTheme,
  type ResolvedChatTheme,
} from './chatTheme';
import './chatMock'; // DEV-only offline mock backend (self-installs a fetch interceptor)
import ChatEmptyState, { ComposerRevealControls, type ChatEmptyStateTool } from './ChatEmptyState';
import ChatModelSelector from './ChatModelSelector';
import ChatShareModal from './ChatShareModal';
import { isOutlineDebugOn, OUTLINE_DEBUG_CSS } from './outlineDebug';
import ChatArtifactsPage from './ChatArtifactsPage';
import ChatScheduledPage from './ChatScheduledPage';
import ChatGlobalSettingsPage from './ChatGlobalSettingsPage';
import ChatCustomizePage from './ChatCustomizePage';
import ChatSettingsModal from './ChatSettingsModal';
import {
  bindPendingChatPersona,
  clearPendingChatPersona,
  getChatPersonaId,
  getPersona,
  setChatPersonaId,
  type ChatPersona,
} from './chatCustomize';
import {
  bindPendingChatSkills,
  clearPendingChatSkills,
  getChatProfile,
} from './chatSkillsLibrary';
import { buildChatSystemPrompt, CHAT_MODE_PLACEHOLDERS, modeUsesXenoSearch, type ChatMode } from './chatModeConfig';
import CodeBlockWithHeader from './CodeBlockWithHeader';
import ThinkingAnimation, { ThinkingAnimationInline } from './ThinkingAnimation';
import ThinkingStatus from './ThinkingStatus';
import { chatComplete } from '@/services/aiService';
import { getGroupedModels, GroupedModels, Model } from '@/services/modelService';
import { chatService } from '@/services/chatService';
import { countMessageTokens, estimateTokens as quickEstimateTokens } from '@/services/tokenizerService';
import { userDataService } from '@/services/userDataService';
import { xenoSearchService, type XenoSearchSource, type WebSocketProgress } from '@/services/xenoSearchService';
import type { Conversation as DBConversation, ChatMessage as DBChatMessage } from '@/services/chatService';
import { ArrowUp, Clock, X, ChevronDown, ChevronRight, Plus, Download, Brain, Folder, FolderUp, Link, File, FileClock, FileImage, FileText, FilePenLine, MessageSquare, MessagesSquare, Check, Copy, Search, ExternalLink, Info, Target, MessageSquareX, Image, Stop, Mic, Globe, Settings, TrendingUp, CheckCircle, Pencil, Hand, Pin, Monitor, Archive, Shapes, PanelLeftOpen, Star, Contrast, UserRoundX, RefreshDecl, CopyDecl, CheckDecl, EditDecl, ThumbsUpDecl, ThumbsDownDecl, InfoDecl, XDecl, SearchDecl, PanelLeftCloseDecl, ArrowUpRightDecl, FolderDecl, TrashDecl, BriefcaseDecl, GearDecl, PlusDecl, BookmarkDecl, ArchiveDecl, LayersDecl, StarDecl, FeatherDecl, TargetDecl, SmileDecl, BrainCircuitDecl, MessageSquareXDecl, QuoteDecl, ImageDecl, WandSparklesDecl, FileXDecl, ContrastDecl, UserRoundXDecl, MenuDecl, ShareDecl, MoreVerticalDecl, PaperclipDecl, ChevronDownDecl, ChevronRightDecl, WrapTextDecl, FolderUpDecl, FileClockDecl, PanelRightOpenDecl, PanelRightCloseDecl, MessageSquarePlusDecl, PanelLeftOpenDecl, ArrowRightDecl, CalendarDecl, ClockDecl, BrainDecl, SlidersDecl } from '@/lib/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
// import SourcePreview from './SourcePreview'; // This line should be removed
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu , DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

// Attach the web-session bearer token (same 'xenoos_auth_token' key the rest of the
// app uses) to auth-gated, same-origin backend routes (/api/chat/generate,
// /api/piston/*, /api/fetch-metadata, /api/v2/engine/*) so they don't 401.
// Spread-conditional: a logged-out caller sends no Authorization header (and
// correctly gets 401) rather than a literal "Bearer null".
function withAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('xenoos_auth_token') : null;
  const workspace = typeof localStorage !== 'undefined' ? localStorage.getItem('xeno_active_workspace_id') : null;
  const h: Record<string, string> = { ...extra };
  if (token) h.Authorization = `Bearer ${token}`;
  // Phase 5: active workspace context → pooled billing + resource tenancy on the backend.
  if (workspace) h['x-xeno-workspace'] = workspace;
  return h;
}

// Transient default until the live catalog loads (overridden by the fetch below).
// Uses a REAL endpoint model id — no fabricated fallback.
/** Matches history sidebar `duration-300` close before floating chrome enters. */
const HISTORY_SIDEBAR_CLOSE_MS = 300;

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
    userImageAttachment?: { file?: File; name: string; type: string; base64Data?: string; }; // Updated for serialization (first image; kept for older history)
    /** All image attachments for a user turn — rendered above the text bubble by aspect ratio. */
    userImageAttachments?: { file?: File; name: string; type: string; base64Data?: string; }[];
    userFileAttachment?: { file?: File; name: string; type: string; content?: string; encoding?: 'text' | 'base64' }; // Updated for serialization
    isCancelled?: boolean; // New field to indicate if the AI response was cancelled
    isXenoSearchCancelled?: boolean; // New field to indicate if cancelled due to Xeno Search failure
    answerTokenCount?: number; // NEW: Token count for the AI's answer
    isLoading?: boolean; // NEW: Flag for search loading state
    isXenoDeepSearchContainer?: boolean; // New flag to identify deep search containers
    isStreaming?: boolean; // True while the answer is being revealed (typewriter); actions hidden until done
}

// --- NEW: Interface for Conversation History Item ---
interface Conversation {
    id: string;
    title: string; // e.g., first user message snippet
    timestamp: number; // Unix timestamp (ms) for sorting
    messages: ChatMessage[];
    systemPrompt?: string; // --- Store the system prompt used for this convo --- 
    isPinned?: boolean; // Local pin — floats the chat into the Pinned section
    pinOrder?: number; // Manual order inside Pinned (drag-and-drop)
    isUnread?: boolean;
    isArchived?: boolean;
    projectId?: string | null;
}
// --- END NEW ---

// ---------------------------------------------------------------------------
// DEV-only demo conversation — seeded on first load so the full render path
// (a real multi-turn thread with every message element) is visible with no
// backend. Disable with: localStorage.setItem('xeno_chat_demo', 'off') + reload.
// ---------------------------------------------------------------------------
// Web-source favicon fallback (offline / no metadata): a brand-ish coloured
// tile with the domain's initials — matches the lab's coloured source favicons.
// Exact brand codes + colours from the lab, matched by domain.
const SOURCE_BRANDS: Array<{ m: string; i: string; c: string }> = [
  { m: 'arxiv', i: 'AR', c: '#b31b1b' },
  { m: 'aclanthology', i: 'AC', c: '#ed1c24' },
  { m: 'semanticscholar', i: 'SS', c: '#1857b6' },
  { m: 'springer', i: 'SP', c: '#164f9e' },
  { m: 'openreview', i: 'OR', c: '#8c1b13' },
  { m: 'langchain', i: 'LC', c: '#12856f' },
  { m: 'medium', i: 'MD', c: '#111111' },
  { m: 'github', i: 'GH', c: '#24292f' },
  { m: 'openai', i: 'OA', c: '#0b8f6a' },
  { m: 'eval', i: 'EV', c: '#5a5f66' },
];
const findSourceBrand = (url: string) => {
  const host = (url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  return SOURCE_BRANDS.find((b) => host.includes(b.m)) || null;
};
const sourceBadgeInitials = (url: string): string => {
  const brand = findSourceBrand(url);
  if (brand) return brand.i;
  const host = (url || '').replace(/^https?:\/\//, '').replace(/^www\./, '');
  return (host.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || '?').toUpperCase();
};
const sourceBadgeColor = (url: string): string => {
  const brand = findSourceBrand(url);
  if (brand) return brand.c;
  let h = 0;
  for (let i = 0; i < (url || '').length; i++) h = url.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360} 50% 42%)`;
};

const CHAT_DEMO_ENABLED = (() => {
  try {
    return import.meta.env.DEV && localStorage.getItem('xeno_chat_demo') !== 'off';
  } catch {
    return false;
  }
})();

/* A fixed id, not a timestamp: the demo is registered in the history on every load, and a fresh id each
   time would stack up a new copy of the same conversation on every reload. */
const CHAT_DEMO_CONVERSATION_ID = 'convo-demo';

const DEMO_DIAGRAM_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="132">' +
  '<rect width="560" height="132" rx="12" fill="#16181d"/>' +
  '<g font-family="ui-monospace, monospace" font-size="15" fill="#e6e4df">' +
  '<rect x="26" y="47" width="128" height="38" rx="8" fill="#101216" stroke="#2a2f3a"/><text x="52" y="71">Extract</text>' +
  '<rect x="216" y="47" width="128" height="38" rx="8" fill="#101216" stroke="#2a2f3a"/><text x="236" y="71">Compress</text>' +
  '<rect x="406" y="47" width="128" height="38" rx="8" fill="#101216" stroke="#2a2f3a"/><text x="436" y="71">Render</text>' +
  '</g><g stroke="#6da7ec" stroke-width="2" fill="none"><path d="M160 66h48"/><path d="M350 66h48"/></g></svg>';
const DEMO_DIAGRAM_IMG =
  typeof btoa !== 'undefined'
    ? `data:image/svg+xml;base64,${btoa(DEMO_DIAGRAM_SVG)}`
    : `data:image/svg+xml,${encodeURIComponent(DEMO_DIAGRAM_SVG)}`;

const DEMO_CHART_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">' +
  '<rect width="320" height="200" rx="8" fill="#16181d"/>' +
  '<rect width="320" height="34" fill="#1f2229"/>' +
  '<circle cx="18" cy="17" r="5" fill="#e9603f"/><circle cx="36" cy="17" r="5" fill="#e7b64a"/><circle cx="54" cy="17" r="5" fill="#4caf6a"/>' +
  '<g fill="#3b6ea5"><rect x="30" y="150" width="30" height="26"/><rect x="75" y="120" width="30" height="56"/><rect x="120" y="100" width="30" height="76"/><rect x="165" y="130" width="30" height="46"/><rect x="210" y="84" width="30" height="92"/><rect x="255" y="112" width="30" height="64"/></g>' +
  '<polyline points="45,140 90,116 135,96 180,124 225,80 270,104" fill="none" stroke="#e9603f" stroke-width="3"/></svg>';
const DEMO_CHART_B64 = typeof btoa !== 'undefined' ? btoa(DEMO_CHART_SVG) : '';

const DEMO_ANSWER_1 = [
  '# Structuring a transcript summariser',
  '',
  'Keep it to **three stages**, each with one job. Extract the key turns, compress them into claims, then render. Store the transcript separately so you can *re-summarise* as models improve.',
  '',
  '## The three stages',
  '',
  '- **Extract** — pull decisions, open questions, action items',
  '  - keep the speaker where it matters',
  '  - drop filler turns',
  '- **Compress** — one-line claim per idea',
  '- **Render** — group by theme, emit clean `markdown`',
  '',
  '## At a glance',
  '',
  `![Pipeline: Extract → Compress → Render](${DEMO_DIAGRAM_IMG})`,
  '',
  '| Stage | Input | Output |',
  '| --- | --- | --- |',
  '| Extract | Transcript | Salient turns |',
  '| Compress | Salient turns | Claims |',
  '| Render | Claims | Markdown |',
  '',
  '```ts',
  'export function summarise(turns: Turn[]): Summary {',
  '  const claims = turns',
  '    .filter((t) => t.salient)',
  '    .map((t) => `${t.speaker}: ${compress(t.text)}`);',
  '  return { claims, groupedBy: "theme" };',
  '}',
  '```',
  '',
  '> Re-summarise on demand — never overwrite the transcript. The summary is a view, not the source of truth.',
  '',
  '### Rollout',
  '',
  '- [x] Split the pipeline into three stages',
  '- [x] Add dedupe-by-theme',
  '- [ ] Shadow-run last week’s transcripts',
  '- [ ] Compare side-by-side, then ship behind a flag',
].join('\n');

const DEMO_THINKING_1 = [
  'Let me work through this.',
  '',
  '- The user wants a clean structure for a transcript summariser.',
  '- Three stages keep each responsibility isolated and testable.',
  '- Keep the raw transcript immutable so summaries can be regenerated.',
  '',
  'Proceeding to write the answer with a diagram, a table and a code sketch.',
].join('\n');

const DEMO_ANSWER_2 = [
  'Because **Compress** emits one claim per *turn* instead of per *idea*, adjacent turns on the same topic repeat. Fix it in three moves:',
  '',
  '1. Group salient turns by **theme** before compressing.',
  '2. Dedupe near-duplicate claims — keep the strongest phrasing.',
  '3. Cap each theme to its top-*k* claims by salience.',
  '',
  'Rank turns with a simple salience score, then drop redundancy:',
  '',
  '```python',
  'def salience(t):',
  '    return w * rel(t) + b * pos(t) - lam * redund(t)',
  '```',
  '',
  '| Symptom | Fix |',
  '| --- | --- |',
  '| Same point twice | Dedupe on theme key |',
  '| Filler turns | Raise the salience threshold |',
].join('\n');

const DEMO_THINKING_2 = [
  'Diagnosing the repetition.',
  '',
  '- Searched for extractive-summarisation redundancy control.',
  '- The standard fix is theme clustering plus a redundancy penalty.',
  '',
  'Writing a concise diagnosis with the salience formula and a fix table.',
].join('\n');

const DEMO_SOURCES = [
  { uri: 'https://arxiv.org/abs/2312.06648', title: 'Neural Extractive Summarization with Redundancy Control' },
  { uri: 'https://aclanthology.org/2023.acl-long.155/', title: 'Ranking Sentences for Extractive Summarization' },
  { uri: 'https://langchain.dev/docs/use_cases/summarization', title: 'Grouping and de-duplicating retrieved claims' },
];

// The one-pager answer — custom XENO elements (cover image, diagram, artifact
// card, follow-up chips) as inline-styled HTML so they render 1:1 like the lab
// (inline styles override prose; --chat-* tokens keep them theme-aware).
const DEMO_ANSWER_3 = `<p style="margin:0 0 14px;">Done — here's the whole thing as a shareable one-pager. A cover image, the pipeline at a glance, the editable document, and a short rollout checklist.</p>
<div style="position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--chat-border);margin:14px 0;">
<svg viewBox="0 0 600 220" preserveAspectRatio="none" style="display:block;width:100%;height:auto;">
<defs><linearGradient id="dsky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#20242e"/><stop offset="1" stop-color="#12131a"/></linearGradient><linearGradient id="dwarm" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#cf7f5c"/><stop offset="1" stop-color="#8a5a7f"/></linearGradient></defs>
<rect width="600" height="220" fill="url(#dsky)"/><circle cx="470" cy="66" r="44" fill="url(#dwarm)" opacity="0.85"/>
<path d="M0 165 Q150 115 300 155 T600 142 V220 H0 Z" fill="#171a22"/><path d="M0 185 Q160 145 330 178 T600 168 V220 H0 Z" fill="#0e1016"/></svg>
<span style="position:absolute;left:10px;bottom:10px;font-size:11px;font-family:ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.42);padding:3px 9px;border-radius:7px;">✦ Generated cover image</span>
</div>
<div style="display:flex;align-items:center;padding:14px;border:1px solid var(--chat-border);border-radius:12px;background:var(--chat-surface);overflow-x:auto;margin:14px 0;">
<span style="display:inline-flex;align-items:center;padding:8px 14px;border:1px solid var(--chat-border);border-radius:8px;font-size:12.5px;font-weight:600;background:var(--chat-canvas);color:var(--chat-text);white-space:nowrap;"><i style="width:9px;height:9px;border-radius:2px;margin-right:9px;background:#6ea8d8;display:inline-block;"></i>Extract</span>
<span style="color:var(--chat-muted);margin:0 10px;flex:none;">→</span>
<span style="display:inline-flex;align-items:center;padding:8px 14px;border:1px solid var(--chat-border);border-radius:8px;font-size:12.5px;font-weight:600;background:var(--chat-canvas);color:var(--chat-text);white-space:nowrap;"><i style="width:9px;height:9px;border-radius:2px;margin-right:9px;background:#d8ad5f;display:inline-block;"></i>Compress</span>
<span style="color:var(--chat-muted);margin:0 10px;flex:none;">→</span>
<span style="display:inline-flex;align-items:center;padding:8px 14px;border:1px solid var(--chat-border);border-radius:8px;font-size:12.5px;font-weight:600;background:var(--chat-canvas);color:var(--chat-text);white-space:nowrap;"><i style="width:9px;height:9px;border-radius:2px;margin-right:9px;background:#7fc7a6;display:inline-block;"></i>Render</span>
</div>
<div style="display:flex;align-items:center;gap:13px;padding:13px 15px;border:1px solid var(--chat-border);border-radius:12px;background:var(--chat-surface);margin:14px 0;">
<span style="width:42px;height:42px;border-radius:10px;display:grid;place-items:center;background:var(--chat-hover);color:var(--chat-muted);flex:none;">
<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="butt" stroke-linejoin="round"><path d="M13 3H7a1.4 1.4 0 0 0-1.4 1.4v15.2A1.4 1.4 0 0 0 7 21h10a1.4 1.4 0 0 0 1.4-1.4V9z"/><path d="M13 3v6h6"/><path d="M8 12h8"/><path d="M8 14.6h8"/><path d="M8 17.2h5"/></svg></span>
<span style="flex:1;min-width:0;"><span style="display:block;font-size:14px;font-weight:650;color:var(--chat-text);">Summariser — Team One-Pager</span>
<span style="display:block;font-size:12px;color:var(--chat-muted);margin-top:3px;"><span style="font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--chat-muted);background:var(--chat-hover);padding:1px 7px;border-radius:5px;">Document</span> &nbsp;updated just now · 1 min read</span></span>
<span style="color:var(--chat-muted);font-size:12px;white-space:nowrap;flex:none;display:inline-flex;align-items:center;gap:6px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="butt" stroke-linejoin="round"><path d="M6.5 17.5 17.5 6.5"/><path d="M9 6.5h8.5V15"/></svg>Open</span>
</div>
<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;">
<span style="font-size:12.5px;color:var(--chat-muted);border:1px solid var(--chat-border);border-radius:9px;padding:7px 13px;display:inline-flex;align-items:center;gap:7px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="butt" stroke-linejoin="round"><path d="M13.5 6.5 17.5 10.5 7.5 20.5 3.5 21.5 4.5 17.5Z"/><path d="M11.5 8.5 15.5 12.5"/><path d="M4.6 21.9H12.1"/></svg>Tweak the tone for execs</span>
<span style="font-size:12.5px;color:var(--chat-muted);border:1px solid var(--chat-border);border-radius:9px;padding:7px 13px;display:inline-flex;align-items:center;gap:7px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="butt" stroke-linejoin="round"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 15v3.5A1 1 0 0 0 6 19.5H18A1 1 0 0 0 19 18.5V15"/></svg>Export as PDF</span>
</div>`;

const DEMO_NOW = Date.now();
const buildDemoConversation = (): ChatMessage[] => [
  {
    id: 'demo-u1',
    sender: 'user',
    text: 'How should I structure a transcript summariser? Here’s the spec.',
    timestamp: DEMO_NOW - 600_000,
    userFileAttachment: {
      name: 'summariser-spec.txt',
      type: 'text/plain',
      encoding: 'text',
      content:
        'Transcript Summariser — Spec\n\nThree stages: Extract, Compress, Render.\nKeep the raw transcript immutable.\nRe-summarise on demand as models improve.\n',
    },
  },
  {
    id: 'demo-a1',
    sender: 'ai',
    text: DEMO_ANSWER_1,
    parsedAnswer: DEMO_ANSWER_1,
    parsedThinking: DEMO_THINKING_1,
    hasThinking: true,
    thinkingContent: DEMO_THINKING_1,
    thinkingDuration: 4,
    modelIdUsed: 'openai/gpt-5.6-terra',
    timestamp: DEMO_NOW - 594_000,
  },
  {
    id: 'demo-u2',
    sender: 'user',
    text: 'This is what the current output looks like. Why does it feel repetitive?',
    timestamp: DEMO_NOW - 300_000,
    userImageAttachments: DEMO_CHART_B64
      ? [{ name: 'current-output.svg', type: 'image/svg+xml', base64Data: DEMO_CHART_B64 }]
      : undefined,
  },
  {
    id: 'demo-a2',
    sender: 'ai',
    text: DEMO_ANSWER_2,
    parsedAnswer: DEMO_ANSWER_2,
    parsedThinking: DEMO_THINKING_2,
    hasThinking: true,
    thinkingContent: DEMO_THINKING_2,
    thinkingDuration: 5,
    modelIdUsed: 'openai/gpt-5.6-terra',
    timestamp: DEMO_NOW - 294_000,
    searchInfo: {
      queries: ['extractive summarization salience redundancy'],
      sources: DEMO_SOURCES,
    },
    uniqueSourcesUsed: DEMO_SOURCES.map((s, i) => ({ index: i + 1, uri: s.uri, title: s.title })),
  },
  {
    id: 'demo-u3',
    sender: 'user',
    text: 'Perfect — now put it all together as a shareable one-pager, with a cover image and a diagram.',
    timestamp: DEMO_NOW - 120_000,
  },
  {
    id: 'demo-a3',
    sender: 'ai',
    text: DEMO_ANSWER_3,
    parsedAnswer: DEMO_ANSWER_3,
    parsedThinking: 'Put a decision log first, then the stage diagram and a rollout checklist. Ship it as a document artifact.',
    hasThinking: true,
    thinkingContent: 'Put a decision log first, then the stage diagram and a rollout checklist. Ship it as a document artifact.',
    thinkingDuration: 3,
    modelIdUsed: 'openai/gpt-5.6-terra',
    timestamp: DEMO_NOW - 114_000,
  },
];

const formatConversationListDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString('en-US', options);
};

/** Relative time for project cards — Claude-style ("just now", "2h ago"). */
const formatProjectRelativeTime = (timestamp: number): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatConversationListDate(timestamp);
};

/** Human-readable file size for project files — e.g. "4.2 KB", "1.0 MB". */
const formatProjectFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** File extension label for the Files rail (e.g. "md", "pdf") — max 4 chars. */
const getProjectFileExtension = (name: string): string => {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return 'file';
  return name.slice(i + 1).toLowerCase().slice(0, 4);
};

/** Absolute date for project cards — e.g. "Nov 27, 2024". */
const formatProjectCardDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** Long history titles: right-edge fade always; on hover, slide to reveal the full title. */
const HistoryConversationTitle: React.FC<{
  title: string;
  isSliding: boolean;
}> = ({ title, isSliding }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      const text = textRef.current;
      if (!container || !text) return;
      setDistance(Math.max(0, text.scrollWidth - container.clientWidth));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [title, isSliding]);

  const shouldSlide = isSliding && distance > 0;
  // Claude-style one-shot reveal: constant px/s (not a fixed duration).
  // Open Claude-inspired refs use ~80px/s; we run faster (~180) so the
  // tail is readable within a short hover. Floor/ceiling keep short and
  // very long titles from feeling sticky or crawling.
  const durationSec = Math.min(1.6, Math.max(0.25, distance / 180));

  return (
    <div
      ref={containerRef}
      className="min-w-0 flex-1 overflow-hidden"
      style={{
        maskImage: 'linear-gradient(to right, #000 0%, #000 calc(100% - 1.35rem), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to right, #000 0%, #000 calc(100% - 1.35rem), transparent 100%)',
      }}
    >
      <span
        ref={textRef}
        className="inline-block whitespace-nowrap will-change-transform"
        style={{
          transform: shouldSlide ? `translateX(-${distance}px)` : 'translateX(0)',
          transition: shouldSlide
            ? `transform ${durationSec}s linear`
            : 'transform 180ms ease-out',
        }}
      >
        {title}
      </span>
    </div>
  );
};

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
    background-color: var(--chat-accent-soft);
    border-radius: 0.25rem; /* Added from inline style */
    padding: 0 0.25rem; /* Added from inline style */
  }
  
  .inline-source-citation {
    font-size: 0.75rem;
    color: var(--chat-accent);
    font-weight: 500;
    cursor: pointer;
    vertical-align: super;
    margin-left: 1px;
  }
`;

// CSS styles for source highlighting
const sourceHighlightStyles = `
  .source-highlight {
    background-color: var(--chat-accent-soft);
    border-radius: 0.25rem;
    padding: 0 0.25rem;
    cursor: pointer;
    color: #d1d5db; /* text-[var(--chat-text)] for general text inside */
  }

  .source-highlight a,
  .source-highlight a:hover,
  .source-highlight a:visited { /* Ensure visited links are also styled correctly */
    color: var(--chat-accent);
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
    border-top-color: var(--chat-accent);
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
  /* Centered pop-up window (modal) with a backdrop — not a right-side drawer. */
  .context-panel-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5vh 24px;
    background: color-mix(in srgb, #000 46%, transparent);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.22s ease;
  }
  .context-panel-overlay.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .context-panel {
    position: relative;
    width: min(760px, 100%);
    max-height: 100%;
    background-color: var(--chat-canvas);
    border: 1px solid var(--chat-border);
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
    transform: translateY(10px) scale(0.98);
    opacity: 0;
    transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease;
  }
  .context-panel-overlay.visible .context-panel {
    transform: none;
    opacity: 1;
  }

  .context-panel-drag-handle { display: none; }

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
    background-color: var(--chat-border);
  }

  .main-content-transition {
    transition: padding-right 0.3s ease-in-out, right 0.3s ease-in-out, width 0.3s ease-in-out, margin-left 0.3s ease-in-out, left 0.3s ease-in-out;
  }

  .context-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 11px 12px;
    background-color: var(--chat-canvas);
    border-bottom: 1px solid var(--chat-border);
    flex-shrink: 0;
    gap: 10px;
  }

  .context-panel-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--chat-text);
    display: flex;
    align-items: center;
    gap: 9px;
    overflow: hidden;
    flex: 1;
    min-width: 0;
  }
  .context-panel-title svg { opacity: 1 !important; color: var(--chat-muted); }

  .context-panel-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  /* The .context-panel-btn and .context-panel-btn-icon rules went with the buttons that used
     them: seventy-eight lines spelling out the quiet and ghost variants in CSS, plus a
     .success and an .active that were the hover appearance held on. The variants say all of
     it. (No backticks in here: this block is a template literal and one would end it.) */

  .context-panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
    background-color: var(--chat-canvas);
  }

  .context-panel-content pre {
    background-color: transparent;
    padding: 16px 18px;
    margin: 0;
    overflow-x: auto;
  }

  .context-panel-content pre code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--chat-text);
    background-color: transparent;
    padding: 0;
  }

  .context-panel-edit-area {
    width: 100%;
    height: 100%;
    background-color: var(--chat-canvas);
    color: var(--chat-text);
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
              <a href={sourcePreviewData.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: 'var(--chat-accent)', textDecoration: 'underline', textUnderlineOffset: '2px' }}>
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
          <Search size={18} className="text-[var(--chat-text)] relative z-10" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-semibold text-[var(--chat-text)] flex items-center gap-2">
              <span className="xeno-search-title">Xeno Search</span>
              {progress !== undefined && progress > 0 && progress < 100 && (
                <span className="text-xs font-medium text-[var(--chat-muted)]">
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
              <div className="h-1 bg-[var(--chat-control)] rounded-full overflow-hidden">
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
          <div className="flex-shrink-0 w-10 h-10 text-[var(--chat-accent)] bg-[var(--chat-accent-soft)] rounded-full flex items-center justify-center">
            <PhaseIcon size={20} className="animate-pulse" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-sm font-semibold text-[var(--chat-text)]">
                🔍 Xeno Deep Search
              </h4>
              <span className="text-xs font-medium text-[var(--chat-accent)]">
                {Math.round(progress)}%
              </span>
            </div>
            <p className="text-xs text-[var(--chat-text)] mb-2">
              {message}
            </p>
            <div className="w-full bg-[var(--chat-control)] rounded-full h-1.5">
              <div 
                className="bg-[var(--chat-accent)] h-1.5 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
        
        {data && (
          <div className="text-xs text-[var(--chat-muted)]">
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

type VoiceInputMode = 'tap' | 'hold';

const VOICE_INPUT_MODE_STORAGE_KEY = 'xeno-chat-voice-input-mode';
const PROJECTS_PAGE_OPEN_STORAGE_KEY = 'xeno-chat-projects-page-open';
const ACTIVE_PROJECT_ID_STORAGE_KEY = 'xeno-chat-active-project-id';
// v1 prototype limit: project files are stored in localStorage, so keep them small.
const PROJECT_FILE_MAX_BYTES = 1024 * 1024; // 1 MB per file
/** How many project files show in the rail before expanding via the "8/20" control. */
const PROJECT_FILES_PREVIEW_LIMIT = 8;
/** Demo files for empty projects — 20 total so the header count can read 8/20. */
const MOCK_PROJECT_FILES = [
  {
    id: 'mock-file-1',
    name: 'project-brief.md',
    type: 'text/markdown',
    size: 4200,
    addedAt: Date.UTC(2026, 6, 20),
    encoding: 'text' as const,
    content:
      'Prefer concise answers. Document pigments and binders carefully. Ask before recommending any irreversible treatment.',
  },
  {
    id: 'mock-file-2',
    name: 'palette.tokens.json',
    type: 'application/json',
    size: 1800,
    addedAt: Date.UTC(2026, 6, 18),
    encoding: 'text' as const,
    content: '{ "canvas": "#121212", "ink": "#e7e7e2", "muted": "#8a8a86" }',
  },
  {
    id: 'mock-file-3',
    name: 'restoration-notes.txt',
    type: 'text/plain',
    size: 9600,
    addedAt: Date.UTC(2026, 6, 14),
    encoding: 'text' as const,
    content:
      'Surface cleaning test on lower-right corner looked stable. No bloom after 48h. Next: varnish solubility check.',
  },
  {
    id: 'mock-file-4',
    name: 'client-feedback.md',
    type: 'text/markdown',
    size: 3100,
    addedAt: Date.UTC(2026, 6, 12),
    encoding: 'text' as const,
    content: 'Client wants a calmer tone in written updates. Avoid jargon unless they ask for technical detail.',
  },
  {
    id: 'mock-file-5',
    name: 'reference-scan.png',
    type: 'image/png',
    size: 240000,
    addedAt: Date.UTC(2026, 6, 10),
    encoding: 'base64' as const,
    content: 'Image attachment — open for preview.',
  },
  {
    id: 'mock-file-6',
    name: 'condition-report.pdf',
    type: 'application/pdf',
    size: 512000,
    addedAt: Date.UTC(2026, 6, 8),
    encoding: 'base64' as const,
    content: 'PDF condition report — open for details.',
  },
  {
    id: 'mock-file-7',
    name: 'materials-list.csv',
    type: 'text/csv',
    size: 2200,
    addedAt: Date.UTC(2026, 6, 5),
    encoding: 'text' as const,
    content: 'item,qty\nCotton swabs,120\nIsopropanol,2L\nJapanese tissue,1 pack',
  },
  {
    id: 'mock-file-8',
    name: 'timeline.md',
    type: 'text/markdown',
    size: 1500,
    addedAt: Date.UTC(2026, 6, 2),
    encoding: 'text' as const,
    content: 'Week 1 documentation · Week 2 cleaning tests · Week 3 client review.',
  },
  ...Array.from({ length: 12 }, (_, index) => {
    const n = index + 9;
    return {
      id: `mock-file-${n}`,
      name: `context-note-${n}.md`,
      type: 'text/markdown',
      size: 900 + n * 80,
      addedAt: Date.UTC(2026, 5, Math.max(1, 28 - index)),
      encoding: 'text' as const,
      content: `Sample context file ${n} — open for details.`,
    };
  }),
];
/** Demo files for View files in chat when the conversation has no attachments yet. */
const MOCK_CHAT_FILES: {
  key: string;
  name: string;
  kind: 'file' | 'image';
  content: string;
}[] = [
  {
    key: 'mock-chat-file-1',
    name: 'condition-notes.md',
    kind: 'file',
    content:
      '# Condition notes\n\nSurface cleaning test on the lower-right looked stable.\nNo bloom after 48h.\n\nNext: varnish solubility check before any consolidant.',
  },
  {
    key: 'mock-chat-file-2',
    name: 'palette-swatch.png',
    kind: 'image',
    content:
      '[Image: palette-swatch.png]\n\nPreview is available in the message bubble.',
  },
  {
    key: 'mock-chat-file-3',
    name: 'client-brief.txt',
    kind: 'file',
    content:
      'Client wants a calmer tone in written updates.\nAvoid jargon unless they ask for technical detail.\nPrefer short paragraphs and clear next steps.',
  },
  {
    key: 'mock-chat-file-4',
    name: 'materials.csv',
    kind: 'file',
    content: 'item,qty\nCotton swabs,120\nIsopropanol,2L\nJapanese tissue,1 pack\nGellan gum,50g',
  },
  {
    key: 'mock-chat-file-5',
    name: 'reference-detail.jpg',
    kind: 'image',
    content:
      '[Image: reference-detail.jpg]\n\nPreview is available in the message bubble.',
  },
];

/** Demo instructions when a project has none saved yet. */
const MOCK_PROJECT_INSTRUCTIONS =
  'Prefer concise answers. Use conservation vocabulary carefully. When unsure about materials, ask before recommending treatments. Keep tone calm and professional for client-facing drafts.';
/** Demo scheduled tasks — click opens a themed preview modal until scheduling is wired. */
const MOCK_PROJECT_SCHEDULED = [
  { id: 'mock-sched-1', title: 'Weekly condition check-in', cadence: 'Every Monday · 09:00', mark: 'Mon' },
  { id: 'mock-sched-2', title: 'Draft client progress note', cadence: 'Every Friday · 16:00', mark: 'Fri' },
  { id: 'mock-sched-3', title: 'Refresh materials inventory', cadence: '1st of month · 10:00', mark: '1st' },
];

type ProjectScheduleKind = 'once' | 'daily' | 'weekly' | 'monthly';

type ProjectScheduleDraft = {
  kind: ProjectScheduleKind;
  /** 0 = Mon … 6 = Sun */
  weekday: number;
  /** YYYY-MM-DD for once */
  date: string;
  /** HH:mm */
  time: string;
};

const SCHEDULE_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const SCHEDULE_KIND_OPTIONS: { id: ProjectScheduleKind; label: string }[] = [
  { id: 'once', label: 'Once' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

const createDefaultScheduleDraft = (): ProjectScheduleDraft => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const jsDay = now.getDay(); // 0 Sun … 6 Sat
  const weekday = jsDay === 0 ? 6 : jsDay - 1;
  return {
    kind: 'weekly',
    weekday,
    date: `${yyyy}-${mm}-${dd}`,
    time: '09:00',
  };
};

const markFromScheduleDraft = (draft: ProjectScheduleDraft): string => {
  if (draft.kind === 'weekly') return SCHEDULE_WEEKDAYS[draft.weekday] ?? 'New';
  if (draft.kind === 'monthly') return '1st';
  if (draft.kind === 'daily') return 'Day';
  const day = draft.date.split('-')[2];
  return day ?? 'New';
};

const SCHEDULE_CAL_WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
/** 12-hour clock labels (01–12). Stored value stays 24h `HH:mm`. */
const SCHEDULE_HOURS_12 = Array.from({ length: 12 }, (_, index) =>
  String(index + 1).padStart(2, '0'),
);
/** 5-minute steps — cleaner for schedule UI than 60 rows. */
const SCHEDULE_MINUTES = Array.from({ length: 12 }, (_, index) =>
  String(index * 5).padStart(2, '0'),
);
const SCHEDULE_MERIDIEMS = ['AM', 'PM'] as const;
type ScheduleMeridiem = (typeof SCHEDULE_MERIDIEMS)[number];
/** Same speed for open and close. */
const SCHEDULE_DATE_PICKER_MS = 480;
/** Add-scheduled-task modal card in/out. */
const SCHEDULE_CREATE_MODAL_MS = 420;
/** Appearance / theme popover — readable in/out (too short reads as a hard cut). */
const THEME_MENU_MS = 300;
const THEME_MENU_FROM_TRANSFORM = 'translateY(-10px) scale(0.9)';
/** History header search bar — enter from right, exit to right. */
const HISTORY_SEARCH_BAR_MS = 280;
const HISTORY_SEARCH_BAR_FROM_TRANSFORM = 'translateX(32%)';
/** Text starts after the panel; ease-in so opacity does not jump. */
const SCHEDULE_DATE_TEXT_DELAY_MS = 280;
const SCHEDULE_DATE_TEXT_MS = 480;
const SCHEDULE_DATE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SCHEDULE_DATE_TEXT_EASE = 'ease-in';

/**
 * Shared "grows out of its source toward center" motion for chat card modals.
 * Origin = which edge/corner the source control lives on.
 */
type ChatModalOrigin = 'top-right' | 'right' | 'left' | 'center';

const CHAT_MODAL_MOTION: Record<
  ChatModalOrigin,
  { transformOrigin: string; fromTransform: string; keyIn: string; keyOut: string }
> = {
  'top-right': {
    transformOrigin: 'top right',
    fromTransform: 'translate(18%, -12%) scale(0.42)',
    keyIn: 'chat-modal-from-top-right-in',
    keyOut: 'chat-modal-from-top-right-out',
  },
  right: {
    transformOrigin: 'right center',
    fromTransform: 'translate(22%, 0) scale(0.42)',
    keyIn: 'chat-modal-from-right-in',
    keyOut: 'chat-modal-from-right-out',
  },
  left: {
    transformOrigin: 'left center',
    fromTransform: 'translate(-22%, 0) scale(0.42)',
    keyIn: 'chat-modal-from-left-in',
    keyOut: 'chat-modal-from-left-out',
  },
  center: {
    transformOrigin: 'center center',
    fromTransform: 'scale(0.42)',
    keyIn: 'chat-modal-from-center-in',
    keyOut: 'chat-modal-from-center-out',
  },
};

const CHAT_MODAL_KEYFRAMES_CSS = `
  @keyframes chat-modal-from-top-right-in {
    from { opacity: 0; transform: translate(18%, -12%) scale(0.42); }
    to { opacity: 1; transform: translate(0, 0) scale(1); }
  }
  @keyframes chat-modal-from-top-right-out {
    from { opacity: 1; transform: translate(0, 0) scale(1); }
    to { opacity: 0; transform: translate(18%, -12%) scale(0.42); }
  }
  @keyframes chat-modal-from-right-in {
    from { opacity: 0; transform: translate(22%, 0) scale(0.42); }
    to { opacity: 1; transform: translate(0, 0) scale(1); }
  }
  @keyframes chat-modal-from-right-out {
    from { opacity: 1; transform: translate(0, 0) scale(1); }
    to { opacity: 0; transform: translate(22%, 0) scale(0.42); }
  }
  @keyframes chat-modal-from-left-in {
    from { opacity: 0; transform: translate(-22%, 0) scale(0.42); }
    to { opacity: 1; transform: translate(0, 0) scale(1); }
  }
  @keyframes chat-modal-from-left-out {
    from { opacity: 1; transform: translate(0, 0) scale(1); }
    to { opacity: 0; transform: translate(-22%, 0) scale(0.42); }
  }
  @keyframes chat-modal-from-center-in {
    from { opacity: 0; transform: scale(0.42); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes chat-modal-from-center-out {
    from { opacity: 1; transform: scale(1); }
    to { opacity: 0; transform: scale(0.42); }
  }
`;

const historySearchBarMotionStyle = (
  shown: boolean,
  open: boolean,
): React.CSSProperties => ({
  willChange: 'transform, opacity',
  ...(shown
    ? {
        animation: `chat-history-search-in ${HISTORY_SEARCH_BAR_MS}ms ${SCHEDULE_DATE_EASE} forwards`,
      }
    : !open
      ? {
          animation: `chat-history-search-out ${HISTORY_SEARCH_BAR_MS}ms ${SCHEDULE_DATE_EASE} forwards`,
        }
      : {
          opacity: 0,
          transform: HISTORY_SEARCH_BAR_FROM_TRANSFORM,
        }),
});

const chatModalCardMotionStyle = (
  origin: ChatModalOrigin,
  shown: boolean,
  open: boolean,
): React.CSSProperties => {
  const motion = CHAT_MODAL_MOTION[origin];
  return {
    transformOrigin: motion.transformOrigin,
    willChange: 'transform, opacity',
    ...(shown
      ? {
          animation: `${motion.keyIn} ${SCHEDULE_CREATE_MODAL_MS}ms ${SCHEDULE_DATE_EASE} forwards`,
        }
      : !open
        ? {
            animation: `${motion.keyOut} ${SCHEDULE_CREATE_MODAL_MS}ms ${SCHEDULE_DATE_EASE} forwards`,
          }
        : {
            opacity: 0,
            transform: motion.fromTransform,
          }),
  };
};

/** Appearance popover motion — key remounts so in/out always restart (no skipped CSS animation). */
const themeMenuPanelMotionStyle = (
  shown: boolean,
  open: boolean,
): React.CSSProperties => ({
  transformOrigin: 'top right',
  willChange: 'transform, opacity',
  ...(shown
    ? {
        animation: `chat-theme-menu-in ${THEME_MENU_MS}ms ${SCHEDULE_DATE_EASE} forwards`,
      }
    : !open
      ? {
          animation: `chat-theme-menu-out ${THEME_MENU_MS}ms ${SCHEDULE_DATE_EASE} forwards`,
        }
      : {
          opacity: 0,
          transform: THEME_MENU_FROM_TRANSFORM,
        }),
});

/**
 * The 👍 / 👎 feedback popovers.
 *
 * Same family as the Appearance menu — grow out of the edge nearest the button, reverse to close —
 * one step quicker, because these are lists of choices that open right under the pointer rather
 * than a panel of controls. The direction follows the placement: a menu that opened downward has to
 * collapse back up into its button, and one that opened upward, back down.
 */
const MENU_POP_MS = 200;
/** The feedback popovers were the first users of it; the name is kept where they read it. */
const FEEDBACK_POPUP_MS = MENU_POP_MS;

type FeedbackPopupPlacement = 'below' | 'above';

/**
 * Where the popover sits — anchored to the button, never measured against a guess.
 *
 * `top` is the button's own edge. An upward menu then lifts itself by its OWN height, so its bottom
 * lands on the button whatever the list weighs. The previous version placed it from an estimated
 * height — 210px for five rows, 260px for seven — and an estimate that is short by a row puts the
 * menu on top of the button that opened it, which is exactly what the seven-row dislike menu did.
 *
 * The wrapper owns this transform and the panel inside owns the animated one. One element cannot
 * carry both: the animation would overwrite the lift and drop the menu back over its button.
 */
const feedbackPopupAnchorStyle = (
  position: { x: number; y: number },
  placement: FeedbackPopupPlacement,
): React.CSSProperties => ({
  position: 'absolute',
  left: `${position.x}px`,
  top: `${position.y}px`,
  zIndex: 100,
  ...(placement === 'above' ? { transform: 'translateY(-100%)' } : null),
});

/** The panel itself — the box that is drawn, and the element the motion runs on. */
const FEEDBACK_POPUP_PANEL_STYLE: React.CSSProperties = {
  width: '220px',
  backgroundColor: 'var(--chat-elevated)',
  color: 'var(--chat-text)',
  border: '1px solid var(--chat-border)',
  borderRadius: '12px',
  boxShadow: '0 5px 15px color-mix(in srgb, var(--chat-text) 16%, transparent)',
  overflow: 'hidden',
};

/**
 * The motion every dropdown in the chat shares: a short lift and a 6% scale, out of the corner
 * nearest the control that opened it.
 *
 * It is deliberately not the card-modal motion — `translate(18%, -12%) scale(0.42)`, which exists so
 * a full modal can grow out of a corner of the SCREEN. A 188px menu given that travel arrives from
 * somewhere else entirely: the conversation ⋯ menu appeared to slide out of the history sidebar and
 * back into it, as though it belonged to the sidebar rather than to the row it was opened from.
 *
 * `origin` is the corner it grows from and `dy` the direction it lifts, both decided by the caller
 * from where the menu was placed. Everything else is common, which is the point.
 */
const menuPopMotionStyle = (
  transformOrigin: string,
  dy: string,
  shown: boolean,
  open: boolean,
): React.CSSProperties => ({
  transformOrigin,
  // Read by both keyframes, so every placement shares one pair rather than owning its own.
  ['--chat-menu-pop-dy' as string]: dy,
  willChange: 'transform, opacity',
  ...(shown
    ? { animation: `chat-menu-pop-in ${MENU_POP_MS}ms ${SCHEDULE_DATE_EASE} forwards` }
    : !open
      ? { animation: `chat-menu-pop-out ${MENU_POP_MS}ms ${SCHEDULE_DATE_EASE} forwards` }
      : { opacity: 0, transform: `translateY(${dy}) scale(0.94)` }),
});

const feedbackPopupMotionStyle = (
  placement: FeedbackPopupPlacement,
  shown: boolean,
  open: boolean,
): React.CSSProperties => {
  const above = placement === 'above';
  return menuPopMotionStyle(
    above ? 'bottom left' : 'top left',
    above ? '8px' : '-8px',
    shown,
    open,
  );
};

/**
 * Mount, paint closed, then play — and on close, play the exit before unmounting.
 *
 * The ⋯ and Appearance menus each spell this out with three booleans of their own. These two
 * popovers carry their anchor INSIDE the state object, so presence has to follow the object: the
 * exit keeps drawing at the position the popover was opened at, and that position is gone the
 * instant the state is nulled. Holding the last non-null value is what lets the close animate at
 * all. Reopening on another message changes the object's identity, which replays the enter from
 * the new anchor.
 */
function usePopoverPresence<T>(info: T | null, durationMs: number) {
  const [rendered, setRendered] = useState<T | null>(info);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (info) {
      setRendered(info);
      setShown(false);
      // Two frames: one to mount at the closed values, one to be sure they were painted before the
      // flip. A single frame can still be batched with the mount, and the browser then sees only
      // the end state — no transition, a hard cut.
      let second = 0;
      const first = window.requestAnimationFrame(() => {
        second = window.requestAnimationFrame(() => setShown(true));
      });
      return () => {
        window.cancelAnimationFrame(first);
        window.cancelAnimationFrame(second);
      };
    }
    setShown(false);
    const timer = window.setTimeout(() => setRendered(null), durationMs);
    return () => window.clearTimeout(timer);
  }, [info, durationMs]);

  return { rendered, shown } as const;
}

/** Pixel offset from viewport center to a trigger’s center — card grows from that point. */
const measureModalFromTrigger = (el: Element | null): { x: number; y: number } => {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  if (!el) {
    // Fallback: top-right chrome (Customize / ⋯ live there).
    return { x: window.innerWidth * 0.28, y: -window.innerHeight * 0.32 };
  }
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2 - window.innerWidth / 2,
    y: rect.top + rect.height / 2 - window.innerHeight / 2,
  };
};

const parseScheduleTime = (
  time: string,
): { hour12: string; minute: string; meridiem: ScheduleMeridiem; hour24: string } => {
  const [rawHour = '09', rawMinute = '00'] = (time || '09:00').split(':');
  const hour24Num = Math.min(23, Math.max(0, Number(rawHour) || 0));
  const hour24 = String(hour24Num).padStart(2, '0');
  const minuteNum = Number(rawMinute);
  const snapped = Number.isFinite(minuteNum)
    ? String(Math.min(55, Math.round(minuteNum / 5) * 5)).padStart(2, '0')
    : '00';
  const minute = SCHEDULE_MINUTES.includes(snapped) ? snapped : '00';
  const meridiem: ScheduleMeridiem = hour24Num >= 12 ? 'PM' : 'AM';
  const hour12Num = hour24Num % 12 === 0 ? 12 : hour24Num % 12;
  const hour12 = String(hour12Num).padStart(2, '0');
  return { hour12, minute, meridiem, hour24 };
};

const toScheduleTime24 = (
  hour12: string,
  minute: string,
  meridiem: ScheduleMeridiem,
): string => {
  let hour = Number(hour12) || 12;
  if (meridiem === 'AM') {
    hour = hour === 12 ? 0 : hour;
  } else {
    hour = hour === 12 ? 12 : hour + 12;
  }
  const safeMinute = SCHEDULE_MINUTES.includes(minute) ? minute : '00';
  return `${String(hour).padStart(2, '0')}:${safeMinute}`;
};

const formatScheduleTimeDisplay = (time: string): string => {
  const { hour12, minute, meridiem } = parseScheduleTime(time);
  return `${hour12}:${minute} ${meridiem}`;
};

const formatProjectScheduleLabel = (draft: ProjectScheduleDraft): string => {
  const time = formatScheduleTimeDisplay(draft.time.trim() || '09:00');
  if (draft.kind === 'daily') return `Every day · ${time}`;
  if (draft.kind === 'monthly') return `1st of month · ${time}`;
  if (draft.kind === 'weekly') {
    const day = SCHEDULE_WEEKDAYS[draft.weekday] ?? 'Mon';
    return `Every ${day} · ${time}`;
  }
  if (!draft.date) return `Once · ${time}`;
  const [y, m, d] = draft.date.split('-').map(Number);
  const label = new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${label} · ${time}`;
};

const formatScheduleDateYmd = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const formatScheduleDateDisplay = (ymd: string): string => {
  if (!ymd) return 'Select date';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return 'Select date';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
};

const monthStartFromYmd = (ymd: string): Date => {
  const now = new Date();
  if (!ymd) return new Date(now.getFullYear(), now.getMonth(), 1);
  const [y, m] = ymd.split('-').map(Number);
  if (!y || !m) return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(y, m - 1, 1);
};

/** Fixed 6-week grid, Monday-first — keeps calendar height stable. */
const getScheduleMonthGrid = (
  viewMonth: Date,
): { ymd: string; day: number; inMonth: boolean }[] => {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const cell = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + index,
    );
    return {
      ymd: formatScheduleDateYmd(cell),
      day: cell.getDate(),
      inMonth: cell.getMonth() === month,
    };
  });
};

/** Short title for the large workspace header font (≈ one line next to ⋯ / star). */
const PROJECT_NAME_MAX_CHARS = 36;
/**
 * Tabs of the single Project settings surface. Every entry point opens the modal on one of
 * these — one door, several handles. Only the active tab's content is rendered.
 *
 * Files and Scheduled are deliberately absent: they are content to read, not configuration, and
 * the rail already owns them. Duplicating a list here would defeat the point of one surface.
 */
const PROJECT_SETTINGS_SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'danger', label: 'Danger zone' },
] as const;
type ProjectSettingsSection = (typeof PROJECT_SETTINGS_SECTIONS)[number]['id'];
/** Module-level so `useTabs` gets the same array identity on every render rather than a fresh one. */
const PROJECT_SETTINGS_SECTION_IDS = PROJECT_SETTINGS_SECTIONS.map((s) => s.id);
/**
 * The header renders these sections TWICE — a wide row and a narrow scroller, one hidden by CSS — and
 * both are in the document, pointing at the single panel below. Two `useTabs` instances would each mint
 * a panel id and each claim to own it; sharing one explicit id is what `panelId` is for.
 */
const PROJECT_SETTINGS_PANEL_ID = 'project-settings-panel';
const CHAT_CHROME_EDGE_INSET_PX = 12;
/** Vertical inset for floating chrome icons (centers an h-9 control in the bar). */
const CHAT_CHROME_TOP_INSET_PX = 8;
/** Shared height for history header + main top bar. Hairline sits at this Y (fixed). */
const CHAT_CHROME_BAR_HEIGHT_PX = 52;

const THEME_WAVEFORM_BAR_COUNT = 21;

/**
 * The theme mark. Same idea as the hand-drawn half-circle it replaces — a shape with one half solid —
 * but drawn from the element library, so it is a rounded SQUARE. The system has no circles in it, and
 * this was the last one left in the menu chrome.
 *
 * Kept as a named component with the same signature rather than swapped at the four call sites: the
 * name is what those sites mean, and the drawing behind it is now the library's problem. It also picks
 * up the glyph's own motion — half a turn on hover, so the solid side changes places, which is what
 * the control does.
 */
const ManualThemeIcon = ({ size = 16, ...props }: React.SVGProps<SVGSVGElement> & { size?: number }) => (
  <Contrast size={size} aria-hidden="true" focusable="false" {...props} />
);

const getThemeSliderValueText = (position: number): string => {
  const exactTheme = VISUAL_CHAT_THEME_OPTIONS.find((option) => option.position === position);
  return exactTheme ? `${exactTheme.label} theme, ${position}%` : `Custom theme, ${position}%`;
};

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
  // Floating PanelLeftOpen + XENO wordmark: wait for history close animation, then enter L→R.
  const [showClosedHistoryChrome, setShowClosedHistoryChrome] = useState(true);
  const [closedHistoryChromeEnterKey, setClosedHistoryChromeEnterKey] = useState(0);
  const historyWasOpenRef = useRef(false);
  const [deleteConfirmationModal, setDeleteConfirmationModal] = useState<{
    isOpen: boolean;
    conversationId: string | null;
    conversationTitle: string | null;
    /** History sidebar → left; chat ⋯ menu → top-right. */
    origin: ChatModalOrigin;
  }>({ isOpen: false, conversationId: null, conversationTitle: null, origin: 'left' });
  const [isDeleteModalMounted, setIsDeleteModalMounted] = useState(false);
  const [isDeleteModalShown, setIsDeleteModalShown] = useState(false);
  const [historyRowMenu, setHistoryRowMenu] = useState<{
    conversationId: string;
    top: number;
    left: number;
  } | null>(null);
  const [isHistoryRowMenuOpen, setIsHistoryRowMenuOpen] = useState(false);
  const [isHistoryRowMenuMounted, setIsHistoryRowMenuMounted] = useState(false);
  const [isHistoryRowMenuShown, setIsHistoryRowMenuShown] = useState(false);
  const [historyProjectSubmenuOpen, setHistoryProjectSubmenuOpen] = useState(false);
  const [historyHoveredRowId, setHistoryHoveredRowId] = useState<string | null>(null);
  type HistoryNavView = 'chats' | 'projects' | 'archived' | 'artifacts' | 'global_settings' | 'scheduled';
  const [historyNavView, setHistoryNavView] = useState<HistoryNavView>('chats');
  const [isPinnedSectionOpen, setIsPinnedSectionOpen] = useState(true);
  const [isRecentsSectionOpen, setIsRecentsSectionOpen] = useState(true);
  // Pointer-based pinned DnD (HTML5 drag is unreliable here — cancels on re-render).
  const [historyDragId, setHistoryDragId] = useState<string | null>(null);
  const [pinnedInsertIndex, setPinnedInsertIndex] = useState<number | null>(null);
  // Ghost title only in React state; x/y updated imperatively (avoids list re-render every move).
  const [historyDragGhostTitle, setHistoryDragGhostTitle] = useState<string | null>(null);
  const historyDragGhostElRef = useRef<HTMLDivElement | null>(null);
  const historyDidDragRef = useRef(false);
  const historyDragIdRef = useRef<string | null>(null);
  const historyDragFromSectionRef = useRef<'pinned' | 'recents' | 'archived' | null>(null);
  const pinnedInsertIndexRef = useRef<number | null>(null);
  const pinnedRowHeightRef = useRef(32);
  const conversationHistoryRef = useRef<Conversation[]>([]);
  const historyPointerSessionRef = useRef<{
    id: string;
    fromSection: 'pinned' | 'recents';
    title: string;
    startX: number;
    startY: number;
    /** Cursor offset inside the row at grab — ghost stays under that point (Claude-style). */
    grabOffsetX: number;
    grabOffsetY: number;
    rowWidth: number;
    pointerId: number;
    activated: boolean;
  } | null>(null);
  type RecentsFilterType = 'all' | 'chat' | 'task';
  type RecentsFilterStatus = 'active' | 'archived' | 'all';
  type RecentsFilterActivity = '1d' | '3d' | '7d' | '30d' | 'all';
  type RecentsGroupBy = 'none' | 'date' | 'type' | 'project' | 'unread' | 'status';
  type RecentsFilterSubmenu = 'type' | 'status' | 'activity' | 'group' | null;
  const [recentsFilterType, setRecentsFilterType] = useState<RecentsFilterType>('all');
  const [recentsFilterStatus, setRecentsFilterStatus] = useState<RecentsFilterStatus>('active');
  const [recentsFilterActivity, setRecentsFilterActivity] = useState<RecentsFilterActivity>('all');
  const [recentsGroupBy, setRecentsGroupBy] = useState<RecentsGroupBy>('none');
  const [recentsFilterMenu, setRecentsFilterMenu] = useState<{ top: number; left: number } | null>(null);
  const [recentsFilterSubmenu, setRecentsFilterSubmenu] = useState<RecentsFilterSubmenu>(null);
  const [recentsFilterSubmenuTop, setRecentsFilterSubmenuTop] = useState(0);
  const [isRecentsSectionHovered, setIsRecentsSectionHovered] = useState(false);
  const [isChatsCatalogOpen, setIsChatsCatalogOpen] = useState(false);
  const [chatsCatalogSearch, setChatsCatalogSearch] = useState('');
  const [isChatsCatalogSelecting, setIsChatsCatalogSelecting] = useState(false);
  const [chatsCatalogSelectedIds, setChatsCatalogSelectedIds] = useState<string[]>([]);
  const [isChatsCatalogFilterOpen, setIsChatsCatalogFilterOpen] = useState(false);
  type ChatsCatalogFilter = 'all' | 'chat' | 'shared' | 'cowork' | 'archived';
  const [chatsCatalogFilter, setChatsCatalogFilter] = useState<ChatsCatalogFilter>('all');
  // Full-page Projects view (Claude-style layout, XENO chat themes).
  // Persisted so a page refresh keeps the user on the Projects page instead
  // of dropping them back into the new-chat interface.
  const [isProjectsPageOpen, setIsProjectsPageOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(PROJECTS_PAGE_OPEN_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [isArtifactsPageOpen, setIsArtifactsPageOpen] = useState(false);
  const [isGlobalSettingsPageOpen, setIsGlobalSettingsPageOpen] = useState(false);
  const [isScheduledPageOpen, setIsScheduledPageOpen] = useState(false);
  const [isCustomizePageOpen, setIsCustomizePageOpen] = useState(false);
  const [isCustomizePageMounted, setIsCustomizePageMounted] = useState(false);
  const [isCustomizePageShown, setIsCustomizePageShown] = useState(false);
  /** Kept until unmount so exit returns to the same button. */
  const [customizeMotionFrom, setCustomizeMotionFrom] = useState({ x: 0, y: 0 });
  const customizeButtonRef = useRef<HTMLButtonElement>(null);
  // Which project's workspace is open (null = showing the projects list).
  // Persisted so a refresh keeps the user inside the same project.
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(ACTIVE_PROJECT_ID_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });
  const [projectsPageSearch, setProjectsPageSearch] = useState('');
  type ProjectsSort = 'updated' | 'created' | 'name';
  const [projectsSort, setProjectsSort] = useState<ProjectsSort>('updated');
  const [isProjectsSortOpen, setIsProjectsSortOpen] = useState(false);
  const [chatTheme, setChatTheme] = useState<ChatTheme>(() => {
    if (typeof window === 'undefined') return 'dark';

    try {
      const storedTheme = localStorage.getItem(CHAT_THEME_STORAGE_KEY);
      return storedTheme === 'system' || storedTheme === 'custom' || storedTheme === 'dark' || storedTheme === 'dim' || storedTheme === 'light'
        ? storedTheme
        : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [chatThemeBrightness, setChatThemeBrightness] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;

    try {
      const storedBrightness = localStorage.getItem(CHAT_THEME_BRIGHTNESS_STORAGE_KEY);
      const parsedBrightness = storedBrightness === null ? Number.NaN : Number(storedBrightness);
      if (Number.isFinite(parsedBrightness)) return normalizeThemeBrightness(parsedBrightness);

      const storedTheme = localStorage.getItem(CHAT_THEME_STORAGE_KEY);
      if (storedTheme === 'dim') return 50;
      if (storedTheme === 'light') return 100;
      return 0;
    } catch {
      return 0;
    }
  });
  const [systemTheme, setSystemTheme] = useState<Extract<ResolvedChatTheme, 'dark' | 'light'>>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  );
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [isThemeMenuMounted, setIsThemeMenuMounted] = useState(false);
  const [isThemeMenuShown, setIsThemeMenuShown] = useState(false);
  const [themePreviewPosition, setThemePreviewPosition] = useState<number | null>(null);
  const [isTemporaryChat, setIsTemporaryChat] = useState(false);
  const [isSharePreviewOpen, setIsSharePreviewOpen] = useState(false);
  const [isSharePreviewMounted, setIsSharePreviewMounted] = useState(false);
  const [isSharePreviewShown, setIsSharePreviewShown] = useState(false);
  const [isChatMoreMenuOpen, setIsChatMoreMenuOpen] = useState(false);
  const [isChatMoreMenuMounted, setIsChatMoreMenuMounted] = useState(false);
  const [isChatMoreMenuShown, setIsChatMoreMenuShown] = useState(false);
  const [isChatFilesModalOpen, setIsChatFilesModalOpen] = useState(false);
  const [isChatFilesModalMounted, setIsChatFilesModalMounted] = useState(false);
  const [isChatFilesModalShown, setIsChatFilesModalShown] = useState(false);
  const [chatFilesSelectedKey, setChatFilesSelectedKey] = useState<string | null>(
    null,
  );
  const [chatFilesCopied, setChatFilesCopied] = useState(false);
  const [isTaskbarHidden, setIsTaskbarHidden] = useState(false);
  const historySidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_THEME_STORAGE_KEY, chatTheme);
      localStorage.setItem(CHAT_THEME_BRIGHTNESS_STORAGE_KEY, String(chatThemeBrightness));
    } catch {
      // Theme preference is optional when browser storage is unavailable.
    }
  }, [chatTheme, chatThemeBrightness]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateSystemTheme = (event: MediaQueryListEvent | MediaQueryList) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };

    updateSystemTheme(mediaQuery);
    mediaQuery.addEventListener('change', updateSystemTheme);
    return () => mediaQuery.removeEventListener('change', updateSystemTheme);
  }, []);

  const resolvedChatTheme: ResolvedChatTheme = chatTheme === 'system'
    ? systemTheme
    : chatTheme === 'custom'
      ? getClosestVisualTheme(chatThemeBrightness)
      : chatTheme;
  // Top-bar theme control uses the half-circle mark (matches Temporary / Settings chrome).
  const ThemeTriggerIcon = ManualThemeIcon;
  const displayedThemeSliderPosition = themePreviewPosition ?? (
    chatTheme === 'system' ? getVisualThemePosition(systemTheme) :
      chatTheme === 'custom' ? chatThemeBrightness : getVisualThemePosition(chatTheme)
  );
  const chatThemePreviewStyle = useMemo<React.CSSProperties>(() => {
    const previewPosition = themePreviewPosition ?? (chatTheme === 'custom' ? chatThemeBrightness : null);
    if (previewPosition === null) return {};

    return buildChatThemeStyle(previewPosition) as React.CSSProperties;
  }, [chatTheme, chatThemeBrightness, themePreviewPosition]);
  const handleChatThemeChange = useCallback((nextTheme: ChatTheme, closeMenu = true) => {
    if (nextTheme !== 'system' && nextTheme !== 'custom') {
      setChatThemeBrightness(getVisualThemePosition(nextTheme));
    }
    setChatTheme(nextTheme);
    setThemePreviewPosition(null);
    if (closeMenu) setIsThemeMenuOpen(false);
  }, []);
  const commitThemeSliderPosition = useCallback((position: number) => {
    setChatThemeBrightness(normalizeThemeBrightness(position));
    setChatTheme('custom');
    setThemePreviewPosition(null);
  }, []);

  // Appearance popover: same mount → paint closed → show enter / reverse on exit as card modals.
  useEffect(() => {
    if (isThemeMenuOpen) {
      setIsThemeMenuMounted(true);
      setIsThemeMenuShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsThemeMenuShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isThemeMenuMounted) return;
    setIsThemeMenuShown(false);
    const timer = window.setTimeout(() => {
      setIsThemeMenuMounted(false);
    }, THEME_MENU_MS);
    return () => window.clearTimeout(timer);
  }, [isThemeMenuOpen, isThemeMenuMounted]);

  // ⋯ conversation menu: grow from the button toward center / shrink back to the button.
  useEffect(() => {
    if (isChatMoreMenuOpen) {
      setIsChatMoreMenuMounted(true);
      setIsChatMoreMenuShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsChatMoreMenuShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isChatMoreMenuMounted) return;
    setIsChatMoreMenuShown(false);
    setIsThemeMenuOpen(false);
    const timer = window.setTimeout(() => {
      setIsChatMoreMenuMounted(false);
    }, SCHEDULE_CREATE_MODAL_MS);
    return () => window.clearTimeout(timer);
  }, [isChatMoreMenuOpen, isChatMoreMenuMounted]);

  // Files-in-chat popup (⋯ → View files) — same card shell as project file preview.
  useEffect(() => {
    if (isChatFilesModalOpen) {
      setIsChatFilesModalMounted(true);
      setIsChatFilesModalShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsChatFilesModalShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isChatFilesModalMounted) return;
    setIsChatFilesModalShown(false);
    const timer = window.setTimeout(() => {
      setIsChatFilesModalMounted(false);
      setChatFilesSelectedKey(null);
      setChatFilesCopied(false);
    }, SCHEDULE_CREATE_MODAL_MS);
    return () => window.clearTimeout(timer);
  }, [isChatFilesModalOpen, isChatFilesModalMounted]);

  // Keep history inset in sync with Overview taskbar (Shift+H / XENO wordmark toggle).
  useEffect(() => {
    const onVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ hidden?: boolean }>).detail;
      if (typeof detail?.hidden === 'boolean') {
        setIsTaskbarHidden(detail.hidden);
      }
    };
    window.addEventListener('overview_taskbar_visibility', onVisibility as EventListener);
    return () => {
      window.removeEventListener('overview_taskbar_visibility', onVisibility as EventListener);
    };
  }, []);

  // Close history when entering multi-interface mode
  useEffect(() => {
    if (isMultiInterface && isHistoryOpen) setIsHistoryOpen(false);
  }, [isMultiInterface]);

  // Reveal floating history/XENO chrome only after the sidebar finish closing.
  useEffect(() => {
    if (isMultiInterface) {
      setShowClosedHistoryChrome(false);
      return;
    }
    if (isHistoryOpen) {
      historyWasOpenRef.current = true;
      setShowClosedHistoryChrome(false);
      return;
    }
    if (!historyWasOpenRef.current) {
      setShowClosedHistoryChrome(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setClosedHistoryChromeEnterKey((key) => key + 1);
      setShowClosedHistoryChrome(true);
      historyWasOpenRef.current = false;
    }, HISTORY_SIDEBAR_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [isHistoryOpen, isMultiInterface]);

  // History closes only via the panel X control (not click-outside).

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

    // Swipe right to open only — closing is reserved for the history X button.
    const isSwipeRight = deltaX > minSwipeDistance && isHorizontalSwipe && touchStartRef.current.x < leftEdgeZone;

    if (isSwipeRight && !isHistoryOpen) {
      setIsHistoryOpen(true);
    }

    touchStartRef.current = null;
  }, [isMobile, isHistoryOpen]);

  const [isReasonToggled, setIsReasonToggled] = useState(true);
  const [isSearchToggled, setIsSearchToggled] = useState(false);
  const [searchProvider, setSearchProvider] = useState<'google' | 'brave'>('google');
  const [isSearchProviderDropdownOpen, setIsSearchProviderDropdownOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model>(DEFAULT_MODEL);
  const [groupedModels, setGroupedModels] = useState<GroupedModels[]>([]);
  const [isModelsLoading, setIsModelsLoading] = useState(true);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSettingsModalMounted, setIsSettingsModalMounted] = useState(false);
  const [isSettingsModalShown, setIsSettingsModalShown] = useState(false);
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
  const [emptyStateMode, setEmptyStateMode] = useState<ChatMode>('chat');
  const [isSystemPromptSaved, setIsSystemPromptSaved] = useState(false);
  const [isCustomPromptOpen, setIsCustomPromptOpen] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);

  // Predefined personas
  const PERSONAS = [
    { id: 'engineer', label: 'Engineer', prompt: 'You are an expert software engineer. Help with coding, debugging, system design, and technical problem-solving. Provide clear, efficient solutions with best practices.' },
    { id: 'lawyer', label: 'Lawyer', prompt: 'You are an experienced legal professional. Provide legal information, help draft documents, explain legal concepts, and offer guidance on legal matters. Note: This is not legal advice.' },
    { id: 'copywriter', label: 'Copywriter', prompt: 'You are a skilled copywriter and content creator. Help craft compelling copy, marketing content, blog posts, and creative writing with engaging tone and clear messaging.' },
  ];
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    CHAT_DEMO_ENABLED ? buildDemoConversation() : [],
  );

  // Swap top-bar chrome: New chat ↔ open conversation.
  useEffect(() => {
    if (messages.length === 0) {
      setIsSharePreviewOpen(false);
      setIsChatMoreMenuOpen(false);
      return;
    }
    setIsThemeMenuOpen(false);
  }, [messages.length]);

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

  // `placement` is decided when the popover opens, from where the button sits in the viewport, and
  // it is what the exit animation needs: the menu has to collapse back toward its button, not in
  // some fixed direction.
  const [feedbackPopupInfo, setFeedbackPopupInfo] = useState<{
    messageId: string;
    position: { x: number; y: number };
    placement: FeedbackPopupPlacement;
  } | null>(null);
  // const feedbackPopupRef = useRef<HTMLDivElement>(null); // Moved up

  const [dislikePopupInfo, setDislikePopupInfo] = useState<{
    messageId: string;
    position: { x: number; y: number };
    placement: FeedbackPopupPlacement;
  } | null>(null);
  // const dislikePopupRef = useRef<HTMLDivElement>(null); // Moved up

  const feedbackPopupPresence = usePopoverPresence(feedbackPopupInfo, FEEDBACK_POPUP_MS);
  const dislikePopupPresence = usePopoverPresence(dislikePopupInfo, FEEDBACK_POPUP_MS);

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
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const chatMoreMenuRef = useRef<HTMLDivElement>(null);
  const [showTopBarBackground, setShowTopBarBackground] = useState(false);

  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const conversationSelectorButtonRef = useRef<HTMLButtonElement>(null);
  const conversationSelectorDropdownRef = useRef<HTMLDivElement>(null);

  // const sourcePreviewRef = useRef<HTMLDivElement>(null); // Moved up

  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const recentFilesPanelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceControlRef = useRef<HTMLDivElement>(null);
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
  conversationHistoryRef.current = conversationHistory;

  // If the last archived chat is restored, leave the Archived nav view.
  useEffect(() => {
    if (historyNavView === 'archived' && !conversationHistory.some((convo) => convo.isArchived)) {
      setHistoryNavView('chats');
    }
  }, [conversationHistory, historyNavView]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isDbAuthenticated, setIsDbAuthenticated] = useState<boolean>(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState<boolean>(true);
  const [isSyncingToDb, setIsSyncingToDb] = useState<boolean>(false);
  // --- END NEW ---

  // Ref to prevent double conversation creation
  const isCreatingConversationRef = useRef(false);
  // Ref to prevent double conversation updates
  const isUpdatingConversationRef = useRef(false);
  /**
   * The active conversation id as it is RIGHT NOW, not as it was when the current render started.
   *
   * The conversation is created while a send is already in flight, and `fetchAiResponse` closed over
   * `activeConversationId` before that happened — so by the time the answer lands, the state variable it
   * can see is still `null` and it would create a second conversation for the same thread. A ref is the
   * only thing that reads back what was just written.
   */
  const activeConversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // --- NEW: State for History Search --- 
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [isHistorySearchOpen, setIsHistorySearchOpen] = useState(false);
  const [isHistorySearchMounted, setIsHistorySearchMounted] = useState(false);
  const [isHistorySearchShown, setIsHistorySearchShown] = useState(false);
  // --- END NEW ---

  // History header search bar: mount → slide in from right; on close slide out to right, then unmount.
  useEffect(() => {
    if (isHistorySearchOpen) {
      setIsHistorySearchMounted(true);
      setIsHistorySearchShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsHistorySearchShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isHistorySearchMounted) return;
    setIsHistorySearchShown(false);
    const timer = window.setTimeout(() => {
      setIsHistorySearchMounted(false);
      setHistorySearchTerm('');
    }, HISTORY_SEARCH_BAR_MS);
    return () => window.clearTimeout(timer);
  }, [isHistorySearchOpen, isHistorySearchMounted]);

  // A file uploaded into a project (v1: content lives in localStorage, small text only).
  type ProjectFile = {
    id: string;
    name: string;
    type: string; // MIME type
    size: number; // bytes
    addedAt: number;
    encoding: 'text' | 'base64';
    content: string; // extracted text ('text') or metadata note ('base64')
  };
  // TEMPORARY chat-history Projects entry (local only — full project model later)
  type ProjectScheduledTask = {
    id: string;
    title: string;
    cadence: string;
    mark: string;
  };
  type ChatHistoryProject = {
    id: string;
    name: string;
    description?: string;
    createdAt: number;
    updatedAt?: number;
    isStarred?: boolean;
    isArchived?: boolean;
    files?: ProjectFile[];
    instructions?: string;
    scheduledTasks?: ProjectScheduledTask[];
  };
  const chatProjectsStorageKey = 'chatProjects_playground';
  const [chatProjects, setChatProjects] = useState<ChatHistoryProject[]>(() => {
    try {
      const saved = localStorage.getItem(chatProjectsStorageKey);
      if (!saved) return [];
      const parsed = JSON.parse(saved) as ChatHistoryProject[];
      if (!Array.isArray(parsed)) return [];
      // Clamp stored names so older long titles don't keep showing truncated headers.
      return parsed.map((project) => ({
        ...project,
        name: (project.name ?? '').slice(0, PROJECT_NAME_MAX_CHARS) || 'Untitled project',
      }));
    } catch {
      return [];
    }
  });
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [isCreateProjectModalMounted, setIsCreateProjectModalMounted] = useState(false);
  const [isCreateProjectModalShown, setIsCreateProjectModalShown] = useState(false);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  // Card whose hover overlay (bottom fade + date) is suppressed after a right-click.
  const [suppressCardOverlayId, setSuppressCardOverlayId] = useState<string | null>(null);
  // Whether the project workspace description is expanded ("Show more").
  const [isProjectDescExpanded, setIsProjectDescExpanded] = useState(false);
  // Right project sidebar (Instructions / Files / Scheduled) — history-style, toggled open/closed.
  const [isProjectSidebarOpen, setIsProjectSidebarOpen] = useState(true);
  // Files rail: show a short grid first; expand to reveal the rest.
  const [isProjectFilesExpanded, setIsProjectFilesExpanded] = useState(false);
  // Hidden input used to upload files into the open project.
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  // When set, the next conversation created gets linked to this project.
  const pendingChatProjectIdRef = useRef<string | null>(null);
  // The active conversation id at the moment a project workspace was opened. Used to detect
  // when a NEW conversation starts from the workspace composer so we can reveal the chat.
  const projectEntryConversationIdRef = useRef<string | null>(null);
  // Non-fatal upload notice shown in the project workspace (e.g. "file too large").
  const [projectFileNotice, setProjectFileNotice] = useState<string | null>(null);
  /** Centered themed preview when opening a file from the project Files rail. */
  const [projectFilePreview, setProjectFilePreview] = useState<{
    name: string;
    content: string;
  } | null>(null);
  const [isProjectFilePreviewOpen, setIsProjectFilePreviewOpen] = useState(false);
  const [isProjectFilePreviewMounted, setIsProjectFilePreviewMounted] = useState(false);
  const [isProjectFilePreviewShown, setIsProjectFilePreviewShown] = useState(false);
  const [projectFilePreviewCopied, setProjectFilePreviewCopied] = useState(false);
  /** Centered themed detail when opening a scheduled task from the project rail. */
  const [projectScheduledPreview, setProjectScheduledPreview] = useState<{
    id: string;
    title: string;
    cadence: string;
    mark: string;
  } | null>(null);
  const [isProjectScheduledPreviewOpen, setIsProjectScheduledPreviewOpen] =
    useState(false);
  const [isProjectScheduledPreviewMounted, setIsProjectScheduledPreviewMounted] =
    useState(false);
  const [isProjectScheduledPreviewShown, setIsProjectScheduledPreviewShown] =
    useState(false);
  /** Create-task dialog from project rail Scheduled +. */
  const [isProjectScheduledCreateOpen, setIsProjectScheduledCreateOpen] =
    useState(false);
  const [isProjectScheduledCreateMounted, setIsProjectScheduledCreateMounted] =
    useState(false);
  const [isProjectScheduledCreateShown, setIsProjectScheduledCreateShown] =
    useState(false);
  const [projectScheduledCreateTitle, setProjectScheduledCreateTitle] =
    useState('');
  const [projectScheduledCreateSchedule, setProjectScheduledCreateSchedule] =
    useState<ProjectScheduleDraft>(() => createDefaultScheduleDraft());
  const [isProjectScheduledWhenOpen, setIsProjectScheduledWhenOpen] =
    useState(false);
  const [isProjectScheduledWhenMounted, setIsProjectScheduledWhenMounted] =
    useState(false);
  const [isProjectScheduledWhenShown, setIsProjectScheduledWhenShown] =
    useState(false);
  const [isProjectScheduledWhenTextShown, setIsProjectScheduledWhenTextShown] =
    useState(false);
  /** After slide-in, drop overflow clip so nested calendar is not cut off. */
  const [isProjectScheduledWhenClipOpen, setIsProjectScheduledWhenClipOpen] =
    useState(false);
  const [projectScheduledWhenPanelHeight, setProjectScheduledWhenPanelHeight] =
    useState(0);
  const projectScheduledWhenContentRef = useRef<HTMLDivElement>(null);
  const [isProjectScheduleDateOpen, setIsProjectScheduleDateOpen] =
    useState(false);
  const [isProjectScheduleDateMounted, setIsProjectScheduleDateMounted] =
    useState(false);
  const [isProjectScheduleDateShown, setIsProjectScheduleDateShown] =
    useState(false);
  const [isProjectScheduleDateTextShown, setIsProjectScheduleDateTextShown] =
    useState(false);
  const [projectScheduleDatePanelHeight, setProjectScheduleDatePanelHeight] =
    useState(0);
  const projectScheduleDateContentRef = useRef<HTMLDivElement>(null);
  const [isProjectScheduleTimeOpen, setIsProjectScheduleTimeOpen] =
    useState(false);
  const [isProjectScheduleTimeMounted, setIsProjectScheduleTimeMounted] =
    useState(false);
  const [isProjectScheduleTimeShown, setIsProjectScheduleTimeShown] =
    useState(false);
  const [isProjectScheduleTimeTextShown, setIsProjectScheduleTimeTextShown] =
    useState(false);
  const [projectScheduleTimePanelHeight, setProjectScheduleTimePanelHeight] =
    useState(0);
  const projectScheduleTimeContentRef = useRef<HTMLDivElement>(null);
  const [projectScheduleCalendarMonth, setProjectScheduleCalendarMonth] =
    useState<Date>(() => monthStartFromYmd(createDefaultScheduleDraft().date));
  // Project settings — the one door for configuring a project. `section` is the active tab
  // (General / Instructions / Danger zone), so rail cards open the same surface on the right page.
  const [projectSettings, setProjectSettings] = useState<{
    projectId: string;
    section: ProjectSettingsSection;
  } | null>(null);
  /* Hoisted here rather than into `renderProjectSettingsModal`, which is a render FUNCTION and not a
     component — hooks called inside it would run conditionally, because it returns null when no project
     is open. Two instances, one per breakpoint's tablist, sharing the panel. */
  const activeProjectSection: ProjectSettingsSection =
    projectSettings?.section ?? PROJECT_SETTINGS_SECTIONS[0].id;
  const changeProjectSection = useCallback((section: ProjectSettingsSection) => {
    setProjectSettings((current) => (current ? { ...current, section } : current));
  }, []);
  const projectTabsWide = useTabs<ProjectSettingsSection>({
    ids: PROJECT_SETTINGS_SECTION_IDS,
    activeId: activeProjectSection,
    onChange: changeProjectSection,
    panelId: PROJECT_SETTINGS_PANEL_ID,
  });
  const projectTabsNarrow = useTabs<ProjectSettingsSection>({
    ids: PROJECT_SETTINGS_SECTION_IDS,
    activeId: activeProjectSection,
    onChange: changeProjectSection,
    panelId: PROJECT_SETTINGS_PANEL_ID,
  });
  const [isProjectSettingsOpen, setIsProjectSettingsOpen] = useState(false);
  const [isProjectSettingsMounted, setIsProjectSettingsMounted] = useState(false);
  const [isProjectSettingsShown, setIsProjectSettingsShown] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [settingsNameDraft, setSettingsNameDraft] = useState('');
  const [settingsDescriptionDraft, setSettingsDescriptionDraft] = useState('');
  const [newChatProjectName, setNewChatProjectName] = useState('');
  const [newChatProjectDescription, setNewChatProjectDescription] = useState('');
  /** If set, the next created project receives this conversation. */
  const [pendingProjectAssignConversationId, setPendingProjectAssignConversationId] = useState<string | null>(null);

  const [isTranscriptCopied, setIsTranscriptCopied] = useState(false);

  const handleCopySessionTranscript = useCallback(async () => {
    try {
      const activeTitle = activeConversationId
        ? (conversationHistory.find(c => c.id === activeConversationId)?.title || 'Untitled Conversation')
        : 'New Conversation';

      const containerBounds = chatContainerRef.current?.getBoundingClientRect();
      const chatAreaBounds = chatAreaRef.current?.getBoundingClientRect();
      const textareaBounds = textareaRef.current?.getBoundingClientRect();

      const telemetry = {
        exportTimestamp: new Date().toISOString(),
        client: {
          url: window.location.href,
          userAgent: navigator.userAgent,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
            orientation: window.screen?.orientation?.type || (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'),
          },
          measurements: {
            chatContainer: containerBounds ? { width: Math.round(containerBounds.width), height: Math.round(containerBounds.height), top: Math.round(containerBounds.top), left: Math.round(containerBounds.left) } : null,
            chatArea: chatAreaBounds ? { width: Math.round(chatAreaBounds.width), height: Math.round(chatAreaBounds.height), top: Math.round(chatAreaBounds.top), left: Math.round(chatAreaBounds.left) } : null,
            textarea: textareaBounds ? { width: Math.round(textareaBounds.width), height: Math.round(textareaBounds.height) } : null,
          },
          theme: chatTheme,
          isMobile,
          isStandalone,
          isMultiInterface,
        },
        session: {
          conversationId: activeConversationId || 'new-session',
          conversationTitle: activeTitle,
          chatMode,
          selectedModel: {
            id: selectedModel?.id,
            name: selectedModel?.name,
            provider: selectedModel?.provider || (selectedModel?.id ? getCompanyNameFromModelId(selectedModel.id) : 'unknown'),
            contextWindow: selectedModel?.contextWindow,
            maxTokens: selectedModel?.maxTokens,
            temperature: selectedModel?.temperature,
          },
          systemPrompt: systemPrompt || null,
          persona: selectedPersona || null,
          pistonRuntimesCount: pistonRuntimes?.length || 0,
          totalMessages: messages.length,
          stats: {
            totalTokens: totalUsedTokens,
            isStreaming: isLoading,
          },
        },
        messages: messages.map((m, idx) => ({
          index: idx + 1,
          id: m.id,
          role: m.role,
          timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : null,
          content: m.content,
          reasoning: (m as any).reasoning || (m as any).thought || null,
          images: m.images?.map(img => ({ name: img.name, size: img.size, type: img.type })) || [],
          files: m.files?.map(f => ({ name: f.name, size: f.size, type: f.type })) || [],
          sources: m.sources?.map(s => ({ title: s.title, url: s.url, snippet: s.snippet })) || [],
          toolCalls: (m as any).toolCalls || null,
          searchQuery: (m as any).searchQuery || null,
          isError: Boolean(m.isError),
        })),
      };

      let readableLog = `# XENO Chat Session Transcript\n\n`;
      readableLog += `- **Exported At:** ${telemetry.exportTimestamp}\n`;
      readableLog += `- **Conversation:** ${activeTitle} (\`${telemetry.session.conversationId}\`)\n`;
      readableLog += `- **Model:** ${selectedModel?.name || selectedModel?.id || 'Default'} (\`${selectedModel?.id || 'n/a'}\`)\n`;
      readableLog += `- **Mode:** \`${chatMode}\` | **Theme:** \`${chatTheme}\` | **Viewport:** ${telemetry.client.viewport.width}x${telemetry.client.viewport.height} (DPR: ${telemetry.client.viewport.devicePixelRatio})\n`;
      readableLog += `- **Chat Container:** ${telemetry.client.measurements.chatContainer?.width || 'auto'}px × ${telemetry.client.measurements.chatContainer?.height || 'auto'}px\n`;
      readableLog += `- **Composer Textarea:** ${telemetry.client.measurements.textarea?.width || 'auto'}px × ${telemetry.client.measurements.textarea?.height || 'auto'}px\n\n`;
      readableLog += `## Message History (${messages.length} messages)\n\n`;

      if (messages.length === 0) {
        readableLog += `_(No messages in active session)_\n\n`;
      } else {
        messages.forEach((m, i) => {
          readableLog += `### [${i + 1}] ${m.role.toUpperCase()} — ${m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : 'now'}\n\n`;
          if ((m as any).reasoning || (m as any).thought) {
            readableLog += `> **Thinking / Reasoning Trace:**\n> ${((m as any).reasoning || (m as any).thought || '').replace(/\\n/g, '\n> ')}\n\n`;
          }
          readableLog += `${m.content}\n\n`;
          if (m.sources && m.sources.length > 0) {
            readableLog += `**Sources / Citations:**\n`;
            m.sources.forEach(s => {
              readableLog += `- [${s.title || s.url}](${s.url}): ${s.snippet || ''}\n`;
            });
            readableLog += `\n`;
          }
          if ((m as any).toolCalls && (m as any).toolCalls.length > 0) {
            readableLog += `**Tool Invocations:**\n\`\`\`json\n${JSON.stringify((m as any).toolCalls, null, 2)}\n\`\`\`\n\n`;
          }
        });
      }

      readableLog += `---\n## Diagnostic JSON Snapshot\n\`\`\`json\n${JSON.stringify(telemetry, null, 2)}\n\`\`\`\n`;

      await navigator.clipboard.writeText(readableLog);
      setIsTranscriptCopied(true);
      setTimeout(() => setIsTranscriptCopied(false), 2200);
    } catch (err) {
      console.error('[ChatWithLLM] Failed to copy transcript to clipboard:', err);
    }
  }, [
    activeConversationId,
    conversationHistory,
    chatContainerRef,
    chatAreaRef,
    textareaRef,
    chatTheme,
    isMobile,
    isStandalone,
    isMultiInterface,
    chatMode,
    selectedModel,
    systemPrompt,
    selectedPersona,
    pistonRuntimes,
    messages,
    totalUsedTokens,
    isLoading,
  ]);

  useEffect(() => {
    localStorage.setItem(chatProjectsStorageKey, JSON.stringify(chatProjects));
  }, [chatProjects, chatProjectsStorageKey]);

  // Cloud sync for projects when authenticated
  useEffect(() => {
    if (!chatService.isAuthenticated()) return;
    let isSubscribed = true;

    chatService.getProjects().then((serverProjects) => {
      if (!isSubscribed || !Array.isArray(serverProjects) || serverProjects.length === 0) return;
      setChatProjects((prev) => {
        const newProjects: ChatHistoryProject[] = serverProjects.map((p) => ({
          id: p.id,
          name: (p.name ?? '').slice(0, PROJECT_NAME_MAX_CHARS) || 'Untitled project',
          description: p.description || '',
          instructions: p.custom_instructions || '',
          files: [],
          updatedAt: p.updated_at ? new Date(p.updated_at).getTime() : Date.now(),
        }));
        const merged = [...prev];
        for (const np of newProjects) {
          const idx = merged.findIndex((p) => p.id === np.id);
          if (idx >= 0) {
            merged[idx] = { ...merged[idx], name: np.name, description: np.description, instructions: np.instructions };
          } else {
            merged.push(np);
          }
        }
        return merged;
      });
    }).catch((err) => {
      console.warn('[ChatWithLLM] Failed to sync projects from backend:', err);
    });

    return () => {
      isSubscribed = false;
    };
  }, []);

  const closeCreateProjectModal = useCallback(() => {
    // Intent only — drafts clear after the exit animation.
    setIsCreateProjectModalOpen(false);
  }, []);

  const openCreateProjectModal = useCallback((options?: { assignConversationId?: string }) => {
    setPendingProjectAssignConversationId(options?.assignConversationId ?? null);
    setNewChatProjectName('');
    setNewChatProjectDescription('');
    setIsProjectsSortOpen(false);
    setIsCreateProjectModalOpen(true);
  }, []);

  // Same enter/exit orchestration as Project settings / Add scheduled task.
  useEffect(() => {
    if (isCreateProjectModalOpen) {
      setIsCreateProjectModalMounted(true);
      setIsCreateProjectModalShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsCreateProjectModalShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isCreateProjectModalMounted) return;
    setIsCreateProjectModalShown(false);
    const timer = window.setTimeout(() => {
      setIsCreateProjectModalMounted(false);
      setNewChatProjectName('');
      setNewChatProjectDescription('');
      setPendingProjectAssignConversationId(null);
    }, SCHEDULE_CREATE_MODAL_MS);
    return () => window.clearTimeout(timer);
  }, [isCreateProjectModalOpen, isCreateProjectModalMounted]);

  const handleToggleProjectStar = useCallback((projectId: string) => {
    setChatProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? { ...project, isStarred: !project.isStarred }
          : project,
      ),
    );
    setOpenProjectMenuId(null);
  }, []);

  const handleToggleProjectArchive = useCallback((projectId: string) => {
    setChatProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? { ...project, isArchived: !project.isArchived }
          : project,
      ),
    );
    setOpenProjectMenuId(null);
  }, []);

  const handleDeleteProject = useCallback((projectId: string) => {
    setChatProjects((prev) => prev.filter((project) => project.id !== projectId));
    setOpenProjectMenuId(null);
    setActiveProjectId((current) => {
      if (current !== projectId) return current;
      try {
        localStorage.removeItem(ACTIVE_PROJECT_ID_STORAGE_KEY);
      } catch {
        /* ignore storage failures */
      }
      return null;
    });
  }, []);

  // Read one File into a serializable ProjectFile. Text files keep their content
  // (viewable); anything else is stored as metadata only (no preview in v1).
  const readProjectFile = useCallback((file: File): Promise<ProjectFile> => {
    const base: Omit<ProjectFile, 'encoding' | 'content'> = {
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      addedAt: Date.now(),
    };
    const isText =
      file.type.startsWith('text/') ||
      /\.(txt|md|markdown|csv|json|html?|css|js|jsx|ts|tsx|py|xml|yml|yaml|log)$/i.test(file.name);
    if (!isText) {
      return Promise.resolve({
        ...base,
        encoding: 'base64',
        content: 'Preview unavailable in this prototype (non-text file).',
      });
    }
    return file.text().then((text) => ({ ...base, encoding: 'text', content: text }));
  }, []);

  const handleAddProjectFiles = useCallback(
    async (projectId: string, fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);
      const tooBig = files.filter((f) => f.size > PROJECT_FILE_MAX_BYTES);
      const accepted = files.filter((f) => f.size <= PROJECT_FILE_MAX_BYTES);

      if (tooBig.length > 0) {
        setProjectFileNotice(
          `Skipped ${tooBig.length} file(s) over 1 MB (${tooBig
            .map((f) => f.name)
            .join(', ')}). This prototype stores files in the browser, so keep them small.`,
        );
      } else {
        setProjectFileNotice(null);
      }
      if (accepted.length === 0) return;

      const parsed = await Promise.all(accepted.map(readProjectFile));
      setChatProjects((prev) =>
        prev.map((project) =>
          project.id === projectId
            ? { ...project, files: [...parsed, ...(project.files ?? [])], updatedAt: Date.now() }
            : project,
        ),
      );
    },
    [readProjectFile],
  );

  const handleRemoveProjectFile = useCallback((projectId: string, fileId: string) => {
    setChatProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? { ...project, files: (project.files ?? []).filter((f) => f.id !== fileId) }
          : project,
      ),
    );
  }, []);

  const openProjectFilePreview = useCallback(
    (file: {
      name: string;
      content?: string;
      encoding?: 'text' | 'base64';
      type?: string;
    }) => {
      setIsContextPanelOpen(false);
      setIsEditingContextPanel(false);
      setIsProjectScheduledPreviewOpen(false);
      const raw = file.content?.trim() ?? '';
      let content = raw;
      if (!content) {
        content = 'No preview available for this file.';
      } else if (file.encoding === 'base64' && file.type?.startsWith('image/')) {
        content = raw || 'Image attachment — binary preview not shown in this mock.';
      } else if (file.encoding === 'base64') {
        content = raw || 'Binary file — text preview not available.';
      }
      setProjectFilePreview({ name: file.name, content });
      setProjectFilePreviewCopied(false);
      setIsProjectFilePreviewOpen(true);
    },
    [],
  );

  const closeProjectFilePreview = useCallback(() => {
    setIsProjectFilePreviewOpen(false);
  }, []);

  useEffect(() => {
    if (isProjectFilePreviewOpen) {
      setIsProjectFilePreviewMounted(true);
      setIsProjectFilePreviewShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsProjectFilePreviewShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isProjectFilePreviewMounted) return;
    setIsProjectFilePreviewShown(false);
    const timer = window.setTimeout(() => {
      setIsProjectFilePreviewMounted(false);
      setProjectFilePreview(null);
      setProjectFilePreviewCopied(false);
    }, SCHEDULE_CREATE_MODAL_MS);
    return () => window.clearTimeout(timer);
  }, [isProjectFilePreviewOpen, isProjectFilePreviewMounted]);

  const copyProjectFilePreview = useCallback(async () => {
    if (!projectFilePreview) return;
    try {
      await navigator.clipboard.writeText(projectFilePreview.content);
      setProjectFilePreviewCopied(true);
      window.setTimeout(() => setProjectFilePreviewCopied(false), 1500);
    } catch (error) {
      console.error('Failed to copy project file preview:', error);
    }
  }, [projectFilePreview]);

  const openProjectScheduledPreview = useCallback(
    (task: { id: string; title: string; cadence: string; mark: string }) => {
      setIsContextPanelOpen(false);
      setIsProjectFilePreviewOpen(false);
      setProjectScheduledPreview(task);
      setIsProjectScheduledPreviewOpen(true);
    },
    [],
  );

  const closeProjectScheduledPreview = useCallback(() => {
    setIsProjectScheduledPreviewOpen(false);
  }, []);

  useEffect(() => {
    if (isProjectScheduledPreviewOpen) {
      setIsProjectScheduledPreviewMounted(true);
      setIsProjectScheduledPreviewShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsProjectScheduledPreviewShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isProjectScheduledPreviewMounted) return;
    setIsProjectScheduledPreviewShown(false);
    const timer = window.setTimeout(() => {
      setIsProjectScheduledPreviewMounted(false);
      setProjectScheduledPreview(null);
    }, SCHEDULE_CREATE_MODAL_MS);
    return () => window.clearTimeout(timer);
  }, [isProjectScheduledPreviewOpen, isProjectScheduledPreviewMounted]);

  const resetProjectScheduleDatePanel = useCallback(() => {
    setIsProjectScheduleDateOpen(false);
    setIsProjectScheduleDateMounted(false);
    setIsProjectScheduleDateShown(false);
    setIsProjectScheduleDateTextShown(false);
    setProjectScheduleDatePanelHeight(0);
  }, []);

  const resetProjectScheduleTimePanel = useCallback(() => {
    setIsProjectScheduleTimeOpen(false);
    setIsProjectScheduleTimeMounted(false);
    setIsProjectScheduleTimeShown(false);
    setIsProjectScheduleTimeTextShown(false);
    setProjectScheduleTimePanelHeight(0);
  }, []);

  const resetProjectScheduledWhenPanel = useCallback(() => {
    setIsProjectScheduledWhenOpen(false);
    setIsProjectScheduledWhenMounted(false);
    setIsProjectScheduledWhenShown(false);
    setIsProjectScheduledWhenTextShown(false);
    setIsProjectScheduledWhenClipOpen(false);
    setProjectScheduledWhenPanelHeight(0);
  }, []);

  const openProjectScheduledCreate = useCallback(() => {
    const draft = createDefaultScheduleDraft();
    setIsProjectScheduledPreviewOpen(false);
    setProjectScheduledCreateTitle('');
    setProjectScheduledCreateSchedule(draft);
    resetProjectScheduledWhenPanel();
    resetProjectScheduleDatePanel();
    resetProjectScheduleTimePanel();
    setProjectScheduleCalendarMonth(monthStartFromYmd(draft.date));
    setIsProjectScheduledCreateOpen(true);
  }, [
    resetProjectScheduleDatePanel,
    resetProjectScheduleTimePanel,
    resetProjectScheduledWhenPanel,
  ]);

  const closeProjectScheduledCreate = useCallback(() => {
    // Intent only — form reset waits until exit animation finishes.
    setIsProjectScheduledCreateOpen(false);
    resetProjectScheduledWhenPanel();
    resetProjectScheduleDatePanel();
    resetProjectScheduleTimePanel();
  }, [
    resetProjectScheduleDatePanel,
    resetProjectScheduleTimePanel,
    resetProjectScheduledWhenPanel,
  ]);

  useEffect(() => {
    if (isProjectScheduledCreateOpen) {
      setIsProjectScheduledCreateMounted(true);
      setIsProjectScheduledCreateShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsProjectScheduledCreateShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isProjectScheduledCreateMounted) return;
    setIsProjectScheduledCreateShown(false);
    const timer = window.setTimeout(() => {
      setIsProjectScheduledCreateMounted(false);
      setProjectScheduledCreateTitle('');
      setProjectScheduledCreateSchedule(createDefaultScheduleDraft());
    }, SCHEDULE_CREATE_MODAL_MS);
    return () => window.clearTimeout(timer);
  }, [isProjectScheduledCreateOpen, isProjectScheduledCreateMounted]);

  // When panel — open: panel then text. Close: slide whole shell away (no empty box).
  useEffect(() => {
    if (isProjectScheduledWhenOpen) {
      setIsProjectScheduledWhenMounted(true);
      setIsProjectScheduledWhenShown(false);
      setIsProjectScheduledWhenTextShown(false);
      return;
    }
    if (!isProjectScheduledWhenMounted) return;
    // Nested date/time must drop immediately or they keep height:auto + empty shell.
    resetProjectScheduleDatePanel();
    resetProjectScheduleTimePanel();
    setIsProjectScheduledWhenClipOpen(false);
    // Mirror open: text exits first (same fade/slide), then panel slides away.
    setIsProjectScheduledWhenTextShown(false);
    const panelTimer = window.setTimeout(() => {
      setIsProjectScheduledWhenShown(false);
    }, SCHEDULE_DATE_TEXT_MS);
    const unmountTimer = window.setTimeout(() => {
      setIsProjectScheduledWhenMounted(false);
      setProjectScheduledWhenPanelHeight(0);
    }, SCHEDULE_DATE_TEXT_MS + SCHEDULE_DATE_PICKER_MS);
    return () => {
      window.clearTimeout(panelTimer);
      window.clearTimeout(unmountTimer);
    };
  }, [
    isProjectScheduledWhenOpen,
    isProjectScheduledWhenMounted,
    resetProjectScheduleDatePanel,
    resetProjectScheduleTimePanel,
  ]);

  useLayoutEffect(() => {
    if (!isProjectScheduledWhenMounted) return;
    const panel = projectScheduledWhenContentRef.current;
    if (panel) setProjectScheduledWhenPanelHeight(panel.scrollHeight);
  }, [
    isProjectScheduledWhenMounted,
    projectScheduledCreateSchedule.kind,
    isProjectScheduledWhenTextShown,
  ]);

  useEffect(() => {
    if (!isProjectScheduledWhenOpen || !isProjectScheduledWhenMounted) return;
    const frame = window.requestAnimationFrame(() => {
      setIsProjectScheduledWhenShown(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isProjectScheduledWhenOpen, isProjectScheduledWhenMounted]);

  useEffect(() => {
    if (!isProjectScheduledWhenOpen || !isProjectScheduledWhenShown) return;
    const timer = window.setTimeout(() => {
      setIsProjectScheduledWhenTextShown(true);
    }, SCHEDULE_DATE_TEXT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isProjectScheduledWhenOpen, isProjectScheduledWhenShown]);

  useEffect(() => {
    if (!isProjectScheduledWhenShown) {
      setIsProjectScheduledWhenClipOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setIsProjectScheduledWhenClipOpen(true);
    }, SCHEDULE_DATE_PICKER_MS);
    return () => window.clearTimeout(timer);
  }, [isProjectScheduledWhenShown]);

  useEffect(() => {
    if (isProjectScheduleDateOpen) {
      setIsProjectScheduleDateMounted(true);
      setIsProjectScheduleDateShown(false);
      setIsProjectScheduleDateTextShown(false);
      return;
    }
    // Close: text out first, then panel slides under the date field, then unmount.
    if (!isProjectScheduleDateMounted) return;
    setIsProjectScheduleDateTextShown(false);
    const panelTimer = window.setTimeout(() => {
      setIsProjectScheduleDateShown(false);
    }, SCHEDULE_DATE_TEXT_MS);
    const unmountTimer = window.setTimeout(() => {
      setIsProjectScheduleDateMounted(false);
      setProjectScheduleDatePanelHeight(0);
    }, SCHEDULE_DATE_TEXT_MS + SCHEDULE_DATE_PICKER_MS);
    return () => {
      window.clearTimeout(panelTimer);
      window.clearTimeout(unmountTimer);
    };
  }, [isProjectScheduleDateOpen, isProjectScheduleDateMounted]);

  // Measure before paint so the slide does not wait on a second frame.
  useLayoutEffect(() => {
    if (!isProjectScheduleDateMounted) return;
    const panel = projectScheduleDateContentRef.current;
    if (panel) setProjectScheduleDatePanelHeight(panel.scrollHeight);
  }, [isProjectScheduleDateMounted, projectScheduleCalendarMonth]);

  // One frame after the closed state paints, then slide — avoids double-rAF lag.
  useEffect(() => {
    if (!isProjectScheduleDateOpen || !isProjectScheduleDateMounted) return;
    const frame = window.requestAnimationFrame(() => {
      setIsProjectScheduleDateShown(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isProjectScheduleDateOpen, isProjectScheduleDateMounted]);

  // Open only: text after panel. Close sequence is handled above.
  useEffect(() => {
    if (!isProjectScheduleDateOpen || !isProjectScheduleDateShown) return;
    const timer = window.setTimeout(() => {
      setIsProjectScheduleDateTextShown(true);
    }, SCHEDULE_DATE_TEXT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isProjectScheduleDateOpen, isProjectScheduleDateShown]);

  useEffect(() => {
    if (projectScheduledCreateSchedule.kind !== 'once') {
      setIsProjectScheduleDateOpen(false);
    }
  }, [projectScheduledCreateSchedule.kind]);

  const toggleProjectScheduleDatePicker = useCallback(() => {
    setIsProjectScheduleTimeOpen(false);
    setIsProjectScheduleDateOpen((open) => {
      if (!open) {
        setProjectScheduleCalendarMonth(
          monthStartFromYmd(projectScheduledCreateSchedule.date),
        );
      }
      return !open;
    });
  }, [projectScheduledCreateSchedule.date]);

  useEffect(() => {
    if (isProjectScheduleTimeOpen) {
      setIsProjectScheduleTimeMounted(true);
      setIsProjectScheduleTimeShown(false);
      setIsProjectScheduleTimeTextShown(false);
      return;
    }
    if (!isProjectScheduleTimeMounted) return;
    setIsProjectScheduleTimeTextShown(false);
    const panelTimer = window.setTimeout(() => {
      setIsProjectScheduleTimeShown(false);
    }, SCHEDULE_DATE_TEXT_MS);
    const unmountTimer = window.setTimeout(() => {
      setIsProjectScheduleTimeMounted(false);
      setProjectScheduleTimePanelHeight(0);
    }, SCHEDULE_DATE_TEXT_MS + SCHEDULE_DATE_PICKER_MS);
    return () => {
      window.clearTimeout(panelTimer);
      window.clearTimeout(unmountTimer);
    };
  }, [isProjectScheduleTimeOpen, isProjectScheduleTimeMounted]);

  useLayoutEffect(() => {
    if (!isProjectScheduleTimeMounted) return;
    const panel = projectScheduleTimeContentRef.current;
    if (panel) setProjectScheduleTimePanelHeight(panel.scrollHeight);
  }, [isProjectScheduleTimeMounted]);

  useEffect(() => {
    if (!isProjectScheduleTimeOpen || !isProjectScheduleTimeMounted) return;
    const frame = window.requestAnimationFrame(() => {
      setIsProjectScheduleTimeShown(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isProjectScheduleTimeOpen, isProjectScheduleTimeMounted]);

  useEffect(() => {
    if (!isProjectScheduleTimeOpen || !isProjectScheduleTimeShown) return;
    const timer = window.setTimeout(() => {
      setIsProjectScheduleTimeTextShown(true);
    }, SCHEDULE_DATE_TEXT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isProjectScheduleTimeOpen, isProjectScheduleTimeShown]);

  const toggleProjectScheduleTimePicker = useCallback(() => {
    setIsProjectScheduleDateOpen(false);
    setIsProjectScheduleTimeOpen((open) => !open);
  }, []);

  const setProjectScheduleTimePart = useCallback(
    (part: 'hour12' | 'minute' | 'meridiem', value: string) => {
      setProjectScheduledCreateSchedule((prev) => {
        const current = parseScheduleTime(prev.time);
        const hour12 = part === 'hour12' ? value : current.hour12;
        const minute = part === 'minute' ? value : current.minute;
        const meridiem =
          part === 'meridiem' && (value === 'AM' || value === 'PM')
            ? value
            : current.meridiem;
        return {
          ...prev,
          time: toScheduleTime24(hour12, minute, meridiem),
        };
      });
    },
    [],
  );

  const submitProjectScheduledCreate = useCallback(() => {
    const title = projectScheduledCreateTitle.trim();
    if (!title || !activeProjectId) return;
    const cadence = formatProjectScheduleLabel(projectScheduledCreateSchedule);
    const mark = markFromScheduleDraft(projectScheduledCreateSchedule);
    const task: ProjectScheduledTask = {
      id: `sched-${Date.now().toString(36)}`,
      title,
      cadence,
      mark,
    };
    setChatProjects((prev) =>
      prev.map((project) => {
        if (project.id !== activeProjectId) return project;
        const existing =
          (project.scheduledTasks?.length ?? 0) > 0
            ? (project.scheduledTasks ?? [])
            : [...MOCK_PROJECT_SCHEDULED];
        return {
          ...project,
          scheduledTasks: [task, ...existing],
          updatedAt: Date.now(),
        };
      }),
    );
    closeProjectScheduledCreate();
    setProjectScheduledPreview(task);
    setIsProjectScheduledPreviewOpen(true);
  }, [
    activeProjectId,
    closeProjectScheduledCreate,
    projectScheduledCreateSchedule,
    projectScheduledCreateTitle,
  ]);

  const openProjectSettings = useCallback(
    (project: ChatHistoryProject, section: ProjectSettingsSection = 'general') => {
      setSettingsNameDraft(project.name.slice(0, PROJECT_NAME_MAX_CHARS));
      setSettingsDescriptionDraft(project.description ?? '');
      // The rail shows demo instructions when none are saved, so the editor opens on the same
      // text the user is looking at rather than on an empty box.
      setInstructionsDraft(project.instructions ?? MOCK_PROJECT_INSTRUCTIONS);
      setOpenProjectMenuId(null);
      setIsProjectsSortOpen(false);
      setProjectSettings({ projectId: project.id, section });
      setIsProjectSettingsOpen(true);
    },
    [],
  );

  const closeProjectSettings = useCallback(() => {
    // Intent only — drafts clear after the exit animation (same as Add scheduled task).
    setIsProjectSettingsOpen(false);
  }, []);

  // Same enter/exit orchestration as Add scheduled task modal.
  useEffect(() => {
    if (isProjectSettingsOpen) {
      setIsProjectSettingsMounted(true);
      setIsProjectSettingsShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsProjectSettingsShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isProjectSettingsMounted) return;
    setIsProjectSettingsShown(false);
    const timer = window.setTimeout(() => {
      setIsProjectSettingsMounted(false);
      setProjectSettings(null);
      setSettingsNameDraft('');
      setSettingsDescriptionDraft('');
      setInstructionsDraft('');
    }, SCHEDULE_CREATE_MODAL_MS);
    return () => window.clearTimeout(timer);
  }, [isProjectSettingsOpen, isProjectSettingsMounted]);

  /**
   * Name, description and instructions are drafts committed together. File and schedule changes
   * are immediate actions, so they are deliberately not part of this save.
   */
  const saveProjectSettings = useCallback(() => {
    if (!projectSettings) return;
    const { projectId } = projectSettings;
    const name = settingsNameDraft.trim().slice(0, PROJECT_NAME_MAX_CHARS);
    const description = settingsDescriptionDraft.trim();
    const instructions = instructionsDraft.trim();
    setChatProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? {
              ...project,
              name: name || project.name,
              description: description || undefined,
              instructions: instructions || undefined,
              updatedAt: Date.now(),
            }
          : project,
      ),
    );
    closeProjectSettings();
  }, [
    projectSettings,
    settingsNameDraft,
    settingsDescriptionDraft,
    instructionsDraft,
    closeProjectSettings,
  ]);

  const createChatProject = useCallback((name?: string, description?: string) => {
    const projectName =
      (name ?? newChatProjectName).trim().slice(0, PROJECT_NAME_MAX_CHARS) || 'Untitled project';
    const projectDescription = (description ?? newChatProjectDescription).trim();
    const now = Date.now();
    const project: ChatHistoryProject = {
      id: `project-${now}`,
      name: projectName,
      description: projectDescription || undefined,
      createdAt: now,
      updatedAt: now,
    };
    setChatProjects((prev) => [project, ...prev]);
    closeCreateProjectModal();
    return project;
  }, [closeCreateProjectModal, newChatProjectDescription, newChatProjectName]);

  const openProjectsPage = useCallback(() => {
    setHistoryNavView('projects');
    setIsProjectsPageOpen(true);
    setIsArtifactsPageOpen(false);
    setIsGlobalSettingsPageOpen(false);
    setIsScheduledPageOpen(false);
    setIsCustomizePageOpen(false);
    setIsChatsCatalogOpen(false);
    setIsChatsCatalogFilterOpen(false);
    setProjectsPageSearch('');
    setIsProjectsSortOpen(false);
    try {
      localStorage.setItem(PROJECTS_PAGE_OPEN_STORAGE_KEY, 'true');
    } catch {
      /* ignore storage failures */
    }
  }, []);

  const openArtifactsPage = useCallback(() => {
    setHistoryNavView('artifacts');
    setIsArtifactsPageOpen(true);
    setIsGlobalSettingsPageOpen(false);
    setIsScheduledPageOpen(false);
    setIsCustomizePageOpen(false);
    setIsProjectsPageOpen(false);
    setActiveProjectId(null);
    setIsChatsCatalogOpen(false);
    setIsChatsCatalogFilterOpen(false);
    setIsProjectsSortOpen(false);
    try {
      localStorage.setItem(PROJECTS_PAGE_OPEN_STORAGE_KEY, 'false');
      localStorage.removeItem(ACTIVE_PROJECT_ID_STORAGE_KEY);
    } catch {
      /* ignore storage failures */
    }
  }, []);

  const openGlobalSettingsPage = useCallback(() => {
    setHistoryNavView('global_settings');
    setIsGlobalSettingsPageOpen(true);
    setIsArtifactsPageOpen(false);
    setIsScheduledPageOpen(false);
    setIsCustomizePageOpen(false);
    setIsProjectsPageOpen(false);
    setActiveProjectId(null);
    setIsChatsCatalogOpen(false);
    setIsChatsCatalogFilterOpen(false);
    setIsProjectsSortOpen(false);
    try {
      localStorage.setItem(PROJECTS_PAGE_OPEN_STORAGE_KEY, 'false');
      localStorage.removeItem(ACTIVE_PROJECT_ID_STORAGE_KEY);
    } catch {
      /* ignore storage failures */
    }
  }, []);

  const openScheduledPage = useCallback(() => {
    setHistoryNavView('scheduled');
    setIsScheduledPageOpen(true);
    setIsArtifactsPageOpen(false);
    setIsGlobalSettingsPageOpen(false);
    setIsCustomizePageOpen(false);
    setIsProjectsPageOpen(false);
    setActiveProjectId(null);
    setIsChatsCatalogOpen(false);
    setIsChatsCatalogFilterOpen(false);
    setIsProjectsSortOpen(false);
    try {
      localStorage.setItem(PROJECTS_PAGE_OPEN_STORAGE_KEY, 'false');
      localStorage.removeItem(ACTIVE_PROJECT_ID_STORAGE_KEY);
    } catch {
      /* ignore storage failures */
    }
  }, []);

  const openCustomizePage = useCallback((trigger?: EventTarget | null) => {
    // Floating window over whatever is open — do not replace Projects/Artifacts/etc.
    const el =
      trigger instanceof Element
        ? trigger
        : customizeButtonRef.current;
    setCustomizeMotionFrom(measureModalFromTrigger(el));
    setIsSettingsModalOpen(false);
    setIsCustomizePageOpen(true);
  }, []);

  const openChatSettings = useCallback(() => {
    setIsCustomizePageOpen(false);
    setIsSettingsModalOpen(true);
  }, []);

  const closeChatSettings = useCallback(() => {
    setIsSettingsModalOpen(false);
  }, []);

  // Identical orchestration to Add scheduled task (single effect).
  useEffect(() => {
    if (isSettingsModalOpen) {
      setIsSettingsModalMounted(true);
      setIsSettingsModalShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsSettingsModalShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isSettingsModalMounted) return;
    setIsSettingsModalShown(false);
    const timer = window.setTimeout(() => {
      setIsSettingsModalMounted(false);
    }, SCHEDULE_CREATE_MODAL_MS);
    return () => window.clearTimeout(timer);
  }, [isSettingsModalOpen, isSettingsModalMounted]);

  useEffect(() => {
    if (isSharePreviewOpen) {
      setIsSharePreviewMounted(true);
      setIsSharePreviewShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsSharePreviewShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isSharePreviewMounted) return;
    setIsSharePreviewShown(false);
    const timer = window.setTimeout(() => {
      setIsSharePreviewMounted(false);
    }, SCHEDULE_CREATE_MODAL_MS);
    return () => window.clearTimeout(timer);
  }, [isSharePreviewOpen, isSharePreviewMounted]);

  // Customize (briefcase) — same enter/exit as other card modals. States are above; no TDZ.
  useEffect(() => {
    if (isCustomizePageOpen) {
      setIsCustomizePageMounted(true);
      setIsCustomizePageShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsCustomizePageShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isCustomizePageMounted) return;
    setIsCustomizePageShown(false);
    const timer = window.setTimeout(() => {
      setIsCustomizePageMounted(false);
      setCustomizeMotionFrom({ x: 0, y: 0 });
    }, SCHEDULE_CREATE_MODAL_MS);
    return () => window.clearTimeout(timer);
  }, [isCustomizePageOpen, isCustomizePageMounted]);

  useEffect(() => {
    if (deleteConfirmationModal.isOpen) {
      setIsDeleteModalMounted(true);
      setIsDeleteModalShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsDeleteModalShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isDeleteModalMounted) return;
    setIsDeleteModalShown(false);
    const timer = window.setTimeout(() => {
      setIsDeleteModalMounted(false);
      setDeleteConfirmationModal({
        isOpen: false,
        conversationId: null,
        conversationTitle: null,
        origin: 'left',
      });
    }, SCHEDULE_CREATE_MODAL_MS);
    return () => window.clearTimeout(timer);
  }, [deleteConfirmationModal.isOpen, isDeleteModalMounted]);

  /**
   * Full-page chat overlays (Projects list z-45, project workspace z-46, chats catalog z-45)
   * sit above the message stream. Any navigation to a chat or a blank new chat must leave
   * them, or the destination opens underneath and looks like a dead click.
   */
  const dismissChatOverlays = useCallback(() => {
    setActiveProjectId(null);
    setIsProjectsPageOpen(false);
    setIsArtifactsPageOpen(false);
    setIsGlobalSettingsPageOpen(false);
    setIsScheduledPageOpen(false);
    setIsCustomizePageOpen(false);
    setIsChatsCatalogOpen(false);
    setIsChatsCatalogFilterOpen(false);
    setIsProjectsSortOpen(false);
    setProjectsPageSearch('');
    try {
      localStorage.removeItem(ACTIVE_PROJECT_ID_STORAGE_KEY);
      localStorage.setItem(PROJECTS_PAGE_OPEN_STORAGE_KEY, 'false');
    } catch {
      /* ignore storage failures */
    }
  }, []);

  const openProject = useCallback((projectId: string) => {
    setIsChatsCatalogOpen(false);
    setIsChatsCatalogFilterOpen(false);
    setIsArtifactsPageOpen(false);
    setIsGlobalSettingsPageOpen(false);
    setIsScheduledPageOpen(false);
    setIsCustomizePageOpen(false);
    setActiveProjectId(projectId);
    setOpenProjectMenuId(null);
    setProjectFileNotice(null);
    setIsProjectDescExpanded(false);
    setIsProjectFilesExpanded(false);
    setIsProjectSidebarOpen(true);
    // Any conversation the reused composer starts from here should link to this project.
    pendingChatProjectIdRef.current = projectId;
    // Remember which conversation was active on entry so we only auto-leave the workspace
    // once a *different* (new) conversation becomes active.
    projectEntryConversationIdRef.current = activeConversationId;
    try {
      localStorage.setItem(ACTIVE_PROJECT_ID_STORAGE_KEY, projectId);
    } catch {
      /* ignore storage failures */
    }
  }, [activeConversationId]);

  const closeProject = useCallback(() => {
    setActiveProjectId(null);
    pendingChatProjectIdRef.current = null;
    setIsProjectFilePreviewOpen(false);
    setIsProjectFilePreviewMounted(false);
    setIsProjectFilePreviewShown(false);
    setProjectFilePreview(null);
    setProjectFilePreviewCopied(false);
    setIsProjectScheduledPreviewOpen(false);
    setIsProjectScheduledPreviewMounted(false);
    setIsProjectScheduledPreviewShown(false);
    setProjectScheduledPreview(null);
    setIsProjectScheduledCreateOpen(false);
    try {
      localStorage.removeItem(ACTIVE_PROJECT_ID_STORAGE_KEY);
    } catch {
      /* ignore storage failures */
    }
  }, []);

  // Leave project overlays once a *different* conversation becomes active from within a project
  // (new message from the project composer). History clicks go through handleLoadConversation.
  useEffect(() => {
    if (!activeProjectId) return;
    if (activeConversationId && activeConversationId !== projectEntryConversationIdRef.current) {
      dismissChatOverlays();
      setHistoryNavView('chats');
    }
  }, [activeConversationId, activeProjectId, dismissChatOverlays]);

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
  const [isFullScreenImageMounted, setIsFullScreenImageMounted] = useState(false);
  const [isFullScreenImageShown, setIsFullScreenImageShown] = useState(false);
  const [fullScreenImageUrl, setFullScreenImageUrl] = useState<string | null>(null);
  const [viewerShowsDownloadButton, setViewerShowsDownloadButton] = useState(false); // New state for download button visibility
  // --- END Full-screen Image Viewer STATE ---

  // Must sit below the useState above — otherwise TDZ crashes the whole chat (black screen).
  useEffect(() => {
    if (isFullScreenImageOpen) {
      setIsFullScreenImageMounted(true);
      setIsFullScreenImageShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsFullScreenImageShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isFullScreenImageMounted) return;
    setIsFullScreenImageShown(false);
    const timer = window.setTimeout(() => {
      setIsFullScreenImageMounted(false);
      setFullScreenImageUrl((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return null;
      });
    }, SCHEDULE_CREATE_MODAL_MS);
    return () => window.clearTimeout(timer);
  }, [isFullScreenImageOpen, isFullScreenImageMounted]);

  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
  const metadataCache = useRef<Record<string, any>>({});

  // --- State for voice input ---
  const [isVoiceInputActive, setIsVoiceInputActive] = useState(false);
  const [isVoiceModeMenuOpen, setIsVoiceModeMenuOpen] = useState(false);
  // Keep the voice menu mounted through its exit animation.
  const [isVoiceMenuClosing, setIsVoiceMenuClosing] = useState(false);
  const voiceMenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openVoiceMenu = useCallback(() => {
    if (voiceMenuCloseTimer.current) clearTimeout(voiceMenuCloseTimer.current);
    setIsVoiceMenuClosing(false);
    setIsVoiceModeMenuOpen(true);
  }, []);
  const closeVoiceMenu = useCallback(() => {
    setIsVoiceModeMenuOpen(false);
    setIsVoiceMenuClosing(true);
    if (voiceMenuCloseTimer.current) clearTimeout(voiceMenuCloseTimer.current);
    voiceMenuCloseTimer.current = setTimeout(() => setIsVoiceMenuClosing(false), 150);
  }, []);
  const [voiceInputMode, setVoiceInputMode] = useState<VoiceInputMode>(() => {
    if (typeof window === 'undefined') return 'tap';

    try {
      return localStorage.getItem(VOICE_INPUT_MODE_STORAGE_KEY) === 'hold' ? 'hold' : 'tap';
    } catch {
      return 'tap';
    }
  });
  const recognitionRef = useRef<any | null>(null); // Changed SpeechRecognition to any
  const isVoiceRecognitionRunningRef = useRef(false);
  const finalTranscriptRef = useRef<string>('');
  const pendingVoiceSubmissionRef = useRef(false);
  const submitVoiceTranscriptRef = useRef<(transcript: string) => void>(() => undefined);

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

  const handleEmptyStateModeChange = useCallback((mode: ChatMode) => {
    setEmptyStateMode(mode);
    setIsXenoSearchEnabled(modeUsesXenoSearch(mode));
  }, []);

  const handleEmptyStateAgentAction = useCallback(() => {
    setEmptyStateMode('chat');
    setIsXenoSearchEnabled(false);
  }, []);
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
      const maxHeight = messages.length === 0 ? 120 : 120;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }
  }, [inputValue, messages.length]);

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
        console.error('❌ Failed to load models:', error);
        // No local fallback catalog — the model list stays empty until the
        // auth-gated /api/models call succeeds.
      } finally {
        setIsModelsLoading(false);
      }
    };

    loadModels();
  }, []);

  /* Escape closes the attach menu — the one thing `useMenu` deliberately leaves alone. The hook owns
     the arrows, Home/End and Tab and hands dismissal back to whoever owns the open state, which is why
     every other menu in this file pairs its click-outside effect with a listener like this one. */
  useEffect(() => {
    if (!isAttachMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // The submenu first: Escape should take one step back, not close the whole thing at once.
      if (isRecentFilesOpen) {
        setIsRecentFilesOpen(false);
        return;
      }
      setIsAttachMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isAttachMenuOpen, isRecentFilesOpen]);

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
      if (
        isVoiceModeMenuOpen &&
        voiceControlRef.current &&
        !voiceControlRef.current.contains(event.target as Node)
      ) {
        closeVoiceMenu();
      }
      if (
        isThemeMenuOpen &&
        themeMenuRef.current &&
        !themeMenuRef.current.contains(event.target as Node) &&
        !(chatMoreMenuRef.current && chatMoreMenuRef.current.contains(event.target as Node))
      ) {
        setIsThemeMenuOpen(false);
      }
      if (
        isChatMoreMenuOpen &&
        chatMoreMenuRef.current &&
        !chatMoreMenuRef.current.contains(event.target as Node)
      ) {
        setIsChatMoreMenuOpen(false);
        setIsThemeMenuOpen(false);
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

    /**
     * Escape closes the same family of surfaces the click-outside above closes.
     *
     * It lives here rather than in each popover because they were all opened by the same kind of gesture
     * and dismissed by the same rule — and because that rule had exactly one half of it. Clicking away
     * closed every one of these; Escape closed none. That is a gap you only notice from the keyboard, and
     * a menu that ignores Escape leaves someone stuck with no visible way out.
     *
     * INNERMOST FIRST, and that ordering is the point rather than a detail: the theme submenu opens
     * inside the ⋯ menu, so Escape has to peel one layer, not both. Closing them together would mean a
     * user who opened a submenu by mistake loses the menu as well and has to start over.
     */
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isThemeMenuOpen) {
        setIsThemeMenuOpen(false);
        return;
      }
      if (isRecentFilesOpen) {
        setIsRecentFilesOpen(false);
        return;
      }
      if (isChatMoreMenuOpen) {
        setIsChatMoreMenuOpen(false);
        return;
      }
      if (isAttachMenuOpen) {
        setIsAttachMenuOpen(false);
        return;
      }
      if (isVoiceModeMenuOpen) {
        setIsVoiceModeMenuOpen(false);
        return;
      }
      if (isConversationSelectorOpen) {
        setIsConversationSelectorOpen(false);
        return;
      }
      if (isSystemPromptOpen) {
        setIsSystemPromptOpen(false);
        return;
      }
      if (modelTooltipInfo) {
        setModelTooltipInfo(null);
        return;
      }
      if (feedbackPopupInfo) {
        setFeedbackPopupInfo(null);
        return;
      }
      if (dislikePopupInfo) {
        setDislikePopupInfo(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isAttachMenuOpen, isRecentFilesOpen, isVoiceModeMenuOpen, isThemeMenuOpen, isChatMoreMenuOpen, isSystemPromptOpen, modelTooltipInfo, feedbackPopupInfo, dislikePopupInfo, isConversationSelectorOpen]);

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
            include_archived: true,
          });

          if (conversations && conversations.length > 0) {
            // Convert database format to local format
            const localFormat: Conversation[] = conversations.map(conv => ({
              id: conv.id,
              title: conv.title,
              timestamp: conv.created_at ? new Date(conv.created_at).getTime() : Date.now(),
              messages: [], // Messages loaded on demand
              systemPrompt: conv.system_prompt,
              isArchived: Boolean(conv.is_archived),
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

  // The DEV demo thread is seeded straight into `messages`, so it was a chat that existed on screen and
  // nowhere else. Everything that acts on the OPEN conversation — Pin, Archive, Delete — looks it up in
  // the history by id, found nothing, and sat disabled. That is why those three were the only rows in
  // the ⋯ menu with no hover pill: the pill refuses a row you cannot click.
  //
  // Registering the demo makes it a conversation like any other. It waits for the load to settle because
  // every load path REPLACES the history rather than merging into it, so seeding it as initial state
  // would simply be overwritten a moment later.
  //
  // Dev-only, deliberately. In production a chat reaches the history through the send path, which creates
  // the conversation in the DATABASE and uses the id it gets back; registering one locally first would
  // take that branch away and quietly stop persisting the thread server-side. The window where the same
  // rows are dead in production — between sending the first message and the answer arriving — is real but
  // is a change to the send path, not to this.
  useEffect(() => {
    if (!CHAT_DEMO_ENABLED || isHistoryLoading) return;
    if (activeConversationId || messages.length === 0) return;
    const firstUserMessage = messages.find((message) => message.sender === 'user');
    const demoConversation: Conversation = {
      id: CHAT_DEMO_CONVERSATION_ID,
      title: firstUserMessage?.text.substring(0, 40) || 'Demo conversation',
      timestamp: Date.now(),
      messages,
    };
    setConversationHistory((prevHistory) =>
      prevHistory.some((convo) => convo.id === CHAT_DEMO_CONVERSATION_ID)
        ? prevHistory
        : [demoConversation, ...prevHistory],
    );
    setActiveConversationId(CHAT_DEMO_CONVERSATION_ID);
  }, [isHistoryLoading, activeConversationId, messages]);

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

  // Focus + size edit textarea when edit mode opens.
  useEffect(() => {
    const textarea = editInputRef.current;
    if (textarea && editingMessageId) {
      textarea.focus();
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(textarea.scrollHeight, 44)}px`;
    }
  }, [editText, editingMessageId]);

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
      isVoiceRecognitionRunningRef.current = false;
      setIsVoiceInputActive(false);

      if (pendingVoiceSubmissionRef.current) {
        pendingVoiceSubmissionRef.current = false;
        window.setTimeout(() => submitVoiceTranscriptRef.current(finalTranscriptRef.current), 0);
      }
    };

    recognition.onerror = (event: any) => { // Changed event type to any
      console.error('Speech recognition error:', event.error);
      // Handle common errors more gracefully
      if (event.error === 'no-speech' || event.error === 'audio-capture' || event.error === 'not-allowed') {
        // Optionally, provide user feedback here
      }
      isVoiceRecognitionRunningRef.current = false;
      setIsVoiceInputActive(false);

      if (pendingVoiceSubmissionRef.current) {
        pendingVoiceSubmissionRef.current = false;
        window.setTimeout(() => submitVoiceTranscriptRef.current(finalTranscriptRef.current), 0);
      }
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
        if (isVoiceRecognitionRunningRef.current) {
            recognitionRef.current.stop();
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount.

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_INPUT_MODE_STORAGE_KEY, voiceInputMode);
    } catch {
      // Storage can be unavailable in privacy-restricted browser sessions.
    }
  }, [voiceInputMode]);

  const startVoiceInput = useCallback(() => {
    if (!recognitionRef.current) {
      console.error('Speech recognition not initialized.');
      return;
    }

    if (isVoiceRecognitionRunningRef.current) return;

    // Preserve existing input and append the dictated transcript to it.
    finalTranscriptRef.current = inputValue;

    try {
      isVoiceRecognitionRunningRef.current = true;
      recognitionRef.current.start();
      setIsVoiceInputActive(true);
    } catch (error) {
      // Browsers throw if start is requested while recognition is still closing.
      isVoiceRecognitionRunningRef.current = false;
      setIsVoiceInputActive(false);
      console.error('Could not start voice input:', error);
    }
  }, [inputValue]);

  const stopVoiceInput = useCallback(() => {
    if (!recognitionRef.current || !isVoiceRecognitionRunningRef.current) return;

    try {
      recognitionRef.current.stop();
    } catch (error) {
      isVoiceRecognitionRunningRef.current = false;
      setIsVoiceInputActive(false);
      console.error('Could not stop voice input:', error);
    }
  }, []);

  const handleToggleVoiceInput = useCallback(() => {
    if (isVoiceRecognitionRunningRef.current) {
      stopVoiceInput();
      return;
    }

    startVoiceInput();
  }, [startVoiceInput, stopVoiceInput]);

  const handleVoicePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (voiceInputMode !== 'hold' || event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startVoiceInput();
  };

  const handleVoicePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (voiceInputMode !== 'hold') return;

    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    stopVoiceInput();
  };

  const handleVoiceKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (voiceInputMode !== 'hold' || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;

    event.preventDefault();
    startVoiceInput();
  };

  const handleVoiceKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (voiceInputMode !== 'hold' || (event.key !== 'Enter' && event.key !== ' ')) return;

    event.preventDefault();
    stopVoiceInput();
  };

  // --- Typewriter reveal (client-side "streaming" of the answer) -----------
  // The mock (and today's real backend) return the whole answer at once. We
  // reveal it word-by-word for a streaming feel. This is the exact seam where
  // real SSE token streaming plugs in later. Set TYPEWRITER_ENABLED = false to
  // show answers whole again.
  const TYPEWRITER_ENABLED = true;
  const typewriterRef = useRef<{ id: string; full: string; timer: ReturnType<typeof setInterval> } | null>(null);

  const finishTypewriter = useCallback(() => {
    const tw = typewriterRef.current;
    if (!tw) return;
    clearInterval(tw.timer);
    typewriterRef.current = null;
    setMessages((prev) =>
      prev.map((m) => (m.id === tw.id ? { ...m, parsedAnswer: tw.full, isStreaming: false } : m)),
    );
  }, []);

  const startTypewriter = useCallback((id: string, full: string) => {
    finishTypewriter(); // complete any previous reveal before starting a new one
    // Split keeping whitespace so whole words appear (smoother than per-char).
    const tokens = full.split(/(\s+)/);
    const perTick = Math.max(1, Math.ceil(tokens.length / 90)); // ~90 frames, any length
    let shown = 0;
    const reveal = () => {
      shown = Math.min(tokens.length, shown + perTick);
      const slice = tokens.slice(0, shown).join('');
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, parsedAnswer: slice } : m)));
      if (shown >= tokens.length) finishTypewriter();
    };
    const timer = setInterval(reveal, 28);
    typewriterRef.current = { id, full, timer };
    reveal(); // first words immediately — no empty flash
  }, [finishTypewriter]);

  /**
   * Put the open thread in the history and make it the active conversation. Returns its id.
   *
   * Extracted from the answer handler, which used to be the ONLY place a conversation was born — the
   * thread existed on screen from the first keystroke but nowhere else until the model finished
   * answering. Everything that acts on "this conversation" (Pin, Archive, Delete, moving it into a
   * project) looks it up by id, so for those seconds the controls were live-looking and dead.
   *
   * The database branch is the reason this is a function rather than a line in the send path: when the
   * user is authenticated the id has to come BACK from the server, and creating a local one first would
   * take that branch away and quietly stop persisting the thread. The local id is the fallback, same as
   * it always was.
   *
   * The ref is written before the state, because the send already in flight closed over the old value.
   */
  const createConversationForMessages = async (
    conversationMessages: ChatMessage[],
  ): Promise<string | null> => {
    if (isTemporaryChat) return null;
    if (activeConversationIdRef.current || isCreatingConversationRef.current) return null;
    if (conversationMessages.length === 0) return null;
    isCreatingConversationRef.current = true;

    const now = Date.now();
    const firstUserMessage = conversationMessages.find((message) => message.sender === 'user');
    const title = firstUserMessage?.text.substring(0, 40) || 'Untitled Chat';
    const projectId = pendingChatProjectIdRef.current ?? undefined;

    const register = (id: string): string => {
      const newConversation: Conversation = {
        id,
        title,
        timestamp: now,
        messages: conversationMessages,
        systemPrompt: savedSystemPrompt || undefined,
        projectId,
      };
      activeConversationIdRef.current = id;
      setConversationHistory((prevHistory) => [newConversation, ...prevHistory]);
      setActiveConversationId(id);
      void bindPendingChatSkills(id);
      void bindPendingChatPersona(id);
      // The pending project link (if any) has now been applied to the new conversation.
      pendingChatProjectIdRef.current = null;
      return id;
    };

    try {
      if (isDbAuthenticated) {
        try {
          // Shared interface ID so every interface sees the same history.
          const dbConversation = await chatService.createConversation({
            title,
            model_id: selectedModel.id,
            system_prompt: savedSystemPrompt || undefined,
            interface_id: sharedInterfaceId,
          });
          if (dbConversation) {
            // For AI messages, save parsedAnswer (what is displayed) rather than the raw text.
            await chatService.addMessagesBatch(
              dbConversation.id,
              conversationMessages.map((msg) => ({
                role: msg.sender === 'ai' ? ('assistant' as const) : ('user' as const),
                content: msg.sender === 'ai' ? msg.parsedAnswer || msg.text : msg.text,
                model_id: msg.modelIdUsed || msg.modelId,
                thinking: msg.thinkingContent,
                has_thinking: !!msg.thinkingContent,
              })),
            );
            return register(dbConversation.id);
          }
        } catch (error) {
          console.error('Error creating conversation in database:', error);
          // Fall through to the local id.
        }
      }
      return register(`convo-${now}`);
    } finally {
      // Left long enough for the state write to land, same as the guard it replaces.
      setTimeout(() => {
        isCreatingConversationRef.current = false;
      }, 100);
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
    // Research context replaces the saved base prompt; Code mode then adds its
    // focused instruction without discarding the user's own system prompt.
    const finalSystemPrompt = buildChatSystemPrompt(
        emptyStateMode,
        savedSystemPrompt,
        xenoContext?.summary,
    );
    if (xenoContext?.summary) {
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
        // First, update the messages state. For a normal text answer, insert it
        // empty + streaming and reveal it word-by-word (typewriter); history/DB
        // below still receives the FULL updatedMessage.
        const applyTypewriter =
            TYPEWRITER_ENABLED && !updatedMessage.imageData && !updatedMessage.isError && !!updatedMessage.parsedAnswer;
        const fullAnswerForReveal = updatedMessage.parsedAnswer || '';
        setMessages(prevMessages => {
            const base = prevMessages.filter(msg => msg.id !== localPlaceholderId);
            const display = applyTypewriter
                ? { ...updatedMessage, parsedAnswer: '', isStreaming: true }
                : updatedMessage;
            return [...base, display];
        });
        if (applyTypewriter) startTypewriter(updatedMessage.id, fullAnswerForReveal);

        // Then, update the conversation history separately to prevent double updates
        const now = Date.now();
        // The ref, not the state: the send path creates the conversation while this call is in flight,
        // so the value captured when it started is stale by the time the answer lands.
        const conversationId = activeConversationIdRef.current ?? activeConversationId;
        // Use currentHistory (the parameter) instead of messages (stale state)
        if (conversationId) {
            if (!isUpdatingConversationRef.current) {
                isUpdatingConversationRef.current = true;
                const updatedMessages = [...currentHistory.filter(msg => msg.id !== localPlaceholderId), updatedMessage];

                // Update local state
                setConversationHistory(prevHistory =>
                    prevHistory.map(convo =>
                        convo.id === conversationId
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
                    chatService.addMessage(conversationId, {
                        role: 'assistant',
                        content: updatedMessage.parsedAnswer || updatedMessage.text,
                        model_id: updatedMessage.modelIdUsed || updatedMessage.modelId,
                        thinking: updatedMessage.thinkingContent,
                        has_thinking: !!updatedMessage.thinkingContent,
                    }).catch(error => {
                        console.error("Error adding message to database:", error);
                    });
                }

                // console.log("Updated conversation in history:", conversationId);
                // Reset guard after state update
                setTimeout(() => {
                    isUpdatingConversationRef.current = false;
                }, 100);
            }
        } else {
            // A fallback now, not the normal path: the send handler registers the conversation as soon as
            // the user's message exists, so by here there is almost always an id. This still catches the
            // cases that never went through a send — a thread restored or replayed straight into
            // `messages` — and it is the same creation, not a second copy of it.
            await createConversationForMessages([
                ...currentHistory.filter(msg => msg.id !== localPlaceholderId),
                updatedMessage,
            ]);
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
    // If the answer is mid-typewriter, reveal it in full and stop typing.
    finishTypewriter();
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

  const handleGenerate = async (inputOverride?: string) => {
    const composerText = inputOverride ?? inputValue;
    const canSend = composerText.trim() || attachedFiles.length > 0;
    if (!canSend || isLoading) return;
    if (isContextLimitReached) return;

    // Prepare the new user message
    const userTextToSend = (inputOverride ?? inputValue).trim();
    const filesToSend = [...attachedFiles]; // Capture files before clearing

    // console.log('handleGenerate called with text:', userTextToSend); // Original log, can be kept or removed
    const messageId = `user-${Date.now()}`;

    // --- Prepare newUserMessage with potential image/file attachment ---
    const imageAttachmentsPayload = filesToSend
      .filter((f) => f.fileObject && f.type.startsWith('image/'))
      .map((f) => ({
        file: f.fileObject as File,
        name: f.name,
        type: f.type,
      }));
    const userImageAttachmentsPayload =
      imageAttachmentsPayload.length > 0 ? imageAttachmentsPayload : undefined;
    const userImageAttachmentPayload = userImageAttachmentsPayload?.[0];

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
        userImageAttachments: userImageAttachmentsPayload,
        userFileAttachment: userFileAttachmentPayload,
    };
    // --- End user message preparation ---

    setInputValue('');
    setAttachedFiles([]);

    let currentMessageHistory: ChatMessage[] = [...messages, newUserMessage];
    setMessages(currentMessageHistory);

    // The thread becomes a conversation HERE, at the first message — not when the answer arrives.
    //
    // Until now it was born in the answer handler, so between hitting send and the model finishing there
    // was no conversation to act on: Pin, Archive, Delete and "move to project" all look it up by id, and
    // for those seconds they looked live and did nothing. Awaited rather than fired off, because the id
    // has to exist before `fetchAiResponse` runs or that call would create a second one for the same
    // thread.
    //
    // Creation batches the user's message in, so the `addMessage` below is for conversations that already
    // existed — sending it in both places would post the message twice.
    if (!activeConversationIdRef.current) {
      await createConversationForMessages(currentMessageHistory);
    } else if (isDbAuthenticated) {
      chatService.addMessage(activeConversationIdRef.current, {
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

  useEffect(() => {
    submitVoiceTranscriptRef.current = (transcript) => {
      void handleGenerate(transcript);
    };
  }, [handleGenerate]);

  const handleVoiceSend = () => {
    if (isVoiceRecognitionRunningRef.current) {
      pendingVoiceSubmissionRef.current = true;
      stopVoiceInput();
      return;
    }

    void handleGenerate();
  };

  // --- NEW: Function to Load a Conversation from History ---
  const handleLoadConversation = async (conversationId: string) => {
    const conversationToLoad = conversationHistory.find(convo => convo.id === conversationId);
    if (conversationToLoad) {
        // console.log("Loading conversation:", conversationId);

        // Leave full-page overlays so the loaded chat is visible, not buried under them.
        dismissChatOverlays();
        setHistoryNavView('chats');

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
                    ? { ...convo, messages: localMessages, isUnread: false }
                    : convo
                )
              );
            } else {
              setMessages(conversationToLoad.messages || []);
              patchConversation(conversationId, { isUnread: false });
            }
          } catch (error) {
            console.error("Error loading conversation from database:", error);
            setMessages(conversationToLoad.messages || []);
            patchConversation(conversationId, { isUnread: false });
          }
        } else {
          setMessages(conversationToLoad.messages || []);
          patchConversation(conversationId, { isUnread: false });
        }

        // --- Load System Prompt / This-chat persona ---
        const storedPersonaId = await getChatPersonaId(conversationId);
        if (storedPersonaId) {
          const persona = await getPersona(storedPersonaId);
          if (persona) {
            setSelectedPersona(persona.id);
            setSystemPrompt(persona.prompt);
            setSavedSystemPrompt(persona.prompt);
          } else {
            const loadedPrompt = conversationToLoad.systemPrompt || '';
            setSystemPrompt(loadedPrompt);
            setSavedSystemPrompt(loadedPrompt);
            setSelectedPersona(null);
          }
        } else {
          const loadedPrompt = conversationToLoad.systemPrompt || '';
          setSystemPrompt(loadedPrompt);
          setSavedSystemPrompt(loadedPrompt);
          setSelectedPersona(null);
        }
        setIsSystemPromptOpen(false);
        // --- End Load System Prompt ---
        // Keep history open — it closes only via the panel X.
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

  const closeHistoryRowMenu = useCallback(() => {
    setIsHistoryRowMenuOpen(false);
    setHistoryProjectSubmenuOpen(false);
  }, []);

  /** Same ⋯ again → close. Other row's ⋯ → move/open there. */
  const toggleHistoryRowMenu = useCallback(
    (conversationId: string, top: number, left: number) => {
      if (
        isHistoryRowMenuOpen &&
        historyRowMenu?.conversationId === conversationId
      ) {
        closeHistoryRowMenu();
        return;
      }
      setHistoryProjectSubmenuOpen(false);
      setHistoryRowMenu({ conversationId, top, left });
      setIsHistoryRowMenuOpen(true);
    },
    [closeHistoryRowMenu, historyRowMenu?.conversationId, isHistoryRowMenuOpen],
  );

  // Conversation ⋯ menu — same mount/shown card motion as top-bar more menu.
  useEffect(() => {
    if (isHistoryRowMenuOpen && historyRowMenu) {
      setIsHistoryRowMenuMounted(true);
      setIsHistoryRowMenuShown(false);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setIsHistoryRowMenuShown(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    if (!isHistoryRowMenuMounted) return;
    setIsHistoryRowMenuShown(false);
    const timer = window.setTimeout(() => {
      setIsHistoryRowMenuMounted(false);
      setHistoryRowMenu(null);
      setHistoryProjectSubmenuOpen(false);
      // Matches the exit it now plays. On the card-modal timing it stayed mounted, invisible and
      // inert, for another 220ms after the menu had finished leaving.
    }, MENU_POP_MS);
    return () => window.clearTimeout(timer);
  }, [isHistoryRowMenuOpen, isHistoryRowMenuMounted, historyRowMenu]);

  const patchConversation = useCallback((conversationId: string, patch: Partial<Conversation>) => {
    setConversationHistory((prevHistory) =>
      prevHistory.map((convo) => (convo.id === conversationId ? { ...convo, ...patch } : convo)),
    );
  }, []);

  const handleTogglePinConversation = (conversationId: string) => {
    setConversationHistory((prevHistory) => {
      const target = prevHistory.find((convo) => convo.id === conversationId);
      if (!target) return prevHistory;
      if (target.isPinned) {
        return prevHistory.map((convo) =>
          convo.id === conversationId
            ? { ...convo, isPinned: false, pinOrder: undefined }
            : convo,
        );
      }
      const maxOrder = prevHistory.reduce((max, convo) => {
        if (!convo.isPinned || convo.isArchived) return max;
        return Math.max(max, convo.pinOrder ?? 0);
      }, -1);
      return prevHistory.map((convo) =>
        convo.id === conversationId
          ? { ...convo, isPinned: true, pinOrder: maxOrder + 1 }
          : convo,
      );
    });
  };

  /**
   * Pin / reorder into Pinned at insertAt (index among pinned excluding the dragged id).
   */
  const applyPinnedInsert = useCallback((draggedId: string, insertAt: number) => {
    setConversationHistory((prevHistory) => {
      const dragged = prevHistory.find((convo) => convo.id === draggedId);
      if (!dragged || dragged.isArchived) return prevHistory;

      const pinned = prevHistory
        .filter((convo) => convo.isPinned && !convo.isArchived && convo.id !== draggedId)
        .sort((a, b) => (a.pinOrder ?? a.timestamp) - (b.pinOrder ?? b.timestamp));

      const clamped = Math.max(0, Math.min(insertAt, pinned.length));
      const nextPinned = [...pinned];
      nextPinned.splice(clamped, 0, { ...dragged, isPinned: true });

      const orderMap = new Map(nextPinned.map((convo, index) => [convo.id, index]));
      const nextHistory = prevHistory.map((convo) =>
        orderMap.has(convo.id)
          ? { ...convo, isPinned: true, pinOrder: orderMap.get(convo.id)! }
          : convo,
      );

      const sameOrder = prevHistory.every((convo) => {
        const next = nextHistory.find((item) => item.id === convo.id);
        return (
          next != null &&
          Boolean(next.isPinned) === Boolean(convo.isPinned) &&
          (next.pinOrder ?? null) === (convo.pinOrder ?? null)
        );
      });
      return sameOrder ? prevHistory : nextHistory;
    });
  }, []);

  const clearHistoryDrag = useCallback(() => {
    historyDragIdRef.current = null;
    historyDragFromSectionRef.current = null;
    pinnedInsertIndexRef.current = null;
    historyPointerSessionRef.current = null;
    setHistoryDragId(null);
    setPinnedInsertIndex(null);
    setHistoryDragGhostTitle(null);
  }, []);

  const commitHistoryDrag = useCallback(() => {
    const draggedId = historyDragIdRef.current;
    const insertAt = pinnedInsertIndexRef.current;
    // Clear transforms first (Claude: no transition on drop settle), then write order.
    historyDragIdRef.current = null;
    historyDragFromSectionRef.current = null;
    pinnedInsertIndexRef.current = null;
    historyPointerSessionRef.current = null;
    setHistoryDragId(null);
    setPinnedInsertIndex(null);
    setHistoryDragGhostTitle(null);
    if (draggedId != null && insertAt != null) {
      window.requestAnimationFrame(() => {
        applyPinnedInsert(draggedId, insertAt);
      });
    }
  }, [applyPinnedInsert]);

  const updatePinnedInsertIndex = useCallback((nextIndex: number) => {
    if (pinnedInsertIndexRef.current === nextIndex) return;
    pinnedInsertIndexRef.current = nextIndex;
    setPinnedInsertIndex(nextIndex);
  }, []);

  const placeHistoryDragGhost = useCallback((clientX: number, clientY: number) => {
    const el = historyDragGhostElRef.current;
    const session = historyPointerSessionRef.current;
    if (!el || !session) return;
    // Keep ghost locked to the grab point — not offset to the bottom-right of the cursor.
    el.style.width = `${session.rowWidth}px`;
    el.style.transform = `translate3d(${clientX - session.grabOffsetX}px, ${clientY - session.grabOffsetY}px, 0)`;
  }, []);

  /** Pointer DnD for Pinned / Recents→Pinned — no HTML5 drag API. */
  const beginHistoryPointerDrag = useCallback(
    (
      event: React.PointerEvent,
      convo: Conversation,
      rowSection: 'pinned' | 'recents',
    ) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, input, textarea, a, [role="menu"]')) return;

      const rowEl = event.currentTarget as HTMLElement;
      const rowRect = rowEl.getBoundingClientRect();
      if (rowRect.height > 0) pinnedRowHeightRef.current = rowRect.height;

      historyPointerSessionRef.current = {
        id: convo.id,
        fromSection: rowSection,
        title: convo.title,
        startX: event.clientX,
        startY: event.clientY,
        grabOffsetX: event.clientX - rowRect.left,
        grabOffsetY: event.clientY - rowRect.top,
        rowWidth: rowRect.width,
        pointerId: event.pointerId,
        activated: false,
      };

      const onMove = (moveEvent: PointerEvent) => {
        const session = historyPointerSessionRef.current;
        if (!session || moveEvent.pointerId !== session.pointerId) return;

        const dx = moveEvent.clientX - session.startX;
        const dy = moveEvent.clientY - session.startY;

        if (!session.activated) {
          if (dx * dx + dy * dy < 36) return;
          session.activated = true;
          historyDidDragRef.current = true;
          historyDragIdRef.current = session.id;
          historyDragFromSectionRef.current = session.fromSection;
          // Seed insert at the drag's own slot so siblings don't jump on activate.
          if (rowSection === 'pinned') {
            const pinnedFull = conversationHistoryRef.current
              .filter((item) => item.isPinned && !item.isArchived)
              .sort((a, b) => (a.pinOrder ?? a.timestamp) - (b.pinOrder ?? b.timestamp));
            const fromIndex = pinnedFull.findIndex((item) => item.id === session.id);
            pinnedInsertIndexRef.current = fromIndex < 0 ? null : fromIndex;
            setPinnedInsertIndex(pinnedInsertIndexRef.current);
          } else {
            pinnedInsertIndexRef.current = null;
            setPinnedInsertIndex(null);
          }
          setHistoryDragId(session.id);
          setHistoryHoveredRowId(null);
          setHistoryDragGhostTitle(session.title);
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'grabbing';
          window.requestAnimationFrame(() => {
            placeHistoryDragGhost(moveEvent.clientX, moveEvent.clientY);
          });
        } else {
          placeHistoryDragGhost(moveEvent.clientX, moveEvent.clientY);
        }

        // Insert index from LAYOUT positions only (strip translateY).
        // Using getBoundingClientRect while rows are transformed causes
        // insertIndex ↔ transform feedback → rows bounce up/down.
        const zone = document.querySelector(
          '[data-history-pinned-zone]',
        ) as HTMLElement | null;
        if (!zone) return;

        const zoneRect = zone.getBoundingClientRect();
        const inZoneX =
          moveEvent.clientX >= zoneRect.left - 12 &&
          moveEvent.clientX <= zoneRect.right + 12;
        if (!inZoneX) return;

        const rowEls = Array.from(
          zone.querySelectorAll<HTMLElement>('[data-history-pinned-row]'),
        ).filter((rowEl) => rowEl.getAttribute('data-history-pinned-row') !== session.id);

        const layoutTop = (rowEl: HTMLElement) => {
          const rect = rowEl.getBoundingClientRect();
          const transform = window.getComputedStyle(rowEl).transform;
          if (!transform || transform === 'none') return rect.top;
          try {
            return rect.top - new DOMMatrixReadOnly(transform).m42;
          } catch {
            return rect.top;
          }
        };

        const y = Math.min(
          Math.max(moveEvent.clientY, zoneRect.top),
          zoneRect.bottom,
        );

        let nextInsert = rowEls.length;
        for (let i = 0; i < rowEls.length; i += 1) {
          const top = layoutTop(rowEls[i]);
          const mid = top + rowEls[i].offsetHeight / 2;
          if (y < mid) {
            nextInsert = i;
            break;
          }
        }
        updatePinnedInsertIndex(nextInsert);
      };

      const onUp = (upEvent: PointerEvent) => {
        const session = historyPointerSessionRef.current;
        if (!session || upEvent.pointerId !== session.pointerId) return;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        if (session.activated) {
          commitHistoryDrag();
        } else {
          historyPointerSessionRef.current = null;
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [commitHistoryDrag, placeHistoryDragGhost, updatePinnedInsertIndex],
  );

  const handleToggleUnreadConversation = (conversationId: string) => {
    setConversationHistory((prevHistory) =>
      prevHistory.map((convo) =>
        convo.id === conversationId ? { ...convo, isUnread: !convo.isUnread } : convo,
      ),
    );
  };

  const handleArchiveConversation = async (conversationId: string, archived: boolean) => {
    if (archived) {
      patchConversation(conversationId, { isArchived: true, isPinned: false });
    } else {
      patchConversation(conversationId, { isArchived: false });
    }
    if (isDbAuthenticated) {
      try {
        await chatService.updateConversation(conversationId, { is_archived: archived });
      } catch (error) {
        console.error('Failed to update archive state:', error);
      }
    }
  };

  const handleAssignConversationToProject = (conversationId: string, projectId: string | null) => {
    patchConversation(conversationId, { projectId });
    if (projectId) {
      const now = Date.now();
      setChatProjects((prev) =>
        prev.map((project) =>
          project.id === projectId ? { ...project, updatedAt: now } : project,
        ),
      );
    }
  };

  const submitCreateProjectModal = () => {
    const assignId = pendingProjectAssignConversationId;
    const project = createChatProject();
    if (assignId) {
      handleAssignConversationToProject(assignId, project.id);
    }
  };

  const handleOpenAsQuickTask = (conversationId: string) => {
    void handleLoadConversation(conversationId);
  };

  useEffect(() => {
    if (!isHistoryRowMenuOpen || !historyRowMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const el = target instanceof Element ? target : target?.parentElement;
      // Menu panel, or the ⋯ trigger (toggle handles close — don't close-then-reopen).
      if (
        el?.closest?.('[data-history-row-menu]') ||
        el?.closest?.('[data-history-row-menu-trigger]')
      ) {
        return;
      }
      closeHistoryRowMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeHistoryRowMenu();
        return;
      }
      const convo = conversationHistory.find((item) => item.id === historyRowMenu.conversationId);
      if (!convo) return;
      const key = event.key.toLowerCase();
      if (key === 'p') {
        event.preventDefault();
        handleTogglePinConversation(convo.id);
        closeHistoryRowMenu();
      } else if (key === 'r') {
        event.preventDefault();
        setEditingConversationId(convo.id);
        setEditTitleText(convo.title);
        closeHistoryRowMenu();
        setIsChatsCatalogOpen(false);
        setTimeout(() => document.getElementById(`edit-title-${convo.id}-${interfaceId}`)?.focus(), 50);
      } else if (key === 'a') {
        event.preventDefault();
        void handleArchiveConversation(convo.id, !convo.isArchived);
        closeHistoryRowMenu();
      } else if (key === 'd') {
        event.preventDefault();
        setDeleteConfirmationModal({
          isOpen: true,
          conversationId: convo.id,
          conversationTitle: convo.title,
          origin: 'left',
        });
        closeHistoryRowMenu();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [
    isHistoryRowMenuOpen,
    historyRowMenu,
    conversationHistory,
    closeHistoryRowMenu,
    interfaceId,
  ]);

  const closeRecentsFilterMenu = useCallback(() => {
    setRecentsFilterMenu(null);
    setRecentsFilterSubmenu(null);
  }, []);

  useEffect(() => {
    if (!recentsFilterMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const el = target instanceof Element ? target : target?.parentElement;
      if (el?.closest?.('[data-recents-filter-menu]')) return;
      closeRecentsFilterMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRecentsFilterMenu();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [recentsFilterMenu, closeRecentsFilterMenu]);

  useEffect(() => {
    if (!isHistoryOpen || historyNavView !== 'chats') {
      closeRecentsFilterMenu();
    }
  }, [isHistoryOpen, historyNavView, closeRecentsFilterMenu]);

  useEffect(() => {
    if (!projectFilePreview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeProjectFilePreview();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [projectFilePreview, closeProjectFilePreview]);

  useEffect(() => {
    if (!projectScheduledPreview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeProjectScheduledPreview();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [projectScheduledPreview, closeProjectScheduledPreview]);

  useEffect(() => {
    if (!isProjectScheduledCreateMounted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeProjectScheduledCreate();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isProjectScheduledCreateMounted, closeProjectScheduledCreate]);

  useEffect(() => {
    if (!isProjectSettingsMounted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeProjectSettings();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isProjectSettingsMounted, closeProjectSettings]);

  useEffect(() => {
    if (!isProjectsPageOpen && !isCreateProjectModalMounted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isCreateProjectModalOpen) {
        closeCreateProjectModal();
        return;
      }
      if (openProjectMenuId) {
        setOpenProjectMenuId(null);
        return;
      }
      if (isProjectsSortOpen) {
        setIsProjectsSortOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    closeCreateProjectModal,
    isCreateProjectModalMounted,
    isCreateProjectModalOpen,
    isProjectsPageOpen,
    isProjectsSortOpen,
    openProjectMenuId,
  ]);

  useEffect(() => {
    if (!openProjectMenuId) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[data-project-card-menu]')) return;
      setOpenProjectMenuId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [openProjectMenuId]);

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
      void setChatPersonaId(activeConversationId, personaId);
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
      // Same overlay trap as loading a conversation: a blank chat under Projects/catalog
      // looks like nothing happened.
      dismissChatOverlays();
      setHistoryNavView('chats');
      setMessages([]); // Clear current messages
      setActiveConversationId(null); // Set active ID to null (indicates new chat)
      void clearPendingChatSkills();
      void clearPendingChatPersona();
      setInputValue(''); // Clear the input field
      setEmptyStateMode('chat');
      setIsXenoSearchEnabled(false);
      setIsSystemPromptOpen(false);
      setAttachedFiles([]);
      setShowThinkingId(null);
      // Seed This-chat persona from account default (still per-chat after that).
      void (async () => {
        const profile = await getChatProfile();
        if (!profile.defaultPersonaId) {
          setSystemPrompt('');
          setSavedSystemPrompt('');
          setSelectedPersona(null);
          return;
        }
        const persona = await getPersona(profile.defaultPersonaId);
        if (persona) {
          await setChatPersonaId(null, persona.id);
          setSelectedPersona(persona.id);
          setSystemPrompt(persona.prompt);
          setSavedSystemPrompt(persona.prompt);
        } else {
          setSystemPrompt('');
          setSavedSystemPrompt('');
          setSelectedPersona(null);
        }
      })();
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

  // Render fn (not a nested component) so typing doesn't remount and steal focus.
  const renderCreateProjectModal = () => {
    const canCreate = newChatProjectName.trim().length > 0;
    return (
      <div
        className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} fixed top-0 right-0 bottom-0 z-[999] flex items-center justify-center p-4 backdrop-blur-sm`}
        data-chat-theme-preference={chatTheme}
        data-create-project-dialog=""
        style={{
          left:
            (isTaskbarHidden ? 0 : 52) +
            (!isMultiInterface && isHistoryOpen && !isMobile ? 260 : 0),
          backgroundColor: isCreateProjectModalShown
            ? 'color-mix(in srgb, var(--chat-text) 28%, transparent)'
            : 'color-mix(in srgb, var(--chat-text) 0%, transparent)',
          transition: `background-color ${SCHEDULE_CREATE_MODAL_MS}ms ${SCHEDULE_DATE_EASE}`,
          ...chatThemePreviewStyle,
        }}
        onClick={closeCreateProjectModal}
      >
        <style>{CHAT_MODAL_KEYFRAMES_CSS}</style>
        <div
          {...createProjectDialog.panelProps}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-project-dialog-title"
          className="w-full max-w-[32rem] overflow-hidden rounded-2xl border"
          style={{
            backgroundColor: 'var(--chat-elevated)',
            borderColor: 'var(--chat-border)',
            color: 'var(--chat-text)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
            // New project CTA sits top-right on the Projects page.
            ...chatModalCardMotionStyle(
              'top-right',
              isCreateProjectModalShown,
              isCreateProjectModalOpen,
            ),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <h2
              id="create-project-dialog-title"
              className="text-[1.15rem] font-semibold tracking-tight text-[var(--chat-text)]"
            >
              Create a project
            </h2>
            <IconButton
              icon={XDecl}
              variant="ghost"
              size="md"
              iconSize={16}
              onClick={closeCreateProjectModal}
              aria-label="Close create project"
            />
          </div>

          <div className="space-y-4 px-5 pb-5">
            <div
              className="rounded-xl px-3.5 py-3"
              style={{ backgroundColor: 'var(--chat-control)' }}
            >
              <p className="text-[13px] font-semibold text-[var(--chat-text)]">
                How to use projects
              </p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--chat-muted)]">
                Projects help organize your work and leverage knowledge across multiple conversations.
                Upload docs, code, and files to create themed collections that XENO can reference
                again and again. Start by creating a memorable title and description to organize
                your project. You can always edit it later.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={`create-project-name-${interfaceId}`}
                className="block text-[13px] font-medium text-[var(--chat-text)]"
              >
                What are you working on?
              </label>
              {/* `TextInput lg`, and the field that made the library grow a `fontSize`. The box was
                  already 36px and already `--chat-canvas`, which is what `.xeno-input` paints — but
                  the size scale welds type to height, so asking for the right height would have
                  retyped this 13px field to 14px, a pixel LARGER than the 13px label directly above
                  it. `fontSize={13}` is the same door `iconSize` is, one property over.
                  What leaves with the swap is the interesting part: the inline fill, the inset
                  box-shadow standing in for a border, and TWO JS handlers that hand-painted the focus
                  ring on every focus and blur. `.xeno-input:focus-within` is one CSS rule. The ring
                  moves accent → muted, which is where every other field in this chat already was. */}
              <TextInput
                size="lg"
                fontSize={13}
                className="w-full"
                id={`create-project-name-${interfaceId}`}
                type="text"
                autoFocus
                value={newChatProjectName}
                maxLength={PROJECT_NAME_MAX_CHARS}
                onChange={(event) =>
                  setNewChatProjectName(event.target.value.slice(0, PROJECT_NAME_MAX_CHARS))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canCreate) {
                    event.preventDefault();
                    submitCreateProjectModal();
                  }
                }}
                placeholder="Name your project"
              />
              <p className="text-right text-[11px] tabular-nums text-[var(--chat-muted)]">
                {newChatProjectName.length}/{PROJECT_NAME_MAX_CHARS}
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={`create-project-description-${interfaceId}`}
                className="block text-[13px] font-medium text-[var(--chat-text)]"
              >
                What are you trying to achieve?
              </label>
              {/* The name field's partner, and it converts on the same door: `.xeno-textarea` had
                  15px written flat into it, so the library grew `fontSize` before this could be
                  taken. Pinned at 13 the type does NOT move — this is a conversion, not the type
                  change §7 reserves its own commit for.
                  Everything else already matched: `px-3 py-2.5` IS the component's `10px 12px`, the
                  fill was `--chat-canvas`, the inset shadow was standing in for its 1px border, and
                  `resize-y` is its `resize: vertical`. The radius moves 8 → 12, onto the card step,
                  and the focus ring accent → muted with the rest of this dialog. */}
              <Textarea
                fontSize={13}
                id={`create-project-description-${interfaceId}`}
                value={newChatProjectDescription}
                onChange={(event) => setNewChatProjectDescription(event.target.value)}
                placeholder="Describe your project, goals, subject, etc..."
                rows={4}
                className="w-full min-h-[6.5rem] resize-y text-[var(--chat-text)] placeholder:text-[var(--chat-muted)]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              {/* `secondary` — a `--chat-control` fill with text ink is the variant minus its
                  hairline, which it gains. Every other filled Cancel in this chat took the same
                  trade. */}
              <Button variant="secondary" size="md" onClick={closeCreateProjectModal}>
                Cancel
              </Button>
              {/* `primary md`, matching the `secondary md` Cancel beside it. The reason that stood
                  here was true when it was written and is not any more — it said `primary` could not
                  be used because the chrome tokens compute on `:root`, and the bridge carries them
                  now, so the variant paints exactly the `--chat-text` on `--chat-canvas` this was
                  drawing by hand.
                  The disabled branch goes with the inline fill: `disabled:opacity-40` and
                  `disabled:cursor-not-allowed` are the availability axis spelled out, and the
                  component carries both from `disabled` alone. */}
              <Button
                variant="primary"
                size="md"
                onClick={submitCreateProjectModal}
                disabled={!canCreate}
              >
                Create project
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  /**
   * The one configuration surface for a project. Rail cards and the header ⋯ all land here and
   * scroll to their own section, so there is a single place to learn and a single place to grow.
   */
  const renderProjectSettingsModal = () => {
    const project = chatProjects.find((item) => item.id === projectSettings?.projectId);
    if (!project || !projectSettings) return null;

    const activeSection = projectSettings.section;
    const setActiveSection = (section: ProjectSettingsSection) => {
      setProjectSettings({ projectId: project.id, section });
    };
    return (
      <div
        className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} fixed inset-0 z-[999] flex items-center justify-center p-4 backdrop-blur-sm`}
        data-chat-theme-preference={chatTheme}
        data-project-settings-dialog=""
        style={{
          backgroundColor: isProjectSettingsShown
            ? 'color-mix(in srgb, var(--chat-text) 28%, transparent)'
            : 'color-mix(in srgb, var(--chat-text) 0%, transparent)',
          transition: `background-color ${SCHEDULE_CREATE_MODAL_MS}ms ${SCHEDULE_DATE_EASE}`,
          ...chatThemePreviewStyle,
        }}
        onClick={closeProjectSettings}
      >
        <style>{CHAT_MODAL_KEYFRAMES_CSS}</style>
        <div
          {...projectSettingsDialog.panelProps}
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-settings-title"
          className="flex w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border will-change-transform"
          style={{
            // dvh accounts for mobile browser chrome; fall back to vh.
            height: 'min(640px, calc(100dvh - 0.5rem))',
            maxHeight: 'calc(100dvh - 0.5rem)',
            backgroundColor: 'var(--chat-elevated)',
            borderColor: 'var(--chat-border)',
            color: 'var(--chat-text)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            ...chatModalCardMotionStyle(
              'top-right',
              isProjectSettingsShown,
              isProjectSettingsOpen,
            ),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex-shrink-0 px-4 pt-4 pb-3 sm:px-5 sm:pt-5">
            <div className="flex items-start gap-2 sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 sm:gap-3">
                  <h2
                    id="project-settings-title"
                    className="flex-shrink-0 text-[1.05rem] font-semibold tracking-tight text-[var(--chat-text)] sm:text-[1.15rem]"
                  >
                    Project settings
                  </h2>
                  <div
                    className="hidden h-4 w-px flex-shrink-0 sm:block"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--chat-muted) 45%, transparent)',
                    }}
                    aria-hidden="true"
                  />
                  <nav
                    className="hidden min-w-0 flex-1 flex-wrap items-center gap-1 sm:flex"
                    aria-label="Settings sections"
                    {...projectTabsWide.tablistProps}
                  >
                    {PROJECT_SETTINGS_SECTIONS.map((section) => {
                      const isActive = activeSection === section.id;
                      /* Converted, and the size was not a choice — it was a repair.
                       *
                       * This carried `min-h-8`, asking for 32px. It rendered at **26**. `min-h-8`
                       * arrived in Tailwind 3.4 and this repo is on 3.3.0, so the class was never
                       * generated: `min-height` computed to `auto` and no rule naming it exists
                       * anywhere in the document. The author asked for 32 and got whatever the
                       * 11.5px line plus `py-1` came to. Its narrow twin says `min-h-9` and is dead
                       * the same way — those two are the only `min-h-<number>` classes in the whole
                       * chat above `min-h-0`, which is the one size 3.3 does ship.
                       *
                       * So `size="md"` is 32px: the height this asked for, delivered. That is why
                       * this is not the two-edit case §3 warns about — the swap and the resize are
                       * the same edit here, because the intended size was already on the scale and
                       * only the class expressing it was missing.
                       *
                       * What genuinely moves: padding 8 → 12, type 11.5 → 14, and the ring from
                       * `--chat-muted` at 55% to `--xeno-muted` straight. The last is the library's
                       * position, stated where the ring is declared — the weight of a hairline is a
                       * chrome token's business, not a call site's.
                       *
                       * `<Tab>` and not `<Tabs>`: `<Tabs>` owns the panel and the keys, and this is
                       * one of TWO tablists over a single shared panel driven by `useTabs`. The
                       * `tabProps` spread lands after every default here, so the hook still owns the
                       * roving tabIndex and the arrows. The hover plate stays as a class because it
                       * is this product's reading, not something the component decided against. */
                      return (
                        <Tab
                          key={section.id}
                          size="md"
                          selectionStyle="ring"
                          selected={isActive}
                          {...projectTabsWide.tabProps(section.id)}
                          onClick={() => setActiveSection(section.id)}
                          className="hover:bg-[var(--chat-hover)]"
                        >
                          {section.label}
                        </Tab>
                      );
                    })}
                  </nav>
                </div>
                <p className="mt-1 truncate text-[12px] text-[var(--chat-muted)]">{project.name}</p>
              </div>
              <IconButton
                icon={XDecl}
                size="lg"
                iconSize={16}
                onClick={closeProjectSettings}
                aria-label="Close project settings"
              />
            </div>

            {/* Mobile: tabs sit under the title so they do not crush into one row. */}
            <nav
              className="mt-3 flex gap-1 overflow-x-auto pb-0.5 sm:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="Settings sections"
              {...projectTabsNarrow.tablistProps}
            >
              {PROJECT_SETTINGS_SECTIONS.map((section) => {
                const isActive = activeSection === section.id;
                /* The wide tablist's narrow twin, converted with it and for the same reason: it said
                   `min-h-9` — 36px — and Tailwind 3.3 ships no such class, so it rendered at whatever
                   its 12px line and `py-1.5` came to. `size="lg"` is 36. The two are the only dead
                   `min-h-<number>` classes in the chat, and they were these two tablists.

                   `flex-shrink-0` stays: this list scrolls horizontally rather than wrapping, and a
                   tab allowed to shrink would squeeze instead of overflowing. That is layout the
                   parent owns, which is why it is a class here and not a component decision. */
                return (
                  <Tab
                    key={section.id}
                    size="lg"
                    selectionStyle="ring"
                    selected={isActive}
                    {...projectTabsNarrow.tabProps(section.id)}
                    onClick={() => setActiveSection(section.id)}
                    className="flex-shrink-0 hover:bg-[var(--chat-hover)]"
                  >
                    {section.label}
                  </Tab>
                );
              })}
            </nav>
          </div>

          {/* This already had `role="tabpanel"` and nothing tying it to the tab that opened it — no id
              for `aria-controls` to name, no label. The wide tablist owns it; the narrow one points at
              the same id through `panelId`. */}
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-5"
            {...projectTabsWide.panelProps}
          >
            {activeSection === 'general' && (
              <div className="space-y-3 pt-2 sm:pt-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor={`project-settings-name-${interfaceId}`}
                    className="block text-[12.5px] font-medium text-[var(--chat-text)]"
                  >
                    Project name
                  </label>
                  {/* The create dialog's name field, one dialog over and converted the same way. Its
                      two textareas followed once `Textarea` grew the same `fontSize` door, and
                      `fieldStyle`, `fieldClassName`, `focusField` and `blurField` left with them —
                      this dialog's fields were always one shape, and the shape is now a component
                      rather than four consts and a pair of handlers per field. */}
                  <TextInput
                    size="lg"
                    fontSize={13}
                    className="w-full"
                    id={`project-settings-name-${interfaceId}`}
                    type="text"
                    value={settingsNameDraft}
                    maxLength={PROJECT_NAME_MAX_CHARS}
                    onChange={(event) =>
                      setSettingsNameDraft(event.target.value.slice(0, PROJECT_NAME_MAX_CHARS))
                    }
                    placeholder="Name your project"
                  />
                  <p className="text-right text-[11px] tabular-nums text-[var(--chat-muted)]">
                    {settingsNameDraft.length}/{PROJECT_NAME_MAX_CHARS}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor={`project-settings-description-${interfaceId}`}
                    className="block text-[12.5px] font-medium text-[var(--chat-text)]"
                  >
                    Description
                  </label>
                  {/* The create dialog's description, one dialog over, same door and same pin. */}
                  <Textarea
                    fontSize={13}
                    id={`project-settings-description-${interfaceId}`}
                    value={settingsDescriptionDraft}
                    onChange={(event) => setSettingsDescriptionDraft(event.target.value)}
                    placeholder="Describe your project, goals, subject, etc..."
                    rows={8}
                    className="w-full min-h-[10rem] resize-y text-[var(--chat-text)] placeholder:text-[var(--chat-muted)] sm:min-h-[14rem]"
                  />
                </div>
              </div>
            )}

            {activeSection === 'instructions' && (
              <div className="flex h-full min-h-0 flex-col space-y-2 pt-2 sm:pt-3">
                <p className="flex-shrink-0 text-[12px] leading-relaxed text-[var(--chat-muted)]">
                  Context and rules XENO follows for every chat in this project. These apply on top
                  of your global preferences and the chat's selected style.
                </p>
                {/* The third of the trio, with one thing the other two did not have: it carried
                    `leading-relaxed` (1.625) and `.xeno-textarea` owns line-height at 1.5. Keeping the
                    class would have left the two rules fighting on cascade order, which is a
                    coin-flip nobody can read from this file. Taking 1.5 is 1.5px less per line on a
                    long instructions box, and it is a number the component states rather than one
                    that depends on stylesheet order. */}
                <Textarea
                  fontSize={13}
                  value={instructionsDraft}
                  onChange={(event) => setInstructionsDraft(event.target.value)}
                  placeholder="e.g. Think step by step and show your reasoning for complex problems. Prefer concrete examples."
                  className="w-full min-h-[12rem] flex-1 resize-y text-[var(--chat-text)] placeholder:text-[var(--chat-muted)] sm:min-h-[14rem]"
                />
              </div>
            )}

            {activeSection === 'danger' && (
              <div className="space-y-2 pt-2 sm:pt-3">
                <h3 className="text-[13px] font-semibold text-[var(--chat-danger)]">Danger zone</h3>
                <p className="text-[12px] leading-relaxed text-[var(--chat-muted)]">
                  Deleting a project removes it and its files. Conversations are kept.
                </p>
                <Button
                  variant="danger"
                  size="lg"
                  className="w-full sm:w-auto sm:min-h-0 sm:py-2"
                  onClick={() => {
                    handleDeleteProject(project.id);
                    closeProjectSettings();
                  }}
                  style={{ borderColor: 'var(--chat-danger)' }}
                >
                  Delete project
                </Button>
              </div>
            )}
          </div>

          <div
            className="flex flex-shrink-0 flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:justify-end sm:gap-2 sm:px-5 sm:py-3.5"
            style={{ borderColor: 'var(--chat-border)' }}
          >
            {activeSection === 'danger' ? (
              <Button
                variant="secondary"
                size="lg"
                className="w-full sm:min-h-0 sm:w-auto sm:py-2"
                onClick={closeProjectSettings}
              >
                Close
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full sm:min-h-0 sm:w-auto sm:py-2"
                  onClick={closeProjectSettings}
                >
                  Cancel
                </Button>
                {/* `primary`, where this was a `ghost` with the fill hand-painted over it through
                    an inline `style` — and `ButtonProps` omits `style` deliberately. It only worked
                    because the build strips types without checking them and the object rode in on the
                    prop spread. A variant that had to be overridden to look right was the wrong
                    variant; now the two colours come from the same place every other `primary` in
                    this chat reads. */}
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full sm:min-h-0 sm:w-auto sm:py-2"
                  onClick={saveProjectSettings}
                >
                  Save changes
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  /**
   * A render FUNCTION, not a component declared in render.
   *
   * It was `const DeleteConfirmationModalComponent: React.FC = () => …` and used as
   * `<DeleteConfirmationModalComponent />`. A component defined inside another component is a NEW TYPE
   * on every render, so React cannot match it against the previous tree: it unmounts the old subtree and
   * mounts a fresh one, every time the parent renders. The dialog's DOM was thrown away and rebuilt
   * continuously, and anything living in it went with it — focus first among them.
   *
   * That is how it was found. `useDialog` focuses the panel the moment it attaches, and the panel kept
   * re-attaching, so focus landed and was destroyed again before it could be seen; the trap worked and
   * `document.activeElement` was `body`.
   *
   * Calling it keeps the markup part of the parent's own tree, which is what the create-project modal
   * beside it already does.
   */
  const renderDeleteConfirmationModal = (): React.ReactNode => {
    if (
      !isDeleteModalMounted ||
      !deleteConfirmationModal.conversationId ||
      deleteConfirmationModal.conversationTitle === null
    ) {
        return null;
    }

    const handleConfirm = () => {
        if (deleteConfirmationModal.conversationId) {
            handleDeleteConversation(deleteConfirmationModal.conversationId);
        }
        handleCancelDelete(); // Close modal after action
    };

    // Portaled to document.body — re-apply chat theme tokens like the history sidebar.
    return (
        <div
          className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} fixed inset-0 z-[999] flex items-center justify-center p-4 backdrop-blur-sm`}
          data-chat-theme-preference={chatTheme}
          data-delete-chat-dialog=""
          style={{
            backgroundColor: isDeleteModalShown
              ? 'color-mix(in srgb, var(--chat-text) 28%, transparent)'
              : 'color-mix(in srgb, var(--chat-text) 0%, transparent)',
            transition: `background-color ${SCHEDULE_CREATE_MODAL_MS}ms ${SCHEDULE_DATE_EASE}`,
            ...chatThemePreviewStyle,
          }}
          onClick={handleCancelDelete}
        >
            <style>{CHAT_MODAL_KEYFRAMES_CSS}</style>
            <div
              {...deleteChatDialog.panelProps}
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-chat-dialog-title"
              className="w-full max-w-sm overflow-hidden rounded-lg border shadow-xl"
              style={{
                backgroundColor: 'var(--chat-elevated)',
                borderColor: 'var(--chat-border)',
                color: 'var(--chat-text)',
                boxShadow: '0 8px 32px color-mix(in srgb, var(--chat-text) 16%, transparent)',
                ...chatModalCardMotionStyle(
                  deleteConfirmationModal.origin,
                  isDeleteModalShown,
                  deleteConfirmationModal.isOpen,
                ),
              }}
              onClick={(event) => event.stopPropagation()}
            >
                <div className="p-4">
                    <h2 id="delete-chat-dialog-title" className="text-lg font-semibold text-[var(--chat-text)]">
                      Delete chat?
                    </h2>
                </div>

                <hr className="border-t border-[var(--chat-border)]" />

                <div className="p-4">
                    <p className="text-sm text-[var(--chat-muted)]">
                        This will delete{' '}
                        <strong className="font-semibold text-[var(--chat-text)]">
                          {deleteConfirmationModal.conversationTitle}
                        </strong>
                        .
                    </p>
                </div>

                <div
                  className="flex justify-end gap-3 border-t border-[var(--chat-border)] px-4 py-3"
                  style={{ backgroundColor: 'var(--chat-surface)' }}
                >
                    {/* `secondary` word for word: a hairline, a `--chat-control` fill, full ink, and
                        a `--chat-hover` tint on top when you reach for it. */}
                    <Button variant="secondary" size="md" onClick={handleCancelDelete}>
                        Cancel
                    </Button>
                    {/* `danger solid md`, matching the `secondary md` Cancel beside it. The
                        reason recorded here — that the library's `danger` is the quiet reading, right
                        for a Delete in a row and wrong for the confirm inside the dialog that asks —
                        is answered rather than removed: the destructive key carries both readings
                        now, as the neutral one always did with `secondary` and `primary`.
                        What leaves is the interesting part: an inline fill and TWO mouse handlers
                        that hand-painted the hover on enter and leave. A `:hover` rule is one line,
                        and it works for keyboard focus and touch, which the handlers never did. */}
                    <Button
                        variant="danger"
                        emphasis="solid"
                        size="md"
                        onClick={handleConfirm}
                    >
                        Delete
                    </Button>
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

  const renderEmptyStateToolPanel = (tool: ChatEmptyStateTool, close: () => void) => {
    if (tool !== 'recent-files') return null;

    const filteredRecent = recentFiles.filter(
      (file) =>
        !recentFilesSearchQuery.trim() ||
        file.name.toLowerCase().includes(recentFilesSearchQuery.toLowerCase()),
    );

    return (
      <div className="flex h-full min-h-0 flex-col" aria-label="Recent files panel">
        <div className="mb-3 flex items-center justify-between border-b border-[var(--chat-border)] pb-2.5">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--chat-muted)]">
            Recent
          </span>
          <IconButton
            icon={XDecl}
            variant="ghost"
            size="sm"
            iconSize={14}
            onClick={close}
            aria-label="Close Recent files"
          />
        </div>
        {recentFiles.length > 3 && (
          <div className="relative mb-2 flex-shrink-0">
            <Search
              size={14}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--chat-muted)]"
              aria-hidden="true"
            />
            {/* Stays hand-written for the fill. This is the same search field as the two just
                converted, but it rests on `--chat-control` rather than `--chat-canvas`, and
                `.xeno-input` hard-codes `background: var(--xeno-canvas)` — the component would sink
                it to #0a0a0a inside a #262626 panel. The rest of the box would convert perfectly:
                `h-8` is md and the magnifier is the same 14. One hard-coded background is all that
                separates this field from the two above it. */}
            <input
              type="search"
              placeholder="Search files…"
              value={recentFilesSearchQuery}
              onChange={(event) => setRecentFilesSearchQuery(event.target.value)}
              className="h-8 w-full rounded-md border border-[var(--chat-border)] bg-[var(--chat-control)] py-1.5 pl-7 pr-2 text-xs text-[var(--chat-text)] outline-none placeholder:text-[var(--chat-muted)] focus:border-[var(--chat-accent)]"
            />
          </div>
        )}
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto hide-scrollbar">
          {filteredRecent.length === 0 ? (
            <div className="px-2 py-6 text-center text-[var(--chat-muted)]">
              <FileClock size={22} className="mx-auto mb-2 text-[var(--chat-muted)]" aria-hidden="true" />
              <p className="text-xs font-medium text-[var(--chat-muted)]">No recent files</p>
              <p className="mt-1 text-[11px] leading-snug">
                Files you upload will appear here
              </p>
            </div>
          ) : (
            filteredRecent.map((file) => (
              <div
                key={file.id}
                className="group flex items-center gap-1 rounded-lg px-1.5 py-1.5 hover:bg-[var(--chat-hover)]"
              >
                {/* Stays hand-written, and the blocker is `ListRow`'s shape rather than this
                    row's. `ListRow` IS the row — leading, title, subtitle, trailing — and it renders
                    as a `<button>` the moment it takes an `onSelect`. This row has an action beside
                    it, the remove X two elements down, and putting that in `trailing` would nest a
                    button inside a button. `Chip` solved the same problem by making its remove a
                    SIBLING of the body rather than a slot in it; `ListRow` has no such split.
                    So the row stays a div holding a clickable body and an action, which is the shape
                    that works, and the component describes rows that have no actions. */}
                <button
                  type="button"
                  onClick={() => {
                    void handleReattachRecentFile(file);
                    close();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={`Attach ${file.name}`}
                >
                  {file.type.startsWith('image/') && file.preview ? (
                    <img
                      src={file.preview}
                      alt=""
                      className="h-6 w-6 flex-shrink-0 rounded object-cover"
                    />
                  ) : (
                    <FileText
                      size={15}
                      className="flex-shrink-0 text-[var(--chat-muted)]"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-[var(--chat-text)]">
                      {file.name}
                    </span>
                    <span className="block truncate text-[10px] text-[var(--chat-muted)]">
                      {(file.size / 1024).toFixed(1)} KB ·{' '}
                      {new Date(file.lastUsed).toLocaleDateString()}
                    </span>
                  </span>
                </button>
                <IconButton
                  icon={XDecl}
                  variant="ghost"
                  size="xs"
                  iconSize={12}
                  onClick={() => handleRemoveRecentFile(file.id)}
                  aria-label={`Remove ${file.name} from recent`}
                  title="Remove"
                />
              </div>
            ))
          )}
        </div>
      </div>
    );
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
    const rect = event.currentTarget.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const gap = 5; // Gap between button and popup

    const x = rect.left + window.scrollX;
    const placement: FeedbackPopupPlacement = rect.top < viewportHeight / 2 ? 'below' : 'above';
    // Both anchors are the button's own edge; an upward menu lifts itself by its height in CSS.
    const y =
      placement === 'below'
        ? rect.bottom + window.scrollY + gap
        : rect.top + window.scrollY - gap;

    // The button toggles. Click-outside deliberately ignores clicks on this button — otherwise it
    // would close the menu and the click would reopen it — so a second press had nothing to act on
    // and the menu simply stayed put.
    setFeedbackPopupInfo(prev =>
      prev && prev.messageId === messageId ? null : { messageId, position: { x, y }, placement },
    );
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

  /** Retry from a sent user message — regenerate the following AI turn (or resend if none yet). */
  const handleRetryFromUserMessage = async (userMessageId: string) => {
    if (isLoading) return;

    const userIndex = messages.findIndex((msg) => msg.id === userMessageId);
    if (userIndex === -1 || messages[userIndex].sender !== 'user') {
      console.error('Cannot retry: user message not found.');
      return;
    }

    const followingAi = messages
      .slice(userIndex + 1)
      .find(
        (msg) =>
          msg.sender === 'ai' &&
          !msg.isThinkingPlaceholder &&
          !msg.isDotPlaceholder,
      );

    if (followingAi) {
      await handleRegenerate(followingAi.id);
      return;
    }

    const historyForRetry = messages.slice(0, userIndex + 1);
    setMessages(historyForRetry);
    await fetchAiResponse(historyForRetry, systemPrompt, selectedModel, undefined, undefined, undefined);
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
      backgroundColor: 'var(--chat-elevated)',
      border: '1px solid var(--chat-border)',
      borderRadius: '8px',
      boxShadow: '0 5px 15px rgba(0, 0, 0, 0.5)',
      color: 'var(--chat-text)',
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
        style={{ ...popupStyle, ...chatThemePreviewStyle }}
        className={`indicator-preview-popup chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme}`}
        onMouseEnter={handleIndicatorPopupMouseEnter}
        onMouseLeave={handleIndicatorPopupMouseLeave}
      >
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--chat-border)', fontWeight: 500 }}>
          Sources for this section
        </div>
        <ul style={{ listStyle: 'none', padding: '8px 10px', margin: 0, maxHeight: '150px', overflowY: 'auto' }}>
          {hoveredIndicatorInfo.sources.map((source, idx: number) => (
            <li key={source.index} style={{ marginBottom: idx < hoveredIndicatorInfo.sources.length - 1 ? '5px' : '0' }}>
              <a
                href={source.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--chat-accent)] underline decoration-[var(--chat-border)] underline-offset-2 transition-colors hover:decoration-[var(--chat-accent)]"
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
      backgroundColor: 'var(--chat-elevated)',
      color: 'var(--chat-text)',
      border: '1px solid var(--chat-border)',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '0.75rem',
      boxShadow: '0 2px 8px color-mix(in srgb, var(--chat-text) 14%, transparent)',
      whiteSpace: 'nowrap',
    };

    const modelName = findModelById(groupedModels, modelTooltipInfo.modelId)?.name || modelTooltipInfo.modelId;

    return (
      <div
        ref={modelTooltipRef}
        className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme}`}
        style={{ ...mainContainerStyle, ...chatThemePreviewStyle }}
      >
        <div style={individualContainerStyle}>Model: {modelName}</div>
        {modelTooltipInfo.tokenCount !== undefined && (
          <div style={individualContainerStyle}>Tokens: {modelTooltipInfo.tokenCount}</div>
        )}
      </div>
    );
  };
  
  // --- Feedback Popup Component --- 
  // A render FUNCTION, called inline, not a component rendered as <FeedbackPopup />. Declared inside
  // the parent, it would be a new component type on every parent render, and React remounts on a
  // changed type — which restarts the CSS animation from 0% each time. The exit is 200ms long and a
  // chat re-renders for many reasons, so the close was being cut off and replaced by a cut. Called
  // as a function there is no component boundary at all: the div is reconciled by position and key.
  const renderFeedbackPopup = () => {
    // The RETAINED info, not the live state: while the popover is closing the live one is already
    // null, and the exit still has to be drawn where the popover stood.
    const info = feedbackPopupPresence.rendered;
    if (!info) return null;

    const { messageId, position, placement } = info;

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
      { label: 'Helpful answer', icon: ThumbsUpDecl, type: 'helpful' },
      { label: 'Well-written response', icon: FeatherDecl, type: 'well-written' },
      { label: 'Accurate information', icon: TargetDecl, type: 'accurate' },
      { label: 'Funny response', icon: SmileDecl, type: 'funny' },
      { label: 'Good use of memory', icon: BrainCircuitDecl, type: 'memory' },
    ];

    return (
      <div
        ref={feedbackPopupRef}
        // Hidden from assistive tech the moment the intent is gone, even though the box is still
        // on screen playing its exit.
        aria-hidden={!feedbackPopupInfo}
        // The wrapper POSITIONS and nothing else. `chat-themed` paints `background: var(--chat-canvas)`,
        // and a wrapper carrying it draws an opaque square-cornered rectangle right behind the rounded
        // panel — visible at the corners, and visible all round while the panel is still scaled at 0.94
        // on the way in. The panel's own inline `--chat-elevated` fill used to cover that, back when
        // both were the same element; splitting them for the placement transform is what exposed it.
        // The theme classes therefore ride on the panel, where a background is wanted.
        style={{
          ...feedbackPopupAnchorStyle(position, placement),
          // A menu on its way out must not swallow the click that follows it.
          pointerEvents: feedbackPopupPresence.shown ? 'auto' : 'none',
          ...chatThemePreviewStyle,
        }}
      >
      <div
        // Remount on each flip, so a close that arrives mid-open restarts the animation instead of
        // being ignored as "same animation-name, already running".
        key={feedbackPopupPresence.shown ? 'feedback-popup-in' : 'feedback-popup-out'}
        className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} chat-history-popover`}
        style={{
          ...FEEDBACK_POPUP_PANEL_STYLE,
          ...feedbackPopupMotionStyle(
            placement,
            feedbackPopupPresence.shown,
            Boolean(feedbackPopupInfo),
          ),
        }}
      >
        {/* Was a `<ul>` of `<li><button>`. The list markup is why the pill could not be dropped in as
            it stands elsewhere in this file: the host has to be the element the rows measure against,
            and a `<ul>` may not hold the pill's `<div>`. Every other menu here is a div of buttons, so
            this is now one too — which also lets the rows carry `menuitem` and be found by the pill's
            default selector. */}
        <div
          {...(() => { const { ref: _g, className: _c, ...handlers } = feedbackGoo.hostProps; return handlers; })()}
          {...feedbackMenuKbd.menuProps}
          aria-label="Why was this helpful?"
          className={`${feedbackGoo.hostProps.className} chat-goo chat-goo-feedback p-2 [&>button+button]:mt-1`}
        >
          {/* First child, so the pill paints behind the rows rather than over them. */}
          {feedbackGoo.pill}
          {feedbackOptions.map((option) => (
            <MenuItem
              key={option.type}
              onSelect={() => handleFeedbackSubmit(option.type)}
              leadingIcon={option.icon}
            >
              {option.label}
            </MenuItem>
          ))}
        </div>
      </div>
      </div>
    );
  };

  // --- Dislike Feedback Popup Component ---
  // Called inline, for the same reason as the like popover above.
  const renderDislikeFeedbackPopup = () => {
    // See renderFeedbackPopup: the retained info is what the exit is drawn from.
    const info = dislikePopupPresence.rendered;
    if (!info) return null;

    const { messageId, position, placement } = info;

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
      // Two words, like every other row: "Wanted something else" was the only label that
      // wrapped, and a wrapped first row makes the menu look like it starts with a
      // paragraph. It also lands in the family the rest of the list already speaks —
      // "Incorrect answer", "Biased answer" — as the generic member of it.
      { label: 'Different answer', icon: ThumbsDownDecl, type: 'wanted-else' },
      { label: 'Incorrect answer', icon: MessageSquareXDecl, type: 'incorrect' }, 
      { label: 'Biased answer', icon: QuoteDecl, type: 'biased' }, 
      { label: 'Wanted image', icon: ImageDecl, type: 'wanted-image' },
      { label: 'Bad style / tone', icon: WandSparklesDecl, type: 'bad-style' }, 
      { label: 'Wanted to search', icon: SearchDecl, type: 'wanted-search' },
      { label: 'Incorrect memory', icon: FileXDecl, type: 'incorrect-memory' }, 
    ];

    return (
      <div
        ref={dislikePopupRef}
        aria-hidden={!dislikePopupInfo}
        // Positions only — see the like popover: `chat-themed` carries a canvas fill, so it belongs on
        // the panel, not on the box that merely places it.
        style={{
          ...feedbackPopupAnchorStyle(position, placement),
          pointerEvents: dislikePopupPresence.shown ? 'auto' : 'none',
          ...chatThemePreviewStyle,
        }}
      >
        <div
          key={dislikePopupPresence.shown ? 'dislike-popup-in' : 'dislike-popup-out'}
          className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} chat-history-popover`}
          style={{
            ...FEEDBACK_POPUP_PANEL_STYLE,
            ...feedbackPopupMotionStyle(
              placement,
              dislikePopupPresence.shown,
              Boolean(dislikePopupInfo),
            ),
          }}
        >
          <div
            {...(() => { const { ref: _g, className: _c, ...handlers } = dislikeGoo.hostProps; return handlers; })()}
            {...dislikeMenuKbd.menuProps}
            aria-label="What went wrong?"
            className={`${dislikeGoo.hostProps.className} chat-goo chat-goo-feedback p-2 [&>button+button]:mt-1`}
          >
            {dislikeGoo.pill}
            {dislikeOptions.map((option) => (
              <MenuItem
                key={option.type}
                onSelect={() => handleDislikeFeedbackSubmit(option.type)}
                leadingIcon={option.icon}
              >
                {option.label}
              </MenuItem>
            ))}
          </div>
        </div>
      </div>
    );
  };
  
  // Handler for opening the DISLIKE feedback popup
  const handleOpenDislikePopup = (event: React.MouseEvent<HTMLButtonElement>, messageId: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const gap = 5;

    const x = rect.left + window.scrollX;
    const placement: FeedbackPopupPlacement = rect.top < viewportHeight / 2 ? 'below' : 'above';
    const y =
      placement === 'below'
        ? rect.bottom + window.scrollY + gap
        : rect.top + window.scrollY - gap;

    // Toggles, like the like menu.
    setDislikePopupInfo(prev =>
      prev && prev.messageId === messageId ? null : { messageId, position: { x, y }, placement },
    );
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

  /**
   * Scrolling the transcript dismisses the feedback popovers.
   *
   * Every other menu in the chat is a child of the control that opened it, so it travels with it and
   * the question never comes up. These two are portalled to `document.body` and placed in document
   * coordinates — which is what lets them escape the column that clips this area — and the transcript
   * scrolls INSIDE its own container, so the page never moves and nothing tells the popover its
   * button has left. It just hung there over the new content.
   *
   * Dismissing is the honest answer rather than tracking: the menu is about one message, and once
   * that message has scrolled away the menu is about nothing.
   *
   * The gestures, not the `scroll` event. The transcript scrolls itself for its own reasons —
   * measured: opening a menu on an older message is followed by the view returning to the bottom —
   * and a `scroll` listener cannot tell that from the user pushing the wheel, so it closed the menu
   * the instant it opened. `wheel` and `touchmove` only ever come from a person. Dragging the
   * scrollbar is already covered: it starts with a mousedown outside the menu, which is the
   * dismissal rule this popover has always had.
   */
  useEffect(() => {
    if (!feedbackPopupInfo && !dislikePopupInfo) return;
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;

    const dismiss = () => {
      setFeedbackPopupInfo(null);
      setDislikePopupInfo(null);
    };
    chatArea.addEventListener('wheel', dismiss, { passive: true });
    chatArea.addEventListener('touchmove', dismiss, { passive: true });
    return () => {
      chatArea.removeEventListener('wheel', dismiss);
      chatArea.removeEventListener('touchmove', dismiss);
    };
  }, [feedbackPopupInfo, dislikePopupInfo]);
  
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
      setDeleteConfirmationModal((prev) => ({ ...prev, isOpen: false }));
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
    isShown: boolean;
    onClose: () => void;
    showDownloadButton?: boolean;
  }> = ({ imageUrl, isOpen, isShown, onClose, showDownloadButton }) => {
    if (!imageUrl) return null;

    return (
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center p-4 image-viewer-overlay backdrop-blur-md"
        style={{
          backgroundColor: isShown ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0)',
          transition: `background-color ${SCHEDULE_CREATE_MODAL_MS}ms ${SCHEDULE_DATE_EASE}`,
        }}
        onClick={onClose}
      >
        <style>{CHAT_MODAL_KEYFRAMES_CSS}</style>
        <div className="group absolute top-4 right-4 z-[1001] w-16 h-16 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 ease-in-out -z-10"></div>
          /* Stays hand-written, and the reason is what it sits ON. This is an overlay control on
             a full-screen IMAGE — arbitrary content, any colour — so its ink is `--chat-text` at rest
             with a plate of its own fading in behind it. `ghost` rests at `--chat-muted`, which is
             chosen to be quiet against a known surface and is exactly the wrong thing over a
             photograph. A variant cannot be legible against content it does not know. */
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
              className="relative z-10 p-2 rounded-md text-[var(--chat-text)] hover:bg-[var(--chat-hover)] active:scale-95 transition-all duration-150 ease-in-out"
              title="Download Image"
            >
              <Download size={20} />
            </button>
          )}
          <IconButton
            icon={XDecl}
            variant="ghost"
            size="lg"
            iconSize={24}
            className="relative z-10 ml-1 duration-150 ease-in-out"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title="Close Fullscreen"
            aria-label="Close fullscreen"
          />
        </div>
        <div
          className="relative flex h-[90vh] w-[90vw] items-center justify-center"
          style={chatModalCardMotionStyle('center', isShown, isOpen)}
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={imageUrl}
            alt="Fullscreen image"
            className="h-full w-full rounded-lg object-contain shadow-2xl"
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
          // Open the same file-preview window used by Projects.
          openProjectFilePreview({
            name: file.name,
            content: e.target.result as string,
            encoding: 'text',
            type: file.type,
          });
        } else {
          console.error('[Context Panel] FileReader result is empty');
        }
      };
      
      reader.onerror = (error) => {
        console.error('[Context Panel] Error reading file:', error);
      };
      
      reader.readAsText(file.fileObject);
    } else {
      // Handling serialized file data from history — open the same window Projects uses.
      const serializedFile = fileData as { name: string, type: string, content: string, encoding: 'base64' | 'text' };
      openProjectFilePreview({
        name: serializedFile.name,
        content: serializedFile.content,
        encoding: serializedFile.encoding,
        type: serializedFile.type,
      });
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
        className={`context-panel-overlay ${isContextPanelOpen ? 'visible' : ''}`}
        onClick={() => {
          setIsContextPanelOpen(false);
          setIsEditingContextPanel(false);
        }}
      >
        <div className="context-panel" onClick={(e) => e.stopPropagation()}>
        <div className="context-panel-drag-handle" onMouseDown={handleMouseDownOnDragHandle} />

        {/* Header */}
        <div className="context-panel-header">
          <div className="context-panel-title">
            <FileText size={14} className="flex-shrink-0 opacity-60" />
            <span className="truncate">{contextPanelContent.title}</span>
          </div>
          <div className="context-panel-actions">
            {/* Edit / Save / Cancel buttons */}
            {/* The whole cluster converts, and the two hand-written classes it used were already the
                variants spelled out in CSS. `.context-panel-btn` is `quiet` word for word — a
                `--chat-border` hairline at rest with muted ink, going to full ink over a
                `--chat-hover` tint when reached for — and `.context-panel-btn-icon` is `ghost`: the
                same ink and hover with no border and a square box.
                Their `.success` and `.active` modifiers were the hover appearance held on. That is
                the selection axis, so it becomes `data-selection` and reads the way every other held
                state in this chat now reads: a `--xeno-control` fill with the outline dropped,
                instead of a pointer tint left switched on.
                30px sits exactly between `sm` and `md`; `sm` wins on the type, which is 12.5 against
                sm's 13 and md's 14. Glyphs stay at 14 through `iconSize` — sm draws 16. */}
            {isEditingContextPanel ? (
              <>
                <Button
                  variant="quiet"
                  size="sm"
                  iconSize={14}
                  leadingIcon={CheckDecl}
                  data-selection={contextPanelSaveSuccess ? 'on' : 'off'}
                  onClick={handleSaveEdit}
                  title="Save changes"
                >
                  {contextPanelSaveSuccess ? 'Saved!' : 'Save'}
                </Button>
                <IconButton
                  icon={XDecl}
                  variant="ghost"
                  size="sm"
                  iconSize={14}
                  onClick={handleCancelEdit}
                  aria-label="Cancel editing"
                  title="Cancel editing"
                />
              </>
            ) : (
              <>
                <Button
                  variant="quiet"
                  size="sm"
                  iconSize={14}
                  leadingIcon={contextPanelSaveSuccess ? CheckDecl : EditDecl}
                  data-selection={contextPanelSaveSuccess ? 'on' : 'off'}
                  onClick={handleStartEdit}
                  title="Edit content"
                >
                  {contextPanelSaveSuccess ? 'Saved!' : 'Edit'}
                </Button>
                <IconButton
                  icon={contextPanelCopySuccess ? CheckDecl : CopyDecl}
                  variant="ghost"
                  size="sm"
                  iconSize={14}
                  data-selection={contextPanelCopySuccess ? 'on' : 'off'}
                  onClick={handleCopyContent}
                  aria-label={contextPanelCopySuccess ? 'Copied' : 'Copy content'}
                  title={contextPanelCopySuccess ? 'Copied!' : 'Copy content'}
                />
                <IconButton
                  icon={WrapTextDecl}
                  variant="ghost"
                  size="sm"
                  iconSize={14}
                  data-selection={contextPanelWrapEnabled ? 'on' : 'off'}
                  onClick={() => setContextPanelWrapEnabled(!contextPanelWrapEnabled)}
                  aria-label={contextPanelWrapEnabled ? 'Disable text wrapping' : 'Enable text wrapping'}
                  title={contextPanelWrapEnabled ? 'Disable text wrapping' : 'Enable text wrapping'}
                />
              </>
            )}
            <IconButton
              icon={XDecl}
              variant="ghost"
              size="sm"
              iconSize={14}
              onClick={() => {
                setIsContextPanelOpen(false);
                setIsEditingContextPanel(false);
              }}
              aria-label="Close panel"
              title="Close panel"
            />
          </div>
        </div>

        {/* Content */}
        <div className="context-panel-content">
          {isEditingContextPanel ? (
            /* Stays hand-written — not a form field at all. `.context-panel-edit-area` is
               `height: 100%`, `border: none`, `resize: none`, 16px of padding and a monospace face:
               an editing SURFACE that fills the panel it lives in. `.xeno-textarea` is a bordered
               card with a 12px radius that grows when you drag it. Every one of those properties
               would have to be overridden back, which is the definition of the wrong component. */
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
              <div className="text-sm text-[var(--chat-text)] p-4" style={codeStyle}>
                {contextPanelContent.content}
              </div>
            )
          )}
        </div>
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
        // Serialize image attachments (array + legacy single field)
        const serializeImage = async (attachment: {
          file?: File;
          name: string;
          type: string;
          base64Data?: string;
        }) => {
          if (attachment.file instanceof File) {
            const base64Url = await fileToBase64(attachment.file);
            return {
              name: attachment.file.name,
              type: attachment.file.type,
              base64Data: base64Url.split(',')[1],
            };
          }
          if (attachment.base64Data) {
            const { file: _file, ...rest } = attachment;
            return rest;
          }
          return null;
        };

        if (Array.isArray(message.userImageAttachments) && message.userImageAttachments.length > 0) {
          const serializedList = [];
          for (const attachment of message.userImageAttachments) {
            try {
              const serialized = await serializeImage(attachment);
              if (serialized) serializedList.push(serialized);
            } catch (error) {
              console.error('Error serializing image attachment for history:', error);
            }
          }
          if (serializedList.length > 0) {
            message.userImageAttachments = serializedList;
            message.userImageAttachment = serializedList[0];
          } else {
            delete message.userImageAttachments;
            delete message.userImageAttachment;
          }
        } else if (message.userImageAttachment) {
          try {
            const serialized = await serializeImage(message.userImageAttachment);
            if (serialized) {
              message.userImageAttachment = serialized;
              message.userImageAttachments = [serialized];
            } else {
              delete message.userImageAttachment;
            }
          } catch (error) {
            console.error('Error serializing image attachment for history:', error);
            delete message.userImageAttachment;
          }
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

  // Compact action buttons — conversation needs vertical room for the message exchange.
  const composerActionButtonSizeClass = 'h-7 w-7 rounded-lg';

  const activeHistoryConvo = activeConversationId
    ? conversationHistory.find((convo) => convo.id === activeConversationId)
    : undefined;

  const conversationFileItems = useMemo(() => {
    const items: {
      key: string;
      name: string;
      kind: 'file' | 'image';
      content: string;
    }[] = [];

    for (const message of messages) {
      if (message.userFileAttachment?.name) {
        const attachment = message.userFileAttachment;
        const raw = attachment.content?.trim() ?? '';
        let content = raw;
        if (!content) {
          content = 'No preview available for this file.';
        } else if (attachment.encoding === 'base64') {
          content = raw || 'Binary file — text preview not available.';
        }
        items.push({
          key: `${message.id}-file`,
          name: attachment.name,
          kind: 'file',
          content,
        });
      }
      const images =
        message.userImageAttachments && message.userImageAttachments.length > 0
          ? message.userImageAttachments
          : message.userImageAttachment
            ? [message.userImageAttachment]
            : [];
      images.forEach((image, index) => {
        if (!image?.name && !image?.file && !image?.base64Data) return;
        items.push({
          key: `${message.id}-image-${index}`,
          name: image.name || 'Image',
          kind: 'image',
          content: image.base64Data
            ? `[Image: ${image.name || 'attachment'}]\n\nPreview is available in the message bubble.`
            : `[Image: ${image.name || 'attachment'}]`,
        });
      });
    }
    // Empty chats show mock files so the list + preview can be judged visually.
    return items.length > 0 ? items : MOCK_CHAT_FILES;
  }, [messages]);

  const chatFilesSelected = useMemo(
    () =>
      conversationFileItems.find((item) => item.key === chatFilesSelectedKey) ??
      null,
    [conversationFileItems, chatFilesSelectedKey],
  );

  const openChatFilesPanel = () => {
    setIsProjectFilePreviewOpen(false);
    setIsContextPanelOpen(false);
    setChatFilesSelectedKey(null);
    setChatFilesCopied(false);
    setIsChatFilesModalOpen(true);
  };

  const closeChatFilesModal = useCallback(() => {
    setIsChatFilesModalOpen(false);
  }, []);

  /**
   * The seven modal dialogs this file renders, each taking its behaviour from the library.
   *
   * They already looked finished — scrim, card, entrance, Escape on most of them — and none of them did
   * the rest of what a dialog does. Measured on the two that were converted first: focus stayed on
   * `body` when they opened, Tab walked straight out into the page behind, and closing left focus
   * nowhere. `useDialog` moves focus in, keeps Tab inside, and hands focus back to whatever opened it.
   *
   * One hook per dialog, and they sit HERE rather than beside the state they belong to: each takes a
   * close function, and those are `const` declarations further up — referencing one before its line runs
   * is a temporal dead zone, not a hoisted function. So the calls go after the last of them.
   *
   * `open` is the `*Open` flag rather than `*Mounted`: mounted stays true through the exit animation, and
   * focus should go back to the opener when the dialog is dismissed, not when its animation finishes.
   *
   * `lockScroll` is off throughout. This app already keeps the body unscrollable, and the hook's
   * refcount would capture and restore that state for nothing.
   */
  const createProjectDialog = useDialog<HTMLDivElement>({
    open: isCreateProjectModalOpen,
    onClose: closeCreateProjectModal,
    lockScroll: false,
  });
  const projectSettingsDialog = useDialog<HTMLDivElement>({
    open: isProjectSettingsOpen,
    onClose: closeProjectSettings,
    lockScroll: false,
  });
  const deleteChatDialog = useDialog<HTMLDivElement>({
    open: deleteConfirmationModal.isOpen,
    onClose: handleCancelDelete,
    lockScroll: false,
  });
  const projectFilePreviewDialog = useDialog<HTMLDivElement>({
    open: isProjectFilePreviewOpen,
    onClose: closeProjectFilePreview,
    lockScroll: false,
  });
  const projectScheduledPreviewDialog = useDialog<HTMLDivElement>({
    open: isProjectScheduledPreviewOpen,
    onClose: closeProjectScheduledPreview,
    lockScroll: false,
  });
  const projectScheduledCreateDialog = useDialog<HTMLDivElement>({
    open: isProjectScheduledCreateOpen,
    onClose: closeProjectScheduledCreate,
    lockScroll: false,
  });
  const chatFilesDialog = useDialog<HTMLDivElement>({
    open: isChatFilesModalOpen,
    onClose: closeChatFilesModal,
    lockScroll: false,
  });

  const copyChatFilesPreview = useCallback(async () => {
    if (!chatFilesSelected) return;
    try {
      await navigator.clipboard.writeText(chatFilesSelected.content);
      setChatFilesCopied(true);
      window.setTimeout(() => setChatFilesCopied(false), 1500);
    } catch (error) {
      console.error('Failed to copy chat file preview:', error);
    }
  }, [chatFilesSelected]);

  useEffect(() => {
    if (!isChatFilesModalMounted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeChatFilesModal();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isChatFilesModalMounted, closeChatFilesModal]);

  // These rows used to need `xeno-icon-hover` — the library's "treat this as an icon host" hook — because
  // they were Tailwind classes, and a glyph animates from its HOST, off a closed list the library
  // recognises. They are `<MenuItem>` now, which is ON that list, so the hook is gone with the class it
  // rode on.
  //
  // The ⋯ menu's hover highlight: one pill that TRAVELS to the row you point at, rather than each row
  // painting its own background. A fill that appears on the new row and vanishes from the old one is two
  // events with no journey between them, and it never says where it came from.
  //
  // The library owns the motion (`goo.css`); this menu is hand-rolled Tailwind rather than `<Menu>`, so
  // it takes the behaviour through the hook instead of by adopting the component — which is the point of
  // `useGooPill` existing separately from `<Menu>` at all.
  /* One ref, two hooks. `useGooPill` measures the rows against this element and `useMenu` moves focus
     inside it — so the highlight and the keyboard are looking at the same panel rather than at two
     elements that happen to overlap. The goo hook's own `ref` is dropped at the call site below; the
     menu hook's callback is what attaches, because it is the one that has to focus the first row the
     instant the panel exists. */
  const chatMoreMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const chatMoreGoo = useGooPill<HTMLDivElement>({ hostRef: chatMoreMenuPanelRef });
  const chatMoreMenu = useMenu<HTMLDivElement>({
    open: isChatMoreMenuOpen,
    onClose: () => setIsChatMoreMenuOpen(false),
    menuRef: chatMoreMenuPanelRef,
  });
  // One host per PANEL, not per menu-shaped thing: the pill is positioned against the element it lives
  // in, so two panels cannot share one. The Recents filter and its submenu are open at the same time and
  // each wants its own highlight, which is the case that settles it.
  //
  // The project kebab is the exception that still shares: its panel is rendered inside a `.map()`, but
  // only one project's menu is open at a time, so only one host is ever mounted.
  const catalogFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const catalogFilterGoo = useGooPill<HTMLDivElement>({ hostRef: catalogFilterMenuRef });
  const catalogFilterMenuKbd = useMenu<HTMLDivElement>({
    open: isChatsCatalogFilterOpen,
    onClose: () => { setIsChatsCatalogFilterOpen(false); },
    menuRef: catalogFilterMenuRef,
  });
  const projectsSortMenuRef = useRef<HTMLDivElement | null>(null);
  const projectsSortGoo = useGooPill<HTMLDivElement>({ hostRef: projectsSortMenuRef });
  const projectsSortMenuKbd = useMenu<HTMLDivElement>({
    open: isProjectsSortOpen,
    onClose: () => { setIsProjectsSortOpen(false); },
    menuRef: projectsSortMenuRef,
  });
  const projectMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const projectMenuGoo = useGooPill<HTMLDivElement>({ hostRef: projectMenuPanelRef });
  const projectMenuKbd = useMenu<HTMLDivElement>({
    open: openProjectMenuId !== null,
    onClose: () => { setOpenProjectMenuId(null); },
    menuRef: projectMenuPanelRef,
  });
  const historyRowMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const historyRowGoo = useGooPill<HTMLDivElement>({ hostRef: historyRowMenuPanelRef });
  const historyRowMenuKbd = useMenu<HTMLDivElement>({
    open: isHistoryRowMenuOpen,
    onClose: () => { closeHistoryRowMenu(); },
    menuRef: historyRowMenuPanelRef,
  });
  const recentsFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const recentsFilterGoo = useGooPill<HTMLDivElement>({ hostRef: recentsFilterMenuRef });
  const recentsFilterMenuKbd = useMenu<HTMLDivElement>({
    open: Boolean(recentsFilterMenu),
    onClose: () => { setRecentsFilterMenu(null); },
    menuRef: recentsFilterMenuRef,
  });
  /* The attach panel was the last dropdown in this file still doing none of what a menu does — every
     row its own Tab stop, arrows dead, Escape ignored. It reuses `attachMenuRef`, which the
     click-outside handler already holds, so the pill, the keyboard and the outside-click all measure
     the same element. */
  const attachMenuGoo = useGooPill<HTMLDivElement>({ hostRef: attachMenuRef });
  const attachMenuKbd = useMenu<HTMLDivElement>({
    open: isAttachMenuOpen,
    onClose: () => { setIsAttachMenuOpen(false); },
    menuRef: attachMenuRef,
  });
  const recentsSubmenuRef = useRef<HTMLDivElement | null>(null);
  const recentsSubmenuGoo = useGooPill<HTMLDivElement>({ hostRef: recentsSubmenuRef });
  const recentsSubmenuKbd = useMenu<HTMLDivElement>({
    open: Boolean(recentsFilterSubmenu),
    onClose: () => { setRecentsFilterSubmenu(null); },
    menuRef: recentsSubmenuRef,
  });
  // The history sidebar: its top nav, and the list under it (chats, archived, projects — one scroller,
  // so one host). Rows are marked with `data-goo-row` rather than matched by class: these lists are
  // hand-rolled Tailwind and a selector written against utility classes would break the first time
  // someone changed the padding.
  /* The two feedback popovers. They were the last menus in the chat highlighting a row by painting its
     own background — the grey rectangle you can see snap on and off, against every other menu here
     where the highlight travels. They also had no menu semantics at all: a `<ul>` of `<li><button>`
     with no roles, which is why the pill's default row selector (`button[role^="menuitem"]`) had
     nothing to find even if it had been wired. Both are fixed by the same edit. */
  const feedbackMenuRef = useRef<HTMLDivElement | null>(null);
  const feedbackGoo = useGooPill<HTMLDivElement>({ hostRef: feedbackMenuRef });
  const feedbackMenuKbd = useMenu<HTMLDivElement>({
    open: Boolean(feedbackPopupInfo),
    onClose: () => { setFeedbackPopupInfo(null); },
    menuRef: feedbackMenuRef,
  });
  const dislikeMenuRef = useRef<HTMLDivElement | null>(null);
  const dislikeGoo = useGooPill<HTMLDivElement>({ hostRef: dislikeMenuRef });
  const dislikeMenuKbd = useMenu<HTMLDivElement>({
    open: Boolean(dislikePopupInfo),
    onClose: () => { setDislikePopupInfo(null); },
    menuRef: dislikeMenuRef,
  });
  const historyNavGoo = useGooPill<HTMLDivElement>({ rowSelector: '[data-goo-row]' });
  const historyListGoo = useGooPill<HTMLDivElement>({ rowSelector: '[data-goo-row]' });

  // Two callers left, and they are the two that are not square: Temporary (glyph + label) and Theme
  // (glyph + a chevron that turns). The four icon-only ones are `<IconButton variant="quiet">` now,
  // pixel-identical to what this produced.
  //
  // These two stay together on purpose. Temporary would fit `<Button variant="quiet" size="lg">`, but
  // every metric it has was picked by eye and differs from the scale — padding 10 against 14, font 13
  // against 14, glyph 15 against 18 — so adopting it is a resize, not a swap. Theme cannot follow it:
  // its trailing chevron rotates, and neither Button nor its trailing slot has a word for that. One of
  // the pair on the system's scale and the other on the old one, side by side, is worse than both
  // waiting.
  const topBarBtnClass = (isActive: boolean, extra = '') =>
    `chat-top-bar-btn flex h-9 items-center justify-center rounded-lg border text-[var(--chat-muted)] transition-[background-color,border-color,color] active:scale-[0.98] ${
      isActive
        ? 'border-transparent text-[var(--chat-text)]'
        : 'border-[var(--chat-border)] hover:border-[var(--chat-border)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]'
    } ${extra}`.trim();

  // The one-and-only primary composer. Rendered in the empty/active chat AND reused verbatim
  // inside the project workspace (forceCompact) so the two can never visually diverge.
  // "What's new" is empty-new-chat only — hide under Projects / Artifacts / Skills / Scheduled / Customize
  // (and project workspace / chats catalog), or the fixed restore chip paints over those pages.
  const showWhatsNewOnSurface =
    messages.length === 0 &&
    !isProjectsPageOpen &&
    !isArtifactsPageOpen &&
    !isGlobalSettingsPageOpen &&
    !isScheduledPageOpen &&
    !isCustomizePageOpen &&
    !activeProjectId &&
    !isChatsCatalogOpen;

  /**
   * The scroll-to-bottom pill, for the composer to host inside its floating mode row.
   * Same button, same handler — it just needs a home that the row does not cover.
   */
  /* Stays hand-written — the same morphing pill decided at the other end of this file, and the
     comment above says so: same button, same handler, a different home. Idle it is a 28px square with
     a bouncing chevron; working, it stretches to 82px and holds three animated dots that swap for a
     word under the pointer. Two contents, two widths, two bespoke animations. */
  const composerScrollAffordance = showScrollToBottom && messages.length > 0 ? (
    <button
      type="button"
      data-chat-scroll-in-row
      onClick={scrollToBottom}
      className={`group inline-flex h-7 items-center justify-center rounded-lg border border-[var(--chat-border)] bg-[var(--chat-surface)] text-[var(--chat-muted)] transition-colors duration-150 hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] focus:outline-none ${(isLoading || messages.some((m) => m.isStreaming)) ? 'w-[82px]' : 'w-7'}`}
      aria-label={(isLoading || messages.some((m) => m.isStreaming)) ? 'Generating — scroll to latest' : 'Scroll to bottom'}
    >
      {(isLoading || messages.some((m) => m.isStreaming)) ? (
        <>
          <span className="group-hover:hidden"><span className="xeno-gen-dots" aria-hidden="true"><i /><i /><i /></span></span>
          <span className="hidden whitespace-nowrap text-[11px] font-medium group-hover:inline">
            {messages.some((m) => m.isDotPlaceholder) ? 'Thinking…' : 'Generating…'}
          </span>
        </>
      ) : (
        <ChevronDown size={18} className="xeno-chevron-bounce" />
      )}
    </button>
  ) : null;

  const renderPrimaryComposer = (options?: { forceCompact?: boolean }) => (
          <div className="relative z-10">
          <ChatEmptyState
            scrollAffordance={composerScrollAffordance}
            isActive={options?.forceCompact ? false : messages.length === 0}
            isCompact={isMultiInterface}
            isTemporaryChat={isTemporaryChat}
            hideToolRail={options?.forceCompact}
            activeMode={emptyStateMode}
            canAnalyzeDocument={modelSupportsFileUpload(selectedModel)}
            modelSelector={({ isInlineTray, onOpenChange }) => (
              <ChatModelSelector
                groupedModels={groupedModels}
                isCompact={isMobile || isMultiInterface}
                isInlineTray={isInlineTray}
                isMinimal
                isLoading={isModelsLoading}
                isReasoningActive={modelHasReasoningCapability(selectedModel.id, selectedModel) !== 'disabled' && isReasonToggled}
                onOpenChange={onOpenChange}
                onSelect={handleModelSelect}
                selectedModel={selectedModel}
              />
            )}
            onAgentActionSelect={handleEmptyStateAgentAction}
            onModeChange={handleEmptyStateModeChange}
            onUploadFile={handleUploadFile}
            renderToolPanel={renderEmptyStateToolPanel}
            updates={
              showWhatsNewOnSurface && !options?.forceCompact
                ? []
                : undefined
            }
          >
          {/* Queue Container */}
          {queue.messages.length > 0 && (
            <div className="mb-3 bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-lg shadow-md">
              <div className="w-full flex items-center justify-between p-3 text-left text-[var(--chat-text)] rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{queue.messages.length} in queue</span>
                </div>
                <IconButton
                  icon={ChevronDownDecl}
                  variant="ghost"
                  size="xs"
                  iconSize={16}
                  onClick={toggleQueueExpansion}
                  aria-label={queue.isExpanded ? 'Collapse queued messages' : 'Expand queued messages'}
                />
              </div>
              
              {queue.isExpanded && (
                <div className="px-3 pb-3 space-y-2">
                  {queue.messages.map((queuedMessage, index) => (
                    <div 
                      key={queuedMessage.id}
                      className="flex items-center justify-between p-2 bg-[var(--chat-surface)]/80 rounded-md border border-[var(--chat-border)]/50"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="w-4 h-4 rounded-full border-2 border-[var(--chat-border)] flex-shrink-0"></div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-[var(--chat-text)] truncate">
                            {queuedMessage.text || `Task ${index + 1}`}
                          </div>
                          {queuedMessage.attachedFiles.length > 0 && (
                            <div className="text-xs text-[var(--chat-muted)] mt-1">
                              {queuedMessage.attachedFiles.length} file(s) attached
                            </div>
                          )}
                        </div>
                      </div>
                      <IconButton
                        icon={XDecl}
                        variant="ghost"
                        size="xs"
                        iconSize={14}
                        onClick={() => removeFromQueue(queuedMessage.id)}
                        aria-label="Remove from queue"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Input Box Area — inner bordered field inside the composer shell (empty + conversation). */}
          <div
            data-empty-composer-input="true"
            /* One stroke only: the shell carries it now (it is the box the gooey skin is
               moulded onto), so this inner field must not draw a second border. */
            className={`chat-input-container relative rounded-2xl border border-transparent bg-transparent shadow-none ${
              messages.length === 0 ? 'p-3' : 'p-2'
            }`}
          >
            {isContextLimitReached && (
              <div className="mb-3 p-2.5 border border-[var(--chat-danger)]/70 bg-[var(--chat-danger)]/15 rounded-lg text-[var(--chat-danger)] text-xs shadow-md">
                {contextLimitWarning}
              </div>
            )}
            {attachedFiles.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2 border-b border-[var(--chat-border)] pb-3">
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
                                        className="w-11 h-11 rounded-lg object-cover flex-shrink-0 border border-[var(--chat-border)] group-hover:border-[var(--chat-muted)] transition-all duration-200 ease-out cursor-pointer group-hover:scale-[1.02]"
                                        onClick={() => {
                                            if (file.fileObject) {
                                                setFullScreenImageUrl(URL.createObjectURL(file.fileObject));
                                                setIsFullScreenImageOpen(true);
                                                setViewerShowsDownloadButton(false);
                                            }
                                        }}
                                    />
                                    {/* Stays hand-written: 18 x 18, and the control scale starts at
                                        xs = 24. This is a badge notched into the chip's corner with a
                                        -6px overhang; six pixels wider is six more pixels of the chip
                                        covered, which is a visible change to the composition rather
                                        than to the control. `iconSize` reaches the glyph and
                                        deliberately not the box — the library's position is that
                                        height is a surface-level variable, so an 18px control is a
                                        size this app has not declared. Six controls in this chat sit
                                        below the floor (spec §9). */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemoveAttachedFile(file.id);
                                        }}
                                        className="w-[18px] h-[18px] flex items-center justify-center rounded-md bg-[var(--chat-elevated)] border border-[var(--chat-border)] text-[var(--chat-muted)] hover:text-[var(--chat-text)] hover:border-[var(--chat-border)] hover:bg-[var(--chat-hover)] opacity-0 group-hover:opacity-100 absolute top-[-6px] right-[-6px] transition-all duration-200 ease-out active:scale-90"
                                        aria-label="Remove file"
                                    >
                                        <X size={10} />
                                    </button>
                                </div>
                            ) : (
                                <div className="relative">
                                    <div
                                        className={`h-11 rounded-lg flex items-center gap-2 px-3 bg-[var(--chat-surface)] border border-[var(--chat-border)] group-hover:border-[var(--chat-muted)] transition-all duration-200 ease-out text-[13px] text-[var(--chat-text)] group-hover:text-[var(--chat-text)] ${file.fileObject ? 'cursor-pointer group-hover:scale-[1.01]' : 'cursor-default opacity-70'}`}
                                        onClick={() => {
                                            if (file.fileObject) {
                                                handleShowFileInContextPanel(file);
                                            }
                                        }}
                                    >
                                        <FileText size={14} className={file.fileObject ? "text-[var(--chat-muted)] group-hover:text-[var(--chat-text)]" : "text-[var(--chat-muted)]"} />
                                        <span className="truncate max-w-[140px]" title={file.name}>{file.name}</span>
                                        {!file.fileObject && (
                                            <span className="text-[11px] text-[var(--chat-muted)] ml-0.5">(recent)</span>
                                        )}
                                    </div>
                                    {/* Stays hand-written — the file chip's remove badge, the image
                                        chip's twin, same 18px box below the scale's floor. */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemoveAttachedFile(file.id);
                                        }}
                                        className="w-[18px] h-[18px] flex items-center justify-center rounded-md bg-[var(--chat-elevated)] border border-[var(--chat-border)] text-[var(--chat-muted)] hover:text-[var(--chat-text)] hover:border-[var(--chat-border)] hover:bg-[var(--chat-hover)] opacity-0 group-hover:opacity-100 absolute top-[-6px] right-[-6px] transition-all duration-200 ease-out active:scale-90"
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
              {/* Stays hand-written — one of the two composer fields §7 excludes by name, and this is
                  the marker that was missing: the spec knew, the file did not, so the board counted
                  it as undecided work. It is driven by a ref that measures and resets `scrollHeight`
                  on every keystroke to auto-grow, its rows change with the conversation, and Enter
                  sends while Shift+Enter does not. The library's own note calls the full composer a
                  Tier-2 container built ON this component rather than an instance of it. */}
              <textarea
                ref={textareaRef}
                placeholder={CHAT_MODE_PLACEHOLDERS[emptyStateMode]}
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
                rows={messages.length === 0 ? 2 : 2}
                className={`w-full resize-none border-none bg-transparent px-1 text-[15px] leading-6 text-[var(--chat-text)] outline-none placeholder:text-[var(--chat-muted)] focus:outline-none focus:ring-0 focus:shadow-none ${messages.length === 0 ? 'min-h-[3.25rem] pb-2 pt-0.5' : 'min-h-[3rem] max-h-[7.5rem] pb-1 pt-0.5'}`}
                style={{ maxHeight: messages.length === 0 ? '120px' : '120px' }}
              />
            </div>
            
            {/* Controls Row */}
            <div className={`chat-input-controls flex items-center justify-between gap-2 ${messages.length === 0 ? 'mt-1.5 md:mt-2' : 'mt-1'}`}>
              <div className="flex items-center gap-1 md:gap-2 relative">
                  {/* "+" reveals the mode tabs / model chip above the box; Upload rides out with it. */}
                  <ComposerRevealControls />
                  {/* Attach / Recent live on the hover tool rail (empty + conversation). */}
                  <div className="relative hidden">
                      <IconButton
                        icon={PaperclipDecl}
                        variant="quiet"
                        size="sm"
                        iconSize={16}
                        ref={attachButtonRef}
                        onClick={toggleAttachMenu}
                        aria-label="Attach file"
                        disabled={!modelSupportsVision(selectedModel)}
                      />
                      {/* Attach Menu */}
                      <div 
                          {...(() => { const { ref: _g, className: _c, ...handlers } = attachMenuGoo.hostProps; return handlers; })()}
                          {...attachMenuKbd.menuProps}
                          className={`
                              ${attachMenuGoo.hostProps.className} chat-goo
                              absolute bottom-full left-0 z-30 mb-2 origin-bottom-left
                              w-64 rounded-lg border border-[var(--chat-border)] bg-[var(--chat-elevated)] shadow-xl
                              transition-[opacity,transform] duration-200 ease-out
                              ${isAttachMenuOpen 
                                  ? 'opacity-100 scale-100 visible' 
                                  : 'opacity-0 scale-95 invisible' 
                              }
                          `}
                       >
                           {/* First child, so the pill paints behind the rows rather than over them. */}
                           {attachMenuGoo.pill}
                           <div className="space-y-1 p-2">
                               <MenuItem leadingIcon={FolderUpDecl} onSelect={handleUploadFile}>
                                   Upload a file
                               </MenuItem>
                               <div className="mx-1 my-1 border-t border-[var(--chat-border)]"></div>
                               {/* `submenu` AND `aria-expanded`, and both are true: the row promises a
                                   panel and that panel is currently showing. The second is what keeps
                                   this menu alive — `useMenu` dismisses on any chosen row except one
                                   reporting `aria-expanded`, and the Recent panel is only visible
                                   while `isAttachMenuOpen`, so closing here would destroy the thing
                                   the click just asked for. */}
                               <MenuItem
                                   leadingIcon={FileClockDecl}
                                   submenu
                                   aria-expanded={isRecentFilesOpen}
                                   onSelect={handleShowRecent}
                               >
                                   Recent
                               </MenuItem>
                           </div>
                         </div>
                        {/* Recent Files Panel */}
                         <div 
                            ref={recentFilesPanelRef}
                            className={`
                                hide-scrollbar
                                absolute bottom-full left-full z-30 mb-2 ml-2 origin-bottom-left
                                max-h-[320px] w-72 overflow-y-auto rounded-2xl border border-[var(--chat-border)] bg-[var(--chat-elevated)] shadow-xl
                                transition-all duration-200 ease-out
                                ${isRecentFilesOpen && isAttachMenuOpen 
                                    ? 'opacity-100 scale-100 visible' 
                                    : 'opacity-0 scale-95 invisible' 
                                }
                            `}
                            style={{ left: 'calc(16rem + 0.5rem)' }} // Adjust positioning if needed
                          >
                                 <div className="p-2">
                                     {/* Header */}
                                     <div className="mb-2 flex items-center justify-between px-1.5 pt-0.5">
                                       <span className="select-none text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--chat-muted)]">Recent</span>
                                       <IconButton
                                         icon={XDecl}
                                         variant="ghost"
                                         size="xs"
                                         iconSize={13}
                                         onClick={() => setIsRecentFilesOpen(false)}
                                         aria-label="Close recent files"
                                       />
                                     </div>
                                     <div className="mx-1.5 mb-2 h-px bg-[var(--chat-border)]" />
                                     {/* Recent Files Search */}
                                     {/* §7's canonical field: the `relative` wrapper, the
                                         absolutely-placed magnifier and the `pl-7` that dodged it
                                         all go, and the glyph becomes `leadingIcon`. Four lines
                                         become one, and the box that was three elements deep is one
                                         element.
                                         `iconSize={14}` holds the magnifier where it was — `sm`
                                         draws 16, which is why `TextInput` grew that door in this
                                         same pass. The fill was already `--chat-canvas`, which is
                                         what `.xeno-input` paints, and the focus border was already
                                         `--chat-muted`, which is what it focuses to. The radius
                                         moves 8 to 6, onto the scale. */}
                                     {recentFiles.length > 3 && (
                                       <div className="mb-2">
                                         <TextInput
                                           size="sm"
                                           iconSize={14}
                                           leadingIcon={SearchDecl}
                                           className="w-full"
                                           type="text"
                                           placeholder="Search files..."
                                           value={recentFilesSearchQuery}
                                           onChange={(e) => setRecentFilesSearchQuery(e.target.value)}
                                           aria-label="Search recent files"
                                         />
                                       </div>
                                     )}
                                     {recentFiles.length === 0 ? (
                                       <div className="px-3 py-6 text-center text-sm text-[var(--chat-muted)]">
                                         <FileClock size={24} className="mx-auto mb-2 text-[var(--chat-muted)]" />
                                         <p>No recent files</p>
                                         <p className="mt-1 text-xs">Files you attach will appear here</p>
                                       </div>
                                     ) : (
                                       recentFiles
                                         .filter(file =>
                                           !recentFilesSearchQuery.trim() ||
                                           file.name.toLowerCase().includes(recentFilesSearchQuery.toLowerCase())
                                         )
                                         .map((file: typeof recentFiles[0]) => (
                                         <div key={file.id} className="group flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm text-[var(--chat-text)] transition-colors hover:bg-[var(--chat-hover)]">
                                           <div 
                                             className="flex items-center gap-2 overflow-hidden flex-1" 
                                             onClick={() => handleReattachRecentFile(file)}
                                           >
                                             <span className="flex w-7 flex-shrink-0 items-center justify-center">
                                               {file.type.startsWith('image/') && file.preview ? (
                                                 <img src={file.preview} alt="" className="h-7 w-7 rounded-md object-cover" />
                                               ) : (
                                                 <FileText size={17} className="text-[var(--chat-muted)]" />
                                               )}
                                             </span>
                                             <div className="flex flex-col overflow-hidden">
                                                <span className="truncate" title={file.name}>{file.name}</span>
                                               <span className="mt-0.5 font-mono text-[11px] text-[var(--chat-muted)]">
                                                 {(file.size / 1024).toFixed(1)} KB · {new Date(file.lastUsed).toLocaleDateString()}
                                               </span>
                                             </div>
                                           </div>
                                           <IconButton
                                             icon={XDecl}
                                             variant="ghost"
                                             size="xs"
                                             iconSize={14}
                                             onClick={(e) => {
                                               e.stopPropagation();
                                               handleRemoveRecentFile(file.id);
                                             }}
                                             aria-label="Remove"
                                           />
                                         </div>
                                       ))
                                     )}
                          </div>
                        </div>
                      </div>
                      {/* Context usage. The permanent "n / m tokens" readout is gone from the
                          composer — the control row is meant to read as the designed one ("+",
                          Upload | mic, Send). It only speaks up when it has something to offer:
                          the Compress action, or a near/over-limit warning. */}
                      {!isMobile && (
                        <div data-token-context-counter className="flex shrink-0 items-center whitespace-nowrap">
                          {(() => {
                            const totalUsedTokens = activeConversationTokenCount + currentInputAndSystemTokens;
                            const maxTokens = selectedModel?.maxTokens || 200000;
                            // Use conversation-only tokens for compress threshold (not input)
                            const conversationUsagePercent = conversationTokenCount / maxTokens;
                            const totalUsagePercent = totalUsedTokens / maxTokens;
                            const canCompress = conversationUsagePercent > 0.9 && messages.length > 0;
                            const isNearLimit = totalUsagePercent > 0.9;
                            const isOverLimit = totalUsagePercent > 1;

                            if (!canCompress && !isNearLimit) return null;

                            if (canCompress) {
                              // Show compress button only when CONVERSATION history is near limit
                              /* Stays hand-written: it has no box. No padding, no height, no fill
                                 and no border — a line of tabular numbers that swaps itself for the
                                 word "Compress" under the pointer. A `Button` is a box with a height
                                 and side padding, and giving this one either would move the
                                 composer's status row. It reads as text because it is text that
                                 happens to be clickable. */
                              return (
                                <button
                                  onClick={() => compactConversation(selectedModel)}
                                  disabled={isLoading}
                                  className="group text-xs text-[var(--chat-muted)] transition-all hover:text-[var(--chat-text)] disabled:cursor-not-allowed disabled:opacity-50 tabular-nums"
                                >
                                  <span className="group-hover:hidden">
                                    {totalUsedTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens
                                  </span>
                                  <span className="hidden font-medium group-hover:inline">
                                    Compress
                                  </span>
                                </button>
                              );
                            }
                            return (
                              <span className={`text-xs tabular-nums ${isOverLimit ? 'text-[var(--chat-danger)]' : isNearLimit ? 'text-[var(--chat-text)]' : 'text-[var(--chat-muted)]'}`}>
                                {totalUsedTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens
                              </span>
                            );
                          })()}
                        </div>
                      )}
                      {/* Reasoning toggle */}
                      {modelHasReasoningCapability(selectedModel.id, selectedModel) === 'toggleable' && (
                        <IconButton
                          icon={BrainDecl}
                          variant="quiet"
                          size="sm"
                          iconSize={14}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsReasonToggled(prev => !prev);
                          }}
                          aria-label={isReasonToggled ? 'Turn off extended reasoning' : 'Turn on extended reasoning'}
                        />
                      )}
              </div>
                  <div className="flex items-center gap-2 md:gap-3">
                  {(isLoading || messages.some((m) => m.isStreaming)) ? (
                    // While generating OR typing out the answer: Queue (if typing) else Stop.
                    (inputValue.trim() || attachedFiles.length > 0) ? (
                      <IconButton
                        icon={PlusDecl}
                        variant="ghost"
                        size="sm"
                        iconSize={16}
                        onClick={addToQueue}
                        title="Add this message to the queue"
                        aria-label="Add this message to the queue"
                      />
                    ) : (
                      /* Stays hand-written, and the reason is a pair rather than this button.
                         The three composer actions — Stop, Mic, Send — are guaranteed the same box
                         by one shared `composerActionButtonSizeClass`, and a test counts its uses to
                         keep that guarantee. Send cannot convert at all: index.css repaints it with
                         `!important` in both states, so a variant would have nothing to decide.
                         Converting the two that could would leave the pair the same size by two
                         different mechanisms, which is the drift the shared class exists to stop.
                         The class itself is already the scale — `h-7 w-7 rounded-lg` is `sm` at the
                         control radius — so this converts the day Send can. */
                      <button
                        onClick={handleStopGeneration}
                        title="Stop generating"
                        aria-label="Stop generating"
                        className={`${composerActionButtonSizeClass} flex items-center justify-center bg-[var(--chat-surface)] text-[var(--chat-text)] transition-all hover:bg-[var(--chat-control)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--chat-muted)]`}
                      >
                        {/* The last lucide import left in the chat's chrome, and it was not being used
                            as an icon: `fill="currentColor" strokeWidth={0}` is a call site asking for a
                            RECTANGLE. XENO has a `stop`, and its declaration already settled what stop
                            looks like in this grammar — a rounded square outline, deliberately not the
                            filled block a media player would use.

                            So this is a visible change: the button goes from a solid square to an
                            outlined one. It is the set's own answer to the question, and it brings the
                            control a hover motion it never had. */}
                        <Stop size={14} />
                      </button>
                    )
                  ) : (
                    <>
                      <div
                        ref={voiceControlRef}
                        className="voice-control relative flex items-center"
                        data-voice-menu-open={isVoiceModeMenuOpen ? 'true' : 'false'}
                      >
                        {/* Two losses from one conversion, and the second is not cosmetic.
                            `data-voice-mode-trigger` went because the grep for it only read `src/`;
                            `scripts/test-chat-voice-controls.mjs` reads this file as TEXT and looks
                            for the attribute by name.
                            `absolute right-full mr-1` went because the whole className was replaced
                            rather than filtered — and those are LAYOUT. Without them the chevron
                            joined the flow and pushed Send along the row, which is the one thing the
                            test that noticed is named after. `flex h-7 w-7` did not come back: that
                            is `sm`, and it is the component's to say. */}
                        <IconButton
                          icon={ChevronDownDecl}
                          variant="ghost"
                          size="sm"
                          iconSize={15}
                          className="absolute right-full mr-1"
                          data-voice-mode-trigger
                          onClick={() => (isVoiceModeMenuOpen ? closeVoiceMenu() : openVoiceMenu())}
                          aria-label="Voice input options"
                          aria-expanded={isVoiceModeMenuOpen}
                          aria-haspopup="dialog"
                        />
                        {/* Stays hand-written — Stop's neighbour, same shared size class and the
                            same pair that cannot be split. */}
                        <button
                          type="button"
                          data-voice-primary
                          onClick={voiceInputMode === 'tap' ? handleToggleVoiceInput : undefined}
                          onPointerDown={handleVoicePointerDown}
                          onPointerUp={handleVoicePointerUp}
                          onPointerCancel={handleVoicePointerUp}
                          onKeyDown={handleVoiceKeyDown}
                          onKeyUp={handleVoiceKeyUp}
                          className={`${composerActionButtonSizeClass} flex items-center justify-center transition-all relative ${isVoiceInputActive ? 'bg-[var(--chat-control)]/70' : 'bg-[var(--chat-surface)] hover:bg-[var(--chat-control)]'}`}
                          aria-label={isVoiceInputActive ? 'Stop voice input' : voiceInputMode === 'hold' ? 'Hold to record voice input' : 'Start voice input'}
                        >
                          {isVoiceInputActive && (
                            <span className="absolute inset-0 flex items-center justify-center">
                              <span className="animate-ping h-3.5 w-3.5 rounded-full bg-[var(--chat-danger)] opacity-75"></span>
                            </span>
                          )}
                          <Mic size={16} className={`relative ${isVoiceInputActive ? 'text-[var(--chat-danger)]' : 'text-[var(--chat-muted)]'}`} />
                        </button>
                        {(isVoiceModeMenuOpen || isVoiceMenuClosing) && (
                          <div
                            data-voice-mode-popover
                            role="dialog"
                            aria-label="Voice input options"
                            className={`absolute -right-10 bottom-full z-40 mb-1.5 w-40 rounded-lg border border-[var(--chat-border)] bg-[var(--chat-elevated)] px-2 py-1.5 shadow-lg shadow-black/20 ${isVoiceModeMenuOpen ? 'voice-menu-in' : 'voice-menu-out'}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <Hand size={13} className="shrink-0 text-[var(--chat-muted)]" aria-hidden="true" />
                                <span className="truncate text-[11px] font-medium text-[var(--chat-text)]">Hold to record</span>
                              </div>
                              {/* Stays hand-written: a 28 x 16 track with a thumb that grows as it
                                  travels, where `<Switch>` is 36 x 20 with a 14px knob. Smaller than
                                  the component in both directions, and its exact class strings are
                                  pinned by scripts/test-chat-voice-controls.mjs down to the thumb's
                                  travel in pixels. */}
                              <button
                                type="button"
                                data-voice-hold-switch
                                role="switch"
                                aria-checked={voiceInputMode === 'hold'}
                                onClick={() => {
                                  stopVoiceInput();
                                  setVoiceInputMode((mode) => mode === 'hold' ? 'tap' : 'hold');
                                }}
                                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-md border p-[2px] transition-[background-color,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--chat-text)]/40 ${
                                  voiceInputMode === 'hold'
                                    ? 'border-[var(--chat-text)] bg-[var(--chat-text)]'
                                    : 'border-[var(--chat-border)] bg-[var(--chat-canvas)]'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none absolute left-[2px] top-1/2 block rounded-[3px] transition-[transform,background-color,width,height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                                    voiceInputMode === 'hold'
                                      ? 'h-3 w-3 translate-x-[10px] -translate-y-1/2 bg-[var(--chat-elevated)]'
                                      : 'h-2.5 w-2.5 translate-x-0 -translate-y-1/2 bg-[var(--chat-text)]'
                                  }`}
                                />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      {/* Stays hand-written, and it is the one holding the other two here. The
                          normalisation block paints it with `!important` in both states — accent
                          fill and inverted ink when it can send, a muted control fill when it
                          cannot — so every colour a variant would choose is overruled before it
                          renders. Its enabled state is also the inverted emphasis the variant set
                          does not carry (§9). */}
                      <button
                        type="button"
                        data-composer-send-button
                        onClick={handleVoiceSend}
                        className={`flex items-center justify-center transition-[background-color,color,transform,opacity] duration-200 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--chat-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--chat-canvas)] ${inputValue.trim() || attachedFiles.length > 0 ? 'bg-[var(--chat-accent)] text-[var(--chat-on-accent)] hover:opacity-90 motion-safe:animate-send-button-enter' : 'cursor-not-allowed border border-[var(--chat-border)] bg-[var(--chat-control)] text-[var(--chat-muted)]'} ${composerActionButtonSizeClass}`}
                        aria-label="Send message"
                        disabled={!(inputValue.trim() || attachedFiles.length > 0) || isContextLimitReached}
                      >
                        {/* The send arrow was hand-drawn here — stroke 2, round caps — while every other
                            glyph in the composer came from the set at 1.75 with butt caps. It never
                            animated because there was nothing to animate: no `data-glyph`, no parts, no
                            rule to match. It looked like a hover that had been forgotten rather than an
                            icon that had never been one. */}
                        <ArrowUp size={16} />
                      </button>
                    </>
                  )}
                </div>
                </div>
          </div>
          </ChatEmptyState>
          </div>
  );

  return (
    <>
      {/* Add source preview styles */}
      {isOutlineDebugOn() && <style>{OUTLINE_DEBUG_CSS}</style>}
      <style>
        {`
          .hide-scrollbar::-webkit-scrollbar {
            display: none; /* WebKit (Chrome, Safari, Edge) */
          }
          .hide-scrollbar {
            -ms-overflow-style: none;  /* IE and Edge (legacy) */
            scrollbar-width: none;  /* Firefox */
          }

          @keyframes chat-theme-menu-in {
            from { opacity: 0; transform: translateY(-10px) scale(0.9); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes chat-theme-menu-out {
            from { opacity: 1; transform: translateY(0) scale(1); }
            to { opacity: 0; transform: translateY(-8px) scale(0.92); }
          }

          /* The dropdown motion — 👍 / 👎 feedback popovers, the conversation ⋯ menu. One pair for
             every placement: the direction of the travel comes from --chat-menu-pop-dy and the
             corner from transform-origin, both set by the menu from where it was placed, so it
             always collapses back toward the control it came out of.
             (No backticks in this block — it is a template literal, and one would end it.) */
          @keyframes chat-menu-pop-in {
            from { opacity: 0; transform: translateY(var(--chat-menu-pop-dy, -8px)) scale(0.94); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes chat-menu-pop-out {
            from { opacity: 1; transform: translateY(0) scale(1); }
            to { opacity: 0; transform: translateY(var(--chat-menu-pop-dy, -8px)) scale(0.94); }
          }
          @media (prefers-reduced-motion: reduce) {
            @keyframes chat-menu-pop-in {
              from { opacity: 0; transform: none; }
              to { opacity: 1; transform: none; }
            }
            @keyframes chat-menu-pop-out {
              from { opacity: 1; transform: none; }
              to { opacity: 0; transform: none; }
            }
          }

          .chat-themed .chat-top-bar {
            background-color: var(--chat-canvas) !important;
            border-color: var(--chat-border) !important;
            color: var(--chat-text) !important;
          }
          /* One property, where there used to be three. The quiet variant already drops its border
             and brightens its ink when a button is on — the fill is the only part this chat says
             differently, and only because it wants an INSET on the dark themes: a canvas mixed 55%
             toward black, so the pressed button reads as sunk below the surface rather than raised
             above it. On light it is the plain control fill, which is what the variant would have
             given it anyway. */
          .chat-themed .chat-top-bar-btn[data-selection="on"] {
            background-color: var(--chat-top-bar-btn-active) !important;
          }
          /* History edge: use theme border only. Never mix --chat-text into shadow —
             on Dark/Dim that text is near-white and paints a "white glow" (esp. when closed). */
          .chat-themed .chat-history-sidebar,
          .chat-themed.chat-history-sidebar {
            background-color: var(--chat-surface) !important;
            border-color: var(--chat-border) !important;
            color: var(--chat-text) !important;
            box-shadow: none !important;
          }
          /* Light only: history a step darker than white, warm-neutral (no blue cast). */
          .chat-theme-light .chat-history-sidebar,
          .chat-theme-light.chat-history-sidebar {
            background-color: var(--chat-history-fill, #f1f0ee) !important;
            border-color: var(--chat-history-border, rgba(0, 0, 0, 0.10)) !important;
            box-shadow: var(--chat-history-shadow, 0 4px 18px rgba(0, 0, 0, 0.06)) !important;
          }
          /* Claude pinned DnD: .df-drag-shiftable { transition: transform .12s ease-out }
             Recents label is ALSO shiftable — transforms must move it or rows overlap it. */
          .chat-history-sidebar [data-pin-dragging='true'] {
            pointer-events: none;
          }
          @media (prefers-reduced-motion: no-preference) {
            .chat-history-sidebar .history-drag-shiftable {
              transition: transform 0.12s ease-out;
              will-change: transform;
            }
            .chat-history-sidebar .history-pin-section-reveal {
              transition:
                opacity 0.2s cubic-bezier(0.32, 0.72, 0, 1),
                transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .chat-history-sidebar .history-drag-shiftable {
              transition: none !important;
            }
          }
          /* History popovers (kebab, Recents filter + submenus): tight shadow, not shadow-xl. */
          .chat-history-popover {
            box-shadow:
              0 1px 2px rgba(0, 0, 0, 0.10),
              0 2px 4px rgba(0, 0, 0, 0.06) !important;
          }
          .chat-theme-light .chat-history-popover {
            box-shadow:
              0 1px 2px rgba(0, 0, 0, 0.06),
              0 2px 4px rgba(0, 0, 0, 0.04) !important;
          }
          /* The user turn is the library's MessageBubble, and these are the two things this chat wants
             said differently.

             The width is a knob the component publishes rather than a prop, because the answer here is
             a breakpoint: 75 percent of a desktop column reads well, and 75 percent of a phone is a
             ribbon. The media queries further down move the same variable.

             The timestamp fades with the buttons. The component keeps it steady on the grounds that a
             meta row which never empties never shifts the layout — true, and this chat still prefers a
             transcript with no clock under every line until you go looking. Its row holds its height
             either way, so nothing moves. */
          .chat-message-bubble {
            --xeno-message-max: 88%;
          }
          .chat-message-bubble .xeno-message-time {
            opacity: 0;
            transition: opacity 0.18s var(--xeno-ease);
          }
          .chat-message-bubble:hover .xeno-message-time,
          .chat-message-bubble:focus-within .xeno-message-time {
            opacity: 1;
          }
          @media (prefers-reduced-motion: reduce) {
            .chat-message-bubble .xeno-message-time {
              transition: none;
            }
          }
          /* The XENO travelling hover pill (goo.css) in chat ink. The library owns every frame of the
             motion; a menu only has to say what colour its highlight is and how round its rows are.
             The 4px inset the pill defaults to is exactly this panel's p-1, so it lines up already. */
          .chat-goo {
            --xeno-goo-fill: var(--chat-hover);
            --xeno-goo-radius: 6px;
          }
          /* The sidebar's rows are rounded-lg inside a px-1.5 gutter, not rounded-md inside p-1. */
          .chat-goo-sidebar {
            --xeno-goo-inset: 6px;
            --xeno-goo-radius: 8px;
          }
          /* The list host is a wrapper INSIDE the scroller's gutter, so it has none of its own. */
          .chat-goo-list {
            --xeno-goo-inset: 0px;
            --xeno-goo-radius: 8px;
          }
          /* The feedback popovers pad their rows by 8, not the 4 the pill assumes from p-1.
             (No backticks in here: this block is a template literal, and one would end it.) */
          .chat-goo-feedback {
            --xeno-goo-inset: 8px;
            --xeno-goo-radius: 6px;
          }
          .chat-themed [class*="bg-[var(--chat-canvas)]"] { background-color: var(--chat-canvas) !important; }
          /* Ten legacy-hex selectors used to ride along here, one group per token — the fills this
             chat had before it had tokens. Every class they named is gone from the source, so each
             rule was matching nothing while making the block look like it was holding the chat
             together. That mattered: the duplicate below was found by reading a block whose SIZE
             implied every line was load-bearing. scripts/probe-dead-normalisation.mjs counts what
             each selector matches on the running chat and greps the class out of the source, which
             is what separates a dead rule from one whose branch the mock cannot render.
             No backticks in here: this comment lives inside a style template literal (spec 5.4b),
             and that trap has now been walked into twice. */
          .chat-themed [class*="bg-[var(--chat-surface)]"] { background-color: var(--chat-surface) !important; }
          .chat-themed [class*="bg-[var(--chat-elevated)]"] { background-color: var(--chat-elevated) !important; }
          .chat-themed [class*="bg-[var(--chat-control)]"] { background-color: var(--chat-control) !important; }
          /* The bg-[var(--chat-control)] selector was named here TOO, at the same specificity as the
             rule above, so the later one won and every hand-written control fill in the chat painted
             #404040 while its own class said #262626. Measured before removal: 10 of the 11 such
             elements on the empty chat.
             Every other line in this block is either a legacy hex mapped onto a token or a token
             mapped to itself; --chat-control to --chat-control-strong was the only cross-mapping in
             it, and it was the duplicated one. Copy-paste, not intent.
             No backticks in this comment: it lives inside a style template literal (spec 5.4b). */
          .chat-themed [class*="bg-[var(--chat-control-strong)]"] { background-color: var(--chat-control-strong) !important; }
          /* Only bare bg-black* fills — not hover:bg-black/… class substrings. */
          .chat-themed [class~="bg-black"],
          .chat-themed [class*=" bg-black/"],
          .chat-themed [class^="bg-black/"] { background-color: var(--chat-overlay) !important; }
          .chat-themed [data-model-tray] {
            background-color: var(--chat-elevated) !important;
            border-color: var(--chat-border) !important;
            color: var(--chat-text) !important;
          }
          .chat-themed [data-composer-send-button]:not(:disabled) {
            background-color: var(--chat-accent) !important;
            color: var(--chat-on-accent) !important;
          }
          .chat-themed [data-composer-send-button]:disabled {
            background-color: var(--chat-control) !important;
            color: var(--chat-muted) !important;
            border-color: var(--chat-border) !important;
          }
          .chat-themed .xeno-search-container {
            background: var(--chat-surface) !important;
            border-color: var(--chat-border) !important;
            color: var(--chat-text) !important;
          }
          .chat-themed .chat-input-container { box-shadow: var(--chat-input-shadow) !important; }
          /* Outer shell: dark fill. Inner input keeps its own border for definition. */
          .chat-themed [data-chat-composer-shell] {
            background-color: var(--chat-composer-fill, var(--chat-elevated)) !important;
            border-color: var(--chat-border) !important;
            box-shadow: var(--chat-composer-shadow) !important;
          }
          .chat-themed .chat-input-container:not([data-empty-composer-input="true"]) {
            background-color: var(--chat-composer-fill, var(--chat-elevated)) !important;
            border-color: var(--chat-composer-border, var(--chat-border)) !important;
            box-shadow: var(--chat-composer-shadow) !important;
          }
          /* Conversation composer: same width as the message column. It used to shrink the
             box and the mode tabs too, but the composer now has ONE geometry across both
             surfaces (see the composer-reveal metrics block in index.css) — a second set of
             numbers here is what made the conversation composer read as a different design. */
          .chat-themed [data-composer-context="conversation"] .chat-input-controls {
            margin-top: 0.5rem !important;
          }

          /* Nested input: no border of its own. The shell is the single stroked box the
             gooey skin is moulded onto — a second stroke inside it reads as two cards. */
          .chat-themed [data-chat-composer-shell] .chat-input-container,
          .chat-themed [data-chat-composer-shell] .chat-input-container[class*="bg-"],
          .chat-themed [data-chat-composer-shell] .chat-input-container[class*="shadow"] {
            background: transparent !important;
            background-color: transparent !important;
            border-color: transparent !important;
            box-shadow: none !important;
            filter: none !important;
            --tw-shadow: 0 0 #0000 !important;
            --tw-shadow-colored: 0 0 #0000 !important;
            --tw-ring-shadow: 0 0 #0000 !important;
          }
          .chat-themed [data-tool-rail-indicator] {
            background-color: var(--chat-tool-rail-stroke) !important;
            opacity: 0.92 !important;
          }
          .chat-themed [data-tool-rail-echo="medium"] {
            background-color: var(--chat-tool-rail-stroke-soft) !important;
          }
          /* Keep composer controls distinct at every custom theme brightness. */
          .chat-themed .chat-mode-surface {
            background-color: var(--chat-surface) !important;
            border-color: var(--chat-border) !important;
            box-shadow: inset 0 1px 0 color-mix(in srgb, var(--chat-surface-text) 10%, transparent) !important;
          }
          .chat-themed .chat-mode-tab,
          .chat-themed .chat-mode-action,
          .chat-themed .chat-inline-model-action,
          .chat-themed .chat-model-trigger {
            background-color: var(--chat-control) !important;
            border-color: var(--chat-border) !important;
            color: var(--chat-surface-text) !important;
          }
          .chat-themed .chat-mode-tab-selected,
          .chat-themed .chat-inline-model-action[aria-current="true"] {
            background-color: var(--chat-control-strong) !important;
            border-color: var(--chat-border) !important;
            box-shadow: inset 0 1px 0 color-mix(in srgb, var(--chat-surface-text) 14%, transparent) !important;
          }
          .chat-themed .chat-mode-tab:hover,
          .chat-themed .chat-mode-action:hover,
          .chat-themed .chat-inline-model-action:hover,
          .chat-themed .chat-model-trigger:hover {
            background-color: var(--chat-control-strong) !important;
            border-color: var(--chat-border) !important;
          }
          .chat-themed [data-inline-model-scroll="left"] {
            background-image: linear-gradient(to right, var(--chat-surface), transparent) !important;
          }
          .chat-themed [data-inline-model-scroll="right"] {
            background-image: linear-gradient(to left, var(--chat-surface), transparent) !important;
          }
          .chat-theme-slider {
            position: absolute;
            inset: 0;
            z-index: 1;
            width: 100%;
            height: 100%;
            margin: 0;
            opacity: 0;
            cursor: ew-resize;
          }
          .chat-theme-waveform {
            display: grid;
            height: 1.125rem;
            grid-template-columns: repeat(21, minmax(0, 1fr));
            align-items: end;
            gap: 0.1875rem;
            transition: background-color 160ms ease;
          }
          .chat-theme-waveform-bar {
            height: 0.6875rem;
            border-radius: 2px;
            border: 1px solid color-mix(in srgb, var(--chat-text) 14%, transparent);
            opacity: 1;
            transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
          }
          .chat-theme-waveform-bar[data-stop="true"] {
            height: 1.125rem;
          }
          .chat-theme-waveform-bar[data-selected="true"] {
            border-color: var(--chat-text);
            box-shadow: 0 0 0 1px var(--chat-text);
            transform: translateY(-2px);
          }
          .chat-theme-waveform-control:has(.chat-theme-slider:hover) .chat-theme-waveform-bar[data-selected="false"],
          .chat-theme-waveform-control:has(.chat-theme-slider:focus-visible) .chat-theme-waveform-bar[data-selected="false"] {
            transform: translateY(-1px);
          }
          .chat-theme-waveform-control:has(.chat-theme-slider:focus-visible) {
            outline: 1px solid var(--chat-text);
            outline-offset: 3px;
          }
          .chat-themed [class*="text-[var(--chat-text)]"],
          .chat-themed [class*="text-[var(--chat-text)]"],
          .chat-themed [class*="text-[var(--chat-text)]"],
          .chat-themed [class*="text-[var(--chat-text)]"],
          .chat-themed [class*="text-[var(--chat-text)]"] { color: var(--chat-text) !important; }
          .chat-themed [class*="text-[var(--chat-muted)]"],
          .chat-themed [class*="text-[var(--chat-muted)]"],
          .chat-themed [class*="text-[var(--chat-muted)]"],
          .chat-themed [class*="text-[var(--chat-muted)]"],
          .chat-themed [class*="text-[var(--chat-muted)]"] { color: var(--chat-muted) !important; }
          .chat-themed [class*="placeholder:text-gray"]::placeholder,
          .chat-themed [class*="placeholder:text-zinc"]::placeholder {
            color: var(--chat-muted) !important;
            opacity: 0.9 !important;
          }
          .chat-themed [data-chat-composer-shell] [class*="text-[var(--chat-text)]"],
          .chat-themed [data-chat-composer-shell] [class*="text-[var(--chat-text)]"],
          .chat-themed [data-chat-composer-shell] [class*="text-[var(--chat-text)]"],
          .chat-themed [data-chat-composer-shell] [class*="text-[var(--chat-text)]"],
          .chat-themed [data-chat-composer-shell] [class*="text-[var(--chat-text)]"] { color: var(--chat-surface-text) !important; }
          .chat-themed [data-chat-composer-shell] [class*="text-[var(--chat-muted)]"],
          .chat-themed [data-chat-composer-shell] [class*="text-[var(--chat-muted)]"],
          .chat-themed [data-chat-composer-shell] [class*="text-[var(--chat-muted)]"],
          .chat-themed [data-chat-composer-shell] [class*="text-[var(--chat-muted)]"],
          .chat-themed [data-chat-composer-shell] [class*="text-[var(--chat-muted)]"],
          .chat-themed [data-chat-composer-shell] [class*="placeholder:text-gray"]::placeholder,
          .chat-themed [data-chat-composer-shell] [class*="placeholder:text-zinc"]::placeholder {
            color: var(--chat-surface-muted) !important;
          }
          /* The border-[var(--chat-border)] selector was listed TWICE in this one rule — harmless,
             since both copies said the same thing, but it is the same copy-paste that produced the
             --chat-control duplicate two rules up, where the two copies DISAGREED and one of them
             repainted every control fill in the chat. Worth deleting for that reason alone. */
          .chat-themed [class*="border-[var(--chat-border)]"] { border-color: var(--chat-border) !important; }
          .chat-themed [class*="hover:bg-black"]:hover,
          .chat-themed [class*="hover:bg-[var(--chat-control)]"]:hover,
          .chat-themed [class*="hover:bg-[var(--chat-control-strong)]"]:hover { background-color: var(--chat-hover) !important; }
          .chat-themed .prose h1,
          .chat-themed .prose h2,
          .chat-themed .prose h3,
          .chat-themed .prose strong { color: var(--chat-text) !important; }
          
          /* Add new styles for inline source citations */
          .inline-source-citation {
            display: inline-flex;
            font-size: 0.75rem; /* text-xs */
            color: var(--chat-accent);
            font-weight: 500; /* font-medium */
            margin-left: 0.25rem; /* ml-1 */
          }
          
          /* Style for highlighted source text segments */
          .source-highlight {
            position: relative;
            background-color: var(--chat-accent-soft);
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
          /* Pre background lives here — not as prose-pre:bg-* on the wrapper
             (theme [class*="bg-…"] would otherwise paint the whole answer). */
          .chat-themed .prose pre {
            background-color: var(--chat-elevated) !important;
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

          /* Blinking caret shown at the end of the answer while it types out. */
          .chat-caret {
            display: inline-block;
            width: 2px;
            height: 1.05em;
            margin-left: 2px;
            vertical-align: text-bottom;
            background: currentColor;
            opacity: 0.75;
            animation: chat-caret-blink 1s steps(2, start) infinite;
          }
          @keyframes chat-caret-blink {
            50% { opacity: 0; }
          }

          /* Voice-mode ("Hold to record") popover — appear/disappear. */
          .voice-menu-in {
            transform-origin: bottom right;
            animation: voice-menu-in 150ms cubic-bezier(0.32, 0.72, 0, 1) forwards;
          }
          .voice-menu-out {
            transform-origin: bottom right;
            animation: voice-menu-out 150ms cubic-bezier(0.32, 0.72, 0, 1) forwards;
          }
          @keyframes voice-menu-in {
            from { opacity: 0; transform: translateY(6px) scale(0.96); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes voice-menu-out {
            from { opacity: 1; transform: translateY(0) scale(1); }
            to { opacity: 0; transform: translateY(6px) scale(0.96); }
          }

          /* Gradual expand/collapse for Thoughts, sources, and other
             "what went into the answer" panels — animates height via the grid
             0fr→1fr trick (opens AND closes smoothly, no unmount). */
          .chat-collapsible {
            display: grid;
            grid-template-rows: 0fr;
            transition: grid-template-rows 520ms cubic-bezier(0.32, 0.72, 0, 1);
          }
          .chat-collapsible-open {
            grid-template-rows: 1fr;
          }
          .chat-collapsible-inner {
            overflow: hidden;
            min-height: 0;
          }
          /* The content itself fades + slides so the text visibly appears and
             disappears (not just the row height changing). */
          .chat-collapsible-content {
            opacity: 0;
            transform: translateY(-8px);
            transition:
              opacity 460ms ease,
              transform 520ms cubic-bezier(0.32, 0.72, 0, 1);
          }
          .chat-collapsible-open .chat-collapsible-content {
            opacity: 1;
            transform: translateY(0);
          }
          @media (prefers-reduced-motion: reduce) {
            .chat-collapsible,
            .chat-collapsible-content {
              transition: none;
            }
          }

          /* Markdown prose follows the chat theme (dark/dim/light), monochrome. */
          .chat-themed .prose {
            --tw-prose-body: var(--chat-text);
            --tw-prose-headings: var(--chat-text);
            --tw-prose-links: var(--chat-text);
            --tw-prose-bold: var(--chat-text);
            --tw-prose-counters: var(--chat-muted);
            --tw-prose-bullets: var(--chat-muted);
            --tw-prose-hr: var(--chat-border);
            --tw-prose-quotes: var(--chat-muted);
            --tw-prose-quote-borders: var(--chat-border);
            --tw-prose-captions: var(--chat-muted);
            --tw-prose-code: var(--chat-text);
            --tw-prose-pre-code: var(--chat-text);
            --tw-prose-pre-bg: transparent;
            --tw-prose-th-borders: var(--chat-border);
            --tw-prose-td-borders: var(--chat-border);
            color: var(--chat-text);
          }
          .chat-themed .prose a { text-decoration-color: var(--chat-border); }
          .chat-themed .prose blockquote {
            color: var(--chat-muted);
            border-left-color: var(--chat-border);
            font-style: normal;
          }
          .chat-themed .prose table {
            border: 1px solid var(--chat-border);
            border-radius: 10px;
            overflow: hidden;
          }
          .chat-themed .prose thead { border-bottom-color: var(--chat-border); }
          .chat-themed .prose th {
            background: var(--chat-surface);
            color: var(--chat-text);
            font-weight: 600;
          }
          .chat-themed .prose th,
          .chat-themed .prose td { border-color: var(--chat-border); }

          /* Generating indicator — three small XENO cubes (outline squares),
             each with the same spin + breathe animation, staggered. */
          .xeno-gen-dots { display: inline-flex; align-items: center; gap: 4px; }
          .xeno-gen-dots i {
            width: 9px; height: 9px; border-radius: 2px;
            border: 1.5px solid currentColor; box-sizing: border-box; background: transparent;
            animation: xeno-gen-cube 1.6s ease-in-out infinite;
          }
          .xeno-gen-dots i:nth-child(2) { animation-delay: 0.22s; }
          .xeno-gen-dots i:nth-child(3) { animation-delay: 0.44s; }
          @keyframes xeno-gen-cube {
            0% { transform: rotate(0deg) scale(1); }
            50% { transform: rotate(180deg) scale(0.5); }
            100% { transform: rotate(360deg) scale(1); }
          }
          @media (prefers-reduced-motion: reduce) {
            .xeno-gen-dots i { animation: none; }
          }

          /* Scroll-to-latest chevron gently bounces up/down. */
          .xeno-chevron-bounce { animation: xeno-chevron-bounce 1.3s ease-in-out infinite; }
          @keyframes xeno-chevron-bounce {
            0%, 100% { transform: translateY(-1px); }
            50% { transform: translateY(2px); }
          }
          @media (prefers-reduced-motion: reduce) {
            .xeno-chevron-bounce { animation: none; }
          }

          /* AI message-header cube — a small filled square that pops in ("fills")
             when the answer appears (the spin happens earlier, in the placeholder). */
          .xeno-model-cube {
            width: 11px; height: 11px; border-radius: 3px; flex-shrink: 0;
            background: var(--chat-muted); box-sizing: border-box;
            position: relative; top: 1px;
            animation: xeno-model-cube-in 0.5s cubic-bezier(0.34, 1.4, 0.5, 1) both;
          }
          @keyframes xeno-model-cube-in {
            0% { transform: scale(0.35); opacity: 0; }
            60% { transform: scale(1.12); }
            100% { transform: scale(1); opacity: 1; }
          }
          @media (prefers-reduced-motion: reduce) {
            .xeno-model-cube { animation: none; }
          }

          /* Xeno Sources — bare / minimalist (lab style): no card, just a small
             "Sources" label + inline links. Theme-aware. */
          .xeno-sources-container {
            background: transparent;
            border: 0;
            border-radius: 0;
            overflow: visible;
            box-shadow: none;
          }

          .xeno-sources-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 2px 0 6px;
            cursor: pointer;
            transition: color 0.15s ease;
            border-bottom: 0;
          }

          .xeno-sources-header:hover .xeno-sources-title { color: var(--chat-text); }

          .xeno-sources-icon { display: none; }

          .xeno-sources-title {
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--chat-muted);
          }

          .xeno-sources-list {
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            max-height: 280px;
            overflow-y: auto;
          }

          .xeno-source-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            border-radius: 8px;
            background: transparent;
            border: 1px solid transparent;
            transition: background-color 0.15s ease, border-color 0.15s ease;
            text-decoration: none;
          }

          .xeno-source-item:hover {
            background: var(--chat-hover);
            border-color: var(--chat-border);
          }

          .xeno-source-favicon {
            width: 30px;
            height: 30px;
            border-radius: 7px;
            background: var(--chat-elevated);
            border: 1px solid var(--chat-border);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            overflow: hidden;
            color: var(--chat-muted);
          }

          .xeno-source-number {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 700;
            background: var(--chat-hover);
            color: var(--chat-muted);
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
              padding-top: 0.5rem !important;
              padding-bottom: 0.5rem !important;
              padding-left: 0 !important;
              padding-right: 0 !important;
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
            .chat-system-prompt-btn {
              width: 2.5rem !important;
              padding: 0.375rem !important;
            }
            .chat-system-prompt-btn span {
              display: none !important;
            }
            .chat-message-bubble {
              --xeno-message-max: 96%;
            }
            .chat-message-editor {
              max-width: 96% !important;
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
              --xeno-message-max: 98%;
            }
            .chat-message-editor {
              max-width: 98% !important;
            }
            .chat-top-bar {
              padding-top: 0.375rem !important;
              padding-bottom: 0.375rem !important;
              padding-left: 0 !important;
              padding-right: 0 !important;
            }
          }
        `}
      </style>
      {/* Main container with conditional padding for context panel and history sidebar */}
      <div
        ref={chatContainerRef}
        className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} relative flex h-full flex-col overflow-hidden main-content-transition ${isMobile ? 'chat-mobile-container' : ''} ${isMobile && isHistoryOpen ? 'chat-sidebar-open' : ''}`}
        data-chat-theme-preference={chatTheme}
        style={{
          paddingRight: '0px',
          backgroundColor: 'var(--chat-canvas)',
          color: 'var(--chat-text)',
          ...chatThemePreviewStyle,
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Always above Projects/catalog overlays (z-45) when history is closed.
            Wait for sidebar close (300ms), then enter left → right. */}
        {!isMultiInterface && showClosedHistoryChrome && (
          <div
            key={`closed-history-chrome-${closedHistoryChromeEnterKey}`}
            className="absolute z-[60] flex h-9 items-center gap-1.5 text-[var(--chat-text)]"
            style={{ top: CHAT_CHROME_TOP_INSET_PX, left: CHAT_CHROME_EDGE_INSET_PX }}
          >
            <IconButton
              icon={PanelLeftOpenDecl}
              variant="quiet"
              size="lg"
              iconSize={16}
              onClick={() => setIsHistoryOpen(true)}
              aria-label="Open conversation history"
              title="Open history"
            />
            {/* Stays hand-written: a brand mark, not a control. It is set in the DISPLAY face at
                1.05rem, and every button component here imposes the control font and the control
                type scale — taking one would silently re-set the wordmark. The box is a 36px band
                with 4px of side padding, which is no step on the scale either. */}
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('toggle_overview_taskbar'));
              }}
              aria-label={isTaskbarHidden ? 'Show toolbar' : 'Hide toolbar'}
              title={isTaskbarHidden ? 'Show toolbar' : 'Hide toolbar'}
              className="animate-chat-history-chrome-enter-delay flex h-9 items-center px-1 font-display text-[1.05rem] font-semibold tracking-tight text-[var(--chat-text)]/80 transition-colors hover:text-[var(--chat-text)] active:scale-[0.98]"
            >
              XENO
            </button>
            {isProjectsPageOpen && (
              <span
                className="animate-chat-history-chrome-enter-delay -ml-1 flex h-9 items-center font-display text-[1.05rem] font-medium leading-normal tracking-tight text-[var(--chat-muted)]"
                aria-current="page"
              >
                Projects
              </span>
            )}
            {isArtifactsPageOpen && (
              <span
                className="animate-chat-history-chrome-enter-delay -ml-1 flex h-9 items-center font-display text-[1.05rem] font-medium leading-normal tracking-tight text-[var(--chat-muted)]"
                aria-current="page"
              >
                Artifacts
              </span>
            )}
            {isGlobalSettingsPageOpen && (
              <span
                className="animate-chat-history-chrome-enter-delay -ml-1 flex h-9 items-center font-display text-[1.05rem] font-medium leading-normal tracking-tight text-[var(--chat-muted)]"
                aria-current="page"
              >
                Settings
              </span>
            )}
            {isScheduledPageOpen && (
              <span
                className="animate-chat-history-chrome-enter-delay -ml-1 flex h-9 items-center font-display text-[1.05rem] font-medium leading-normal tracking-tight text-[var(--chat-muted)]"
                aria-current="page"
              >
                Scheduled
              </span>
            )}
          </div>
        )}
        {isChatsCatalogOpen && (() => {
          const catalogQuery = chatsCatalogSearch.trim().toLowerCase();
          const catalogFilterLabels: Record<ChatsCatalogFilter, string> = {
            all: 'All',
            chat: 'Chat',
            shared: 'Shared',
            cowork: 'Cowork',
            archived: 'Archived',
          };
          const catalogConversations = [...conversationHistory]
            .filter((convo) => {
              if (chatsCatalogFilter === 'archived') {
                if (!convo.isArchived) return false;
              } else if (chatsCatalogFilter === 'shared' || chatsCatalogFilter === 'cowork') {
                // Not modeled yet — keep the menu real, list empty until we have those types.
                return false;
              } else {
                // All / Chat: active chats only
                if (convo.isArchived) return false;
              }
              if (!catalogQuery) return true;
              return convo.title.toLowerCase().includes(catalogQuery);
            })
            .sort((a, b) => b.timestamp - a.timestamp);
          const selectedCount = chatsCatalogSelectedIds.length;
          const catalogLeft =
            !isMultiInterface && isHistoryOpen && !isMobile ? 260 : 0;
          const exitCatalogSelection = () => {
            setIsChatsCatalogSelecting(false);
            setChatsCatalogSelectedIds([]);
          };
          // Match chat control radius (rounded-lg) — not pills, not sharp squares.
          const catalogControlBtn =
            'rounded-lg px-3 py-1.5 text-[12.5px] transition-colors';

          return (
            <div
              className="absolute inset-0 z-[45] flex flex-col"
              style={{
                left: catalogLeft,
                backgroundColor: 'var(--chat-canvas)',
                color: 'var(--chat-text)',
              }}
              role="dialog"
              aria-label="Chats and tasks"
            >
              {/* Centered column — Claude-style: content sits mid-viewport, not edge-to-edge */}
              <div className="mx-auto flex h-full w-full max-w-[48rem] flex-col px-4 sm:px-6">
                <div className="flex flex-shrink-0 items-center justify-between gap-3 pt-6 pb-3 md:pt-8">
                  <div className="flex min-w-0 items-center gap-2">
                    <IconButton
                      icon={ArrowRightDecl}
                      className="chat-icon-flip-x"
                      variant="ghost"
                      size="md"
                      iconSize={16}
                      onClick={() => {
                        setIsChatsCatalogOpen(false);
                        exitCatalogSelection();
                        setIsChatsCatalogFilterOpen(false);
                      }}
                      aria-label="Close chats and tasks"
                      title="Back"
                    />
                    <h2 className="truncate text-[1.5rem] font-medium tracking-tight text-[var(--chat-text)] md:text-[1.75rem]">
                      Chats and tasks
                    </h2>
                  </div>

                  {isChatsCatalogSelecting ? (
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <span className="text-[13px] text-[var(--chat-muted)]">
                        {selectedCount} selected
                      </span>
                      {/* Stays hand-written. This row carries FOUR levels of emphasis and the
                          variant set carries one of them: Select and Filter by are plain and have
                          converted; this one wears an inset --chat-accent ring to say it is the
                          active selection action, New is inverted, Delete is a solid danger fill.
                          A ringed secondary is not a variant, and adding the ring back as a class
                          would be typing appearance at a call site to make up for it. Same §9 gap
                          as the dialog confirms, seen here as a whole row at once. */}
                      <button
                        type="button"
                        onClick={() => {
                          const visibleIds = catalogConversations.map((convo) => convo.id);
                          const allSelected =
                            visibleIds.length > 0 &&
                            visibleIds.every((id) => chatsCatalogSelectedIds.includes(id));
                          setChatsCatalogSelectedIds(allSelected ? [] : visibleIds);
                        }}
                        className={catalogControlBtn}
                        style={{
                          backgroundColor: 'var(--chat-control)',
                          color: 'var(--chat-text)',
                          boxShadow: 'inset 0 0 0 1px var(--chat-accent)',
                        }}
                      >
                        Select all
                      </button>
                      {/* `danger solid md`, at the size its converted row-mates already use. The
                          `#ffffff` goes with it — a literal white that no chat token named, which
                          this comment had flagged as its own small thing to fix. The variant inks
                          from `--xeno-text`, so it follows the theme: in light mode that literal was
                          white ink on a red fill where the rest of the chat had inverted. */}
                      {selectedCount > 0 && (
                        <Button
                          variant="danger"
                          emphasis="solid"
                          size="md"
                          onClick={() => {
                            const ids = [...chatsCatalogSelectedIds];
                            void (async () => {
                              for (const id of ids) {
                                await handleDeleteConversation(id);
                              }
                              exitCatalogSelection();
                            })();
                          }}
                        >
                          Delete
                        </Button>
                      )}
                      <IconButton
                        icon={XDecl}
                        variant="secondary"
                        size="md"
                        iconSize={14}
                        onClick={exitCatalogSelection}
                        aria-label="Exit selection"
                        title="Close"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {/* `secondary sm` — a `--chat-control` fill with text ink, and 27px of box
                          rounds to sm, whose 13px type is nearest the 12.5 here. It gains the
                          variant's hairline, the trade every other filled control in this chat
                          took. */}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setIsChatsCatalogSelecting(true);
                          setChatsCatalogSelectedIds([]);
                          setIsChatsCatalogFilterOpen(false);
                        }}
                      >
                        Select
                      </Button>
                      <div className="relative">
                        {/* Select's twin, and the two-tone label rides along as children: a muted
                            "Filter by" beside the chosen value in full ink. The component sets the
                            button's colour and each span still says its own. */}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setIsChatsCatalogFilterOpen((open) => !open)}
                          trailingIcon={ChevronDownDecl}
                          iconSize={13}
                          aria-haspopup="menu"
                          aria-expanded={isChatsCatalogFilterOpen}
                        >
                          <span className="text-[var(--chat-muted)]">Filter by</span>
                          <span className="font-medium text-[var(--chat-text)]">
                            {catalogFilterLabels[chatsCatalogFilter]}
                          </span>
                        </Button>
                        {isChatsCatalogFilterOpen && (
                          <div
                            {...(() => { const { ref: _g, className: _c, ...handlers } = catalogFilterGoo.hostProps; return handlers; })()}
                            {...catalogFilterMenuKbd.menuProps}
                            className={`${catalogFilterGoo.hostProps.className} chat-goo chat-history-popover absolute left-0 top-full z-10 mt-1.5 w-[9.5rem] overflow-hidden rounded-xl border p-1`}
                            style={{
                              backgroundColor: 'var(--chat-elevated)',
                              borderColor: 'var(--chat-border)',
                            }}
                          >
                            {/* First child, so the pill paints behind the rows rather than over them. */}
                            {catalogFilterGoo.pill}
                            {(
                              [
                                ['all', 'All'],
                                ['chat', 'Chat'],
                                ['shared', 'Shared'],
                                ['cowork', 'Cowork'],
                                ['archived', 'Archived'],
                              ] as const
                            ).map(([value, label]) => (
                              <MenuItem
                                key={value}
                                selected={chatsCatalogFilter === value}
                                onSelect={() => {
                                  setChatsCatalogFilter(value);
                                  setIsChatsCatalogFilterOpen(false);
                                }}
                              >
                                {label}
                              </MenuItem>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* `primary md`, at the size its row-mates already use. The bridge carries the
                          chrome tokens, so the reason recorded here is answered — this row's four
                          emphases are now three variants and one ring. */}
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => {
                          handleNewChat();
                          setIsChatsCatalogOpen(false);
                          exitCatalogSelection();
                          setIsChatsCatalogFilterOpen(false);
                        }}
                      >
                        New
                      </Button>
                    </div>
                  )}
                </div>

                <div className="flex-shrink-0 pb-3">
                  <div
                    className="flex items-center gap-2 rounded-lg px-3 py-2.5"
                    style={{ backgroundColor: 'var(--chat-control)' }}
                  >
                    {/* Stays hand-written, and for a second reason on top of the fill. The BOX here
                        is the wrapper — a `--chat-control` plate with its own padding — and the input
                        is bare inside it. `TextInput` is the box AND the field together, so taking it
                        means replacing the wrapper too, and the wrapper is what carries this panel's
                        fill. Same collision as above, reached from the other side. */}
                    <Search size={15} className="flex-shrink-0 text-[var(--chat-muted)]" />
                    <input
                      type="search"
                      value={chatsCatalogSearch}
                      onChange={(event) => setChatsCatalogSearch(event.target.value)}
                      placeholder="Search chats and tasks..."
                      className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--chat-text)] placeholder:text-[var(--chat-muted)] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pb-8 hide-scrollbar">
                  {catalogConversations.length === 0 ? (
                    <p className="py-10 text-center text-[13px] text-[var(--chat-muted)]">
                      No matching conversations
                    </p>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {catalogConversations.map((convo) => {
                        const isSelected = chatsCatalogSelectedIds.includes(convo.id);
                        const menuOpen =
                          isHistoryRowMenuOpen &&
                          historyRowMenu?.conversationId === convo.id;
                        return (
                          <div
                            key={convo.id}
                            className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                              menuOpen
                                ? 'bg-[var(--chat-hover)]'
                                : 'hover:bg-[var(--chat-hover)]'
                            }`}
                          >
                            {/* Stays hand-written — the recent-file row's shape exactly: a
                                clickable body with an action beside it, where `ListRow` would want to
                                be the whole row and renders its trailing slot inside its own button.
                                This one also swaps its leading glyph for a checkbox while the catalog
                                is selecting, which is a second thing the leading slot would have to
                                carry a state for. */}
                            <button
                              type="button"
                              onClick={() => {
                                if (isChatsCatalogSelecting) {
                                  setChatsCatalogSelectedIds((prev) =>
                                    prev.includes(convo.id)
                                      ? prev.filter((id) => id !== convo.id)
                                      : [...prev, convo.id],
                                  );
                                  return;
                                }
                                void handleLoadConversation(convo.id);
                                setIsChatsCatalogOpen(false);
                              }}
                              className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            >
                              {isChatsCatalogSelecting ? (
                                <span
                                  className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border"
                                  style={
                                    isSelected
                                      ? {
                                          borderColor: 'var(--chat-accent)',
                                          backgroundColor: 'var(--chat-accent-soft)',
                                        }
                                      : {
                                          borderColor: 'var(--chat-border)',
                                          backgroundColor: 'transparent',
                                        }
                                  }
                                  aria-hidden="true"
                                >
                                  {isSelected && (
                                    <Check size={11} className="text-[var(--chat-accent)]" />
                                  )}
                                </span>
                              ) : (
                                <MessageSquare
                                  size={15}
                                  className="flex-shrink-0 text-[var(--chat-muted)]"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--chat-text)]">
                                {convo.title}
                              </span>
                            </button>
                            {!isChatsCatalogSelecting && (
                              <div className="relative flex h-7 w-[4.5rem] flex-shrink-0 items-center justify-end">
                                <span
                                  className={`pointer-events-none w-full whitespace-nowrap text-right text-[12px] tabular-nums text-[var(--chat-muted)] transition-opacity ${
                                    menuOpen
                                      ? 'opacity-0'
                                      : 'opacity-100 group-hover:opacity-0'
                                  }`}
                                >
                                  {formatConversationListDate(convo.timestamp)}
                                </span>
                                <IconButton
                                  icon={MoreVerticalDecl}
                                  variant="ghost"
                                  size="sm"
                                  iconSize={15}
                                  data-history-row-menu-trigger=""
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    const menuWidth = 188;
                                    const left = Math.min(
                                      Math.max(8, rect.right - menuWidth),
                                      window.innerWidth - menuWidth - 8,
                                    );
                                    toggleHistoryRowMenu(convo.id, rect.bottom + 4, left);
                                  }}
                                  aria-label="Conversation actions"
                                  aria-haspopup="menu"
                                  aria-expanded={menuOpen}
                                  title="More options"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
        {isProjectsPageOpen && (() => {
          const pageLeft =
            !isMultiInterface && isHistoryOpen && !isMobile ? 260 : 0;
          const query = projectsPageSearch.trim().toLowerCase();
          const sortLabels: Record<ProjectsSort, string> = {
            updated: 'Last updated',
            created: 'Date created',
            name: 'Name',
          };
          const visibleProjects = [...chatProjects]
            .filter((project) =>
              query ? project.name.toLowerCase().includes(query) : true,
            )
            .sort((a, b) => {
              if (projectsSort === 'name') {
                return a.name.localeCompare(b.name);
              }
              if (projectsSort === 'created') {
                return b.createdAt - a.createdAt;
              }
              const aUpdated = a.updatedAt ?? a.createdAt;
              const bUpdated = b.updatedAt ?? b.createdAt;
              return bUpdated - aUpdated;
            });
          const pageControlBtn =
            'rounded-lg px-3 py-1.5 text-[12.5px] transition-colors';

          return (
            <div
              className="absolute inset-0 z-[45] flex flex-col main-content-transition"
              style={{
                left: pageLeft,
                backgroundColor: 'var(--chat-canvas)',
                color: 'var(--chat-text)',
              }}
              role="dialog"
              aria-label="Projects"
            >
              <div className="mx-auto flex h-full w-full max-w-[48rem] flex-col px-4 sm:px-6">
                {/* Keep the same top band as the old title row so search + cards do not jump up. */}
                <div className="flex min-h-[2.75rem] flex-shrink-0 items-center justify-between gap-3 pt-6 pb-5 md:min-h-[3rem] md:pt-8 md:pb-6">
                  <div className="relative">
                    {/* The third sort trigger, and the first one to convert on the day it was
                        written: the artifacts and scheduled pages carried this same control through
                        two passes as unconvertible, which is what put `iconReveal` in the library.
                        Twenty lines of padding, translate and z-index go with it. */}
                    <Button
                      variant="secondary"
                      size="sm"
                      iconSize={13}
                      iconReveal
                      leadingIcon={ChevronDownDecl}
                      onClick={() => setIsProjectsSortOpen((open) => !open)}
                      aria-haspopup="menu"
                      aria-expanded={isProjectsSortOpen}
                      aria-label={`Sort by ${sortLabels[projectsSort]}`}
                    >
                      {sortLabels[projectsSort]}
                    </Button>
                    {isProjectsSortOpen && (
                      <div
                        {...(() => { const { ref: _g, className: _c, ...handlers } = projectsSortGoo.hostProps; return handlers; })()}
                        {...projectsSortMenuKbd.menuProps}
                        className={`${projectsSortGoo.hostProps.className} chat-goo chat-history-popover absolute left-0 top-full z-10 mt-1.5 min-w-full w-max overflow-hidden rounded-xl border p-1`}
                        style={{
                          backgroundColor: 'var(--chat-elevated)',
                          borderColor: 'var(--chat-border)',
                          boxShadow:
                            '0 12px 28px -8px color-mix(in srgb, var(--chat-text) 18%, transparent)',
                        }}
                      >
                        {/* First child, so the pill paints behind the rows rather than over them. */}
                        {projectsSortGoo.pill}
                        {(
                          [
                            ['updated', 'Last updated'],
                            ['created', 'Date created'],
                            ['name', 'Name'],
                          ] as const
                        ).map(([value, label]) => (
                          <MenuItem
                            key={value}
                            selected={projectsSort === value}
                            onSelect={() => {
                              setProjectsSort(value);
                              setIsProjectsSortOpen(false);
                            }}
                          >
                            {label}
                          </MenuItem>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* `primary sm` with the reveal's MIRROR — the last control in this chat that
                      needed TWO library gaps closed before it could convert, and the reason its
                      comment said "one job rather than two". The fill is `--chat-text` on
                      `--chat-canvas`, which is `primary` now that the bridge carries the chrome
                      tokens; the glyph waits under the end of the label and travels right, which is
                      `iconReveal="trailing"`.
                      Everything below was this button drawing both by hand: a `group` with an
                      absolutely-placed glyph, `-translate-x-5` and `group-hover:` twins for the
                      travel, `hover:pr-8` for the box, a label span given its own background so the
                      glyph had something to hide behind, and two 600ms transitions written out. The
                      600ms is the component's own `--xeno-btn-reveal-dur`.
                      `iconSize={13}` keeps the glyph where it was — sm draws 16. */}
                  <Button
                    variant="primary"
                    size="sm"
                    iconReveal="trailing"
                    trailingIcon={FolderDecl}
                    iconSize={13}
                    className="flex-shrink-0"
                    onClick={() => openCreateProjectModal()}
                  >
                    New project
                  </Button>
                </div>

                <div className="flex-shrink-0 pb-5 md:pb-6">
                  <div
                    className="flex items-center gap-2 rounded-lg px-3 py-2.5"
                    style={{
                      backgroundColor: 'var(--chat-control)',
                      boxShadow: 'inset 0 0 0 1px var(--chat-border)',
                    }}
                  >
                    {/* Stays hand-written — the chats catalog search's twin, one page over and
                        built the same way: the BOX is the wrapper, a `--chat-control` plate carrying
                        its own padding and inset border, and the field is bare inside it. Taking
                        `TextInput`, which is box and field together, means replacing the plate. */}
                    <Search size={15} className="flex-shrink-0 text-[var(--chat-muted)]" />
                    <input
                      type="search"
                      value={projectsPageSearch}
                      onChange={(event) => setProjectsPageSearch(event.target.value)}
                      placeholder="Search projects..."
                      className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--chat-text)] placeholder:text-[var(--chat-muted)] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pb-8 hide-scrollbar">
                  {chatProjects.length === 0 ? (
                    <div className="flex h-full min-h-[18rem] flex-col items-center justify-center px-4 text-center">
                      <svg
                        width="72"
                        height="72"
                        viewBox="0 0 72 72"
                        fill="none"
                        aria-hidden="true"
                        className="mb-5 text-[var(--chat-text)]"
                      >
                        <rect x="14" y="14" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.75" />
                        <rect x="40" y="14" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.75" />
                        <rect x="14" y="40" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.75" />
                        <rect x="40" y="40" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.75" fill="currentColor" fillOpacity="0.12" />
                        <path
                          d="M48 52c2.8 1.6 6.2 3.4 8.8 4.2 1.4.4 2.4-.6 2-2-.8-2.6-2.2-6.2-3.4-9.2"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                        />
                        <path
                          d="M46.5 49.5c1.2 2.4 2.2 4.2 2.2 4.2s2.2-.2 4.4-1.4"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle cx="47.5" cy="47.5" r="2.2" fill="currentColor" />
                      </svg>
                      <h3 className="text-[1.05rem] font-semibold tracking-tight text-[var(--chat-text)]">
                        Looking to start a project?
                      </h3>
                      <p className="mt-2 max-w-[22rem] text-[13px] leading-relaxed text-[var(--chat-muted)]">
                        Upload materials, set custom instructions, and organize conversations in one space.
                      </p>
                      {/* `secondary md` — a `--chat-control` fill with text ink, 32px of box, and
                          it gains the variant's hairline. The same conversion as the create-project
                          dialog's Cancel, which is the button this one leads to. */}
                      <Button
                        variant="secondary"
                        size="md"
                        className="mt-5"
                        onClick={() => openCreateProjectModal()}
                      >
                        New project
                      </Button>
                    </div>
                  ) : visibleProjects.length === 0 ? (
                    <p className="py-10 text-center text-[13px] text-[var(--chat-muted)]">
                      No matching projects
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {visibleProjects.map((project) => {
                        const stamp = project.updatedAt ?? project.createdAt;
                        const description =
                          project.description?.trim() || 'No description yet';
                        return (
                          <div
                            key={project.id}
                            className="group relative flex h-[12.5rem] min-w-0 cursor-pointer flex-col rounded-[10px] border p-1.5 text-left transition-[transform,background-color,border-color] duration-150 ease-out active:scale-[0.98]"
                            style={{
                              backgroundColor: 'color-mix(in srgb, var(--chat-canvas) 88%, var(--chat-muted))',
                              borderColor: 'color-mix(in srgb, var(--chat-canvas) 74%, var(--chat-muted))',
                            }}
                            onContextMenu={() => setSuppressCardOverlayId(project.id)}
                            onMouseLeave={() => setSuppressCardOverlayId(null)}
                            onClick={() => openProject(project.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openProject(project.id);
                              }
                            }}
                          >
                            <div className="flex items-center justify-between gap-2 py-1 pl-2 pr-0.5">
                              <div
                                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                title={project.name}
                              >
                                {project.isStarred && (
                                  <Star
                                    size={13}
                                    className="flex-shrink-0 fill-current text-[var(--chat-accent)]"
                                    aria-hidden="true"
                                  />
                                )}
                                <span className="truncate text-[13px] font-semibold leading-snug tracking-tight text-[var(--chat-text)]">
                                  {project.name}
                                </span>
                                {project.isArchived && (
                                  <span className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--chat-muted)]" style={{ backgroundColor: 'var(--chat-canvas)' }}>
                                    Archived
                                  </span>
                                )}
                              </div>
                              <div className="relative flex-shrink-0" data-project-card-menu>
                                <IconButton
                                  icon={MoreVerticalDecl}
                                  variant="ghost"
                                  size="sm"
                                  iconSize={15}
                                  aria-label={`More options for ${project.name}`}
                                  aria-haspopup="menu"
                                  aria-expanded={openProjectMenuId === project.id}
                                  title="More"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setOpenProjectMenuId((current) =>
                                      current === project.id ? null : project.id,
                                    );
                                  }}
                                />
                                {openProjectMenuId === project.id && (
                                  <div
                                    {...(() => { const { ref: _g, className: _c, ...handlers } = projectMenuGoo.hostProps; return handlers; })()}
                                    {...projectMenuKbd.menuProps}
                                    className={`${projectMenuGoo.hostProps.className} chat-goo absolute right-0 top-full z-20 mt-1.5 w-[8.5rem] overflow-hidden rounded-xl border p-1`}
                                    style={{
                                      backgroundColor: 'var(--chat-elevated)',
                                      borderColor: 'var(--chat-border)',
                                      boxShadow:
                                        '0 12px 28px -8px color-mix(in srgb, var(--chat-text) 18%, transparent)',
                                    }}
                                  >
                                    {/* First child, so the pill paints behind the rows rather than over them. */}
                                    {projectMenuGoo.pill}
                                    <MenuItem
                                      onSelect={() => handleToggleProjectStar(project.id)}
                                      leadingIcon={StarDecl}
                                      iconState={{ selection: project.isStarred ? 'on' : 'off' }}
                                    >
                                      {project.isStarred ? 'Unstar' : 'Star'}
                                    </MenuItem>
                                    <MenuItem
                                      onSelect={() => openProjectSettings(project, 'general')}
                                      leadingIcon={EditDecl}
                                    >
                                      Project settings
                                    </MenuItem>
                                    <div className="my-1 border-t" style={{ borderColor: 'var(--chat-border)' }} />
                                    <MenuItem
                                      onSelect={() => handleToggleProjectArchive(project.id)}
                                      leadingIcon={ArchiveDecl}
                                      iconState={{ selection: project.isArchived ? 'on' : 'off' }}
                                    >
                                      {project.isArchived ? 'Unarchive' : 'Archive'}
                                    </MenuItem>
                                    <MenuItem
                                      onSelect={() => handleDeleteProject(project.id)}
                                      leadingIcon={TrashDecl}
                                      variant="danger"
                                    >
                                      Delete
                                    </MenuItem>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div
                              className="relative min-h-0 flex-1 rounded-lg border text-left transition-[background-color,border-color] duration-150 group-hover:bg-[var(--chat-project-preview-fade)]"
                              style={{
                                backgroundColor: 'var(--chat-canvas)',
                                borderColor: 'color-mix(in srgb, var(--chat-canvas) 82%, var(--chat-muted))',
                              }}
                            >
                              <div
                                className="absolute inset-0 overflow-y-auto pb-3 pl-3.5 pr-1 pt-2.5"
                                style={{
                                  maskImage:
                                    'linear-gradient(to bottom, transparent 0, #000 10px, #000 calc(100% - 10px), transparent 100%)',
                                  WebkitMaskImage:
                                    'linear-gradient(to bottom, transparent 0, #000 10px, #000 calc(100% - 10px), transparent 100%)',
                                }}
                              >
                                <p className="text-[12.5px] leading-relaxed text-[var(--chat-muted)]">
                                  {description}
                                </p>
                              </div>
                              <div
                                className={`pointer-events-none absolute inset-x-0 bottom-0 h-20 rounded-b-lg opacity-0 transition-opacity duration-200 ${
                                  suppressCardOverlayId === project.id ? '' : 'group-hover:opacity-100'
                                }`}
                                style={{
                                  // Theme token: solid per theme so the fade matches the preview fill
                                  // (dim's --chat-hover is translucent and would not cover the text).
                                  backgroundImage:
                                    'linear-gradient(to top, var(--chat-project-preview-fade) 0%, color-mix(in srgb, var(--chat-project-preview-fade) 55%, transparent) 55%, transparent 100%)',
                                }}
                              />
                              <span className={`pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-[11.5px] font-medium text-[var(--chat-text)] opacity-0 transition-opacity duration-200 ${
                                  suppressCardOverlayId === project.id ? '' : 'group-hover:opacity-100'
                                }`}>
                                {formatProjectCardDate(stamp)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
        {isArtifactsPageOpen && (
          <ChatArtifactsPage
            pageLeft={!isMultiInterface && isHistoryOpen && !isMobile ? 260 : 0}
            onClose={() => {
              setIsArtifactsPageOpen(false);
              setHistoryNavView('chats');
            }}
          />
        )}
        {isScheduledPageOpen && (
          <ChatScheduledPage
            pageLeft={!isMultiInterface && isHistoryOpen && !isMobile ? 260 : 0}
            onClose={() => {
              setIsScheduledPageOpen(false);
              setHistoryNavView('chats');
            }}
          />
        )}
        {isGlobalSettingsPageOpen && (
          <ChatGlobalSettingsPage
            pageLeft={!isMultiInterface && isHistoryOpen && !isMobile ? 260 : 0}
            onClose={() => {
              setIsGlobalSettingsPageOpen(false);
              setHistoryNavView('chats');
            }}
            onApplyPersona={(persona: ChatPersona | null) => {
              if (persona) {
                setSelectedPersona(persona.id);
                setSystemPrompt(persona.prompt);
                setSavedSystemPrompt(persona.prompt);
                void setChatPersonaId(activeConversationId, persona.id);
              } else {
                setSelectedPersona(null);
                setSystemPrompt('');
                setSavedSystemPrompt('');
                void setChatPersonaId(activeConversationId, null);
              }
            }}
            onSaveInstructionsLive={(text) => {
              if (!selectedPersona) {
                setSystemPrompt(text);
                setSavedSystemPrompt(text);
              }
            }}
          />
        )}
        {isCustomizePageMounted && (
          <ChatCustomizePage
            onClose={() => setIsCustomizePageOpen(false)}
            conversationId={activeConversationId}
            isOpen={isCustomizePageOpen}
            isShown={isCustomizePageShown}
            motionFrom={customizeMotionFrom}
          />
        )}
        {isSettingsModalMounted &&
          createPortal(
            <div
              className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} fixed inset-0 z-[999] flex items-center justify-center p-4 backdrop-blur-sm`}
              data-chat-theme-preference={chatTheme}
              data-chat-settings-dialog=""
              style={{
                backgroundColor: isSettingsModalShown
                  ? 'color-mix(in srgb, var(--chat-text) 28%, transparent)'
                  : 'color-mix(in srgb, var(--chat-text) 0%, transparent)',
                transition: `background-color ${SCHEDULE_CREATE_MODAL_MS}ms ${SCHEDULE_DATE_EASE}`,
                ...chatThemePreviewStyle,
              }}
              onClick={closeChatSettings}
            >
              <style>{CHAT_MODAL_KEYFRAMES_CSS}</style>
              <div
                className="w-full max-w-[48rem] will-change-transform"
                style={chatModalCardMotionStyle(
                  'top-right',
                  isSettingsModalShown,
                  isSettingsModalOpen,
                )}
                onClick={(event) => event.stopPropagation()}
              >
                <ChatSettingsModal
                  onClose={closeChatSettings}
                  conversationId={activeConversationId}
                  onApplyPersona={(persona: ChatPersona | null) => {
                    if (persona) {
                      setSelectedPersona(persona.id);
                      setSystemPrompt(persona.prompt);
                      setSavedSystemPrompt(persona.prompt);
                    } else {
                      setSelectedPersona(null);
                      setSystemPrompt('');
                      setSavedSystemPrompt('');
                    }
                  }}
                  chatAlignment={chatAlignment}
                  onChatAlignmentChange={setChatAlignment}
                  isWideChatEnabled={isWideChatEnabled}
                  onWideChatChange={setIsWideChatEnabled}
                  chatFontSize={chatFontSize}
                  onChatFontSizeChange={setChatFontSize}
                  isMobile={isMobile}
                  maxInterfacesReached={maxInterfacesReached}
                  isMultiInterface={!!isMultiInterface}
                  onCreateNewInterface={onCreateNewInterface}
                  onCloseInterface={
                    onCloseInterface
                      ? () => onCloseInterface(interfaceId)
                      : undefined
                  }
                  canExport={messages.length > 0}
                  onExportMarkdown={handleExportConversation}
                />
              </div>
            </div>,
            document.body,
          )}
        {activeProjectId && (() => {
          const project = chatProjects.find((p) => p.id === activeProjectId);
          if (!project) return null;
          const pageLeft =
            !isMultiInterface && isHistoryOpen && !isMobile ? 260 : 0;
          const description =
            project.description?.trim() || 'No description yet.';
          const hasLongDescription = description.length > 160;
          const projectChats = conversationHistory
            .filter((convo) => convo.projectId === project.id)
            .sort((a, b) => b.timestamp - a.timestamp);
          const realProjectFiles = project.files ?? [];
          // Empty projects show mock files so the grid + "See all" can be judged visually.
          const projectFiles =
            realProjectFiles.length > 0 ? realProjectFiles : MOCK_PROJECT_FILES;
          const visibleProjectFiles = isProjectFilesExpanded
            ? projectFiles
            : projectFiles.slice(0, PROJECT_FILES_PREVIEW_LIMIT);
          const hasHiddenProjectFiles = projectFiles.length > PROJECT_FILES_PREVIEW_LIMIT;
          const realScheduled = project.scheduledTasks ?? [];
          const projectScheduled =
            realScheduled.length > 0 ? realScheduled : MOCK_PROJECT_SCHEDULED;
          return (
            <div
              className="absolute inset-0 z-[46] main-content-transition overflow-hidden"
              style={{
                left: pageLeft,
                right:
                  isContextPanelOpen && !isMultiInterface
                    ? contextPanelWidth
                    : 0,
                backgroundColor: 'var(--chat-canvas)',
                color: 'var(--chat-text)',
              }}
              role="dialog"
              aria-label={`Project: ${project.name}`}
            >
              <div
                className="h-full overflow-y-auto hide-scrollbar pb-12 transition-[padding] duration-300 ease-in-out"
                style={{
                  paddingRight: !isMobile && isProjectSidebarOpen ? 260 : undefined,
                }}
              >
                <div className="mx-auto w-full max-w-[52rem] px-4 sm:px-6">
                  <div className="mt-6 mb-5 flex items-center md:mt-8">
                    <IconButton
                      icon={ChevronRightDecl}
                      className="chat-icon-flip-x"
                      variant="ghost"
                      size="md"
                      iconSize={18}
                      onClick={closeProject}
                      aria-label="Back to projects"
                      title="Back to projects"
                    />
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <h1 className="min-w-0 pr-2 text-[1.5rem] font-semibold tracking-tight text-[var(--chat-text)]">
                      {project.name}
                    </h1>
                    <div className="flex flex-shrink-0 items-center gap-0.5">
                      <IconButton
                        icon={StarDecl}
                        variant="ghost"
                        size="md"
                        iconSize={16}
                        onClick={() => handleToggleProjectStar(project.id)}
                        aria-label={project.isStarred ? 'Unstar project' : 'Star project'}
                        title={project.isStarred ? 'Unstar' : 'Star'}
                      />
                      {/* `ghost md` to the pixel — 32px square, muted ink brightening over a
                          `--chat-hover` fill, glyph 16 which is md's own. The two faces stay ONE
                          button with the ternary in `icon`, so the panel glyph animates its own
                          change instead of being swapped for a different element. It sits beside an
                          IconButton that converted earlier; this was the odd one left in the row. */}
                      <IconButton
                        icon={isProjectSidebarOpen ? PanelRightCloseDecl : PanelRightOpenDecl}
                        variant="ghost"
                        size="md"
                        iconSize={16}
                        onClick={() => setIsProjectSidebarOpen((open) => !open)}
                        aria-label={isProjectSidebarOpen ? 'Close project panel' : 'Open project panel'}
                        title={isProjectSidebarOpen ? 'Close panel' : 'Open panel'}
                      />
                    </div>
                  </div>

                  <p
                    className={`mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--chat-muted)] ${
                      isProjectDescExpanded ? '' : 'line-clamp-2'
                    }`}
                  >
                    {description}
                  </p>
                  {/* Stays hand-written: it has no box. No padding, no height, no fill, no
                      border — muted text that underlines under the pointer, sitting directly under
                      the paragraph it expands. Giving it a button's height and side padding would
                      push it off the text it belongs to. The same call as the composer's token
                      counter: text that happens to be clickable. */}
                  {hasLongDescription && (
                    <button
                      type="button"
                      onClick={() => setIsProjectDescExpanded((v) => !v)}
                      className="mt-1 text-[12px] font-medium text-[var(--chat-muted)] underline-offset-2 transition-colors hover:text-[var(--chat-text)] hover:underline"
                    >
                      {isProjectDescExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}

                  <div className="mt-5 min-w-0">
                    {renderPrimaryComposer({ forceCompact: true })}

                    {projectChats.length === 0 ? (
                      <div className="mt-10 flex flex-col items-center justify-center px-4 py-8 text-center">
                        <MessageSquare
                          size={26}
                          className="mb-3 text-[var(--chat-muted)]"
                          aria-hidden="true"
                        />
                        <p className="max-w-[24rem] text-[13px] leading-relaxed text-[var(--chat-muted)]">
                          Give XENO a task and it'll pick up your project context automatically.
                        </p>
                      </div>
                    ) : (
                      <>
                        <h2 className="mt-7 mb-1 text-[12.5px] font-medium text-[var(--chat-muted)]">
                          Recents
                        </h2>
                        {/* The first `<ListRow>` in this chat, and the row was already its shape: a
                            leading glyph, a title that truncates, a date pinned to the end, and a
                            hover that paints the whole row. `onSelect` is what makes it a full-width
                            button rather than a div, which is what it was.
                            The padding transposes, and that is the visible change: this row wrote
                            12px vertical over 8px horizontal, and the component's rhythm is the other
                            way round — 8 over 12 — so the row loses 8px of height and gains side
                            room. That is the list rhythm the design system keeps, and a Recents list
                            is exactly where it should be kept. */}
                        <div>
                          {projectChats.map((chat) => (
                            <ListRow
                              key={chat.id}
                              leading={<MessageSquare size={15} aria-hidden="true" />}
                              title={chat.title}
                              trailing={formatProjectCardDate(chat.timestamp)}
                              onSelect={() => {
                                void handleLoadConversation(chat.id);
                              }}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* No outer panel — only open/close + the three section cards on the page canvas. */}
              <aside
                className="absolute inset-y-0 z-[47] flex w-[260px] flex-col overflow-hidden bg-transparent transition-[right] duration-300 ease-in-out"
                style={{
                  right: isProjectSidebarOpen ? 0 : -260,
                  pointerEvents: isProjectSidebarOpen ? 'auto' : 'none',
                }}
                aria-hidden={!isProjectSidebarOpen}
                aria-label="Project sections"
              >
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 hide-scrollbar">
                  {(() => {
                    const displayInstructions =
                      project.instructions?.trim() || MOCK_PROJECT_INSTRUCTIONS;
                    const railShellStyle: React.CSSProperties = {
                      backgroundColor:
                        'color-mix(in srgb, var(--chat-canvas) 88%, var(--chat-muted))',
                      borderColor:
                        'color-mix(in srgb, var(--chat-canvas) 74%, var(--chat-muted))',
                    };
                    const railChipStyle: React.CSSProperties = {
                      backgroundColor: 'var(--chat-canvas)',
                      borderColor: 'color-mix(in srgb, var(--chat-muted) 20%, transparent)',
                    };
                    return (
                      <div className="flex flex-col gap-3">
                        {/* Instructions — same shell language as Files */}
                        <div
                          className="flex flex-col rounded-[10px] border p-1.5"
                          style={railShellStyle}
                        >
                          <div className="flex items-center justify-between gap-2 py-1 pl-2 pr-0.5">
                            <span className="truncate text-[13px] font-semibold leading-snug tracking-tight text-[var(--chat-text)]">
                              Settings
                            </span>
                            <IconButton
                              icon={MoreVerticalDecl}
                              variant="ghost"
                              size="sm"
                              iconSize={16}
                              onClick={() => openProjectSettings(project, 'general')}
                              aria-label="Open project settings"
                              title="Project settings"
                            />
                          </div>
                          {/* Stays hand-written, and so do the three below it: the project
                              sidebar's section cards are CARDS, and a `Button` is a horizontal row
                              holding one line of label at a height the size scale picks. Every one of
                              these stacks its content vertically at a height of its own.
                              This one clamps four lines of the project instructions under a bold
                              first line. `ListRow` is the nearest thing and it truncates title and
                              subtitle to one line each, which is the opposite of what a preview is
                              for. */}
                          <div className="px-1 pb-1.5 pt-0.5">
                            <button
                              type="button"
                              onClick={() => openProjectSettings(project, 'instructions')}
                              className="w-full rounded-lg border px-2.5 py-2 text-left transition-[transform,opacity] duration-150 ease-out hover:opacity-90 active:scale-[0.99]"
                              style={railChipStyle}
                            >
                              <span className="line-clamp-4 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--chat-muted)]">
                                <span className="font-medium text-[var(--chat-text)]">Standing rules</span>
                                <span className="mt-1 block text-[var(--chat-muted)]">
                                  {displayInstructions}
                                </span>
                              </span>
                            </button>
                          </div>
                        </div>

                        <input
                          ref={projectFileInputRef}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(event) => {
                            handleAddProjectFiles(project.id, event.target.files);
                            event.target.value = '';
                          }}
                        />
                        {projectFileNotice && (
                          <p
                            className="rounded-md px-2 py-1.5 text-[11px] leading-snug text-[var(--chat-danger)]"
                            style={{ backgroundColor: 'var(--chat-hover)' }}
                          >
                            {projectFileNotice}
                          </p>
                        )}

                        {/* Files */}
                        <div
                          className="flex min-h-[10.5rem] flex-col rounded-[10px] border p-1.5"
                          style={railShellStyle}
                        >
                          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 py-1 pl-2 pr-0.5">
                            <span className="truncate text-[13px] font-semibold leading-none tracking-tight text-[var(--chat-text)]">
                              Files
                            </span>
                            {/* Stays hand-written: a mono counter, not a control. It is set in the
                                MONO face — every button component here imposes the control font — and
                                its ink is `--chat-muted` at 30%, a transparency no variant offers,
                                brightening through two JS handlers rather than a state. */}
                            {hasHiddenProjectFiles ? (
                              <button
                                type="button"
                                onClick={() => setIsProjectFilesExpanded((open) => !open)}
                                className="flex h-7 items-center justify-center px-1 font-mono text-[11px] leading-none tabular-nums transition-[color] duration-150"
                                style={{
                                  color:
                                    'color-mix(in srgb, var(--chat-muted) 30%, transparent)',
                                }}
                                onMouseEnter={(event) => {
                                  event.currentTarget.style.color = 'var(--chat-text)';
                                }}
                                onMouseLeave={(event) => {
                                  event.currentTarget.style.color =
                                    'color-mix(in srgb, var(--chat-muted) 30%, transparent)';
                                }}
                                aria-label={
                                  isProjectFilesExpanded
                                    ? 'Show fewer files'
                                    : `Show all ${projectFiles.length} files`
                                }
                                title={
                                  isProjectFilesExpanded
                                    ? 'Show fewer'
                                    : `Show all ${projectFiles.length}`
                                }
                              >
                                {isProjectFilesExpanded
                                  ? `${projectFiles.length}/${projectFiles.length}`
                                  : `${PROJECT_FILES_PREVIEW_LIMIT}/${projectFiles.length}`}
                              </button>
                            ) : (
                              <span aria-hidden="true" />
                            )}
                            <div className="flex items-center justify-end">
                              <IconButton
                                icon={SearchDecl}
                                variant="ghost"
                                size="sm"
                                iconSize={15}
                                aria-label="Search files"
                                title="Search files"
                              />
                              <IconButton
                                icon={PlusDecl}
                                variant="ghost"
                                size="sm"
                                iconSize={16}
                                onClick={() => projectFileInputRef.current?.click()}
                                aria-label="Add file"
                                title="Upload a file"
                              />
                            </div>
                          </div>

                          {/* Stays hand-written: a 104px dropzone, centred, stacking a glyph over
                              a bold line over a wrapped sentence. `Button` centres its content in one
                              horizontal row, and `Tile` is a small square that holds a single glyph —
                              neither is a panel that explains itself. */}
                          {projectFiles.length === 0 ? (
                            <button
                              type="button"
                              onClick={() => projectFileInputRef.current?.click()}
                              className="flex min-h-[6.5rem] w-full flex-col items-center justify-center gap-1.5 rounded-md px-2 pb-2 text-center transition-colors hover:bg-[var(--chat-hover)]"
                            >
                              <FolderUp size={18} className="text-[var(--chat-muted)]" aria-hidden="true" />
                              <span className="text-[12px] font-medium text-[var(--chat-text)]">
                                Add relevant context
                              </span>
                              <span className="max-w-[14rem] text-[11px] leading-relaxed text-[var(--chat-muted)]">
                                Upload documents, code, and other files for XENO to reference.
                              </span>
                            </button>
                          ) : (
                            <div className="px-1 pb-1.5 pt-0.5">
                              <div className="grid grid-cols-2 gap-1.5">
                                {visibleProjectFiles.map((file) => {
                                  const isMockFile = file.id.startsWith('mock-file-');
                                  const baseName = file.name.includes('.')
                                    ? file.name.slice(0, file.name.lastIndexOf('.'))
                                    : file.name;
                                  const previewText =
                                    file.content?.trim() ||
                                    `${getProjectFileExtension(file.name).toUpperCase()} file`;
                                  return (
                                    <div
                                      key={file.id}
                                      className="group/file relative min-w-0"
                                    >
                                      {/* Stays hand-written — a 53.6px file card, `flex-col`, its
                                          own border and a press that scales to 0.98. The sidebar's
                                          card shape, and the third of four here. */}
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openProjectFilePreview({
                                            name: file.name,
                                            type: file.type,
                                            content: file.content,
                                            encoding: file.encoding,
                                          })
                                        }
                                        className="flex h-[3.35rem] w-full flex-col overflow-hidden rounded-lg border px-2 py-1.5 text-left transition-[transform,opacity] duration-150 ease-out hover:opacity-90 active:scale-[0.98]"
                                        style={railChipStyle}
                                        title={file.name}
                                      >
                                        <span className="truncate text-[11px] font-medium leading-tight tracking-tight text-[var(--chat-text)]">
                                          {baseName}
                                        </span>
                                        <span className="mt-0.5 line-clamp-2 text-[9.5px] leading-snug text-[var(--chat-muted)]">
                                          {previewText}
                                        </span>
                                      </button>
                                      {!isMockFile && (
                                        <IconButton
                                          icon={XDecl}
                                          variant="ghost"
                                          size="xs"
                                          iconSize={11}
                                          className="absolute right-0.5 top-0.5 opacity-0"
                                          onClick={() => handleRemoveProjectFile(project.id, file.id)}
                                          aria-label={`Remove ${file.name}`}
                                          title="Remove"
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Scheduled — same shell + black chips */}
                        <div
                          className="flex flex-col rounded-[10px] border p-1.5"
                          style={railShellStyle}
                        >
                          <div className="flex items-center justify-between gap-2 py-1 pl-2 pr-0.5">
                            <span className="truncate text-[13px] font-semibold leading-snug tracking-tight text-[var(--chat-text)]">
                              Scheduled
                            </span>
                            <IconButton
                              icon={PlusDecl}
                              variant="ghost"
                              size="sm"
                              iconSize={16}
                              onClick={openProjectScheduledCreate}
                              aria-label="Add scheduled task"
                              title="Add scheduled task"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5 px-1 pb-1.5 pt-0.5">
                            {projectScheduled.map((task) => (
                              /* Stays hand-written — the project sidebar's card shape, the fourth of
                                 them: a bordered tile stacking a title over a cadence line, sized by
                                 its content rather than by a step on the control scale. */
                              <button
                                key={task.id}
                                type="button"
                                onClick={() => openProjectScheduledPreview(task)}
                                className="rounded-lg border px-2.5 py-2 text-left transition-[transform,opacity] duration-150 ease-out hover:opacity-90 active:scale-[0.99]"
                                style={railChipStyle}
                              >
                                <div className="flex items-baseline gap-2">
                                  <span className="w-7 flex-shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--chat-muted)]">
                                    {task.mark}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-[11.5px] font-medium leading-tight tracking-tight text-[var(--chat-text)]">
                                      {task.title}
                                    </p>
                                    <p className="mt-0.5 truncate text-[9.5px] text-[var(--chat-muted)]">
                                      {task.cadence}
                                    </p>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </aside>
            </div>
          );
        })()}
        {/* Top Bar - matches PDF/Word interface style */}
        <div
          ref={topBarRef}
          className={`chat-top-bar absolute top-0 left-0 z-30 flex main-content-transition bg-[var(--chat-canvas)] ${
            isMultiInterface ? 'flex-col px-2 py-1' : 'items-center px-0'
          }`}
          style={{
            right: isContextPanelOpen && !isMultiInterface ? `${contextPanelWidth}px` : '0px',
            backgroundColor: 'var(--chat-canvas)',
            ...(!isMultiInterface ? { height: CHAT_CHROME_BAR_HEIGHT_PX } : null),
          }}
        >
          {/* Buttons row */}
          <div className="relative flex h-full w-full flex-shrink-0 items-center justify-between">
          {/* Left side - System Prompt, Clear/Save (history opens from floating chrome / sidebar) */}
          <div ref={leftButtonsRef} className={`chat-top-bar-buttons relative flex items-center ${isMultiInterface ? 'gap-1' : 'gap-2 md:gap-2'} transition-all duration-300 ease-in-out`}
            style={{ marginLeft: !isMultiInterface && isHistoryOpen && !isMobile ? '260px' : '0px' }}>
              {/* Spacer: floating icon/XENO (z-60) sits here when history chrome is visible. */}
              {!isMultiInterface && showClosedHistoryChrome && (
                <div
                  className={`h-9 flex-shrink-0 ${isProjectsPageOpen || isArtifactsPageOpen || isGlobalSettingsPageOpen || isScheduledPageOpen ? 'w-[13.5rem]' : 'w-[8.25rem]'}`}
                  aria-hidden="true"
                />
              )}
              {/* System Prompt — multi-interface only; main chat opens it from ⋯ */}
              {isMultiInterface && (
              <div className={`relative ${messages.length === 0 ? 'hidden' : ''}`}>
                {/* Stays hand-written, and only for its selected state. At rest it is `quiet` to
                    the letter — hairline, muted ink, full ink over a hover tint — but with a persona
                    chosen the BORDER turns `--chat-accent` and the ink comes up, with no fill. That
                    is the ninth ringed selection in this chat and the library says chosen by filling
                    and dropping the outline, which is the opposite move (§9). Converting the resting
                    half and hand-painting the other would put the split back inside one button. */}
                <button
                  ref={systemPromptButtonRef}
                  onClick={toggleSystemPrompt}
                  onMouseEnter={() => setIsSystemPromptButtonHovered(true)}
                  onMouseLeave={() => setIsSystemPromptButtonHovered(false)}
                  className={`chat-system-prompt-btn flex h-9 w-[8rem] items-center justify-center gap-2 rounded-lg border border-[var(--chat-border)] px-3 py-1.5 text-sm text-[var(--chat-muted)] transition-colors hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] ${selectedPersona ? 'border-[var(--chat-accent)] text-[var(--chat-text)]' : ''}`}
                >
                  <FilePenLine size={16} className="flex-shrink-0" />
                  <span className="hidden truncate md:inline">
                    {selectedPersona && selectedPersona !== 'custom'
                      ? PERSONAS.find(p => p.id === selectedPersona)?.label
                      : selectedPersona === 'custom'
                        ? 'Custom'
                        : 'System'}
                  </span>
                </button>
                {(isSystemPromptButtonHovered && !isSystemPromptOpen && !isCustomPromptOpen) && (
                  <div className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2">
                    <ChevronDown size={16} className="text-[var(--chat-muted)]" />
                  </div>
                )}
                <div
                  ref={systemPromptPanelRef}
                  className={`absolute left-0 top-full z-20 mt-[10px] flex origin-top-left flex-col gap-2 transition-all duration-200 ease-out ${isSystemPromptOpen && !isCustomPromptOpen ? 'visible scale-100 opacity-100' : 'pointer-events-none invisible scale-95 opacity-0'}`}
                >
                  {/* Stays hand-written, and it needs more than the ring. Unselected these rest on
                      `--chat-elevated`; selected they take `--chat-control` AND an accent border. The
                      variants carry one control fill and no accent outline, so both states would have
                      to be repainted rather than named. */}
                  {PERSONAS.map((persona) => (
                    <button key={persona.id} onClick={() => handlePersonaSelect(persona.id)}
                      className={`flex h-9 w-[8rem] items-center justify-center rounded-lg border px-3 py-1.5 text-sm transition-colors ${selectedPersona === persona.id ? 'border-[var(--chat-accent)] bg-[var(--chat-control)] text-[var(--chat-text)]' : 'border-[var(--chat-border)] bg-[var(--chat-elevated)] text-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]'}`}
                    >{persona.label}</button>
                  ))}
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() => { setIsSystemPromptOpen(false); setIsCustomPromptOpen(true); }}
                  >
                    Custom
                  </Button>
                  {selectedPersona && (
                    <Button
                      variant="danger"
                      size="lg"
                      onClick={handleClearSystemPrompt}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                <div className={`absolute left-0 top-full z-20 mt-[10px] origin-top-left overflow-hidden rounded-lg border border-[var(--chat-border)] bg-[var(--chat-elevated)] shadow-xl transition-all duration-200 ease-out ${isCustomPromptOpen ? 'visible scale-100 opacity-100' : 'pointer-events-none invisible scale-95 opacity-0'}`}
                  style={{ width: '18rem' }}>
                  {/* Stays hand-written, and it fails both shapes at once. The fill is
                      `--chat-elevated` where `.xeno-textarea` hard-codes `--xeno-canvas`; and it owns
                      no box of its own — the popover is the box, and this field contributes a single
                      `border-b` hairline separating it from the button row beneath. A component that
                      draws four borders and a 12px radius cannot be half of a joined panel. */}
                  <textarea placeholder="Enter custom system prompt..." value={systemPrompt} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSystemPrompt(e.target.value)}
                    className="h-32 w-full resize-none border-b border-[var(--chat-border)] bg-[var(--chat-elevated)] p-3 text-sm text-[var(--chat-text)] outline-none placeholder:text-[var(--chat-muted)]" />
                  {/* Both are `quiet` word for word: a `--chat-border` hairline, muted ink, and
                      full ink over a `--chat-hover` tint when reached for. 12px padding and 14px type
                      are `md` to the pixel. Save's disabled branch was a hand-written 40% opacity
                      with a not-allowed cursor, which is the availability axis said twice — the
                      component carries both. `flex-1` stays; it is layout.
                      Their two siblings one panel up converted several passes ago, so this row has
                      been half component and half hand-written since. */}
                  <div className="flex gap-2 p-2">
                    <Button
                      variant="quiet"
                      size="md"
                      className="flex-1"
                      onClick={() => { setIsCustomPromptOpen(false); setIsSystemPromptOpen(true); }}
                    >
                      Back
                    </Button>
                    <Button
                      variant="quiet"
                      size="md"
                      className="flex-1"
                      disabled={!systemPrompt.trim()}
                      onClick={() => { setSavedSystemPrompt(systemPrompt); setIsCustomPromptOpen(false); setSelectedPersona('custom'); setIsSystemPromptSaved(true); setTimeout(() => setIsSystemPromptSaved(false), 1500); }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
              )}
                      </div>

          {/* Center - Token Count (mobile only, non-multi-interface, active conversation only) - absolutely centered */}
          {isMobile && !isMultiInterface && messages.length > 0 && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
              {(() => {
                const totalUsedTokens = realTokenCount;
                const maxTokens = selectedModel?.maxTokens || 200000;
                const totalUsagePercent = totalUsedTokens / maxTokens;
                const isNearLimit = totalUsagePercent > 0.9;
                const isOverLimit = totalUsagePercent > 1;
                return (
                  <span className={`text-xs tabular-nums ${isOverLimit ? 'text-[var(--chat-danger)]' : isNearLimit ? 'text-[var(--chat-text)]' : 'text-[var(--chat-muted)]'}`}>
                    {totalUsedTokens.toLocaleString()} / {maxTokens.toLocaleString()}
                  </span>
                );
              })()}
            </div>
          )}

          {/* Top Center - Copy Session Transcript & Multi-Interface Selector */}
          <div className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
            {/* Conversation Selector (only in multi-interface mode) */}
            {isMultiInterface && (
              <div className="relative">
                <Button
                  ref={conversationSelectorButtonRef}
                  variant="quiet"
                  size="lg"
                  iconSize={16}
                  leadingIcon={MessageSquarePlusDecl}
                  trailingIcon={ChevronDownDecl}
                  className="chat-icon-turn max-w-[14rem] [--chat-icon-turn:180deg]"
                  data-selection={isConversationSelectorOpen ? 'on' : 'off'}
                  aria-expanded={isConversationSelectorOpen}
                  aria-haspopup="dialog"
                  onClick={() => setIsConversationSelectorOpen(!isConversationSelectorOpen)}
                >
                  <span className="max-w-[10rem] truncate">
                    {activeConversationId
                      ? (conversationHistory.find(c => c.id === activeConversationId)?.title || 'Select Chat')
                      : 'New Chat'}
                  </span>
                </Button>

                {/* Conversation Selector Dropdown */}
                <div
                  ref={conversationSelectorDropdownRef}
                  className={`
                    absolute left-1/2 top-full z-20 mt-[10px] origin-top -translate-x-1/2
                    max-h-80 w-64 overflow-hidden rounded-lg border border-[var(--chat-border)] bg-[var(--chat-elevated)] shadow-xl
                    transition-all duration-200 ease-out
                    ${isConversationSelectorOpen
                      ? 'visible scale-100 opacity-100'
                      : 'pointer-events-none invisible scale-95 opacity-0'
                    }
                  `}
                >
                  {/* Search */}
                  <div className="border-b border-[var(--chat-border)] p-2">
                    <TextInput
                      size="sm"
                      iconSize={14}
                      leadingIcon={SearchDecl}
                      className="w-full"
                      type="text"
                      placeholder="Search conversations..."
                      value={conversationSearchQuery}
                      onChange={(e) => setConversationSearchQuery(e.target.value)}
                      aria-label="Search conversations"
                    />
                  </div>

                  {/* Conversation List */}
                  <div className="hide-scrollbar max-h-56 overflow-y-auto">
                    {isSelectorLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Spinner size={20} />
                      </div>
                    ) : selectorConversations.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-4 text-center">
                        <Clock size={20} className="mb-2 text-[var(--chat-muted)]" />
                        <p className="text-xs text-[var(--chat-muted)]">No conversations yet</p>
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
                          <Search size={20} className="mb-2 text-[var(--chat-muted)]" />
                          <p className="text-xs text-[var(--chat-muted)]">No matches found</p>
                        </div>
                      ) : (
                        <div className="py-1">
                          {filteredConversations.map(convo => (
                            <ListRow
                              key={convo.id}
                              title={convo.title}
                              subtitle={new Date(convo.timestamp).toLocaleDateString()}
                              selected={activeConversationId === convo.id}
                              onSelect={() => {
                                handleLoadConversation(convo.id);
                                setIsConversationSelectorOpen(false);
                                setConversationSearchQuery('');
                              }}
                            />
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* New Chat option */}
                  <div className="border-t border-[var(--chat-border)] p-2">
                    <ListRow
                      leading={<Plus size={14} aria-hidden="true" />}
                      title="New Conversation"
                      onSelect={() => {
                        handleNewChat();
                        setIsConversationSelectorOpen(false);
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Copy Session Transcript Button */}
            <button
              type="button"
              onClick={handleCopySessionTranscript}
              className={`group flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-medium tracking-tight shadow-sm transition-all duration-150 ${
                isTranscriptCopied
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : 'border-[var(--chat-border)] bg-[var(--chat-elevated)]/85 text-[var(--chat-muted)] backdrop-blur-md hover:border-[var(--chat-text)]/25 hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]'
              }`}
              title="Copy full chat transcript, telemetry, layout metrics, and diagnostic JSON"
              aria-label="Copy Session Transcript"
            >
              {isTranscriptCopied ? (
                <>
                  <CheckDecl size={13} className="text-emerald-400 flex-shrink-0 animate-in fade-in zoom-in-75 duration-150" />
                  <span className="text-emerald-400 font-semibold">Transcript Copied!</span>
                </>
              ) : (
                <>
                  <CopyDecl size={13} className="opacity-70 group-hover:opacity-100 flex-shrink-0 transition-opacity" />
                  <span className="hidden sm:inline">Copy Session Transcript</span>
                  <span className="inline sm:hidden">Transcript</span>
                </>
              )}
            </button>
          </div>

          {/* Right side:
              New chat → Temporary Preview · Theme · Settings
              Open conversation → Share · ⋯ (options inside)
              Multi keeps denser toolbar. */}
          <div
            ref={rightButtonsRef}
            className={`chat-top-bar-buttons flex items-center ${isMultiInterface ? 'gap-1' : 'absolute gap-1.5'} main-content-transition ${
              !isMultiInterface ? 'z-[60] h-9' : ''
            }`}
            style={
              !isMultiInterface
                ? { top: CHAT_CHROME_TOP_INSET_PX, right: CHAT_CHROME_EDGE_INSET_PX }
                : undefined
            }
          >
              {/* `topBarBtnClass` was `quiet` written out: a `--chat-border` hairline with muted
                  ink, going to full ink over a `--chat-hover` tint. Its ACTIVE half was
                  `border-transparent` plus full ink and no fill, which is what
                  `quiet[data-selection=on]` draws — and there is already a rule waiting for it.
                  That rule is the find. `.chat-themed .chat-top-bar-btn[data-selection="on"]` sets
                  `--chat-top-bar-btn-active`, and these two buttons emitted `data-active`, which
                  nothing in this codebase reads. The active fill has never painted. Saying
                  `data-selection` — which the component's axis is named for — makes a dormant rule
                  live, and the token it reaches for exists in all three palettes. */}
              {!isMultiInterface && messages.length === 0 && (
                <Button
                  variant="quiet"
                  size="lg"
                  iconSize={15}
                  leadingIcon={UserRoundXDecl}
                  className="chat-top-bar-btn"
                  data-selection={isTemporaryChat ? 'on' : 'off'}
                  aria-pressed={isTemporaryChat}
                  aria-label="Temporary chat preview"
                  title="Temporary chat"
                  onClick={() => {
                    setIsTemporaryChat((current) => !current);
                    setIsChatMoreMenuOpen(false);
                    setIsSharePreviewOpen(false);
                    setIsThemeMenuOpen(false);
                  }}
                >
                  <span className="hidden sm:inline-flex items-center gap-1">
                    <span className="font-medium leading-none">Temporary</span>
                    <span className="leading-none text-[12px] text-[var(--chat-muted)]">Preview</span>
                  </span>
                </Button>
              )}

              {(isMultiInterface || messages.length === 0) && (
              <div ref={themeMenuRef} className="relative flex-shrink-0">
                {/* Temporary's pair, and §8 kept them together on purpose: converting one and not
                    the other would split a row that reads as one thing.
                    The chevron stays a CHILD rather than becoming `trailingIcon`, because `iconSize`
                    is one number for both slots and this chevron is 12 against the mark's 16 — a
                    subordinate glyph by design, and `trailingIcon` would make them equal. It still
                    flips: `.chat-icon-turn` targets the last glyph in the button and reads
                    `aria-expanded`, which this trigger already sets. */}
                <Button
                  variant="quiet"
                  size="lg"
                  iconSize={16}
                  leadingIcon={ContrastDecl}
                  className="chat-top-bar-btn chat-icon-turn [--chat-icon-turn:180deg]"
                  data-selection={isThemeMenuOpen ? 'on' : 'off'}
                  aria-expanded={isThemeMenuOpen}
                  aria-controls="chat-theme-menu"
                  aria-haspopup="menu"
                  aria-label="Choose Chat LLM theme"
                  title="Choose Chat LLM theme"
                  onClick={() => {
                    setIsThemeMenuOpen((isOpen) => !isOpen);
                    setIsChatMoreMenuOpen(false);
                    setIsSharePreviewOpen(false);
                  }}
                >
                  <ChevronDown size={12} className="text-[var(--chat-muted)]" />
                </Button>
                {isThemeMenuMounted && (
                <div
                  key={isThemeMenuShown ? 'chat-theme-menu-in' : 'chat-theme-menu-out'}
                  id="chat-theme-menu"
                  role="dialog"
                  aria-label="Chat LLM theme"
                  aria-hidden={!isThemeMenuOpen}
                  onMouseDown={(event) => event.stopPropagation()}
                  className="absolute right-0 top-full z-20 mt-2 w-52 rounded-lg border border-[var(--chat-border)] bg-[var(--chat-elevated)] p-2.5 shadow-xl"
                  style={themeMenuPanelMotionStyle(isThemeMenuShown, isThemeMenuOpen)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-[var(--chat-text)]">Appearance</span>
                    {/* Stays hand-written, and it is the surface collision again (§9). At rest it
                        is `quiet` to the letter; chosen, it holds the hover appearance — a
                        `--chat-hover` fill at #404040 with the border kept. `quiet[data-selection=on]`
                        would fill with `--chat-control`, and this menu panel is `--chat-elevated`,
                        which is the SAME #262626 in dark. The fill would vanish and the border would
                        go with it, leaving the chosen chip as bare text. The design already knew: it
                        picked the one fill that reads on an elevated panel. */}
                    <button
                      type="button"
                      aria-pressed={chatTheme === 'system'}
                      onClick={() => handleChatThemeChange('system', false)}
                      className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors active:scale-[0.98] ${
                        chatTheme === 'system'
                          ? 'border-[var(--chat-border)] bg-[var(--chat-hover)] text-[var(--chat-text)]'
                          : 'border-[var(--chat-border)] text-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]'
                      }`}
                    >
                      <Monitor size={13} aria-hidden="true" />
                      System
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--chat-muted)]">
                    {chatTheme === 'system' ? 'Following your device' : `Theme ${displayedThemeSliderPosition}%`}
                  </p>
                  <div className="mt-3 px-1">
                    <div className="chat-theme-waveform-control relative">
                      <div className="chat-theme-waveform" aria-hidden="true">
                      {Array.from({ length: THEME_WAVEFORM_BAR_COUNT }, (_, index) => {
                        const position = index * THEME_BRIGHTNESS_STEP;
                        const isThemeStop = index === 0 || index === Math.floor(THEME_WAVEFORM_BAR_COUNT / 2) || index === THEME_WAVEFORM_BAR_COUNT - 1;
                        const isSelected = position === displayedThemeSliderPosition;

                        /* `data-percentage` is Unread on purpose, and the reason is that the probe's
                           two buckets do not fit it. It is classified as STATE because it is written
                           as an expression, but `index * THEME_BRIGHTNESS_STEP` is fixed for the bar
                           that carries it — it never changes for the life of that element. That makes
                           it an ANCHOR whose value happens to be computed: `data-selected` beside it
                           is the state, and it is the one that moves.

                           It stays because it is the only way to name a bar by the vocabulary the
                           theme is actually discussed in. probe-voicebright walks five stops — dark,
                           dim, light, 30%, 65% — and a selector by percentage says which is which,
                           where nth-child says the eleventh. Deleting it costs nothing today and the
                           next probe that wants a stop has to count bars to find one. */
                        return (
                          <span
                            key={index}
                            className="chat-theme-waveform-bar"
                            data-stop={isThemeStop}
                            data-selected={isSelected}
                            data-percentage={position}
                            style={{ backgroundColor: getThemePreviewTokens(position).canvas }}
                          />
                        );
                      })}
                      </div>
                      <input
                        className="chat-theme-slider"
                        type="range"
                        min="0"
                        max="100"
                        step={THEME_BRIGHTNESS_STEP}
                        value={displayedThemeSliderPosition}
                        aria-label="Theme brightness"
                        aria-valuetext={getThemeSliderValueText(displayedThemeSliderPosition)}
                        onChange={(event) => setThemePreviewPosition(Number(event.currentTarget.value))}
                        onPointerUp={(event) => commitThemeSliderPosition(Number(event.currentTarget.value))}
                        onPointerCancel={() => setThemePreviewPosition(null)}
                        onKeyUp={(event) => {
                          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                          commitThemeSliderPosition(Number(event.currentTarget.value));
                        }}
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-3 text-[10px] text-[var(--chat-muted)]">
                      {VISUAL_CHAT_THEME_OPTIONS.map((option, index) => (
                        <span
                          key={option.id}
                          className={index === 0 ? 'text-left' : index === 1 ? 'text-center' : 'text-right'}
                        >
                          {option.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                )}
              </div>
              )}

              {/* Refresh / New chat / Search — multi-interface denser toolbar */}
              {/* All three of this toolbar's controls are `quiet lg`: a `--chat-border` hairline
                  with no fill, brightening its border and taking a `--chat-hover` tint when reached
                  for. 36px is `lg` and the glyphs stay at 16 through `iconSize`.
                  The spin needed a class, because `IconButton` owns the glyph element and
                  `animate-spin` was sitting on the icon. `.chat-icon-spin` is the third member of the
                  family that already holds the mirror and the turn. `busy` was not the answer: it
                  sets `cursor: progress` and nothing visible. The opacity while refreshing is the
                  availability axis instead of two utility classes. */}
              {isMultiInterface && activeConversationId && (
                <IconButton
                  icon={RefreshDecl}
                  variant="quiet"
                  size="lg"
                  iconSize={16}
                  className={isRefreshing ? 'chat-icon-spin' : undefined}
                  busy={isRefreshing}
                  disabled={isRefreshing}
                  onClick={handleRefreshConversation}
                  aria-label="Refresh conversation"
                />
              )}
              {isMultiInterface && messages.length > 0 && (
                <IconButton
                  icon={EditDecl}
                  variant="quiet"
                  size="lg"
                  iconSize={16}
                  onClick={handleNewChat}
                  aria-label="Start New Chat"
                />
              )}
              {/* Open used to brighten this one's border. That is the disclosure `quiet` already
                  names — a quiet button is ON while the thing it opened is on screen — so it is
                  `data-selection` now, and the panel it opens is reported with `aria-expanded`,
                  which it never had. */}
              {isMultiInterface && messages.length > 0 && (
                <IconButton
                  icon={SearchDecl}
                  variant="quiet"
                  size="lg"
                  iconSize={16}
                  data-selection={isMessageSearchOpen ? 'on' : 'off'}
                  aria-expanded={isMessageSearchOpen}
                  onClick={() => {
                    setIsMessageSearchOpen(!isMessageSearchOpen);
                    if (isMessageSearchOpen) setMessageSearchQuery('');
                  }}
                  aria-label="Search messages"
                />
              )}

              {/* Main chat: Share + ⋯ */}
              {!isMultiInterface && messages.length > 0 && (
              <div className="relative flex-shrink-0">
                <IconButton
                  icon={ShareDecl}
                  variant="quiet"
                  size="lg"
                  iconSize={16}
                  className="chat-top-bar-btn"
                  onClick={() => {
                    setIsSharePreviewOpen(true);
                    setIsChatMoreMenuOpen(false);
                  }}
                  aria-expanded={isSharePreviewOpen}
                  aria-haspopup="dialog"
                  aria-label="Share conversation"
                  title="Share conversation"
                  data-selection={isSharePreviewOpen ? 'on' : 'off'}
                />
              </div>
              )}

              {/* Mobile Taskbar Menu Trigger when in open conversation */}
              {!isMultiInterface && messages.length > 0 && (
                <div className="relative flex-shrink-0 md:hidden">
                  <IconButton
                    icon={MenuDecl}
                    variant="quiet"
                    size="lg"
                    iconSize={16}
                    className="chat-top-bar-btn"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('open_mobile_taskbar'));
                    }}
                    aria-label="All products & tools"
                    title="All products & tools"
                  />
                </div>
              )}

              {/* ⋯ only in an open conversation (Share sibling). Theme / Temporary / Settings stay on New chat. */}
              {!isMultiInterface && messages.length > 0 && (
              <div ref={chatMoreMenuRef} className="relative flex-shrink-0">
                <IconButton
                  icon={MoreVerticalDecl}
                  variant="quiet"
                  size="lg"
                  iconSize={16}
                  className="chat-top-bar-btn"
                  onClick={() => {
                    setIsChatMoreMenuOpen((open) => !open);
                    setIsSharePreviewOpen(false);
                    if (isChatMoreMenuOpen) setIsThemeMenuOpen(false);
                  }}
                  aria-expanded={isChatMoreMenuOpen}
                  aria-haspopup="menu"
                  aria-label="More chat options"
                  title="More"
                  data-selection={isChatMoreMenuOpen ? 'on' : 'off'}
                />
                {isChatMoreMenuMounted && (
                <>
                <style>{CHAT_MODAL_KEYFRAMES_CSS}</style>
                <div
                  {...(() => { const { ref: _goo, className: _c, ...handlers } = chatMoreGoo.hostProps; return handlers; })()}
                  {...(() => { const { ...menu } = chatMoreMenu.menuProps; return menu; })()}
                  key={isChatMoreMenuShown ? 'chat-more-menu-in' : 'chat-more-menu-out'}
                  aria-hidden={!isChatMoreMenuOpen}
                  className={`${chatMoreGoo.hostProps.className} chat-goo absolute right-0 top-full z-30 mt-2 w-[220px] rounded-xl border border-[var(--chat-border)] bg-[var(--chat-elevated)] p-1 shadow-xl`}
                  style={{
                    backgroundColor: 'var(--chat-elevated)',
                    borderColor: 'var(--chat-border)',
                    pointerEvents: isChatMoreMenuShown ? 'auto' : 'none',
                    ...chatModalCardMotionStyle(
                      'top-right',
                      isChatMoreMenuShown,
                      isChatMoreMenuOpen,
                    ),
                  }}
                >
                  {/* First child, so the pill paints behind the rows rather than over them. */}
                  {chatMoreGoo.pill}
                    <MenuItem
                      onSelect={() => {
                      openChatFilesPanel();
                      setIsChatMoreMenuOpen(false);
                    }}
                      leadingIcon={FolderDecl}
                    >
                      View files in chat
                    </MenuItem>
                  {/* `iconState`, not a `fill-current` class. `bookmark` declares a selection axis
                      whose `on` variant is the same silhouette filled, and the two MORPH — one path,
                      equal length — so pinning now animates the ribbon closed instead of swapping a
                      CSS fill onto a glyph the row did not own. */}
                  <MenuItem
                    leadingIcon={BookmarkDecl}
                    iconState={{ selection: activeHistoryConvo?.isPinned ? 'on' : 'off' }}
                    disabled={!activeHistoryConvo}
                    onSelect={() => {
                      if (!activeHistoryConvo) return;
                      handleTogglePinConversation(activeHistoryConvo.id);
                    }}
                  >
                    {activeHistoryConvo?.isPinned ? 'Unpin chat' : 'Pin chat'}
                  </MenuItem>
                  <MenuItem
                    disabled={!activeHistoryConvo}
                    onSelect={() => {
                      if (!activeHistoryConvo) return;
                      void handleArchiveConversation(activeHistoryConvo.id, !activeHistoryConvo.isArchived);
                      setIsChatMoreMenuOpen(false);
                    }}
                    leadingIcon={ArchiveDecl}
                    iconState={{ selection: activeHistoryConvo?.isArchived ? 'on' : 'off' }}
                  >
                    {activeHistoryConvo?.isArchived ? 'Unarchive' : 'Archive'}
                  </MenuItem>
                  <MenuItem
                    disabled={!activeHistoryConvo}
                    onSelect={() => {
                      if (!activeHistoryConvo) return;
                      setDeleteConfirmationModal({
                        isOpen: true,
                        conversationId: activeHistoryConvo.id,
                        conversationTitle: activeHistoryConvo.title,
                        origin: 'top-right',
                      });
                      setIsChatMoreMenuOpen(false);
                    }}
                    leadingIcon={TrashDecl}
                  >
                    Delete
                  </MenuItem>

                  <div className="my-1 border-t border-[var(--chat-border)]" />

                  <div ref={themeMenuRef}>
                    {/* A disclosure, not a submenu — it grows the ⋯ menu rather than opening a
                        second one beside it, and `expanded` is the component's word for that: the
                        same chevron, quarter-turned, and `aria-expanded` instead of a popup promise
                        this row does not keep. */}
                    <MenuItem
                      expanded={isThemeMenuOpen}
                      aria-controls="chat-theme-menu-inline"
                      onSelect={() => setIsThemeMenuOpen((open) => !open)}
                      leadingIcon={ContrastDecl}
                    >
                      Theme
                    </MenuItem>
                    {/* Inline accordion — grows the ⋯ menu instead of a floating popover. */}
                    <div
                      id="chat-theme-menu-inline"
                      role="region"
                      aria-label="Chat LLM theme"
                      aria-hidden={!isThemeMenuOpen}
                      className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                      style={{
                        gridTemplateRows: isThemeMenuShown ? '1fr' : '0fr',
                        opacity: isThemeMenuShown ? 1 : 0,
                        pointerEvents: isThemeMenuShown ? 'auto' : 'none',
                      }}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div
                          className="mx-1 mb-1 mt-0.5 rounded-md border p-2.5"
                          style={{
                            borderColor: 'var(--chat-border)',
                            backgroundColor: 'var(--chat-canvas)',
                          }}
                          onMouseDown={(event) => event.stopPropagation()}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-medium text-[var(--chat-text)]">
                              Appearance
                            </span>
                            {/* Stays hand-written, and this copy is why the rule is not simply
                                "check the surface". It is the SAME chip as the one in the theme menu,
                                rendered into a second panel — and this panel is `--chat-canvas`,
                                where a `--chat-control` fill would read perfectly well. Converting it
                                and not its twin would give one chip a filled selection and the other
                                a hover-tinted one, for a control the user reads as a single thing.
                                A selection that depends on the surface cannot serve a control that
                                appears on two of them. */}
                            <button
                              type="button"
                              aria-pressed={chatTheme === 'system'}
                              onClick={() => handleChatThemeChange('system', false)}
                              className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors active:scale-[0.98] ${
                                chatTheme === 'system'
                                  ? 'border-[var(--chat-border)] bg-[var(--chat-hover)] text-[var(--chat-text)]'
                                  : 'border-[var(--chat-border)] text-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]'
                              }`}
                            >
                              <Monitor size={13} aria-hidden="true" />
                              System
                            </button>
                          </div>
                          <p className="mt-1 text-[11px] text-[var(--chat-muted)]">
                            {chatTheme === 'system'
                              ? 'Following your device'
                              : `Theme ${displayedThemeSliderPosition}%`}
                          </p>
                          <div className="mt-3 px-1">
                            <div className="chat-theme-waveform-control relative">
                              <div className="chat-theme-waveform" aria-hidden="true">
                                {Array.from(
                                  { length: THEME_WAVEFORM_BAR_COUNT },
                                  (_, index) => {
                                    const position = index * THEME_BRIGHTNESS_STEP;
                                    const isThemeStop =
                                      index === 0 ||
                                      index ===
                                        Math.floor(THEME_WAVEFORM_BAR_COUNT / 2) ||
                                      index === THEME_WAVEFORM_BAR_COUNT - 1;
                                    const isSelected =
                                      position === displayedThemeSliderPosition;
                                    return (
                                      <span
                                        key={index}
                                        className="chat-theme-waveform-bar"
                                        data-stop={isThemeStop}
                                        data-selected={isSelected}
                                        data-percentage={position}
                                        style={{
                                          backgroundColor:
                                            getThemePreviewTokens(position).canvas,
                                        }}
                                      />
                                    );
                                  },
                                )}
                              </div>
                              <input
                                className="chat-theme-slider"
                                type="range"
                                min="0"
                                max="100"
                                step={THEME_BRIGHTNESS_STEP}
                                value={displayedThemeSliderPosition}
                                aria-label="Theme brightness"
                                aria-valuetext={getThemeSliderValueText(
                                  displayedThemeSliderPosition,
                                )}
                                onChange={(event) =>
                                  setThemePreviewPosition(
                                    Number(event.currentTarget.value),
                                  )
                                }
                                onPointerUp={(event) =>
                                  commitThemeSliderPosition(
                                    Number(event.currentTarget.value),
                                  )
                                }
                                onPointerCancel={() => setThemePreviewPosition(null)}
                                onKeyUp={(event) => {
                                  if (
                                    !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                                      event.key,
                                    )
                                  ) {
                                    return;
                                  }
                                  commitThemeSliderPosition(
                                    Number(event.currentTarget.value),
                                  );
                                }}
                              />
                            </div>
                            <div className="mt-2 grid grid-cols-3 text-[10px] text-[var(--chat-muted)]">
                              {VISUAL_CHAT_THEME_OPTIONS.map((option, index) => (
                                <span
                                  key={option.id}
                                  className={
                                    index === 0
                                      ? 'text-left'
                                      : index === 1
                                        ? 'text-center'
                                        : 'text-right'
                                  }
                                >
                                  {option.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* `selected`, not `aria-pressed`: this is a checkable row in a menu, and the
                      component says so in the role (`menuitemcheckbox`) as well as the mark. The
                      check takes the leading slot from the glyph, which is the grammar — one slot,
                      one answer to "is this on". */}
                  <MenuItem
                    selected={isTemporaryChat}
                    onSelect={() => setIsTemporaryChat((current) => !current)}
                    leadingIcon={UserRoundXDecl}
                  >
                    Temporary chat
                  </MenuItem>

                  <div className="my-1 border-t border-[var(--chat-border)]" />

                  <MenuItem
                    onSelect={(event) => {
                      openCustomizePage(event.currentTarget);
                      setIsChatMoreMenuOpen(false);
                    }}
                    leadingIcon={BriefcaseDecl}
                  >
                    Customize
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      setIsMessageSearchOpen(true);
                      setIsChatMoreMenuOpen(false);
                }}
                    leadingIcon={SearchDecl}
                  >
                    Search messages
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      openChatSettings();
                      setIsChatMoreMenuOpen(false);
                    }}
                    leadingIcon={GearDecl}
                  >
                    Settings
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      handleNewChat();
                      setIsChatMoreMenuOpen(false);
                    }}
                    leadingIcon={EditDecl}
                  >
                    New chat
                  </MenuItem>
                </div>
                </>
                )}
              </div>
              )}

            <div className="relative flex-shrink-0">
              {(isMultiInterface || messages.length === 0) ? (
              <div className="flex items-center gap-1.5">
              <IconButton
                  ref={customizeButtonRef}
                  icon={BriefcaseDecl}
                  variant="quiet"
                  size="lg"
                  iconSize={16}
                  className="chat-top-bar-btn hidden sm:flex"
                  onClick={(event) => {
                    openCustomizePage(event.currentTarget);
                    setIsSettingsModalOpen(false);
                    setIsChatMoreMenuOpen(false);
                    setIsSharePreviewOpen(false);
                    setIsThemeMenuOpen(false);
                  }}
                  data-selection={isCustomizePageOpen ? 'on' : 'off'}
                  aria-label="Customize"
                  title="Customize"
              />
              <IconButton
                  ref={settingsButtonRef}
                  icon={GearDecl}
                  variant="quiet"
                  size="lg"
                  iconSize={16}
                  className="chat-top-bar-btn"
                  onClick={() => {
                    if (isSettingsModalOpen) {
                      closeChatSettings();
                    } else {
                      openChatSettings();
                    }
                    setIsChatMoreMenuOpen(false);
                    setIsSharePreviewOpen(false);
                    setIsThemeMenuOpen(false);
                  }}
                  data-selection={isSettingsModalOpen ? 'on' : 'off'}
                  aria-label="Chat settings"
                  title="Chat settings"
              />
              <IconButton
                  icon={MenuDecl}
                  variant="quiet"
                  size="lg"
                  iconSize={16}
                  className="chat-top-bar-btn md:hidden"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('open_mobile_taskbar'));
                  }}
                  aria-label="All products & tools"
                  title="All products & tools"
              />
              </div>
              ) : (
                <button
                  ref={settingsButtonRef}
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
                />
              )}
            </div>
          </div>
          {!isMultiInterface && (
            <div
              className="ml-auto h-9 flex-shrink-0"
              style={{ width: messages.length === 0 ? (isMobile ? '7.5rem' : '15.5rem') : (isMobile ? '7.5rem' : '5.25rem') }}
              aria-hidden="true"
            />
          )}
          </div>
        </div>

        {/* Message Search Bar */}
        {isMessageSearchOpen && (
          <div className="w-full border-b border-[var(--chat-border)] bg-[var(--chat-canvas)] px-4 py-2">
            <div className={`${isMultiInterface ? 'max-w-full' : (isWideChatEnabled ? 'max-w-[67.5rem]' : 'max-w-[45rem]')} mx-auto`}>
              <div className="relative">
                {/* Stays hand-written, for two reasons that each hold alone. The fill is
                    `--chat-surface` — a raised bar — where `.xeno-input` hard-codes `--xeno-canvas`.
                    And the box HOSTS a control: a clear button sits inside it on the right, and
                    `TextInput` has a leading slot and nothing on the trailing edge. Same missing
                    trailing slot the `iconReveal` note records for Button. */}
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 transform text-[var(--chat-muted)]" />
                <input
                  type="text"
                  placeholder="Search in conversation..."
                  value={messageSearchQuery}
                  onChange={(e) => setMessageSearchQuery(e.target.value)}
                  autoFocus
                  className="w-full rounded-lg border border-[var(--chat-border)] bg-[var(--chat-surface)] py-2 pl-10 pr-10 text-sm text-[var(--chat-text)] outline-none placeholder:text-[var(--chat-muted)] focus:border-[var(--chat-accent)]"
                />
                {messageSearchQuery && (
                  <button
                    onClick={() => setMessageSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 transform text-[var(--chat-muted)] hover:text-[var(--chat-text)]"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              {messageSearchQuery && (
                <p className="ml-1 mt-1.5 text-xs text-[var(--chat-muted)]">
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

        {/* Chat Messages Area — same max width + centering as the conversation composer. */}
        <div
          ref={chatAreaRef}
          translate="no"
          className="hide-scrollbar flex-grow w-full overflow-y-auto px-2 pt-16 pb-56 md:pb-60 main-content-transition notranslate"
          style={{
            // Match composer clearance when history is open so the column stays centered.
            paddingLeft: !isMultiInterface && isHistoryOpen && !isMobile ? 260 : undefined,
          }}
        >
                        {/* `clip`, not `hidden`: it contains the same overflow, but `hidden`
                            makes this column a scroll container, and a sticky descendant
                            then resolves against THIS box instead of the message list that
                            actually scrolls — which is why pinned code-block headers never
                            pinned. `clip` is not a scroll container, so sticky passes through.

                            `overflow-clip-margin` is the other half of that swap, and the reason it
                            is worth having: a focus ring paints 4px outside its button (2px offset,
                            2px wide), the message action bar is the LAST row in this column, and the
                            column's edge lands exactly on it — so a focused 👍 / 👎 had its ring
                            sliced along the bottom. The margin lets painting spill that far past the
                            clip edge without letting content scroll or bleed. `hidden` has no such
                            escape hatch; only `clip` does. */}
                        <div className={`${isMultiInterface ? 'max-w-full px-2' : (isWideChatEnabled ? 'max-w-[72rem]' : 'max-w-[52rem]')} w-full space-y-1 [overflow:clip] [overflow-clip-margin:4px] ${
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
            
            {messages.length > 0 && (
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

                    // Date separators (e.g. "Wednesday, July 15") are hidden for now —
                    // kept helpers above if we bring them back later.
                    const dateSeparatorElement = null;

                    if (message.isThinkingPlaceholder) {
                        // Animated thinking placeholder with live timer
                        const isRefinementPlaceholder = message.id === aiRefinementPlaceholderId;
                        return (
                            <div key={message.id} className="flex justify-start w-full pl-[1.125rem]">
                                {isRefinementPlaceholder ? (
                                    <div className="flex items-center gap-2 bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-lg px-3 py-1.5 text-sm">
                                        <span className="flex h-2 w-2 relative mr-1">
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--chat-muted)] animate-pulse"></span>
                                        </span>
                                        <span className="text-[var(--chat-muted)]">Okay, let me figure out{ellipsisText}</span>
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
                                <ThinkingStatus
                                    mode={emptyStateMode}
                                    searching={isXenoSearchEnabled}
                                />
                            </div>
                        );
                    } else if (message.isCancelled) {
                        return (
                            <div key={message.id} className="group relative flex justify-start w-full">
                                <div className="flex items-center"> {/* Flex row for both elements */}
                                    <div className="flex items-center gap-2 bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--chat-muted)] italic">
                                        <MessageSquareX size={16} className="mr-1 flex-shrink-0" /> 
                                        <span>{message.isXenoSearchCancelled ? message.text : 'Request Aborted'}</span>
                                    </div>
                                    <div 
                                        onClick={() => message.isXenoSearchCancelled ? handleTryWithoutSearch(message.id) : handleRegenerate(message.id)}
                                        className="ml-3 text-xs font-sans font-medium text-[var(--chat-muted)] hover:text-[var(--chat-text)] cursor-pointer opacity-0 group-hover:opacity-100 transition-all duration-150 ease-in-out"
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
                            className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} ${firstMessageTopMargin} ${
                              messageMatchesSearch ? 'bg-[var(--chat-accent-soft)] border-l-2 border-[var(--chat-accent)] -ml-0.5 pl-0.5' : ''
                            }`}
                          >
                           {isUser ? (
                               editingMessageId === message.id ? (
                                     <div
                                         className="chat-message-editor flex w-full max-w-[98%] flex-col gap-2 rounded-xl border border-[var(--chat-border)] bg-[var(--chat-surface)] p-2 text-[var(--chat-text)] md:max-w-[88%]"
                                     >
                                         <div className="rounded-lg border border-[var(--chat-accent)]/70 bg-[var(--chat-canvas)]/40 px-2.5 py-2 transition-colors focus-within:border-[var(--chat-accent)] focus-within:ring-1 focus-within:ring-[var(--chat-accent)]/25">
                                         {/* Stays hand-written — bare inside a box it does not
                                             own. The `--chat-canvas`/40 plate around it carries the
                                             border, the radius and a `focus-within` ring that
                                             brightens to accent, which is why the field itself is
                                             `bg-transparent` with no outline. Giving it
                                             `.xeno-textarea` would draw a second bordered card
                                             inside the one already lighting up. */}
                                         <textarea
                                             ref={editInputRef}
                                             value={editText}
                                             onChange={(e) => setEditText(e.target.value)}
                                             className="min-h-[2.75rem] w-full resize-y bg-transparent text-[15px] leading-6 text-[var(--chat-text)] outline-none"
                                               rows={1}
                                           />
                                         </div>
                                         <div className="flex items-start gap-1.5 text-xs leading-4 text-[var(--chat-muted)]">
                                           <Info size={13} className="mt-0.5 flex-shrink-0 text-[var(--chat-muted)]" aria-hidden="true" />
                                           <p>
                                             Editing this message will create a new conversation branch. You can switch between branches using the arrow navigation buttons.
                                           </p>
                                         </div>
                                         <div className="flex items-center justify-end gap-1.5">
                                           {/* `secondary sm` word for word: a hairline, a
                                               `--chat-control` fill, full ink, and a `--chat-hover`
                                               tint on top when reached for. 13px type is sm's own. */}
                                           <Button
                                             variant="secondary"
                                             size="sm"
                                             onClick={handleCancelEdit}
                                             aria-label="Cancel edit"
                                           >
                                             Cancel
                                           </Button>
                                           {/* `primary sm`, and the pair is whole for the first
                                               time — this was the Cancel/confirm where only the
                                               Cancel could convert. The fill is an exact swap:
                                               `--chat-accent` and `--chat-text` are the same value at
                                               every theme stop (measured dark #fafafa, light #0a0a0a,
                                               65% #f5f6f8), and `primary` paints `--chat-text` on
                                               `--chat-on-accent` now that the bridge carries the
                                               chrome tokens.
                                               One thing does change, deliberately: the hover was
                                               `opacity-90`, which fades the ink along with the fill.
                                               The variant lays a `--chat-hover` tint over the fill
                                               instead, so the label stays at full strength. 13px type
                                               is sm's own, matching the Cancel beside it. */}
                                           <Button
                                             variant="primary"
                                             size="sm"
                                             onClick={() => void handleSaveEdit()}
                                             aria-label="Save changes"
                                           >
                                             Save
                                           </Button>
                                           </div>
                                       </div>
                                  ) : (
                                     (() => {
                                             const imageAttachments = (
                                               message.userImageAttachments?.length
                                                 ? message.userImageAttachments
                                                 : message.userImageAttachment
                                                   ? [message.userImageAttachment]
                                                   : []
                                             ).filter((img) => img.file || img.base64Data);

                                             const openUserImageFullView = (img: typeof imageAttachments[number]) => {
                                               const url = img.base64Data
                                                 ? `data:${img.type};base64,${img.base64Data}`
                                                 : img.file
                                                   ? URL.createObjectURL(img.file)
                                                   : null;
                                               if (!url) return;
                                               setFullScreenImageUrl((prev) => {
                                                 if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
                                                 return url;
                                               });
                                                      setIsFullScreenImageOpen(true);
                                                      setViewerShowsDownloadButton(true);
                                             };

                                             const hasAttachments =
                                               imageAttachments.length > 0 ||
                                               Boolean(
                                                 message.userFileAttachment &&
                                                   (message.userFileAttachment.file || message.userFileAttachment.content),
                                               );

                                             return (
                                               <MessageBubble
                                                 role="user"
                                                 data-message-id={message.id}
                                                 // No `group` any more: it existed so `group-hover:` could
                                                 // reveal the action bar, and the component reveals its own
                                                 // on `:hover`/`:focus-within` of the turn.
                                                 className="chat-message-bubble"
                                                 timestamp={message.timestamp ? formatMessageTime(message.timestamp) : undefined}
                                                 attachments={hasAttachments ? (
                                                   <>
                                                 {imageAttachments.length > 0 && (
                                                   <div className="flex max-w-full flex-row flex-wrap items-end justify-end gap-1.5">
                                                     {imageAttachments.map((img, imageIndex) => {
                                                       const src = img.base64Data
                                                         ? `data:${img.type};base64,${img.base64Data}`
                                                         : img.file
                                                           ? URL.createObjectURL(img.file)
                                                           : '';
                                                       if (!src) return null;
                                                       /* Stays hand-written: a 148 x 200 image card.
                                                          Its whole surface is the picture — no ink, no
                                                          fill, no border and no label for a variant to
                                                          decide, and the only chrome is a focus ring.
                                                          A `Button` would add a control's height and
                                                          side padding around an object that is already
                                                          the right size. */
                                                       return (
                                                         <button
                                                           key={`${message.id}-img-${imageIndex}-${img.name}`}
                                                           type="button"
                                                           onClick={() => openUserImageFullView(img)}
                                                           aria-label={`View ${img.name} full size`}
                                                           className="block h-[200px] w-[148px] flex-shrink-0 overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--chat-muted)]"
                                                         >
                                                           <img
                                                             src={src}
                                                             alt={img.name}
                                                             className="h-full w-full cursor-pointer object-cover transition-opacity hover:opacity-95"
                                                           />
                                                         </button>
                                                       );
                                                     })}
                                             </div>
                                           )}

                                           {message.userFileAttachment && (message.userFileAttachment.file || message.userFileAttachment.content) && (
                                            /* A BUTTON, not a `<div onClick>`. It opens the file in
                                                the context panel, so a keyboard has to reach it —
                                                and did not. `text-left` because a button centres its
                                                content and this row is a filename that truncates.
                                                Stays hand-written otherwise: it is a content row on
                                                a message, where `ListRow` is the eventual answer and
                                                would also decide how the message list is traversed. */
                                            <button
                                                     type="button"
                                                     className="ml-auto mr-0 flex max-w-[250px] cursor-pointer items-center gap-2.5 rounded-lg border border-[var(--chat-border)] bg-[var(--chat-surface)] p-2 text-left transition-colors hover:bg-[var(--chat-hover)]"
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
                                                    handleShowFileInContextPanel(message.userFileAttachment as any);
                                                  }
                                                }
                                              }}
                                            >
                                                     <FileText size={17} className="flex-shrink-0 text-[var(--chat-muted)]" />
                                                     <span className="truncate text-sm text-[var(--chat-text)]" title={message.userFileAttachment.name}>
                                                {message.userFileAttachment.name}
                                              </span>
                                            </button>
                                           )}

                                                   </>
                                                 ) : undefined}
                                                 actions={
                                                   <>
                                               <IconButton
                                                   icon={RefreshDecl}
                                                   size="sm"
                                                   iconSize={14}
                                                   onClick={() => void handleRetryFromUserMessage(message.id)}
                                                   disabled={isLoading}
                                                   aria-label="Retry from this message"
                                                   title="Retry"
                                               />
                                               <IconButton
                                                   icon={EditDecl}
                                                   size="sm"
                                                   iconSize={14}
                                                   onClick={() => handleEditUserMessage(message.id, message.text)}
                                                   aria-label="Edit message"
                                               />
                                               {/* `data-selection` is what makes the check DRAW rather than
                                                   appear. The stroke only animates while a trigger matches,
                                                   and hover is not one you can rely on here: click and move
                                                   the mouse away, as people do, and the tick was simply
                                                   there, already finished. Selection needs no pointer.

                                                   And the tick is the text colour, not green. A confirmation
                                                   that introduces a hue the theme does not own reads as a
                                                   status badge; what happened is that a button did its job. */}
                                               <IconButton
                                                 icon={copiedMessageId === message.id ? CheckDecl : CopyDecl}
                                                 size="sm"
                                                 iconSize={14}
                                                 onClick={() => handleCopyUserMessage(message.text, message.id)}
                                                 data-selection={copiedMessageId === message.id ? 'on' : 'off'}
                                                 aria-label="Copy message"
                                               />
                                                   </>
                                                 }
                                               >
                                                 {message.text || undefined}
                                               </MessageBubble>
                                             );
                                           })()
                                   )
                               ) : (
                                   // --- AI Message ---
                                   <div data-message-id={message.id} className="group flex w-full flex-col items-start space-y-0.5">

                                      {/* Full message edit mode - transforms entire container into input box */}
                                      {editingAiMessageId === message.id ? (
                                        <div className="w-full bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-2xl p-4">
                                          <div className="flex items-center gap-2 mb-3">
                                            <Pencil size={14} className="text-[var(--chat-muted)]" />
                                            <span className="text-sm text-[var(--chat-muted)]">Editing Response</span>
                                            <span className="text-xs text-[var(--chat-muted)] ml-auto">Markdown supported</span>
                                          </div>
                                          {/* Stays hand-written for the fill, and this one is
                                              deliberate flat-on-flat: the field is `--chat-surface`
                                              on a `--chat-surface` card, separated by its border
                                              alone. `.xeno-textarea` would paint `--xeno-canvas` and
                                              punch a dark well into the middle of the card. */}
                                          <textarea
                                            value={editingAiContent}
                                            onChange={(e) => setEditingAiContent(e.target.value)}
                                            className="w-full min-h-[300px] max-h-[600px] p-4 bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-xl text-[var(--chat-text)] text-sm resize-y focus:outline-none focus:border-[var(--chat-muted)] leading-relaxed"
                                            placeholder="Edit AI response..."
                                            autoFocus
                                            spellCheck={false}
                                          />
                                          <div className="flex items-center justify-end gap-2 mt-3">
                                            {/* `ghost md`: no fill, no border, muted ink coming up
                                                to full under the pointer, at 12px padding and 14px
                                                type which are md's own. It gains the variant's
                                                `--chat-hover` tint on hover, which this one brightened
                                                the ink alone for. */}
                                            <Button
                                              variant="ghost"
                                              size="md"
                                              onClick={handleCancelAiEdit}
                                            >
                                              Cancel
                                            </Button>
                                            {/* `primary md`, matching the `ghost md` Cancel it
                                                stands next to. It had been ~28px against that
                                                Cancel's 32 — the pair now has one height as well as
                                                one grammar, which is what a Cancel/confirm pair is
                                                supposed to look like. Same exact-swap fill and same
                                                deliberate hover change as its twin above. */}
                                            <Button
                                              variant="primary"
                                              size="md"
                                              onClick={handleSaveAiEdit}
                                            >
                                              Save
                                            </Button>
                                          </div>
                                        </div>
                                      ) : (
                                      <>
                                      {/* 1. Thoughts — compact toggle + gradually expanding content */}
                                      {message.hasThinking && (
                                          <div className="w-full pl-[1.125rem]">
                                              {/* Stays hand-written: a line of text with 2px of
                                                  vertical padding and no box at all, whose leading
                                                  mark is `.xeno-model-cube` — an animated cube this
                                                  chat draws itself, not a glyph. `leadingIcon` takes a
                                                  declaration, and a `Button` would put a 32px control
                                                  around a label that sits inline with the message
                                                  above it. */}
                                              <button
                                                  type="button"
                                                  onClick={() => setShowThinkingId(showThinkingId === message.id ? null : message.id)}
                                                  className="inline-flex items-center gap-2 py-0.5 text-[13px] transition-colors"
                                              >
                                                  <span className="xeno-model-cube" aria-hidden="true" />
                                                  <span className="font-semibold text-[var(--chat-text)]">
                                                      {(message.modelIdUsed?.split('/').pop() || 'Model')}
                                                      {message.thinkingDuration !== undefined && message.thinkingDuration >= 0 && (
                                                          <span className="ml-1.5 font-medium text-[var(--chat-muted)]">· {message.thinkingDuration}s</span>
                                                      )}
                                                  </span>
                                                  <ChevronDown size={14} className={`text-[var(--chat-muted)] transition-transform duration-200 ${showThinkingId === message.id ? 'rotate-180' : ''}`} />
                                              </button>
                                              <div className={`chat-collapsible ${showThinkingId === message.id ? 'chat-collapsible-open' : ''}`}>
                                                <div className="chat-collapsible-inner">
                                                  <div className="chat-collapsible-content mt-1.5 border-l-2 border-[var(--chat-border)] pl-3 text-sm prose prose-sm prose-invert max-w-none text-[var(--chat-muted)] prose-p:my-2 prose-li:my-0.5 prose-ol:pl-5 prose-ul:pl-5 prose-headings:text-[var(--chat-text)] prose-headings:font-medium leading-relaxed">
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
                                                                                language={match ? match[1] : "plaintext"} theme={resolvedChatTheme === 'light' ? 'light' : 'dark'}
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
                                                                          return <code className="bg-[var(--chat-surface)] rounded px-2 py-1 font-mono text-[15px] text-[var(--chat-text)] align-middle max-w-full">{codeString}</code>; 
                                                                      } 
                                                                  } 
                                                                  return <code className={className} {...props}>{children}</code>; 
                                                              }, 
                                                          }} 
                                                      > 
                                                          {message.thinkingContent || ''} 
                                                              </ReactMarkdown>
                                                  ) : (
                                                      <p className="text-[var(--chat-muted)] italic text-sm">
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
 
                                      {/* 2. Grounding Info Box - Xeno Search Sources */}
                                      {/* Show Xeno Search Loading Animation or Results - Only when Xeno Search was actually used */}
                                      {((message.isLoading && message.searchInfo && isXenoSearchEnabled) ||
                                        (!message.isLoading && message.searchInfo &&
                                         ((message.searchInfo.queries?.length ?? 0) > 0 || (message.searchInfo.sources?.length ?? 0) > 0))) ? (
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
                                                            {/* Header — always visible, and a BUTTON.
                                                                It was a `<div onClick>`: a mouse
                                                                reached it and a keyboard reached
                                                                nothing.
                                                                Stays hand-written, for now: the class
                                                                it wears is the
                                                                library's own, and `SourcesDisclosure`
                                                                renders that same class on a button
                                                                with `aria-expanded` — the stylesheet
                                                                had been adopted and the behaviour left
                                                                behind, which is the one kind of
                                                                borrowing that looks finished and is
                                                                not. Taking the component whole is the
                                                                eventual answer; it owns the content
                                                                model too, and this header carries a
                                                                title, a count line and a favicon stack
                                                                with its own colour logic. */}
                                                            <button
                                                                type="button"
                                                                className="xeno-sources-header"
                                                                aria-expanded={isExpanded ? true : false}
                                                                aria-controls={`sources-panel-${message.id}`}
                                                                onClick={() => setExpandedSourcesMap(prev => ({ ...prev, [message.id]: !prev[message.id] }))}
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <div className="xeno-sources-icon">
                                                                        <Globe size={16} className="text-[var(--chat-muted)]" />
                                                                    </div>
                                                                    <div>
                                                                        <div className="xeno-sources-title">Web Sources</div>
                                                                        <div className="text-xs text-[var(--chat-muted)]">{sourceCount} page{sourceCount !== 1 ? 's' : ''} found</div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-3">
                                                                    {/* Favicon stack */}
                                                                    <div className="flex -space-x-1.5">
                                                                        {sources.slice(0, 4).map((source, idx) => {
                                                                            const actualUrl = extractActualUrl(source.uri);
                                                                            const favicon = sourceMetadataCache[actualUrl]?.favicon;
                                                                            return (
                                                                                <div key={idx} style={{ background: favicon ? 'var(--chat-hover)' : sourceBadgeColor(actualUrl) }} className="w-6 h-6 rounded-md border-2 border-[var(--chat-surface)] flex items-center justify-center overflow-hidden font-mono text-[8px] font-bold text-[var(--chat-text)]">
                                                                                    {favicon ? (
                                                                                        <img src={favicon} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                                                    ) : (
                                                                                        <span>{sourceBadgeInitials(actualUrl)}</span>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                        {sourceCount > 4 && (
                                                                            <div className="w-6 h-6 rounded-md bg-[var(--chat-surface)] border-2 border-[var(--chat-surface)] flex items-center justify-center text-xs text-[var(--chat-muted)] font-medium">
                                                                                +{sourceCount - 4}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <ChevronDown size={16} className={`text-[var(--chat-muted)] transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                                                </div>
                                                            </button>

                                                            {/* Expanded sources list */}
                                                            {isExpanded && (
                                                                <div className="xeno-sources-list" id={`sources-panel-${message.id}`}>
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
                                                                                <div className="xeno-source-favicon" style={favicon ? undefined : { background: sourceBadgeColor(domain || source.uri), borderColor: 'transparent', color: '#fff' }}>
                                                                                    {favicon ? (
                                                                                        <img src={favicon} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                                                    ) : (
                                                                                        <span className="font-mono text-[10px] font-bold">{sourceBadgeInitials(domain || source.uri)}</span>
                                                                                    )}
                                                                                </div>
                                                                                <div className="flex-1 min-w-0">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className="xeno-source-number">
                                                                                            {idx + 1}
                                                                                        </span>
                                                                                        <span className="text-sm font-medium text-[var(--chat-text)] truncate transition-colors">
                                                                                            {source.title || domain}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div className="text-xs text-[var(--chat-muted)] mt-0.5 truncate flex items-center gap-1">
                                                                                        <ExternalLink size={10} className="text-[var(--chat-muted)]" />
                                                                                        {domain}
                                                                                    </div>
                                                                                </div>
                                                                                <ExternalLink size={14} className="text-[var(--chat-muted)] transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100" />
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
                                                      <div className="w-2 h-2 rounded-full bg-[var(--chat-muted)] dot"></div>
                                                      <div className="w-2 h-2 rounded-full bg-[var(--chat-muted)] dot"></div>
                                                      <div className="w-2 h-2 rounded-full bg-[var(--chat-muted)] dot"></div>
                                                  </div>
                                                  <span className="text-[var(--chat-muted)] text-sm">Generating response...</span>
                                              </div>
                                          )}

                                          {message.isError && message.text && (
                                              <div className={`prose prose-sm prose-invert max-w-none text-[var(--chat-danger)] prose-strong:text-[var(--chat-danger)] prose-p:my-1.5 prose-li:my-0.5 prose-ol:pl-5 prose-ul:pl-5`}>
                                                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{message.text}</ReactMarkdown> 
                                              </div>
                                          )}

                                          {(message.isGeneratingImage || message.imageData) && (
                                              <ImageContainer message={message} />
                                          )}

                                          {!message.isError && (message.parsedAnswer || message.isStreaming) && (
                                                  /* Do not put prose-pre:bg-* / child bg utilities on this wrapper:
                                                     theme CSS uses [class*="bg-…"] and would paint the whole answer. */
                                                  <div className="prose prose-sm max-w-none prose-strong:font-bold prose-code:px-2 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-[15px] prose-code:font-normal prose-code:font-medium prose-code:before:content-none prose-code:after:content-none prose-pre:rounded-lg prose-pre:border prose-pre:border-[var(--chat-border)] prose-pre:p-4 prose-pre:font-mono prose-pre:text-[15px] prose-pre:overflow-x-auto">
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
                                                                        language={match ? match[1] : "plaintext"} theme={resolvedChatTheme === 'light' ? 'light' : 'dark'}
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
                                                                      return <code className="bg-[var(--chat-surface)] rounded px-2 py-1 font-mono text-[15px] text-[var(--chat-text)] align-middle max-w-full">{codeString}</code>;
                                                                  }
                                                              }
                                                              return <code className={className} {...props}>{children}</code>;
    },
  }}
>
  {message.parsedAnswer}
</ReactMarkdown>
                                               {/* Streaming caret removed to match the XENO model (no vertical caret). */}
                                               </div>
                                          )}
                                      </div>
                                       
                                      {/* 4. Action Buttons */}
                                      {!message.isError && !message.isLoading && !message.isStreaming && message.parsedAnswer && (
                                          <div
                                              className={`flex items-center justify-between pl-3 action-buttons
                                                ${isLastAiMessage
                                                  ? 'opacity-100 visible'
                                                  : 'opacity-0 group-hover:opacity-100 invisible group-hover:visible transition-opacity duration-150'
                                                }`}
                                           >
                                              {/* gap-0.5 = 2px, the gap the library's own message action bar
                                                  uses. The user turn is that component now, so an 8px bar on
                                                  this side and a 2px bar on the other put two rhythms in one
                                                  transcript. 2 is the system's answer: the buttons are 28px
                                                  boxes around 14px glyphs, so most of the air is already
                                                  inside them and adding 8 more reads as a toolbar. */}
                                              <div className="flex items-center gap-0.5">
                                                  {/* `xeno-icon-hover` on every one of these: it is the library's generic "this element hosts
                                                      the glyph inside it" hook, and a glyph's motion is triggered by its HOST rather than by
                                                      itself. Without it the icons sat still — the animations were all there, with nothing to
                                                      listen to. */}
                                                  <IconButton
                                                      icon={RefreshDecl}
                                                      size="sm"
                                                      iconSize={14}
                                                      onClick={() => handleRegenerate(message.id)}
                                                      aria-label="Regenerate response"
                                                  />
                                                  {/* The tick is the glyph SWAPPED, not a second element: one
                                                      button, two declarations. `data-selection` still drives the
                                                      draw, and `<IconButton>` forwards it untouched. */}
                                                  <IconButton
                                                      icon={copiedAiMessageId === message.id ? CheckDecl : CopyDecl}
                                                      size="sm"
                                                      iconSize={14}
                                                      onClick={() => handleCopy(message.parsedAnswer, message.id)}
                                                      aria-label="Copy response"
                                                      data-selection={copiedAiMessageId === message.id ? 'on' : 'off'}
                                                      disabled={copiedAiMessageId === message.id}
                                                  />
                                                  <IconButton
                                                      icon={EditDecl}
                                                      size="sm"
                                                      iconSize={14}
                                                      onClick={() => handleEditAiMessage(message.id, message.parsedAnswer || message.text || '')}
                                                      aria-label="Edit response"
                                                      disabled={editingAiMessageId !== null}
                                                  />
                                                  {/* Active reads as the text colour against the muted rest —
                                                      brightness, not a hue. `className` rides on top of the
                                                      button's own, so the variant keeps its hover. */}
                                                  <IconButton
                                                      icon={ThumbsUpDecl}
                                                      size="sm"
                                                      iconSize={14}
                                                      onClick={(e) => handleOpenFeedbackPopup(e, message.id)}
                                                      data-selection={feedbackStatusMap[message.id] === 'liked' ? 'on' : 'off'}
                                                      aria-label="Like response"
                                                  />
                                                  {/* Active reads as the text colour against the muted rest —
                                                      brightness, not a hue. `className` rides on top of the
                                                      button's own, so the variant keeps its hover. */}
                                                  <IconButton
                                                      icon={ThumbsDownDecl}
                                                      size="sm"
                                                      iconSize={14}
                                                      onClick={(e) => handleOpenDislikePopup(e, message.id)}
                                                      data-selection={feedbackStatusMap[message.id] === 'disliked' ? 'on' : 'off'}
                                                      aria-label="Dislike response"
                                                  />
                                                  {message.modelIdUsed && (
                                                      <IconButton
                                                          icon={InfoDecl}
                                                          size="sm"
                                                          iconSize={14}
                                                          onClick={() => setExpandedInfoMessageId(
                                                              expandedInfoMessageId === message.id ? null : message.id
                                                          )}
                                                          data-selection={expandedInfoMessageId === message.id ? 'on' : 'off'}
                                                          aria-label="Show model info"
                                                      />
                                                  )}
                                              </div>
                                              {/* Inline Info Display */}
                                              {expandedInfoMessageId === message.id && message.modelIdUsed && (
                                                  // A step down from the action bar's own size and set
                                                  // off from it: this is a footnote about the message,
                                                  // not another control in the row, and at text-xs
                                                  // butted against the ⓘ it read as one.
                                                  <div className="ml-2 flex items-center gap-3 text-[11px] text-[var(--chat-muted)]">
                                                      {message.timestamp && (
                                                          <span className="text-[var(--chat-muted)]">{formatMessageTime(message.timestamp)}</span>
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

        {/* Bottom Input Section — when history is open (desktop), shift right so
            the composer + update cards clear the sidebar (same size, not moved up). */}
        <div className={`${isMultiInterface ? 'max-w-full px-2' : (messages.length === 0 ? 'max-w-[56rem]' : (isWideChatEnabled ? 'max-w-[72rem]' : 'max-w-[52rem]'))} w-full px-2 md:px-4 absolute left-0 right-0 z-10 main-content-transition ${
          messages.length === 0
            ? `top-1/2 max-h-[calc(100dvh-5rem)] -translate-y-1/2 py-4 pb-2 md:pb-4 hide-scrollbar ${isMobile || isMultiInterface ? 'overflow-y-auto' : 'overflow-visible'}`
            : 'bottom-0 overflow-visible pb-2 md:pb-3'
        } ${
          isMultiInterface ? 'mx-auto' : (
            chatAlignment === 'left' ? 'ml-0 mr-auto' :
            chatAlignment === 'right' ? 'ml-auto mr-0' :
            'mx-auto'
          )
        }`}
             style={{
               left: !isMultiInterface && isHistoryOpen && !isMobile ? '260px' : '0px',
               right: isContextPanelOpen && !isMultiInterface ? `${contextPanelWidth}px` : '0px',
             }}
        >
          {/* Subtle mask so message text fades gently before it reaches the floating composer. */}
          {messages.length > 0 && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 top-6 -z-10 bg-[var(--chat-canvas,#0a0a0a)]"
              style={{
                maskImage: 'linear-gradient(to bottom, transparent 0px, black 16px)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0px, black 16px)',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
              }}
            />
          )}
          {/* Scroll to bottom — centered above the prompt input container. While the
              composer's floating mode row is up it moves INTO that row instead (see
              `scrollAffordance`), because the row is out of flow and lands right here. */}
          {showScrollToBottom && messages.length > 0 && (
            <div data-chat-scroll-to-bottom className="pointer-events-none relative z-20 mb-2 flex justify-center">
              {/* Stays hand-written: it MORPHS. Idle it is a 28px square holding a bouncing
                  chevron; while the model works it stretches to 82px and holds three animated dots
                  that swap for the word "Generating…" under the pointer. Two contents, two widths and
                  two bespoke animations — `.xeno-gen-dots` and `.xeno-chevron-bounce` — where a
                  `Button` is one box with one label. */}
              <button
                type="button"
                onClick={scrollToBottom}
                className={`group pointer-events-auto inline-flex items-center justify-center rounded-lg border border-[var(--chat-border)] bg-[var(--chat-surface)] text-[var(--chat-muted)] shadow-md transition-colors duration-150 hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] focus:outline-none ${(isLoading || messages.some((m) => m.isStreaming)) ? 'h-7 w-[82px]' : 'h-7 w-7'}`}
                aria-label={(isLoading || messages.some((m) => m.isStreaming)) ? 'Generating — scroll to latest' : 'Scroll to bottom'}
              >
                {(isLoading || messages.some((m) => m.isStreaming)) ? (
                  <>
                    <span className="group-hover:hidden"><span className="xeno-gen-dots" aria-hidden="true"><i /><i /><i /></span></span>
                    <span className="hidden whitespace-nowrap text-[11px] font-medium group-hover:inline">
                      {messages.some((m) => m.isDotPlaceholder) ? 'Thinking…' : 'Generating…'}
                    </span>
                  </>
                ) : (
                  <ChevronDown size={18} className="xeno-chevron-bounce" />
                )}
              </button>
            </div>
          )}
          {/* Only mount the primary composer here when NOT inside a project workspace — the
              workspace renders its own instance and they share refs, so only one may exist. */}
          {!activeProjectId && renderPrimaryComposer()}
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
        {/* Presence, not the live state — the popover outlives its info by one exit animation. */}
        {feedbackPopupPresence.rendered && createPortal(renderFeedbackPopup(), document.body)}
        {dislikePopupPresence.rendered && createPortal(renderDislikeFeedbackPopup(), document.body)}
        {isDeleteModalMounted && createPortal(renderDeleteConfirmationModal(), document.body)}
        {isCreateProjectModalMounted && createPortal(renderCreateProjectModal(), document.body)}
        {isProjectSettingsMounted &&
          projectSettings &&
          createPortal(renderProjectSettingsModal(), document.body)}
        {isProjectFilePreviewMounted &&
          projectFilePreview &&
          createPortal(
            <div
              className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} fixed inset-0 z-[999] flex items-center justify-center p-4 backdrop-blur-sm`}
              data-chat-theme-preference={chatTheme}
              data-project-file-preview=""
              style={{
                backgroundColor: isProjectFilePreviewShown
                  ? 'color-mix(in srgb, var(--chat-text) 28%, transparent)'
                  : 'color-mix(in srgb, var(--chat-text) 0%, transparent)',
                transition: `background-color ${SCHEDULE_CREATE_MODAL_MS}ms ${SCHEDULE_DATE_EASE}`,
                ...chatThemePreviewStyle,
              }}
              onClick={closeProjectFilePreview}
            >
              <style>{CHAT_MODAL_KEYFRAMES_CSS}</style>
              <div
                {...projectFilePreviewDialog.panelProps}
                role="dialog"
                aria-modal="true"
                aria-labelledby="project-file-preview-title"
                className="flex h-[min(52rem,90vh)] w-full max-w-[64rem] flex-col overflow-hidden rounded-2xl border"
                style={{
                  backgroundColor: 'var(--chat-elevated)',
                  borderColor: 'var(--chat-border)',
                  color: 'var(--chat-text)',
                  boxShadow:
                    '0 8px 32px color-mix(in srgb, var(--chat-text) 16%, transparent)',
                  ...chatModalCardMotionStyle(
                    'right',
                    isProjectFilePreviewShown,
                    isProjectFilePreviewOpen,
                  ),
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex flex-shrink-0 items-center gap-2 border-b px-4 py-3"
                  style={{ borderColor: 'var(--chat-border)' }}
                >
                  <FileText
                    size={14}
                    className="flex-shrink-0 text-[var(--chat-muted)]"
                    aria-hidden="true"
                  />
                  <h2
                    id="project-file-preview-title"
                    className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-[var(--chat-text)]"
                  >
                    {projectFilePreview.name}
                  </h2>
                  {/* `ghost md` — no fill, no border, muted ink brightening over a `--chat-hover`
                      tint, and 32px is md. The two faces stay ONE button with the ternary in
                      `leadingIcon`, which is what lets the check draw itself over the copy mark
                      instead of replacing it. */}
                  <Button
                    variant="ghost"
                    size="md"
                    iconSize={14}
                    leadingIcon={projectFilePreviewCopied ? CheckDecl : CopyDecl}
                    data-selection={projectFilePreviewCopied ? 'on' : 'off'}
                    onClick={() => void copyProjectFilePreview()}
                    title={projectFilePreviewCopied ? 'Copied' : 'Copy'}
                  >
                    {projectFilePreviewCopied ? 'Copied' : 'Copy'}
                  </Button>
                  <IconButton
                    icon={XDecl}
                    variant="ghost"
                    size="md"
                    iconSize={16}
                    onClick={closeProjectFilePreview}
                    aria-label="Close file preview"
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  <pre className="whitespace-pre-wrap break-words font-mono text-[13.5px] leading-relaxed text-[var(--chat-text)]">
                    {projectFilePreview.content}
                  </pre>
                </div>
              </div>
            </div>,
            document.body,
          )}
        {isProjectScheduledPreviewMounted &&
          projectScheduledPreview &&
          createPortal(
            <div
              className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} fixed inset-0 z-[999] flex items-center justify-center p-4 backdrop-blur-sm`}
              data-chat-theme-preference={chatTheme}
              data-project-scheduled-preview=""
              style={{
                backgroundColor: isProjectScheduledPreviewShown
                  ? 'color-mix(in srgb, var(--chat-text) 28%, transparent)'
                  : 'color-mix(in srgb, var(--chat-text) 0%, transparent)',
                transition: `background-color ${SCHEDULE_CREATE_MODAL_MS}ms ${SCHEDULE_DATE_EASE}`,
                ...chatThemePreviewStyle,
              }}
              onClick={closeProjectScheduledPreview}
            >
              <style>{CHAT_MODAL_KEYFRAMES_CSS}</style>
              <div
                {...projectScheduledPreviewDialog.panelProps}
                role="dialog"
                aria-modal="true"
                aria-labelledby="project-scheduled-preview-title"
                className="flex w-full max-w-[28rem] flex-col overflow-hidden rounded-2xl border"
                style={{
                  backgroundColor: 'var(--chat-elevated)',
                  borderColor: 'var(--chat-border)',
                  color: 'var(--chat-text)',
                  boxShadow:
                    '0 8px 32px color-mix(in srgb, var(--chat-text) 16%, transparent)',
                  ...chatModalCardMotionStyle(
                    'right',
                    isProjectScheduledPreviewShown,
                    isProjectScheduledPreviewOpen,
                  ),
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div
                  className="flex flex-shrink-0 items-center gap-2 border-b px-4 py-3"
                  style={{ borderColor: 'var(--chat-border)' }}
                >
                  <Clock
                    size={14}
                    className="flex-shrink-0 text-[var(--chat-muted)]"
                    aria-hidden="true"
                  />
                  <h2
                    id="project-scheduled-preview-title"
                    className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-[var(--chat-text)]"
                  >
                    Scheduled task
                  </h2>
                  <IconButton
                    icon={XDecl}
                    variant="ghost"
                    size="md"
                    iconSize={16}
                    onClick={closeProjectScheduledPreview}
                    aria-label="Close scheduled task"
                  />
                </div>
                <div className="flex flex-col gap-4 px-4 py-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                      Title
                    </p>
                    <p className="mt-1 text-[14px] font-medium text-[var(--chat-text)]">
                      {projectScheduledPreview.title}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                      When
                    </p>
                    <p className="mt-1 text-[13px] text-[var(--chat-text)]">
                      {projectScheduledPreview.cadence}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                      Mark
                    </p>
                    <p className="mt-1 font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--chat-muted)]">
                      {projectScheduledPreview.mark}
                    </p>
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-[var(--chat-muted)]">
                    Preview only — edit and run land when the scheduler is live.
                  </p>
                </div>
              </div>
            </div>,
            document.body,
          )}
        {isProjectScheduledCreateMounted &&
          createPortal(
            <div
              className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} fixed inset-0 z-[999] flex items-center justify-center p-4 backdrop-blur-sm`}
              data-chat-theme-preference={chatTheme}
              data-project-scheduled-create=""
              style={{
                backgroundColor: isProjectScheduledCreateShown
                  ? 'color-mix(in srgb, var(--chat-text) 28%, transparent)'
                  : 'color-mix(in srgb, var(--chat-text) 0%, transparent)',
                transition: `background-color ${SCHEDULE_CREATE_MODAL_MS}ms ${SCHEDULE_DATE_EASE}`,
                ...chatThemePreviewStyle,
              }}
              onClick={closeProjectScheduledCreate}
            >
              <style>{CHAT_MODAL_KEYFRAMES_CSS}</style>
              <div
                {...projectScheduledCreateDialog.panelProps}
                role="dialog"
                aria-modal="true"
                aria-labelledby="project-scheduled-create-title"
                className="flex w-full max-w-[28rem] flex-col overflow-visible rounded-2xl border will-change-transform"
                style={{
                  backgroundColor: 'var(--chat-elevated)',
                  borderColor: 'var(--chat-border)',
                  color: 'var(--chat-text)',
                  boxShadow:
                    '0 8px 32px color-mix(in srgb, var(--chat-text) 16%, transparent)',
                  ...chatModalCardMotionStyle(
                    'right',
                    isProjectScheduledCreateShown,
                    isProjectScheduledCreateOpen,
                  ),
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div
                  className="flex flex-shrink-0 items-center gap-2 overflow-hidden rounded-t-2xl border-b px-4 py-3"
                  style={{ borderColor: 'var(--chat-border)' }}
                >
                  <Clock
                    size={14}
                    className="flex-shrink-0 text-[var(--chat-muted)]"
                    aria-hidden="true"
                  />
                  <h2
                    id="project-scheduled-create-title"
                    className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-[var(--chat-text)]"
                  >
                    Add scheduled task
                  </h2>
                  <IconButton
                    icon={XDecl}
                    variant="ghost"
                    size="md"
                    iconSize={16}
                    onClick={closeProjectScheduledCreate}
                    aria-label="Close add scheduled task"
                  />
                </div>
                <div className="flex flex-col gap-3 px-4 py-4">
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                      Title
                    </span>
                    {/* Stays hand-written, and both halves of the reason are the familiar ones:
                        `h-10` is 40px where the control scale stops at 36, and the fill is
                        `--chat-surface` because the dialog is a raised card. Neither is a call
                        site's to fix. */}
                    <input
                      type="text"
                      value={projectScheduledCreateTitle}
                      onChange={(event) =>
                        setProjectScheduledCreateTitle(event.target.value)
                      }
                      placeholder="Weekly condition check-in"
                      autoFocus
                      className="h-10 w-full rounded-lg border bg-transparent px-3 text-[13px] text-[var(--chat-text)] outline-none placeholder:text-[var(--chat-muted)]"
                      style={{
                        borderColor: 'var(--chat-border)',
                        backgroundColor: 'var(--chat-surface)',
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          submitProjectScheduledCreate();
                        }
                      }}
                    />
                  </label>
                  <div className="block">
                    <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                      When
                    </span>
                    <div className="relative">
                    {/* Stays hand-written: it is a FIELD, not a button. Full width, label to the
                        left, chevron to the right, and 40px tall where the control scale stops at 36.
                        The library has a field-trigger shape in its motion selectors and no component
                        exported for it, so there is nothing to take. */}
                    <button
                      type="button"
                      onClick={() =>
                        setIsProjectScheduledWhenOpen((open) => {
                          if (open) {
                            resetProjectScheduleDatePanel();
                            resetProjectScheduleTimePanel();
                          }
                          return !open;
                        })
                      }
                      aria-expanded={isProjectScheduledWhenOpen}
                      className="relative z-20 flex h-10 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-[13px] text-[var(--chat-text)] outline-none transition-colors hover:bg-[var(--chat-hover)]"
                      style={{
                        borderColor: 'var(--chat-border)',
                        backgroundColor: 'var(--chat-surface)',
                      }}
                    >
                      <span className="min-w-0 truncate">
                        {formatProjectScheduleLabel(projectScheduledCreateSchedule)}
                      </span>
                      <ChevronDown
                        size={14}
                        className={`flex-shrink-0 text-[var(--chat-muted)] transition-transform ${
                          isProjectScheduledWhenOpen ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                    {isProjectScheduledWhenMounted && (
                      <div
                        className={`absolute left-0 right-0 top-full z-10 pt-1 ${
                          isProjectScheduledWhenClipOpen ||
                          isProjectScheduleDateMounted ||
                          isProjectScheduleTimeMounted
                            ? 'overflow-visible'
                            : 'overflow-hidden'
                        }`}
                        style={{
                          // Fixed height only while sliding; unlock after open so the
                          // nested calendar/time pickers (absolute) are not clipped.
                          height:
                            isProjectScheduledWhenClipOpen ||
                            isProjectScheduleDateMounted ||
                            isProjectScheduleTimeMounted
                              ? 'auto'
                              : projectScheduledWhenPanelHeight > 0
                                ? projectScheduledWhenPanelHeight + 4
                                : 0,
                          pointerEvents: isProjectScheduledWhenShown
                            ? 'auto'
                            : 'none',
                        }}
                      >
                      <div
                        ref={projectScheduledWhenContentRef}
                        className="rounded-lg border p-3 will-change-transform"
                        style={{
                          borderColor: 'var(--chat-border)',
                          backgroundColor: 'var(--chat-surface)',
                          // Same transform duration open ↔ close (no opacity — it made close feel faster).
                          transform: isProjectScheduledWhenShown
                            ? 'translateY(0)'
                            : 'translateY(calc(-100% - 4px))',
                          transition: `transform ${SCHEDULE_DATE_PICKER_MS}ms ${SCHEDULE_DATE_EASE}`,
                        }}
                      >
                        <div
                          style={{
                            opacity: isProjectScheduledWhenTextShown ? 1 : 0,
                            transform: isProjectScheduledWhenTextShown
                              ? 'translateY(0)'
                              : 'translateY(10px)',
                            // Enter: ease-in. Exit: ease-out — same motion, reversed.
                            transition: isProjectScheduledWhenTextShown
                              ? `opacity ${SCHEDULE_DATE_TEXT_MS}ms ease-in, transform ${SCHEDULE_DATE_TEXT_MS}ms ease-in`
                              : `opacity ${SCHEDULE_DATE_TEXT_MS}ms ease-out, transform ${SCHEDULE_DATE_TEXT_MS}ms ease-out`,
                          }}
                        >
                        <div className="flex flex-wrap gap-1">
                          {SCHEDULE_KIND_OPTIONS.map((option) => {
                            const active =
                              projectScheduledCreateSchedule.kind === option.id;
                            /* The selection pair this chat repeats: `quiet` + `data-selection`,
                               which fills with `--xeno-control` when chosen and is muted when not.
                               The border swaps sides doing it — inactive gains the hairline, active
                               drops it — which is the library's own inversion, and the box does not
                               move because these already reserved a transparent 1px.
                               Legible because the panel is `--chat-surface` (#171717) and the fill is
                               #262626; the elevated-surface collision in §9 does not reach here. */
                            return (
                              <Button
                                key={option.id}
                                variant="quiet"
                                size="xs"
                                data-selection={active ? 'on' : 'off'}
                                aria-pressed={active}
                                onClick={() =>
                                  setProjectScheduledCreateSchedule((prev) => ({
                                    ...prev,
                                    kind: option.id,
                                  }))
                                }
                              >
                                {option.label}
                              </Button>
                            );
                          })}
                        </div>

                        {/* Fixed height so Once/Daily/Weekly/Monthly swaps do not resize the panel */}
                        <div className="mt-3 h-[4.75rem]">
                          {projectScheduledCreateSchedule.kind === 'once' && (
                            <div className="block">
                              <span className="mb-1.5 block text-[11px] text-[var(--chat-muted)]">
                                Date
                              </span>
                              {/* Anchor: calendar slides out from under the date field.
                                  Raise whole stack above Time while the calendar is open. */}
                              <div
                                className={`relative ${
                                  isProjectScheduleDateMounted ? 'z-30' : 'z-10'
                                }`}
                              >
                              <div
                                className="relative z-20 flex h-9 w-full items-center gap-1 rounded-md border pl-2.5 pr-1"
                                style={{
                                  borderColor: 'var(--chat-border)',
                                  backgroundColor: 'var(--chat-elevated)',
                                }}
                              >
                                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--chat-text)]">
                                  {formatScheduleDateDisplay(
                                    projectScheduledCreateSchedule.date,
                                  )}
                                </span>
                                <IconButton
                                  icon={CalendarDecl}
                                  variant="ghost"
                                  size="sm"
                                  iconSize={14}
                                  onClick={toggleProjectScheduleDatePicker}
                                  aria-label={
                                    isProjectScheduleDateOpen
                                      ? 'Close calendar'
                                      : 'Open calendar'
                                  }
                                  aria-expanded={isProjectScheduleDateOpen}
                                />
                              </div>
                              {isProjectScheduleDateMounted && (
                                <div
                                  className="absolute left-0 right-0 top-full z-30 overflow-hidden pt-1"
                                  style={{
                                    height:
                                      projectScheduleDatePanelHeight > 0
                                        ? projectScheduleDatePanelHeight + 4
                                        : 0,
                                    pointerEvents: isProjectScheduleDateShown
                                      ? 'auto'
                                      : 'none',
                                  }}
                                  role="dialog"
                                  aria-label="Choose date"
                                >
                                  <div
                                    ref={projectScheduleDateContentRef}
                                    className="rounded-md border shadow-md will-change-transform"
                                    style={{
                                      borderColor: 'var(--chat-border)',
                                      backgroundColor: 'var(--chat-surface)',
                                      // Slides from under the date field (up = hidden beneath it).
                                      transform: isProjectScheduleDateShown
                                        ? 'translateY(0)'
                                        : 'translateY(calc(-100% - 4px))',
                                      transition: `transform ${SCHEDULE_DATE_PICKER_MS}ms ${SCHEDULE_DATE_EASE}`,
                                    }}
                                  >
                                    {/* Panel first; text fades slowly (ease-in) so it does not pop. */}
                                    <div
                                      style={{
                                        opacity: isProjectScheduleDateTextShown
                                          ? 1
                                          : 0,
                                        transform: isProjectScheduleDateTextShown
                                          ? 'translateY(0)'
                                          : 'translateY(10px)',
                                        transition: `opacity ${SCHEDULE_DATE_TEXT_MS}ms ${SCHEDULE_DATE_TEXT_EASE}, transform ${SCHEDULE_DATE_TEXT_MS}ms ${SCHEDULE_DATE_TEXT_EASE}`,
                                      }}
                                    >
                                  <div className="flex items-center justify-between px-2.5 pb-1 pt-2.5">
                                    <span className="text-[12px] font-semibold text-[var(--chat-text)]">
                                      {projectScheduleCalendarMonth.toLocaleDateString(
                                        undefined,
                                        { month: 'long', year: 'numeric' },
                                      )}
                                    </span>
                                    <div className="flex items-center gap-0.5">
                                      <IconButton
                                        icon={ChevronRightDecl}
                                        className="chat-icon-flip-x"
                                        variant="ghost"
                                        size="sm"
                                        iconSize={14}
                                        onClick={() =>
                                          setProjectScheduleCalendarMonth(
                                            (month) =>
                                              new Date(
                                                month.getFullYear(),
                                                month.getMonth() - 1,
                                                1,
                                              ),
                                          )
                                        }
                                        aria-label="Previous month"
                                      />
                                      <IconButton
                                        icon={ChevronRightDecl}
                                        variant="ghost"
                                        size="sm"
                                        iconSize={14}
                                        onClick={() =>
                                          setProjectScheduleCalendarMonth(
                                            (month) =>
                                              new Date(
                                                month.getFullYear(),
                                                month.getMonth() + 1,
                                                1,
                                              ),
                                          )
                                        }
                                        aria-label="Next month"
                                      />
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-7 gap-0.5 px-2 pb-1">
                                    {SCHEDULE_CAL_WEEKDAYS.map((day) => (
                                      <span
                                        key={day}
                                        className="py-1 text-center text-[10px] font-medium text-[var(--chat-muted)]"
                                      >
                                        {day}
                                      </span>
                                    ))}
                                    {getScheduleMonthGrid(
                                      projectScheduleCalendarMonth,
                                    ).map((cell) => {
                                      const selected =
                                        cell.ymd ===
                                        projectScheduledCreateSchedule.date;
                                      /* Stays hand-written: a date GRID, not a row of controls.
                                         Forty-two 28px cells at 11px with no padding, and the third
                                         dimension is `opacity` — days outside the month sit at 0.45,
                                         which is neither a variant nor an availability but a fact
                                         about the data. A control scale has nothing to say about a
                                         calendar. */
                                      return (
                                        <button
                                          key={cell.ymd}
                                          type="button"
                                          onClick={() => {
                                            setProjectScheduledCreateSchedule(
                                              (prev) => ({
                                                ...prev,
                                                date: cell.ymd,
                                              }),
                                            );
                                            setIsProjectScheduleDateOpen(false);
                                          }}
                                          className="h-7 rounded-md text-[11px] font-medium transition-colors"
                                          style={{
                                            backgroundColor: selected
                                              ? 'var(--chat-control)'
                                              : 'transparent',
                                            color: selected
                                              ? 'var(--chat-text)'
                                              : cell.inMonth
                                                ? 'var(--chat-text)'
                                                : 'var(--chat-muted)',
                                            opacity: cell.inMonth ? 1 : 0.45,
                                          }}
                                          aria-pressed={selected}
                                        >
                                          {cell.day}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div
                                    className="flex items-center justify-between border-t px-2.5 py-1.5"
                                    style={{ borderColor: 'var(--chat-border)' }}
                                  >
                                    {/* `ghost xs`, both of these: no fill, no border, muted ink
                                        coming up under the pointer. At ~21px tall with 6px padding
                                        and 11px type they are under the scale, and xs is the nearest
                                        step in every dimension — 24 / 8 / 12, which is three pixels,
                                        two and one. Small enough to be the swap §3.3 asks for rather
                                        than a resize wearing its clothes. */}
                                    <Button
                                      variant="ghost"
                                      size="xs"
                                      onClick={() => {
                                        setProjectScheduledCreateSchedule(
                                          (prev) => ({
                                            ...prev,
                                            date: '',
                                          }),
                                        );
                                        setIsProjectScheduleDateOpen(false);
                                      }}
                                    >
                                      Clear
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="xs"
                                      onClick={() => {
                                        const today = formatScheduleDateYmd(
                                          new Date(),
                                        );
                                        setProjectScheduledCreateSchedule(
                                          (prev) => ({
                                            ...prev,
                                            date: today,
                                          }),
                                        );
                                        setProjectScheduleCalendarMonth(
                                          monthStartFromYmd(today),
                                        );
                                        setIsProjectScheduleDateOpen(false);
                                      }}
                                    >
                                      Today
                                    </Button>
                                  </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                              </div>
                            </div>
                          )}

                          {projectScheduledCreateSchedule.kind === 'daily' && (
                            <p className="pt-6 text-[12px] text-[var(--chat-muted)]">
                              Runs every day at the time below.
                            </p>
                          )}

                          {projectScheduledCreateSchedule.kind === 'weekly' && (
                            <div>
                              <span className="mb-1.5 block text-[11px] text-[var(--chat-muted)]">
                                Day
                              </span>
                              <div className="grid grid-cols-7 gap-1">
                                {SCHEDULE_WEEKDAYS.map((day, index) => {
                                  const active =
                                    projectScheduledCreateSchedule.weekday === index;
                                  /* Stays hand-written, and it is off the scale in ONE dimension
                                     while sitting on it in the other. The box is `h-8`, which is md
                                     exactly; the type is 11px, which is below xs. Taking md would put
                                     14px type into a seven-column grid of ~40px cells, and taking xs
                                     would cut 8px off a row that is already the right height. In a
                                     grid this narrow the type is the dimension that cannot move. */
                                  return (
                                    <button
                                      key={day}
                                      type="button"
                                      onClick={() =>
                                        setProjectScheduledCreateSchedule((prev) => ({
                                          ...prev,
                                          weekday: index,
                                        }))
                                      }
                                      className="h-8 rounded-md text-[11px] font-medium transition-colors"
                                      style={{
                                        backgroundColor: active
                                          ? 'var(--chat-control)'
                                          : 'transparent',
                                        color: active
                                          ? 'var(--chat-text)'
                                          : 'var(--chat-muted)',
                                        border: '1px solid var(--chat-border)',
                                      }}
                                      aria-pressed={active}
                                    >
                                      {day.slice(0, 1)}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {projectScheduledCreateSchedule.kind === 'monthly' && (
                            <p className="pt-6 text-[12px] text-[var(--chat-muted)]">
                              Runs on the 1st of each month.
                            </p>
                          )}
                        </div>

                        <div
                          className={`relative mt-3 block ${
                            isProjectScheduleDateMounted
                              ? 'z-0'
                              : isProjectScheduleTimeMounted
                                ? 'z-30'
                                : 'z-10'
                          }`}
                        >
                          <span className="mb-1.5 block text-[11px] text-[var(--chat-muted)]">
                            Time
                          </span>
                          <div
                            className="relative flex h-9 w-full items-center gap-1 rounded-md border pl-2.5 pr-1"
                            style={{
                              borderColor: 'var(--chat-border)',
                              backgroundColor: 'var(--chat-elevated)',
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--chat-text)]">
                              {formatScheduleTimeDisplay(
                                projectScheduledCreateSchedule.time,
                              )}
                            </span>
                            <IconButton
                              icon={ClockDecl}
                              variant="ghost"
                              size="sm"
                              iconSize={14}
                              onClick={toggleProjectScheduleTimePicker}
                              aria-label={
                                isProjectScheduleTimeOpen
                                  ? 'Close time picker'
                                  : 'Open time picker'
                              }
                              aria-expanded={isProjectScheduleTimeOpen}
                            />
                          </div>
                          {isProjectScheduleTimeMounted && (
                            <div
                              className="absolute left-0 right-0 top-full z-30 overflow-hidden pt-1"
                              style={{
                                height:
                                  projectScheduleTimePanelHeight > 0
                                    ? projectScheduleTimePanelHeight + 4
                                    : 0,
                                pointerEvents: isProjectScheduleTimeShown
                                  ? 'auto'
                                  : 'none',
                              }}
                              role="dialog"
                              aria-label="Choose time"
                            >
                              <div
                                ref={projectScheduleTimeContentRef}
                                className="rounded-md border shadow-md will-change-transform"
                                style={{
                                  borderColor: 'var(--chat-border)',
                                  backgroundColor: 'var(--chat-surface)',
                                  transform: isProjectScheduleTimeShown
                                    ? 'translateY(0)'
                                    : 'translateY(calc(-100% - 4px))',
                                  transition: `transform ${SCHEDULE_DATE_PICKER_MS}ms ${SCHEDULE_DATE_EASE}`,
                                }}
                              >
                                <div
                                  style={{
                                    opacity: isProjectScheduleTimeTextShown
                                      ? 1
                                      : 0,
                                    transform: isProjectScheduleTimeTextShown
                                      ? 'translateY(0)'
                                      : 'translateY(10px)',
                                    transition: `opacity ${SCHEDULE_DATE_TEXT_MS}ms ${SCHEDULE_DATE_TEXT_EASE}, transform ${SCHEDULE_DATE_TEXT_MS}ms ${SCHEDULE_DATE_TEXT_EASE}`,
                                  }}
                                >
                                  {(() => {
                                    const selected = parseScheduleTime(
                                      projectScheduledCreateSchedule.time,
                                    );
                                    return (
                                      <div className="grid grid-cols-3 gap-1 p-2">
                                        <div>
                                          <span className="mb-1 block px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                                            Hour
                                          </span>
                                          <div
                                            className="max-h-36 overflow-y-auto rounded-md border p-0.5"
                                            style={{
                                              borderColor: 'var(--chat-border)',
                                            }}
                                          >
                                            {SCHEDULE_HOURS_12.map((hour) => {
                                              const active =
                                                selected.hour12 === hour;
                                              /* Stays hand-written, with the weekday grid's shape:
                                                 a cell in a scrolling PICKER column, not a button in
                                                 a row. `h-7` is sm and the type is 12 against sm's 13,
                                                 which is close — but the cell is `w-full` inside a
                                                 narrow column with no horizontal padding at all, and
                                                 `.xeno-btn` carries 10px on each side. Twenty pixels
                                                 of padding inside a column sized for two digits is
                                                 the conversion breaking the thing it converts. */
                                              return (
                                                <button
                                                  key={hour}
                                                  type="button"
                                                  onClick={() =>
                                                    setProjectScheduleTimePart(
                                                      'hour12',
                                                      hour,
                                                    )
                                                  }
                                                  className="flex h-7 w-full items-center justify-center rounded text-[12px] font-medium transition-colors"
                                                  style={{
                                                    backgroundColor: active
                                                      ? 'var(--chat-control)'
                                                      : 'transparent',
                                                    color: active
                                                      ? 'var(--chat-text)'
                                                      : 'var(--chat-muted)',
                                                  }}
                                                  aria-pressed={active}
                                                >
                                                  {hour}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                        <div>
                                          <span className="mb-1 block px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                                            Min
                                          </span>
                                          <div
                                            className="max-h-36 overflow-y-auto rounded-md border p-0.5"
                                            style={{
                                              borderColor: 'var(--chat-border)',
                                            }}
                                          >
                                            {SCHEDULE_MINUTES.map((minute) => {
                                              const active =
                                                selected.minute === minute;
                                              /* Stays hand-written — the hour column's twin. */
                                              return (
                                                <button
                                                  key={minute}
                                                  type="button"
                                                  onClick={() =>
                                                    setProjectScheduleTimePart(
                                                      'minute',
                                                      minute,
                                                    )
                                                  }
                                                  className="flex h-7 w-full items-center justify-center rounded text-[12px] font-medium transition-colors"
                                                  style={{
                                                    backgroundColor: active
                                                      ? 'var(--chat-control)'
                                                      : 'transparent',
                                                    color: active
                                                      ? 'var(--chat-text)'
                                                      : 'var(--chat-muted)',
                                                  }}
                                                  aria-pressed={active}
                                                >
                                                  {minute}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                        <div>
                                          <span className="mb-1 block px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                                            AM/PM
                                          </span>
                                          <div
                                            className="rounded-md border p-0.5"
                                            style={{
                                              borderColor: 'var(--chat-border)',
                                            }}
                                          >
                                            {SCHEDULE_MERIDIEMS.map((meridiem) => {
                                              const active =
                                                selected.meridiem === meridiem;
                                              /* Stays hand-written — the hour column's twin. */
                                              return (
                                                <button
                                                  key={meridiem}
                                                  type="button"
                                                  onClick={() =>
                                                    setProjectScheduleTimePart(
                                                      'meridiem',
                                                      meridiem,
                                                    )
                                                  }
                                                  className="flex h-7 w-full items-center justify-center rounded text-[12px] font-medium transition-colors"
                                                  style={{
                                                    backgroundColor: active
                                                      ? 'var(--chat-control)'
                                                      : 'transparent',
                                                    color: active
                                                      ? 'var(--chat-text)'
                                                      : 'var(--chat-muted)',
                                                  }}
                                                  aria-pressed={active}
                                                >
                                                  {meridiem}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        </div>
                      </div>
                      </div>
                    )}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    {/* `secondary md` — a `--chat-control` fill with text ink, 32px of box, and it
                        gains the variant's hairline. The same conversion as the create-project
                        dialog's Cancel, which is the footer this one copies. */}
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={closeProjectScheduledCreate}
                    >
                      Cancel
                    </Button>
                    {/* Stays hand-written: `--chat-text` fill with `--chat-canvas` ink, the
                        inverted emphasis. Fifteenth in this chat and the FIFTH Cancel/confirm pair
                        split by the same missing variant (§9). Its disabled branch is the
                        availability axis written out, which the component would carry. */}
                    <Button
                      variant="primary"
                      size="md"
                      onClick={submitProjectScheduledCreate}
                      disabled={!projectScheduledCreateTitle.trim()}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )}
        {isSharePreviewMounted &&
          messages.length > 0 &&
          createPortal(
            <ChatShareModal
              conversationId={activeConversationId ?? 'local-draft'}
              conversationTitle={
                conversationHistory.find((convo) => convo.id === activeConversationId)?.title
              }
              messages={messages.map((message) => ({
                id: message.id,
                sender: message.sender,
                text: message.parsedAnswer || message.text,
              }))}
              themeClassName={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme}`}
              themeStyle={chatThemePreviewStyle}
              isOpen={isSharePreviewOpen}
              isShown={isSharePreviewShown}
              onClose={() => setIsSharePreviewOpen(false)}
            />,
            document.body,
          )}
        {isChatFilesModalMounted &&
          createPortal(
            <div
              className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} fixed inset-0 z-[999] flex items-center justify-center p-4 backdrop-blur-sm`}
              data-chat-theme-preference={chatTheme}
              data-chat-files-preview=""
              style={{
                backgroundColor: isChatFilesModalShown
                  ? 'color-mix(in srgb, var(--chat-text) 28%, transparent)'
                  : 'color-mix(in srgb, var(--chat-text) 0%, transparent)',
                transition: `background-color ${SCHEDULE_CREATE_MODAL_MS}ms ${SCHEDULE_DATE_EASE}`,
                ...chatThemePreviewStyle,
              }}
              onClick={closeChatFilesModal}
            >
              <style>{CHAT_MODAL_KEYFRAMES_CSS}</style>
              <div
                {...chatFilesDialog.panelProps}
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-files-dialog-title"
                className="flex h-[min(40rem,80vh)] w-full max-w-[48rem] flex-col overflow-hidden rounded-2xl border"
                style={{
                  backgroundColor: 'var(--chat-elevated)',
                  borderColor: 'var(--chat-border)',
                  color: 'var(--chat-text)',
                  boxShadow:
                    '0 8px 32px color-mix(in srgb, var(--chat-text) 16%, transparent)',
                  // Same shell as project file preview; origin top-right (⋯ control).
                  ...chatModalCardMotionStyle(
                    'top-right',
                    isChatFilesModalShown,
                    isChatFilesModalOpen,
                  ),
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div
                  className="flex flex-shrink-0 items-center gap-2 border-b px-4 py-3"
                  style={{ borderColor: 'var(--chat-border)' }}
                >
                  {chatFilesSelected ? (
                    <IconButton
                      icon={ChevronRightDecl}
                      className="chat-icon-flip-x"
                      variant="ghost"
                      size="md"
                      iconSize={16}
                      onClick={() => {
                        setChatFilesSelectedKey(null);
                        setChatFilesCopied(false);
                      }}
                      aria-label="Back to files list"
                      title="Back"
                    />
                  ) : (
                    <FileText
                      size={14}
                      className="flex-shrink-0 text-[var(--chat-muted)]"
                      aria-hidden="true"
                    />
                  )}
                  <h2
                    id="chat-files-dialog-title"
                    className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-[var(--chat-text)]"
                  >
                    {chatFilesSelected ? chatFilesSelected.name : 'Files in chat'}
                  </h2>
                  {/* The file-preview copy button's twin, converted the same way: `ghost md`,
                      two faces in one button with the ternary in `leadingIcon` so the check draws
                      rather than appears. */}
                  {chatFilesSelected && (
                    <Button
                      variant="ghost"
                      size="md"
                      iconSize={14}
                      leadingIcon={chatFilesCopied ? CheckDecl : CopyDecl}
                      data-selection={chatFilesCopied ? 'on' : 'off'}
                      onClick={() => void copyChatFilesPreview()}
                      title={chatFilesCopied ? 'Copied' : 'Copy'}
                    >
                      {chatFilesCopied ? 'Copied' : 'Copy'}
                    </Button>
                  )}
                  <IconButton
                    icon={XDecl}
                    variant="ghost"
                    size="md"
                    iconSize={16}
                    onClick={closeChatFilesModal}
                    aria-label="Close files in chat"
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  {chatFilesSelected ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-[13.5px] leading-relaxed text-[var(--chat-text)]">
                      {chatFilesSelected.content}
                    </pre>
                  ) : conversationFileItems.length === 0 ? (
                    <p className="py-10 text-center text-[13px] leading-relaxed text-[var(--chat-muted)]">
                      No files attached in this conversation yet.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1" role="list">
                      {conversationFileItems.map((item) => (
                        <li key={item.key}>
                          {/* `ListRow`: a leading glyph, a title that truncates, a trailing mark
                              and a hover that paints the whole row. The trailing chevron is
                              DECORATION rather than an action, which is what lets this row take the
                              component where the recent-file and catalog rows could not — theirs
                              carry a real button beside the body, and `ListRow` renders its trailing
                              slot inside its own. */}
                          <ListRow
                            leading={item.kind === 'image'
                              ? <FileImage size={15} aria-hidden="true" />
                              : <FileText size={15} aria-hidden="true" />}
                            title={item.name}
                            trailing={<ChevronRight size={14} aria-hidden="true" />}
                            onSelect={() => {
                              setChatFilesSelectedKey(item.key);
                              setChatFilesCopied(false);
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )}
        {historyDragGhostTitle != null &&
          createPortal(
            <div
              ref={historyDragGhostElRef}
              aria-hidden="true"
              className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} pointer-events-none fixed left-0 top-0 z-[1100] flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] will-change-transform`}
              style={{
                ...chatThemePreviewStyle,
                backgroundColor: 'var(--chat-control)',
                color: 'var(--chat-text)',
                opacity: 0.92,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
                transform: 'translate3d(-9999px, -9999px, 0)',
              }}
            >
              <MessageSquare
                size={13}
                className="flex-shrink-0 text-[var(--chat-muted)]"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate leading-tight">
                {historyDragGhostTitle}
              </span>
            </div>,
            document.body,
          )}
        {isHistoryRowMenuMounted && historyRowMenu && (() => {
          const menuConvo = conversationHistory.find((item) => item.id === historyRowMenu.conversationId);
          if (!menuConvo) return null;
          const isPinned = Boolean(menuConvo.isPinned);
          const isArchived = Boolean(menuConvo.isArchived);
          return createPortal(
            <>
            <style>{CHAT_MODAL_KEYFRAMES_CSS}</style>
            <div
              {...(() => { const { ref: _g, className: _c, ...handlers } = historyRowGoo.hostProps; return handlers; })()}
              {...historyRowMenuKbd.menuProps}
              key={isHistoryRowMenuShown ? 'history-row-menu-in' : 'history-row-menu-out'}
              data-history-row-menu=""
              aria-hidden={!isHistoryRowMenuOpen}
              // `rounded-lg`, the radius of the conversation row this menu belongs to. A menu that
              // drops out of a row and rounds harder than it reads as a different object.
              className={`${historyRowGoo.hostProps.className} chat-goo chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} chat-history-popover fixed z-[1000] w-[188px] rounded-lg border p-1`}
              style={{
                top: historyRowMenu.top,
                left: historyRowMenu.left,
                backgroundColor: 'var(--chat-elevated)',
                borderColor: 'var(--chat-border)',
                color: 'var(--chat-text)',
                pointerEvents: isHistoryRowMenuShown ? 'auto' : 'none',
                // Out of its own top-right corner — the ⋯ it was opened from, and the edge it is
                // aligned to. It used to borrow the card-modal motion, which travels 18% of its own
                // width sideways from a screen corner; on a menu this size that read as the menu
                // sliding out of the history sidebar and back into it.
                ...menuPopMotionStyle(
                  'top right',
                  '-8px',
                  isHistoryRowMenuShown,
                  isHistoryRowMenuOpen,
                ),
                ...chatThemePreviewStyle,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {/* First child, so the pill paints behind the rows rather than over them. */}
              {historyRowGoo.pill}
              <MenuItem
                onSelect={() => {
                  handleTogglePinConversation(menuConvo.id);
                  closeHistoryRowMenu();
                }}
                leadingIcon={BookmarkDecl}
                iconState={{ selection: isPinned ? 'on' : 'off' }}
                shortcut="P"
              >
                {isPinned ? 'Unpin' : 'Pin'}
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  setEditingConversationId(menuConvo.id);
                  setEditTitleText(menuConvo.title);
                  closeHistoryRowMenu();
                  setIsChatsCatalogOpen(false);
                  setTimeout(() => document.getElementById(`edit-title-${menuConvo.id}-${interfaceId}`)?.focus(), 50);
                }}
                leadingIcon={EditDecl}
                shortcut="R"
              >
                Rename
              </MenuItem>

              <div className="relative">
                <MenuItem
                  onSelect={() => setHistoryProjectSubmenuOpen((open) => !open)}
                  leadingIcon={LayersDecl}
                  submenu
                >
                  Add to project
                </MenuItem>
                {historyProjectSubmenuOpen && (
                  <div
                    // Follows its parent menu's radius — a submenu is the same object, continued.
                    className="chat-history-popover absolute left-full top-0 z-[1001] ml-1 w-[180px] rounded-lg border border-[var(--chat-border)] bg-[var(--chat-elevated)] p-1"
                    style={{
                      backgroundColor: 'var(--chat-elevated)',
                      borderColor: 'var(--chat-border)',
                    }}
                  >
                    {chatProjects.length === 0 ? (
                      <p className="px-2.5 py-1.5 text-[11px] text-[var(--chat-muted)]">No projects yet</p>
                    ) : (
                      chatProjects.map((project) => (
                        <MenuItem
                          key={project.id}
                          // The chosen project takes the check, and the leading slot stays reserved on
                          // the others so the names line up. The folder glyph that used to lead every
                          // row said nothing — this submenu is titled "Add to project" and every row
                          // in it is one, so the same mark on all of them only competed with the check.
                          selected={menuConvo.projectId === project.id}
                          onSelect={() => {
                            handleAssignConversationToProject(menuConvo.id, project.id);
                            closeHistoryRowMenu();
                          }}
                        >
                          {project.name}
                        </MenuItem>
                      ))
                    )}
                    <div className="my-1 border-t border-[var(--chat-border)]" />
                      <MenuItem
                        onSelect={() => {
                        closeHistoryRowMenu();
                        openCreateProjectModal({ assignConversationId: menuConvo.id });
                        }}
                        leadingIcon={PlusDecl}
                      >
                        New project
                      </MenuItem>
                    {menuConvo.projectId && (
                      <MenuItem
                        onSelect={() => {
                          handleAssignConversationToProject(menuConvo.id, null);
                          closeHistoryRowMenu();
                        }}
                      >
                        Remove from project
                      </MenuItem>
                    )}
            </div>
          )}
              </div>

              <div className="my-1 border-t border-[var(--chat-border)]" />

              <MenuItem
                onSelect={() => {
                  void handleArchiveConversation(menuConvo.id, !isArchived);
                  closeHistoryRowMenu();
                }}
                leadingIcon={ArchiveDecl}
                iconState={{ selection: isArchived ? 'on' : 'off' }}
                shortcut="A"
              >
                {isArchived ? 'Unarchive' : 'Archive'}
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  setDeleteConfirmationModal({
                    isOpen: true,
                    conversationId: menuConvo.id,
                    conversationTitle: menuConvo.title,
                    origin: 'left',
                  });
                  closeHistoryRowMenu();
                }}
                leadingIcon={TrashDecl}
                variant="danger"
                shortcut="D"
              >
                Delete
              </MenuItem>
            </div>
            </>,
            document.body,
          );
        })()}
        {recentsFilterMenu && createPortal(
          (() => {
            const typeLabel: Record<RecentsFilterType, string> = { all: 'All', chat: 'Chat', task: 'Task' };
            const statusLabel: Record<RecentsFilterStatus, string> = { active: 'Active', archived: 'Archived', all: 'All' };
            const activityLabel: Record<RecentsFilterActivity, string> = {
              '1d': '1d',
              '3d': '3d',
              '7d': '7d',
              '30d': '30d',
              all: 'All',
            };
            const groupLabel: Record<RecentsGroupBy, string> = {
              none: 'None',
              date: 'Date',
              type: 'Type',
              project: 'Project',
              unread: 'Unread',
              status: 'Status',
            };
            const openSubmenu = (
              key: Exclude<RecentsFilterSubmenu, null>,
              event: React.MouseEvent<HTMLButtonElement>,
            ) => {
              setRecentsFilterSubmenu(key);
              setRecentsFilterSubmenuTop(event.currentTarget.getBoundingClientRect().top);
            };
            const submenuOptions =
              recentsFilterSubmenu === 'type'
                ? (['all', 'chat', 'task'] as RecentsFilterType[]).map((value) => ({
                    value,
                    label: typeLabel[value],
                    selected: recentsFilterType === value,
                    onSelect: () => setRecentsFilterType(value),
                  }))
                : recentsFilterSubmenu === 'status'
                  ? (['active', 'archived', 'all'] as RecentsFilterStatus[]).map((value) => ({
                      value,
                      label: statusLabel[value],
                      selected: recentsFilterStatus === value,
                      onSelect: () => setRecentsFilterStatus(value),
                    }))
                  : recentsFilterSubmenu === 'activity'
                    ? (['1d', '3d', '7d', '30d', 'all'] as RecentsFilterActivity[]).map((value) => ({
                        value,
                        label: activityLabel[value],
                        selected: recentsFilterActivity === value,
                        onSelect: () => setRecentsFilterActivity(value),
                      }))
                    : recentsFilterSubmenu === 'group'
                      ? (['date', 'type', 'project', 'unread', 'status', 'none'] as RecentsGroupBy[]).map((value) => ({
                          value,
                          label: groupLabel[value],
                          selected: recentsGroupBy === value,
                          onSelect: () => setRecentsGroupBy(value),
                          separatedBefore: value === 'none',
                        }))
                      : [];

            return (
              <div data-recents-filter-menu="" className="contents">
                <div
                  {...(() => { const { ref: _g, className: _c, ...handlers } = recentsFilterGoo.hostProps; return handlers; })()}
                  {...recentsFilterMenuKbd.menuProps}
                  className={`${recentsFilterGoo.hostProps.className} chat-goo chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} chat-history-popover fixed z-[1000] w-[196px] rounded-xl border p-1`}
                  style={{
                    top: recentsFilterMenu.top,
                    left: recentsFilterMenu.left,
                    backgroundColor: 'var(--chat-elevated)',
                    borderColor: 'var(--chat-border)',
                    color: 'var(--chat-text)',
                    ...chatThemePreviewStyle,
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  {/* First child, so the pill paints behind the rows rather than over them. */}
                  {recentsFilterGoo.pill}
                  <MenuItem
                    onMouseEnter={(event) => openSubmenu('type', event)}
                    onClick={(event) => openSubmenu('type', event)}
                    submenu
                    value={typeLabel[recentsFilterType]}
                  >
                    Type
                  </MenuItem>
                  <MenuItem
                    onMouseEnter={(event) => openSubmenu('status', event)}
                    onClick={(event) => openSubmenu('status', event)}
                    submenu
                    value={statusLabel[recentsFilterStatus]}
                  >
                    Status
                  </MenuItem>
                  <MenuItem
                    onMouseEnter={(event) => openSubmenu('activity', event)}
                    onClick={(event) => openSubmenu('activity', event)}
                    submenu
                    value={activityLabel[recentsFilterActivity]}
                  >
                    Last activity
                  </MenuItem>
                  <div className="my-1 border-t border-[var(--chat-border)]" />
                  <MenuItem
                    onMouseEnter={(event) => openSubmenu('group', event)}
                    onClick={(event) => openSubmenu('group', event)}
                    submenu
                    value={groupLabel[recentsGroupBy]}
                  >
                    Group by
                  </MenuItem>
                </div>

                {recentsFilterSubmenu && submenuOptions.length > 0 && (
                  <div
                    {...(() => { const { ref: _g, className: _c, ...handlers } = recentsSubmenuGoo.hostProps; return handlers; })()}
                    {...recentsSubmenuKbd.menuProps}
                    className={`${recentsSubmenuGoo.hostProps.className} chat-goo chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} chat-history-popover fixed z-[1001] w-[104px] rounded-xl border p-1`}
                    style={{
                      top: recentsFilterSubmenuTop,
                      // 196 is the parent menu's own width, + 4 for the gap — keep the two in step,
                      // or the submenu opens on top of the chevrons it was summoned by.
                      left: Math.min(recentsFilterMenu.left + 200, window.innerWidth - 112),
                      backgroundColor: 'var(--chat-elevated)',
                      borderColor: 'var(--chat-border)',
                      color: 'var(--chat-text)',
                      ...chatThemePreviewStyle,
                    }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {/* First child, so the pill paints behind the rows rather than over them. */}
                    {recentsSubmenuGoo.pill}
                    {submenuOptions.map((option) => (
                      <React.Fragment key={String(option.value)}>
                        {'separatedBefore' in option && option.separatedBefore && (
                          <div className="my-1 border-t border-[var(--chat-border)]" />
                        )}
                        <MenuItem
                          selected={option.selected}
                          onSelect={() => {
                            option.onSelect();
                            closeRecentsFilterMenu();
                          }}
                        >
                          {option.label}
                        </MenuItem>
                      </React.Fragment>
                    ))}
                                </div>
                            )}
                        </div>
            );
          })(),
          document.body,
        )}
        {isFullScreenImageMounted &&
          fullScreenImageUrl &&
          createPortal(
            <FullScreenImageViewer
              imageUrl={fullScreenImageUrl}
              isOpen={isFullScreenImageOpen}
              isShown={isFullScreenImageShown}
              onClose={() => setIsFullScreenImageOpen(false)}
              showDownloadButton={viewerShowsDownloadButton}
            />,
            document.body,
          )}

        {/* History Sidebar - Slides in from left */}
        {/* In multi-interface mode: render inside the interface container */}
        {/* In single interface mode: render via portal to document.body */}
        {(() => {
          // Single-mode history is portaled to document.body (escape overflow:hidden).
          // Re-apply chat-themed + theme tokens on the portal root so Light/Dim/Custom match the page.
          // Desktop clip: animate with translateX inside a viewport that starts at the taskbar edge,
          // so the panel never paints under the left navigation during open/close.
          // Taskbar is w-13 (52px). Sit flush against it — no floating 12px frame.
          const historyLeftInset = isTaskbarHidden ? 0 : 52;
          const historySurfaceStyle: React.CSSProperties = {
            backgroundColor: 'var(--chat-surface)',
            color: 'var(--chat-text)',
            // Border + shadow come from .chat-history-sidebar CSS (theme-aware).
            ...chatThemePreviewStyle,
          };
          const historyPanelBody = (
              <div className="flex flex-col h-full overflow-hidden">
                {/* Brand + search / close — height matches top bar; hairline is shared (portal). */}
                <div
                  className="flex flex-shrink-0 items-center justify-between gap-2 overflow-hidden px-3"
                  style={{ height: CHAT_CHROME_BAR_HEIGHT_PX }}
                >
                  <style>{`
                    @keyframes chat-history-search-in {
                      from { opacity: 0; transform: translateX(32%); }
                      to { opacity: 1; transform: translateX(0); }
                    }
                    @keyframes chat-history-search-out {
                      from { opacity: 1; transform: translateX(0); }
                      to { opacity: 0; transform: translateX(32%); }
                    }
                  `}</style>
                  {isHistorySearchMounted ? (
                    <div
                      className="flex min-w-0 flex-1 items-center gap-0.5"
                      style={historySearchBarMotionStyle(
                        isHistorySearchShown,
                        isHistorySearchOpen,
                      )}
                    >
                      <div
                        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5"
                        style={{ backgroundColor: 'var(--chat-control)' }}
                      >
                        <Search size={14} className="flex-shrink-0 text-[var(--chat-muted)]" aria-hidden="true" />
                        {/* Stays hand-written — a bare field with no box of its own. It is
                            `bg-transparent` inside a bar that animates in from the right, and the
                            surrounding row owns the border, the fill and the slide. `TextInput` is
                            box-and-field together, so taking it would mean giving this field a second
                            box inside the one that moves. */}
                        <input
                          type="search"
                          autoFocus
                          placeholder="Search..."
                          value={historySearchTerm}
                          onChange={(e) => setHistorySearchTerm(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setIsHistorySearchOpen(false);
                            }
                          }}
                          className="w-full min-w-0 bg-transparent text-[12.5px] text-[var(--chat-text)] placeholder:text-[var(--chat-muted)] focus:outline-none"
                          aria-label="Search conversations"
                        />
                      </div>
                      <IconButton
                        icon={XDecl}
                        size="lg"
                        iconSize={15}
                        onClick={() => {
                          setIsHistorySearchOpen(false);
                        }}
                        aria-label="Close search"
                        title="Close search"
                      />
                    </div>
                  ) : (
                    <>
                      <span className="truncate font-display text-[1.125rem] font-semibold leading-none tracking-tight text-[var(--chat-text)]">
                        XENO
                      </span>
                      <div className="flex flex-shrink-0 items-center gap-0.5">
                        <IconButton
                          icon={PanelLeftCloseDecl}
                          size="lg"
                          iconSize={16}
                          onClick={() => {
                            setIsHistorySearchOpen(false);
                            setHistorySearchTerm('');
                            setIsHistoryOpen(false);
                          }}
                          aria-label="Close conversation history"
                          title="Close"
                        />
                        <IconButton
                          icon={SearchDecl}
                          size="lg"
                          iconSize={16}
                          onClick={() => setIsHistorySearchOpen(true)}
                          aria-label="Search conversations"
                          title="Search"
                        />
                      </div>
                    </>
                  )}
                </div>

                {(() => {
                  const hasArchivedConversations = conversationHistory.some((convo) => convo.isArchived);
                  const searchTermLower = historySearchTerm.toLowerCase();
                  const matchesSearch = (convo: Conversation) => {
                    if (!searchTermLower) return true;
                    if (convo.title.toLowerCase().includes(searchTermLower)) return true;
                    return convo.messages.some((message) =>
                      message.text.toLowerCase().includes(searchTermLower),
                    );
                  };
                  const sortedHistory = [...conversationHistory]
                    .filter(matchesSearch)
                    .sort((a, b) => b.timestamp - a.timestamp);
                  const pinnedConversations = sortedHistory
                    .filter((convo) => !convo.isArchived && convo.isPinned)
                    .sort((a, b) => (a.pinOrder ?? a.timestamp) - (b.pinOrder ?? b.timestamp));
                  const archivedConversations = sortedHistory.filter((convo) => convo.isArchived);

                  const activityCutoffMs: Record<Exclude<RecentsFilterActivity, 'all'>, number> = {
                    '1d': 1 * 24 * 60 * 60 * 1000,
                    '3d': 3 * 24 * 60 * 60 * 1000,
                    '7d': 7 * 24 * 60 * 60 * 1000,
                    '30d': 30 * 24 * 60 * 60 * 1000,
                  };
                  const nowMs = Date.now();
                  // Recents filters apply only to the Recents list (Pinned stays untouched).
                  const recentConversations = sortedHistory.filter((convo) => {
                    if (convo.isPinned) return false;
                    if (recentsFilterStatus === 'active' && convo.isArchived) return false;
                    if (recentsFilterStatus === 'archived' && !convo.isArchived) return false;
                    // Type: everything is chat for now; Task has no matching rows yet.
                    if (recentsFilterType === 'task') return false;
                    if (recentsFilterActivity !== 'all') {
                      if (nowMs - convo.timestamp > activityCutoffMs[recentsFilterActivity]) return false;
                    }
                    return true;
                  });

                  const startOfDay = (timestamp: number) => {
                    const date = new Date(timestamp);
                    date.setHours(0, 0, 0, 0);
                    return date.getTime();
                  };
                  const todayStart = startOfDay(nowMs);
                  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
                  const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;

                  type RecentsGroup = { key: string; label: string | null; items: Conversation[] };
                  const recentGroups: RecentsGroup[] = (() => {
                    if (recentsGroupBy === 'none') {
                      return [{ key: 'all', label: null, items: recentConversations }];
                    }
                    const buckets = new Map<string, RecentsGroup>();
                    const ensure = (key: string, label: string) => {
                      if (!buckets.has(key)) buckets.set(key, { key, label, items: [] });
                      return buckets.get(key)!;
                    };
                    for (const convo of recentConversations) {
                      if (recentsGroupBy === 'date') {
                        if (convo.timestamp >= todayStart) ensure('today', 'Today').items.push(convo);
                        else if (convo.timestamp >= yesterdayStart) ensure('yesterday', 'Yesterday').items.push(convo);
                        else if (convo.timestamp >= weekStart) ensure('week', 'Previous 7 days').items.push(convo);
                        else ensure('older', 'Older').items.push(convo);
                      } else if (recentsGroupBy === 'type') {
                        ensure('chat', 'Chat').items.push(convo);
                      } else if (recentsGroupBy === 'project') {
                        if (convo.projectId) {
                          const project = chatProjects.find((item) => item.id === convo.projectId);
                          ensure(convo.projectId, project?.name || 'Project').items.push(convo);
                        } else {
                          ensure('none', 'No project').items.push(convo);
                        }
                      } else if (recentsGroupBy === 'unread') {
                        if (convo.isUnread) ensure('unread', 'Unread').items.push(convo);
                        else ensure('read', 'Read').items.push(convo);
                      } else if (recentsGroupBy === 'status') {
                        if (convo.isArchived) ensure('archived', 'Archived').items.push(convo);
                        else ensure('active', 'Active').items.push(convo);
                      }
                    }
                    return Array.from(buckets.values());
                  })();

                  const historyNavItemClass = (isActive: boolean, indented = false) =>
                    `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                      indented ? 'pl-8' : ''
                    } ${
                      isActive
                        ? 'bg-[var(--chat-control)] text-[var(--chat-text)]'
                        : 'text-[var(--chat-text)]'
                    }`;

                  const pinnedDragFromIndex = historyDragId
                    ? pinnedConversations.findIndex((convo) => convo.id === historyDragId)
                    : -1;
                  const pinnedRowShiftPx = pinnedRowHeightRef.current;
                  // From Recents into Pinned: gap has no placeholder in Pinned, so Recents must shift too
                  // (Claude: Recents label itself has class df-drag-shiftable).
                  const recentsShiftY =
                    historyDragId != null &&
                    pinnedInsertIndex != null &&
                    pinnedDragFromIndex < 0
                      ? pinnedRowShiftPx
                      : 0;

                  const renderHistoryRow = (convo: Conversation, rowSection: 'pinned' | 'recents' | 'archived' = 'recents') => {
                    const isActive = activeConversationId === convo.id;
                    const isEditingTitle = editingConversationId === convo.id;
                    const menuOpen =
                      isHistoryRowMenuOpen &&
                      historyRowMenu?.conversationId === convo.id;
                    const isRowHovered = historyHoveredRowId === convo.id || menuOpen;
                    const isPinnedRow = rowSection === 'pinned';
                    const canDrag = !isEditingTitle && (isPinnedRow || rowSection === 'recents');
                    const isDragging = historyDragId === convo.id;
                    const isListDragging = Boolean(historyDragId);
                    // Claude: keep source in layout (visibility:hidden), shift siblings with transform.
                    // insertAt = index in the list without the dragged id; finalIndex = insertAt.
                    let pinnedShiftY = 0;
                    if (
                      isPinnedRow &&
                      historyDragId &&
                      pinnedInsertIndex != null &&
                      convo.id !== historyDragId
                    ) {
                      const fullIndex = pinnedConversations.findIndex((item) => item.id === convo.id);
                      if (fullIndex >= 0) {
                        if (pinnedDragFromIndex < 0) {
                          if (fullIndex >= pinnedInsertIndex) pinnedShiftY = pinnedRowShiftPx;
                        } else if (pinnedInsertIndex > pinnedDragFromIndex) {
                          if (fullIndex > pinnedDragFromIndex && fullIndex <= pinnedInsertIndex) {
                            pinnedShiftY = -pinnedRowShiftPx;
                          }
                        } else if (pinnedInsertIndex < pinnedDragFromIndex) {
                          if (fullIndex >= pinnedInsertIndex && fullIndex < pinnedDragFromIndex) {
                            pinnedShiftY = pinnedRowShiftPx;
                          }
                        }
                      }
                    }
                    return (
                      <div
                        key={convo.id}
                        data-goo-row=""
                        data-history-pinned-row={isPinnedRow ? convo.id : undefined}
                        data-pin-dragging={isDragging ? 'true' : undefined}
                        onPointerDown={
                          canDrag
                            ? (event) => beginHistoryPointerDrag(event, convo, rowSection)
                            : undefined
                        }
                        className={`group relative px-2.5 py-1.5 text-[13px] rounded-lg touch-none select-none ${
                          isDragging
                            ? // pinned: keep box (no Recents overlap). recents: collapse source.
                              isPinnedRow
                              ? 'pointer-events-none invisible'
                              : 'hidden'
                            : isRowHovered && !isListDragging
                              ? 'pr-9'
                              : 'pr-2.5'
                        } ${
                          isListDragging && isPinnedRow && !isDragging
                            ? 'history-drag-shiftable'
                            : ''
                        } ${
                          isListDragging
                            ? 'cursor-grabbing text-[var(--chat-muted)]'
                            : isActive
                              ? 'cursor-pointer bg-[var(--chat-control)] text-[var(--chat-text)]'
                              : `cursor-pointer text-[var(--chat-muted)] ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''} hover:text-[var(--chat-text)]`
                        } ${
                          !isListDragging
                            ? 'transition-[color,padding,background-color] duration-150 ease-out'
                            : ''
                        }`}
                        style={
                          isListDragging && isPinnedRow && !isDragging
                            ? { transform: `translate3d(0, ${pinnedShiftY}px, 0)` }
                            : undefined
                        }
                        onMouseEnter={() => {
                          if (!isListDragging) setHistoryHoveredRowId(convo.id);
                        }}
                        onMouseLeave={() => {
                          if (!menuOpen) setHistoryHoveredRowId((current) => (current === convo.id ? null : current));
                        }}
                        onClick={() => {
                          if (historyDidDragRef.current) {
                            historyDidDragRef.current = false;
                            return;
                          }
                          if (!isEditingTitle && !menuOpen) {
                            void handleLoadConversation(convo.id);
                          }
                        }}
                        title={convo.title}
                      >
                        {isEditingTitle ? (
                          <div className="flex min-w-0 items-center gap-0.5 rounded border border-[var(--chat-border)] bg-[var(--chat-surface)] pr-0.5">
                              {/* Stays hand-written — a rename-in-place field that owns none of
                                  its box. The `--chat-surface` plate around it is shared with two
                                  IconButtons (confirm and cancel), so the field is `border-0
                                  bg-transparent` by design and the row draws the border. A field
                                  that is one of three things inside a box is not a `TextInput`. */}
                                         <input
                              id={`edit-title-${convo.id}-${interfaceId}`}
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
                              className="min-w-0 flex-1 border-0 bg-transparent px-2 py-0.5 text-[13px] text-[var(--chat-text)] focus:outline-none"
                            />
                            <IconButton
                              icon={CheckDecl}
                              variant="ghost"
                              size="xs"
                              iconSize={12}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSaveConversationTitle();
                              }}
                              aria-label="Confirm rename"
                              title="Save"
                            />
                                       </div>
                                     ) : (
                          <span className="flex min-w-0 items-center gap-1.5">
                            {convo.isUnread && (
                              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--chat-text)]" aria-label="Unread" />
                            )}
                            <MessageSquare size={13} className="flex-shrink-0 text-[var(--chat-muted)]" aria-hidden="true" />
                            <HistoryConversationTitle title={convo.title} isSliding={isRowHovered} />
                                               </span>
                        )}
                        <div
                          className={`absolute top-1/2 right-1 flex -translate-y-1/2 items-center transition-opacity duration-150 ${
                            isEditingTitle
                              ? 'pointer-events-none opacity-0'
                              : menuOpen
                                ? 'opacity-100'
                                : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                          }`}
                        >
                                           <IconButton
                                             icon={MoreVerticalDecl}
                                             variant="ghost"
                                             size="sm"
                                             iconSize={14}
                                             data-history-row-menu-trigger=""
                                             onClick={(e) => {
                                               e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              // Right edge of the ROW, not of the ⋯ button. The button is inset by
                              // `right-1`, so aligning to it left the menu 4px shy of the row it
                              // belongs to — close enough to read as a mistake rather than a choice.
                              const rowRight =
                                e.currentTarget.closest('[data-goo-row]')?.getBoundingClientRect().right
                                ?? rect.right;
                              const menuWidth = 188;
                              const left = Math.min(
                                Math.max(8, rowRight - menuWidth),
                                window.innerWidth - menuWidth - 8,
                              );
                              toggleHistoryRowMenu(convo.id, rect.bottom + 4, left);
                            }}
                                             aria-label="Conversation actions"
                                             aria-haspopup="menu"
                                             aria-expanded={menuOpen}
                                             title="More options"
                                           />
                                         </div>
                          </div>
                    );
                  };

                  const emptyPanel = (title: string, body: string) => (
                    <div className="px-3 py-10 text-center">
                      <p className="text-[13px] font-medium text-[var(--chat-text)]">{title}</p>
                      <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--chat-muted)]">{body}</p>
                        </div>
                  );

                              return (
                    <>
                      {/* Top nav — separate from Pinned / Recents */}
                      <div
                        {...historyNavGoo.hostProps}
                        className={`${historyNavGoo.hostProps.className} chat-goo chat-goo-sidebar flex-shrink-0 space-y-0.5 border-b border-[var(--chat-border)] px-1.5 py-2`}
                      >
                        {historyNavGoo.pill}
                        {/* Stays hand-written, and this is one decision covering all seven rows
                            of this nav. The library's `Sidebar` is the WHOLE panel — sections, its
                            own search field, and an `inert` closed state that takes the rows out of
                            the tab order — and `SidebarItem` is a data shape it maps, not an element
                            a call site can render. This sidebar is hand-built around a goo pill,
                            project sub-rows and per-row menus, so taking the component would be
                            replacing the panel rather than converting a row. The component exists at
                            a different granularity than the thing that needs it. */}
                                <button
                          type="button"
                          data-goo-row="" className={historyNavItemClass(false)}
                          onClick={() => {
                            handleNewChat();
                          }}
                        >
                          <Plus size={16} className="flex-shrink-0 text-[var(--chat-text)]" />
                          <span>New</span>
                                </button>
                        {/* Stays hand-written — one of the seven nav rows decided above. */}
                        <button
                          type="button"
                          data-goo-row="" className={historyNavItemClass(historyNavView === 'chats' && !isProjectsPageOpen)}
                          onClick={() => {
                            setHistoryNavView('chats');
                            dismissChatOverlays();
                          }}
                        >
                          <MessagesSquare size={16} className="flex-shrink-0" />
                          <span>Chats and tasks</span>
                        </button>
                        {hasArchivedConversations && (
                          /* Stays hand-written — one of the seven nav rows decided above. */
                          <button
                            type="button"
                            data-goo-row="" className={historyNavItemClass(historyNavView === 'archived')}
                            onClick={() => {
                              dismissChatOverlays();
                              setHistoryNavView('archived');
                            }}
                          >
                            <Archive size={15} className="flex-shrink-0" />
                            <span>Archived conversations</span>
                          </button>
                        )}
                        {/* Stays hand-written — one of the seven nav rows decided above. */}
                        <button
                          type="button"
                          data-goo-row="" className={historyNavItemClass(historyNavView === 'projects' || isProjectsPageOpen)}
                          onClick={openProjectsPage}
                        >
                          <Folder size={16} className="flex-shrink-0" />
                          <span>Projects</span>
                        </button>
                      {/* Stays hand-written — one of the seven nav rows decided above. */}
                      <button
                          type="button"
                          data-goo-row="" className={historyNavItemClass(historyNavView === 'artifacts' || isArtifactsPageOpen)}
                          onClick={openArtifactsPage}
                        >
                          <Shapes size={16} className="flex-shrink-0" />
                          <span>Artifacts</span>
                      </button>
                      {/* Stays hand-written — one of the seven nav rows decided above. */}
                      <button
                          type="button"
                          data-goo-row="" className={historyNavItemClass(historyNavView === 'global_settings' || isGlobalSettingsPageOpen)}
                          onClick={openGlobalSettingsPage}
                        >
                          <Settings size={16} className="flex-shrink-0" />
                          <span>Settings</span>
                      </button>
                      {/* Stays hand-written — one of the seven nav rows decided above. */}
                      <button
                          type="button"
                          data-goo-row="" className={historyNavItemClass(historyNavView === 'scheduled' || isScheduledPageOpen)}
                          onClick={openScheduledPage}
                        >
                          <Clock size={16} className="flex-shrink-0" />
                          <span>Scheduled</span>
                      </button>
                      </div>

                      {/* Content under the top nav.

                          The goo host is a wrapper INSIDE the scroller rather than the scroller itself.
                          For a `position: relative; overflow: auto` element, the containing block for an
                          absolutely positioned child is its PADDING BOX — which does not move when the
                          element scrolls, so a pill parented there is pinned to the viewport while the
                          rows slide underneath it. A wheel over the list happens to hide that (the row
                          under the cursor changes, which re-places the pill anyway) and it stops hiding
                          it the moment the list is scrolled by anything else. Parented to the content,
                          the pill travels with the row it marks and none of that arises. */}
                      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2 hide-scrollbar">
                        <div
                          {...historyListGoo.hostProps}
                          className={`${historyListGoo.hostProps.className} chat-goo chat-goo-list`}
                        >
                        {historyListGoo.pill}
                        {historyNavView === 'chats' && (
                          conversationHistory.filter((c) => !c.isArchived).length === 0 && !searchTermLower ? (
                            <div className="px-2 py-8 text-center">
                              <p className="text-[12px] text-[var(--chat-muted)]">No conversations yet</p>
                            </div>
                          ) : sortedHistory.length === 0 ? (
                            <div className="px-2 py-8 text-center">
                              <p className="text-[12px] text-[var(--chat-muted)]">No matching conversations</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {(pinnedConversations.length > 0 ||
                                (historyDragId != null &&
                                  historyDragFromSectionRef.current === 'recents')) && (
                                <div
                                  data-history-pinned-zone=""
                                  className={`space-y-0.5 rounded-none ${
                                    historyDragId != null &&
                                    historyDragFromSectionRef.current === 'recents' &&
                                    pinnedConversations.every((c) => c.id !== historyDragId)
                                      ? 'history-pin-section-reveal'
                                      : ''
                                  }`}
                      >
                        {/* Stays hand-written, and so is Recents below it: these are section
                            HEADINGS that happen to toggle. 11px semibold uppercase-ish tracking with
                            4px of vertical padding and no box — a `Button` would put a 24px control
                            where the list wants a label. The chevron beside them is a disclosure
                            mark, not a leading icon. */}
                        <button
                          type="button"
                                    onClick={() => setIsPinnedSectionOpen((open) => !open)}
                                    aria-expanded={isPinnedSectionOpen}
                                    className="flex w-full items-center gap-1 px-2.5 pb-1 text-left text-[11px] font-semibold tracking-wide text-[var(--chat-text)] transition-colors hover:text-[var(--chat-text)]"
                                  >
                                    <span>Pinned</span>
                                    <ChevronRight
                                      size={12}
                                      className={`flex-shrink-0 text-[var(--chat-muted)] transition-transform duration-200 ease-out ${
                                        isPinnedSectionOpen ? 'rotate-90' : 'rotate-0'
                                      }`}
                                      aria-hidden="true"
                                    />
                        </button>
                                  {isPinnedSectionOpen &&
                                    pinnedConversations.map((convo) => renderHistoryRow(convo, 'pinned'))}
                                </div>
                              )}
                              {sortedHistory.some((convo) => !convo.isPinned) && (
                                <div
                                  className={`space-y-0.5 ${recentsShiftY ? 'history-drag-shiftable' : ''}`}
                                  style={
                                    recentsShiftY
                                      ? { transform: `translate3d(0, ${recentsShiftY}px, 0)` }
                                      : undefined
                                  }
                                  onMouseEnter={() => setIsRecentsSectionHovered(true)}
                                  onMouseLeave={() => setIsRecentsSectionHovered(false)}
                                >
                                  <div className="flex items-center justify-between gap-1 px-1 pb-1">
                        {/* Stays hand-written — Pinned's twin, same heading shape. */}
                        <button
                          type="button"
                                      onClick={() => setIsRecentsSectionOpen((open) => !open)}
                                      aria-expanded={isRecentsSectionOpen}
                                      className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[11px] font-semibold tracking-wide text-[var(--chat-text)] transition-colors hover:text-[var(--chat-text)]"
                                    >
                                      <span>Recents</span>
                                      <ChevronRight
                                        size={12}
                                        className={`flex-shrink-0 text-[var(--chat-muted)] transition-transform duration-200 ease-out ${
                                          isRecentsSectionOpen ? 'rotate-90' : 'rotate-0'
                                        }`}
                                        aria-hidden="true"
                                      />
                        </button>
                                    <div className="flex flex-shrink-0 items-center gap-0.5">
                                      <IconButton
                                        icon={ArrowUpRightDecl}
                                        size="xs"
                                        iconSize={13}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          dismissChatOverlays();
                                          setIsChatsCatalogOpen(true);
                                          setChatsCatalogSearch('');
                                          setIsChatsCatalogSelecting(false);
                                          setChatsCatalogSelectedIds([]);
                                          setIsChatsCatalogFilterOpen(false);
                                          setChatsCatalogFilter('all');
                                        }}
                                        aria-label="Open all chats and tasks"
                                        title="Open all chats"
                                        /* Only the REVEAL rides on className. The button's own look —
                                           quiet at rest, filled on hover — is the ghost variant now. */
                                        className={
                                          isRecentsSectionHovered || isChatsCatalogOpen
                                            ? 'opacity-100'
                                            : 'pointer-events-none opacity-0'
                                        }
                                      />
                              <IconButton
                                icon={SlidersDecl}
                                variant="ghost"
                                size="xs"
                                iconSize={13}
                                onClick={(event) => {
                                          event.stopPropagation();
                                          const rect = event.currentTarget.getBoundingClientRect();
                                          const menuWidth = 168;
                                          const left = Math.min(
                                            Math.max(8, rect.right - menuWidth),
                                            window.innerWidth - menuWidth - 8,
                                          );
                                          setRecentsFilterSubmenu(null);
                                          setRecentsFilterMenu((current) =>
                                            current ? null : { top: rect.bottom + 4, left },
                                          );
                                        }}
                                aria-label="Filter recents"
                                aria-haspopup="menu"
                                aria-expanded={Boolean(recentsFilterMenu)}
                                title="Filter"
                              />
                            </div>
                          </div>
                                  {isRecentsSectionOpen &&
                                    (recentConversations.length === 0 ? (
                                      <p className="px-2.5 py-3 text-[12px] text-[var(--chat-muted)]">No matching conversations</p>
                                    ) : (
                                      recentGroups.map((group) => (
                                        <div key={group.key} className="space-y-0.5">
                                          {group.label && (
                                            <p className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                                              {group.label}
                                            </p>
                                          )}
                                          {group.items.map((convo) => renderHistoryRow(convo, 'recents'))}
                      </div>
                                      ))
                                    ))}
                                </div>
                              )}
                            </div>
                          )
                        )}

                        {historyNavView === 'projects' && (
                          <div className="space-y-2">
                      {/* Stays hand-written — one of the history sidebar's rows, decided with the
                          seven above it: the library's `Sidebar` is the whole panel, and this one is
                          hand-built around a goo pill and per-row menus. */}
                      <button
                        type="button"
                              data-goo-row=""
                              onClick={() => openCreateProjectModal()}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-[var(--chat-text)] transition-colors"
                            >
                              <Plus size={15} />
                              <span>New project</span>
                      </button>
                            {chatProjects.length === 0 ? (
                              emptyPanel('No projects yet', 'Create a project to group related conversations.')
                            ) : (
                              <div className="space-y-0.5">
                                {chatProjects.map((project) => {
                                  const count = conversationHistory.filter((c) => c.projectId === project.id).length;
                                  const isActiveProject = activeProjectId === project.id;
                                  return (
                                    /* Stays hand-written — a history sidebar row, same family
                                       and same reason as the seven nav rows and the New project row
                                       above it. */
                                    <button
                                      key={project.id}
                                      type="button"
                                      data-goo-row=""
                                      title={project.name}
                                      onClick={() => {
                                        // Keep the projects flow open so ← back returns to the list,
                                        // then switch (or open) the selected project workspace.
                                        setIsProjectsPageOpen(true);
                                        try {
                                          localStorage.setItem(PROJECTS_PAGE_OPEN_STORAGE_KEY, 'true');
                                        } catch {
                                          /* ignore storage failures */
                                        }
                                        openProject(project.id);
                                      }}
                                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                                        isActiveProject
                                          ? 'bg-[var(--chat-hover)] text-[var(--chat-text)]'
                                          : 'text-[var(--chat-text)]'
                                      }`}
                                    >
                                      <Folder size={15} className="flex-shrink-0 text-[var(--chat-muted)]" />
                                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                                      <span className="text-[11px] text-[var(--chat-muted)]">{count}</span>
                                    </button>
                                  );
                                })}
                              </div>
                  )}
                </div>
                        )}

                        {historyNavView === 'archived' && (
                          archivedConversations.length === 0 ? (
                            emptyPanel('No archived chats', 'Archive a conversation from the ⋯ menu to see it here.')
                          ) : (
                            <div className="space-y-0.5">
                              <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-[var(--chat-text)]">
                                Archived
                              </p>
                              {archivedConversations.map((convo) => renderHistoryRow(convo, 'archived'))}
                </div>
                          )
                        )}

                        {historyNavView === 'artifacts' && !isArtifactsPageOpen && (
                          <div className="px-3 py-8 text-center">
                            <p className="text-[12px] text-[var(--chat-muted)]">
                              Artifacts open in the main panel.
                            </p>
                          </div>
                        )}

                        {historyNavView === 'global_settings' && !isGlobalSettingsPageOpen && (
                          <div className="px-3 py-8 text-center">
                            <p className="text-[12px] text-[var(--chat-muted)]">
                              Settings open in the main panel.
                            </p>
                          </div>
                        )}

                        {historyNavView === 'scheduled' && !isScheduledPageOpen && (
                          <div className="px-3 py-8 text-center">
                            <p className="text-[12px] text-[var(--chat-muted)]">
                              Scheduled opens in the main panel.
                            </p>
                          </div>
                        )}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
          );

          if (isMultiInterface) {
            return (
              <div
                ref={historySidebarRef}
                className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} chat-history-sidebar absolute z-[50] w-60 border rounded-lg overflow-hidden transition-all duration-300 ease-in-out`}
                data-chat-theme-preference={chatTheme}
                style={{
                  top: '12px',
                  bottom: '12px',
                  left: isHistoryOpen ? '12px' : '-260px',
                  pointerEvents: isHistoryOpen ? 'auto' : 'none',
                  ...historySurfaceStyle,
                }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {historyPanelBody}
                  </div>
            );
          }

          if (isMobile) {
            return createPortal(
              <div
                ref={historySidebarRef}
                className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} chat-history-sidebar fixed z-[50] w-[260px] border rounded-lg overflow-hidden transition-all duration-300 ease-in-out ${!isHistoryOpen ? 'chat-history-sidebar-closed' : ''}`}
                data-chat-theme-preference={chatTheme}
                style={{
                  top: '12px',
                  bottom: '12px',
                  left: isHistoryOpen ? '12px' : '-100%',
                  pointerEvents: isHistoryOpen ? 'auto' : 'none',
                  ...historySurfaceStyle,
                }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {historyPanelBody}
              </div>,
              document.body,
            );
          }

          return createPortal(
            <div
              ref={historySidebarRef}
              className="fixed z-[50]"
              data-history-clip=""
              style={{
                top: 0,
                bottom: 0,
                left: historyLeftInset,
                width: 260,
                overflow: 'hidden',
                pointerEvents: isHistoryOpen ? 'auto' : 'none',
              }}
              aria-hidden={!isHistoryOpen}
            >
              <div
                className={`chat-themed xeno-icon-hosts chat-theme-${resolvedChatTheme} chat-history-sidebar h-full w-full overflow-hidden border-b border-r transition-transform duration-300 ease-in-out ${isTaskbarHidden ? 'border-l rounded-none' : 'border-l-0 rounded-none'}`}
                data-chat-theme-preference={chatTheme}
                style={{
                  transform: isHistoryOpen ? 'translateX(0)' : 'translateX(-100%)',
                  ...historySurfaceStyle,
                }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {historyPanelBody}
                            </div>
            </div>,
            document.body,
          );
        })()}

        {/* Context Panel - Only show in single interface mode */}
        {!isMultiInterface && <ContextPanel />}
      </div>
    </>
  );
};

export default ChatWithLLM;

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send, FileText, Download, Copy, Check, ChevronDown,
  Loader2, X, Maximize2, Minimize2, Lightbulb, Brain, SquarePen,
  ThumbsUp, ThumbsDown, Eye, Paperclip, Code, Edit3, FileCode,
  Printer, FileDown, Undo2, Redo2, PenTool, Search, Replace,
  FileType, History, SpellCheck, LetterText, Save, Share2, Link, Users, ExternalLink
} from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import TipTapEditor, { TipTapEditorRef, EditorToolbar, Editor } from './TipTapEditor';
import PaginatedTipTapEditor, { PaginatedTipTapEditorRef } from './PaginatedTipTapEditor';
import { countMessageTokens, estimateTokens as quickEstimateTokens } from '@/services/tokenizerService';
import { getGroupedModels, GroupedModels, Model, FALLBACK_MODELS } from '@/services/modelService';
import { chatService, Conversation as DBConversation, ChatMessage as DBChatMessage } from '@/services/chatService';
import { chatComplete } from '@/services/aiService';
import TurndownService from 'turndown';
import { saveAs } from 'file-saver';

// Word interface ID for database storage
const WORD_INTERFACE_ID = 'word-processor';

// Create turndown instance for HTML to Markdown conversion
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

const htmlToMarkdown = (html: string): string => {
  if (!html || html.trim() === '' || html === '<p></p>') return '';
  try {
    return turndownService.turndown(html);
  } catch (e) {
    console.error('Error converting HTML to Markdown:', e);
    return '';
  }
};

// Simple Markdown to HTML converter
const markdownToHtml = (markdown: string): string => {
  if (!markdown || markdown.trim() === '') return '';

  let html = markdown;

  // Escape HTML entities first
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Headers (must be at start of line)
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> in <ul> or <ol>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^\*\*\*$/gm, '<hr>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

  // Line breaks - convert double newlines to paragraphs
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs
    .map(p => {
      p = p.trim();
      if (!p) return '';
      // Don't wrap if already a block element
      if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<ol') ||
          p.startsWith('<pre') || p.startsWith('<blockquote') || p.startsWith('<hr')) {
        return p;
      }
      // Convert single newlines to <br> within paragraphs
      p = p.replace(/\n/g, '<br>');
      return `<p>${p}</p>`;
    })
    .filter(p => p)
    .join('\n');

  return html;
};

// Default model to use initially (will be updated when API models are fetched)
const DEFAULT_MODEL: Model = {
  id: "anthropic/claude-sonnet-4",
  name: "Claude Sonnet 4",
  maxTokens: 200000,
};

// Helper to get company name from model ID
const getCompanyNameFromModelId = (modelId: string): string => {
  if (modelId.startsWith('openai/')) return 'OpenAI';
  if (modelId.startsWith('anthropic/')) return 'Anthropic';
  if (modelId.startsWith('google/')) return 'Google';
  if (modelId.startsWith('deepseek/')) return 'DeepSeek';
  if (modelId.startsWith('meta-llama/')) return 'Meta';
  if (modelId.startsWith('mistralai/')) return 'Mistral';
  if (modelId.startsWith('qwen/')) return 'Alibaba';
  if (modelId.startsWith('x-ai/')) return 'xAI';
  return 'Other';
};

// Helper to format token counts
const formatTokens = (tokens: number): string => {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return tokens.toString();
};

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  documentContent?: string;
  styleCommands?: any[];
  isError?: boolean;
  timestamp: number;
  images?: { base64: string; type: string; name: string }[];
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  timestamp: number;
}

type ViewMode = 'edit' | 'preview' | 'markdown' | 'html';

// A4 Edit View Component - renders editable content with visual page boundaries
// Uses a continuous editing experience with page breaks shown visually (like Google Docs)
const A4EditView: React.FC<{
  editorRef: React.RefObject<TipTapEditorRef>;
  content: string;
  onChange: (html: string, markdown: string) => void;
}> = ({ editorRef, content, onChange }) => {
  const [pageCount, setPageCount] = React.useState(1);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // A4 dimensions in pixels (at 96 DPI) - same as A4PageView
  const PAGE_WIDTH = 794;
  const PAGE_HEIGHT = 1123;
  const PADDING_TOP = 60;
  const PADDING_SIDE = 60;
  const PADDING_BOTTOM = 80;
  const CONTENT_HEIGHT = PAGE_HEIGHT - PADDING_TOP - PADDING_BOTTOM; // 983px
  const PAGE_GAP = 32;

  // Calculate page count based on editor content height
  const updatePageCount = React.useCallback(() => {
    if (containerRef.current) {
      const proseMirror = containerRef.current.querySelector('.ProseMirror');
      if (proseMirror) {
        const contentHeight = proseMirror.scrollHeight - (PADDING_TOP * 2); // Subtract padding
        const pages = Math.max(1, Math.ceil(contentHeight / CONTENT_HEIGHT));
        if (pages !== pageCount) {
          setPageCount(pages);
        }
      }
    }
  }, [pageCount, CONTENT_HEIGHT, PADDING_TOP]);

  // Update page count when content changes
  const handleChange = (html: string, markdown: string) => {
    onChange(html, markdown);
    // Delay to let the editor render
    setTimeout(updatePageCount, 50);
  };

  // Initial page count calculation
  React.useEffect(() => {
    const timer = setTimeout(updatePageCount, 100);
    return () => clearTimeout(timer);
  }, [content, updatePageCount]);

  // Listen to editor mutations for page count updates
  React.useEffect(() => {
    if (!containerRef.current) return;
    const observer = new MutationObserver(() => {
      updatePageCount();
    });
    observer.observe(containerRef.current, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [updatePageCount]);

  // Calculate total height needed for all pages
  const totalHeight = (pageCount * PAGE_HEIGHT) + ((pageCount - 1) * PAGE_GAP);

  return (
    <div className="a4-edit-pages-container" ref={containerRef}>
      <style>{`
        .a4-edit-pages-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 24px;
          min-height: 100%;
          background: #3a3a3d;
        }
        .a4-edit-wrapper {
          position: relative;
          width: ${PAGE_WIDTH}px;
          min-height: ${totalHeight}px;
        }
        /* Page frame backgrounds */
        .a4-edit-page-bg {
          position: absolute;
          left: 0;
          width: ${PAGE_WIDTH}px;
          height: ${PAGE_HEIGHT}px;
          background: white;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          pointer-events: none;
        }
        /* Page numbers */
        .a4-edit-page-num {
          position: absolute;
          left: 0;
          width: ${PAGE_WIDTH}px;
          text-align: center;
          font-size: 11px;
          color: #666;
          pointer-events: none;
          z-index: 5;
        }
        /* Page break indicators between pages */
        .a4-edit-page-break {
          position: absolute;
          left: 0;
          width: ${PAGE_WIDTH}px;
          height: ${PAGE_GAP}px;
          background: #3a3a3d;
          pointer-events: none;
          z-index: 10;
        }
        /* The editor container */
        .a4-edit-editor-container {
          position: relative;
          z-index: 1;
        }
        .a4-edit-editor-container .ProseMirror {
          outline: none;
          font-family: 'Segoe UI', Arial, sans-serif;
          color: #1f2937;
          line-height: 1.6;
          padding: ${PADDING_TOP}px ${PADDING_SIDE}px;
          min-height: ${CONTENT_HEIGHT}px;
          background: transparent;
        }
        .a4-edit-editor-container .ProseMirror h1 {
          font-size: 2em;
          text-align: center;
          margin-top: 0;
          margin-bottom: 0.5em;
        }
        .a4-edit-editor-container .ProseMirror h2 {
          font-size: 1.5em;
          border-bottom: 2px solid #333;
          padding-bottom: 0.3em;
          margin-bottom: 0.5em;
        }
        .a4-edit-editor-container .ProseMirror h3 {
          font-size: 1.25em;
          margin-bottom: 0.5em;
        }
        .a4-edit-editor-container .ProseMirror p {
          margin-bottom: 0.75em;
        }
        .a4-edit-editor-container .ProseMirror ul,
        .a4-edit-editor-container .ProseMirror ol {
          margin-bottom: 0.75em;
          padding-left: 1.5em;
        }
        .a4-edit-editor-container .ProseMirror blockquote {
          border-left: 3px solid #ccc;
          padding-left: 1em;
          margin-left: 0;
          color: #555;
        }
        .a4-edit-editor-container .ProseMirror pre {
          background: #f3f4f6;
          padding: 1em;
          border-radius: 4px;
          overflow-x: auto;
        }
        .a4-edit-editor-container .ProseMirror code {
          background: #f3f4f6;
          padding: 0.2em 0.4em;
          border-radius: 3px;
          font-family: 'Courier New', monospace;
        }
        .a4-edit-editor-container .ProseMirror table {
          border-collapse: collapse;
          width: 100%;
          margin-bottom: 0.75em;
        }
        .a4-edit-editor-container .ProseMirror td,
        .a4-edit-editor-container .ProseMirror th {
          border: 1px solid #ccc;
          padding: 0.5em;
        }
        .a4-edit-editor-container .ProseMirror th {
          background: #f3f4f6;
          font-weight: 600;
        }
        .a4-edit-editor-container .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #9ca3af;
          pointer-events: none;
          height: 0;
        }
      `}</style>

      <div className="a4-edit-wrapper">
        {/* Render page backgrounds */}
        {Array.from({ length: pageCount }, (_, index) => {
          const pageTop = index * (PAGE_HEIGHT + PAGE_GAP);
          return (
            <React.Fragment key={`page-${index}`}>
              {/* Page background */}
              <div className="a4-edit-page-bg" style={{ top: pageTop }} />
              {/* Page number */}
              <div
                className="a4-edit-page-num"
                style={{ top: pageTop + PAGE_HEIGHT - 40 }}
              >
                Page {index + 1} of {pageCount}
              </div>
              {/* Page break between pages */}
              {index < pageCount - 1 && (
                <div
                  className="a4-edit-page-break"
                  style={{ top: pageTop + PAGE_HEIGHT }}
                />
              )}
            </React.Fragment>
          );
        })}

        {/* The single continuous editor */}
        <div className="a4-edit-editor-container">
          <TipTapEditor
            ref={editorRef}
            content={content}
            onChange={handleChange}
            placeholder="Start writing or ask AI to create a document..."
            hideToolbar={true}
          />
        </div>
      </div>
    </div>
  );
};

// A4 Page View Component - renders content in A4 page format like Word
const A4PageView: React.FC<{ html: string; isEdit?: boolean }> = ({ html, isEdit = false }) => {
  const [pageCount, setPageCount] = React.useState(1);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const measureRef = React.useRef<HTMLDivElement>(null);

  // A4 dimensions in pixels (at 96 DPI)
  const PAGE_WIDTH = 794;
  const PAGE_HEIGHT = 1123;
  const PADDING_TOP = 60;
  const PADDING_SIDE = 60;
  const PADDING_BOTTOM = 80;
  const CONTENT_HEIGHT = PAGE_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  // Measure content and calculate pages
  React.useEffect(() => {
    if (measureRef.current && html) {
      const contentHeight = measureRef.current.scrollHeight;
      const pages = Math.max(1, Math.ceil(contentHeight / CONTENT_HEIGHT));
      setPageCount(pages);
    }
  }, [html]);

  if (!html && !isEdit) {
    return (
      <div className="a4-pages-container">
        <div className="a4-page">
          <div className="a4-page-content preview-content">
            <p style={{ color: '#9ca3af', textAlign: 'center', paddingTop: '40px' }}>
              No content yet. Start writing in Edit mode or ask AI to create a document.
            </p>
          </div>
          <div className="a4-page-number">Page 1 of 1</div>
        </div>
      </div>
    );
  }

  return (
    <div className="a4-pages-container">
      <style>{`
        .a4-pages-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 32px;
          padding: 24px;
          min-height: 100%;
        }
        .a4-page {
          width: ${PAGE_WIDTH}px;
          height: ${PAGE_HEIGHT}px;
          background: white;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          position: relative;
          overflow: hidden;
          flex-shrink: 0;
        }
        .a4-page-content {
          position: absolute;
          top: ${PADDING_TOP}px;
          left: ${PADDING_SIDE}px;
          right: ${PADDING_SIDE}px;
          height: ${CONTENT_HEIGHT}px;
          overflow: hidden;
        }
        .a4-page-content-inner {
          position: absolute;
          width: ${PAGE_WIDTH - (PADDING_SIDE * 2)}px;
        }
        .a4-page-number {
          position: absolute;
          bottom: 30px;
          left: 0;
          right: 0;
          text-align: center;
          font-size: 11px;
          color: #666;
        }
        .a4-measure-container {
          position: absolute;
          visibility: hidden;
          width: ${PAGE_WIDTH - (PADDING_SIDE * 2)}px;
          pointer-events: none;
        }
      `}</style>

      {/* Hidden measurement div to calculate total content height */}
      <div
        ref={measureRef}
        className="a4-measure-container preview-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {/* Render pages */}
      {Array.from({ length: pageCount }, (_, index) => (
        <div key={index} className="a4-page">
          <div className="a4-page-content">
            <div
              className="a4-page-content-inner preview-content"
              style={{ top: -(index * CONTENT_HEIGHT) }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
          <div className="a4-page-number">Page {index + 1} of {pageCount}</div>
        </div>
      ))}
    </div>
  );
};

const SYSTEM_PROMPT = `You are a professional document writer and editor with styling capabilities. You help users create, edit, and format documents.

## YOUR CAPABILITIES:
1. Create documents (letters, reports, essays, proposals, resumes, etc.)
2. Edit specific parts of documents
3. Apply styling (fonts, colors, sizes, alignment)
4. Format content with proper structure

## CRITICAL: DOCUMENT AWARENESS
- You will receive the CURRENT DOCUMENT STATE before each user request
- This represents the ACTUAL current state of the document in the editor
- The user may have manually edited the document since your last response
- **ALWAYS use the provided "CURRENT DOCUMENT STATE" as your source of truth**
- When making edits, modify the PROVIDED document, not any previous version you generated
- If the user says they changed something, look at the current document - their changes are already there

## OUTPUT FORMAT:
You can output in two ways:

### 1. For document content, use:
\`\`\`document
Your document content in HTML format here
\`\`\`

### 2. For styling commands, use:
\`\`\`style
{
  "commands": [
    { "action": "setFontFamily", "value": "Georgia, serif" },
    { "action": "setColor", "value": "#1e40af" },
    { "action": "setFontSize", "value": "18px" },
    { "action": "toggleBold" },
    { "action": "toggleItalic" }
  ]
}
\`\`\`

## AVAILABLE STYLING COMMANDS:
- setFontFamily: "Arial, sans-serif", "Georgia, serif", "Times New Roman, serif", "Courier New, monospace", etc.
- setColor: Any hex color like "#000000", "#1e40af", "#dc2626"
- setFontSize: "12px", "14px", "16px", "18px", "24px", "32px", etc.
- toggleBold, toggleItalic, toggleUnderline, toggleStrike
- setTextAlign: "left", "center", "right", "justify"
- setHighlight: Any hex color for background highlight

## HTML DOCUMENT FORMAT:
Use clean semantic HTML:
- <h1>, <h2>, <h3> for headings
- <p> for paragraphs
- <strong> for bold, <em> for italic
- <ul>/<ol> with <li> for lists
- <table>, <tr>, <th>, <td> for tables
- <blockquote> for quotes
- <a href="url"> for links

## RESPONSE GUIDELINES:
- For new documents: Output the complete HTML in \`\`\`document block
- For content edits: Output the complete updated document based on CURRENT DOCUMENT STATE
- For style changes: Output \`\`\`style block with commands
- Be concise in explanations (1-2 sentences max)
- When user asks to "make it blue" or "change font", use style commands
- When user asks to "write" or "create", output document content`;

const WordChatInterface: React.FC = () => {
  // URL params and navigation
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model>(DEFAULT_MODEL);
  const [usedTokens, setUsedTokens] = useState(0);
  const [uploadedImages, setUploadedImages] = useState<{ base64: string; type: string; name: string }[]>([]);

  // Dynamic model loading state
  const [groupedModels, setGroupedModels] = useState<GroupedModels[]>(FALLBACK_MODELS);
  const [isModelsLoading, setIsModelsLoading] = useState(true);
  const [isModelSelectorButtonHovered, setIsModelSelectorButtonHovered] = useState(false);

  // UI state
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<Conversation[]>([]);
  const [isDbInitialized, setIsDbInitialized] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedAiMessageId, setCopiedAiMessageId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Share state
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [isCreatingShareLink, setIsCreatingShareLink] = useState(false);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [sharedConversationData, setSharedConversationData] = useState<{
    title: string;
    owner_name: string;
    messages: ChatMessage[];
    token: string;
  } | null>(null);
  const [isAcceptingShare, setIsAcceptingShare] = useState(false);

  // Document state
  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [currentHtml, setCurrentHtml] = useState<string>('');
  const [currentMarkdown, setCurrentMarkdown] = useState<string>('');
  const [isDocumentFullscreen, setIsDocumentFullscreen] = useState(false);
  const [copiedDocument, setCopiedDocument] = useState(false);
  const [previewPageMode, setPreviewPageMode] = useState<'infinite' | 'a4'>('infinite');

  // New feature states
  const [isDownloadDropdownOpen, setIsDownloadDropdownOpen] = useState(false);
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [findResults, setFindResults] = useState<{ count: number; current: number }>({ count: 0, current: 0 });
  const [isSpellCheckEnabled, setIsSpellCheckEnabled] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [isUndoHistoryOpen, setIsUndoHistoryOpen] = useState(false);

  // Refs
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const companyDropdownRef = useRef<HTMLDivElement>(null);
  const downloadDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<TipTapEditorRef>(null);
  const paginatedEditorRef = useRef<PaginatedTipTapEditorRef>(null); // For A4 paginated mode
  const lastAiContentRef = useRef<string>(''); // Track last AI-generated content to avoid re-setting
  const documentEditedManuallyRef = useRef<boolean>(false); // Track if document was edited by user
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null); // For external toolbar

  // Load models from API on component mount
  useEffect(() => {
    const loadModels = async () => {
      try {
        setIsModelsLoading(true);
        console.log('🔄 [Word] Loading models from API...');
        const models = await getGroupedModels();
        setGroupedModels(models);

        // Set default selected model to first Anthropic model if available
        const anthropicGroup = models.find(g => g.companyName === 'Anthropic');
        if (anthropicGroup && anthropicGroup.models.length > 0) {
          setSelectedModel(anthropicGroup.models[0]);
        } else if (models.length > 0 && models[0].models.length > 0) {
          setSelectedModel(models[0].models[0]);
        }

        console.log(`✅ [Word] Loaded ${models.length} company groups with models`);
      } catch (error) {
        console.error('❌ [Word] Failed to load models, using fallback:', error);
      } finally {
        setIsModelsLoading(false);
      }
    };

    loadModels();
  }, []);

  // Initialize database and load conversation history
  useEffect(() => {
    const initializeAndLoad = async () => {
      try {
        // Initialize chat tables
        await chatService.initTables();
        setIsDbInitialized(true);
        console.log('✅ [Word] Database initialized');

        // Check for localStorage migration
        const localStorageData = localStorage.getItem('wordChatHistory');
        if (localStorageData) {
          try {
            const localConversations = JSON.parse(localStorageData) as Conversation[];
            if (localConversations.length > 0) {
              console.log(`📦 [Word] Found ${localConversations.length} conversations in localStorage, migrating to database...`);

              // Migrate each conversation to database
              for (const conv of localConversations) {
                try {
                  // Create conversation in database
                  const dbConversation = await chatService.createConversation({
                    title: conv.title,
                    interface_id: WORD_INTERFACE_ID,
                    model_id: selectedModel.id,
                  });

                  if (!dbConversation) {
                    throw new Error('Conversation creation returned no record');
                  }

                  // Add messages to the conversation
                  for (const msg of conv.messages) {
                    await chatService.addMessage(dbConversation.id, {
                      role: msg.sender === 'user' ? 'user' : 'assistant',
                      content: msg.text,
                      model_id: selectedModel.id,
                    });
                  }

                  console.log(`✅ [Word] Migrated conversation: ${conv.title}`);
                } catch (migrationError) {
                  console.error(`❌ [Word] Failed to migrate conversation: ${conv.title}`, migrationError);
                }
              }

              // Clear localStorage after successful migration
              localStorage.removeItem('wordChatHistory');
              console.log('✅ [Word] LocalStorage migration complete, cleared localStorage');
            }
          } catch (parseError) {
            console.error('❌ [Word] Failed to parse localStorage data:', parseError);
          }
        }

        // Load conversations from database
        const { conversations } = await chatService.getConversations({
          interface_id: WORD_INTERFACE_ID,
          limit: 50,
        });

        // Convert database format to local format
        const localConversations: Conversation[] = conversations.map(dbConv => ({
          id: dbConv.id,
          title: dbConv.title,
          timestamp: new Date(dbConv.created_at || Date.now()).getTime(),
          messages: (dbConv.messages || []).map(msg => ({
            id: msg.id || `msg-${Date.now()}-${Math.random()}`,
            sender: msg.role === 'user' ? 'user' as const : 'ai' as const,
            text: msg.content,
            timestamp: new Date(msg.created_at || Date.now()).getTime(),
          })),
        }));

        setConversationHistory(localConversations);
        console.log(`✅ [Word] Loaded ${localConversations.length} conversations from database`);
      } catch (error) {
        console.error('❌ [Word] Failed to initialize database:', error);

        // Fallback to localStorage if database fails
        const saved = localStorage.getItem('wordChatHistory');
        if (saved) {
          try {
            setConversationHistory(JSON.parse(saved));
            console.log('📦 [Word] Loaded conversations from localStorage (fallback)');
          } catch (e) {
            console.error('Error loading from localStorage:', e);
          }
        }
      }
    };

    initializeAndLoad();
  }, []);

  // Auto-load the most recent conversation on mount
  useEffect(() => {
    const autoLoadConversation = async () => {
      // Wait for database to be initialized and conversations to be loaded
      if (!isDbInitialized || conversationHistory.length === 0) return;

      // Check if messages are already loaded (avoid reloading)
      if (messages.length > 0 || activeConversationId) return;

      // Get the most recent conversation (first one, since they're sorted by timestamp)
      const mostRecentConv = conversationHistory[0];
      if (!mostRecentConv) return;

      // Helper to extract document content from message
      const getDocContent = (content: string): string | null => {
        const documentRegex = /```document\s*([\s\S]*?)```/gi;
        const matches = [...content.matchAll(documentRegex)];
        if (matches.length > 0) {
          return matches[matches.length - 1][1].trim();
        }
        const htmlRegex = /```html\s*([\s\S]*?)```/gi;
        const htmlMatches = [...content.matchAll(htmlRegex)];
        if (htmlMatches.length > 0) {
          return htmlMatches[htmlMatches.length - 1][1].trim();
        }
        return null;
      };

      // Load the conversation from database
      try {
        const dbConversation = await chatService.getConversation(mostRecentConv.id);
        if (dbConversation && dbConversation.messages) {
          const loadedMessages: ChatMessage[] = dbConversation.messages.map(msg => ({
            id: msg.id || `msg-${Date.now()}-${Math.random()}`,
            sender: msg.role === 'user' ? 'user' as const : 'ai' as const,
            text: msg.content,
            timestamp: new Date(msg.created_at || Date.now()).getTime(),
          }));
          setMessages(loadedMessages);
          setActiveConversationId(mostRecentConv.id);

          // Find last document content in messages
          const lastDoc = [...loadedMessages].reverse().find(m => {
            const docContent = getDocContent(m.text);
            return docContent !== null;
          });
          if (lastDoc) {
            const docContent = getDocContent(lastDoc.text);
            if (docContent) {
              setCurrentHtml(docContent);
              setCurrentMarkdown(htmlToMarkdown(docContent));
              editorRef.current?.setContent(docContent);
            }
          }
          console.log(`✅ [Word] Auto-loaded most recent conversation: ${mostRecentConv.id}`);
        }
      } catch (error) {
        console.error('❌ [Word] Failed to auto-load conversation:', error);
      }
    };

    autoLoadConversation();
  }, [isDbInitialized, conversationHistory]);

  // Update editor instance for external toolbar
  useEffect(() => {
    // Poll for editor instance (editor may initialize after component mounts)
    // Check both regular and paginated editor refs based on current mode
    const checkEditor = () => {
      let editor: Editor | null = null;

      if (previewPageMode === 'a4' && viewMode === 'edit') {
        // In A4 mode, use paginated editor
        editor = paginatedEditorRef.current?.getEditor() || null;
      } else {
        // In scroll mode, use regular editor
        editor = editorRef.current?.getEditor() || null;
      }

      if (editor && editor !== editorInstance) {
        setEditorInstance(editor);
      }
    };

    // Check immediately and then periodically
    checkEditor();
    const interval = setInterval(checkEditor, 100);

    // Stop polling after editor is found or after 5 seconds
    const timeout = setTimeout(() => clearInterval(interval), 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [viewMode, previewPageMode, editorInstance]);

  // Check for share token in URL
  useEffect(() => {
    const shareToken = searchParams.get('share');
    if (shareToken && isDbInitialized) {
      // Load shared conversation data
      const loadSharedConversation = async () => {
        try {
          const sharedData = await chatService.getSharedConversation(shareToken);
          if (sharedData) {
            setSharedConversationData({
              title: sharedData.title,
              owner_name: sharedData.owner_name,
              messages: sharedData.messages.map(msg => ({
                id: msg.id || `msg-${Date.now()}-${Math.random()}`,
                sender: msg.role === 'user' ? 'user' as const : 'ai' as const,
                text: msg.content,
                timestamp: new Date(msg.created_at || Date.now()).getTime(),
              })),
              token: shareToken,
            });
          } else {
            console.error('Share link not found or expired');
            // Clear the share param from URL
            searchParams.delete('share');
            setSearchParams(searchParams);
          }
        } catch (error) {
          console.error('Failed to load shared conversation:', error);
          searchParams.delete('share');
          setSearchParams(searchParams);
        }
      };
      loadSharedConversation();
    }
  }, [searchParams, isDbInitialized, setSearchParams]);

  // Handle accepting shared conversation
  const handleAcceptSharedConversation = async () => {
    if (!sharedConversationData) return;

    setIsAcceptingShare(true);
    try {
      const acceptedConversation = await chatService.acceptSharedConversation(sharedConversationData.token);
      if (acceptedConversation) {
        // Load the accepted conversation
        const loadedMessages: ChatMessage[] = sharedConversationData.messages;
        setMessages(loadedMessages);
        setActiveConversationId(acceptedConversation.id);

        // Find and load last document content if exists
        const lastDoc = [...loadedMessages].reverse().find(m => {
          const docContent = extractDocumentContent(m.text);
          return docContent !== null;
        });
        if (lastDoc) {
          const docContent = extractDocumentContent(lastDoc.text);
          if (docContent) {
            setCurrentHtml(docContent);
            editorRef.current?.setContent(docContent);
          }
        }

        // Refresh conversation history
        const { conversations } = await chatService.getConversations({
          interface_id: WORD_INTERFACE_ID,
          limit: 50,
        });
        const localConversations: Conversation[] = conversations.map(dbConv => ({
          id: dbConv.id,
          title: dbConv.title,
          timestamp: new Date(dbConv.created_at || Date.now()).getTime(),
          messages: (dbConv.messages || []).map(msg => ({
            id: msg.id || `msg-${Date.now()}-${Math.random()}`,
            sender: msg.role === 'user' ? 'user' as const : 'ai' as const,
            text: msg.content,
            timestamp: new Date(msg.created_at || Date.now()).getTime(),
          })),
        }));
        setConversationHistory(localConversations);

        // Clear share data and URL param
        setSharedConversationData(null);
        searchParams.delete('share');
        setSearchParams(searchParams);

        console.log('✅ [Word] Accepted shared conversation:', acceptedConversation.id);
      }
    } catch (error) {
      console.error('Failed to accept shared conversation:', error);
    } finally {
      setIsAcceptingShare(false);
    }
  };

  // Handle declining shared conversation
  const handleDeclineSharedConversation = () => {
    setSharedConversationData(null);
    searchParams.delete('share');
    setSearchParams(searchParams);
  };

  // Create share link for current conversation
  const handleCreateShareLink = async () => {
    if (!activeConversationId) return;

    setIsCreatingShareLink(true);
    try {
      const share = await chatService.createShareLink(activeConversationId);
      if (share) {
        setShareLink(share.share_url);
      }
    } catch (error) {
      console.error('Failed to create share link:', error);
    } finally {
      setIsCreatingShareLink(false);
    }
  };

  // Copy share link to clipboard
  const handleCopyShareLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setCopiedShareLink(true);
      setTimeout(() => setCopiedShareLink(false), 2000);
    }
  };

  // Auto-scroll chat
  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [messages]);

  // Quick token estimate (fallback only)
  const estimateTokens = useCallback((text: string): number => quickEstimateTokens(text), []);

  // Ref for debouncing real token count API calls
  const tokenCountDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Real token count via API (debounced) - keeps last known value until new one arrives
  useEffect(() => {
    if (tokenCountDebounceRef.current) {
      clearTimeout(tokenCountDebounceRef.current);
    }

    tokenCountDebounceRef.current = setTimeout(async () => {
      try {
        const normalizedMessages = messages.map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text
        }));

        if (inputValue.trim()) {
          normalizedMessages.push({ role: 'user', content: inputValue });
        }

        const result = await countMessageTokens(
          normalizedMessages,
          selectedModel?.id || 'gpt-4',
          ''
        );

        setUsedTokens(result.total);
      } catch (error) {
        console.warn('[TokenCount] Error fetching real token count:', error);
        // Fallback to quick estimate on error
        const fallback = messages.reduce((acc, msg) => acc + estimateTokens(msg.text), 0) + estimateTokens(inputValue);
        setUsedTokens(fallback);
      }
    }, 300);

    return () => {
      if (tokenCountDebounceRef.current) {
        clearTimeout(tokenCountDebounceRef.current);
      }
    };
  }, [messages, inputValue, selectedModel?.id, estimateTokens]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [inputValue]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (companyDropdownRef.current && !companyDropdownRef.current.contains(e.target as Node)) {
        setIsCompanyDropdownOpen(false);
      }
      if (downloadDropdownRef.current && !downloadDropdownRef.current.contains(e.target as Node)) {
        setIsDownloadDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Word and character count
  const documentStats = useMemo(() => {
    const plainText = currentHtml
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

    const charCount = plainText.length;
    const wordCount = plainText ? plainText.split(/\s+/).filter(w => w.length > 0).length : 0;
    const paragraphCount = (currentHtml.match(/<p[^>]*>/gi) || []).length || (plainText ? 1 : 0);

    return { charCount, wordCount, paragraphCount };
  }, [currentHtml]);

  // Auto-save functionality
  useEffect(() => {
    if (currentHtml && hasUnsavedChanges) {
      const saveTimeout = setTimeout(() => {
        localStorage.setItem('wordDocument_autosave', JSON.stringify({
          html: currentHtml,
          markdown: currentMarkdown,
          timestamp: new Date().toISOString()
        }));
        setLastSaved(new Date());
        setHasUnsavedChanges(false);
      }, 2000); // Auto-save after 2 seconds of no changes

      return () => clearTimeout(saveTimeout);
    }
  }, [currentHtml, currentMarkdown, hasUnsavedChanges]);

  // Load auto-saved document on mount
  useEffect(() => {
    const saved = localStorage.getItem('wordDocument_autosave');
    if (saved && !currentHtml) {
      try {
        const { html, markdown, timestamp } = JSON.parse(saved);
        if (html) {
          setCurrentHtml(html);
          setCurrentMarkdown(markdown || htmlToMarkdown(html));
          setLastSaved(new Date(timestamp));
          editorRef.current?.setContent(html);
        }
      } catch (e) {
        console.error('Error loading auto-saved document:', e);
      }
    }
  }, []);

  // Track undo history
  const pushToUndoStack = useCallback((html: string) => {
    setUndoStack(prev => {
      const newStack = [...prev, html].slice(-20); // Keep last 20 states
      return newStack;
    });
    setRedoStack([]); // Clear redo stack on new change
  }, []);

  // Find text in document
  const handleFind = useCallback(() => {
    if (!findText || !currentHtml) {
      setFindResults({ count: 0, current: 0 });
      return;
    }
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = currentHtml.match(regex);
    setFindResults({ count: matches?.length || 0, current: matches?.length ? 1 : 0 });
  }, [findText, currentHtml]);

  // Replace text in document
  const handleReplace = useCallback(() => {
    if (!findText) return;
    pushToUndoStack(currentHtml);
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const newHtml = currentHtml.replace(regex, replaceText);
    setCurrentHtml(newHtml);
    setCurrentMarkdown(htmlToMarkdown(newHtml));
    editorRef.current?.setContent(newHtml);
    setHasUnsavedChanges(true);
    handleFind(); // Update find results
  }, [findText, replaceText, currentHtml, pushToUndoStack, handleFind]);

  // Replace all occurrences
  const handleReplaceAll = useCallback(() => {
    if (!findText) return;
    pushToUndoStack(currentHtml);
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const newHtml = currentHtml.replace(regex, replaceText);
    setCurrentHtml(newHtml);
    setCurrentMarkdown(htmlToMarkdown(newHtml));
    editorRef.current?.setContent(newHtml);
    setHasUnsavedChanges(true);
    setFindResults({ count: 0, current: 0 });
  }, [findText, replaceText, currentHtml, pushToUndoStack]);

  // Undo function
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previousState = undoStack[undoStack.length - 1];
    setRedoStack(prev => [...prev, currentHtml]);
    setUndoStack(prev => prev.slice(0, -1));
    setCurrentHtml(previousState);
    setCurrentMarkdown(htmlToMarkdown(previousState));
    editorRef.current?.setContent(previousState);
  }, [undoStack, currentHtml]);

  // Redo function
  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const nextState = redoStack[redoStack.length - 1];
    setUndoStack(prev => [...prev, currentHtml]);
    setRedoStack(prev => prev.slice(0, -1));
    setCurrentHtml(nextState);
    setCurrentMarkdown(htmlToMarkdown(nextState));
    editorRef.current?.setContent(nextState);
  }, [redoStack, currentHtml]);

  // Extract document content from AI response
  const extractDocumentContent = useCallback((content: string): string | null => {
    const documentRegex = /```document\s*([\s\S]*?)```/gi;
    const matches = [...content.matchAll(documentRegex)];
    if (matches.length > 0) {
      return matches[matches.length - 1][1].trim();
    }

    // Also try HTML blocks
    const htmlRegex = /```html\s*([\s\S]*?)```/gi;
    const htmlMatches = [...content.matchAll(htmlRegex)];
    if (htmlMatches.length > 0) {
      return htmlMatches[htmlMatches.length - 1][1].trim();
    }

    return null;
  }, []);

  // Extract style commands from AI response
  const extractStyleCommands = useCallback((content: string): any[] | null => {
    const styleRegex = /```style\s*([\s\S]*?)```/gi;
    const matches = [...content.matchAll(styleRegex)];
    if (matches.length > 0) {
      try {
        const parsed = JSON.parse(matches[matches.length - 1][1].trim());
        return parsed.commands || [];
      } catch (e) {
        console.error('Failed to parse style commands:', e);
      }
    }
    return null;
  }, []);

  // Strip document/style blocks from chat display
  const stripBlocksFromChat = useCallback((content: string): string => {
    let stripped = content.replace(/```(?:document|html|style)\s*[\s\S]*?```/gi, '');
    stripped = stripped.replace(/\n{3,}/g, '\n\n').trim();
    return stripped || 'Done.';
  }, []);

  // Apply style commands to editor
  const applyStyleCommands = useCallback((commands: any[]) => {
    if (!editorRef.current) return;
    commands.forEach(cmd => {
      editorRef.current?.executeCommand(cmd);
    });
  }, []);

  // Watch for document/style content in messages
  useEffect(() => {
    const lastAssistantMessage = [...messages].reverse().find(m => m.sender === 'ai');
    if (lastAssistantMessage) {
      // Check for document content
      const docContent = extractDocumentContent(lastAssistantMessage.text);
      // Only update if this is NEW AI content (not already processed)
      if (docContent && docContent !== lastAiContentRef.current) {
        lastAiContentRef.current = docContent; // Mark as processed
        documentEditedManuallyRef.current = false; // Reset manual edit flag since AI just updated
        setCurrentHtml(docContent);
        // Also convert and set markdown immediately
        const markdownContent = htmlToMarkdown(docContent);
        setCurrentMarkdown(markdownContent);
        editorRef.current?.setContent(docContent);
      }

      // Check for style commands
      const styleCommands = extractStyleCommands(lastAssistantMessage.text);
      if (styleCommands && styleCommands.length > 0) {
        applyStyleCommands(styleCommands);
      }
    }
  }, [messages, extractDocumentContent, extractStyleCommands, applyStyleCommands]);

  // Handle editor content change
  const handleEditorChange = useCallback((html: string, markdown: string) => {
    // Push current state to undo stack before change (debounced)
    if (currentHtml && html !== currentHtml) {
      pushToUndoStack(currentHtml);
      // Mark as manually edited if the new content differs from the last AI content
      if (html !== lastAiContentRef.current) {
        documentEditedManuallyRef.current = true;
      }
    }
    setCurrentHtml(html);
    setCurrentMarkdown(markdown);
    setHasUnsavedChanges(true);
  }, [currentHtml, pushToUndoStack]);

  // Save conversation
  const saveConversation = useCallback(() => {
    if (messages.length === 0) return;
    const firstUserMessage = messages.find(m => m.sender === 'user');
    const title = firstUserMessage?.text.slice(0, 50) + (firstUserMessage?.text.length || 0 > 50 ? '...' : '') || 'New Document';

    if (activeConversationId) {
      setConversationHistory(prev => prev.map(conv =>
        conv.id === activeConversationId ? { ...conv, messages, timestamp: Date.now() } : conv
      ));
    } else {
      const newConvo: Conversation = {
        id: `conv-${Date.now()}`,
        title,
        messages,
        timestamp: Date.now()
      };
      setConversationHistory(prev => [newConvo, ...prev]);
      setActiveConversationId(newConvo.id);
    }
  }, [messages, activeConversationId]);

  useEffect(() => {
    if (messages.length > 0) {
      const timeout = setTimeout(saveConversation, 1000);
      return () => clearTimeout(timeout);
    }
  }, [messages, saveConversation]);

  // Send message
  const sendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const imagesToSend = [...uploadedImages];
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: inputValue.trim(),
      timestamp: Date.now(),
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setUploadedImages([]);
    setIsLoading(true);

    // Create or get conversation ID for database storage
    let conversationId = activeConversationId;

    try {
      // Create new conversation in database if this is the first message
      if (!conversationId && isDbInitialized) {
        try {
          const title = userMessage.text.slice(0, 50) + (userMessage.text.length > 50 ? '...' : '');
          const dbConversation = await chatService.createConversation({
            title,
            interface_id: WORD_INTERFACE_ID,
            model_id: selectedModel.id,
          });
          if (!dbConversation) {
            throw new Error('Conversation creation returned no record');
          }
          conversationId = dbConversation.id;
          setActiveConversationId(conversationId);
          console.log(`✅ [Word] Created new conversation: ${conversationId}`);
        } catch (dbError) {
          console.error('❌ [Word] Failed to create conversation in database:', dbError);
        }
      }

      // Save user message to database
      if (conversationId && isDbInitialized) {
        try {
          await chatService.addMessage(conversationId, {
            role: 'user',
            content: userMessage.text,
            model_id: selectedModel.id,
          });
        } catch (dbError) {
          console.error('❌ [Word] Failed to save user message to database:', dbError);
        }
      }

      let userText = userMessage.text;

      // Include current document for context - make it clear if user manually edited
      if (currentHtml) {
        const editedNote = documentEditedManuallyRef.current
          ? '\n\n**IMPORTANT: The user has manually edited this document since your last response. The HTML below reflects their current edits - treat this as the source of truth and make changes based on THIS version.**\n'
          : '';

        userText = `CURRENT DOCUMENT STATE:${editedNote}
\`\`\`html
${currentHtml}
\`\`\`

USER REQUEST: ${userMessage.text}`;

        // Reset the manual edit flag after sending
        documentEditedManuallyRef.current = false;
      }

      // Check if model supports vision using inputModalities
      const supportsVision = selectedModel.supportsVision ||
        (selectedModel.inputModalities?.includes('image') || selectedModel.inputModalities?.includes('file'));

      let userContent: any = userText;
      if (imagesToSend.length > 0 && supportsVision) {
        userContent = [
          { type: 'text', text: userText },
          ...imagesToSend.map(img => ({
            type: 'image_url',
            image_url: { url: img.base64 }
          }))
        ];
      }

      const result = await chatComplete({
        model: selectedModel.id,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages.slice(-10).map(m => ({ role: m.sender === 'user' ? 'user' as const : 'assistant' as const, content: m.text })),
          { role: 'user', content: userContent }
        ] as any,
        path: 'premium',
        temperature: 0.3,
        maxTokens: 16384, // Default max output tokens
      });

      const assistantContent = result.content || 'Sorry, I could not generate a response.';

      const assistantMessage: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: assistantContent,
        timestamp: Date.now(),
        documentContent: extractDocumentContent(assistantContent) || undefined,
        styleCommands: extractStyleCommands(assistantContent) || undefined,
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Save assistant message to database
      if (conversationId && isDbInitialized) {
        try {
          await chatService.addMessage(conversationId, {
            role: 'assistant',
            content: assistantContent,
            model_id: selectedModel.id,
          });
        } catch (dbError) {
          console.error('❌ [Word] Failed to save assistant message to database:', dbError);
        }
      }

      // Update conversation history with new/updated conversation
      if (conversationId && isDbInitialized) {
        try {
          const { conversations } = await chatService.getConversations({
            interface_id: WORD_INTERFACE_ID,
            limit: 50,
          });

          const localConversations: Conversation[] = conversations.map(dbConv => ({
            id: dbConv.id,
            title: dbConv.title,
            timestamp: new Date(dbConv.created_at || Date.now()).getTime(),
            messages: (dbConv.messages || []).map(msg => ({
              id: msg.id || `msg-${Date.now()}-${Math.random()}`,
              sender: msg.role === 'user' ? 'user' as const : 'ai' as const,
              text: msg.content,
              timestamp: new Date(msg.created_at || Date.now()).getTime(),
            })),
          }));

          setConversationHistory(localConversations);
        } catch (refreshError) {
          console.error('❌ [Word] Failed to refresh conversation history:', refreshError);
        }
      }
    } catch (error: any) {
      console.error('Error sending message:', error);
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        sender: 'ai',
        text: `Error: ${error.message}`,
        timestamp: Date.now(),
        isError: true,
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // File upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          setUploadedImages(prev => [...prev, {
            base64: reader.result as string,
            type: file.type,
            name: file.name
          }]);
        };
        reader.readAsDataURL(file);
      }
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeUploadedImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  // Compact conversation using AI summarization when switching to smaller context models
  const compactConversation = async (newModel: Model) => {
    if (messages.length === 0 || usedTokens <= newModel.maxTokens) {
      return; // No need to compact
    }

    console.log(`🗜️ Compacting conversation: ${usedTokens} tokens -> ${newModel.maxTokens} max`);
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
        messages: [
          {
            role: 'system',
            content: `You are a conversation summarizer. Create a concise summary of the following conversation about document creation/editing.
Focus on:
1. What document the user wanted to create or edit
2. Key requirements and changes requested
3. Important decisions made

Keep the summary under 500 words. Do NOT include any HTML/markdown content in the summary - that will be preserved separately.`
          },
          {
            role: 'user',
            content: `Summarize this conversation:\n\n${conversationText}`
          }
        ],
        path: 'premium',
        maxTokens: 1000,
      });

      const summary = result.content || 'Previous conversation about document creation.';

      // Create compacted messages: summary + note about preserved document
      const compactedMessages: ChatMessage[] = [
        {
          id: `summary-${Date.now()}`,
          sender: 'ai',
          text: `**📋 Conversation Summary (compacted for ${newModel.name}):**\n\n${summary}${currentHtml ? `\n\n---\n\n**Current Document:**\nThe latest document has been preserved and is shown in the editor panel.` : ''}`,
          timestamp: Date.now(),
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
        text: `⚠️ **Note:** Switched to ${newModel.name} which has a smaller context window. Some conversation history may not fit. The current document has been preserved.`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, warningMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleModelSelect = async (model: Model) => {
    const previousModel = selectedModel;
    setSelectedModel(model);
    setIsCompanyDropdownOpen(false);

    // Check if we need to compact the conversation
    if (model.maxTokens < previousModel.maxTokens && usedTokens > model.maxTokens) {
      await compactConversation(model);
    }
  };

  const copyToClipboard = (text: string, type: 'message' | 'ai' | 'document', id?: string) => {
    navigator.clipboard.writeText(text);
    if (type === 'message' && id) {
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId(null), 1500);
    } else if (type === 'ai' && id) {
      setCopiedAiMessageId(id);
      setTimeout(() => setCopiedAiMessageId(null), 1500);
    } else if (type === 'document') {
      setCopiedDocument(true);
      setTimeout(() => setCopiedDocument(false), 1500);
    }
  };

  const downloadDocument = (format: 'html' | 'md' | 'txt') => {
    let content = '';
    let filename = 'document';
    let mimeType = 'text/plain';

    if (format === 'html') {
      content = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Document</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; }
    h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    blockquote { border-left: 4px solid #3b82f6; padding-left: 1em; color: #666; }
  </style>
</head>
<body>
${currentHtml}
</body>
</html>`;
      filename = 'document.html';
      mimeType = 'text/html';
    } else if (format === 'md') {
      content = currentMarkdown || editorRef.current?.getMarkdown() || '';
      filename = 'document.md';
      mimeType = 'text/markdown';
    } else {
      content = currentMarkdown || editorRef.current?.getMarkdown() || '';
      filename = 'document.txt';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export to DOCX using backend API (html-to-docx runs on server)
  const downloadDocx = async () => {
    try {
      // Call backend API to convert HTML to DOCX
      const response = await fetch('/api/conversion/html-to-docx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          html: currentHtml,
          filename: 'document.docx'
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to convert to DOCX');
      }

      // Download the file with correct MIME type
      const arrayBuffer = await response.arrayBuffer();
      const blob = new Blob([arrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      saveAs(blob, 'document.docx');
    } catch (error) {
      console.error('Error creating DOCX:', error);
      alert('Failed to create DOCX file. Error: ' + (error as Error).message);
    }
  };

  const printDocument = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Print Document</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; }
            @media print { body { margin: 0; padding: 20px; } }
          </style>
        </head>
        <body>${currentHtml}</body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setActiveConversationId(null);
    setCurrentHtml('');
    setCurrentMarkdown('');
    editorRef.current?.setContent('');
  };

  const loadConversation = async (conv: Conversation) => {
    setIsHistoryOpen(false);

    // Load full conversation from database if available
    if (isDbInitialized) {
      try {
        const dbConversation = await chatService.getConversation(conv.id);
        if (dbConversation && dbConversation.messages) {
          const loadedMessages: ChatMessage[] = dbConversation.messages.map(msg => ({
            id: msg.id || `msg-${Date.now()}-${Math.random()}`,
            sender: msg.role === 'user' ? 'user' as const : 'ai' as const,
            text: msg.content,
            timestamp: new Date(msg.created_at || Date.now()).getTime(),
          }));
          setMessages(loadedMessages);
          setActiveConversationId(conv.id);

          // Find last document content in messages
          const lastDoc = [...loadedMessages].reverse().find(m => {
            const docContent = extractDocumentContent(m.text);
            return docContent !== null;
          });
          if (lastDoc) {
            const docContent = extractDocumentContent(lastDoc.text);
            if (docContent) {
              setCurrentHtml(docContent);
              editorRef.current?.setContent(docContent);
            }
          }
          console.log(`✅ [Word] Loaded conversation from database: ${conv.id}`);
          return;
        }
      } catch (error) {
        console.error('❌ [Word] Failed to load conversation from database:', error);
      }
    }

    // Fallback to local data
    setMessages(conv.messages);
    setActiveConversationId(conv.id);
    const lastDoc = [...conv.messages].reverse().find(m => m.documentContent)?.documentContent;
    if (lastDoc) {
      setCurrentHtml(lastDoc);
      editorRef.current?.setContent(lastDoc);
    }
  };

  const deleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Delete from database if available
    if (isDbInitialized) {
      try {
        await chatService.deleteConversation(convId);
        console.log(`✅ [Word] Deleted conversation from database: ${convId}`);
      } catch (error) {
        console.error('❌ [Word] Failed to delete conversation from database:', error);
      }
    }

    setConversationHistory(prev => prev.filter(c => c.id !== convId));
    if (activeConversationId === convId) startNewChat();
  };

  return (
    <>
      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .input-box-top-fade { box-shadow: 0 -10px 20px 10px #121212; }
      `}</style>

      <div className="flex h-full bg-[#121212]">
        {/* Chat Panel - 50% width like PDF interface */}
        <div className={`relative flex flex-col h-full text-white overflow-hidden ${isDocumentFullscreen ? 'hidden' : 'w-1/2'}`}>
          {/* Top Bar - matches PDF interface style */}
          <div className="flex flex-shrink-0 items-center justify-between px-4 py-4 bg-[#121212] border-b border-[#2a2a2d]">
            {/* Left side - New Chat & History */}
            <div className="flex items-center gap-2">
              <button
                onClick={startNewChat}
                className="flex items-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-gray-500 transition-colors h-9"
                title="New document"
              >
                <SquarePen size={16} />
              </button>
              <button
                onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                className={`flex items-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-gray-500 transition-colors h-9 ${isHistoryOpen ? 'border-gray-500' : ''}`}
              >
                <Lightbulb size={16} />
                <span>History</span>
              </button>
              {activeConversationId && messages.length > 0 && (
                <button
                  onClick={() => {
                    setIsShareModalOpen(true);
                    setShareLink(null);
                  }}
                  className="flex items-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-gray-500 transition-colors h-9"
                  title="Share conversation"
                >
                  <Share2 size={16} />
                  <span>Share</span>
                </button>
              )}
            </div>

            {/* Right side - Model Selector */}
            <div className="relative flex-shrink-0" ref={companyDropdownRef}>
              <button
                onClick={() => setIsCompanyDropdownOpen(!isCompanyDropdownOpen)}
                onMouseEnter={() => setIsModelSelectorButtonHovered(true)}
                onMouseLeave={() => setIsModelSelectorButtonHovered(false)}
                className="flex items-center justify-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-gray-500 transition-colors h-9 w-[10rem]"
              >
                {isModelsLoading ? (
                  <Loader2 size={16} className="text-gray-500 flex-shrink-0 animate-spin" />
                ) : (
                  <Brain size={16} className="text-gray-500 flex-shrink-0" />
                )}
                <span className="truncate">{selectedModel.name}</span>
              </button>
              {(isModelSelectorButtonHovered && !isCompanyDropdownOpen) && (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 pointer-events-none">
                  <ChevronDown size={16} className="text-gray-500" />
                </div>
              )}
              <div
                className={`
                  absolute top-full right-0 mt-[10px] z-20
                  transition-all duration-200 ease-out origin-top-right
                  ${isCompanyDropdownOpen
                    ? 'opacity-100 scale-100 visible'
                    : 'opacity-0 scale-95 invisible'
                  }
                  w-72 bg-[#19191a] border border-[#2a2a2d] rounded-lg shadow-xl
                  max-h-[70vh] overflow-hidden flex flex-col
                `}
              >
                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto">
                  <div>
                    {groupedModels.map((group) => {
                      const isExpanded = expandedCompanies.has(group.companyName);
                      const isActiveCompany = getCompanyNameFromModelId(selectedModel.id) === group.companyName;
                      return (
                        <div key={group.companyName}>
                          <button
                            onClick={() => {
                              setExpandedCompanies(prev => {
                                if (prev.has(group.companyName)) {
                                  return new Set();
                                } else {
                                  return new Set([group.companyName]);
                                }
                              });
                            }}
                            className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${
                              isExpanded ? 'bg-white/5' : 'hover:bg-white/5'
                            }`}
                          >
                            <span className={`text-sm ${isActiveCompany ? 'text-white' : 'text-gray-400'}`}>
                              {group.companyName}
                            </span>
                            <ChevronDown size={14} className={`text-gray-600 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>

                          {/* Expanded Models List */}
                          <div className={`overflow-hidden transition-all duration-200 ${
                            isExpanded ? 'max-h-[400px]' : 'max-h-0'
                          }`}>
                            <div className="pb-1">
                              {group.models.map((model) => (
                                <button
                                  key={model.id}
                                  onClick={() => handleModelSelect(model)}
                                  className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${
                                    selectedModel.id === model.id
                                      ? 'bg-white/10'
                                      : 'hover:bg-white/5'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <span className={`text-sm truncate ${
                                      selectedModel.id === model.id ? 'text-white' : 'text-gray-400'
                                    }`}>
                                      {model.name}
                                    </span>
                                    <span className="text-[10px] text-gray-600 flex-shrink-0">
                                      {formatTokens(model.maxTokens)}
                                    </span>
                                  </div>
                                  {selectedModel.id === model.id && (
                                    <Check size={14} className="text-gray-400 flex-shrink-0" />
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* History Panel - matches PDF interface */}
          {isHistoryOpen && (
            <div className="absolute top-16 left-4 right-4 z-20 bg-[#1f1f20] border border-[#3a3a3d] rounded-lg shadow-xl max-h-64 overflow-y-auto">
              <div className="p-3">
                <div className="text-xs text-white/40 uppercase tracking-wide mb-2">Recent Conversations</div>
                {conversationHistory.length === 0 ? (
                  <p className="text-sm text-white/40 py-4 text-center">No history yet</p>
                ) : (
                  <div className="space-y-1">
                    {conversationHistory.slice(0, 10).map(conv => (
                      <div
                        key={conv.id}
                        className={`group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${activeConversationId === conv.id ? 'bg-zinc-700/50' : 'hover:bg-zinc-700/30'}`}
                        onClick={() => loadConversation(conv)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">{conv.title}</p>
                          <p className="text-xs text-white/40">{new Date(conv.timestamp).toLocaleDateString()}</p>
                        </div>
                        <button
                          onClick={(e) => deleteConversation(conv.id, e)}
                          className="p-1 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Chat Messages */}
          <div ref={chatAreaRef} className="hide-scrollbar flex-1 overflow-y-auto px-2 pb-40">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <h3 className="text-xl font-semibold text-white mb-2">Word Document Editor</h3>
                <p className="text-sm text-white/50 max-w-md mb-6">
                  Describe the document you want to create. I'll generate professional content with formatting you can edit and style.
                </p>
                <div className="w-full max-w-md space-y-2">
                  <p className="text-xs text-white/30 uppercase tracking-wide text-center">Try asking:</p>
                  {[
                    "Write a professional cover letter for a software engineer",
                    "Create a project proposal for a mobile app",
                    "Make the title blue and use Georgia font",
                    "Draft meeting notes with action items",
                  ].map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => setInputValue(suggestion)}
                      className="w-full text-center text-sm text-white/60 hover:text-white bg-[#19191a] hover:bg-[#232326] px-4 py-3 rounded-lg border border-[#3a3a3d] hover:border-gray-500 transition-all"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="max-w-[45rem] w-full space-y-2 mx-auto">
                {messages.map((message) => {
                  const isUser = message.sender === 'user';
                  return (
                    <div key={message.id} className={`flex w-full ${isUser ? 'justify-end pr-4' : 'justify-start'}`}>
                      {isUser ? (
                        <div className="group flex flex-col items-end max-w-[75%]">
                          <div className="bg-[#19191a] border border-[#3a3a3d] rounded-2xl rounded-br-none p-3 text-white">
                            {message.images && message.images.length > 0 && (
                              <div className="flex gap-1 mb-2">
                                {message.images.map((img, i) => (
                                  <img key={i} src={img.base64} alt="" className="w-10 h-10 object-cover rounded border border-[#3a3a3d]" />
                                ))}
                              </div>
                            )}
                            <p className="text-sm leading-snug whitespace-pre-wrap">{message.text}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="group flex flex-col items-start w-full space-y-2 pr-4">
                          <div className={`w-full rounded-2xl p-3 ${message.isError ? 'bg-red-500/10 border border-red-500/30' : 'bg-transparent'}`}>
                            <div className="prose prose-sm prose-invert max-w-none text-gray-200">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                              >
                                {stripBlocksFromChat(message.text)}
                              </ReactMarkdown>
                            </div>
                            {(message.documentContent || message.styleCommands) && (
                              <div className="mt-3 flex items-center gap-2 text-xs text-blue-400">
                                {message.documentContent && <><FileText size={14} /><span>Document updated - see editor</span></>}
                                {message.styleCommands && <><PenTool size={14} /><span>Styles applied</span></>}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {isLoading && (
                  <div className="flex justify-start w-full">
                    <div className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm">
                      <Loader2 size={14} className="animate-spin text-blue-400" />
                      <span className="text-gray-400">Writing document...</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="max-w-[45rem] mx-auto">
              <div className="relative bg-[#19191a] border border-[#3a3a3d] rounded-2xl p-4 shadow-lg input-box-top-fade">
                {uploadedImages.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {uploadedImages.map((img, i) => (
                      <div key={i} className="relative group">
                        <img src={img.base64} alt="" className="w-16 h-16 object-cover rounded-lg border border-[#3a3a3d]" />
                        <button
                          onClick={() => removeUploadedImage(i)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={12} className="text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-end relative">
                  <textarea
                    ref={textareaRef}
                    placeholder="Describe the document you want to create or edit..."
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-transparent text-white placeholder-gray-400 pl-2 pr-10 py-2 outline-none resize-none flex-grow focus:ring-0 border-none text-base"
                    style={{ maxHeight: '150px' }}
                    rows={1}
                  />
                </div>
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2">
                    {selectedModel.supportsVision && (
                      <>
                        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileUpload} className="hidden" />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="flex items-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/60 hover:text-white/80 hover:border-gray-500 transition-colors"
                          title="Upload image"
                        >
                          <Paperclip size={16} />
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {usedTokens > selectedModel.maxTokens * 0.9 ? (
                      <button
                        onClick={() => compactConversation(selectedModel)}
                        disabled={isLoading}
                        className="group text-xs text-orange-400 hover:text-orange-300 transition-all cursor-pointer disabled:opacity-50"
                        title="Click to compress conversation"
                      >
                        <span className="group-hover:hidden">
                          {usedTokens.toLocaleString()} / {selectedModel.maxTokens.toLocaleString()} tokens
                        </span>
                        <span className="hidden group-hover:inline font-medium">
                          Compress
                        </span>
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">
                        {usedTokens.toLocaleString()} / {selectedModel.maxTokens.toLocaleString()} tokens
                      </span>
                    )}
                    <button
                      onClick={sendMessage}
                      className="bg-gray-400 text-zinc-900 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-10 flex items-center justify-center shadow-md"
                      disabled={!inputValue.trim() || isLoading}
                    >
                      <span>Send</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Document Panel - 50% width like PDF interface */}
        <div className={`flex flex-col bg-[#121212] border-l border-[#2a2a2d] ${isDocumentFullscreen ? 'w-full' : 'w-1/2'}`}>
          {/* Document Top Bar - matches PDF preview panel style */}
          <div className="flex flex-shrink-0 items-center justify-between px-4 py-4 bg-[#121212] border-b border-[#2a2a2d]">
            {/* Left side - View Toggle */}
            <div className="flex items-center gap-3">
              <div className="flex items-center bg-[#19191a] border border-[#3a3a3d] rounded-lg p-1 h-9">
                {[
                  { mode: 'edit' as ViewMode, icon: Edit3, label: 'Edit' },
                  { mode: 'preview' as ViewMode, icon: Eye, label: 'Preview' },
                  { mode: 'markdown' as ViewMode, icon: FileCode, label: 'MD' },
                  { mode: 'html' as ViewMode, icon: Code, label: 'HTML' },
                ].map(({ mode, icon: Icon, label }) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm transition-colors ${
                      viewMode === mode ? 'bg-[#2a2a2d] text-white' : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    <Icon size={14} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Page Mode Toggle - Show for Edit and Preview modes */}
              {(viewMode === 'edit' || viewMode === 'preview') && (
                <div className="flex items-center bg-[#19191a] border border-[#3a3a3d] rounded-lg p-1 h-9">
                  <button
                    onClick={() => setPreviewPageMode('infinite')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm transition-colors ${
                      previewPageMode === 'infinite' ? 'bg-[#2a2a2d] text-white' : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    <span>Scroll</span>
                  </button>
                  <button
                    onClick={() => setPreviewPageMode('a4')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm transition-colors ${
                      previewPageMode === 'a4' ? 'bg-[#2a2a2d] text-white' : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    <span>A4</span>
                  </button>
                </div>
              )}
            </div>

            {/* Right side - Actions */}
            <div className="flex items-center gap-2">
              {/* Find & Replace */}
              <button
                onClick={() => setIsFindReplaceOpen(!isFindReplaceOpen)}
                className={`flex items-center justify-center bg-[#19191a] border border-[#3a3a3d] rounded-lg px-2.5 h-9 text-white/80 hover:border-gray-500 ${isFindReplaceOpen ? 'border-blue-500/50 text-blue-400' : ''}`}
                title="Find & Replace (Ctrl+F)"
              >
                <Search size={16} />
              </button>

              {/* Undo/Redo with history */}
              <div className="flex items-center bg-[#19191a] border border-[#3a3a3d] rounded-lg h-9">
                <button
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  className="flex items-center justify-center px-2 h-full text-white/80 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed rounded-l-lg"
                  title={`Undo (${undoStack.length} available)`}
                >
                  <Undo2 size={16} />
                </button>
                <div className="w-px h-5 bg-[#3a3a3d]" />
                <button
                  onClick={handleRedo}
                  disabled={redoStack.length === 0}
                  className="flex items-center justify-center px-2 h-full text-white/80 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed rounded-r-lg"
                  title={`Redo (${redoStack.length} available)`}
                >
                  <Redo2 size={16} />
                </button>
              </div>

              {/* Spell Check Toggle */}
              <button
                onClick={() => setIsSpellCheckEnabled(!isSpellCheckEnabled)}
                className={`flex items-center justify-center bg-[#19191a] border border-[#3a3a3d] rounded-lg px-2.5 h-9 hover:border-gray-500 ${isSpellCheckEnabled ? 'text-green-400' : 'text-white/40'}`}
                title={`Spell Check: ${isSpellCheckEnabled ? 'ON' : 'OFF'}`}
              >
                <SpellCheck size={16} />
              </button>

              {currentHtml && (
                <>
                  <button
                    onClick={() => copyToClipboard(viewMode === 'html' ? currentHtml : currentMarkdown, 'document')}
                    className="flex items-center justify-center bg-[#19191a] border border-[#3a3a3d] rounded-lg px-2.5 h-9 text-white/80 hover:border-gray-500"
                    title="Copy"
                  >
                    {copiedDocument ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                  </button>
                  <button onClick={printDocument} className="flex items-center justify-center bg-[#19191a] border border-[#3a3a3d] rounded-lg px-2.5 h-9 text-white/80 hover:border-gray-500" title="Print">
                    <Printer size={16} />
                  </button>
                  <div className="relative" ref={downloadDropdownRef}>
                    <button
                      onClick={() => setIsDownloadDropdownOpen(!isDownloadDropdownOpen)}
                      className={`flex items-center justify-center bg-[#19191a] border border-[#3a3a3d] rounded-lg px-2.5 h-9 text-white/80 hover:border-gray-500 ${isDownloadDropdownOpen ? 'border-gray-500' : ''}`}
                      title="Download"
                    >
                      <Download size={16} />
                    </button>
                    {isDownloadDropdownOpen && (
                      <div className="absolute top-full right-0 mt-1 bg-[#1f1f20] border border-[#3a3a3d] rounded-lg shadow-xl z-10">
                        <button onClick={() => { downloadDocx(); setIsDownloadDropdownOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-white/80 hover:bg-white/10 rounded-t-lg">
                          <FileType size={14} /><span>DOCX</span>
                        </button>
                        <button onClick={() => { downloadDocument('html'); setIsDownloadDropdownOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-white/80 hover:bg-white/10">
                          <FileDown size={14} /><span>HTML</span>
                        </button>
                        <button onClick={() => { downloadDocument('md'); setIsDownloadDropdownOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-white/80 hover:bg-white/10">
                          <FileDown size={14} /><span>Markdown</span>
                        </button>
                        <button onClick={() => { downloadDocument('txt'); setIsDownloadDropdownOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-white/80 hover:bg-white/10 rounded-b-lg">
                          <FileText size={14} /><span>Text</span>
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              <button
                onClick={() => setIsDocumentFullscreen(!isDocumentFullscreen)}
                className="flex items-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-gray-500 transition-colors h-9"
                title={isDocumentFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {isDocumentFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>
          </div>

          {/* Find & Replace Panel */}
          {isFindReplaceOpen && (
            <div className="flex items-center gap-2 px-4 py-2 bg-[#19191a] border-b border-[#2a2a2d]">
              <div className="flex items-center gap-1 flex-1">
                <Search size={14} className="text-white/40" />
                <input
                  type="text"
                  value={findText}
                  onChange={(e) => { setFindText(e.target.value); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleFind()}
                  placeholder="Find..."
                  className="flex-1 bg-[#121212] border border-[#3a3a3d] rounded px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center gap-1 flex-1">
                <Replace size={14} className="text-white/40" />
                <input
                  type="text"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder="Replace with..."
                  className="flex-1 bg-[#121212] border border-[#3a3a3d] rounded px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
                />
              </div>
              <button onClick={handleFind} className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded text-white">Find</button>
              <button onClick={handleReplace} className="px-2 py-1 text-xs bg-[#2a2a2d] hover:bg-[#3a3a3d] rounded text-white">Replace</button>
              <button onClick={handleReplaceAll} className="px-2 py-1 text-xs bg-[#2a2a2d] hover:bg-[#3a3a3d] rounded text-white">All</button>
              {findResults.count > 0 && (
                <span className="text-xs text-white/60">{findResults.count} found</span>
              )}
              <button onClick={() => setIsFindReplaceOpen(false)} className="p-1 hover:bg-white/10 rounded">
                <X size={14} className="text-white/60" />
              </button>
            </div>
          )}

          {/* Status Bar with Word Count & Auto-save */}
          <div className="flex items-center justify-between px-4 py-1 bg-[#0e0e10] border-b border-[#2a2a2d] text-xs text-white/40">
            <div className="flex items-center gap-4">
              <span>{documentStats.wordCount} words</span>
              <span>{documentStats.charCount} characters</span>
              <span>{documentStats.paragraphCount} paragraphs</span>
            </div>
            <div className="flex items-center gap-2">
              {hasUnsavedChanges && (
                <span className="flex items-center gap-1 text-yellow-400">
                  <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
                  Unsaved
                </span>
              )}
              {lastSaved && !hasUnsavedChanges && (
                <span className="flex items-center gap-1 text-green-400">
                  <Save size={12} />
                  Saved {lastSaved.toLocaleTimeString()}
                </span>
              )}
              {isSpellCheckEnabled && <span className="text-green-400">Spell check ON</span>}
            </div>
          </div>

          {/* Editor Formatting Toolbar - Only in Edit mode */}
          {viewMode === 'edit' && editorInstance && (
            <EditorToolbar editor={editorInstance} />
          )}

          {/* Document Content */}
          <div className="flex-1 overflow-auto">
            {/* Edit Mode - TipTap Editor */}
            {viewMode === 'edit' && (
              <div className="h-full bg-[#3a3a3d] overflow-auto">
                {previewPageMode === 'infinite' ? (
                  <div className="scroll-edit-container">
                    <style>{`
                      .scroll-edit-container {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        padding: 24px;
                        padding-bottom: 48px;
                        min-height: 100%;
                        background: #3a3a3d;
                      }
                      .scroll-edit-document {
                        width: 794px;
                        max-width: 100%;
                        background: white;
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                        min-height: 1123px;
                        padding: 60px;
                      }
                      .scroll-edit-document .ProseMirror {
                        min-height: 1003px;
                        outline: none;
                        font-family: 'Segoe UI', Arial, sans-serif;
                        color: #1f2937;
                        line-height: 1.6;
                      }
                      .scroll-edit-document .ProseMirror h1 { font-size: 2em; text-align: center; margin-top: 0; }
                      .scroll-edit-document .ProseMirror h2 { font-size: 1.5em; border-bottom: 2px solid #333; padding-bottom: 0.3em; }
                      .scroll-edit-document .ProseMirror h3 { font-size: 1.25em; }
                      .scroll-edit-document .ProseMirror p { margin-bottom: 0.75em; }
                    `}</style>
                    <div className="scroll-edit-document">
                      <TipTapEditor
                        ref={editorRef}
                        content={currentHtml}
                        onChange={handleEditorChange}
                        placeholder="Start writing or ask AI to create a document..."
                        hideToolbar={true}
                      />
                    </div>
                  </div>
                ) : (
                  <A4EditView
                    editorRef={paginatedEditorRef}
                    content={currentHtml}
                    onChange={handleEditorChange}
                  />
                )}
              </div>
            )}

            {/* Preview Mode - Rendered HTML */}
            {viewMode === 'preview' && (
              <div className="h-full overflow-auto bg-[#3a3a3d] p-6">
                <style>{`
                  .preview-content * { box-sizing: border-box; }
                  .preview-content { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; padding: 48px; line-height: 1.6; }
                  .preview-content h1, .preview-content h2, .preview-content h3, .preview-content h4 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: bold; color: #333; }
                  .preview-content h1 { font-size: 2em; text-align: center; }
                  .preview-content h2 { font-size: 1.5em; border-bottom: 2px solid #333; padding-bottom: 0.3em; }
                  .preview-content h3 { font-size: 1.25em; }
                  .preview-content p { margin-bottom: 0.75em; text-align: justify; }
                  .preview-content ul, .preview-content ol { margin-left: 1.5em; margin-bottom: 0.75em; }
                  .preview-content li { margin-bottom: 0.25em; }
                  .preview-content table { width: 100%; border-collapse: collapse; margin: 1em 0; }
                  .preview-content th, .preview-content td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                  .preview-content th { background-color: #f5f5f5; font-weight: bold; }
                  .preview-content blockquote { border-left: 4px solid #333; padding-left: 1em; margin: 1em 0; font-style: italic; color: #555; }
                  .preview-content .container { max-width: 100% !important; margin: 0 !important; padding: 0 !important; background: transparent !important; box-shadow: none !important; border-radius: 0 !important; }
                  .preview-content .motto, .preview-content .quote { border-left: 4px solid #333; padding: 0.75em; margin: 1em 0; font-style: italic; background-color: #f9f9f9; }
                  .preview-content .image-placeholder { border: 2px dashed #ccc; padding: 1.5em; text-align: center; margin: 1em 0; background-color: #fafafa; color: #888; }
                  .preview-content strong, .preview-content b { font-weight: bold; }
                  .preview-content em, .preview-content i { font-style: italic; }

                  /* A4 Page Mode Styles */
                  .a4-page {
                    width: 794px; /* 210mm at 96dpi */
                    height: 1123px; /* 297mm at 96dpi */
                    background: white;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                    position: relative;
                    overflow: hidden;
                    flex-shrink: 0;
                  }
                  .a4-page-inner {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 794px;
                    padding: 60px;
                  }
                  .a4-page-number {
                    position: absolute;
                    bottom: 30px;
                    left: 0;
                    right: 0;
                    text-align: center;
                    font-size: 11px;
                    color: #666;
                  }
                  .a4-pages-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 32px;
                    padding-bottom: 32px;
                  }
                `}</style>

                {previewPageMode === 'infinite' ? (
                  /* Infinite Scroll Mode */
                  <div
                    className="mx-auto bg-white rounded shadow-2xl"
                    style={{ maxWidth: '816px', minHeight: '1056px' }}
                  >
                    <div
                      className="preview-content"
                      dangerouslySetInnerHTML={{
                        __html: currentHtml
                          ? currentHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                          : '<p style="color: #9ca3af; text-align: center; padding-top: 40px;">No content yet. Start writing in Edit mode or ask AI to create a document.</p>'
                      }}
                    />
                  </div>
                ) : (
                  /* A4 Pages Mode - Auto-paginated like Word */
                  <A4PageView
                    html={currentHtml ? currentHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') : ''}
                  />
                )}
              </div>
            )}

            {/* Markdown Mode - Editable */}
            {viewMode === 'markdown' && (
              <div className="h-full p-6">
                <div className="h-full bg-[#0e0e10] border border-[#2a2a2d] rounded-lg overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between px-4 py-2 bg-[#19191a] border-b border-[#2a2a2d]">
                    <span className="text-sm text-white/60">Markdown Source (Editable)</span>
                    <button
                      onClick={() => copyToClipboard(currentMarkdown, 'document')}
                      className="p-1 hover:bg-white/10 rounded"
                    >
                      {copiedDocument ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="text-white/50" />}
                    </button>
                  </div>
                  <textarea
                    value={currentMarkdown}
                    onChange={(e) => {
                      const newMarkdown = e.target.value;
                      setCurrentMarkdown(newMarkdown);
                      // Convert markdown to HTML and update editor
                      const newHtml = markdownToHtml(newMarkdown);
                      setCurrentHtml(newHtml);
                      editorRef.current?.setContent(newHtml);
                    }}
                    placeholder="# Start typing markdown here..."
                    className="flex-1 w-full bg-transparent text-white/80 font-mono text-sm p-4 resize-none outline-none"
                    style={{ minHeight: '200px' }}
                  />
                </div>
              </div>
            )}

            {/* HTML Mode - Editable */}
            {viewMode === 'html' && (
              <div className="h-full p-6">
                <div className="h-full bg-[#0e0e10] border border-[#2a2a2d] rounded-lg overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between px-4 py-2 bg-[#19191a] border-b border-[#2a2a2d]">
                    <span className="text-sm text-white/60">HTML Source (Editable)</span>
                    <button
                      onClick={() => copyToClipboard(currentHtml, 'document')}
                      className="p-1 hover:bg-white/10 rounded"
                    >
                      {copiedDocument ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="text-white/50" />}
                    </button>
                  </div>
                  <textarea
                    value={currentHtml}
                    onChange={(e) => {
                      const newHtml = e.target.value;
                      setCurrentHtml(newHtml);
                      // Convert HTML to markdown and update editor
                      const newMarkdown = htmlToMarkdown(newHtml);
                      setCurrentMarkdown(newMarkdown);
                      editorRef.current?.setContent(newHtml);
                    }}
                    placeholder="<!-- Start typing HTML here... -->"
                    className="flex-1 w-full bg-transparent text-white/80 font-mono text-sm p-4 resize-none outline-none"
                    style={{ minHeight: '200px' }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image Preview Modal */}
      {previewImage && (
        <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-8" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img src={previewImage} alt="Preview" className="max-w-full max-h-[90vh] object-contain rounded-lg" />
            <button onClick={() => setPreviewImage(null)} className="absolute -top-3 -right-3 w-8 h-8 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center">
              <X size={18} className="text-white" />
            </button>
          </div>
        </div>
      )}

      {/* Share Conversation Modal */}
      {isShareModalOpen && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsShareModalOpen(false)}>
          <div
            className="bg-[#1a1a1c] border border-[#3a3a3d] rounded-2xl p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center">
                  <Share2 size={20} className="text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-white">Share Conversation</h3>
              </div>
              <button
                onClick={() => setIsShareModalOpen(false)}
                className="p-1 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X size={18} className="text-white/60" />
              </button>
            </div>

            <p className="text-sm text-white/60 mb-6">
              Create a link to share this conversation with others. They'll be able to view and continue the conversation in their own account.
            </p>

            {!shareLink ? (
              <button
                onClick={handleCreateShareLink}
                disabled={isCreatingShareLink}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {isCreatingShareLink ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Creating link...</span>
                  </>
                ) : (
                  <>
                    <Link size={18} />
                    <span>Create Share Link</span>
                  </>
                )}
              </button>
            ) : (
              <div className="space-y-4">
                <div className="bg-[#0e0e10] border border-[#3a3a3d] rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={shareLink}
                      readOnly
                      className="flex-1 bg-transparent text-sm text-white/80 outline-none truncate"
                    />
                    <button
                      onClick={handleCopyShareLink}
                      className="flex items-center gap-1 px-3 py-1.5 bg-[#2a2a2d] hover:bg-[#3a3a3d] rounded text-sm text-white/80 transition-colors"
                    >
                      {copiedShareLink ? (
                        <>
                          <Check size={14} className="text-green-400" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy size={14} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <ExternalLink size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-yellow-400/80">
                    This link expires in 7 days. Anyone with the link can view and accept this conversation.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Accept Shared Conversation Modal */}
      {sharedConversationData && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#1a1a1c] border border-[#3a3a3d] rounded-2xl p-6 max-w-lg w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center">
                <Users size={24} className="text-emerald-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Shared Conversation</h3>
                <p className="text-sm text-white/50">From {sharedConversationData.owner_name}</p>
              </div>
            </div>

            <div className="bg-[#0e0e10] border border-[#3a3a3d] rounded-lg p-4 mb-4">
              <h4 className="text-sm font-medium text-white mb-2">{sharedConversationData.title}</h4>
              <p className="text-xs text-white/50">
                {sharedConversationData.messages.length} messages in this conversation
              </p>

              {/* Preview of last few messages */}
              <div className="mt-3 space-y-2 max-h-32 overflow-y-auto">
                {sharedConversationData.messages.slice(-3).map((msg, i) => (
                  <div
                    key={i}
                    className={`text-xs p-2 rounded ${
                      msg.sender === 'user'
                        ? 'bg-[#2a2a2d] text-white/70'
                        : 'bg-[#1a1a1c] text-white/60'
                    }`}
                  >
                    <span className="font-medium">{msg.sender === 'user' ? 'User: ' : 'AI: '}</span>
                    <span className="line-clamp-2">{msg.text.replace(/```[\s\S]*?```/g, '[code block]').slice(0, 100)}...</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-sm text-white/60 mb-6">
              Would you like to accept this conversation? It will be copied to your account and you can continue where it left off.
            </p>

            <div className="flex gap-3">
              <button
                onClick={handleDeclineSharedConversation}
                className="flex-1 px-4 py-3 bg-[#2a2a2d] hover:bg-[#3a3a3d] text-white/80 rounded-lg font-medium transition-colors"
              >
                Decline
              </button>
              <button
                onClick={handleAcceptSharedConversation}
                disabled={isAcceptingShare}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {isAcceptingShare ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Accepting...</span>
                  </>
                ) : (
                  <>
                    <Check size={18} />
                    <span>Accept & Continue</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default WordChatInterface;

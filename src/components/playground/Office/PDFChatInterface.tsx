import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send, FileText, Download, RefreshCw, Copy, Check, ChevronDown, ChevronUp,
  Loader2, X, Maximize2, Minimize2, Sparkles, Lightbulb, Brain, SquarePen,
  FilePenLine, Save, ThumbsUp, ThumbsDown, FileType, Settings, Eye, EyeOff,
  ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCw, Hand, Move, Paperclip, Image,
  Undo2, Redo2, History
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import * as pdfjsLib from 'pdfjs-dist';
import { countMessageTokens, estimateTokens as quickEstimateTokens } from '@/services/tokenizerService';
import { chatComplete } from '../../../services/aiService';

// Set up PDF.js worker - use a stable CDN version
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

// Model configurations - Latest 3 from each provider
const mockModels = [
  // Google - Latest 3 (best for PDF generation - huge context & output)
  { id: "google/gemini-3-pro-preview", name: "Gemini 3 Pro", maxTokens: 1048576, maxOutputTokens: 65536, supportsVision: true },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", maxTokens: 1048576, maxOutputTokens: 65536, supportsVision: true },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", maxTokens: 400000, maxOutputTokens: 65536, supportsVision: true },
  // OpenAI - Latest 3
  { id: "openai/gpt-5.1", name: "GPT-5.1", maxTokens: 128000, maxOutputTokens: 16384, supportsVision: true },
  { id: "openai/gpt-5", name: "GPT-5", maxTokens: 128000, maxOutputTokens: 16384, supportsVision: true },
  { id: "openai/o4-mini-high", name: "o4 Mini High", maxTokens: 128000, maxOutputTokens: 16384, supportsVision: true },
  // Anthropic - Latest 3
  { id: "anthropic/claude-opus-4.5", name: "Claude Opus 4.5", maxTokens: 200000, maxOutputTokens: 16384, supportsVision: true },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", maxTokens: 200000, maxOutputTokens: 16384, supportsVision: true },
  { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", maxTokens: 200000, maxOutputTokens: 16384, supportsVision: true },
  // DeepSeek - Latest 3 (text only)
  { id: "deepseek/deepseek-v3.2-exp", name: "DeepSeek V3.2", maxTokens: 163840, maxOutputTokens: 8192, supportsVision: false },
  { id: "deepseek/deepseek-chat-v3.1", name: "DeepSeek V3.1", maxTokens: 163840, maxOutputTokens: 8192, supportsVision: false },
  { id: "deepseek/deepseek-r1-0528", name: "DeepSeek R1", maxTokens: 128000, maxOutputTokens: 16384, supportsVision: false },
];

const getCompanyNameFromModelId = (modelId: string): string => {
  if (modelId.startsWith('openai/')) return 'OpenAI';
  if (modelId.startsWith('anthropic/')) return 'Anthropic';
  if (modelId.startsWith('google/')) return 'Google';
  if (modelId.startsWith('deepseek/')) return 'DeepSeek';
  return 'Other';
};

interface CompanyModels {
  companyName: string;
  models: typeof mockModels;
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

// Sort: Google first (best for PDF), then alphabetically
const companyOrder = ['Google', 'OpenAI', 'Anthropic', 'DeepSeek'];
groupedModels.sort((a, b) => {
  const aIndex = companyOrder.indexOf(a.companyName);
  const bIndex = companyOrder.indexOf(b.companyName);
  return aIndex - bIndex;
});

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  latexCode?: string;
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

// Fixed preamble that we inject - AI only generates content
const FIXED_PREAMBLE = `\\documentclass[11pt,a4paper]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage[table]{xcolor}
\\usepackage{booktabs}
\\usepackage{multirow}
\\usepackage{graphicx}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage{fancyhdr}
\\usepackage{parskip}
\\usepackage{fontawesome5}
\\usepackage{tikz}
\\usetikzlibrary{arrows.meta,shapes.geometric,positioning,shadows,backgrounds,fit,calc}
\\usepackage{tcolorbox}
\\tcbuselibrary{skins,raster,breakable}
\\usepackage{pgfplots}
\\pgfplotsset{compat=1.18}
\\usepackage{amsmath,amssymb}
\\usepackage{hyperref}
\\hypersetup{colorlinks=true,linkcolor=blue,urlcolor=blue}
`;

const SYSTEM_PROMPT = `You are a LaTeX content generator. Generate ONLY the document body content.

## CRITICAL: OUTPUT FORMAT
You must output ONLY the content between \\begin{document} and \\end{document}.
DO NOT include \\documentclass, \\usepackage, or any preamble - it will be added automatically.
DO NOT include \\begin{document} or \\end{document} tags.

Wrap your content in: \`\`\`latex ... \`\`\`

## RULES FOR CONTENT:

1. LISTS - Every item MUST start with \\item:
   \\begin{itemize}
   \\item First item
   \\item Second item
   \\end{itemize}

2. ESCAPE special characters in text: & → \\&, % → \\%, $ → \\$, # → \\#, _ → \\_

3. ICONS: \\faIcon{envelope} \\faIcon{phone} \\faIcon{github} \\faIcon{linkedin}

4. TCOLORBOX: [enhanced,drop shadow,colback=blue!5,colframe=blue!50]
   
5. TABLES: Use \\toprule, \\midrule, \\bottomrule, \\rowcolor{gray!20}

6. Keep response concise - just the LaTeX content, minimal explanation.

## EXAMPLE OUTPUT:
\`\`\`latex
\\section{Introduction}
This is the introduction.

\\begin{itemize}
\\item First point
\\item Second point
\\end{itemize}
\`\`\`

### FOR RESUMES/CVS:
\`\`\`latex
\\documentclass[11pt,a4paper]{article}
\\usepackage[margin=0.75in]{geometry}
\\usepackage{titlesec}
\\usepackage{enumitem}
\\usepackage{hyperref}
\\usepackage{xcolor}

\\pagestyle{empty}
\\titleformat{\\section}{\\large\\bfseries}{}{0em}{}[\\titlerule]
\\titlespacing{\\section}{0pt}{10pt}{5pt}

\\begin{document}

{\\centering
{\\LARGE\\bfseries Your Name}\\\\[5pt]
email@example.com | (555) 123-4567 | City, State\\\\
\\href{https://linkedin.com/in/yourprofile}{LinkedIn} | \\href{https://github.com/yourusername}{GitHub}
\\par}

\\section{Experience}
\\textbf{Job Title} \\hfill Company Name\\\\
\\textit{Start Date -- End Date} \\hfill Location
\\begin{itemize}[leftmargin=*,noitemsep]
  \\item Achievement or responsibility
  \\item Another bullet point
\\end{itemize}

\\section{Education}
\\textbf{Degree} \\hfill University\\\\
\\textit{Graduation Date} \\hfill GPA: X.XX

\\section{Skills}
\\textbf{Languages:} Python, Java, JavaScript\\\\
\\textbf{Tools:} Git, Docker, AWS

\\end{document}
\`\`\`

### 8. FOR ACADEMIC DOCUMENTS:
\`\`\`latex
\\documentclass[12pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{Your Title}
\\author{Author Name}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
Your abstract here...
\\end{abstract}

\\section{Introduction}
Content...

\\end{document}
\`\`\`

## RESPONSE FORMAT:
- Be CONCISE. Keep explanations to 1 short sentence max.
- Output the LaTeX code immediately - don't describe what you're going to do.
- DON'T list customization options or explain placeholders - users can figure that out.
- After the code block, you may add ONE brief sentence if absolutely necessary.

GOOD: "Here's your project proposal:" [code]
BAD: "Here is a complete, generic project proposal template in LaTeX that you can customize with your own project details. You can customize this by replacing bracketed placeholders..." [code]

## EDITING EXISTING DOCUMENTS:
When the user asks to modify, edit, or change something in the document:
1. Look at the LaTeX code you previously generated in this conversation
2. Make the requested changes
3. Output the COMPLETE UPDATED LaTeX code (not just the changes)
4. The entire document must be re-output so it can be recompiled

Example conversation:
- User: "Create a resume for John Smith"
- You: [output complete resume LaTeX]
- User: "Change the name to Jane Doe and add Python to skills"
- You: "I'll update the name and add Python to the skills section." [output COMPLETE updated LaTeX with both changes]

IMPORTANT: Always output the FULL document code, even for small changes. The system needs the complete code to generate the PDF.

Remember: You have FULL TeX Live - use any package you need to create beautiful, professional documents!`;

const PDFChatInterface: React.FC = () => {
  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState(mockModels[0]);
  const [usedTokens, setUsedTokens] = useState(0);
  const [uploadedImages, setUploadedImages] = useState<{ base64: string; type: string; name: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  
  // UI state
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set(['Google']));
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [savedSystemPrompt, setSavedSystemPrompt] = useState('');
  const [isSystemPromptSaved, setIsSystemPromptSaved] = useState(false);
  const [showTopBarBackground, setShowTopBarBackground] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedAiMessageId, setCopiedAiMessageId] = useState<string | null>(null);
  
  // PDF Preview state
  const [currentLatex, setCurrentLatex] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [compiledHtml, setCompiledHtml] = useState<string>('');
  const [compileError, setCompileError] = useState<string>('');
  const [isPdfFullscreen, setIsPdfFullscreen] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [copiedLatex, setCopiedLatex] = useState(false);
  const [showCodeView, setShowCodeView] = useState(false); // Toggle between preview and code
  
  // Version history for undo
  const [latexHistory, setLatexHistory] = useState<{ latex: string; timestamp: number; label: string }[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  // PDF Viewer state
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pdfScale, setPdfScale] = useState(1.2);
  const [pdfRendering, setPdfRendering] = useState(false);
  const [pageCanvases, setPageCanvases] = useState<HTMLCanvasElement[]>([]);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const pagesContainerRef = useRef<HTMLDivElement>(null);
  const renderTasksRef = useRef<any[]>([]);
  
  // Pan/drag state
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState({ x: 0, y: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  
  // Refs
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const companyDropdownRef = useRef<HTMLDivElement>(null);
  const systemPromptPanelRef = useRef<HTMLDivElement>(null);
  const systemPromptButtonRef = useRef<HTMLButtonElement>(null);

  // Load history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('pdfChatHistory');
    if (saved) {
      try {
        setConversationHistory(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading chat history:', e);
      }
    }
  }, []);

  // Save history to localStorage (with size limit and error handling)
  useEffect(() => {
    if (conversationHistory.length > 0) {
      try {
        // Keep only last 10 conversations to prevent quota exceeded
        const limitedHistory = conversationHistory.slice(0, 10);
        // Strip large LaTeX code from history to save space
        const compactHistory = limitedHistory.map(conv => ({
          ...conv,
          messages: conv.messages.map(msg => ({
            ...msg,
            // Truncate very long messages in history
            text: msg.text.length > 5000 ? msg.text.substring(0, 5000) + '... [truncated]' : msg.text,
            latexCode: undefined, // Don't store LaTeX in history
            images: undefined, // Don't store images in history
          }))
        }));
        localStorage.setItem('pdfChatHistory', JSON.stringify(compactHistory));
      } catch (e) {
        console.warn('Failed to save chat history (quota exceeded), clearing old data...');
        // Clear history if quota exceeded
        try {
          localStorage.removeItem('pdfChatHistory');
          // Try saving just the current conversation
          if (conversationHistory.length > 0) {
            const minimal = [conversationHistory[0]];
            localStorage.setItem('pdfChatHistory', JSON.stringify(minimal));
          }
        } catch (e2) {
          console.error('Could not save even minimal history:', e2);
        }
      }
    }
  }, [conversationHistory]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle scroll for top bar background
  useEffect(() => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;
    
    const handleScroll = () => {
      setShowTopBarBackground(chatArea.scrollTop > 20);
    };
    
    chatArea.addEventListener('scroll', handleScroll);
    return () => chatArea.removeEventListener('scroll', handleScroll);
  }, []);

  // Quick token estimate (fallback only)
  const estimateTokens = useCallback((text: string): number => {
    return quickEstimateTokens(text);
  }, []);

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
          savedSystemPrompt || ''
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
  }, [messages, inputValue, selectedModel?.id, savedSystemPrompt, estimateTokens]);

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
      if (systemPromptPanelRef.current && !systemPromptPanelRef.current.contains(e.target as Node) &&
          systemPromptButtonRef.current && !systemPromptButtonRef.current.contains(e.target as Node)) {
        setIsSystemPromptOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Extract LaTeX code from message content and wrap with fixed preamble if needed
  const extractLatexCode = useCallback((content: string): string | null => {
    // Try fenced code blocks first
    const latexRegex = /```latex\s*([\s\S]*?)```/gi;
    const matches = [...content.matchAll(latexRegex)];
    let extracted: string | null = null;
    
    if (matches.length > 0) {
      extracted = matches[matches.length - 1][1].trim();
    } else {
      const texRegex = /```tex\s*([\s\S]*?)```/gi;
      const texMatches = [...content.matchAll(texRegex)];
      if (texMatches.length > 0) {
        extracted = texMatches[texMatches.length - 1][1].trim();
      }
    }
    
    // If no code block found, try plain code blocks
    if (!extracted) {
      const plainCodeRegex = /```\s*(\\documentclass[\s\S]*?)```/gi;
      const plainMatches = [...content.matchAll(plainCodeRegex)];
      if (plainMatches.length > 0) {
        extracted = plainMatches[plainMatches.length - 1][1].trim();
      }
    }
    
    // If still nothing, try raw LaTeX
    if (!extracted) {
      const rawLatexRegex = /(\\documentclass[\s\S]*?\\end\{document\})/gi;
      const rawMatches = [...content.matchAll(rawLatexRegex)];
      if (rawMatches.length > 0) {
        extracted = rawMatches[rawMatches.length - 1][1].trim();
      }
    }
    
    if (!extracted) return null;
    
    // Check if AI returned content-only (no \documentclass) - wrap with fixed preamble
    if (!extracted.includes('\\documentclass')) {
      console.log('Wrapping content-only LaTeX with fixed preamble');
      // Remove \begin{document} and \end{document} if present
      let bodyContent = extracted
        .replace(/\\begin\{document\}/g, '')
        .replace(/\\end\{document\}/g, '')
        .trim();
      
      return FIXED_PREAMBLE + '\n\\begin{document}\n' + bodyContent + '\n\\end{document}';
    }
    
    // Full document provided - return as-is
    return extracted;
  }, []);

  // Strip LaTeX code blocks from message for chat display (show only explanation)
  const stripLatexFromChat = useCallback((content: string): string => {
    // Remove latex and tex code blocks
    let stripped = content.replace(/```(?:latex|tex)?\s*\\documentclass[\s\S]*?```/gi, '');
    stripped = stripped.replace(/```(?:latex|tex)\s*[\s\S]*?```/gi, '');
    // Remove raw LaTeX with end document
    stripped = stripped.replace(/\\documentclass[\s\S]*?\\end\{document\}/gi, '');
    // Remove incomplete raw LaTeX (starts with \documentclass, goes to end of content)
    if (stripped.includes('\\documentclass')) {
      const startIndex = stripped.indexOf('\\documentclass');
      stripped = stripped.slice(0, startIndex);
    }
    // Clean up excessive whitespace
    stripped = stripped.replace(/\n{3,}/g, '\n\n').trim();
    return stripped || 'Document generated successfully.';
  }, []);

  // Compile LaTeX using backend proxy to LaTeX.Online API
  const compileLatex = useCallback(async (latex: string): Promise<{ success: boolean; error?: string }> => {
    setIsCompiling(true);
    setCompileError('');
    
    // Store previous URL to revoke AFTER new one is set
    const previousUrl = compiledHtml;
    
    try {
      // Use our backend proxy to avoid CORS issues
      const response = await fetch('/api/latex/compile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ latex, command: 'pdflatex' }),
      });
      
      if (!response.ok) {
        // Try to get error message
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.details || errorData.error || `Compilation failed with status ${response.status}`;
        throw new Error(errorMsg);
      }
      
      // Get the PDF blob
      const pdfBlob = await response.blob();
      const pdfUrl = URL.createObjectURL(pdfBlob);
      setCompiledHtml(pdfUrl);
      
      // Revoke previous URL after setting new one (with delay to ensure render completes)
      if (previousUrl && previousUrl.startsWith('blob:')) {
        setTimeout(() => URL.revokeObjectURL(previousUrl), 1000);
      }
      
      return { success: true };
      
    } catch (error: any) {
      console.error('LaTeX compilation error:', error);
      const errorMsg = error.message || 'Failed to compile LaTeX. Check your LaTeX syntax.';
      setCompileError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsCompiling(false);
    }
  }, [compiledHtml]);

  // Auto-fix LaTeX errors by asking AI to correct them
  const autoFixLatex = useCallback(async (latex: string, errorMsg: string) => {
    try {
      const fixPrompt = `Fix this LaTeX compilation error. Return ONLY the complete fixed code in \`\`\`latex ... \`\`\`.

ERROR: ${errorMsg}

CODE TO FIX:
\`\`\`latex
${latex}
\`\`\`

EXACT FIXES TO APPLY:
1. "layer 'background' could not be found" → Add: \\usetikzlibrary{backgrounds}
2. "I do not know the key '/tcb/raster" → Add: \\tcbuselibrary{raster} after \\usepackage{tcolorbox}
3. "drop blur shadow" or "drop small shadow" → Replace with: drop shadow
4. "Undefined control sequence \\rowcolor" → Add: \\usepackage[table]{xcolor}
5. "Undefined control sequence \\toprule" → Add: \\usepackage{booktabs}
6. "Undefined control sequence \\multirow" → Add: \\usepackage{multirow}
7. "Undefined control sequence \\faIcon" → Add: \\usepackage{fontawesome5}
8. "I do not know the key '/tikz/fit'" → Add: \\usetikzlibrary{fit}
9. "tikz library" not found → Valid ones: arrows.meta, shapes.geometric, positioning, calc, shadows, backgrounds, fit
10. "Misplaced alignment tab character &" → Change & to \\& in regular text
11. "missing \\item" → Add \\item before each list entry

Apply the fix and return the COMPLETE document from \\documentclass to \\end{document}.`;

      const result = await chatComplete({
        model: 'gpt-5.4-mini',
        messages: [{ role: 'user', content: fixPrompt }],
        path: 'premium',
        temperature: 0.3,
        maxTokens: 16000,
      });

      const fixedContent = result.content;
      if (!fixedContent) return null;

      // Extract LaTeX from response
      const latexMatch = fixedContent.match(/```latex\s*([\s\S]*?)```/);
      return latexMatch ? latexMatch[1].trim() : null;
    } catch (e) {
      console.error('Auto-fix error:', e);
      return null;
    }
  }, []);

  // Load PDF when URL changes
  useEffect(() => {
    if (!compiledHtml || !compiledHtml.startsWith('blob:')) return;
    
    let cancelled = false;
    
    const loadPdf = async () => {
      try {
        setPdfRendering(true);
        const loadingTask = pdfjsLib.getDocument(compiledHtml);
        const pdf = await loadingTask.promise;
        
        if (cancelled) return;
        
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        setCurrentPage(1);
      } catch (error) {
        console.error('Error loading PDF:', error);
      }
    };
    
    loadPdf();
    
    return () => { cancelled = true; };
  }, [compiledHtml]);

  // Render all pages when PDF doc or scale changes
  useEffect(() => {
    if (!pdfDoc || !pagesContainerRef.current) return;
    
    let cancelled = false;
    
    const renderAllPages = async () => {
      setPdfRendering(true);
      
      // Cancel any ongoing renders
      renderTasksRef.current.forEach(task => {
        try { task?.cancel(); } catch (e) {}
      });
      renderTasksRef.current = [];
      
      // Clear existing canvases
      const container = pagesContainerRef.current;
      if (!container) return;
      container.innerHTML = '';
      
      // Render each page
      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        if (cancelled) return;
        
        try {
          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: pdfScale });
          
          // Create page wrapper
          const pageWrapper = document.createElement('div');
          pageWrapper.className = 'pdf-page-wrapper';
          pageWrapper.style.cssText = `
            position: relative;
            margin-bottom: 16px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            border-radius: 4px;
            background: white;
          `;
          pageWrapper.setAttribute('data-page', String(pageNum));
          
          // Create canvas
          const canvas = document.createElement('canvas');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          canvas.style.cssText = 'display: block; border-radius: 4px;';
          
          pageWrapper.appendChild(canvas);
          container.appendChild(pageWrapper);
          
          // Render page
          const context = canvas.getContext('2d');
          if (context) {
            const renderTask = page.render({
              canvasContext: context,
              viewport: viewport,
            });
            renderTasksRef.current.push(renderTask);
            await renderTask.promise;
          }
        } catch (error: any) {
          if (error?.name !== 'RenderingCancelledException') {
            console.error(`Error rendering page ${pageNum}:`, error);
          }
        }
      }
      
      if (!cancelled) {
        setPdfRendering(false);
      }
    };
    
    renderAllPages();
    
    return () => { cancelled = true; };
  }, [pdfDoc, pdfScale]);

  // Update current page based on scroll position
  useEffect(() => {
    const container = pdfContainerRef.current;
    if (!container) return;
    
    const handleScroll = () => {
      const pages = pagesContainerRef.current?.querySelectorAll('.pdf-page-wrapper');
      if (!pages) return;
      
      const containerRect = container.getBoundingClientRect();
      const containerCenter = containerRect.top + containerRect.height / 2;
      
      let closestPage = 1;
      let closestDistance = Infinity;
      
      pages.forEach((page, index) => {
        const pageRect = page.getBoundingClientRect();
        const pageCenter = pageRect.top + pageRect.height / 2;
        const distance = Math.abs(pageCenter - containerCenter);
        
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = index + 1;
        }
      });
      
      setCurrentPage(closestPage);
    };
    
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // PDF navigation functions - scroll to page
  const scrollToPage = (pageNum: number) => {
    const container = pdfContainerRef.current;
    const pages = pagesContainerRef.current?.querySelectorAll('.pdf-page-wrapper');
    if (!container || !pages || !pages[pageNum - 1]) return;
    
    const page = pages[pageNum - 1] as HTMLElement;
    const containerRect = container.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    
    // Calculate scroll position to bring page to top of container
    const scrollTop = container.scrollTop + (pageRect.top - containerRect.top) - 24; // 24px padding
    
    container.scrollTo({
      top: scrollTop,
      behavior: 'smooth'
    });
  };

  const goToPrevPage = () => {
    if (currentPage > 1) {
      const newPage = currentPage - 1;
      setCurrentPage(newPage);
      scrollToPage(newPage);
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      const newPage = currentPage + 1;
      setCurrentPage(newPage);
      scrollToPage(newPage);
    }
  };

  const zoomIn = () => {
    setPdfScale(prev => Math.min(prev + 0.25, 3));
  };

  const zoomOut = () => {
    setPdfScale(prev => Math.max(prev - 0.25, 0.5));
  };

  const resetZoom = () => {
    setPdfScale(1.2);
  };

  // Pan/drag handlers for PDF viewer
  const handlePanStart = (e: React.MouseEvent) => {
    if (!pdfContainerRef.current) return;
    
    // Only pan if space is pressed or middle mouse button
    if (spacePressed || e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      setScrollStart({
        x: pdfContainerRef.current.scrollLeft,
        y: pdfContainerRef.current.scrollTop
      });
    }
  };

  const handlePanMove = (e: React.MouseEvent) => {
    if (!isPanning || !pdfContainerRef.current) return;
    
    e.preventDefault();
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;
    
    pdfContainerRef.current.scrollLeft = scrollStart.x - dx;
    pdfContainerRef.current.scrollTop = scrollStart.y - dy;
  };

  const handlePanEnd = () => {
    setIsPanning(false);
  };

  // Keyboard handlers for space key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        setSpacePressed(true);
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
        setIsPanning(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
    }
  };

  // Add to version history
  const addToHistory = useCallback((latex: string, label: string) => {
    setLatexHistory(prev => {
      // Don't add if same as last version
      if (prev.length > 0 && prev[prev.length - 1].latex === latex) {
        return prev;
      }
      const newHistory = [...prev, { latex, timestamp: Date.now(), label }];
      // Keep only last 20 versions
      if (newHistory.length > 20) {
        return newHistory.slice(-20);
      }
      return newHistory;
    });
    setHistoryIndex(-1); // Reset to latest
  }, []);

  // Undo - go to previous version
  const undoLatex = useCallback(() => {
    if (latexHistory.length < 2) return;
    const newIndex = historyIndex === -1 ? latexHistory.length - 2 : Math.max(0, historyIndex - 1);
    setHistoryIndex(newIndex);
    const previousVersion = latexHistory[newIndex];
    if (previousVersion) {
      setCurrentLatex(previousVersion.latex);
      compileLatex(previousVersion.latex);
    }
  }, [latexHistory, historyIndex, compileLatex]);

  // Redo - go to next version
  const redoLatex = useCallback(() => {
    if (historyIndex === -1 || historyIndex >= latexHistory.length - 1) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    const nextVersion = latexHistory[newIndex];
    if (nextVersion) {
      setCurrentLatex(nextVersion.latex);
      compileLatex(nextVersion.latex);
    }
  }, [latexHistory, historyIndex, compileLatex]);

  // Check if undo/redo available
  const canUndo = latexHistory.length >= 2 && (historyIndex === -1 || historyIndex > 0);
  const canRedo = historyIndex !== -1 && historyIndex < latexHistory.length - 1;

  // Validate LaTeX is complete
  const isLatexComplete = useCallback((latex: string): boolean => {
    const hasDocumentClass = latex.includes('\\documentclass');
    const hasBeginDoc = latex.includes('\\begin{document}');
    const hasEndDoc = latex.includes('\\end{document}');
    return hasDocumentClass && hasBeginDoc && hasEndDoc;
  }, []);

  // Programmatic fix for common LaTeX issues (no AI needed)
  const fixCommonLatexIssues = useCallback((latex: string): string => {
    let fixed = latex;
    
    // Fix shadow options
    fixed = fixed.replace(/drop\s+blur\s+shadow/g, 'drop shadow');
    fixed = fixed.replace(/drop\s+small\s+shadow/g, 'drop shadow');
    fixed = fixed.replace(/drop\s+large\s+shadow/g, 'drop shadow');
    
    // Fix old fontawesome syntax
    fixed = fixed.replace(/\\fa([A-Z][a-zA-Z]+)(?![{a-zA-Z])/g, (match, name) => {
      const iconName = name.replace(/([A-Z])/g, '-$1').toLowerCase().substring(1);
      return `\\faIcon{${iconName}}`;
    });
    
    // Ensure required packages are present
    const requiredPackages = [
      { check: /\\rowcolor|\\cellcolor|\\columncolor/, pkg: '\\usepackage[table]{xcolor}', before: '\\usepackage{booktabs}' },
      { check: /\\toprule|\\midrule|\\bottomrule/, pkg: '\\usepackage{booktabs}', before: '\\usepackage{multirow}' },
      { check: /\\multirow/, pkg: '\\usepackage{multirow}', before: '\\usepackage{graphicx}' },
      { check: /\\faIcon/, pkg: '\\usepackage{fontawesome5}', before: '\\usepackage{tikz}' },
    ];
    
    for (const { check, pkg, before } of requiredPackages) {
      if (check.test(fixed) && !fixed.includes(pkg.replace('[table]', ''))) {
        // Add package before the reference package or before \begin{document}
        if (fixed.includes(before)) {
          fixed = fixed.replace(before, pkg + '\n' + before);
        } else {
          fixed = fixed.replace('\\begin{document}', pkg + '\n\\begin{document}');
        }
      }
    }
    
    return fixed;
  }, []);

  // Track last compiled message to avoid double compilation
  const lastCompiledMsgRef = useRef<string>('');

  // Watch for LaTeX in messages and auto-compile
  useEffect(() => {
    const lastAssistantMessage = [...messages].reverse().find(m => m.sender === 'ai');
    if (lastAssistantMessage) {
      // Check if we already processed this exact message
      const msgId = lastAssistantMessage.id + lastAssistantMessage.text.length;
      if (msgId === lastCompiledMsgRef.current) {
        return; // Already compiled this message
      }
      
      let latex = extractLatexCode(lastAssistantMessage.text);
      if (latex && latex !== currentLatex) {
        // Validate completeness
        if (!isLatexComplete(latex)) {
          console.warn('LaTeX code is incomplete - missing \\end{document}');
          setCompileError('The generated LaTeX code appears to be incomplete. Try asking the AI to regenerate the document.');
          return;
        }
        
        // Apply programmatic fixes before compiling
        const fixedLatex = fixCommonLatexIssues(latex);
        if (fixedLatex !== latex) {
          console.log('Applied automatic LaTeX fixes');
          latex = fixedLatex;
        }
        
        // Mark this message as compiled
        lastCompiledMsgRef.current = msgId;
        
        // Get label from user message
        const lastUserMessage = [...messages].reverse().find(m => m.sender === 'user');
        const label = lastUserMessage?.text.slice(0, 40) || 'Document update';
        addToHistory(latex, label);
        setCurrentLatex(latex);
        compileLatex(latex);
      }
    }
  }, [messages, extractLatexCode, compileLatex, currentLatex, addToHistory, isLatexComplete, fixCommonLatexIssues]);

  // Save conversation
  const saveConversation = useCallback(() => {
    if (messages.length === 0) return;
    
    const firstUserMessage = messages.find(m => m.sender === 'user');
    const title = firstUserMessage?.text.slice(0, 50) + (firstUserMessage?.text.length || 0 > 50 ? '...' : '') || 'New Conversation';
    
    if (activeConversationId) {
      setConversationHistory(prev => prev.map(conv => 
        conv.id === activeConversationId 
          ? { ...conv, messages, timestamp: Date.now() }
          : conv
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

  // Auto-save conversation when messages change
  useEffect(() => {
    if (messages.length > 0) {
      const timeout = setTimeout(saveConversation, 1000);
      return () => clearTimeout(timeout);
    }
  }, [messages, saveConversation]);

  // Send message to AI
  const sendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;
    
    // Store images before clearing
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
    setUploadedImages([]); // Clear uploaded images
    setIsLoading(true);
    
    try {
      const effectiveSystemPrompt = savedSystemPrompt || SYSTEM_PROMPT;
      
      // Build user message content with images if any
      let userText = userMessage.text;
      
      // If there's existing LaTeX, extract just the body content for context
      if (currentLatex && !userText.toLowerCase().includes('create') && !userText.toLowerCase().includes('generate') && !userText.toLowerCase().includes('make me') && !userText.toLowerCase().includes('new document')) {
        // Extract body content from existing document
        const bodyMatch = currentLatex.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
        const bodyContent = bodyMatch ? bodyMatch[1].trim() : currentLatex;
        
        userText = `CURRENT DOCUMENT BODY TO EDIT:
\`\`\`latex
${bodyContent}
\`\`\`

USER REQUEST: ${userMessage.text}

Output ONLY the updated body content (no preamble, no \\begin{document}/\\end{document}).
Every list item needs \\item. Escape & as \\&.`;
      }
      
      let userContent: any = userText;
      if (imagesToSend.length > 0 && selectedModel.supportsVision) {
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
          { role: 'system', content: effectiveSystemPrompt },
          ...messages.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text })),
          { role: 'user', content: userContent }
        ] as any,
        path: 'premium',
        temperature: 0.3,
        maxTokens: selectedModel.maxOutputTokens,
      });

      const assistantContent = result.content || 'Sorry, I could not generate a response.';
      
      const assistantMessage: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: assistantContent,
        timestamp: Date.now(),
        latexCode: extractLatexCode(assistantContent) || undefined,
      };
      
      setMessages(prev => [...prev, assistantMessage]);
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

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result as string;
          setUploadedImages(prev => [...prev, {
            base64,
            type: file.type,
            name: file.name
          }]);
        };
        reader.readAsDataURL(file);
      }
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Remove uploaded image
  const removeUploadedImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  // Compact conversation using a model that can handle the current token count
  const compactConversation = async (newModel: typeof mockModels[0]) => {
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

      // Use the selected model for summarization
      const result = await chatComplete({
        model: compactingModel,
        messages: [
          {
            role: 'system',
            content: `You are a conversation summarizer. Create a concise summary of the following conversation about PDF document creation.
Focus on:
1. What document the user wanted to create
2. Key requirements and changes requested
3. Important decisions made

Keep the summary under 500 words. Do NOT include any LaTeX code in the summary - that will be preserved separately.`
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

      // Create compacted messages: summary + latest LaTeX if exists
      const compactedMessages: ChatMessage[] = [
        {
          id: `summary-${Date.now()}`,
          sender: 'ai',
          text: `**📋 Conversation Summary (compacted for ${newModel.name}):**\n\n${summary}${currentLatex ? `\n\n---\n\n**Current Document:**\nThe latest LaTeX document has been preserved and is shown in the preview panel.` : ''}`,
          timestamp: Date.now(),
          latexCode: currentLatex || undefined,
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
        isError: true,
      };
      setMessages(prev => [...prev, warningMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleModelSelect = async (model: typeof mockModels[0]) => {
    const previousModel = selectedModel;
    setSelectedModel(model);
    setIsCompanyDropdownOpen(false);

    // Check if we need to compact the conversation
    if (model.maxTokens < previousModel.maxTokens && usedTokens > model.maxTokens) {
      await compactConversation(model);
    }
  };

  const handleSaveOrClearSystemPrompt = () => {
    if (systemPrompt.trim() !== '' && systemPrompt !== savedSystemPrompt) {
      setSavedSystemPrompt(systemPrompt);
      setIsSystemPromptSaved(true);
      setTimeout(() => setIsSystemPromptSaved(false), 1500);
    } else if (systemPrompt.trim() !== '' && systemPrompt === savedSystemPrompt) {
      setSystemPrompt('');
      setSavedSystemPrompt('');
    }
  };

  const copyToClipboard = (text: string, type: 'message' | 'ai' | 'latex', id?: string) => {
    navigator.clipboard.writeText(text);
    if (type === 'message' && id) {
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId(null), 1500);
    } else if (type === 'ai' && id) {
      setCopiedAiMessageId(id);
      setTimeout(() => setCopiedAiMessageId(null), 1500);
    } else if (type === 'latex') {
      setCopiedLatex(true);
      setTimeout(() => setCopiedLatex(false), 1500);
    }
  };

  const downloadTex = () => {
    if (currentLatex) {
      const blob = new Blob([currentLatex], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'document.tex';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setActiveConversationId(null);
    setCurrentLatex('');
    setCompiledHtml('');
    setLatexHistory([]);
    setHistoryIndex(-1);
  };

  const loadConversation = (conv: Conversation) => {
    setMessages(conv.messages);
    setActiveConversationId(conv.id);
    setIsHistoryOpen(false);
    const lastLatex = [...conv.messages].reverse().find(m => m.latexCode)?.latexCode;
    if (lastLatex) {
      setCurrentLatex(lastLatex);
      compileLatex(lastLatex);
    }
  };

  const deleteConversation = (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversationHistory(prev => prev.filter(c => c.id !== convId));
    if (activeConversationId === convId) {
      startNewChat();
    }
  };

  return (
    <>
      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        
        .prose h1 { color: white; font-size: 1.5em; font-weight: 600; margin-top: 1.75rem; margin-bottom: 1rem; }
        .prose h2 { color: white; font-size: 1.25em; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.75rem; }
        .prose h3 { font-size: 1.1em; font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.5rem; color: #e5e7eb; }
        .prose ul, .prose ol { margin-top: 0.5rem; margin-bottom: 0.75rem; padding-left: 1.25rem; }
        .prose li { margin-top: 0.2rem; margin-bottom: 0.2rem; }
        .prose li::marker { color: #9ca3af; }
        .prose strong { color: #ffffff; font-weight: 600; }
        .prose table { width: 100%; margin-top: 1rem; margin-bottom: 1rem; font-size: 0.875rem; border-collapse: collapse; border: 1px solid #4b5563; }
        .prose th, .prose td { border: 1px solid #4b5563; padding: 0.5rem 0.75rem; text-align: left; }
        .prose th { background-color: rgba(55, 65, 81, 0.5); font-weight: 600; color: white; }
        
        .top-bar-fading-shadow { box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2); }
        .input-box-top-fade { box-shadow: 0 -10px 20px 10px #121212; }
      `}</style>
      
      <div className="flex h-full bg-[#121212]">
        {/* Main Chat Area */}
        <div className={`relative flex flex-col h-full text-white overflow-hidden ${isPdfFullscreen ? 'hidden' : showPreview ? 'w-1/2' : 'w-full'}`}>
          {/* Top Bar */}
          <div className="flex flex-shrink-0 items-center justify-between px-4 py-4 bg-[#121212] border-b border-[#2a2a2d]">
            {/* Left side - New Chat & History */}
            <div className="flex items-center gap-2">
              <button 
                onClick={startNewChat}
                className="flex items-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-gray-500 transition-colors h-9"
                title="New conversation"
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
            </div>

            {/* Right side - Model Selector & Preview Toggle */}
            <div className="flex items-center gap-2">
              {/* Model Selector */}
              <div className="relative" ref={companyDropdownRef}>
                <button 
                  onClick={() => setIsCompanyDropdownOpen(!isCompanyDropdownOpen)}
                  className="flex items-center justify-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-gray-500 transition-colors h-9 w-[10rem]"
                >
                  <Brain size={16} className="text-gray-400 flex-shrink-0" />
                  <span className="truncate">{selectedModel.name}</span>
                </button>
                <div className={`absolute top-full right-0 mt-[10px] z-20 transition-all duration-200 ease-out origin-top-right ${isCompanyDropdownOpen ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible'} w-64 bg-[#1f1f20] border border-[#3a3a3d] rounded-lg shadow-xl max-h-[70vh] overflow-y-auto`}>
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
                                if (newSet.has(group.companyName)) newSet.delete(group.companyName);
                                else newSet.add(group.companyName);
                                return newSet;
                              });
                            }}
                            className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between transition-colors ${isActiveCompany ? 'text-white font-medium' : 'text-gray-300'} ${isExpanded ? 'bg-zinc-700/30' : 'hover:bg-zinc-700/50'}`}
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
                                  className={`w-full text-left px-3 py-1.5 my-0.5 text-sm flex items-center gap-2 rounded-md ${selectedModel.id === model.id ? 'bg-zinc-600/50 text-white' : 'text-gray-400 hover:bg-zinc-600/50 hover:text-gray-200'}`}
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
              {/* Preview Toggle */}
              <button 
                onClick={() => setShowPreview(!showPreview)}
                className={`flex items-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-gray-500 transition-colors h-9 ${showPreview ? 'border-blue-500/50 text-blue-400' : ''}`}
                title={showPreview ? 'Hide Preview' : 'Show Preview'}
              >
                {showPreview ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </div>
          </div>

          {/* History Panel */}
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

          {/* Chat Messages Area */}
          <div ref={chatAreaRef} className="hide-scrollbar flex-1 min-h-0 w-full overflow-y-auto px-2 pb-40">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <h3 className="text-xl font-semibold text-white mb-2">PDF Document Generator</h3>
                <p className="text-sm text-white/50 max-w-md mb-6">
                  Describe the document you want to create. I'll generate professional LaTeX code and show you a live preview.
                </p>
                <div className="w-full max-w-md space-y-2">
                  <p className="text-xs text-white/30 uppercase tracking-wide text-center">Try asking:</p>
                  {[
                    "Create a professional resume for a software engineer",
                    "Generate a project proposal document",
                    "Write a technical report with equations",
                    "Create a meeting agenda template"
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
                <>
                  {messages.map((message, index) => {
                    const isUser = message.sender === 'user';
                    const firstMessageTopMargin = index === 0 ? (showTopBarBackground ? 'mt-[5rem]' : 'mt-4') : '';
                    
                    return (
                      <div 
                        key={message.id} 
                        className={`flex w-full ${isUser ? 'justify-end pr-4' : 'justify-start'} ${firstMessageTopMargin}`}
                      >
                        {isUser ? (
                          <div className="group flex flex-col items-end max-w-[75%]">
                            <div className="bg-[#19191a] border border-[#3a3a3d] rounded-2xl rounded-br-none p-3 text-white">
                              {/* Attached images */}
                              {message.images && message.images.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-2">
                                  {message.images.map((img, imgIndex) => (
                                    <button
                                      key={imgIndex}
                                      onClick={() => setPreviewImage(img.base64)}
                                      className="relative group/img w-12 h-12 rounded-lg overflow-hidden border border-[#3a3a3d] hover:border-blue-500 transition-colors"
                                    >
                                      <img
                                        src={img.base64}
                                        alt={img.name}
                                        className="w-full h-full object-cover"
                                      />
                                      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/30 transition-colors flex items-center justify-center">
                                        <Maximize2 size={14} className="text-white opacity-0 group-hover/img:opacity-100 transition-opacity" />
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                              <p className="text-sm leading-snug whitespace-pre-wrap">{message.text}</p>
                            </div>
                            <div className="flex items-center justify-end gap-2 mt-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-150">
                              <button 
                                onClick={() => copyToClipboard(message.text, 'message', message.id)} 
                                className="p-1 text-gray-400 hover:text-gray-200 rounded-md"
                              >
                                {copiedMessageId === message.id ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="group flex flex-col items-start w-full space-y-2 pr-4">
                            <div className={`w-full rounded-2xl p-3 ${message.isError ? 'bg-red-500/10 border border-red-500/30' : 'bg-transparent'}`}>
                              <div className="prose prose-sm prose-invert max-w-none text-gray-200">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm, remarkMath]}
                                  rehypePlugins={[rehypeKatex]}
                                  components={{
                                    code({ node, inline, className, children, ...props }: any) {
                                      return inline ? (
                                        <code className="bg-[#232326] px-1.5 py-0.5 rounded text-sm text-orange-300" {...props}>{children}</code>
                                      ) : (
                                        <pre className="bg-[#0e0e10] p-3 rounded-lg overflow-x-auto border border-[#2a2a2d]">
                                          <code className="text-white/80" {...props}>{children}</code>
                                        </pre>
                                      );
                                    }
                                  }}
                                >
                                  {stripLatexFromChat(message.text)}
                                </ReactMarkdown>
                              </div>
                              {/* Show indicator that document was generated */}
                              {message.latexCode && (
                                <div className="mt-3 flex items-center gap-2 text-xs text-green-400">
                                  <FileText size={14} />
                                  <span>Document generated - see preview panel</span>
                                  <button 
                                    onClick={() => setShowPreview(true)}
                                    className="ml-2 px-2 py-0.5 bg-green-500/20 hover:bg-green-500/30 rounded text-green-400 transition-colors"
                                  >
                                    View
                                  </button>
                                </div>
                              )}
                            </div>
                            {/* AI Message Actions */}
                            {!message.isError && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => copyToClipboard(stripLatexFromChat(message.text), 'ai', message.id)}
                                  className="p-1 text-gray-400 hover:text-gray-200 rounded-md"
                                >
                                  {copiedAiMessageId === message.id ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                                </button>
                                <button className="p-1 text-gray-400 hover:text-gray-200 rounded-md"><ThumbsUp size={14} /></button>
                                <button className="p-1 text-gray-400 hover:text-gray-200 rounded-md"><ThumbsDown size={14} /></button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {isLoading && (
                    <div className="flex justify-start w-full">
                      <div className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm">
                        <Loader2 size={14} className="animate-spin text-blue-400" />
                        <span className="text-gray-400">Generating document...</span>
                      </div>
                    </div>
                  )}
                </>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="max-w-[45rem] mx-auto">
              <div className="relative bg-[#19191a] border border-[#3a3a3d] rounded-2xl p-4 shadow-lg input-box-top-fade">
                {/* Uploaded images preview */}
                {uploadedImages.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {uploadedImages.map((img, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={img.base64}
                          alt={img.name}
                          className="w-16 h-16 object-cover rounded-lg border border-[#3a3a3d]"
                        />
                        <button
                          onClick={() => removeUploadedImage(index)}
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
                    placeholder="Describe the PDF document you want to create..."
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
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleFileUpload}
                          className="hidden"
                        />
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

        {/* PDF Preview Panel */}
        {(showPreview || isPdfFullscreen) && (
          <div className={`relative flex flex-col bg-[#121212] border-l border-[#2a2a2d] ${isPdfFullscreen ? 'w-full' : 'w-1/2'}`}>
            {/* Preview Top Bar - matches chat top bar style */}
            <div className="flex flex-shrink-0 items-center justify-between px-4 py-4 bg-[#121212] border-b border-[#2a2a2d]">
              {/* Left side - Title and view toggle */}
              <div className="flex items-center gap-3">
                {/* View Toggle */}
                <div className="flex items-center bg-[#19191a] border border-[#3a3a3d] rounded-lg p-1 h-9">
                  <button
                    onClick={() => setShowCodeView(false)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm transition-colors ${!showCodeView ? 'bg-[#2a2a2d] text-white' : 'text-white/50 hover:text-white/80'}`}
                  >
                    <Eye size={14} />
                    <span>Preview</span>
                  </button>
                  <button
                    onClick={() => setShowCodeView(true)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm transition-colors ${showCodeView ? 'bg-[#2a2a2d] text-white' : 'text-white/50 hover:text-white/80'}`}
                  >
                    <FileType size={14} />
                    <span>Code</span>
                  </button>
                </div>

              </div>
              
              {/* Right side - Actions */}
              <div className="flex items-center gap-2">
                {/* Page Navigation & Zoom - only show when PDF is ready */}
                {compiledHtml && !showCodeView && totalPages > 0 && (
                  <>
                    <div className="flex items-center gap-1 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-1 h-9">
                      <button
                        onClick={goToPrevPage}
                        disabled={currentPage <= 1}
                        className="p-1.5 hover:bg-white/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Previous page"
                      >
                        <ChevronLeft size={16} className="text-white/70" />
                      </button>
                      <span className="text-xs text-white/60 min-w-[45px] text-center">
                        {currentPage}/{totalPages}
                      </span>
                      <button
                        onClick={goToNextPage}
                        disabled={currentPage >= totalPages}
                        className="p-1.5 hover:bg-white/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Next page"
                      >
                        <ChevronRight size={16} className="text-white/70" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-1 h-9">
                      <button
                        onClick={zoomOut}
                        className="p-1.5 hover:bg-white/10 rounded transition-colors"
                        title="Zoom out"
                      >
                        <ZoomOut size={16} className="text-white/70" />
                      </button>
                      <span className="text-xs text-white/50 min-w-[40px] text-center">
                        {Math.round(pdfScale * 100)}%
                      </span>
                      <button
                        onClick={zoomIn}
                        className="p-1.5 hover:bg-white/10 rounded transition-colors"
                        title="Zoom in"
                      >
                        <ZoomIn size={16} className="text-white/70" />
                      </button>
                    </div>
                  </>
                )}
                
                {currentLatex && (
                  <>
                    {/* Undo/Redo buttons */}
                    <div className="flex items-center bg-[#19191a] border border-[#3a3a3d] rounded-lg h-9">
                      <button
                        onClick={undoLatex}
                        disabled={!canUndo}
                        className="flex items-center justify-center px-2 h-full text-white/80 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed rounded-l-lg"
                        title={canUndo ? `Undo (${latexHistory.length - 1} versions)` : 'No history'}
                      >
                        <Undo2 size={16} />
                      </button>
                      <div className="w-px h-5 bg-[#3a3a3d]" />
                      <button
                        onClick={redoLatex}
                        disabled={!canRedo}
                        className="flex items-center justify-center px-2 h-full text-white/80 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed rounded-r-lg"
                        title="Redo"
                      >
                        <Redo2 size={16} />
                      </button>
                    </div>
                    <button
                      onClick={() => copyToClipboard(currentLatex, 'latex')}
                      className="flex items-center justify-center bg-[#19191a] border border-[#3a3a3d] rounded-lg px-2.5 h-9 text-white/80 hover:border-gray-500 transition-colors"
                      title="Copy LaTeX Source"
                    >
                      {copiedLatex ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                    </button>
                    {compiledHtml && (
                      <a
                        href={compiledHtml}
                        download="document.pdf"
                        className="flex items-center justify-center bg-[#19191a] border border-[#3a3a3d] rounded-lg px-2.5 h-9 text-white/80 hover:border-gray-500 transition-colors"
                        title="Download PDF"
                      >
                        <Download size={16} />
                      </a>
                    )}
                    <button
                      onClick={() => compileLatex(currentLatex)}
                      disabled={isCompiling}
                      className="flex items-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-gray-500 transition-colors h-9 disabled:opacity-50"
                      title="Recompile document"
                    >
                      <RefreshCw size={16} className={isCompiling ? 'animate-spin' : ''} />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setIsPdfFullscreen(!isPdfFullscreen)}
                  className="flex items-center gap-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg px-3 py-1.5 text-sm text-white/80 hover:border-gray-500 transition-colors h-9"
                  title={isPdfFullscreen ? "Exit fullscreen" : "Fullscreen preview"}
                >
                  {isPdfFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
              </div>
            </div>
            
            {/* Preview Content Area */}
            <div className="hide-scrollbar flex-1 overflow-auto">
              {/* Empty State */}
              {!currentLatex && !isCompiling && (
                <div className="flex flex-col items-center justify-center h-full px-8 text-center">
                  <div className="relative mb-6">
                    {/* Paper stack effect */}
                    <div className="absolute -bottom-2 -right-2 w-44 h-56 bg-[#1a1a1d] border border-[#2a2a2d] rounded-lg transform rotate-3" />
                    <div className="absolute -bottom-1 -right-1 w-44 h-56 bg-[#1f1f22] border border-[#2a2a2d] rounded-lg transform rotate-1" />
                    <div className="relative w-44 h-56 bg-[#19191a] border-2 border-dashed border-[#3a3a3d] rounded-lg flex flex-col items-center justify-center">
                      <FileText size={40} className="text-white/15 mb-3" />
                      <div className="space-y-1.5 w-24">
                        <div className="h-1.5 bg-[#2a2a2d] rounded-full w-full" />
                        <div className="h-1.5 bg-[#2a2a2d] rounded-full w-3/4" />
                        <div className="h-1.5 bg-[#2a2a2d] rounded-full w-5/6" />
                        <div className="h-1.5 bg-[#2a2a2d] rounded-full w-2/3" />
                      </div>
                    </div>
                  </div>
                  <h3 className="text-lg font-medium text-white mb-2">No Document Yet</h3>
                  <p className="text-sm text-white/40 max-w-xs mb-4">
                    Start a conversation and describe the document you want. Your PDF preview will appear here.
                  </p>
                  <div className="flex items-center gap-2 text-xs text-white/30">
                    <FileType size={14} />
                    <span>Supports LaTeX documents</span>
                  </div>
                </div>
              )}
              
              {/* Loading State */}
              {isCompiling && (
                <div className="flex flex-col items-center justify-center h-full">
                  <div className="relative mb-6">
                    <div className="w-20 h-20 rounded-2xl bg-[#19191a] border border-[#3a3a3d] flex items-center justify-center">
                      <Loader2 size={32} className="animate-spin text-blue-400" />
                    </div>
                  </div>
                  <h3 className="text-lg font-medium text-white mb-2">Compiling with pdfLaTeX</h3>
                  <p className="text-sm text-white/40">Generating professional PDF output...</p>
                </div>
              )}
              
              {/* Error State */}
              {compileError && (
                <div className="p-6">
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center flex-shrink-0">
                        <X size={16} className="text-red-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-red-400 mb-1">Compilation Error</h4>
                        <p className="text-sm text-red-300/80">{compileError}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Code View */}
              {showCodeView && currentLatex && (
                <div className="p-6 h-full">
                  <div className="bg-[#0e0e10] border border-[#2a2a2d] rounded-lg overflow-hidden h-full flex flex-col">
                    <div className="flex items-center justify-between px-4 py-2 bg-[#19191a] border-b border-[#2a2a2d]">
                      <div className="flex items-center gap-2">
                        <FileType size={14} className="text-green-400" />
                        <span className="text-sm text-white/60">LaTeX Source Code</span>
                      </div>
                      <button
                        onClick={() => copyToClipboard(currentLatex, 'latex')}
                        className="p-1.5 hover:bg-white/10 rounded transition-colors"
                        title="Copy code"
                      >
                        {copiedLatex ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="text-white/50" />}
                      </button>
                    </div>
                    <pre className="flex-1 overflow-auto p-4 text-sm text-white/80 font-mono leading-relaxed">
                      <code>{currentLatex}</code>
                    </pre>
                  </div>
                </div>
              )}

              {/* Document Preview - Custom PDF Viewer (hidden when code view, but stays mounted) */}
              {compiledHtml && !isCompiling && (
                <div className={`h-full flex flex-col ${showCodeView ? 'hidden' : ''}`}>
                  {/* PDF Canvas Container - Continuous Scroll */}
                  <div 
                    ref={pdfContainerRef}
                    className={`flex-1 overflow-auto bg-[#2a2a2d] relative ${
                      spacePressed ? 'cursor-grab' : ''
                    } ${isPanning ? 'cursor-grabbing select-none' : ''}`}
                    onMouseDown={handlePanStart}
                    onMouseMove={handlePanMove}
                    onMouseUp={handlePanEnd}
                    onMouseLeave={handlePanEnd}
                    onWheel={handleWheel}
                  >
                    {/* Pages container - all pages rendered vertically */}
                    <div 
                      ref={pagesContainerRef}
                      className="flex flex-col items-center py-6 px-4"
                      style={{ minHeight: '100%' }}
                    />
                    
                    {/* Loading overlay */}
                    {pdfRendering && (
                      <div className="absolute inset-0 bg-[#2a2a2d]/80 flex items-center justify-center">
                        <div className="flex items-center gap-3 text-white/70">
                          <Loader2 size={24} className="animate-spin" />
                          <span>Rendering pages...</span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Footer with tips */}
                  <div className="flex items-center justify-center px-4 py-1.5 bg-[#19191a] border-t border-[#2a2a2d] text-xs text-white/30 gap-3">
                    <span>Scroll to navigate</span>
                    <span>•</span>
                    <span>Ctrl + Scroll to zoom</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Image Preview Modal */}
      {previewImage && (
        <div 
          className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-colors"
            >
              <X size={18} className="text-white" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default PDFChatInterface;

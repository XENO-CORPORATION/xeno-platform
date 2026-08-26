import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button, IconButton, MenuItem, SegmentedControl, Spinner, useGooPill, useMenu } from '@xenosystem/elements-react';
import ReactMarkdown from 'react-markdown';
import { Send, Globe, ChevronDown, Eye, Check, Zap, Link2, Sparkles, ExternalLink, Bot, Navigation, ScanEye, Layers, FileOutput, Search as SearchIcon, Clock, PaperclipDecl, XDecl, Trash2Decl, SendDecl, StopCircleDecl, EditDecl, LightbulbDecl, GlobeDecl, BotDecl, BrainDecl } from '@/lib/icons';
import { getGroupedModels, GroupedModels, Model, FALLBACK_MODELS } from '@/services/modelService';
import { chatService, Conversation as DbConversation, ChatMessage as DbChatMessage } from '@/services/chatService';
import { chatComplete } from '@/services/aiService';
import XenoBrowser, { XenoBrowserRef } from '../Browser/XenoBrowser';
import { useChatTheme } from './chatTheme';

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
  if (modelId.startsWith('deepseek/')) return 'DeepSeek';
  if (modelId.startsWith('qwen/')) return 'Alibaba';
  if (modelId.startsWith('x-ai/')) return 'xAI';
  return 'Other';
};

// Calculate relevance score based on query match in title and snippet
const calculateRelevanceScore = (query: string, title: string, snippet: string): number => {
  const queryLower = query.toLowerCase();
  const titleLower = (title || '').toLowerCase();
  const snippetLower = (snippet || '').toLowerCase();

  // Extract query terms (remove common stop words)
  const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'it', 'its']);
  const queryTerms = queryLower.split(/\s+/).filter(term => term.length > 1 && !stopWords.has(term));

  if (queryTerms.length === 0) return 0.5; // Default score if no meaningful terms

  let score = 0;
  let maxScore = 0;

  // Check for exact phrase match (highest weight)
  if (titleLower.includes(queryLower)) {
    score += 40;
  }
  if (snippetLower.includes(queryLower)) {
    score += 20;
  }
  maxScore += 60;

  // Check individual term matches
  for (const term of queryTerms) {
    // Title matches (higher weight)
    if (titleLower.includes(term)) {
      score += 15;
      // Bonus if term appears at the start of title
      if (titleLower.startsWith(term) || titleLower.includes(' ' + term)) {
        score += 5;
      }
    }
    maxScore += 20;

    // Snippet matches
    if (snippetLower.includes(term)) {
      score += 8;
      // Count occurrences (more = more relevant, but diminishing returns)
      const occurrences = (snippetLower.match(new RegExp(term, 'g')) || []).length;
      score += Math.min(occurrences - 1, 3) * 2; // Up to 6 bonus points for multiple occurrences
    }
    maxScore += 14;
  }

  // Normalize to 0-1 range
  const normalizedScore = Math.min(score / maxScore, 1);

  // Apply a curve to spread out scores more naturally (avoid clustering at extremes)
  // This maps scores to roughly 0.4 - 0.98 range for most results
  return 0.4 + (normalizedScore * 0.58);
};

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  relevance_score?: number;
  domain?: string;
  favicon?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  searchResults?: SearchResult[];
  isSearching?: boolean;
  pageContext?: string;
}

interface PageContent {
  url: string;
  title: string;
  content: string;
  headings: { level: string; text: string }[];
  links: { text: string; href: string }[];
}

interface BrowserAction {
  type: 'click' | 'type' | 'scroll' | 'navigate' | 'screenshot' | 'wait' | 'extract';
  selector?: string;
  text?: string;
  url?: string;
  direction?: 'up' | 'down';
  amount?: number;
}

interface AgentStep {
  thought: string;
  action?: BrowserAction;
  result?: string;
  url?: string; // Track which URL this step was taken on
}

// Helper to get domain from URL
const getDomain = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

interface SearchConversation {
  id: string;
  title: string;
  timestamp: number;
  messages: ChatMessage[];
  searchEngine: SearchEngine;
}

type SearchMode = 'web' | 'agent';
type SearchEngine = 'xeno' | 'google' | 'brave';

const DEFAULT_MODEL: Model = {
  id: "anthropic/claude-sonnet-4",
  name: "Claude Sonnet 4",
  maxTokens: 200000,
  inputModalities: ['text', 'image', 'file'],
  outputModalities: ['text']
};

const SearchChatInterface: React.FC = () => {
  // Whatever the user set on the chat's brightness slider. Read-only here — this surface has no
  // switcher of its own, it just wears the answer. Both halves are needed: the class is the base
  // palette, the style is the exact stop when that stop has no name.
  const { themeClass, themeStyle } = useChatTheme();

  // State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Split panel animation state
  const [showResultsPanel, setShowResultsPanel] = useState(false);
  const [visibleResults, setVisibleResults] = useState<number>(0);
  const [currentQuery, setCurrentQuery] = useState('');

  // Mode state
  const [searchMode, setSearchMode] = useState<SearchMode>('web');

  // Search engine state
  const [searchEngine, setSearchEngine] = useState<SearchEngine>('xeno');

  // Model state
  const [selectedModel, setSelectedModel] = useState<Model>(DEFAULT_MODEL);
  const [groupedModels, setGroupedModels] = useState<GroupedModels[]>([]);
  const [isModelsLoading, setIsModelsLoading] = useState(true);
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [isModelSelectorButtonHovered, setIsModelSelectorButtonHovered] = useState(false);

  // Browser state
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('');
  const [currentPageContent, setCurrentPageContent] = useState<PageContent | null>(null);
  const [isLoadingPageContent, setIsLoadingPageContent] = useState(false);

  // History state
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<SearchConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historySearchQuery, setHistorySearchQuery] = useState('');

  // Agent state
  const [agentBrowserUrl, setAgentBrowserUrl] = useState<string>('');
  const [agentScreenshot, setAgentScreenshot] = useState<string | null>(null);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [isAgentWorking, setIsAgentWorking] = useState(false);
  const [agentCursor, setAgentCursor] = useState<{ x: number; y: number; action: string } | null>(null);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const companyDropdownButtonRef = useRef<HTMLButtonElement>(null);
  const xenoBrowserRef = useRef<XenoBrowserRef>(null);
  const companyListContainerRef = useRef<HTMLDivElement>(null);
  /* The model dropdown was a plain div with a click-outside ref: every row its own Tab stop,
     arrows dead, Escape ignored. useMenu gives it the behaviour and useGooPill the travelling
     highlight, both measuring the ref the click-outside handler already holds. */
  const companyMenuGoo = useGooPill<HTMLDivElement>({ hostRef: companyListContainerRef });
  const companyMenuKbd = useMenu<HTMLDivElement>({
    open: isCompanyDropdownOpen,
    onClose: () => { setIsCompanyDropdownOpen(false); },
    menuRef: companyListContainerRef,
  });

  // Load models on mount
  useEffect(() => {
    const loadModels = async () => {
      try {
        setIsModelsLoading(true);
        const models = await getGroupedModels();
        if (models && models.length > 0) {
          setGroupedModels(models);
          for (const group of models) {
            const found = group.models.find(m => m.id === DEFAULT_MODEL.id);
            if (found) {
              setSelectedModel(found);
              break;
            }
          }
        } else {
          setGroupedModels(FALLBACK_MODELS);
        }
      } catch (error) {
        console.error('Failed to load models:', error);
        setGroupedModels(FALLBACK_MODELS);
      } finally {
        setIsModelsLoading(false);
      }
    };
    loadModels();
  }, []);

  // Load conversation history from database
  const loadConversationHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const { conversations } = await chatService.getConversations({
        interface_id: 'search',
        limit: 50
      });

      // Convert database format to local format
      const searchConversations: SearchConversation[] = conversations.map(conv => ({
        id: conv.id,
        title: conv.title || 'New Search',
        timestamp: conv.updated_at ? new Date(conv.updated_at).getTime() : Date.now(),
        messages: (conv.messages || []).map(msg => ({
          id: msg.id || `msg-${Date.now()}`,
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
          timestamp: msg.created_at ? new Date(msg.created_at).getTime() : Date.now(),
          searchResults: msg.search_context as SearchResult[] | undefined
        })),
        searchEngine: (conv.system_prompt?.includes('google') ? 'google' :
                      conv.system_prompt?.includes('brave') ? 'brave' : 'xeno') as SearchEngine
      }));

      setConversationHistory(searchConversations);
    } catch (error) {
      console.error('Failed to load search history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadConversationHistory();
  }, [loadConversationHistory]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
    }
  }, [inputValue]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* Escape closes it, which is the one thing `useMenu` deliberately does not do: the hook owns the
     arrows, Home/End and Tab, and leaves dismissal to whoever owns the open state. Every other menu in
     this chat pairs its click-outside effect with exactly this listener. */
  useEffect(() => {
    if (!isCompanyDropdownOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsCompanyDropdownOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isCompanyDropdownOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        companyListContainerRef.current &&
        !companyListContainerRef.current.contains(e.target as Node) &&
        companyDropdownButtonRef.current &&
        !companyDropdownButtonRef.current.contains(e.target as Node)
      ) {
        setIsCompanyDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch page content when browser URL changes
  useEffect(() => {
    if (browserUrl && isBrowserOpen) {
      fetchPageContent(browserUrl);
    }
  }, [browserUrl, isBrowserOpen]);

  // Animate results appearing one by one
  useEffect(() => {
    if (showResultsPanel && searchResults.length > 0 && visibleResults < searchResults.length) {
      const timer = setTimeout(() => {
        setVisibleResults(prev => prev + 1);
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [showResultsPanel, searchResults.length, visibleResults]);

  const fetchPageContent = async (url: string) => {
    setIsLoadingPageContent(true);
    try {
      const response = await fetch(`/api/browser/content?url=${encodeURIComponent(url)}`);
      if (response.ok) {
        const data = await response.json();
        setCurrentPageContent(data);
      }
    } catch (error) {
      console.error('Failed to fetch page content:', error);
    } finally {
      setIsLoadingPageContent(false);
    }
  };

  // Agent browser automation functions
  const executeBrowserAction = async (url: string, actions: BrowserAction[]): Promise<{
    success: boolean;
    screenshot?: string;
    content?: string;
    title?: string;
    error?: string;
    cursor?: { x: number; y: number };
    results?: any[];
  }> => {
    try {
      const response = await fetch('/api/browser/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          actions: actions.map(a => ({
            type: a.type,
            selector: a.selector,
            text: a.text,
            direction: a.direction,
            amount: a.amount,
            time: a.type === 'wait' ? 2000 : undefined
          })),
          screenshot: true
        })
      });

      if (!response.ok) throw new Error('Browser action failed');
      const data = await response.json();

      // Extract cursor position from results
      if (data.results && data.results.length > 0) {
        const lastResult = data.results[data.results.length - 1];
        if (lastResult.cursor) {
          data.cursor = lastResult.cursor;
        }
      }

      return data;
    } catch (error: any) {
      console.error('Browser action error:', error);
      return { success: false, error: error.message };
    }
  };

  const renderAndExtract = async (url: string): Promise<{
    success: boolean;
    content?: string;
    title?: string;
    screenshot?: string;
    error?: string;
  }> => {
    try {
      // First render the page
      const renderResponse = await fetch('/api/browser/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, waitFor: 'networkidle0' })
      });

      if (!renderResponse.ok) throw new Error('Failed to render page');
      const renderData = await renderResponse.json();

      // Take a screenshot
      const screenshotResponse = await fetch('/api/browser/screenshot-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, width: 1280, height: 800 })
      });

      let screenshot = null;
      if (screenshotResponse.ok) {
        const screenshotData = await screenshotResponse.json();
        screenshot = screenshotData.screenshot;
      }

      return {
        success: true,
        content: renderData.textContent,
        title: renderData.title,
        screenshot
      };
    } catch (error: any) {
      console.error('Render error:', error);
      return { success: false, error: error.message };
    }
  };

  const getAgentSystemPrompt = (currentUrl?: string, pageContent?: string) => {
    return `You are an AI agent with full browser control capabilities. You can browse the web, interact with pages, and extract information.

CAPABILITIES:
- Navigate to any URL
- Click on buttons, links, and elements
- Type text into input fields
- Scroll up/down on pages
- Extract text content from pages
- Submit forms

CURRENT STATE:
${currentUrl ? `Current URL: ${currentUrl}` : 'No page loaded yet'}
${pageContent ? `\nPage Content (truncated):\n${pageContent.substring(0, 3000)}...` : ''}

RESPONSE FORMAT:
When you need to perform browser actions, respond with a JSON block like this:
\`\`\`action
{
  "thought": "I need to navigate to the website first",
  "action": {
    "type": "navigate",
    "url": "https://example.com"
  }
}
\`\`\`

Available action types:
- navigate: Go to a URL. Example: {"type": "navigate", "url": "https://example.com"}
- click: Click a button/link by its text. Example: {"type": "click", "selector": "Shop"} or {"type": "click", "selector": "Sign In"}
- type: Type text into an input. Example: {"type": "type", "selector": "search", "text": "my search query"}
- scroll: Scroll the page. Example: {"type": "scroll", "direction": "down"} or {"type": "scroll", "direction": "up"}
- submit: Submit a form (press Enter). Example: {"type": "submit"}
- wait: Wait for page to load. Example: {"type": "wait"}
- extract: Get page content. Example: {"type": "extract"}

CLICKING ELEMENTS:
- For the "selector" field, use the EXACT visible text of the button or link you want to click
- Example: To click a button labeled "Shop", use: {"type": "click", "selector": "Shop"}
- Example: To click "Accept All", use: {"type": "click", "selector": "Accept All"}
- The text matching is case-insensitive and partial matches work too

TYPING AND SEARCHING:
- To search on Google: first type your query, then submit
- Example: {"type": "type", "selector": "search", "text": "AI news"} then {"type": "submit"}

When you have gathered enough information or completed the task, respond normally without an action block and provide your findings to the user.

IMPORTANT:
- Always explain your reasoning in the "thought" field
- Use the exact button/link text you see on the page
- If clicking doesn't work, try scrolling to find the element
- If you encounter errors, try alternative approaches
- PREFER ACTIONS OVER SUMMARIES: When the user asks you to do something, always try to perform a browser action first. Even if you're already on a page, look for elements to interact with.
- If asked to "go to" a page section (like "News", "Hardware", etc.), click on that navigation link even if you think you might already be there.
- Show visual progress by performing scroll, click, or navigate actions rather than just describing what you see.
- Only respond without an action block when you've truly completed the user's task or when explicitly asked for information.`;
  };

  const parseAgentAction = (response: string): { thought: string; action?: BrowserAction } | null => {
    const actionMatch = response.match(/```action\s*\n?([\s\S]*?)\n?```/);
    if (actionMatch) {
      try {
        const parsed = JSON.parse(actionMatch[1]);
        return {
          thought: parsed.thought || '',
          action: parsed.action
        };
      } catch (e) {
        console.error('Failed to parse agent action:', e);
        return null;
      }
    }
    return null;
  };

  const performSearch = async (query: string): Promise<SearchResult[]> => {
    // Use different endpoints based on search engine
    let endpoint = '/api/v2/engine/dynamic-search';
    let body: any = { query, max_pages: 10, index_results: true };

    if (searchEngine === 'google') {
      endpoint = '/api/v2/engine/google-search';
      body = { query, num_results: 10 };
    } else if (searchEngine === 'brave') {
      endpoint = '/api/v2/engine/brave-search';
      body = { query, count: 10 };
    }

    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('xenoos_auth_token') : null;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.detail || data?.error || `Search failed (${response.status})`;
      throw new Error(typeof detail === 'string' ? detail : `Search failed (${response.status})`);
    }

    return data.results?.map((r: any) => {
      const title = r.title || 'Untitled';
      const snippet = r.snippet || r.description || '';
      return {
        url: r.url,
        title,
        snippet,
        relevance_score: calculateRelevanceScore(query, title, snippet),
        domain: new URL(r.url).hostname,
        favicon: `https://www.google.com/s2/favicons?domain=${new URL(r.url).hostname}&sz=32`
      };
    }).sort((a: SearchResult, b: SearchResult) => (b.relevance_score || 0) - (a.relevance_score || 0)) || [];
  };

  const callAI = async (userMessage: string, context?: string): Promise<string> => {
    try {
      const systemPrompt = context
        ? `You are a helpful AI assistant. The user is viewing a webpage. Here is the content of the page they're looking at:\n\n${context}\n\nHelp them understand and interact with this content.`
        : `You are a helpful AI assistant that can search the web and help users find information. When users ask questions, provide helpful, accurate responses.`;

      const data = await chatComplete({
        model: selectedModel.id,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role,
            content: m.content
          })),
          { role: 'user', content: userMessage }
        ]
      });
      return data.content || 'Sorry, I could not generate a response.';
    } catch (error) {
      console.error('AI error:', error);
      return 'Sorry, there was an error connecting to the AI. Please try again.';
    }
  };

  const saveConversation = async (newMessages: ChatMessage[], searchResultsContext?: SearchResult[]) => {
    if (newMessages.length === 0) return;

    const firstUserMessage = newMessages.find(m => m.role === 'user');
    const title = firstUserMessage?.content.slice(0, 50) || 'New Search';
    const lastMessage = newMessages[newMessages.length - 1];

    try {
      if (activeConversationId) {
        // Add the latest message to existing conversation
        await chatService.addMessage(activeConversationId, {
          role: lastMessage.role,
          content: lastMessage.content,
          model_id: selectedModel.id,
          search_context: searchResultsContext
        });

        // Update local state
        setConversationHistory(prev =>
          prev.map(conv =>
            conv.id === activeConversationId
              ? { ...conv, messages: newMessages, timestamp: Date.now() }
              : conv
          )
        );
      } else {
        // Create new conversation in database
        const newConv = await chatService.createConversation({
          title,
          model_id: selectedModel.id,
          system_prompt: `search_engine:${searchEngine}`,
          interface_id: 'search'
        });

        if (newConv) {
          // Add all messages to the new conversation
          for (const msg of newMessages) {
            await chatService.addMessage(newConv.id, {
              role: msg.role,
              content: msg.content,
              model_id: selectedModel.id,
              search_context: msg.searchResults
            });
          }

          const newSearchConversation: SearchConversation = {
            id: newConv.id,
            title,
            timestamp: Date.now(),
            messages: newMessages,
            searchEngine
          };
          setConversationHistory(prev => [newSearchConversation, ...prev]);
          setActiveConversationId(newConv.id);
        }
      }
    } catch (error) {
      console.error('Failed to save conversation:', error);
    }
  };

  const handleSubmit = async () => {
    if (!inputValue.trim()) return;

    const userInput = inputValue.trim();
    setInputValue('');
    setCurrentQuery(userInput);

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: userInput,
      timestamp: Date.now()
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);

    const isPageQuestion = isBrowserOpen && currentPageContent && (
      userInput.toLowerCase().includes('this page') ||
      userInput.toLowerCase().includes('what is') ||
      userInput.toLowerCase().includes('summarize') ||
      userInput.toLowerCase().includes('explain') ||
      userInput.toLowerCase().includes('tell me about')
    );

    if (isPageQuestion && currentPageContent) {
      setIsLoading(true);
      const context = `Page Title: ${currentPageContent.title}\nURL: ${currentPageContent.url}\n\nContent:\n${currentPageContent.content}\n\nHeadings:\n${currentPageContent.headings.map(h => `${h.level}: ${h.text}`).join('\n')}`;
      const aiResponse = await callAI(userInput, context);

      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: aiResponse,
        timestamp: Date.now(),
        pageContext: currentPageContent.url
      };
      const finalMessages = [...newMessages, assistantMessage];
      setMessages(finalMessages);
      await saveConversation(finalMessages);
      setIsLoading(false);
    } else if (searchMode === 'web') {
      setIsSearching(true);
      setSearchError('');
      setVisibleResults(0);
      setShowResultsPanel(true);

      let results: SearchResult[] = [];
      let searchFailure = '';
      try {
        results = await performSearch(userInput);
      } catch (error) {
        console.error('Search error:', error);
        searchFailure = error instanceof Error ? error.message : 'Search failed. Please try again.';
        setSearchError(searchFailure);
      }
      setSearchResults(results);
      setIsSearching(false);

      if (results.length > 0) {
        setIsLoading(true);

        const searchContext = results.slice(0, 5).map((r, i) =>
          `[${i + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`
        ).join('\n\n');

        const searchSystemPrompt = `You are a helpful AI assistant that answers questions based on web search results.
The user asked: "${userInput}"

Here are the top search results:

${searchContext}

Based on these search results, provide a helpful, accurate, and concise answer to the user's question.
- Synthesize information from multiple sources when relevant
- Be direct and informative
- If the search results don't contain enough information, say so
- Don't mention "search results" or "sources" - just answer naturally`;

        try {
          const data = await chatComplete({
            model: selectedModel.id,
            messages: [
              { role: 'system', content: searchSystemPrompt },
              { role: 'user', content: userInput }
            ]
          });
          const aiResponse = data.content || 'I found some results but couldn\'t generate a summary.';

          const assistantMessage: ChatMessage = {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: aiResponse,
            timestamp: Date.now(),
            searchResults: results
          };
          const finalMessages = [...newMessages, assistantMessage];
          setMessages(finalMessages);
          await saveConversation(finalMessages, results);
        } catch (error) {
          console.error('AI synthesis error:', error);
          const assistantMessage: ChatMessage = {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: `Found ${results.length} results. Click on any result to learn more.`,
            timestamp: Date.now(),
            searchResults: results
          };
          const finalMessages = [...newMessages, assistantMessage];
          setMessages(finalMessages);
          await saveConversation(finalMessages, results);
        }
        setIsLoading(false);
      } else {
        const assistantMessage: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: searchFailure
            ? `Search failed: ${searchFailure}`
            : `No results found for "${userInput}". Try a different search term.`,
          timestamp: Date.now()
        };
        const finalMessages = [...newMessages, assistantMessage];
        setMessages(finalMessages);
        await saveConversation(finalMessages);
      }
    } else if (searchMode === 'agent') {
      // Agent mode - full browser automation
      setIsAgentWorking(true);
      setIsLoading(true);
      setAgentSteps([]);
      setAgentCursor(null);

      // Open browser panel if not already open
      if (!isBrowserOpen) {
        setIsBrowserOpen(true);
      }

      // Use existing browser URL if open, otherwise use agent browser URL
      let currentUrl = isBrowserOpen ? browserUrl : agentBrowserUrl;
      let currentContent = currentPageContent?.content || '';
      let iterations = 0;
      const maxIterations = 10; // Prevent infinite loops
      let finalResponse = '';
      let lastAction = '';
      let consecutiveFailures = 0;

      try {
        while (iterations < maxIterations) {
          iterations++;

          // ALWAYS get fresh page content from the browser at the start of each iteration
          // This ensures the agent sees what the user sees, not stale cached content
          if (xenoBrowserRef.current) {
            try {
              console.log('[Agent] Fetching fresh content from browser...');
              const extractResult = await xenoBrowserRef.current.sendAgentCommand('extract', {});
              if (extractResult.success && extractResult.content) {
                currentContent = extractResult.content;
                currentUrl = extractResult.url || currentUrl;
                console.log('[Agent] Fresh content received:', currentContent.substring(0, 300));
              } else {
                console.log('[Agent] Extract failed:', extractResult);
              }
            } catch (e) {
              console.log('[Agent] Could not get fresh content:', e);
            }
          } else {
            console.log('[Agent] Warning: xenoBrowserRef not available');
          }

          // Call AI with agent system prompt
          const systemPrompt = getAgentSystemPrompt(currentUrl, currentContent);

          // Only include steps from the current domain to avoid context confusion
          const currentDomain = getDomain(currentUrl);
          const relevantSteps = agentSteps.filter(step => {
            if (!step.url) return true; // Include steps without URL tracking
            const stepDomain = getDomain(step.url);
            return stepDomain === currentDomain;
          });

          // Limit to last 5 relevant steps to keep context focused
          const recentSteps = relevantSteps.slice(-5);

          const data = await chatComplete({
            model: selectedModel.id,
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages.filter(m => m.role !== 'system').map(m => ({
                role: m.role,
                content: m.content
              })),
              { role: 'user', content: userInput },
              ...recentSteps.map(step => ({
                role: 'assistant' as const,
                content: `[On ${step.url || 'unknown page'}]\n${step.thought}${step.result ? `\n\nResult: ${step.result}` : ''}`
              }))
            ]
          });
          const aiResponse = data.content || '';

          // Check if AI wants to perform an action
          const actionParsed = parseAgentAction(aiResponse);

          if (actionParsed && actionParsed.action) {
            const action = actionParsed.action;
            let result = '';

            // Add step to UI with current URL for context tracking
            const newStep: AgentStep = {
              thought: actionParsed.thought,
              action: action,
              url: currentUrl
            };

            setAgentSteps(prev => [...prev, newStep]);

            // Execute the action
            if (action.type === 'navigate' && action.url) {
              // Check if navigating to a different domain - clear old steps to avoid confusion
              const oldDomain = getDomain(currentUrl);
              const newDomain = getDomain(action.url);
              if (oldDomain !== newDomain) {
                console.log(`[Agent] Domain change: ${oldDomain} → ${newDomain}, clearing old steps`);
                setAgentSteps([newStep]); // Keep only the navigate step
              }

              const renderResult = await renderAndExtract(action.url);
              if (renderResult.success) {
                currentUrl = action.url;
                setAgentBrowserUrl(action.url);
                // Also open in XenoBrowser for unified view
                setBrowserUrl(action.url);
                setIsBrowserOpen(true);
                currentContent = renderResult.content || '';
                if (renderResult.screenshot) {
                  setAgentScreenshot(renderResult.screenshot);
                }
                result = `Successfully navigated to ${action.url}. Page title: ${renderResult.title}`;
              } else {
                result = `Failed to navigate: ${renderResult.error}`;
              }
            } else if (action.type === 'click' || action.type === 'type' || action.type === 'scroll' || action.type === 'submit') {
              // Use XenoBrowser to execute action directly in the visible browser
              if (xenoBrowserRef.current) {
                try {
                  console.log('[Agent] Executing action:', action.type, action.selector || action.text || action.direction);

                  const actionKey = `${action.type}-${action.selector || action.text || action.direction || ''}`;

                  // For click/type actions, first LOCATE the element to get its position
                  // Then animate cursor TO the element BEFORE clicking
                  if ((action.type === 'click' || action.type === 'type') && action.selector) {
                    // Step 1: Locate element to get position (without performing action)
                    const locateResult = await xenoBrowserRef.current.sendAgentCommand('locate', {
                      selector: action.selector
                    });

                    if (locateResult.success && locateResult.cursor) {
                      // Get iframe offset to convert iframe coordinates to container coordinates
                      const iframeOffset = xenoBrowserRef.current.getIframeOffset();
                      const targetX = locateResult.cursor.x + iframeOffset.x;
                      const targetY = locateResult.cursor.y + iframeOffset.y;

                      // Step 2: Show cursor moving from current position to target
                      // Start at center of iframe area if no previous position
                      const startPos = agentCursor || { x: 400, y: iframeOffset.y + 200 };
                      setAgentCursor({ x: startPos.x, y: startPos.y, action: 'moving' });
                      await new Promise(r => setTimeout(r, 100));

                      // Step 3: Animate cursor to target position
                      setAgentCursor({ x: targetX, y: targetY, action: 'moving' });
                      await new Promise(r => setTimeout(r, 400)); // Wait for CSS transition (400ms)

                      // Step 4: Show action indicator (click ripple or typing)
                      setAgentCursor({ x: targetX, y: targetY, action: action.type });
                      await new Promise(r => setTimeout(r, 200)); // Brief pause before action
                    }
                  } else if (action.type === 'scroll') {
                    // For scroll, show cursor at center of iframe area
                    const iframeOffset = xenoBrowserRef.current.getIframeOffset();
                    setAgentCursor({ x: 400, y: iframeOffset.y + 200, action: 'scroll' });
                    await new Promise(r => setTimeout(r, 200));
                  }

                  // Step 5: Execute the actual action
                  const cmdResult = await xenoBrowserRef.current.sendAgentCommand(action.type, {
                    selector: action.selector,
                    text: action.text,
                    direction: action.direction,
                    amount: action.amount || 400,
                    x: action.x,
                    y: action.y
                  });

                  console.log('[Agent] Command result:', cmdResult);

                  if (cmdResult.success) {
                    // Keep cursor at action position with success indicator
                    if (cmdResult.cursor) {
                      const iframeOffset = xenoBrowserRef.current.getIframeOffset();
                      setAgentCursor({
                        x: cmdResult.cursor.x + iframeOffset.x,
                        y: cmdResult.cursor.y + iframeOffset.y,
                        action: action.type
                      });
                    }
                    result = `Action completed: ${cmdResult.message || action.type}`;
                    consecutiveFailures = 0;

                    // Wait a bit for page to update after action
                    await new Promise(r => setTimeout(r, 600));
                  } else {
                    result = `Action failed: ${cmdResult.message || 'Unknown error'}`;

                    // Track consecutive failures for same action
                    if (actionKey === lastAction) {
                      consecutiveFailures++;
                      if (consecutiveFailures >= 2) {
                        result += '. Stopping - same action failed multiple times. The element may not exist on the current page.';
                        // Force AI to reassess by breaking the action loop
                        finalResponse = `I tried to ${action.type} "${action.selector || ''}" multiple times but it failed. The page may have changed or the element doesn't exist. Let me reassess the current page.`;
                        break;
                      }
                    }
                  }
                  lastAction = actionKey;
                } catch (err: any) {
                  console.error('[Agent] Action error:', err);
                  result = `Action failed: ${err.message}`;
                  consecutiveFailures++;
                }
              } else {
                result = 'Browser not available. Please open a page first.';
              }
            } else if (action.type === 'extract') {
              // Use XenoBrowser to extract content
              if (xenoBrowserRef.current) {
                try {
                  const extractResult = await xenoBrowserRef.current.sendAgentCommand('extract', {});
                  if (extractResult.success) {
                    currentContent = extractResult.content || '';
                    result = `Extracted content (${currentContent.length} chars): ${currentContent.substring(0, 500)}...`;
                  } else {
                    result = `Extraction failed: ${extractResult.message}`;
                  }
                } catch (err: any) {
                  result = `Extraction failed: ${err.message}`;
                }
              } else {
                result = 'Browser not available. Please open a page first.';
              }
            } else if (action.type === 'wait') {
              await new Promise(r => setTimeout(r, 2000));
              result = 'Waited 2 seconds';
            }

            // Update the step with result
            setAgentSteps(prev => {
              const updated = [...prev];
              updated[updated.length - 1].result = result;
              return updated;
            });

          } else {
            // No action - AI has finished and is providing final response
            finalResponse = aiResponse;
            break;
          }
        }

        // If we hit max iterations, use last response
        if (!finalResponse && iterations >= maxIterations) {
          finalResponse = 'I reached the maximum number of steps. Here\'s what I found so far based on my research.';
        }

        const assistantMessage: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: finalResponse,
          timestamp: Date.now()
        };
        const finalMessages = [...newMessages, assistantMessage];
        setMessages(finalMessages);
        await saveConversation(finalMessages);

      } catch (error) {
        console.error('Agent error:', error);
        const errorMessage: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: 'Sorry, I encountered an error while browsing. Please try again.',
          timestamp: Date.now()
        };
        setMessages([...newMessages, errorMessage]);
      } finally {
        setIsAgentWorking(false);
        setIsLoading(false);
        setAgentCursor(null);
      }
    } else {
      // Basic chat mode (fallback)
      setIsLoading(true);
      const aiResponse = await callAI(userInput);

      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: aiResponse,
        timestamp: Date.now()
      };
      const finalMessages = [...newMessages, assistantMessage];
      setMessages(finalMessages);
      await saveConversation(finalMessages);
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const openInBrowser = (url: string) => {
    setBrowserUrl(url);
    setIsBrowserOpen(true);
  };

  const handleModelSelect = (model: Model) => {
    setSelectedModel(model);
    setIsCompanyDropdownOpen(false);
    setExpandedCompanies(new Set());
  };

  const handleNewChat = () => {
    setMessages([]);
    setSearchResults([]);
    setShowResultsPanel(false);
    setVisibleResults(0);
    setIsBrowserOpen(false);
    setCurrentPageContent(null);
    setActiveConversationId(null);
    // Clear agent state
    setAgentScreenshot(null);
    setAgentBrowserUrl('');
    setAgentSteps([]);
    setIsAgentWorking(false);
  };

  const loadConversation = async (conversation: SearchConversation) => {
    try {
      // The list endpoint intentionally returns conversation metadata only. Fetch
      // the detail before opening history so a hard reload cannot produce an
      // apparently clickable conversation with an empty message pane.
      const detail = await chatService.getConversation(conversation.id);
      if (!detail) throw new Error('Conversation could not be loaded.');

      const loadedMessages: ChatMessage[] = (detail.messages || []).map(msg => ({
        id: msg.id || `msg-${Date.now()}`,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        timestamp: msg.created_at ? new Date(msg.created_at).getTime() : Date.now(),
        searchResults: msg.search_context as SearchResult[] | undefined
      }));
      const lastResultMessage = [...loadedMessages].reverse().find(msg => msg.searchResults?.length);
      const lastUserMessage = [...loadedMessages].reverse().find(msg => msg.role === 'user');
      const restoredEngine = (detail.system_prompt?.includes('google') ? 'google' :
        detail.system_prompt?.includes('brave') ? 'brave' : conversation.searchEngine) as SearchEngine;
      const restoredModel = groupedModels.flatMap(group => group.models).find(model => model.id === detail.model_id);

      setMessages(loadedMessages);
      setActiveConversationId(conversation.id);
      setSearchEngine(restoredEngine);
      if (restoredModel) setSelectedModel(restoredModel);
      setSearchResults(lastResultMessage?.searchResults || []);
      setVisibleResults(lastResultMessage?.searchResults?.length || 0);
      setShowResultsPanel(Boolean(lastResultMessage?.searchResults?.length));
      setCurrentQuery(lastUserMessage?.content || conversation.title);
      setSearchError('');
      setIsHistoryOpen(false);
    } catch (error) {
      console.error('Failed to load search conversation:', error);
      setSearchError(error instanceof Error ? error.message : 'Conversation could not be loaded.');
    }
  };

  const deleteConversation = async (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await chatService.deleteConversation(conversationId, true);
      setConversationHistory(prev => prev.filter(c => c.id !== conversationId));
      if (activeConversationId === conversationId) {
        handleNewChat();
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const closeResultsPanel = () => {
    setShowResultsPanel(false);
    setSearchResults([]);
    setVisibleResults(0);
  };

  const getDomain = (url: string): string => {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return url;
    }
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Feature cards data
  const webSearchFeatures = [
    { icon: Zap, title: 'Fast Results', subtitle: 'Instant search' },
    { icon: Link2, title: 'Source Links', subtitle: 'Direct links' },
    { icon: Sparkles, title: 'AI Synthesis', subtitle: 'Smart summaries' },
    { icon: ExternalLink, title: 'Built-in Browser', subtitle: 'Open & browse' },
  ];

  const agentSearchFeatures = [
    { icon: Navigation, title: 'Browser Control', subtitle: 'Navigate pages' },
    { icon: ScanEye, title: 'Visual Analysis', subtitle: 'Understand layouts' },
    { icon: Layers, title: 'Multi-Step', subtitle: 'Complex research' },
    { icon: FileOutput, title: 'Smart Extract', subtitle: 'Pull data' },
  ];

  const currentFeatures = searchMode === 'web' ? webSearchFeatures : agentSearchFeatures;

  // Engine icons
  const getEngineIcon = (engine: SearchEngine) => {
    switch (engine) {
      case 'xeno':
        return <Sparkles size={14} />;
      case 'google':
        return <Globe size={14} />;
      case 'brave':
        return <SearchIcon size={14} />;
    }
  };

  return (
    // `chat-themed` brings the --chat-* palette and hands it on to the library as --xeno-*. The
    // class picks the base palette and the style carries the exact brightness stop when the slider
    // is not parked on one of the three named ones. This route never mounts ChatWithLLM, so until
    // the palettes moved to a stylesheet of their own there was nothing here to inherit — which is
    // why every colour in this file used to be a literal.
    //
    // `xeno-icon-hosts` says every button and link in here hosts a glyph, so the icons animate on
    // hover without each control having to opt in. They were all already XENO glyphs; none of them
    // moved.
    <div
      className={`chat-themed xeno-icon-hosts ${themeClass} relative flex h-full text-[var(--chat-text)] overflow-hidden bg-[var(--chat-canvas)]`}
      style={themeStyle}
    >
      {/* History Sidebar */}
      <div
        className={`absolute left-0 top-0 bottom-0 z-30 bg-[var(--chat-canvas)] border-r border-[var(--chat-border)] transition-all duration-300 ease-in-out ${
          isHistoryOpen ? 'w-80 translate-x-0' : 'w-80 -translate-x-full'
        }`}
      >
        {/* History Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--chat-border)]">
          <h3 className="text-sm font-medium text-[var(--chat-text)]">Search History</h3>
          <IconButton
            icon={XDecl}
            variant="ghost"
            size="sm"
            iconSize={16}
            onClick={() => setIsHistoryOpen(false)}
            aria-label="Close search history"
          />
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-[var(--chat-border)]">
          <div className="relative">
            {/* Stays hand-written, and this is the cleanest instance of the fill problem in the
                chat: EVERYTHING else about it converts. `h-9` is exactly lg, `text-sm` is exactly
                lg's 14px, the magnifier's 14 is what `iconSize` is for, the border is
                `--chat-border` and the focus ring is already `--chat-muted` — the component's own
                pair. One declaration blocks it: the field is `--chat-surface` and `.xeno-input`
                hard-codes `background: var(--xeno-canvas)`, which would sink a raised bar to
                #0a0a0a. Third field to fail on this and nothing else. */}
            <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--chat-muted)]" />
            <input
              type="text"
              placeholder="Search history..."
              value={historySearchQuery}
              onChange={(e) => setHistorySearchQuery(e.target.value)}
              className="w-full bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-lg py-1.5 pl-9 pr-3 text-sm text-[var(--chat-text)] placeholder-[var(--chat-muted)] focus:outline-none focus:border-[var(--chat-muted)] transition-colors h-9"
            />
          </div>
        </div>

        {/* History List */}
        <div className="flex-1 overflow-y-auto p-2" style={{ height: 'calc(100% - 110px)' }}>
          {isLoadingHistory ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Spinner size={32} className="mb-3" />
              <p className="text-sm text-[var(--chat-muted)]">Loading history...</p>
            </div>
          ) : conversationHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Clock size={32} className="text-[var(--chat-muted)] mb-3" />
              <p className="text-sm text-[var(--chat-muted)]">No search history</p>
              <p className="text-xs text-[var(--chat-muted)] mt-1">Your searches will appear here</p>
            </div>
          ) : (
            <div className="space-y-1">
              {conversationHistory
                .filter(conv =>
                  !historySearchQuery ||
                  conv.title.toLowerCase().includes(historySearchQuery.toLowerCase())
                )
                .map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => loadConversation(conv)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      loadConversation(conv);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open search conversation: ${conv.title}`}
                  className={`group flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    activeConversationId === conv.id
                      ? 'bg-[var(--chat-control)]'
                      : 'hover:bg-[var(--chat-surface)]'
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--chat-muted)]`}
                >
                  <div className="flex-shrink-0 mt-0.5 text-[var(--chat-muted)]">
                    {getEngineIcon(conv.searchEngine)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--chat-text)] truncate">{conv.title}</p>
                    <p className="text-xs text-[var(--chat-muted)] mt-0.5">
                      {formatTimestamp(conv.timestamp)}
                    </p>
                  </div>
                  <IconButton
                    icon={Trash2Decl}
                    variant="ghost"
                    size="xs"
                    iconSize={14}
                    className="opacity-0"
                    onClick={(e) => deleteConversation(conv.id, e)}
                    aria-label="Delete conversation"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div
        className="flex flex-col transition-all duration-300 ease-in-out"
        style={{
          marginLeft: isHistoryOpen ? '320px' : '0px',
          // The history drawer is absolutely positioned, so its matching margin
          // must be subtracted from the main pane. A 100% pane plus a 320px
          // margin created horizontal overflow and scrolled the drawer itself
          // mostly outside the viewport after a hard reload.
          width: (showResultsPanel || isBrowserOpen)
            ? '45%'
            : isHistoryOpen
              ? 'calc(100% - 320px)'
              : '100%'
        }}
      >
        {/* Top Bar */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-[var(--chat-canvas)]">
          {/* Left side - History & New Chat */}
          <div className="flex items-center gap-2">
            {/* Border plus a fill is `secondary`, `h-9` is `lg`. The voice view's top bar is the
                same pair and converted the same way; the fill moves a step lighter with it, from
                `--chat-surface` to the one control fill the variants carry.
                Open used to brighten the BORDER. It is `data-selection` now, which the library
                answers in ink — the same sentence in the grammar the rest of this chat speaks.
                Both gain an `aria-label`: `IconButton` requires one, and a `title` is a tooltip, not
                a name. Neither of these had a name before. */}
            <IconButton
              icon={LightbulbDecl}
              variant="secondary"
              size="lg"
              iconSize={16}
              data-selection={isHistoryOpen ? 'on' : 'off'}
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              aria-label="Search history"
              title="Search History"
            />
            <IconButton
              icon={EditDecl}
              variant="secondary"
              size="lg"
              iconSize={16}
              onClick={handleNewChat}
              aria-label="New search"
              title="New Search"
            />
          </div>

          {/* Center - Engine Selector */}
          {/* Stays hand-written, and the component that wants these EXISTS. `<SegmentedControl>` is
              a single-select of connected options inside one bordered track, the chosen one floating
              on an inset `--xeno-control` fill and the rest transparent muted labels — which is this
              engine selector described exactly, container and all.
              ONE door is missing now. The glyph slot went in — `SegmentedOption` takes an `icon`,
              which is what let the composer's Web/Agent pair below convert — so what is left is the
              label, and it is the harder half. Here it is CONDITIONAL: it disappears when the
              results panel or the browser opens, leaving an icon-only segment. `label: string` is
              both the visible text and the accessible name, so hiding one hides the other, and
              passing `''` would leave three segments named only by their glyphs. That is a layout
              policy the component has no opinion about, and inventing one at a call site is how a
              component starts drifting. */}
          <div className="flex items-center bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-lg p-1">
            <button
              onClick={() => setSearchEngine('xeno')}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium transition-all ${
                searchEngine === 'xeno'
                  ? 'bg-[var(--chat-control)] text-[var(--chat-text)]'
                  : 'text-[var(--chat-muted)] hover:text-[var(--chat-text)]'
              }`}
              title="Xeno Search"
            >
              <Sparkles size={14} />
              {!(showResultsPanel || isBrowserOpen) && <span>Xeno</span>}
            </button>
            {/* Stays hand-written — the Xeno segment's twin, same two missing doors. */}
            <button
              onClick={() => setSearchEngine('google')}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium transition-all ${
                searchEngine === 'google'
                  ? 'bg-[var(--chat-control)] text-[var(--chat-text)]'
                  : 'text-[var(--chat-muted)] hover:text-[var(--chat-text)]'
              }`}
              title="Google Search"
            >
              <Globe size={14} />
              {!(showResultsPanel || isBrowserOpen) && <span>Google</span>}
            </button>
            {/* Stays hand-written — the Xeno segment's twin, same two missing doors. */}
            <button
              onClick={() => setSearchEngine('brave')}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium transition-all ${
                searchEngine === 'brave'
                  ? 'bg-[var(--chat-control)] text-[var(--chat-text)]'
                  : 'text-[var(--chat-muted)] hover:text-[var(--chat-text)]'
              }`}
              title="Brave Search"
            >
              <SearchIcon size={14} />
              {!(showResultsPanel || isBrowserOpen) && <span>Brave</span>}
            </button>
          </div>

          {/* Right side - Model Selector */}
          <div className="relative flex-shrink-0">
            {/* Border plus a fill is `secondary`, `h-9` is `lg`, and the two widths are layout that
                stays. `busy` is not the door here: it sets `cursor: progress` and nothing visible, so
                the spinner has to remain a child — `leadingIcon` takes a declaration and a spinner is
                a component that animates itself. Loading therefore drops the leading glyph and puts
                the spinner in its place, which is what the hand-written ternary did.
                The brain also stops being muted against the label and takes the button's ink, which
                is the component's rule: one control, one colour. */}
            <Button
              ref={companyDropdownButtonRef}
              variant="secondary"
              size="lg"
              iconSize={16}
              leadingIcon={isModelsLoading ? undefined : BrainDecl}
              className={(showResultsPanel || isBrowserOpen) ? 'w-[8rem]' : 'w-[10rem]'}
              onClick={() => setIsCompanyDropdownOpen(!isCompanyDropdownOpen)}
              onMouseEnter={() => setIsModelSelectorButtonHovered(true)}
              onMouseLeave={() => setIsModelSelectorButtonHovered(false)}
              aria-expanded={isCompanyDropdownOpen}
              aria-haspopup="dialog"
              aria-label={`Select model. Current model: ${selectedModel.name}`}
            >
              {isModelsLoading && <Spinner size={16} className="flex-shrink-0" />}
              <span className="truncate">{selectedModel.name}</span>
            </Button>

            {(isModelSelectorButtonHovered && !isCompanyDropdownOpen) && (
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 pointer-events-none">
                <ChevronDown size={16} className="text-[var(--chat-muted)]" />
              </div>
            )}

            {/* Model Dropdown */}
            <div
              {...(() => { const { ref: _g, className: _c, ...handlers } = companyMenuGoo.hostProps; return handlers; })()}
              {...companyMenuKbd.menuProps}
              className={`
                ${companyMenuGoo.hostProps.className} chat-goo
                absolute top-full mt-[10px] right-0 z-20
                transition-[opacity,transform] duration-200 ease-out origin-top-right
                ${isCompanyDropdownOpen ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible'}
                w-72 bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-lg shadow-xl
                max-h-[70vh] overflow-hidden flex flex-col
              `}
            >
              {/* First child, so the pill paints behind the rows rather than over them. */}
              {companyMenuGoo.pill}
              <div className="flex-1 overflow-y-auto">
                {groupedModels.map((group) => {
                  const isExpanded = expandedCompanies.has(group.companyName);
                  const isActiveCompany = getCompanyNameFromModelId(selectedModel.id) === group.companyName;
                  return (
                    <div key={group.companyName}>
                      {/* A DISCLOSURE, not a submenu: the models grow underneath this row rather
                          than opening a panel beside it, and `expanded` is the component's word for
                          that — the same chevron, quarter-turned, reporting `aria-expanded` instead
                          of promising a popup. It is also what keeps the dropdown alive, because
                          `useMenu` dismisses on any chosen row except one that reports it.
                          `selected` marks the company the current model belongs to, which is what
                          the brighter label said by hand. */}
                      <MenuItem
                        expanded={isExpanded}
                        selected={isActiveCompany}
                        onSelect={() => {
                          setExpandedCompanies((prev) =>
                            prev.has(group.companyName) ? new Set() : new Set([group.companyName]),
                          );
                        }}
                      >
                        {group.companyName}
                      </MenuItem>

                      <div className={`overflow-hidden transition-all duration-200 ${isExpanded ? 'max-h-[400px]' : 'max-h-0'}`}>
                        <div className="pb-1">
                          {/* `value` is the right-aligned token count in the UI face — deliberately
                              not `shortcut`, which sets mono and would make a number read as a key
                              to press. `selected` draws the check the hand-written row drew. */}
                          {group.models.map((model) => (
                            <MenuItem
                              key={model.id}
                              selected={selectedModel.id === model.id}
                              value={formatTokens(model.maxTokens)}
                              onSelect={() => handleModelSelect(model)}
                            >
                              {model.name}
                            </MenuItem>
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

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className={`mx-auto ${(showResultsPanel || isBrowserOpen) ? 'max-w-full' : 'max-w-3xl'}`}>
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full pt-16">
                {/* Mode Toggle Tabs */}
                <div className="flex items-center gap-2 mb-8">
                  {/* The composer's pair one screen down is the same choice, and it is a
                      `SegmentedControl` now — but these two are not connected, they sit apart with a
                      gap, so the track that makes a segmented control one thing does not apply.
                      `quiet` + `data-selection` instead. They lose `rounded-full` for the scale's
                      8px doing it; a stadium is not on the radius scale, which runs hair/xs/sm/md/
                      control/card and draws rounded squares throughout.
                      Legible because these sit on `--chat-canvas` (#0a0a0a), where a #262626 fill
                      reads — the elevated-surface collision in §9 does not reach here. */}
                  <Button
                    variant="quiet"
                    size="md"
                    leadingIcon={GlobeDecl}
                    data-selection={searchMode === 'web' ? 'on' : 'off'}
                    aria-pressed={searchMode === 'web'}
                    onClick={() => setSearchMode('web')}
                  >
                    Web Search
                  </Button>
                  <Button
                    variant="quiet"
                    size="md"
                    leadingIcon={BotDecl}
                    data-selection={searchMode === 'agent' ? 'on' : 'off'}
                    aria-pressed={searchMode === 'agent'}
                    onClick={() => setSearchMode('agent')}
                  >
                    Agent Search
                  </Button>
                </div>

                {/* Feature Card */}
                <div className="w-full max-w-xl bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-2xl p-6">
                  {/* Header */}
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-xl bg-[var(--chat-canvas)] border border-[var(--chat-border)] flex items-center justify-center">
                      {searchMode === 'web' ? (
                        <Globe size={24} className="text-[var(--chat-muted)]" />
                      ) : (
                        <Bot size={24} className="text-[var(--chat-muted)]" />
                      )}
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-[var(--chat-text)]">
                        {searchMode === 'web' ? 'Web Search' : 'Agent Search'}
                      </h2>
                      <p className="text-sm text-[var(--chat-muted)]">
                        {searchMode === 'web'
                          ? 'Search the web and open results in the built-in browser.'
                          : 'AI agent that browses and extracts information autonomously.'}
                      </p>
                    </div>
                  </div>

                  {/* Feature Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {currentFeatures.map((feature, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-3 p-3 bg-[var(--chat-canvas)] border border-[var(--chat-border)] rounded-xl"
                      >
                        <div className="w-9 h-9 rounded-lg bg-[var(--chat-surface)] border border-[var(--chat-border)] flex items-center justify-center flex-shrink-0">
                          <feature.icon size={16} className="text-[var(--chat-muted)]" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[var(--chat-text)]">{feature.title}</p>
                          <p className="text-xs text-[var(--chat-muted)]">{feature.subtitle}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 pt-4">
                {messages.map((message) => (
                  <div key={message.id}>
                    {message.role === 'user' ? (
                      <div className="flex justify-end">
                        <div className="max-w-[75%] bg-[var(--chat-control)] border border-[var(--chat-border)] text-[var(--chat-text)] rounded-2xl rounded-br-none p-3">
                          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-start">
                        <div className="max-w-[75%]">
                          <div className="bg-[var(--chat-surface)] text-[var(--chat-text)] rounded-2xl rounded-bl-none p-3 prose prose-sm prose-invert max-w-none prose-p:my-2 prose-li:my-0.5 prose-ol:pl-5 prose-ul:pl-5 prose-headings:text-[var(--chat-text)] prose-headings:font-medium prose-strong:text-[var(--chat-text)] prose-strong:font-semibold leading-relaxed">
                            <ReactMarkdown
                              components={{
                                p: ({ children }) => <p className="text-sm my-2">{children}</p>,
                                strong: ({ children }) => <strong className="font-semibold text-[var(--chat-text)]">{children}</strong>,
                                ul: ({ children }) => <ul className="list-disc pl-4 my-2 space-y-1">{children}</ul>,
                                ol: ({ children }) => <ol className="list-decimal pl-4 my-2 space-y-1">{children}</ol>,
                                li: ({ children }) => <li className="text-sm text-[var(--chat-text)]">{children}</li>,
                                h1: ({ children }) => <h1 className="text-lg font-semibold text-[var(--chat-text)] mt-4 mb-2">{children}</h1>,
                                h2: ({ children }) => <h2 className="text-base font-semibold text-[var(--chat-text)] mt-3 mb-2">{children}</h2>,
                                h3: ({ children }) => <h3 className="text-sm font-semibold text-[var(--chat-text)] mt-2 mb-1">{children}</h3>,
                                code: ({ children }) => <code className="bg-[var(--chat-control)] px-1.5 py-0.5 rounded text-xs text-[var(--chat-text)]">{children}</code>,
                                pre: ({ children }) => <pre className="bg-[var(--chat-control)] p-3 rounded-lg overflow-x-auto my-2">{children}</pre>,
                                a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--chat-accent)] underline decoration-[var(--chat-border)] underline-offset-2 transition-colors hover:decoration-[var(--chat-accent)]">{children}</a>,
                                blockquote: ({ children }) => <blockquote className="border-l-2 border-[var(--chat-border)] pl-3 my-2 text-[var(--chat-muted)] italic">{children}</blockquote>,
                              }}
                            >
                              {message.content}
                            </ReactMarkdown>
                            {message.pageContext && (
                              <p className="text-xs mt-2 text-[var(--chat-muted)] flex items-center gap-1">
                                <Eye size={12} /> Viewing: {getDomain(message.pageContext)}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {(isLoading || isSearching || isAgentWorking) && (
                  <div className="flex justify-start">
                    <div className="bg-[var(--chat-surface)] rounded-2xl rounded-bl-none p-3">
                      <div className="flex items-center gap-2 text-[var(--chat-muted)]">
                        <Spinner size={16} />
                        <span className="text-sm">
                          {isSearching ? 'Searching the web...' :
                           isAgentWorking ? `Agent working... (Step ${agentSteps.length + 1})` :
                           'Thinking...'}
                        </span>
                      </div>
                      {isAgentWorking && agentSteps.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-[var(--chat-border)]">
                          <p className="text-xs text-[var(--chat-muted)]">
                            Last action: {agentSteps[agentSteps.length - 1]?.action?.type || 'processing'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Page Content Indicator */}
        {isBrowserOpen && currentPageContent && (
          <div className="px-4 mb-2">
            <div className="max-w-full mx-auto px-3 py-2 bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-lg">
              <div className="flex items-center gap-2 text-xs text-[var(--chat-muted)]">
                <Eye size={12} className="text-green-500" />
                <span>AI can see: <span className="text-[var(--chat-text)]">{currentPageContent.title}</span></span>
                {isLoadingPageContent && <Spinner size={12} className="ml-auto" />}
              </div>
            </div>
          </div>
        )}

        {/* Search Results Info - Above Input (hidden when browser is open) */}
        {showResultsPanel && !isBrowserOpen && (
          <div className="flex-shrink-0 px-4 mb-2">
            <div className="max-w-full mx-auto text-center">
              <p className="text-sm text-[var(--chat-muted)]">
                {isSearching ? (
                  'Searching...'
                ) : searchResults.length > 0 ? (
                  <>
                    <span className="text-[var(--chat-text)] font-medium">Search Results</span>
                    <span className="text-[var(--chat-muted)]"> / </span>
                    <span>{searchResults.length} results for "{currentQuery}"</span>
                  </>
                ) : searchError ? (
                  `Search failed: ${searchError}`
                ) : (
                  'No results found'
                )}
              </p>
            </div>
          </div>
        )}

        {/* Input Container */}
        <div className="flex-shrink-0 px-4 pb-4">
          <div className={`mx-auto bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-2xl overflow-hidden shadow-lg ${
            (showResultsPanel || isBrowserOpen) ? 'max-w-full' : 'max-w-3xl'
          }`}>
            {/* Textarea Row */}
            <div className="flex items-end relative">
              {/* Stays hand-written — the second of the two composer fields §7 excludes by name, and
                  the marker it was missing. Same shape as the one in ChatWithLLM: a ref-driven
                  auto-grow capped at 150px, `resize-none`, `border-none`, and it is the top half of a
                  rounded card whose bottom half is the controls row. The card owns the box. */}
              <textarea
                ref={textareaRef}
                placeholder={searchMode === 'web' ? "Search the web with AI..." : "Ask the agent to research..."}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent text-[var(--chat-text)] placeholder-[var(--chat-muted)] pl-4 pr-4 py-3 outline-none resize-none flex-grow focus:ring-0 border-none focus:outline-none focus:shadow-none text-base"
                style={{ maxHeight: '150px' }}
                rows={1}
              />
            </div>

            {/* Controls Row */}
            <div className="flex items-center justify-between px-3 pb-3">
              <div className="flex items-center gap-2">
                {/* Attach Button */}
                <IconButton
                  icon={PaperclipDecl}
                  variant="ghost"
                  size="lg"
                  iconSize={18}
                  title="Attach file"
                  aria-label="Attach file"
                />

                {/* Mode Toggle Buttons */}
                {/* Container and both buttons become ONE `<SegmentedControl>`, which is what this
                    always was: a single-select of connected options inside a bordered track, the
                    chosen one on an inset `--xeno-control` fill and the other a muted label. The
                    hand-written version had the track, the padding and the two states; what it did
                    not have is the thumb that travels between them.
                    It needed a door first — `SegmentedOption` had no glyph slot, and dropping the
                    globe and the bot would have been redrawing the control rather than taking it. */}
                <SegmentedControl
                  value={searchMode}
                  onValueChange={(next) => setSearchMode(next as typeof searchMode)}
                  size="md"
                  iconSize={14}
                  options={[
                    { value: 'web', label: 'Web', icon: GlobeDecl },
                    { value: 'agent', label: 'Agent', icon: BotDecl },
                  ]}
                  aria-label="Search mode"
                />
              </div>

              {/* Send Button */}
              <div className="flex items-center">
                {isLoading || isSearching ? (
                  <IconButton
                    icon={StopCircleDecl}
                    variant="ghost"
                    size="lg"
                    iconSize={18}
                    onClick={() => {
                      setIsLoading(false);
                      setIsSearching(false);
                    }}
                    aria-label="Stop searching"
                    title="Stop"
                  />
                ) : (
                  <IconButton
                    icon={SendDecl}
                    variant="ghost"
                    size="lg"
                    iconSize={18}
                    onClick={handleSubmit}
                    disabled={!inputValue.trim()}
                    aria-label="Send"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Unified Browser & Results */}
      <div
        className="absolute top-0 bottom-0 right-0 w-[55%] flex bg-[var(--chat-canvas)] transition-all duration-300 ease-out"
        style={{
          transform: (showResultsPanel || isBrowserOpen) ? 'translateX(0)' : 'translateX(100%)',
          opacity: (showResultsPanel || isBrowserOpen) ? 1 : 0
        }}
      >
        {/* Spacer Line */}
        {(showResultsPanel || isBrowserOpen) && (
          <div className="flex-shrink-0 flex items-center py-8">
            <div className="w-px h-full bg-[var(--chat-control-strong)]"></div>
          </div>
        )}

        {/* Unified Browser/Results Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Browser - Same XenoBrowser for both web and agent modes */}
          {isBrowserOpen && (
            <div className="flex-1 flex flex-col overflow-hidden relative">
              {/* XenoBrowser - Always visible */}
              <XenoBrowser
                ref={xenoBrowserRef}
                initialUrl={browserUrl}
                onClose={() => {
                  setIsBrowserOpen(false);
                  setCurrentPageContent(null);
                }}
                onUrlChange={(url) => {
                  setBrowserUrl(url);
                  setAgentBrowserUrl(url); // Sync agent browser URL
                  fetchPageContent(url);
                }}
                onAgentResult={(result) => {
                  // Update cursor when agent action completes
                  if (result.cursor && xenoBrowserRef.current) {
                    const iframeOffset = xenoBrowserRef.current.getIframeOffset();
                    setAgentCursor({
                      x: result.cursor.x + iframeOffset.x,
                      y: result.cursor.y + iframeOffset.y,
                      action: 'click'
                    });
                  }
                }}
              />

              {/* Agent Cursor Overlay - Shows on top of browser when agent is working */}
              {searchMode === 'agent' && isAgentWorking && agentCursor && (
                <div
                  className="absolute pointer-events-none z-20"
                  style={{
                    left: `${agentCursor.x}px`,
                    top: `${agentCursor.y}px`,
                    transform: 'translate(-50%, -50%)',
                    transition: agentCursor.action === 'moving'
                      ? 'left 400ms cubic-bezier(0.4, 0, 0.2, 1), top 400ms cubic-bezier(0.4, 0, 0.2, 1)'
                      : 'left 150ms ease-out, top 150ms ease-out'
                  }}
                >
                  {/* The blue on this overlay is deliberate and it is the only hue in the file.
                      Everything here belongs to one live activity — an agent driving a browser: the
                      pointer, its trail, the ping ring, the step list, the "controlling browser"
                      banner. That is CONTENT, in the grammar's sense, and content is where colour is
                      allowed to live; the shell around it stays monochrome. One feature, one hue. */}
                  {/* Cursor icon with trail effect during movement */}
                  <div className={`relative ${agentCursor.action === 'moving' ? 'scale-110' : 'scale-100'} transition-transform duration-200`}>
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="drop-shadow-lg relative z-10"
                    >
                      <path
                        d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .72-.58.38-.92L6.35 2.85a.5.5 0 0 0-.85.36Z"
                        // The one colour in this file, and it stays: this is a drawing of a mouse
                        // pointer moving across a page the agent is browsing — content, not chrome,
                        // and the white outline is the one every OS cursor has.
                        fill="#3b82f6"
                        stroke="#fff"
                        strokeWidth="1.5"
                      />
                    </svg>
                    {/* Motion trail during movement */}
                    {agentCursor.action === 'moving' && (
                      <div className="absolute inset-0 -z-10">
                        <div className="w-6 h-6 rounded-full bg-blue-400/30 blur-sm animate-pulse" />
                      </div>
                    )}
                  </div>
                  {/* Click ripple effect */}
                  {agentCursor.action === 'click' && (
                    <div className="absolute inset-0 flex items-center justify-center -z-10">
                      <div className="w-12 h-12 rounded-full bg-blue-500/50 animate-ping" />
                      <div className="absolute w-8 h-8 rounded-full bg-blue-400/40 animate-pulse" />
                    </div>
                  )}
                  {/* Scroll indicator */}
                  {agentCursor.action === 'scroll' && (
                    <div className="absolute -right-8 top-0 flex flex-col items-center text-blue-400">
                      <ChevronDown size={20} className="animate-bounce" />
                      <span className="text-[10px] bg-blue-500/80 px-1.5 py-0.5 rounded text-[var(--chat-text)]">scroll</span>
                    </div>
                  )}
                  {/* Type indicator */}
                  {agentCursor.action === 'type' && (
                    <div className="absolute left-8 top-0 bg-blue-500 px-2 py-1 rounded text-xs text-[var(--chat-text)] shadow-lg flex items-center gap-1">
                      <span className="inline-block w-1.5 h-3 bg-[var(--chat-text)] animate-pulse" />
                      typing...
                    </div>
                  )}
                </div>
              )}

              {/* Agent Working Indicator Banner */}
              {searchMode === 'agent' && isAgentWorking && (
                <div
                  className="absolute top-12 left-0 right-0 z-10 pointer-events-none"
                  style={{
                    background: 'linear-gradient(to bottom, rgba(59, 130, 246, 0.1) 0%, transparent 100%)'
                  }}
                >
                  <div className="flex items-center justify-center gap-2 py-2">
                    <Bot size={14} className="text-blue-400 animate-pulse" />
                    <span className="text-xs text-blue-400 font-medium">Agent controlling browser</span>
                    <Spinner size={12} style={{ ["--xeno-spinner-track"]: "rgb(96 165 250 / 0.35)", ["--xeno-spinner-edge"]: "rgb(96 165 250)" } as React.CSSProperties} />
                  </div>
                </div>
              )}

              {/* Agent Steps Overlay - Shows on top of browser when in agent mode */}
              {searchMode === 'agent' && agentSteps.length > 0 && (
                <div className="absolute bottom-0 left-0 right-0 max-h-[35%] overflow-y-auto bg-[var(--chat-canvas)]/95 border-t border-[var(--chat-border)] backdrop-blur-sm z-30">
                  <div className="p-3">
                    <div className="flex items-center gap-2 text-xs text-[var(--chat-muted)] mb-2">
                      <Layers size={12} />
                      <span>Agent Steps ({agentSteps.length})</span>
                      {isAgentWorking && <Spinner size={12} style={{ ["--xeno-spinner-track"]: "rgb(96 165 250 / 0.35)", ["--xeno-spinner-edge"]: "rgb(96 165 250)" } as React.CSSProperties} />}
                      {!isAgentWorking && (
                        <IconButton
                          icon={XDecl}
                          variant="ghost"
                          size="xs"
                          iconSize={12}
                          className="ml-auto"
                          onClick={() => setAgentSteps([])}
                          title="Clear steps"
                          aria-label="Clear steps"
                        />
                      )}
                    </div>
                    <div className="space-y-2">
                      {agentSteps.map((step, idx) => (
                        <div
                          key={idx}
                          className={`p-2 border rounded-lg text-xs transition-all ${
                            idx === agentSteps.length - 1 && isAgentWorking
                              ? 'bg-blue-500/10 border-blue-500/30'
                              : 'bg-[var(--chat-surface)] border-[var(--chat-border)]'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <span className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                              idx === agentSteps.length - 1 && isAgentWorking
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-[var(--chat-control)] text-[var(--chat-muted)]'
                            }`}>
                              {idx === agentSteps.length - 1 && isAgentWorking ? (
                                <Spinner size={8} />
                              ) : (
                                idx + 1
                              )}
                            </span>
                            <div className="flex-1 min-w-0">
                              {/* Show URL context if available */}
                              {step.url && (
                                <div className="text-[10px] text-[var(--chat-muted)] truncate mb-0.5" title={step.url}>
                                  📍 {getDomain(step.url)}
                                </div>
                              )}
                              <p className="text-[var(--chat-text)] text-xs">{step.thought}</p>
                              {step.action && (
                                <div className="flex items-center gap-1 mt-1 text-[var(--chat-muted)]">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                    idx === agentSteps.length - 1 && isAgentWorking
                                      ? 'bg-blue-500/20 text-blue-400'
                                      : 'bg-[var(--chat-canvas)]'
                                  }`}>
                                    {step.action.type}
                                  </span>
                                  {step.result && (
                                    <Check size={10} className="text-green-500/70 ml-auto" />
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Mode Indicator Badge - Only show when not agent working */}
              {!isAgentWorking && (
                <div className="absolute top-14 right-4 z-10 flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--chat-surface)] border border-[var(--chat-border)]">
                  {searchMode === 'agent' ? (
                    <>
                      <Bot size={12} className="text-[var(--chat-muted)]" />
                      <span className="text-[10px] text-[var(--chat-muted)] font-medium">Agent</span>
                    </>
                  ) : (
                    <>
                      <Globe size={12} className="text-[var(--chat-muted)]" />
                      <span className="text-[10px] text-[var(--chat-muted)] font-medium">Web</span>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Search Results - Shows when no browser is open */}
          {showResultsPanel && !isBrowserOpen && (
            <div className="flex-1 overflow-y-auto p-6 pt-4">
              {isSearching ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Spinner size={32} className="mb-3" />
                  <p className="text-sm text-[var(--chat-muted)]">Searching the web...</p>
                </div>
              ) : searchError ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Globe size={32} className="text-red-500 mb-3" />
                  <p className="text-sm text-red-500">Search failed</p>
                  <p className="text-xs text-[var(--chat-muted)] mt-1 max-w-md">{searchError}</p>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Globe size={32} className="text-[var(--chat-muted)] mb-3" />
                  <p className="text-sm text-[var(--chat-muted)]">No results found</p>
                  <p className="text-xs text-[var(--chat-muted)] mt-1">Try a different search term</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {searchResults.map((result, idx) => (
                    <div
                      key={idx}
                      onClick={() => openInBrowser(result.url)}
                      className={`group p-4 bg-[var(--chat-surface)] border border-[var(--chat-border)] rounded-xl hover:border-[var(--chat-muted)] cursor-pointer transition-all duration-300 ${
                        idx < visibleResults
                          ? 'opacity-100 translate-y-0'
                          : 'opacity-0 translate-y-4'
                      }`}
                      style={{
                        transitionDelay: `${idx * 40}ms`
                      }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <img
                          src={result.favicon}
                          alt=""
                          className="w-4 h-4 rounded"
                          onError={(e) => (e.currentTarget.style.display = 'none')}
                        />
                        <span className="text-xs text-[var(--chat-muted)]">{result.domain}</span>
                        {result.relevance_score && (
                          <span className="ml-auto text-[10px] text-[var(--chat-muted)] bg-[var(--chat-canvas)] px-2 py-0.5 rounded">
                            {Math.round(result.relevance_score * 100)}% match
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-medium text-[var(--chat-accent)] underline-offset-2 group-hover:underline mb-2 line-clamp-2">
                        {result.title}
                      </h4>
                      <p className="text-xs text-[var(--chat-muted)] line-clamp-3">
                        {result.snippet}
                      </p>
                      <div className="flex items-center gap-2 mt-3 text-xs text-[var(--chat-muted)]">
                        <ExternalLink size={12} />
                        <span>Click to open in browser</span>
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
  );
};

export default SearchChatInterface;

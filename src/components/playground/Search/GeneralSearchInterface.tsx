import React, { useState, useRef, useEffect } from 'react';
import { 
  Search, 
  Send, 
  X, 
  Clock, 
  StopCircle, 
  Image, 
  FolderUp, 
  FileClock, 
  ChevronDown,
  BarChart3,
  Eye,
  Copy,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Bot,
  User,
  Loader2,
  Globe,
  Brain,
  Zap,
  BookOpen,
  PieChart,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Paperclip,
  Link,
  FileText
} from 'lucide-react';
import { xenoSearchService } from '../../../services/xenoSearchService';

// Interface definitions
interface AttachedFile {
  id: string;
  name: string;
  type: string;
  fileObject?: File;
}

interface RecentFile {
  id: string;
  name: string;
  type: string;
  size: number;
  lastUsed: number;
  preview?: string;
}

interface SearchSession {
  id: string;
  title: string;
  timestamp: number;
  messages: ChatMessage[];
  settings?: {
    searchMode: 'normal' | 'deep';
    numResults: number;
  };
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  parsedAnswer?: string;
  parsedThinking?: string | null;
  hasThinking?: boolean;
  isError?: boolean;
  isThinkingPlaceholder?: boolean;
  isDotPlaceholder?: boolean;
  thinkingDuration?: number;
  searchInfo?: {
    queries: string[];
    sources: { uri: string; title: string }[];
    supports?: {
      startIndex?: number;
      endIndex?: number;
      text?: string;
      sourceIndices: number[];
      confidenceScore?: number;
    }[];
  } | null;
  markerToSourceIndices?: Map<number, number[]>;
  uniqueSourcesUsed?: { index: number; uri: string; title: string }[];
  thinkingContent?: string;
  isCancelled?: boolean;
  isXenoSearchCancelled?: boolean;
  answerTokenCount?: number;
  isLoading?: boolean;
  isXenoDeepSearchContainer?: boolean;
  userFileAttachment?: { file?: File; name: string; type: string; content?: string; encoding?: 'text' | 'base64' };
}

interface GeneralResult {
  id: string;
  title: string;
  content: string;
  url: string;
  timestamp: string;
  relevanceScore: number;
  source: string;
}

interface SearchHistoryItem {
  query: string;
  searchType: 'normal' | 'deep' | 'research';
  results: number;
  timestamp: string;
}

// Helper functions
const cleanText = (text: string | null): string | null => {
  if (!text) return null;
  return text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
};

const parseResponse = (fullText: string, reasoningExpected: boolean = false): { thinking: string | null; answer: string; hasThinking: boolean } => {
  if (!fullText) return { thinking: null, answer: '', hasThinking: false };

  const thinkingPatterns = [
    /&lt;thinking&gt;([\s\S]*?)&lt;\/thinking&gt;/g,
    /<thinking>([\s\S]*?)<\/thinking>/g,
    /\*\*Thinking:\*\*([\s\S]*?)\*\*Answer:\*\*/g,
    /\*\*Reasoning:\*\*([\s\S]*?)\*\*Response:\*\*/g,
    /Thinking:([\s\S]*?)(?=Answer:|Response:|$)/g,
    /Reasoning:([\s\S]*?)(?=Answer:|Response:|$)/g
  ];

  let thinking: string | null = null;
  let cleanedText = fullText;

  for (const pattern of thinkingPatterns) {
    const match = pattern.exec(fullText);
    if (match) {
      thinking = match[1].trim();
      cleanedText = fullText.replace(pattern, '').trim();
      break;
    }
  }

  const hasThinking = thinking !== null && thinking.length > 0;
  const answer = cleanedText || fullText;

  return {
    thinking: hasThinking ? cleanText(thinking) : null,
    answer: cleanText(answer) || '',
    hasThinking
  };
};

const GeneralSearchInterface: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<'normal' | 'deep'>('normal');
  const [numResults, setNumResults] = useState(10);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isRecentFilesOpen, setIsRecentFilesOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [recentFiles, setRecentFiles] = useState<Array<{
    id: string;
    name: string;
    type: string;
    size: number;
    lastUsed: number;
    preview?: string;
  }>>([]);
  const [sessions, setSessions] = useState<SearchSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [likedMessages, setLikedMessages] = useState<Set<string>>(new Set());
  const [dislikedMessages, setDislikedMessages] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeneralResult[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [searchType, setSearchType] = useState<'normal' | 'deep' | 'research'>('normal');
  const [copiedResultId, setCopiedResultId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'offline'>('offline');
  const [showWelcome, setShowWelcome] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const recentFilesPanelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    }
  }, [inputValue]);

  // Effect to handle clicks outside attach menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
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
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isAttachMenuOpen, isRecentFilesOpen]); 

  useEffect(() => {
    const checkConnection = async () => {
      setConnectionStatus('connecting');
      try {
        const healthResponse = await xenoSearchService.checkHealth();
        setConnectionStatus(healthResponse.status === 'ok' ? 'connected' : 'offline');
      } catch (error) {
        setConnectionStatus('offline');
      }
    };
    
    checkConnection();
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    setShowWelcome(false);
    
    // Add to search history
    const historyItem: SearchHistoryItem = {
      query: searchQuery,
      searchType,
      results: 0,
      timestamp: new Date().toISOString()
    };
    
    if (!searchHistory.some(item => item.query === searchQuery)) {
      setSearchHistory(prev => [historyItem, ...prev.slice(0, 4)]);
    }
    
    try {
      const response = await xenoSearchService.searchGeneral({
        query: searchQuery,
        search_type: searchType,
        num_results: 10
      });
      
      const convertedResults: GeneralResult[] = response.sources.map((source, index) => ({
        id: `${Date.now()}-${index}`,
        title: source.title,
        content: source.snippet,
        url: source.url,
        timestamp: new Date().toLocaleString(),
        relevanceScore: source.relevance_score || 0.5,
        source: source.source || 'Web'
      }));
      
      setSearchResults(convertedResults);
    } catch (error) {
      console.error('General search failed:', error);
      const mockResults = generateMockResults(searchQuery);
      setSearchResults(mockResults);
    } finally {
      setIsSearching(false);
    }
  };

  const generateMockResults = (query: string): GeneralResult[] => {
    return [
      {
        id: '1',
        title: `Comprehensive Guide to ${query}`,
        content: `Learn everything you need to know about ${query} with this detailed guide covering fundamentals, best practices, and advanced techniques...`,
        url: 'https://example.com/guide',
        timestamp: new Date().toLocaleString(),
        relevanceScore: 0.95,
        source: 'Knowledge Base'
      },
      {
        id: '2',
        title: `Latest Developments in ${query}`,
        content: `Stay updated with the newest trends and innovations in ${query}. This article covers recent breakthroughs and future prospects...`,
        url: 'https://example.com/news',
        timestamp: new Date().toLocaleString(),
        relevanceScore: 0.88,
        source: 'News'
      },
      {
        id: '3',
        title: `${query}: Expert Analysis and Insights`,
        content: `Professional analysis and expert opinions on ${query}. Deep dive into key concepts, methodologies, and practical applications...`,
        url: 'https://example.com/analysis',
        timestamp: new Date().toLocaleString(),
        relevanceScore: 0.82,
        source: 'Research'
      }
    ];
  };

  const handleCopyResult = async (result: GeneralResult) => {
    const textToCopy = `${result.title}\n${result.content}\n${result.url}`;
    await navigator.clipboard.writeText(textToCopy);
    setCopiedResultId(result.id);
    setTimeout(() => setCopiedResultId(null), 2000);
  };

  const getConnectionStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <CheckCircle2 size={16} className="text-green-400" />;
      case 'connecting':
        return <Loader2 size={16} className="text-yellow-400 animate-spin" />;
      default:
        return <AlertCircle size={16} className="text-red-400" />;
    }
  };

  const handleStop = () => {
    setIsSearching(false);
  };

  const handleHistoryClick = (item: SearchHistoryItem) => {
    setSearchQuery(item.query);
    setSearchType(item.searchType);
    setIsHistoryOpen(false);
  };

  const clearHistory = () => {
    setSearchHistory([]);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  // Attach functionality
  const toggleAttachMenu = () => {
    const newState = !isAttachMenuOpen;
    setIsAttachMenuOpen(newState);
    if (!newState) {
       setIsRecentFilesOpen(false);
    }
  };

  const handleUploadFile = () => { 
    fileInputRef.current?.click(); 
  };
  
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

  const handleReattachRecentFile = async (recentFile: typeof recentFiles[0]) => {
    console.log('[Recent Files] Re-attaching file:', recentFile.name);
    
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

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [searchQuery]);

  return (
    <div className="h-full flex flex-col bg-primary-bg">
      {/* Results or Welcome Content */}
      <div className="flex-1 overflow-y-auto">
        {showWelcome ? (
          <div className="h-full flex items-center justify-center">
            <div className="max-w-4xl mx-auto text-center">
        {/* Header */}
              <div className="mb-16">
                <h1 className="text-6xl font-bold text-white mb-6">
                  Xeno Search
                </h1>
                <p className="text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
                  Intelligent search powered by AI. Find answers, insights, and information across the web.
                </p>
        </div>
        
              {/* Welcome Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                {[
                  {
                    icon: Globe,
                    title: 'Web Search',
                    description: 'Search across billions of web pages to find the most relevant and up-to-date information.'
                  },
                  {
                    icon: Brain,
                    title: 'AI Analysis',
                    description: 'Get intelligent summaries and insights powered by advanced AI models and natural language processing.'
                  },
                  {
                    icon: Zap,
                    title: 'Instant Results',
                    description: 'Receive fast, accurate search results with relevance scoring and source verification.'
                  }
                ].map((card, index) => (
                  <div key={index} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 text-center hover:bg-zinc-900/70 transition-colors">
                    <div className="w-16 h-16 bg-gray-400 rounded-full flex items-center justify-center mx-auto mb-6">
                      <card.icon size={24} className="text-zinc-900" />
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-4">{card.title}</h3>
                    <p className="text-gray-400 leading-relaxed">{card.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto">
            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white">
                  Search Results ({searchResults.length})
                </h2>

                {searchResults.map((result) => (
                  <div key={result.id} className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-4 hover:border-gray-600 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-medium text-white text-lg">{result.title}</h3>
                          <span className="text-xs bg-zinc-700 text-gray-300 px-2 py-1 rounded-full">
                            {result.source}
                          </span>
                        </div>
                        
                        <p className="text-gray-300 mb-3">{result.content}</p>
                        
                        <div className="flex items-center gap-4 text-xs text-gray-400">
                          <span>{result.timestamp}</span>
                          <span>Relevance: {(result.relevanceScore * 100).toFixed(0)}%</span>
                          <a 
                            href={result.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-gray-400 hover:text-white"
                          >
                            <ExternalLink size={12} />
                            Visit source
                          </a>
                        </div>
              </div>
              
                      <button 
                        onClick={() => handleCopyResult(result)}
                        className="flex items-center gap-1 px-3 py-1.5 text-gray-400 hover:text-white border border-[#3a3a3d] rounded-md hover:border-gray-500 transition-colors"
                      >
                        {copiedResultId === result.id ? (
                          <>
                            <CheckCircle2 size={14} />
                            <span className="text-xs">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy size={14} />
                            <span className="text-xs">Copy</span>
                          </>
                        )}
                      </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

            {/* No Results State */}
            {!isSearching && searchResults.length === 0 && !showWelcome && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <Search size={48} className="text-gray-400 mb-4" />
                <h3 className="text-xl font-medium text-white mb-2">No results found</h3>
                <p className="text-gray-400">Try adjusting your search terms or search type</p>
                  </div>
            )}

            {/* Loading State */}
            {isSearching && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 bg-gray-400 rounded-full flex items-center justify-center mb-6">
                  <Search className="w-8 h-8 text-zinc-900 animate-pulse" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-4">Searching the web...</h3>
                <p className="text-gray-400">Finding the most relevant information</p>
              </div>
            )}
                </div>
              )}
            </div>
            
      {/* Bottom Input Container */}
      <div className="mb-8">
        <div className="max-w-6xl mx-auto p-4 relative">
          {/* Search History Panel */}
          {isHistoryOpen && (
            <div className="absolute bottom-full left-4 right-4 mb-4 bg-[#19191a] border border-[#3a3a3d] rounded-lg shadow-xl max-h-64 overflow-y-auto z-50">
              <div className="p-4 border-b border-[#3a3a3d] flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-300">Search History</h3>
                <div className="flex items-center gap-2">
                <button 
                    onClick={clearHistory}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                    Clear
                </button>
                <button 
                    onClick={() => setIsHistoryOpen(false)}
                    className="text-gray-400 hover:text-white transition-colors"
                >
                    <X size={16} />
                </button>
              </div>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {searchHistory.length > 0 ? (
                  searchHistory.slice().reverse().map((item, index) => (
                    <button
                      key={index}
                      onClick={() => handleHistoryClick(item)}
                      className="w-full text-left p-3 hover:bg-zinc-700/50 transition-colors border-b border-zinc-800 last:border-b-0"
                    >
                      <div className="flex items-center gap-3">
                        <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-300 truncate">{item.query}</p>
                          <p className="text-xs text-gray-500">{item.searchType}</p>
            </div>
          </div>
                    </button>
                  ))
                ) : (
                  <div className="p-6 text-center text-gray-500">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No search history yet</p>
        </div>
                )}
          </div>
          </div>
        )}

        {/* Attached Files Preview Container */}
        {attachedFiles.length > 0 && (
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -mb-5 z-0">
            <div className="w-[850px] bg-[#19191a] border border-[#3a3a3d] rounded-t-xl p-2 shadow-lg scale-75 hover:scale-100 translate-y-2 hover:translate-y-0 transition-all duration-300 ease-in-out delay-700 hover:delay-0">
              <div className="flex gap-1 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent">
                {attachedFiles.map((file) => (
                  <div 
                    key={file.id}
                    className="flex items-center gap-1.5 relative group p-0.5"
                  >
                    {file.fileObject && file.type.startsWith('image/') ? (
                      <img 
                        src={URL.createObjectURL(file.fileObject)} 
                        alt={file.name} 
                        className="w-8 h-8 rounded-md object-cover flex-shrink-0 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out cursor-pointer"
                        onClick={() => {
                          // TODO: Add full screen image viewer if needed
                          console.log('Image clicked:', file.name);
                        }}
                      />
                    ) : (
                      <div
                        className="w-auto h-8 rounded-md flex items-center gap-1.5 px-2 bg-zinc-700/50 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out text-xs text-gray-200 cursor-pointer"
                        onClick={() => {
                          console.log('File clicked:', file.name);
                        }}
                      >
                        <FileText size={16} className={file.fileObject ? "text-blue-400" : "text-gray-500"} />
                        <span className="truncate max-w-[120px]" title={file.name}>{file.name}</span>
                        {!file.fileObject && (
                          <span className="text-xs text-gray-500 ml-1">(recent)</span>
                        )}
        </div>
                    )}
                    <button 
                      onClick={() => handleRemoveAttachedFile(file.id)}
                      className="w-5 h-5 flex items-center justify-center rounded bg-zinc-700 hover:bg-zinc-600 text-white opacity-0 group-hover:opacity-100 absolute top-[-2px] right-[-2px] transition-opacity duration-150 ease-in-out flex-shrink-0"
                      aria-label="Remove file"
                    >
                      <X size={12} />
                    </button>
            </div>
                ))}
          </div>
            </div>
          </div>
        )}

          {/* Input Container with Attach and History Buttons */}
          <div className="flex items-center justify-center gap-3">
            {/* Attach Button */}
            <button 
              ref={attachButtonRef}
              onClick={toggleAttachMenu}
              className="flex items-center justify-center w-12 h-12 bg-[#19191a] border border-[#3a3a3d] rounded-xl text-gray-400 hover:text-white hover:border-gray-500 transition-colors relative"
              title="Attach File"
            >
              <Paperclip size={20} />
              
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
                    style={{ left: 'calc(16rem + 0.5rem)' }}
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
            </button>

            <div className="flex-1 bg-[#19191a] border border-[#3a3a3d] rounded-2xl p-4 relative z-10">
              <div className="flex items-center gap-4 min-h-[40px]">
                <div className="flex-1">
                  <textarea
                    ref={textareaRef}
                    placeholder="Search for anything..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleKeyPress}
                    className="w-full bg-transparent text-white placeholder-gray-400 pl-2 py-2 outline-none resize-none flex-grow focus:ring-0 border-none focus:outline-none focus:shadow-none text-base scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent"
                    style={{ maxHeight: '150px' }}
                    rows={1}
                  />
      </div>

                <div className="flex items-center gap-3">

                  {/* Search Type Toggle */}
                  <div className="flex items-center gap-1 bg-[#19191a] border border-[#3a3a3d] rounded-lg p-1">
                    <button 
                      onClick={() => setSearchType('normal')}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                        searchType === 'normal' 
                          ? 'bg-gray-400 text-zinc-900' 
                          : 'text-gray-300 hover:bg-zinc-800'
                      }`}
                    >
                      Normal
                    </button>
                    <button 
                      onClick={() => setSearchType('deep')}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                        searchType === 'deep' 
                          ? 'bg-gray-400 text-zinc-900' 
                          : 'text-gray-300 hover:bg-zinc-800'
                      }`}
                    >
                      Deep
                    </button>
                    <button 
                      onClick={() => setSearchType('research')}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                        searchType === 'research' 
                          ? 'bg-gray-400 text-zinc-900' 
                          : 'text-gray-300 hover:bg-zinc-800'
                      }`}
                    >
                      Research
                    </button>
                  </div>

                  {/* Search/Stop Button */}
                  {isSearching ? (
                    <button
                      onClick={handleStop}
                      className="flex items-center justify-center px-4 py-2 bg-gray-400 text-zinc-900 rounded-lg transition-colors h-10"
                    >
                      <StopCircle size={18} />
                      <span className="ml-1.5 text-sm font-semibold">Stop</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleSearch}
                      className="bg-gray-400 text-zinc-900 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-10 flex items-center justify-center"
                      disabled={!searchQuery.trim()}
                    >
                      <Send size={16} className="mr-1.5" />
                      <span>Search</span>
                    </button>
                  )}
                </div>
              </div>
      </div>

            {/* History Button */}
            <button 
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              className={`flex items-center justify-center w-12 h-12 border border-[#3a3a3d] rounded-xl transition-colors ${
                isHistoryOpen 
                  ? 'bg-gray-400 text-zinc-900 border-gray-400' 
                  : 'bg-[#19191a] text-gray-400 hover:text-white hover:border-gray-500'
              }`}
              title="Search History"
            >
              <Clock size={20} />
            </button>
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
    </div>
  );
};

export default GeneralSearchInterface; 
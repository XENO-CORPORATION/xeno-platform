import React, { useState, useEffect, useRef } from 'react';
import { Search, TrendingUp, TrendingDown, DollarSign, BarChart3, Globe, Building, PieChart, AlertCircle, CheckCircle2, Loader2, ChevronDown, Copy, ExternalLink, Filter, Clock, X, Send, StopCircle, Shuffle } from 'lucide-react';
import { xenoSearchService } from '../../../services/xenoSearchService';

interface FinanceResult {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: string;
  peRatio?: number;
  sector: string;
  lastUpdated: string;
}

interface MarketData {
  id: string;
  type: 'stock' | 'news' | 'analysis';
  title: string;
  content: string;
  url: string;
  timestamp: string;
  relevanceScore: number;
}

interface SearchHistoryItem {
  query: string;
  searchType: 'stocks' | 'news' | 'analysis';
  results: number;
  timestamp: string;
}

const FinanceSearchInterface: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FinanceResult[]>([]);
  const [marketData, setMarketData] = useState<MarketData[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [searchType, setSearchType] = useState<'stocks' | 'news' | 'analysis'>('stocks');
  const [selectedMarket, setSelectedMarket] = useState('all');
  const [copiedResultId, setCopiedResultId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'offline'>('offline');
  const [showWelcome, setShowWelcome] = useState(true);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      const response = await xenoSearchService.searchFinance({
        query: searchQuery,
        search_type: searchType === 'stocks' ? 'stocks' : searchType,
        num_results: 10
      });
      
      if (searchType === 'stocks') {
        const convertedResults: FinanceResult[] = response.finance_data ? [{
          id: `${Date.now()}-0`,
          symbol: response.finance_data.symbol || 'UNKNOWN',
          name: `${searchQuery} Corporation`,
          price: response.finance_data.price || 100,
          change: response.finance_data.change || 0,
          changePercent: response.finance_data.changePercent || 0,
          volume: 1000000,
          marketCap: response.finance_data.marketCap,
          peRatio: response.finance_data.pe_ratio,
          sector: response.finance_data.sector || 'Technology',
          lastUpdated: new Date().toLocaleString()
        }] : [];
        
        setSearchResults(convertedResults);
      } else {
        const convertedData: MarketData[] = response.sources.map((source, index) => ({
          id: `${Date.now()}-${index}`,
          type: searchType,
          title: source.title,
          content: source.snippet,
          url: source.url,
          timestamp: new Date().toLocaleString(),
          relevanceScore: source.relevance_score || 0.5
        }));
        
        setMarketData(convertedData);
      }
    } catch (error) {
      console.error('Finance search failed:', error);
      if (searchType === 'stocks') {
        const mockStocks = generateMockStocks(searchQuery);
        setSearchResults(mockStocks);
      } else {
        const mockMarketData = generateMockMarketData(searchQuery);
        setMarketData(mockMarketData);
      }
    } finally {
      setIsSearching(false);
    }
  };

  const generateMockStocks = (query: string): FinanceResult[] => {
    const mockStocks = [
      {
        id: '1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        price: 178.25,
        change: 2.45,
        changePercent: 1.39,
        volume: 67890123,
        marketCap: '2.8T',
        peRatio: 28.5,
        sector: 'Technology',
        lastUpdated: '2024-01-15 16:00:00'
      },
      {
        id: '2',
        symbol: 'MSFT',
        name: 'Microsoft Corporation',
        price: 384.52,
        change: -1.23,
        changePercent: -0.32,
        volume: 45123456,
        marketCap: '2.9T',
        peRatio: 32.1,
        sector: 'Technology',
        lastUpdated: '2024-01-15 16:00:00'
      }
    ];
    
    return mockStocks;
  };

  const generateMockMarketData = (query: string): MarketData[] => {
    return [
      {
        id: '1',
        type: 'news' as const,
        title: `Breaking: ${query} Shows Strong Market Performance`,
        content: `Recent analysis shows ${query} has demonstrated exceptional growth potential...`,
        url: 'https://example.com/finance-news',
        timestamp: '2024-01-15 14:30:00',
        relevanceScore: 0.95
      },
      {
        id: '2',
        type: 'analysis' as const,
        title: `Technical Analysis: ${query} Market Outlook`,
        content: `Our comprehensive analysis of ${query} indicates potential bullish trends...`,
        url: 'https://example.com/market-analysis',
        timestamp: '2024-01-15 13:45:00',
        relevanceScore: 0.88
      }
    ];
  };

  const handleCopyResult = async (result: FinanceResult | MarketData) => {
    let textToCopy = '';
    
    if ('symbol' in result) {
      textToCopy = `${result.symbol} - ${result.name}\nPrice: $${result.price}\nChange: ${result.change >= 0 ? '+' : ''}${result.change} (${result.changePercent >= 0 ? '+' : ''}${result.changePercent?.toFixed(2)}%)`;
    } else {
      textToCopy = `${result.title}\n${result.content}\n${result.url}`;
    }
    
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

  const formatPrice = (price: number): string => {
    if (price >= 1000) {
      return `$${(price / 1000).toFixed(1)}K`;
    }
    return `$${price.toFixed(2)}`;
  };

  const formatVolume = (volume: number): string => {
    if (volume >= 1000000) {
      return `${(volume / 1000000).toFixed(1)}M`;
    }
    return `${(volume / 1000).toFixed(0)}K`;
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

  const handleRandomize = () => {
    const randomQueries = [
      'AAPL stock analysis',
      'Bitcoin price prediction',
      'Tesla earnings report',
      'S&P 500 performance',
      'NVIDIA market trends',
      'Amazon financial outlook',
      'Microsoft dividend yield',
      'Gold investment strategy',
      'Oil futures analysis',
      'Tech sector growth',
      'Bank interest rates',
      'Real estate market'
    ];
    
    const randomQuery = randomQueries[Math.floor(Math.random() * randomQueries.length)];
    setSearchQuery(randomQuery);
    
    // Optional: Auto-search after randomizing
    setTimeout(() => {
      if (randomQuery) {
        handleSearch();
      }
    }, 100);
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
                  Xeno Finance
                </h1>
                <p className="text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
                  Real-time financial data and market analysis powered by AI intelligence.
                </p>
              </div>

              {/* Welcome Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                {[
                  {
                    icon: TrendingUp,
                    title: 'Real-time Data',
                    description: 'Access live stock prices, market movements, and financial indicators as they happen.'
                  },
                  {
                    icon: BarChart3,
                    title: 'Market Analysis',
                    description: 'Get comprehensive technical and fundamental analysis for informed investment decisions.'
                  },
                  {
                    icon: PieChart,
                    title: 'Portfolio Insights',
                    description: 'Track market trends and discover new investment opportunities across all asset classes.'
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

            {/* Stock Results */}
            {searchType === 'stocks' && searchResults.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white">
                  Stock Results ({searchResults.length})
                </h2>
                      
                {searchResults.map((stock) => (
                  <div key={stock.id} className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-4 hover:border-gray-600 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-4 mb-2">
                          <div>
                            <h3 className="font-semibold text-white text-lg">{stock.symbol}</h3>
                            <p className="text-gray-400 text-sm">{stock.name}</p>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <span className="text-2xl font-bold text-white">
                              {formatPrice(stock.price)}
                            </span>
                            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-sm ${
                              stock.change >= 0 
                                ? 'bg-green-900/50 text-green-400' 
                                : 'bg-red-900/50 text-red-400'
                            }`}>
                              {stock.change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                              <span>
                                {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)} 
                                ({stock.changePercent?.toFixed(2)}%)
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-gray-400">Volume:</span>
                            <span className="text-white ml-2">{formatVolume(stock.volume)}</span>
                          </div>
                          {stock.marketCap && (
                            <div>
                              <span className="text-gray-400">Market Cap:</span>
                              <span className="text-white ml-2">{stock.marketCap}</span>
                            </div>
                          )}
                          {stock.peRatio && (
                            <div>
                              <span className="text-gray-400">P/E Ratio:</span>
                              <span className="text-white ml-2">{stock.peRatio}</span>
                            </div>
                          )}
                          <div>
                            <span className="text-gray-400">Sector:</span>
                            <span className="text-white ml-2">{stock.sector}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleCopyResult(stock)}
                        className="flex items-center gap-1 px-3 py-1.5 text-gray-400 hover:text-white border border-[#3a3a3d] rounded-md hover:border-gray-500 transition-colors"
                      >
                        {copiedResultId === stock.id ? (
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

            {/* Market Data Results */}
            {(searchType === 'news' || searchType === 'analysis') && marketData.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white">
                  {searchType === 'news' ? 'Market News' : 'Market Analysis'} ({marketData.length})
                </h2>

                {marketData.map((item) => (
                  <div key={item.id} className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-4 hover:border-gray-600 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-medium text-white text-lg">{item.title}</h3>
                        </div>
                        
                        <p className="text-gray-300 mb-3">{item.content}</p>
                        
                        <div className="flex items-center gap-4 text-xs text-gray-400">
                          <span>{item.timestamp}</span>
                          <a 
                            href={item.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-gray-400 hover:text-white"
                          >
                            <ExternalLink size={12} />
                            Read more
                          </a>
                        </div>
                      </div>
                      
                      <button
                        onClick={() => handleCopyResult(item)}
                        className="flex items-center gap-1 px-3 py-1.5 text-gray-400 hover:text-white border border-[#3a3a3d] rounded-md hover:border-gray-500 transition-colors"
                      >
                        {copiedResultId === item.id ? (
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
            {!isSearching && searchResults.length === 0 && marketData.length === 0 && !showWelcome && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <BarChart3 size={48} className="text-gray-400 mb-4" />
                <h3 className="text-xl font-medium text-white mb-2">No results found</h3>
                <p className="text-gray-400">Try adjusting your search terms or filters</p>
              </div>
            )}

            {/* Loading State */}
            {isSearching && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 bg-gray-400 rounded-full flex items-center justify-center mb-6">
                  <BarChart3 className="w-8 h-8 text-zinc-900 animate-pulse" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-4">Searching financial data...</h3>
                <p className="text-gray-400">Analyzing markets and gathering insights</p>
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
                        <BarChart3 className="w-4 h-4 text-gray-400 flex-shrink-0" />
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

          {/* Input Container with Randomize and History Buttons */}
          <div className="flex items-center justify-center gap-3">
            {/* Randomize Button */}
            <button 
              onClick={handleRandomize}
              className="flex items-center justify-center w-12 h-12 bg-[#19191a] border border-[#3a3a3d] rounded-xl text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
              title="Randomize Query"
            >
              <Shuffle size={20} />
            </button>

            <div className="flex-1 bg-[#19191a] border border-[#3a3a3d] rounded-2xl p-4">
              <div className="flex items-center gap-4 min-h-[40px]">
                <div className="flex-1">
                  <textarea
                    ref={textareaRef}
                    placeholder="Search stocks, financial news, or market analysis..."
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
                      onClick={() => setSearchType('stocks')}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                        searchType === 'stocks' 
                          ? 'bg-gray-400 text-zinc-900' 
                          : 'text-gray-300 hover:bg-zinc-800'
                      }`}
                    >
                      Stocks
                    </button>
                    <button 
                      onClick={() => setSearchType('news')}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                        searchType === 'news' 
                          ? 'bg-gray-400 text-zinc-900' 
                          : 'text-gray-300 hover:bg-zinc-800'
                      }`}
                    >
                      News
                    </button>
                    <button 
                      onClick={() => setSearchType('analysis')}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                        searchType === 'analysis' 
                          ? 'bg-gray-400 text-zinc-900' 
                          : 'text-gray-300 hover:bg-zinc-800'
                      }`}
                    >
                      Analysis
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
    </div>
  );
};

export default FinanceSearchInterface; 
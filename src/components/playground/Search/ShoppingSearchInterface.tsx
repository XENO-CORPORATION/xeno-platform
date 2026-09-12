import React, { useState, useEffect, useRef } from 'react';
import { Search, ShoppingCart, Tag, Star, DollarSign, Package, TrendingUp, AlertCircle, CheckCircle2, Loader2, Copy, ExternalLink, Clock, X, Send, StopCircle, Shuffle } from 'lucide-react';
import { xenoSearchService } from '../../../services/xenoSearchService';

interface ShoppingResult {
  id: string;
  title: string;
  price: string;
  originalPrice?: string;
  discount?: string;
  rating: number;
  reviewCount: number;
  imageUrl: string;
  url: string;
  source: string;
  availability: string;
  timestamp: string;
}

interface SearchHistoryItem {
  query: string;
  searchType: 'products' | 'deals' | 'reviews';
  results: number;
  timestamp: string;
}

const ShoppingSearchInterface: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ShoppingResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [searchType, setSearchType] = useState<'products' | 'deals' | 'reviews'>('products');
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
      const response = await xenoSearchService.searchShopping({
        query: searchQuery,
        search_type: 'shopping',
        filters: { mode: searchType },
        num_results: 10
      });
      
      const convertedResults: ShoppingResult[] = response.products?.map((product, index) => ({
        id: `${Date.now()}-${index}`,
        title: product.title || product.brand || 'Product',
        price: `$${product.price.toFixed(2)}`,
        originalPrice: product.originalPrice === undefined ? undefined : `$${product.originalPrice.toFixed(2)}`,
        discount: product.originalPrice && product.originalPrice > product.price
          ? `${Math.round((1 - product.price / product.originalPrice) * 100)}% off`
          : undefined,
        rating: product.rating || 4.0,
        reviewCount: product.reviewCount || 0,
        imageUrl: product.imageUrl || '',
        url: product.url || '',
        source: product.source || 'Online Store',
        availability: product.availability || 'In Stock',
        timestamp: new Date().toLocaleString()
      })) || [];
      
      setSearchResults(convertedResults);
    } catch (error) {
      console.error('Shopping search failed:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const generateMockResults = (query: string): ShoppingResult[] => {
    return [
      {
        id: '1',
        title: `Premium ${query} - Best Quality`,
        price: '$299.99',
        originalPrice: '$399.99',
        discount: '25% off',
        rating: 4.8,
        reviewCount: 1234,
        imageUrl: '/placeholder-product.jpg',
        url: 'https://example.com/product1',
        source: 'Amazon',
        availability: 'In Stock',
        timestamp: new Date().toLocaleString()
      },
      {
        id: '2',
        title: `${query} - Budget Friendly Option`,
        price: '$99.99',
        originalPrice: '$149.99',
        discount: '33% off',
        rating: 4.2,
        reviewCount: 567,
        imageUrl: '/placeholder-product.jpg',
        url: 'https://example.com/product2',
        source: 'eBay',
        availability: 'In Stock',
        timestamp: new Date().toLocaleString()
      },
      {
        id: '3',
        title: `Professional ${query} Kit`,
        price: '$599.99',
        rating: 4.9,
        reviewCount: 890,
        imageUrl: '/placeholder-product.jpg',
        url: 'https://example.com/product3',
        source: 'Best Buy',
        availability: 'Limited Stock',
        timestamp: new Date().toLocaleString()
      }
    ];
  };

  const handleCopyResult = async (result: ShoppingResult) => {
    const textToCopy = `${result.title}\nPrice: ${result.price}\nRating: ${result.rating}/5 (${result.reviewCount} reviews)\n${result.url}`;
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

  const handleRandomize = () => {
    const randomQueries = [
      'wireless headphones',
      'smartphone cases',
      'laptop stands',
      'gaming keyboards',
      'fitness trackers',
      'coffee makers',
      'home decor',
      'skincare products',
      'running shoes',
      'portable chargers',
      'desk organizers',
      'kitchen gadgets'
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

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        size={12}
        className={i < Math.floor(rating) ? 'text-yellow-400 fill-current' : 'text-gray-400'}
      />
    ));
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
                  Xeno Shopping
                </h1>
                <p className="text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
                  Smart shopping search with price comparison, reviews, and deals across thousands of stores.
                </p>
              </div>

              {/* Welcome Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                {[
                  {
                    icon: ShoppingCart,
                    title: 'Product Search',
                    description: 'Find products across multiple stores with real-time price comparison and availability.'
                  },
                  {
                    icon: Tag,
                    title: 'Best Deals',
                    description: 'Discover the latest discounts, sales, and promotional offers from top retailers.'
                  },
                  {
                    icon: Star,
                    title: 'Reviews & Ratings',
                    description: 'Access comprehensive product reviews and ratings to make informed purchasing decisions.'
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
            {/* Shopping Results */}
            {searchResults.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white">
                  Shopping Results ({searchResults.length})
                </h2>

                {searchResults.map((result) => (
                  <div key={result.id} className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-4 hover:border-gray-600 transition-colors">
                    <div className="flex gap-4">
                      <div className="flex-shrink-0">
                        <div className="w-24 h-24 bg-zinc-800 rounded-lg flex items-center justify-center">
                          <Package className="w-8 h-8 text-gray-400" />
                        </div>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <h3 className="font-medium text-white text-lg mb-2 line-clamp-2">{result.title}</h3>
                            
                            <div className="flex items-center gap-2 mb-2">
                              <div className="flex items-center gap-1">
                                {renderStars(result.rating)}
                                <span className="text-sm text-gray-400 ml-1">
                                  {result.rating} ({result.reviewCount} reviews)
                                </span>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-4 text-sm">
                              <div className="flex items-center gap-2">
                                <span className="text-2xl font-bold text-white">{result.price}</span>
                                {result.originalPrice && (
                                  <span className="text-gray-400 line-through">{result.originalPrice}</span>
                                )}
                                {result.discount && (
                                  <span className="bg-red-600 text-white px-2 py-1 rounded text-xs">
                                    {result.discount}
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                              <span>Source: {result.source}</span>
                              <span className={`px-2 py-1 rounded-full ${
                                result.availability === 'In Stock' 
                                  ? 'bg-green-900/50 text-green-400' 
                                  : 'bg-yellow-900/50 text-yellow-400'
                              }`}>
                                {result.availability}
                              </span>
                              <a 
                                href={result.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-gray-400 hover:text-white"
                              >
                                <ExternalLink size={12} />
                                View product
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
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* No Results State */}
            {!isSearching && searchResults.length === 0 && !showWelcome && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <ShoppingCart size={48} className="text-gray-400 mb-4" />
                <h3 className="text-xl font-medium text-white mb-2">No products found</h3>
                <p className="text-gray-400">Try adjusting your search terms or search type</p>
              </div>
            )}

            {/* Loading State */}
            {isSearching && (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 bg-gray-400 rounded-full flex items-center justify-center mb-6">
                  <ShoppingCart className="w-8 h-8 text-zinc-900 animate-pulse" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-4">Searching products...</h3>
                <p className="text-gray-400">Finding the best deals and prices</p>
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
                        <ShoppingCart className="w-4 h-4 text-gray-400 flex-shrink-0" />
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
                    placeholder="Search for products, deals, and reviews..."
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
                      onClick={() => setSearchType('products')}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                        searchType === 'products' 
                          ? 'bg-gray-400 text-zinc-900' 
                          : 'text-gray-300 hover:bg-zinc-800'
                      }`}
                    >
                      Products
                    </button>
                    <button 
                      onClick={() => setSearchType('deals')}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                        searchType === 'deals' 
                          ? 'bg-gray-400 text-zinc-900' 
                          : 'text-gray-300 hover:bg-zinc-800'
                      }`}
                    >
                      Deals
                    </button>
                    <button 
                      onClick={() => setSearchType('reviews')}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                        searchType === 'reviews' 
                          ? 'bg-gray-400 text-zinc-900' 
                          : 'text-gray-300 hover:bg-zinc-800'
                      }`}
                    >
                      Reviews
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

export default ShoppingSearchInterface;

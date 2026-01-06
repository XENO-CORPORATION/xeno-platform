import React, { useState, useEffect } from 'react';
import { Search, Filter, ArrowDown, ArrowUp, Download, Copy, Share2, Trash2, RotateCw, Calendar, Clock, Tag, Grid3X3, Grid2X2, X, Play } from 'lucide-react';

interface GalleryItem {
  id: string;
  title?: string;
  description?: string;
  type: 'image' | 'video' | 'svg';
  url: string;
  thumbnailUrl?: string;
  prompt?: string;
  created: Date;
  tags?: string[];
  model?: string;
  settings?: Record<string, any>;
  inProgress?: boolean;
}

interface GalleryViewProps {
  title: string;
  subtitle?: string;
  items: GalleryItem[];
  onDownload?: (item: GalleryItem) => void;
  onDelete?: (item: GalleryItem) => void;
  onSelect?: (item: GalleryItem) => void;
  emptyMessage?: string;
  type?: 'generation' | 'upscale';
}

const GalleryView: React.FC<GalleryViewProps> = ({
  title,
  subtitle,
  items,
  onDownload,
  onDelete,
  onSelect,
  emptyMessage = "No items found",
  type = 'generation'
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [gridColumns, setGridColumns] = useState<2 | 3 | 4>(3);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filteredItems, setFilteredItems] = useState<GalleryItem[]>([]);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  
  // Extract all unique tags from items
  const allTags = Array.from(new Set(items.flatMap(item => item.tags || [])));
  
  // Filter and sort items based on search, tags, and sort options
  useEffect(() => {
    setIsLoading(true);
    
    // Apply filters
    let filtered = [...items];
    
    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(item => 
        (item.title?.toLowerCase().includes(term)) || 
        (item.description?.toLowerCase().includes(term)) || 
        (item.prompt?.toLowerCase().includes(term)) ||
        (item.tags?.some(tag => tag.toLowerCase().includes(term)))
      );
    }
    
    // Tag filter
    if (selectedTags.length > 0) {
      filtered = filtered.filter(item => 
        selectedTags.every(tag => item.tags?.includes(tag))
      );
    }
    
    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'date') {
        return sortDirection === 'asc' 
          ? a.created.getTime() - b.created.getTime()
          : b.created.getTime() - a.created.getTime();
      } else {
        const aName = a.title || '';
        const bName = b.title || '';
        return sortDirection === 'asc'
          ? aName.localeCompare(bName)
          : bName.localeCompare(aName);
      }
    });
    
    // Simulate loading
    setTimeout(() => {
      setFilteredItems(filtered);
      setIsLoading(false);
    }, 300);
  }, [items, searchTerm, selectedTags, sortBy, sortDirection]);
  
  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };
  
  const toggleSortDirection = () => {
    setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
  };
  
  const handleDelete = (item: GalleryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      if (confirm(`Are you sure you want to delete this ${item.type}?`)) {
        onDelete(item);
      }
    }
  };
  
  const handleDownload = (item: GalleryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDownload) {
      onDownload(item);
    }
  };
  
  const formatDate = (date: Date) => {
    // Check if the date is today
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    // Check if the date is yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    // Otherwise show full date
    return date.toLocaleDateString(undefined, { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
    });
  };
  
  return (
    <div className="flex flex-col h-full">
      <div className="bg-[rgba(30,30,30,0.7)] border border-white/10 rounded-xl p-5 flex-grow flex flex-col">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
          <div>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {subtitle && <p className="text-white/60 text-sm mt-1">{subtitle}</p>}
          </div>
          
          {/* View controls */}
          <div className="flex space-x-3 mt-3 md:mt-0">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2.5 rounded-lg border transition-colors ${
                viewMode === 'grid' 
                  ? 'bg-white/10 border-white/20 text-white' 
                  : 'border-white/10 text-white/60 hover:bg-white/5'
              }`}
              aria-label="Grid view"
            >
              <Grid3X3 size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2.5 rounded-lg border transition-colors ${
                viewMode === 'list' 
                  ? 'bg-white/10 border-white/20 text-white' 
                  : 'border-white/10 text-white/60 hover:bg-white/5'
              }`}
              aria-label="List view"
            >
              <Grid2X2 size={18} />
            </button>
            
            {viewMode === 'grid' && (
              <select
                value={gridColumns}
                onChange={(e) => setGridColumns(Number(e.target.value) as 2 | 3 | 4)}
                className="bg-[rgba(0,0,0,0.2)] text-white border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-white/20"
                aria-label="Select grid columns"
              >
                <option value={2}>2 Columns</option>
                <option value={3}>3 Columns</option>
                <option value={4}>4 Columns</option>
              </select>
            )}
          </div>
        </div>
        
        {/* Search and filters */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-grow">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search size={18} className="text-white/40" />
            </div>
            <input
              type="text"
              placeholder="Search by title, prompt, or tags..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[rgba(0,0,0,0.2)] text-white placeholder-white/40 py-2.5 pl-12 pr-4 rounded-lg border border-white/10 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
          
          <div className="flex space-x-3">
            <div className="relative">
              <button 
                className={`flex items-center space-x-2 bg-[rgba(0,0,0,0.2)] text-white border ${isFiltersOpen ? 'border-white/30 bg-[rgba(255,255,255,0.1)]' : 'border-white/10'} px-4 py-2.5 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors`}
                onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                aria-expanded={isFiltersOpen}
              >
                <Filter size={18} />
                <span>{isFiltersOpen ? 'Hide Filters' : 'Filter'}</span>
              </button>
              
              {isFiltersOpen && allTags.length > 0 && (
                <div className="absolute right-0 mt-2 p-3 bg-[rgba(20,20,20,0.95)] border border-white/10 rounded-lg shadow-lg z-10 w-64">
                  <h3 className="text-sm font-medium text-white/90 mb-2">Filter by tags</h3>
                  <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                    {allTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={`px-3 py-1 rounded-full text-sm transition-colors ${
                          selectedTags.includes(tag)
                            ? 'bg-white text-primary-bg'
                            : 'bg-[rgba(255,255,255,0.1)] text-white/70 hover:bg-[rgba(255,255,255,0.2)]'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <button
              onClick={() => {
                if (sortBy === 'date') {
                  setSortBy('name');
                } else {
                  setSortBy('date');
                }
              }}
              className="flex items-center space-x-2 bg-[rgba(0,0,0,0.2)] text-white border border-white/10 px-4 py-2.5 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors"
              aria-label={`Sort by ${sortBy === 'date' ? 'Name' : 'Date'}`}
            >
              {sortBy === 'date' ? <Calendar size={18} /> : <Tag size={18} />}
              <span>{sortBy === 'date' ? 'Date' : 'Name'}</span>
            </button>
            
            <button
              onClick={toggleSortDirection}
              className="bg-[rgba(0,0,0,0.2)] text-white border border-white/10 px-4 py-2.5 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors"
              aria-label={`Sort ${sortDirection === 'asc' ? 'Descending' : 'Ascending'}`}
            >
              {sortDirection === 'asc' ? <ArrowUp size={18} /> : <ArrowDown size={18} />}
            </button>
          </div>
        </div>
        
        {/* Tags */}
        {selectedTags.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-sm text-white/70">Active filters:</span>
              {selectedTags.map((tag) => (
                <div 
                  key={tag}
                  className="flex items-center space-x-1 px-3 py-1 bg-white text-primary-bg rounded-full text-sm"
                >
                  <span>{tag}</span>
                  <button
                    onClick={() => toggleTag(tag)}
                    className="ml-1 hover:text-gray-800 transition-colors"
                    aria-label={`Remove ${tag} filter`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setSelectedTags([])}
                className="text-white/60 hover:text-white text-sm underline ml-2"
              >
                Clear all
              </button>
            </div>
          </div>
        )}
        
        {/* Gallery content */}
        <div className="flex-grow overflow-auto pr-1">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <RotateCw size={30} className="text-white/50 animate-spin mx-auto mb-4" />
                <p className="text-white/60">Loading gallery items...</p>
              </div>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-white/50">
              <p className="mb-3 text-lg font-medium">{emptyMessage}</p>
              <p className="text-white/40 text-center max-w-md mb-4">
                {searchTerm || selectedTags.length > 0 
                  ? "No items match your current filters. Try adjusting your search criteria." 
                  : type === 'generation' 
                    ? "Generate your first content in the Generation tab to see it here."
                    : "Enhance your first content in the Upscaler tab to see it here."
                }
              </p>
              {(searchTerm || selectedTags.length > 0) && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedTags([]);
                  }}
                  className="text-white/70 hover:text-white underline text-sm px-4 py-2 bg-white/5 rounded-lg transition-colors hover:bg-white/10"
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <>
              {viewMode === 'grid' ? (
                <div className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-${gridColumns} gap-5`}>
                  {filteredItems.map((item) => (
                    <div 
                      key={item.id} 
                      className="bg-black/20 rounded-lg overflow-hidden border border-white/10 transition-all hover:border-white/30"
                    >
                      <div 
                        className="cursor-pointer"
                        onClick={() => onSelect && onSelect(item)}
                      >
                        {item.type === 'image' ? (
                          <img 
                            src={item.thumbnailUrl || item.url} 
                            alt={item.title || 'Gallery item'} 
                            className="w-full h-44 object-cover"
                            loading="lazy"
                          />
                        ) : item.type === 'svg' ? (
                          // Handle SVG display with special styling
                          <div className="w-full h-44 bg-gray-800 flex items-center justify-center relative">
                            <img 
                              src={item.thumbnailUrl || item.url} 
                              alt={item.title || 'SVG graphic'} 
                              className="h-full w-full object-contain p-4"
                              loading="lazy"
                            />
                            <div className="absolute bottom-2 right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
                              SVG
                            </div>
                          </div>
                        ) : (
                          // Video thumbnail
                          <div className="w-full h-44 bg-gray-900 flex items-center justify-center relative">
                            <video 
                              src={item.url} 
                              className="w-full h-44 object-cover"
                              muted
                              loop
                              preload="metadata"
                              poster={item.thumbnailUrl}
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="bg-black/40 rounded-full p-3">
                                <Play size={16} className="text-white" />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Item meta overlay */}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-4">
                        <div className="text-white/90 truncate font-medium text-sm">
                          {item.title || (item.prompt && item.prompt.substring(0, 30) + '...') || `${item.type.charAt(0).toUpperCase() + item.type.slice(1)} ${item.id}`}
                        </div>
                        <div className="flex items-center text-xs text-white/60 mt-1">
                          <Clock size={12} className="mr-1" />
                          <span>{formatDate(item.created)}</span>
                        </div>
                      </div>
                      
                      {/* Action buttons */}
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <div className="flex space-x-1 backdrop-blur-sm bg-black/30 p-1 rounded-lg">
                          <button
                            onClick={(e) => handleDownload(item, e)}
                            className="p-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                            aria-label="Download"
                          >
                            <Download size={16} />
                          </button>
                          <button
                            onClick={(e) => handleDelete(item, e)}
                            className="p-1.5 rounded-md text-white/80 hover:text-red-400 hover:bg-white/10 transition-colors"
                            aria-label="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="p-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                            aria-label="Share"
                          >
                            <Share2 size={16} />
                          </button>
                        </div>
                      </div>
                      
                      {/* Model badge */}
                      {item.model && (
                        <div className="absolute top-2 left-2 bg-black/40 backdrop-blur-sm text-white/90 px-2 py-0.5 rounded text-xs">
                          {item.model}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-4 overflow-auto">
                  {filteredItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex border border-white/10 rounded-lg overflow-hidden bg-[rgba(0,0,0,0.2)] hover:bg-[rgba(0,0,0,0.3)] cursor-pointer hover:border-white/30 transition-all transform-gpu shadow-sm hover:shadow-md"
                      onClick={() => onSelect && onSelect(item)}
                    >
                      <div className="w-28 h-28 shrink-0">
                        {item.type === 'image' ? (
                          <img
                            src={item.thumbnailUrl || item.url}
                            alt={item.title || 'Gallery item'}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="relative w-full h-full">
                            <video
                              src={item.url}
                              className="w-full h-full object-cover"
                              muted
                              preload="metadata"
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="bg-black/40 rounded-full p-1.5">
                                <Play size={16} className="text-white" />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-grow p-4 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center">
                            <div className="text-white font-medium truncate mr-3">
                              {item.title || (item.prompt && item.prompt.substring(0, 30) + '...') || `${item.type.charAt(0).toUpperCase() + item.type.slice(1)} ${item.id}`}
                            </div>
                            {item.model && (
                              <span className="px-2 py-0.5 bg-white/10 rounded-full text-xs text-white/90">
                                {item.model}
                              </span>
                            )}
                          </div>
                          {item.prompt && (
                            <p className="text-white/60 text-sm truncate max-w-lg mt-1">
                              {item.prompt}
                            </p>
                          )}
                          
                          {/* Tags */}
                          {item.tags && item.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {item.tags.map(tag => (
                                <span key={tag} className="inline-block px-2 py-0.5 bg-white/5 rounded-full text-xs text-white/70">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        
                        <div className="flex items-center justify-between text-xs text-white/60 mt-3">
                          <div className="flex items-center">
                            <Clock size={12} className="mr-1" />
                            <span>{formatDate(item.created)}</span>
                          </div>
                          
                          <div className="flex space-x-3">
                            <button
                              onClick={(e) => handleDownload(item, e)}
                              className="p-1.5 rounded text-white/80 hover:text-white hover:bg-white/5 transition-colors"
                              aria-label="Download"
                            >
                              <Download size={16} />
                            </button>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className="p-1.5 rounded text-white/80 hover:text-white hover:bg-white/5 transition-colors"
                              aria-label="Copy"
                            >
                              <Copy size={16} />
                            </button>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className="p-1.5 rounded text-white/80 hover:text-white hover:bg-white/5 transition-colors"
                              aria-label="Share"
                            >
                              <Share2 size={16} />
                            </button>
                            <button
                              onClick={(e) => handleDelete(item, e)}
                              className="p-1.5 rounded text-white/80 hover:text-red-400 transition-colors"
                              aria-label="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        
        {/* Results count and pagination (only show if we have items) */}
        {filteredItems.length > 0 && (
          <div className="mt-5 pt-4 border-t border-white/10 flex justify-between items-center text-sm text-white/60">
            <div>
              Showing {filteredItems.length} of {items.length} items
            </div>
            <div className="flex items-center space-x-2">
              <button className="px-3 py-1 border border-white/10 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50 disabled:pointer-events-none" disabled>
                Previous
              </button>
              <span className="px-3 py-1 bg-white/10 rounded-lg">1</span>
              <button className="px-3 py-1 border border-white/10 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50 disabled:pointer-events-none" disabled>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GalleryView;
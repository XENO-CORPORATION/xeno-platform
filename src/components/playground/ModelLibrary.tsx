import React, { useState, useEffect } from 'react';
import { Search, Filter, ArrowDown, ArrowUp, Download, Trash2, Play, Code, RotateCw, BrainCircuit, Palette, Star, Calendar, Clock, Sparkles, CheckCircle2, X, PlayCircle, Tag, Info, ChevronRight, ArrowRight, Box } from 'lucide-react';

interface ModelItem {
  id: string;
  name: string;
  type: string;
  baseModel: string;
  description: string;
  accuracy: number;
  loss: number;
  trainingTime: string;
  steps: number;
  epochs: number;
  batchSize: number;
  learningRate: number;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  samples: Array<{
    type: "image" | "text";
    content: string;
  }>;
}

interface ModelLibraryProps {
  title: string;
  subtitle: string;
  items: ModelItem[];
  onDownload: (item: ModelItem) => void;
  onDelete: (item: ModelItem) => void;
  onSelectModel: (item: ModelItem) => void;
  onTest: (item: ModelItem) => void;
  emptyMessage: string;
}

const ModelLibrary: React.FC<ModelLibraryProps> = ({
  title,
  subtitle,
  items,
  onDownload,
  onDelete,
  onSelectModel,
  onTest,
  emptyMessage,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'accuracy'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedModelTypes, setSelectedModelTypes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filteredItems, setFilteredItems] = useState<ModelItem[]>([]);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  
  // Extract all unique tags from items
  const allTags = Array.from(new Set(items.flatMap(item => item.tags || [])));
  
  // Extract all model types
  const modelTypes = Array.from(new Set(items.map(item => item.type)));
  
  // Filter and sort items based on search, tags, and sort options
  useEffect(() => {
    setIsLoading(true);
    
    // Apply filters
    let filtered = [...items];
    
    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(item => 
        (item.name.toLowerCase().includes(term)) || 
        (item.description.toLowerCase().includes(term)) || 
        (item.baseModel.toLowerCase().includes(term)) ||
        (item.tags.some(tag => tag.toLowerCase().includes(term)))
      );
    }
    
    // Tag filter
    if (selectedTags.length > 0) {
      filtered = filtered.filter(item => 
        selectedTags.every(tag => item.tags.includes(tag))
      );
    }
    
    // Model type filter
    if (selectedModelTypes.length > 0) {
      filtered = filtered.filter(item => 
        selectedModelTypes.includes(item.type)
      );
    }
    
    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'date') {
        return sortDirection === 'asc' 
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt);
      } else if (sortBy === 'accuracy') {
        const aAccuracy = a.accuracy || 0;
        const bAccuracy = b.accuracy || 0;
        return sortDirection === 'asc'
          ? aAccuracy - bAccuracy
          : bAccuracy - aAccuracy;
      } else {
        return sortDirection === 'asc'
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
    });
    
    // Simulate loading
    setTimeout(() => {
      setFilteredItems(filtered);
      setIsLoading(false);
    }, 300);
  }, [items, searchTerm, selectedTags, selectedModelTypes, sortBy, sortDirection]);
  
  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };
  
  const toggleModelType = (type: string) => {
    setSelectedModelTypes(prev => 
      prev.includes(type) 
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };
  
  const toggleSortDirection = () => {
    setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
  };
  
  const handleDelete = (item: ModelItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      if (confirm(`Are you sure you want to delete "${item.name}"?`)) {
        onDelete(item);
      }
    }
  };
  
  const handleDownload = (item: ModelItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDownload) {
      onDownload(item);
    }
  };
  
  const handleTest = (item: ModelItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onTest) {
      onTest(item);
    }
  };
  
  const formatDate = (date: string) => {
    const formattedDate = new Date(date).toLocaleDateString();
    return formattedDate;
  };
  
  const formatSize = (bytes?: number) => {
    if (bytes === undefined) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };
  
  const formatNumber = (num?: number) => {
    if (num === undefined) return 'Unknown';
    return num.toLocaleString();
  };
  
  return (
    <div className="space-y-6">
      <div className="bg-[rgba(20,20,20,0.6)] border border-white/10 rounded-xl p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-white flex items-center mb-3">
          <Box size={18} className="mr-2 text-blue-400" />
          {title}
        </h2>
        <p className="text-white/70">{subtitle}</p>
      </div>
      
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 bg-[rgba(20,20,20,0.6)] border border-white/10 rounded-xl text-center">
          <div className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-full p-4 mb-4 shadow-inner">
            <Info size={28} className="text-white/60" />
          </div>
          <h3 className="text-xl font-medium text-white mb-2">{emptyMessage}</h3>
          <p className="text-white/70 max-w-md mx-auto mb-6">
            Train your first model to see it appear in this library. You can then download, manage, and use your models for inference.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredItems.map((item) => (
            <div 
              key={item.id} 
              className="bg-[rgba(20,20,20,0.6)] border border-white/10 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all"
            >
              <div className="p-6">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white flex items-center">
                      {item.name}
                    </h3>
                    <p className="text-white/70 text-sm mt-1">
                      {item.description}
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button 
                      className="p-2 bg-[rgba(30,30,30,0.4)] hover:bg-[rgba(40,40,40,0.5)] rounded-lg text-blue-400 hover:text-blue-300 transition-colors" 
                      onClick={() => onTest(item)}
                      title="Test model"
                    >
                      <PlayCircle size={18} />
                    </button>
                    <button 
                      className="p-2 bg-[rgba(30,30,30,0.4)] hover:bg-[rgba(40,40,40,0.5)] rounded-lg text-green-400 hover:text-green-300 transition-colors" 
                      onClick={() => onDownload(item)}
                      title="Download model"
                    >
                      <Download size={18} />
                    </button>
                    <button 
                      className="p-2 bg-[rgba(30,30,30,0.4)] hover:bg-[rgba(40,40,40,0.5)] rounded-lg text-red-400 hover:text-red-300 transition-colors" 
                      onClick={() => onDelete(item)}
                      title="Delete model"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-3 my-4">
                  <div className="bg-[rgba(30,30,30,0.4)] rounded-lg p-3 text-center">
                    <div className="text-xs text-white/60 mb-1">Base Model</div>
                    <div className="text-sm text-white font-medium truncate" title={item.baseModel}>
                      {item.baseModel}
                    </div>
                  </div>
                  <div className="bg-[rgba(30,30,30,0.4)] rounded-lg p-3 text-center">
                    <div className="text-xs text-white/60 mb-1">Training Steps</div>
                    <div className="text-sm text-white font-medium">
                      {item.steps.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-[rgba(30,30,30,0.4)] rounded-lg p-3 text-center">
                    <div className="text-xs text-white/60 mb-1">Accuracy</div>
                    <div className="text-sm text-white font-medium">
                      {(item.accuracy * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-2 mb-4">
                  {item.tags.map((tag, index) => (
                    <div 
                      key={index} 
                      className="text-xs px-2 py-1 bg-blue-500/20 text-blue-300 rounded-full flex items-center"
                    >
                      <Tag size={10} className="mr-1" />
                      {tag}
                    </div>
                  ))}
                </div>
                
                <div className="flex justify-between text-xs text-white/60">
                  <div className="flex items-center">
                    <Calendar size={12} className="mr-1" />
                    Created: {new Date(item.createdAt).toLocaleDateString()}
                  </div>
                  <button 
                    className="flex items-center hover:text-blue-400 transition-colors"
                    onClick={() => onSelectModel(item)}
                  >
                    View Details
                    <ArrowRight size={12} className="ml-1" />
                  </button>
                </div>
              </div>
              
              {item.samples && item.samples.length > 0 && (
                <div className="grid grid-cols-3 border-t border-white/5">
                  {item.samples.slice(0, 3).map((sample, index) => (
                    <div key={index} className="aspect-video border-r last:border-r-0 border-white/5 overflow-hidden">
                      {sample.type === "image" ? (
                        <img 
                          src={sample.content} 
                          alt={`Sample ${index + 1}`} 
                          className="w-full h-full object-cover hover:scale-105 transition-transform"
                        />
                      ) : (
                        <div className="bg-[rgba(10,10,10,0.4)] p-3 h-full overflow-hidden text-white/70 text-xs">
                          <div className="line-clamp-5">{sample.content}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModelLibrary;
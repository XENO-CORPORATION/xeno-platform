import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { GenerationRecord } from '../../../../services/generationHistoryService';

interface GenerationHistoryProps {
  generations: GenerationRecord[];
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onDelete: (generationId: string) => void;
  onToggleFavorite?: (generationId: string) => void;
  onSelectGeneration?: (generation: GenerationRecord) => void;
}

type TimeFilter = 'all' | 'today' | 'week' | 'month';

// Selected image info (generation id + image index)
interface SelectedImage {
  generationId: string;
  imageIndex: number;
  imageUrl: string;
}

interface DeleteModalProps {
  isOpen: boolean;
  generationId: string | null;
  count?: number; // For bulk delete
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteConfirmModal: React.FC<DeleteModalProps> = ({
  isOpen,
  count,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  const isBulk = count && count > 1;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#1f1f20] border border-[#3a3a3d] rounded-lg shadow-xl max-w-sm w-full overflow-hidden">
        <div className="p-4">
          <h2 className="text-lg font-semibold text-white">
            {isBulk ? `Delete ${count} images?` : 'Delete generation?'}
          </h2>
        </div>
        <hr className="border-t border-[#3a3a3d]" />
        <div className="p-4">
          <p className="text-sm text-gray-300">
            {isBulk
              ? `This will permanently remove ${count} selected images from your history.`
              : 'This will permanently remove this generation from your history.'
            }
          </p>
        </div>
        <div className="flex justify-end gap-3 bg-zinc-800/30 px-4 py-3 border-t border-[#3a3a3d]">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded-md text-sm font-medium text-gray-300 bg-zinc-600/50 hover:bg-zinc-600/80 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 rounded-md text-sm font-medium text-black bg-white/80 hover:bg-white transition-colors"
          >
            {isBulk ? `Delete ${count}` : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Simple image thumbnail component - no settings info
const ImageThumbnail: React.FC<{
  imageUrl: string;
  generation: GenerationRecord;
  imageIndex: number;
  onDelete: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (generationId: string, imageIndex: number, imageUrl: string) => void;
  minWidth: number;
  rowHeight: number;
}> = ({
  imageUrl,
  generation,
  imageIndex,
  onDelete,
  onToggleFavorite,
  isSelectionMode,
  isSelected,
  onToggleSelect,
  minWidth,
  rowHeight,
}) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Always toggle selection when clicking on an image
    onToggleSelect(generation.id, imageIndex, imageUrl);
  };

  return (
    <div
      className={`relative group w-full bg-[#050505] rounded-[16px] overflow-hidden border transition-all cursor-pointer ${
        isSelected
          ? 'border-white/70 ring-2 ring-white/30'
          : 'border-[#2a2a2d] hover:border-[#4a4a4d]'
      }`}
      onClick={handleClick}
      style={{ minWidth: `${minWidth}px`, flex: `1 1 ${minWidth}px`, height: `${rowHeight}px` }}
    >
      <img
        src={imageUrl}
        alt="Generated"
        className="w-full h-full object-cover block"
        loading="lazy"
      />

      {/* Selection checkbox - shown in selection mode or on hover */}
      <div
        className={`absolute top-1.5 left-1.5 transition-all ${
          isSelectionMode || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(generation.id, imageIndex, imageUrl);
          }}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all cursor-pointer ${
            isSelected
              ? 'bg-white/80 border-white/80'
              : 'bg-black/50 border-white/50 hover:border-white'
          }`}
        >
          {isSelected && (
            <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      </div>

      {/* Favorite indicator - small star in corner */}
      {generation.is_favorite && !isSelectionMode && (
        <div className="absolute top-1 right-1 text-white/80 pointer-events-none">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </div>
      )}

      {/* Hover overlay - only shown when not in selection mode */}
      {!isSelectionMode && (
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
          {/* Favorite button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite?.(generation.id);
            }}
            className={`p-1.5 backdrop-blur-sm rounded transition-all ${
              generation.is_favorite
                ? 'bg-white/20 text-white'
                : 'bg-black/50 text-white/80 hover:bg-white/20 hover:text-white'
            }`}
            title={generation.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <svg
              className="w-3.5 h-3.5"
              fill={generation.is_favorite ? 'currentColor' : 'none'}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
              />
            </svg>
          </button>

          {/* Delete button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(generation.id);
            }}
            className="p-1.5 bg-black/50 backdrop-blur-sm rounded hover:bg-red-500/40 transition-all"
            title="Delete"
          >
            <svg className="w-3.5 h-3.5 text-white/80 hover:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

const LoadingSkeleton: React.FC<{ minWidth: number; rowHeight: number }> = ({ minWidth, rowHeight }) => (
  <div
    className="bg-[#0a0a0c] rounded-[16px] overflow-hidden border border-[#2a2a2d] animate-pulse"
    style={{ minWidth: `${minWidth}px`, flex: `1 1 ${minWidth}px`, height: `${rowHeight}px` }}
  />
);

export const GenerationHistory: React.FC<GenerationHistoryProps> = ({
  generations,
  isLoading,
  hasMore,
  onLoadMore,
  onDelete,
  onToggleFavorite,
  onSelectGeneration,
}) => {
  const observerRef = useRef<HTMLDivElement>(null);
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; generationId: string | null; count?: number }>({
    isOpen: false,
    generationId: null,
  });

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedAspectRatios, setSelectedAspectRatios] = useState<string[]>([]);
  const [selectedResolutions, setSelectedResolutions] = useState<string[]>([]);

  // View options
  const [imageSize, setImageSize] = useState(3); // 1-5 scale, 3 is default

  // Expanded filter sections
  const [expandedFilters, setExpandedFilters] = useState<string[]>([]);

  // Selection mode state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);

  // Mobile filter panel state
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const thumbnailConfig = useMemo(() => {
    switch (imageSize) {
      case 1: return { minWidth: 320, rowHeight: 320 };
      case 2: return { minWidth: 300, rowHeight: 300 };
      case 3: return { minWidth: 260, rowHeight: 260 };
      case 4: return { minWidth: 230, rowHeight: 230 };
      case 5: return { minWidth: 200, rowHeight: 200 };
      default: return { minWidth: 260, rowHeight: 260 };
    }
  }, [imageSize]);

  const { minWidth, rowHeight } = thumbnailConfig;

  const galleryFlexStyle = useMemo(() => ({
    gap: '12px',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  }), []);

  // Get unique values for filters
  const availableModels = useMemo(() => {
    const models = new Set(generations.map(g => g.model));
    return Array.from(models).filter(Boolean).sort();
  }, [generations]);

  const availableAspectRatios = useMemo(() => {
    const ratios = new Set(generations.map(g => g.aspect_ratio));
    return Array.from(ratios).filter(Boolean).sort();
  }, [generations]);

  const availableResolutions = useMemo(() => {
    const resolutions = new Set(generations.map(g => g.resolution));
    return Array.from(resolutions).filter(Boolean).sort();
  }, [generations]);

  // Filter generations
  const filteredGenerations = useMemo(() => {
    return generations.filter(gen => {
      // Search filter
      if (searchQuery && !gen.prompt.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }

      // Time filter
      if (timeFilter !== 'all') {
        const genDate = new Date(gen.created_at);
        const now = new Date();
        const diffMs = now.getTime() - genDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        if (timeFilter === 'today' && diffDays > 1) return false;
        if (timeFilter === 'week' && diffDays > 7) return false;
        if (timeFilter === 'month' && diffDays > 30) return false;
      }

      // Model filter
      if (selectedModels.length > 0 && !selectedModels.includes(gen.model)) {
        return false;
      }

      // Aspect ratio filter
      if (selectedAspectRatios.length > 0 && !selectedAspectRatios.includes(gen.aspect_ratio)) {
        return false;
      }

      // Resolution filter
      if (selectedResolutions.length > 0 && !selectedResolutions.includes(gen.resolution)) {
        return false;
      }

      return true;
    });
  }, [generations, searchQuery, timeFilter, selectedModels, selectedAspectRatios, selectedResolutions]);

  // Check if any filters are active
  const hasActiveFilters = searchQuery || timeFilter !== 'all' || selectedModels.length > 0 || selectedAspectRatios.length > 0 || selectedResolutions.length > 0;

  // Clear all filters
  const clearAllFilters = () => {
    setSearchQuery('');
    setTimeFilter('all');
    setSelectedModels([]);
    setSelectedAspectRatios([]);
    setSelectedResolutions([]);
  };

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadMore]);

  const handleDeleteClick = (generationId: string) => {
    setDeleteModal({ isOpen: true, generationId });
  };

  const handleConfirmDelete = () => {
    if (deleteModal.count && deleteModal.count > 1) {
      // Bulk delete
      confirmBulkDelete();
    } else if (deleteModal.generationId) {
      // Single delete
      onDelete(deleteModal.generationId);
      setDeleteModal({ isOpen: false, generationId: null });
    }
  };

  const handleCancelDelete = () => {
    setDeleteModal({ isOpen: false, generationId: null });
  };

  const toggleModel = (model: string) => {
    setSelectedModels(prev =>
      prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]
    );
  };

  const toggleAspectRatio = (ratio: string) => {
    setSelectedAspectRatios(prev =>
      prev.includes(ratio) ? prev.filter(r => r !== ratio) : [...prev, ratio]
    );
  };

  const toggleResolution = (resolution: string) => {
    setSelectedResolutions(prev =>
      prev.includes(resolution) ? prev.filter(r => r !== resolution) : [...prev, resolution]
    );
  };

  const toggleFilterExpanded = (filter: string) => {
    setExpandedFilters(prev =>
      prev.includes(filter) ? prev.filter(f => f !== filter) : [...prev, filter]
    );
  };

  // Selection functions
  const toggleImageSelection = useCallback((generationId: string, imageIndex: number, imageUrl: string) => {
    setSelectedImages(prev => {
      const exists = prev.some(s => s.generationId === generationId && s.imageIndex === imageIndex);
      if (exists) {
        const newSelected = prev.filter(s => !(s.generationId === generationId && s.imageIndex === imageIndex));
        // Exit selection mode if no images selected
        if (newSelected.length === 0) {
          setIsSelectionMode(false);
        }
        return newSelected;
      } else {
        // Enter selection mode when first image is selected
        if (!isSelectionMode) {
          setIsSelectionMode(true);
        }
        return [...prev, { generationId, imageIndex, imageUrl }];
      }
    });
  }, [isSelectionMode]);

  const isImageSelected = useCallback((generationId: string, imageIndex: number) => {
    return selectedImages.some(s => s.generationId === generationId && s.imageIndex === imageIndex);
  }, [selectedImages]);

  const clearSelection = useCallback(() => {
    setSelectedImages([]);
    setIsSelectionMode(false);
  }, []);

  const selectAllVisible = useCallback(() => {
    const allImages: SelectedImage[] = [];
    filteredGenerations.forEach(gen => {
      gen.image_urls.forEach((url, idx) => {
        allImages.push({ generationId: gen.id, imageIndex: idx, imageUrl: url });
      });
    });
    setSelectedImages(allImages);
    setIsSelectionMode(true);
  }, [filteredGenerations]);

  // Download selected images
  const downloadSelectedImages = useCallback(async () => {
    if (selectedImages.length === 0) return;

    setIsDownloading(true);
    try {
      for (const img of selectedImages) {
        try {
          const response = await fetch(img.imageUrl);
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `generation-${img.generationId}-${img.imageIndex}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          // Small delay between downloads
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (err) {
          console.error('Failed to download image:', err);
        }
      }
    } finally {
      setIsDownloading(false);
    }
  }, [selectedImages]);

  // Delete selected images (by unique generation IDs)
  const handleBulkDelete = useCallback(() => {
    const uniqueGenerationIds = [...new Set(selectedImages.map(s => s.generationId))];
    setDeleteModal({ isOpen: true, generationId: null, count: uniqueGenerationIds.length });
  }, [selectedImages]);

  const confirmBulkDelete = useCallback(() => {
    const uniqueGenerationIds = [...new Set(selectedImages.map(s => s.generationId))];
    uniqueGenerationIds.forEach(id => onDelete(id));
    clearSelection();
    setDeleteModal({ isOpen: false, generationId: null });
  }, [selectedImages, onDelete, clearSelection]);

  // Group filtered generations by date
  const groupedByDate = filteredGenerations.reduce((groups, gen) => {
    const date = new Date(gen.created_at).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(gen);
    return groups;
  }, {} as Record<string, GenerationRecord[]>);

  // Loading state when no data yet - show simple loading without grid/filters
  if (isLoading && generations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-white/40">
        <svg className="w-12 h-12 mb-4 text-white/20 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <p className="text-lg mb-2">Loading...</p>
      </div>
    );
  }

  // Empty state for no generations at all
  if (!isLoading && generations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-white/40">
        <svg className="w-16 h-16 mb-4 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <p className="text-lg mb-2">No generations yet</p>
        <p className="text-sm text-white/30">Your image generations will appear here</p>
      </div>
    );
  }

  return (
    <>
      {/* Selection Toolbar - Rendered via portal at bottom center */}
      {selectedImages.length > 0 && createPortal(
        <div
          id="selection-toolbar-bottom"
          style={{
            position: 'fixed',
            bottom: '24px',
            top: 'auto',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 999999,
            backgroundColor: '#1a1a1c',
            border: '1px solid #3a3a3d',
            borderRadius: '12px',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}
        >
          {/* Close/Clear selection */}
          <button
            onClick={clearSelection}
            style={{ padding: '6px', borderRadius: '8px', background: 'transparent', border: 'none', cursor: 'pointer' }}
            title="Clear selection"
          >
            <svg style={{ width: '16px', height: '16px', color: 'rgba(255,255,255,0.6)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Selection count */}
          <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)' }}>
            {selectedImages.length} selected
          </span>

          {/* Divider */}
          <div style={{ width: '1px', height: '20px', backgroundColor: 'rgba(255,255,255,0.2)' }} />

          {/* Download button */}
          <button
            onClick={downloadSelectedImages}
            disabled={isDownloading}
            style={{ padding: '8px', borderRadius: '8px', background: 'transparent', border: 'none', cursor: 'pointer', opacity: isDownloading ? 0.5 : 1 }}
            title={`Download ${selectedImages.length} images`}
          >
            {isDownloading ? (
              <svg style={{ width: '16px', height: '16px', color: 'rgba(255,255,255,0.6)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg style={{ width: '16px', height: '16px', color: 'rgba(255,255,255,0.6)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
          </button>

          {/* Delete button */}
          <button
            onClick={handleBulkDelete}
            style={{ padding: '8px', borderRadius: '8px', background: 'transparent', border: 'none', cursor: 'pointer' }}
            title={`Delete ${[...new Set(selectedImages.map(s => s.generationId))].length} generations`}
          >
            <svg style={{ width: '16px', height: '16px', color: 'rgba(255,255,255,0.6)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>,
        document.body
      )}

      <div className="h-full overflow-y-auto">
        {/* Mobile Filter Button - Fixed top right on mobile */}
        <button
          onClick={() => setShowMobileFilters(!showMobileFilters)}
          className="md:hidden fixed top-20 right-3 z-50 w-10 h-10 bg-[#1a1a1c] border border-[#3a3a3d] rounded-lg flex items-center justify-center shadow-lg"
          style={{ boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.4)' }}
        >
          <svg className={`w-5 h-5 ${showMobileFilters || hasActiveFilters ? 'text-white' : 'text-white/50'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          {hasActiveFilters && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full" />
          )}
        </button>

        {/* Mobile Filter Panel */}
        {showMobileFilters && (
          <div className="md:hidden fixed top-32 right-3 w-52 z-50 bg-[#1a1a1c] border border-[#3a3a3d] rounded-lg p-2.5 shadow-xl max-h-[50vh] overflow-y-auto" style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}>
            {/* Close button */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-white/70 font-medium">Filters</span>
              <button onClick={() => setShowMobileFilters(false)} className="p-0.5 hover:bg-white/10 rounded">
                <svg className="w-3.5 h-3.5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* View Options */}
            <div className="mb-2">
              <label className="text-[10px] text-white/40 mb-1 block">View Size</label>
              <div className="flex items-center justify-between bg-[#0a0a0c] border border-[#2a2a2d] rounded p-0.5">
                <button
                  onClick={() => setImageSize(prev => Math.max(1, prev - 1))}
                  disabled={imageSize <= 1}
                  className={`p-1 rounded transition-all ${imageSize <= 1 ? 'text-white/20' : 'text-white/60'}`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                </button>
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <div key={level} className={`w-1 h-1 rounded-full ${level <= imageSize ? 'bg-white/60' : 'bg-white/20'}`} />
                  ))}
                </div>
                <button
                  onClick={() => setImageSize(prev => Math.min(5, prev + 1))}
                  disabled={imageSize >= 5}
                  className={`p-1 rounded transition-all ${imageSize >= 5 ? 'text-white/20' : 'text-white/60'}`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="mb-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full bg-[#0a0a0c] border border-[#2a2a2d] rounded px-2 py-1 text-xs text-white/80 placeholder-white/30 focus:outline-none"
              />
            </div>

            {/* Time Filter */}
            <div className="mb-2">
              <div className="grid grid-cols-4 gap-0.5">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'today', label: 'Day' },
                  { value: 'week', label: 'Week' },
                  { value: 'month', label: 'Month' },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setTimeFilter(option.value as TimeFilter)}
                    className={`px-1 py-1 rounded text-[10px] transition-all ${
                      timeFilter === option.value ? 'bg-white/20 text-white' : 'bg-[#0a0a0c] text-white/50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Clear filters button */}
            {hasActiveFilters && (
              <button
                onClick={() => { clearAllFilters(); setShowMobileFilters(false); }}
                className="w-full py-1.5 bg-white/10 hover:bg-white/20 rounded text-[10px] text-white/70 transition-all"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Main content - Images */}
        <div className="pr-0 md:pr-[272px]">
          {/* Gallery grouped by date */}
          <div className="p-4 space-y-6">
            {Object.entries(groupedByDate).map(([date, gens]) => (
              <div key={date}>
                {/* Date Header */}
                <div className="text-xs text-white/40 mb-3 pl-1">{date}</div>

                {/* Images Grid - Small thumbnails */}
                <div className="flex flex-wrap" style={galleryFlexStyle}>
                  {gens.flatMap((gen) =>
                    gen.image_urls.map((imageUrl, imgIndex) => (
                      <ImageThumbnail
                        key={`${gen.id}-${imgIndex}`}
                        imageUrl={imageUrl}
                        generation={gen}
                        imageIndex={imgIndex}
                        onDelete={handleDeleteClick}
                        onToggleFavorite={onToggleFavorite}
                        isSelectionMode={isSelectionMode}
                        isSelected={isImageSelected(gen.id, imgIndex)}
                        onToggleSelect={toggleImageSelection}
                        minWidth={minWidth}
                        rowHeight={rowHeight}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}

            {/* Empty state for filtered results */}
            {filteredGenerations.length === 0 && hasActiveFilters && (
              <div className="flex flex-col items-center justify-center py-16 text-white/40">
                <svg className="w-12 h-12 mb-4 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p className="text-base mb-2">No matching results</p>
                <p className="text-sm text-white/30 mb-4">Try adjusting your filters</p>
                <button
                  onClick={clearAllFilters}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-white/70 hover:text-white transition-all"
                >
                  Clear all filters
                </button>
              </div>
            )}

            {/* Loading skeletons */}
            {isLoading && (
              <div className="flex flex-wrap" style={galleryFlexStyle}>
                {Array.from({ length: 10 }).map((_, i) => (
                  <LoadingSkeleton
                    key={`skeleton-${i}`}
                    minWidth={minWidth}
                    rowHeight={rowHeight}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Load more trigger */}
          {hasMore && <div ref={observerRef} className="h-10" />}
        </div>

        {/* Filter Panel - Right Side (Fixed to viewport) - Hidden on mobile */}
        <div className="hidden md:block fixed top-[140px] right-[5.5%] w-64 space-y-2 overflow-y-auto max-h-[calc(100vh-160px)] z-40">
          {/* View Options */}
          <div className="bg-[#1a1a1c] border border-[#2a2a2d] rounded-lg p-3">
            <label className="text-xs text-white/40 mb-2 block">View Options</label>
            <div className="flex items-center justify-between bg-[#0a0a0c] border border-[#2a2a2d] rounded-lg p-1">
              {/* Minus button - makes images larger (fewer columns) */}
              <button
                onClick={() => setImageSize(prev => Math.max(1, prev - 1))}
                disabled={imageSize <= 1}
                className={`p-2 rounded-md transition-all ${
                  imageSize <= 1
                    ? 'text-white/20 cursor-not-allowed'
                    : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
                title="Larger images"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              </button>

              {/* Size indicator */}
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((level) => (
                  <div
                    key={level}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${
                      level <= imageSize ? 'bg-white/60' : 'bg-white/20'
                    }`}
                  />
                ))}
              </div>

              {/* Plus button - makes images smaller (more columns) */}
              <button
                onClick={() => setImageSize(prev => Math.min(5, prev + 1))}
                disabled={imageSize >= 5}
                className={`p-2 rounded-md transition-all ${
                  imageSize >= 5
                    ? 'text-white/20 cursor-not-allowed'
                    : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
                title="Smaller images"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="bg-[#1a1a1c] border border-[#2a2a2d] rounded-lg p-3">
            <label className="text-xs text-white/40 mb-2 block">Search prompt</label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full bg-[#0a0a0c] border border-[#2a2a2d] rounded-lg pl-9 pr-3 py-2 text-sm text-white/80 placeholder-white/30 focus:outline-none focus:border-[#3a3a3d]"
              />
            </div>
          </div>

          {/* Time Filter */}
          <div className="bg-[#1a1a1c] border border-[#2a2a2d] rounded-lg p-3">
            <button
              onClick={() => toggleFilterExpanded('time')}
              className="w-full flex items-center justify-between text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              <span>Time period</span>
              <svg
                className={`w-3 h-3 transition-transform ${expandedFilters.includes('time') ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedFilters.includes('time') && (
              <div className="grid grid-cols-2 gap-1.5 mt-2">
                {[
                  { value: 'all', label: 'All Time' },
                  { value: 'today', label: 'Today' },
                  { value: 'week', label: 'This Week' },
                  { value: 'month', label: 'This Month' },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setTimeFilter(option.value as TimeFilter)}
                    className={`px-3 py-1.5 rounded-md text-xs transition-all ${
                      timeFilter === option.value
                        ? 'bg-white/20 text-white'
                        : 'bg-[#0a0a0c] text-white/50 hover:bg-white/10 hover:text-white/70'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Model Filter */}
          {availableModels.length > 0 && (
            <div className="bg-[#1a1a1c] border border-[#2a2a2d] rounded-lg p-3">
              <button
                onClick={() => toggleFilterExpanded('model')}
                className="w-full flex items-center justify-between text-xs text-white/40 hover:text-white/60 transition-colors"
              >
                <span>Model</span>
                <svg
                  className={`w-3 h-3 transition-transform ${expandedFilters.includes('model') ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedFilters.includes('model') && (
                <div className="space-y-1.5 max-h-32 overflow-y-auto mt-2">
                  {availableModels.map((model) => (
                    <button
                      key={model}
                      onClick={() => toggleModel(model)}
                      className={`w-full px-3 py-1.5 rounded-md text-xs text-left transition-all truncate ${
                        selectedModels.includes(model)
                          ? 'bg-white/20 text-white'
                          : 'bg-[#0a0a0c] text-white/50 hover:bg-white/10 hover:text-white/70'
                      }`}
                    >
                      {model}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Aspect Ratio Filter */}
          {availableAspectRatios.length > 0 && (
            <div className="bg-[#1a1a1c] border border-[#2a2a2d] rounded-lg p-3">
              <button
                onClick={() => toggleFilterExpanded('aspect')}
                className="w-full flex items-center justify-between text-xs text-white/40 hover:text-white/60 transition-colors"
              >
                <span>Aspect Ratio</span>
                <svg
                  className={`w-3 h-3 transition-transform ${expandedFilters.includes('aspect') ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedFilters.includes('aspect') && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {availableAspectRatios.map((ratio) => (
                    <button
                      key={ratio}
                      onClick={() => toggleAspectRatio(ratio)}
                      className={`px-3 py-1.5 rounded-md text-xs transition-all ${
                        selectedAspectRatios.includes(ratio)
                          ? 'bg-white/20 text-white'
                          : 'bg-[#0a0a0c] text-white/50 hover:bg-white/10 hover:text-white/70'
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Resolution Filter */}
          {availableResolutions.length > 0 && (
            <div className="bg-[#1a1a1c] border border-[#2a2a2d] rounded-lg p-3">
              <button
                onClick={() => toggleFilterExpanded('resolution')}
                className="w-full flex items-center justify-between text-xs text-white/40 hover:text-white/60 transition-colors"
              >
                <span>Resolution</span>
                <svg
                  className={`w-3 h-3 transition-transform ${expandedFilters.includes('resolution') ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedFilters.includes('resolution') && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {availableResolutions.map((res) => (
                    <button
                      key={res}
                      onClick={() => toggleResolution(res)}
                      className={`px-3 py-1.5 rounded-md text-xs transition-all ${
                        selectedResolutions.includes(res)
                          ? 'bg-white/20 text-white'
                          : 'bg-[#0a0a0c] text-white/50 hover:bg-white/10 hover:text-white/70'
                      }`}
                    >
                      {res.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Results count */}
          <div className="bg-[#1a1a1c] border border-[#2a2a2d] rounded-lg p-3">
            <p className="text-xs text-white/30">
              {filteredGenerations.length} of {generations.length} generations
            </p>
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <DeleteConfirmModal
        isOpen={deleteModal.isOpen}
        generationId={deleteModal.generationId}
        count={deleteModal.count}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </>
  );
};

export default GenerationHistory;

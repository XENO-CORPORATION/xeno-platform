import { useState, useEffect, useCallback, useRef } from 'react';
import {
  generationHistoryService,
  GenerationRecord,
  SaveGenerationParams,
} from '../../../../services/generationHistoryService';

interface UseGenerationHistoryReturn {
  // State
  generations: GenerationRecord[];
  isLoading: boolean;
  hasMore: boolean;
  total: number;
  error: string | null;
  favoritesOnly: boolean;

  // Actions
  saveGeneration: (params: SaveGenerationParams) => Promise<GenerationRecord | null>;
  deleteGeneration: (generationId: string) => Promise<boolean>;
  toggleFavorite: (generationId: string) => Promise<boolean>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  setFavoritesOnly: (value: boolean) => void;
}

const PAGE_SIZE = 20;

export function useGenerationHistory(): UseGenerationHistoryReturn {
  const [generations, setGenerations] = useState<GenerationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [favoritesOnly, setFavoritesOnlyState] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'favorites';
  });

  // Prevent duplicate fetches
  const isFetchingRef = useRef(false);
  const isInitializedRef = useRef(false);
  const favoritesOnlyRef = useRef(favoritesOnly);

  // Keep ref in sync
  useEffect(() => {
    favoritesOnlyRef.current = favoritesOnly;
  }, [favoritesOnly]);

  /**
   * Load initial generations on mount
   */
  const loadInitial = useCallback(async (filterFavorites?: boolean) => {
    if (!generationHistoryService.isAuthenticated()) {
      return;
    }

    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsLoading(true);
    setError(null);

    const useFavorites = filterFavorites ?? favoritesOnlyRef.current;

    try {
      // Initialize table first (idempotent)
      await generationHistoryService.init();

      // Fetch first page
      const result = await generationHistoryService.getGenerations(PAGE_SIZE, 0, useFavorites);
      if (result) {
        setGenerations(result.generations);
        setTotal(result.total);
        setHasMore(result.generations.length < result.total);
        setOffset(result.generations.length);
      }
    } catch (err) {
      console.error('Failed to load generations:', err);
      setError('Failed to load generation history');
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  /**
   * Load more generations (pagination)
   */
  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading || isFetchingRef.current) return;

    isFetchingRef.current = true;
    setIsLoading(true);

    try {
      const result = await generationHistoryService.getGenerations(PAGE_SIZE, offset, favoritesOnlyRef.current);
      if (result) {
        setGenerations((prev) => [...prev, ...result.generations]);
        setTotal(result.total);
        setHasMore(offset + result.generations.length < result.total);
        setOffset((prev) => prev + result.generations.length);
      }
    } catch (err) {
      console.error('Failed to load more generations:', err);
      setError('Failed to load more generations');
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [hasMore, isLoading, offset]);

  /**
   * Refresh the entire list
   */
  const refresh = useCallback(async () => {
    setOffset(0);
    setGenerations([]);
    setHasMore(true);
    isInitializedRef.current = false;
    await loadInitial();
  }, [loadInitial]);

  /**
   * Set favorites filter and reload
   */
  const setFavoritesOnly = useCallback((value: boolean) => {
    setFavoritesOnlyState(value);
    favoritesOnlyRef.current = value;
    setOffset(0);
    setGenerations([]);
    setHasMore(true);
    loadInitial(value);
  }, [loadInitial]);

  /**
   * Save a new generation and add to top of list
   */
  const saveGeneration = useCallback(
    async (params: SaveGenerationParams): Promise<GenerationRecord | null> => {
      try {
        const saved = await generationHistoryService.saveGeneration(params);
        if (saved) {
          // Only add to list if not filtering by favorites (new items aren't favorites)
          if (!favoritesOnlyRef.current) {
            setGenerations((prev) => [saved, ...prev]);
            setTotal((prev) => prev + 1);
          }
        }
        return saved;
      } catch (err) {
        console.error('Failed to save generation:', err);
        return null;
      }
    },
    []
  );

  /**
   * Delete a generation from history
   */
  const deleteGeneration = useCallback(
    async (generationId: string): Promise<boolean> => {
      try {
        const success = await generationHistoryService.deleteGeneration(generationId);
        if (success) {
          setGenerations((prev) => prev.filter((g) => g.id !== generationId));
          setTotal((prev) => prev - 1);
        }
        return success;
      } catch (err) {
        console.error('Failed to delete generation:', err);
        return false;
      }
    },
    []
  );

  /**
   * Toggle favorite status of a generation
   */
  const toggleFavorite = useCallback(
    async (generationId: string): Promise<boolean> => {
      try {
        const result = await generationHistoryService.toggleFavorite(generationId);
        if (result?.success) {
          // Update local state
          setGenerations((prev) =>
            prev.map((g) =>
              g.id === generationId ? { ...g, is_favorite: result.is_favorite } : g
            ).filter((g) => {
              // If viewing favorites only, remove items that are no longer favorites
              if (favoritesOnlyRef.current && g.id === generationId && !result.is_favorite) {
                setTotal((t) => t - 1);
                return false;
              }
              return true;
            })
          );
          return true;
        }
        return false;
      } catch (err) {
        console.error('Failed to toggle favorite:', err);
        return false;
      }
    },
    []
  );

  // Load on mount - pass the initial favoritesOnly value from URL params
  useEffect(() => {
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      loadInitial(favoritesOnly);
    }
  }, [loadInitial, favoritesOnly]);

  return {
    generations,
    isLoading,
    hasMore,
    total,
    error,
    favoritesOnly,
    saveGeneration,
    deleteGeneration,
    toggleFavorite,
    loadMore,
    refresh,
    setFavoritesOnly,
  };
}

export default useGenerationHistory;

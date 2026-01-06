/**
 * Generation History Service
 * API integration for Midjourney-style image generation history
 */

const API_BASE = '/api/image';

// ============================================
// TYPES
// ============================================

export interface ReferenceImage {
  url: string;
  refType: 'style' | 'character' | 'image' | 'pose' | null;
}

export interface GenerationRecord {
  id: string;
  user_id: string;
  prompt: string;
  image_urls: string[];
  model: string;
  aspect_ratio: string;
  resolution: string;
  count: number;
  provider: string;
  generation_time_ms?: number;
  is_favorite: boolean;
  created_at: string;
  reference_images?: ReferenceImage[];
}

export interface SaveGenerationParams {
  prompt: string;
  image_urls: string[];
  model: string;
  aspect_ratio?: string;
  resolution?: string;
  count?: number;
  provider?: string;
  generation_time_ms?: number;
  reference_images?: ReferenceImage[];
}

export interface GenerationsResponse {
  success: boolean;
  generations: GenerationRecord[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('xenoos_auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const handleResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
};

// ============================================
// GENERATION HISTORY SERVICE
// ============================================

export const generationHistoryService = {
  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return !!localStorage.getItem('xenoos_auth_token');
  },

  /**
   * Initialize the generations table (call once on app init)
   */
  async init(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/generations/init`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await handleResponse<{ success: boolean }>(response);
      return data.success;
    } catch (error) {
      console.error('Failed to initialize generations table:', error);
      return false;
    }
  },

  /**
   * Save a new generation to history
   */
  async saveGeneration(params: SaveGenerationParams): Promise<GenerationRecord | null> {
    try {
      const response = await fetch(`${API_BASE}/generations`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(params),
      });
      const data = await handleResponse<{ success: boolean; generation: GenerationRecord }>(response);
      return data.generation;
    } catch (error) {
      console.error('Failed to save generation:', error);
      return null;
    }
  },

  /**
   * Get user's generation history with pagination
   */
  async getGenerations(limit = 20, offset = 0, favoritesOnly = false): Promise<GenerationsResponse | null> {
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
        favorites_only: favoritesOnly.toString(),
      });
      const response = await fetch(
        `${API_BASE}/generations?${params}`,
        {
          method: 'GET',
          headers: getAuthHeaders(),
        }
      );
      const data = await handleResponse<GenerationsResponse>(response);
      return data;
    } catch (error) {
      console.error('Failed to fetch generations:', error);
      return null;
    }
  },

  /**
   * Toggle favorite status of a generation
   */
  async toggleFavorite(generationId: string): Promise<{ success: boolean; is_favorite: boolean } | null> {
    try {
      const response = await fetch(`${API_BASE}/generations/${generationId}/favorite`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
      });
      const data = await handleResponse<{ success: boolean; generationId: string; is_favorite: boolean }>(response);
      return { success: data.success, is_favorite: data.is_favorite };
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
      return null;
    }
  },

  /**
   * Delete a generation from history
   */
  async deleteGeneration(generationId: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/generations/${generationId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await handleResponse<{ success: boolean }>(response);
      return data.success;
    } catch (error) {
      console.error('Failed to delete generation:', error);
      return false;
    }
  },
};

export default generationHistoryService;

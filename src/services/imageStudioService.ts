/**
 * IMAGE STUDIO SERVICE
 *
 * Frontend service layer for Image Studio API integration.
 * Handles all communication with the backend API for:
 * - Project management (CRUD)
 * - Session management (chat history)
 * - Asset management (images)
 *
 * Follows the same patterns as videoStudioService.ts
 */

import { authService } from './authService';

// API Base URL configuration
const API_BASE = import.meta.env.VITE_API_URL ||
  (process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:8080/api');

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface ImageProject {
  id: string;
  user_id: string;
  title: string;
  description?: string;

  // Generation Settings
  model: string;
  seed?: string;
  guidance_scale?: number;
  aspect_ratio?: string;
  num_images?: number;

  // Canvas State
  canvas_data?: any;

  // Style Settings
  style_type?: 'image' | 'prompt' | 'preset' | null;
  style_content?: string;
  style_name?: string;

  // Project State
  status: 'draft' | 'completed' | 'archived';
  thumbnail_url?: string;
  primary_image_url?: string;

  // Timestamps
  created_at: string;
  updated_at: string;
  last_opened_at?: string;

  // Sharing
  is_public: boolean;
  share_token?: string;
}

export interface ImageProjectSession {
  id: string;
  project_id: string;
  user_id: string;
  session_title: string;
  messages: ChatMessage[];
  canvas_snapshot?: any;
  settings_snapshot?: any;
  created_at: string;
  message_count: number;
  thumbnail_url?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  timestamp: number;
  metadata?: any;
}

export interface ImageAsset {
  id: string;
  project_id?: string;
  session_id?: string;
  user_id: string;
  name: string;
  type: 'generated' | 'uploaded' | 'edited' | 'canvas';
  format: string;
  file_url: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  file_size?: number;
  model_used?: string;
  prompt?: string;
  negative_prompt?: string;
  seed?: string;
  guidance_scale?: number;
  generation_time?: number;
  source: 'generation' | 'upload' | 'edit' | 'canvas';
  created_at: string;
  metadata?: any;
}

export interface CreateImageProjectRequest {
  title?: string;
  description?: string;
  model?: string;
  seed?: string;
  guidance_scale?: number;
  aspect_ratio?: string;
  num_images?: number;
  style_type?: 'image' | 'prompt' | 'preset';
  style_content?: string;
  style_name?: string;
  canvas_data?: any;
}

export interface UpdateImageProjectRequest {
  title?: string;
  description?: string;
  canvas_data?: any;
  model?: string;
  seed?: string;
  guidance_scale?: number;
  aspect_ratio?: string;
  num_images?: number;
  style_type?: 'image' | 'prompt' | 'preset';
  style_content?: string;
  style_name?: string;
  status?: 'draft' | 'completed' | 'archived';
  thumbnail_url?: string;
  primary_image_url?: string;
}

export interface SaveSessionRequest {
  project_id: string;
  session_title: string;
  messages: ChatMessage[];
  canvas_snapshot?: any;
  settings_snapshot?: any;
}

export interface CreateAssetRequest {
  project_id?: string;
  session_id?: string;
  name: string;
  type?: 'generated' | 'uploaded' | 'edited' | 'canvas';
  format?: string;
  file_url: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  file_size?: number;
  model_used?: string;
  prompt?: string;
  negative_prompt?: string;
  seed?: string;
  guidance_scale?: number;
  generation_time?: number;
  source?: 'generation' | 'upload' | 'edit' | 'canvas';
  metadata?: any;
}

// ============================================
// API RESPONSE TYPES
// ============================================

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface ProjectListResponse {
  success: boolean;
  projects?: ImageProject[];
  total?: number;
  limit?: number;
  offset?: number;
  error?: string;
}

interface SessionListResponse {
  success: boolean;
  sessions?: ImageProjectSession[];
  error?: string;
}

interface AssetListResponse {
  success: boolean;
  assets?: ImageAsset[];
  error?: string;
}

// ============================================
// SERVICE CLASS
// ============================================

class ImageStudioService {

  // ============================================
  // PROJECT MANAGEMENT
  // ============================================

  /**
   * Create a new image project
   */
  async createProject(params: CreateImageProjectRequest): Promise<{
    success: boolean;
    project?: ImageProject;
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/image/projects/create`, {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify(params)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create project');
      }

      return data;
    } catch (error: any) {
      console.error('❌ ImageStudioService: createProject error:', error);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  /**
   * Get all projects for the current user
   */
  async getProjects(options?: {
    limit?: number;
    offset?: number;
    status?: 'draft' | 'completed' | 'archived' | 'all';
    sort?: 'updated_at' | 'created_at' | 'title' | 'last_opened_at';
    order?: 'ASC' | 'DESC';
  }): Promise<ProjectListResponse> {
    try {
      const params = new URLSearchParams();

      if (options?.limit) params.append('limit', options.limit.toString());
      if (options?.offset) params.append('offset', options.offset.toString());
      if (options?.status) params.append('status', options.status);
      if (options?.sort) params.append('sort', options.sort);
      if (options?.order) params.append('order', options.order);

      const response = await fetch(`${API_BASE}/image/projects?${params}`, {
        method: 'GET',
        headers: authService.getAuthHeaders()
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch projects');
      }

      return data;
    } catch (error: any) {
      console.error('❌ ImageStudioService: getProjects error:', error);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  /**
   * Get a specific project by ID
   */
  async getProject(projectId: string): Promise<{
    success: boolean;
    project?: ImageProject;
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/image/projects/${projectId}`, {
        method: 'GET',
        headers: authService.getAuthHeaders()
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch project');
      }

      return data;
    } catch (error: any) {
      console.error('❌ ImageStudioService: getProject error:', error);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  /**
   * Update a project
   */
  async updateProject(
    projectId: string,
    updates: UpdateImageProjectRequest
  ): Promise<{
    success: boolean;
    project?: ImageProject;
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/image/projects/${projectId}`, {
        method: 'PUT',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify(updates)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update project');
      }

      return data;
    } catch (error: any) {
      console.error('❌ ImageStudioService: updateProject error:', error);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  /**
   * Delete a project
   */
  async deleteProject(projectId: string): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/image/projects/${projectId}`, {
        method: 'DELETE',
        headers: authService.getAuthHeaders()
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete project');
      }

      return data;
    } catch (error: any) {
      console.error('❌ ImageStudioService: deleteProject error:', error);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  // ============================================
  // SESSION MANAGEMENT (Chat History)
  // ============================================

  /**
   * Save a session/checkpoint
   */
  async saveSession(params: SaveSessionRequest): Promise<{
    success: boolean;
    session?: ImageProjectSession;
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/image/sessions/save`, {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify(params)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save session');
      }

      return data;
    } catch (error: any) {
      console.error('❌ ImageStudioService: saveSession error:', error);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  /**
   * Get all sessions for a project
   */
  async getSessions(projectId: string): Promise<SessionListResponse> {
    try {
      const response = await fetch(`${API_BASE}/image/sessions/${projectId}`, {
        method: 'GET',
        headers: authService.getAuthHeaders()
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch sessions');
      }

      return data;
    } catch (error: any) {
      console.error('❌ ImageStudioService: getSessions error:', error);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/image/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: authService.getAuthHeaders()
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete session');
      }

      return data;
    } catch (error: any) {
      console.error('❌ ImageStudioService: deleteSession error:', error);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  // ============================================
  // ASSET MANAGEMENT
  // ============================================

  /**
   * Create/register an image asset
   */
  async createAsset(params: CreateAssetRequest): Promise<{
    success: boolean;
    asset?: ImageAsset;
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/image/assets/create`, {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify(params)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create asset');
      }

      return data;
    } catch (error: any) {
      console.error('❌ ImageStudioService: createAsset error:', error);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  /**
   * Get assets for a project
   */
  async getAssets(
    projectId: string,
    options?: {
      type?: 'generated' | 'uploaded' | 'edited' | 'canvas';
      limit?: number;
      offset?: number;
    }
  ): Promise<AssetListResponse> {
    try {
      const params = new URLSearchParams();

      if (options?.type) params.append('type', options.type);
      if (options?.limit) params.append('limit', options.limit.toString());
      if (options?.offset) params.append('offset', options.offset.toString());

      const response = await fetch(
        `${API_BASE}/image/assets/${projectId}?${params}`,
        {
          method: 'GET',
          headers: authService.getAuthHeaders()
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch assets');
      }

      return data;
    } catch (error: any) {
      console.error('❌ ImageStudioService: getAssets error:', error);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  /**
   * Delete an asset
   */
  async deleteAsset(assetId: string): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/image/assets/${assetId}`, {
        method: 'DELETE',
        headers: authService.getAuthHeaders()
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete asset');
      }

      return data;
    } catch (error: any) {
      console.error('❌ ImageStudioService: deleteAsset error:', error);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return authService.isAuthenticated();
  }

  /**
   * Get current user
   */
  getCurrentUser() {
    return authService.getCurrentUser();
  }
}

// ============================================
// SINGLETON EXPORT
// ============================================

export const imageStudioService = new ImageStudioService();
export default imageStudioService;

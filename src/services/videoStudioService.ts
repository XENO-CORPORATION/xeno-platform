/**
 * Video Studio Service
 * Frontend service for video project management, rendering, and collaboration
 * Connects to authenticated backend APIs
 */

import { authService } from './authService';

const API_BASE = import.meta.env.VITE_API_URL || 
  (process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:8080');

// ============================================
// TYPES & INTERFACES
// ============================================

export interface VideoProject {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  
  // Project Settings
  width: number;
  height: number;
  fps: number;
  duration: number; // seconds
  quality: 'low' | 'medium' | 'high' | 'ultra';
  aspect_ratio: string;
  generation_steps: number;
  output_format: 'mp4' | 'webm' | 'avi' | 'mov';
  
  // Timeline & State
  timeline_data?: any; // Timeline tracks, clips, effects
  status: 'draft' | 'rendering' | 'completed' | 'failed';
  thumbnail_url?: string;
  output_video_url?: string;
  
  // Metadata
  created_at: string;
  updated_at: string;
  last_opened_at?: string;
  file_size?: number;
  render_duration?: number;
  
  is_public: boolean;
  share_token?: string;
}

export interface VideoAsset {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  type: 'video' | 'image' | 'audio';
  format: string;
  file_url: string;
  thumbnail_url?: string;
  duration?: number; // seconds for video/audio
  width?: number;
  height?: number;
  file_size: number;
  source: 'upload' | 'generated' | 'imported';
  uploaded_at: string;
  metadata?: Record<string, any>;
}

export interface RenderJob {
  id: string;
  project_id: string;
  user_id: string;
  render_settings: Record<string, any>;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  current_frame?: number;
  total_frames?: number;
  output_url?: string;
  error_message?: string;
  container_id?: string;
  credits_used: number;
  processing_time?: number;
  queued_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface ProjectSession {
  id: string;
  project_id: string;
  user_id: string;
  session_title: string;
  timeline_snapshot: any;
  settings_snapshot: any;
  created_at: string;
  message_count: number;
  thumbnail_url?: string;
}

export interface CreateProjectRequest {
  title?: string;
  description?: string;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  quality?: string;
  aspect_ratio?: string;
  generation_steps?: number;
  output_format?: string;
}

export interface UpdateProjectRequest {
  title?: string;
  description?: string;
  timeline_data?: any;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  quality?: string;
  aspect_ratio?: string;
}

export interface UploadAssetRequest {
  project_id: string;
  name: string;
  type: 'video' | 'image' | 'audio';
  format: string;
  file_url: string;
  duration?: number;
  width?: number;
  height?: number;
  file_size: number;
  source?: 'upload' | 'generated' | 'imported';
}

export interface StartRenderRequest {
  project_id: string;
  render_settings?: Record<string, any>;
}

// ============================================
// VIDEO STUDIO SERVICE CLASS
// ============================================

class VideoStudioService {
  
  // ============================================
  // PROJECT MANAGEMENT
  // ============================================
  
  /**
   * Create a new video project
   */
  async createProject(params: CreateProjectRequest): Promise<{ success: boolean; project?: VideoProject; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/video/projects/create`, {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify(params)
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to create project'
        };
      }

      return {
        success: true,
        project: data.project
      };

    } catch (error) {
      console.error('Create project error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  /**
   * Get all projects for the current user
   */
  async getProjects(options?: { status?: string; limit?: number; offset?: number }): Promise<{ 
    success: boolean; 
    projects?: VideoProject[]; 
    total?: number;
    error?: string;
  }> {
    try {
      const params = new URLSearchParams();
      if (options?.status) params.append('status', options.status);
      if (options?.limit) params.append('limit', options.limit.toString());
      if (options?.offset) params.append('offset', options.offset.toString());

      const response = await fetch(`${API_BASE}/video/projects?${params.toString()}`, {
        method: 'GET',
        headers: authService.getAuthHeaders()
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to fetch projects'
        };
      }

      return {
        success: true,
        projects: data.projects,
        total: data.total
      };

    } catch (error) {
      console.error('Get projects error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  /**
   * Get a specific project by ID
   */
  async getProject(projectId: string): Promise<{ success: boolean; project?: VideoProject; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/video/projects/${projectId}`, {
        method: 'GET',
        headers: authService.getAuthHeaders()
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to fetch project'
        };
      }

      return {
        success: true,
        project: data.project
      };

    } catch (error) {
      console.error('Get project error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  /**
   * Update a project
   */
  async updateProject(projectId: string, updates: UpdateProjectRequest): Promise<{ 
    success: boolean; 
    project?: VideoProject; 
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/video/projects/${projectId}`, {
        method: 'PUT',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify(updates)
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to update project'
        };
      }

      return {
        success: true,
        project: data.project
      };

    } catch (error) {
      console.error('Update project error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  /**
   * Delete a project
   */
  async deleteProject(projectId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/video/projects/${projectId}`, {
        method: 'DELETE',
        headers: authService.getAuthHeaders()
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to delete project'
        };
      }

      return { success: true };

    } catch (error) {
      console.error('Delete project error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  // ============================================
  // ASSET MANAGEMENT
  // ============================================

  /**
   * Upload an asset to a project
   */
  async uploadAsset(assetData: UploadAssetRequest): Promise<{ success: boolean; asset?: VideoAsset; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/video/assets/upload`, {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify(assetData)
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to upload asset'
        };
      }

      return {
        success: true,
        asset: data.asset
      };

    } catch (error) {
      console.error('Upload asset error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  /**
   * Get all assets for a project
   */
  async getAssets(projectId: string): Promise<{ success: boolean; assets?: VideoAsset[]; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/video/assets/${projectId}`, {
        method: 'GET',
        headers: authService.getAuthHeaders()
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to fetch assets'
        };
      }

      return {
        success: true,
        assets: data.assets
      };

    } catch (error) {
      console.error('Get assets error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  // ============================================
  // RENDERING
  // ============================================

  /**
   * Start rendering a project
   */
  async startRender(projectIdOrParams: string | StartRenderRequest, renderSettings?: any): Promise<{
    success: boolean;
    job?: RenderJob;
    estimated_credits?: number;
    error?: string;
  }> {
    try {
      // Support both call signatures:
      // startRender(projectId, renderSettings) or startRender({ project_id, render_settings })
      const params: StartRenderRequest = typeof projectIdOrParams === 'string'
        ? { project_id: projectIdOrParams, render_settings: renderSettings }
        : projectIdOrParams;

      const response = await fetch(`${API_BASE}/video/render`, {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify(params)
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to start render',
          ...data
        };
      }

      return {
        success: true,
        job: data.job,
        estimated_credits: data.estimated_credits
      };

    } catch (error) {
      console.error('Start render error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  /**
   * Get render job status
   */
  async getRenderStatus(jobId: string): Promise<{ success: boolean; job?: RenderJob; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/video/render/${jobId}/status`, {
        method: 'GET',
        headers: authService.getAuthHeaders()
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to fetch render status'
        };
      }

      return {
        success: true,
        job: data.job
      };

    } catch (error) {
      console.error('Get render status error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  /**
   * Cancel a render job
   */
  async cancelRender(jobId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/video/render/${jobId}/cancel`, {
        method: 'POST',
        headers: authService.getAuthHeaders()
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to cancel render'
        };
      }

      return { success: true };

    } catch (error) {
      console.error('Cancel render error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  /**
   * Export a completed project
   */
  async exportProject(projectId: string, options?: { format?: string; quality?: string }): Promise<{ 
    success: boolean; 
    download_url?: string;
    format?: string;
    file_size?: number;
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/video/export`, {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify({
          project_id: projectId,
          ...options
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to export project'
        };
      }

      return {
        success: true,
        download_url: data.download_url,
        format: data.format,
        file_size: data.file_size
      };

    } catch (error) {
      console.error('Export project error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  // ============================================
  // SESSION MANAGEMENT (History)
  // ============================================

  /**
   * Save current project state as a session
   */
  async saveSession(params: {
    project_id: string;
    session_title: string;
    timeline_snapshot: any;
    settings_snapshot: any;
    message_count?: number;
  }): Promise<{ success: boolean; session?: ProjectSession; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/video/sessions/save`, {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify(params)
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to save session'
        };
      }

      return {
        success: true,
        session: data.session
      };

    } catch (error) {
      console.error('Save session error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  /**
   * Get all sessions for a project
   */
  async getSessions(projectId: string): Promise<{ success: boolean; sessions?: ProjectSession[]; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/video/sessions/${projectId}`, {
        method: 'GET',
        headers: authService.getAuthHeaders()
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to fetch sessions'
        };
      }

      return {
        success: true,
        sessions: data.sessions
      };

    } catch (error) {
      console.error('Get sessions error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
        };
    }
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Poll render status until completion
   */
  async pollRenderStatus(
    jobId: string, 
    onProgress?: (job: RenderJob) => void,
    intervalMs = 2000
  ): Promise<RenderJob> {
    return new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          const result = await this.getRenderStatus(jobId);
          
          if (!result.success || !result.job) {
            clearInterval(interval);
            reject(new Error(result.error || 'Failed to get render status'));
            return;
          }

          const job = result.job;

          // Call progress callback
          if (onProgress) {
            onProgress(job);
          }

          // Check if job is finished
          if (['completed', 'failed', 'cancelled'].includes(job.status)) {
            clearInterval(interval);
            resolve(job);
          }

        } catch (error) {
          clearInterval(interval);
          reject(error);
        }
      }, intervalMs);
    });
  }

  /**
   * Calculate estimated render time
   */
  estimateRenderTime(project: VideoProject): number {
    // Simple estimation: 1 second of video = 2-5 seconds of render time depending on quality
    const qualityMultiplier = {
      low: 2,
      medium: 3,
      high: 4,
      ultra: 5
    };

    const multiplier = qualityMultiplier[project.quality] || 3;
    return project.duration * multiplier;
  }

  /**
   * Calculate estimated credits cost
   */
  estimateCredits(project: VideoProject): number {
    // Credits formula: (width * height * duration * fps) / 1,000,000
    return Math.ceil(
      (project.width * project.height * project.duration * project.fps) / 1000000
    );
  }

  /**
   * Format file size to human-readable string
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Format duration to HH:MM:SS
   */
  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}

// Lazy singleton to avoid initialization issues
let _instance: VideoStudioService | null = null;

function getInstance(): VideoStudioService {
  if (!_instance) {
    _instance = new VideoStudioService();
  }
  return _instance;
}

// Export singleton getter and class
export const videoStudioService = {
  get instance() {
    return getInstance();
  },
  // Proxy all methods to the singleton instance
  createProject: (...args: any[]) => getInstance().createProject(...args),
  getProjects: (...args: any[]) => getInstance().getProjects(...args),
  getProject: (...args: any[]) => getInstance().getProject(...args),
  updateProject: (...args: any[]) => getInstance().updateProject(...args),
  deleteProject: (...args: any[]) => getInstance().deleteProject(...args),
  uploadAsset: (...args: any[]) => getInstance().uploadAsset(...args),
  getAssets: (...args: any[]) => getInstance().getAssets(...args),
  startRender: (...args: any[]) => getInstance().startRender(...args),
  getRenderStatus: (...args: any[]) => getInstance().getRenderStatus(...args),
  cancelRender: (...args: any[]) => getInstance().cancelRender(...args),
  pollRenderStatus: (...args: any[]) => getInstance().pollRenderStatus(...args),
  exportProject: (...args: any[]) => getInstance().exportProject(...args),
  saveSession: (...args: any[]) => getInstance().saveSession(...args),
  getSessions: (...args: any[]) => getInstance().getSessions(...args),
  estimateCredits: (...args: any[]) => getInstance().estimateCredits(...args),
  formatFileSize: (...args: any[]) => getInstance().formatFileSize(...args),
  formatDuration: (...args: any[]) => getInstance().formatDuration(...args),
};

export default videoStudioService;

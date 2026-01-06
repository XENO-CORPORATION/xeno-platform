// User Data Service - API integration for settings, files, and usage tracking
// Replaces localStorage-based storage with database persistence

const API_BASE = '/api/user-data';

// ============================================
// TYPES
// ============================================

export interface UserSettings {
  chat?: {
    wideMode?: boolean;
    alignment?: 'center' | 'left' | 'right';
    showTokenCount?: boolean;
  };
  appearance?: {
    theme?: 'dark' | 'light';
    fontSize?: 'small' | 'medium' | 'large';
  };
  models?: {
    defaultModel?: string;
    favoriteModels?: string[];
  };
  [key: string]: unknown;
}

export interface UserFile {
  id: string;
  filename: string;
  original_name?: string;
  file_type?: string;
  mime_type?: string;
  file_size?: number;
  storage_path?: string;
  storage_type?: string;
  metadata?: Record<string, unknown>;
  last_used_at?: string;
  created_at?: string;
}

export interface UsageRecord {
  date: string;
  model_id: string;
  provider?: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  request_count: number;
  estimated_cost?: number;
}

export interface UsageSummary {
  today: {
    tokens: number;
    requests: number;
    cost: number;
  };
  thisMonth: {
    tokens: number;
    requests: number;
    cost: number;
  };
  allTime: {
    tokens: number;
    requests: number;
    cost: number;
  };
  topModels: Array<{
    model_id: string;
    tokens: number;
    requests: number;
  }>;
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
// USER DATA SERVICE
// ============================================

export const userDataService = {
  // ============================================
  // INITIALIZATION
  // ============================================

  // Initialize user data tables (call once on app startup)
  async initTables(): Promise<{ success: boolean; message?: string }> {
    try {
      const response = await fetch(`${API_BASE}/init`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      return await response.json();
    } catch (error) {
      console.error('Failed to initialize user data tables:', error);
      return { success: false, message: (error as Error).message };
    }
  },

  // ============================================
  // SETTINGS API
  // ============================================

  // Get user settings
  async getSettings(): Promise<UserSettings> {
    try {
      const response = await fetch(`${API_BASE}/settings`, {
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{ settings: UserSettings }>(response);
      return data.settings || {};
    } catch (error) {
      console.error('Failed to get user settings:', error);
      return {};
    }
  },

  // Update all settings
  async updateSettings(settings: UserSettings): Promise<UserSettings> {
    try {
      const response = await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ settings }),
      });

      const data = await handleResponse<{ settings: UserSettings }>(response);
      return data.settings || {};
    } catch (error) {
      console.error('Failed to update user settings:', error);
      throw error;
    }
  },

  // Update a specific setting (path like 'chat.wideMode')
  async updateSetting(path: string, value: unknown): Promise<UserSettings> {
    try {
      const response = await fetch(`${API_BASE}/settings`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ path, value }),
      });

      const data = await handleResponse<{ settings: UserSettings }>(response);
      return data.settings || {};
    } catch (error) {
      console.error('Failed to update setting:', error);
      throw error;
    }
  },

  // ============================================
  // FILES API
  // ============================================

  // Get recent files
  async getRecentFiles(limit = 20): Promise<UserFile[]> {
    try {
      const response = await fetch(`${API_BASE}/files?limit=${limit}`, {
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{ files: UserFile[] }>(response);
      return data.files || [];
    } catch (error) {
      console.error('Failed to get recent files:', error);
      return [];
    }
  },

  // Add/track a file
  async addFile(file: {
    filename: string;
    original_name?: string;
    file_type?: string;
    mime_type?: string;
    file_size?: number;
    storage_path?: string;
    storage_type?: string;
    metadata?: Record<string, unknown>;
  }): Promise<UserFile | null> {
    try {
      const response = await fetch(`${API_BASE}/files`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(file),
      });

      const data = await handleResponse<{ file: UserFile }>(response);
      return data.file || null;
    } catch (error) {
      console.error('Failed to add file:', error);
      return null;
    }
  },

  // Update file last_used_at
  async touchFile(fileId: string): Promise<UserFile | null> {
    try {
      const response = await fetch(`${API_BASE}/files/${fileId}/touch`, {
        method: 'PUT',
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{ file: UserFile }>(response);
      return data.file || null;
    } catch (error) {
      console.error('Failed to touch file:', error);
      return null;
    }
  },

  // Delete a file
  async deleteFile(fileId: string, permanent = false): Promise<boolean> {
    try {
      const response = await fetch(
        `${API_BASE}/files/${fileId}?permanent=${permanent}`,
        {
          method: 'DELETE',
          headers: getAuthHeaders(),
        }
      );

      await handleResponse<{ success: boolean }>(response);
      return true;
    } catch (error) {
      console.error('Failed to delete file:', error);
      return false;
    }
  },

  // ============================================
  // USAGE API
  // ============================================

  // Get usage records
  async getUsage(options?: {
    start_date?: string;
    end_date?: string;
    model_id?: string;
  }): Promise<{ usage: UsageRecord[]; totals: Record<string, number> }> {
    try {
      const params = new URLSearchParams();
      if (options?.start_date) params.set('start_date', options.start_date);
      if (options?.end_date) params.set('end_date', options.end_date);
      if (options?.model_id) params.set('model_id', options.model_id);

      const response = await fetch(`${API_BASE}/usage?${params}`, {
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{
        usage: UsageRecord[];
        totals: Record<string, number>;
      }>(response);
      return { usage: data.usage || [], totals: data.totals || {} };
    } catch (error) {
      console.error('Failed to get usage:', error);
      return { usage: [], totals: {} };
    }
  },

  // Track usage (call after each API request)
  async trackUsage(data: {
    model_id: string;
    provider?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    estimated_cost?: number;
  }): Promise<UsageRecord | null> {
    try {
      const response = await fetch(`${API_BASE}/usage`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });

      const result = await handleResponse<{ usage: UsageRecord }>(response);
      return result.usage || null;
    } catch (error) {
      console.error('Failed to track usage:', error);
      return null;
    }
  },

  // Get usage summary
  async getUsageSummary(): Promise<UsageSummary | null> {
    try {
      const response = await fetch(`${API_BASE}/usage/summary`, {
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{ summary: UsageSummary }>(response);
      return data.summary || null;
    } catch (error) {
      console.error('Failed to get usage summary:', error);
      return null;
    }
  },

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return !!localStorage.getItem('xenoos_auth_token');
  },

  // Migrate localStorage data to database
  async migrateFromLocalStorage(data: {
    settings?: UserSettings;
    recentFiles?: UserFile[];
  }): Promise<boolean> {
    try {
      if (data.settings) {
        await this.updateSettings(data.settings);
      }

      if (data.recentFiles && data.recentFiles.length > 0) {
        for (const file of data.recentFiles) {
          await this.addFile({
            filename: file.filename,
            original_name: file.original_name,
            file_type: file.file_type,
            mime_type: file.mime_type,
            file_size: file.file_size,
            metadata: file.metadata,
          });
        }
      }

      return true;
    } catch (error) {
      console.error('Failed to migrate from localStorage:', error);
      return false;
    }
  },
};

export default userDataService;

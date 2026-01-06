/**
 * XenoOS File System Service
 * Handles all file system operations with the real backend API
 */

// Use API_BASE_URL for all requests - nginx now supports large file uploads
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export interface FileSystemEntry {
  id: string;
  user_id?: string;
  parent_id?: string;
  name: string;
  type: 'file' | 'folder';
  path: string;
  size?: number;
  mime_type?: string;
  checksum?: string;
  created_at?: string;
  updated_at?: string;
  last_accessed_at?: string;
  permission?: 'read' | 'write' | 'admin';
  current_version?: number;
}

export interface CreateFolderRequest {
  name: string;
  parentId?: string;
}

export interface CreateFolderResponse {
  success: boolean;
  data?: FileSystemEntry;
  error?: string;
  message?: string;
}

export interface ListFilesResponse {
  success: boolean;
  data?: {
    entries: FileSystemEntry[];
    count: number;
  };
  error?: string;
}

export interface UploadFilesResponse {
  success: boolean;
  data?: {
    files: FileSystemEntry[];
    count: number;
  };
  error?: string;
  message?: string;
}

export interface FileDetailsResponse {
  success: boolean;
  data?: FileSystemEntry & {
    versions?: any[];
  };
  error?: string;
}

class FileSystemService {
  private userId = '550e8400-e29b-41d4-a716-446655440000'; // Fixed test user ID

  // Set user ID for authenticated user
  setUserId(userId: string) {
    this.userId = userId;
  }

  // Get authorization headers
  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-user-id': this.userId,
    };
  }

  // List files and folders
  async listFiles(parentId?: string, path?: string): Promise<ListFilesResponse> {
    try {
      const params = new URLSearchParams();
      if (parentId) params.append('parentId', parentId);
      if (path) params.append('path', path);

      const response = await fetch(`${API_BASE_URL}/api/filesystem/?${params}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('List files error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Create a new folder
  async createFolder(request: CreateFolderRequest): Promise<CreateFolderResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/filesystem/folders`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Create folder error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Upload files
  async uploadFiles(files: FileList, parentId?: string): Promise<UploadFilesResponse> {
    try {
      const formData = new FormData();
      if (parentId) {
        formData.append('parentId', parentId);
      }

      // Add files to form data
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }

      const response = await fetch(`${API_BASE_URL}/api/filesystem/upload`, {
        method: 'POST',
        headers: {
          'x-user-id': this.userId,
          // Don't set Content-Type for FormData, let browser set it with boundary
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Upload files error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Get file/folder details
  async getFileDetails(id: string): Promise<FileDetailsResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/filesystem/${id}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get file details error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Update file/folder (rename/move)
  async updateEntry(id: string, updates: { name?: string; parentId?: string }): Promise<{ success: boolean; data?: FileSystemEntry; error?: string; message?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/filesystem/${id}`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Update entry error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Delete file/folder
  async deleteEntry(id: string, permanent = false): Promise<{ success: boolean; error?: string; message?: string }> {
    try {
      const params = new URLSearchParams();
      if (permanent) params.append('permanent', 'true');

      const response = await fetch(`${API_BASE_URL}/api/filesystem/${id}?${params}`, {
        method: 'DELETE',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Delete entry error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Download file
  async downloadFile(id: string): Promise<Blob | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/filesystem/${id}/download`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.blob();
    } catch (error) {
      console.error('Download file error:', error);
      return null;
    }
  }

  // Search files and folders
  async search(query: string, type?: 'file' | 'folder', limit = 50): Promise<{ success: boolean; data?: { entries: FileSystemEntry[]; count: number; query: string }; error?: string }> {
    try {
      const params = new URLSearchParams({
        query,
        limit: limit.toString(),
      });

      if (type) {
        params.append('type', type);
      }

      const response = await fetch(`${API_BASE_URL}/api/filesystem/search?${params}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Search error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Get file operation history
  async getHistory(id: string, limit = 100): Promise<{ success: boolean; data?: { entry: FileSystemEntry; history: any[]; count: number }; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/filesystem/${id}/history?limit=${limit}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Get history error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Convert API response to FileSystemItem format for UI
  convertToUIFormat(apiEntry: FileSystemEntry): any {
    const getIcon = (name: string, type: 'file' | 'folder') => {
      if (type === 'folder') {
        return React.createElement('div', { className: 'text-blue-500' }, '📁');
      }

      // Simple file type detection based on extension
      const ext = name.split('.').pop()?.toLowerCase();
      switch (ext) {
        case 'txt':
        case 'md':
          return React.createElement('div', { className: 'text-gray-500' }, '📄');
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'gif':
          return React.createElement('div', { className: 'text-green-500' }, '🖼️');
        case 'pdf':
          return React.createElement('div', { className: 'text-red-500' }, '📕');
        case 'zip':
        case 'rar':
          return React.createElement('div', { className: 'text-yellow-500' }, '📦');
        default:
          return React.createElement('div', { className: 'text-gray-400' }, '📄');
      }
    };

    return {
      id: apiEntry.id,
      name: apiEntry.name,
      type: apiEntry.type,
      path: apiEntry.path,
      size: apiEntry.size,
      modified: apiEntry.updated_at ? new Date(apiEntry.updated_at) : new Date(),
      icon: getIcon(apiEntry.name, apiEntry.type),
      // Add other properties as needed
    };
  }
}

// Create singleton instance
export const fileSystemService = new FileSystemService();

// React import for icon components (will be available in component context)
const React = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children }) };

export default fileSystemService;

/**
 * Container File System Service
 * Integrates with real container filesystem operations via Docker API
 */

export interface ContainerFileSystemItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  path: string;
  size: number;
  modified: Date;
  permissions: string;
  owner: string;
  group: string;
  icon?: React.ReactNode;
  isExecutable?: boolean;
  isHidden?: boolean;
}

export interface ContainerFileSystemResponse {
  success: boolean;
  data?: {
    path: string;
    items: ContainerFileSystemItem[];
    parent?: string;
  };
  error?: string;
}

export interface ContainerFileOperationResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: any;
}

class ContainerFileSystemService {
  private containerId: string | null = null;

  // Set the active container ID
  setContainerId(containerId: string) {
    this.containerId = containerId;
    console.log('🐳 Container filesystem set to:', containerId);
  }

  // Get current container ID
  getContainerId(): string | null {
    return this.containerId;
  }

  // Check if user is authenticated
  isAuthenticated(): boolean {
    const token = localStorage.getItem('xenoos_auth_token');
    return !!token && token.trim() !== '';
  }

  // Get authorization headers
  private getHeaders() {
    const token = localStorage.getItem('xenoos_auth_token');
    if (!token) {
      console.warn('⚠️ No authentication token found in localStorage');
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    };
  }

  // Execute commands in container
  private async execInContainer(commands: string[]): Promise<any> {
    if (!this.containerId) {
      throw new Error('No container selected. Please select a container from Settings first.');
    }

    const headers = this.getHeaders();
    if (!headers.Authorization || headers.Authorization === 'Bearer ') {
      throw new Error('Authentication required. Please log in to access containers.');
    }

    console.log('🐳 Executing commands in container:', this.containerId, commands);

    const response = await fetch(`/api/containers/${this.containerId}/exec`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ commands })
    });

    console.log('📡 Container exec response status:', response.status);

    if (!response.ok) {
      let errorText = '';
      try {
        const errorData = await response.json();
        errorText = errorData.error || errorData.message || response.statusText;
        console.error('❌ Container exec error response:', errorData);
      } catch (jsonError) {
        errorText = response.statusText;
        console.error('❌ Container exec failed to parse error response');
      }

      if (response.status === 401) {
        throw new Error('Authentication failed. Please log in again.');
      } else if (response.status === 404) {
        throw new Error('Container not found. It may have been deleted or is not accessible.');
      } else if (response.status === 403) {
        throw new Error('Access denied. You do not have permission to access this container.');
      } else {
        throw new Error(`Container operation failed: ${response.status} - ${errorText}`);
      }
    }

    const result = await response.json();
    console.log('✅ Container exec result:', result);
    return result;
  }

  // List files and directories in container path
  async listDirectory(path: string = '/'): Promise<ContainerFileSystemResponse> {
    try {
      console.log('📁 Listing container directory:', path);
      console.log('🐳 Container ID:', this.containerId);

      if (!this.containerId) {
        throw new Error('No container ID set. Container filesystem service not initialized.');
      }

      // Execute ls command to get directory contents with detailed info
      const command = `ls -la "${path}" 2>/dev/null || echo "ERROR: Cannot access directory"`;
      const result = await this.execInContainer([command]);
      
      console.log('📊 Container ls result:', result);

      if (!result.success || !result.data || !result.data.results || !result.data.results[0]) {
        throw new Error('Failed to list directory');
      }

      const lsOutput = result.data.results[0];
      
      if (lsOutput.includes('ERROR: Cannot access directory')) {
        throw new Error('Directory not accessible');
      }

      // Parse ls -la output
      const items = this.parseLsOutput(lsOutput, path);
      
      console.log('📂 Parsed items:', items);

      return {
        success: true,
        data: {
          path,
          items,
          parent: path !== '/' ? this.getParentPath(path) : undefined
        }
      };
    } catch (error) {
      console.error('❌ Failed to list directory:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Parse ls -la output into file system items
  private parseLsOutput(lsOutput: string, basePath: string): ContainerFileSystemItem[] {
    const lines = lsOutput.split('\n').filter(line => line.trim());
    const items: ContainerFileSystemItem[] = [];

    for (const line of lines) {
      // Skip total line and empty lines
      if (line.startsWith('total') || !line.trim()) continue;

      // Parse ls -la format: permissions owner group size date time name
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const permissions = parts[0];
      const owner = parts[2];
      const group = parts[3];
      const size = parseInt(parts[4]) || 0;
      
      // Handle filenames with spaces - everything after the 8th space
      const nameStartIndex = line.indexOf(parts[8]);
      const name = line.substring(nameStartIndex);
      
      // Skip . and .. entries
      if (name === '.' || name === '..') continue;

      const isDirectory = permissions.startsWith('d');
      const isExecutable = permissions.includes('x');
      const isHidden = name.startsWith('.');

      const fullPath = basePath === '/' ? `/${name}` : `${basePath}/${name}`;

      items.push({
        id: `${this.containerId}-${fullPath}`,
        name,
        type: isDirectory ? 'folder' : 'file',
        path: fullPath,
        size,
        modified: new Date(), // Would need to parse date from ls output for real date
        permissions,
        owner,
        group,
        isExecutable,
        isHidden
      });
    }

    return items;
  }

  // Create new directory
  async createDirectory(path: string, name: string): Promise<ContainerFileOperationResponse> {
    try {
      console.log('📁 Creating directory:', name, 'in', path);
      
      const fullPath = path === '/' ? `/${name}` : `${path}/${name}`;
      const command = `mkdir -p "${fullPath}" && echo "SUCCESS" || echo "ERROR"`;
      
      const result = await this.execInContainer([command]);
      
      if (!result.success || result.data.results[0]?.includes('ERROR')) {
        throw new Error('Failed to create directory');
      }

      return {
        success: true,
        message: `Directory "${name}" created successfully`
      };
    } catch (error) {
      console.error('❌ Failed to create directory:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Create new file
  async createFile(path: string, name: string, content: string = ''): Promise<ContainerFileOperationResponse> {
    try {
      console.log('📄 Creating file:', name, 'in', path);
      
      const fullPath = path === '/' ? `/${name}` : `${path}/${name}`;
      const command = `echo "${content}" > "${fullPath}" && echo "SUCCESS" || echo "ERROR"`;
      
      const result = await this.execInContainer([command]);
      
      if (!result.success || result.data.results[0]?.includes('ERROR')) {
        throw new Error('Failed to create file');
      }

      return {
        success: true,
        message: `File "${name}" created successfully`
      };
    } catch (error) {
      console.error('❌ Failed to create file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Rename file or directory
  async rename(oldPath: string, newName: string): Promise<ContainerFileOperationResponse> {
    try {
      console.log('✏️ Renaming:', oldPath, 'to', newName);
      
      const parentPath = this.getParentPath(oldPath);
      const newPath = parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`;
      
      const command = `mv "${oldPath}" "${newPath}" && echo "SUCCESS" || echo "ERROR"`;
      const result = await this.execInContainer([command]);
      
      if (!result.success || result.data.results[0]?.includes('ERROR')) {
        throw new Error('Failed to rename item');
      }

      return {
        success: true,
        message: `Item renamed to "${newName}" successfully`
      };
    } catch (error) {
      console.error('❌ Failed to rename:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Delete file or directory
  async delete(path: string, recursive: boolean = false): Promise<ContainerFileOperationResponse> {
    try {
      console.log('🗑️ Deleting:', path);
      
      const command = recursive 
        ? `rm -rf "${path}" && echo "SUCCESS" || echo "ERROR"`
        : `rm "${path}" && echo "SUCCESS" || echo "ERROR"`;
      
      const result = await this.execInContainer([command]);
      
      if (!result.success || result.data.results[0]?.includes('ERROR')) {
        throw new Error('Failed to delete item');
      }

      return {
        success: true,
        message: 'Item deleted successfully'
      };
    } catch (error) {
      console.error('❌ Failed to delete:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Read file content
  async readFile(path: string): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
      console.log('📖 Reading file:', path);
      
      const command = `cat "${path}" 2>/dev/null || echo "ERROR: Cannot read file"`;
      const result = await this.execInContainer([command]);
      
      if (!result.success || result.data.results[0]?.includes('ERROR: Cannot read file')) {
        throw new Error('Failed to read file');
      }

      return {
        success: true,
        content: result.data.results[0]
      };
    } catch (error) {
      console.error('❌ Failed to read file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Write file content
  async writeFile(path: string, content: string): Promise<ContainerFileOperationResponse> {
    try {
      console.log('✍️ Writing file:', path);
      
      // Escape content for shell
      const escapedContent = content.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      const command = `echo "${escapedContent}" > "${path}" && echo "SUCCESS" || echo "ERROR"`;
      
      const result = await this.execInContainer([command]);
      
      if (!result.success || result.data.results[0]?.includes('ERROR')) {
        throw new Error('Failed to write file');
      }

      return {
        success: true,
        message: 'File saved successfully'
      };
    } catch (error) {
      console.error('❌ Failed to write file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Helper to get parent path
  private getParentPath(path: string): string {
    if (path === '/' || path === '') return '/';
    const parts = path.split('/').filter(p => p);
    parts.pop();
    return parts.length === 0 ? '/' : `/${parts.join('/')}`;
  }

  // Get available containers for file system access
  async getAvailableContainers(): Promise<{ success: boolean; containers?: any[]; error?: string }> {
    try {
      console.log('🐳 Getting available containers...');
      
      const headers = this.getHeaders();
      if (!headers.Authorization || headers.Authorization === 'Bearer ') {
        return {
          success: false,
          error: 'Authentication required. Please log in to access containers.'
        };
      }

      const response = await fetch('/api/containers', {
        headers
      });

      if (!response.ok) {
        if (response.status === 401) {
          return {
            success: false,
            error: 'Authentication failed. Please log in again.'
          };
        } else if (response.status === 403) {
          return {
            success: false,
            error: 'Access denied. You do not have permission to access containers.'
          };
        } else {
          throw new Error(`Failed to get containers: ${response.status} ${response.statusText}`);
        }
      }

      const result = await response.json();
      
      return {
        success: true,
        containers: result.data?.containers || []
      };
    } catch (error) {
      console.error('❌ Failed to get containers:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Create singleton instance
export const containerFileSystemService = new ContainerFileSystemService();

export default containerFileSystemService;
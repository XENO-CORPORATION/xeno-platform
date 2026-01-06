/**
 * XenoOS Container Service
 * API service for container provisioning and management
 */

import { 
  ContainerConfig, 
  ContainerInstance, 
  ContainerApiResponse, 
  ContainerListResponse, 
  ContainerCreationResponse,
  ContainerOperationResult,
  UsageMetric
} from '../types/container';

const API_BASE = '/api/containers';

/**
 * Helper function to handle API responses safely
 */
async function handleApiResponse(response: Response): Promise<any> {
  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch (jsonError) {
      // If response is not JSON, use status text or default message
      errorMessage = response.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  try {
    return await response.json();
  } catch (jsonError) {
    throw new Error('Invalid response format');
  }
}

export class ContainerService {
  /**
   * Calculate pricing for a configuration without creating container
   */
  static async calculatePricing(config: ContainerConfig): Promise<{
    success: boolean;
    monthlyPrice?: number;
    estimatedStartTime?: number;
    error?: string;
  }> {
    try {
      const params = new URLSearchParams({
        storage: config.storage.toString(),
        cpu: config.cpu.toString(),
        memory: config.memory.toString(),
        maxUsers: config.maxUsers.toString(),
        nodejs: config.languages.nodejs ? config.languages.nodejs.toString() : 'false',
        python: config.languages.python ? config.languages.python.toString() : 'false',
        go: config.languages.go ? config.languages.go.toString() : 'false',
        rust: config.languages.rust ? config.languages.rust.toString() : 'false',
        java: config.languages.java ? config.languages.java.toString() : 'false',
        backups: config.backups ? config.backups.toString() : 'false',
        encryption: config.encryption ? config.encryption.toString() : 'false',
        prioritySupport: config.prioritySupport ? config.prioritySupport.toString() : 'false',
      });

      const response = await fetch(`${API_BASE}/pricing?${params}`);
      const data = await handleApiResponse(response);

      return {
        success: true,
        monthlyPrice: data.data.monthlyPrice,
        estimatedStartTime: data.data.estimatedStartTime,
      };
    } catch (error) {
      console.error('Pricing calculation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create a new container with the specified configuration
   */
  static async createContainer(
    userId: string,
    config: ContainerConfig,
    autoStart: boolean = true
  ): Promise<ContainerCreationResponse | { success: false; error: string }> {
    try {
      const token = localStorage.getItem('xenoos_auth_token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_BASE}/create`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          config,
          autoStart,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create container');
      }

      return data.data;
    } catch (error) {
      console.error('Container creation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get list of containers for the authenticated user
   */
  static async listContainers(
    page: number = 1,
    limit: number = 10
  ): Promise<ContainerListResponse | { success: false; error: string }> {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });

      const token = localStorage.getItem('xenoos_auth_token');
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${API_BASE}?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await handleApiResponse(response);
      return data.data;
    } catch (error) {
      console.error('Container list error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update container configuration
   */
  static async updateContainer(
    containerId: string,
    newConfig: Partial<ContainerConfig>,
    applyImmediately: boolean = false
  ): Promise<ContainerOperationResult> {
    try {
      const response = await fetch(`${API_BASE}/${containerId}/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newConfig,
          applyImmediately,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update container');
      }

      return {
        success: true,
        containerId,
        message: data.message,
        data: data.data,
      };
    } catch (error) {
      console.error('Container update error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to update container configuration',
      };
    }
  }

  /**
   * Start a container
   */
  static async startContainer(containerId: string): Promise<ContainerOperationResult> {
    try {
      const token = localStorage.getItem('xenoos_auth_token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_BASE}/${containerId}/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start container');
      }

      return {
        success: true,
        containerId,
        message: data.message,
        data: data.data,
      };
    } catch (error) {
      console.error('Container start error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to start container',
      };
    }
  }

  /**
   * Stop a container
   */
  static async stopContainer(containerId: string): Promise<ContainerOperationResult> {
    try {
      const response = await fetch(`${API_BASE}/${containerId}/stop`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to stop container');
      }

      return {
        success: true,
        containerId,
        message: data.message,
        data: data.data,
      };
    } catch (error) {
      console.error('Container stop error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to stop container',
      };
    }
  }

  /**
   * Delete a container
   */
  static async deleteContainer(containerId: string): Promise<ContainerOperationResult> {
    try {
      const token = localStorage.getItem('xenoos_auth_token');
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${API_BASE}/${containerId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete container');
      }

      return {
        success: true,
        containerId,
        message: data.message,
      };
    } catch (error) {
      console.error('Container delete error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to delete container',
      };
    }
  }

  /**
   * Get container resource usage statistics
   */
  static async getContainerStats(containerId: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/${containerId}/stats`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get container statistics');
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (error) {
      console.error('Container stats error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Stream container logs (EventSource/SSE)
   */
  static streamContainerLogs(
    containerId: string,
    onMessage: (log: string) => void,
    onError: (error: Error) => void
  ): () => void {
    const eventSource = new EventSource(`${API_BASE}/${containerId}/logs`);

    eventSource.onmessage = (event) => {
      try {
        const logData = JSON.parse(event.data);
        onMessage(logData.message || logData);
      } catch (error) {
        onMessage(event.data);
      }
    };

    eventSource.onerror = (event) => {
      onError(new Error('Container log streaming failed'));
      eventSource.close();
    };

    // Return cleanup function
    return () => {
      eventSource.close();
    };
  }

  /**
   * Get container templates/suggestions
   */
  static async getContainerTemplates(): Promise<{
    success: boolean;
    templates?: any[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/templates`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch container templates');
      }

      return {
        success: true,
        templates: data.data.templates,
      };
    } catch (error) {
      console.error('Container templates error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get storage usage for a container
   */
  static async getStorageUsage(containerId: string): Promise<{
    success: boolean;
    data?: {
      system?: {
        used: number;
        total: number;
        available: number;
        percentage: number;
      };
      user?: {
        used: number;
        total: number;
        available: number;
        percentage: number;
      };
    };
    error?: string;
  }> {
    try {
      const token = localStorage.getItem('xenoos_auth_token');
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${API_BASE}/${containerId}/storage`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch storage usage');
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (error) {
      console.error('Storage usage error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get usage metrics for billing
   */
  static async getUsageMetrics(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    success: boolean;
    metrics?: UsageMetric[];
    error?: string;
  }> {
    try {
      const params = new URLSearchParams({ userId });

      if (startDate) {
        params.append('startDate', startDate.toISOString());
      }
      if (endDate) {
        params.append('endDate', endDate.toISOString());
      }

      const response = await fetch(`${API_BASE}/usage?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch usage metrics');
      }

      return {
        success: true,
        metrics: data.data.metrics,
      };
    } catch (error) {
      console.error('Usage metrics error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Health check for container service
   */
  static async healthCheck(): Promise<{
    success: boolean;
    status?: string;
    error?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/health`);
      const data = await response.json();

      return {
        success: response.ok,
        status: data.status,
        error: data.error,
      };
    } catch (error) {
      console.error('Container service health check error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

/**
 * React hooks for container management
 */
export const useContainerService = () => {
  return {
    calculatePricing: ContainerService.calculatePricing,
    createContainer: ContainerService.createContainer,
    listContainers: ContainerService.listContainers,
    updateContainer: ContainerService.updateContainer,
    startContainer: ContainerService.startContainer,
    stopContainer: ContainerService.stopContainer,
    deleteContainer: ContainerService.deleteContainer,
    getContainerStats: ContainerService.getContainerStats,
    getStorageUsage: ContainerService.getStorageUsage,
    streamContainerLogs: ContainerService.streamContainerLogs,
    getContainerTemplates: ContainerService.getContainerTemplates,
    getUsageMetrics: ContainerService.getUsageMetrics,
    healthCheck: ContainerService.healthCheck,
  };
};

export default ContainerService;
/**
 * XenoOS Terminal Service
 * Frontend service for terminal and container management
 */

export interface TerminalSession {
  id: string;
  containerId: string;
  isMultiUser: boolean;
  clientCount: number;
  createdAt: string;
  lastActiveAt: string;
  commandHistory: TerminalCommand[];
  currentDirectory: string;
}

export interface TerminalCommand {
  command: string;
  timestamp: string;
  userId?: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'error';
  created: string;
  started?: string;
  config?: any;
  portMappings: { [key: string]: number };
  stats?: ContainerStats;
}

export interface ContainerStats {
  cpu: {
    usage: number;
    percent: number;
  };
  memory: {
    usage: number;
    limit: number;
    percent: number;
    usageMB: number;
    limitMB: number;
  };
  network: {
    rx: number;
    tx: number;
    rxMB: number;
    txMB: number;
  };
  timestamp: string;
}

export interface ContainerTemplate {
  id: string;
  name: string;
  description: string;
  config: any;
  estimatedPrice: number;
}

const API_BASE = '/api/terminal';

export class TerminalService {
  /**
   * Create a new container with terminal access
   */
  static async createContainer(
    userId: string, 
    config: any
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/container`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, config }),
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error creating container:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Get container information
   */
  static async getContainer(
    containerId: string
  ): Promise<{ success: boolean; data?: ContainerInfo; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/container/${containerId}`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting container:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Update container configuration
   */
  static async updateContainer(
    containerId: string,
    config: any
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/container/${containerId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ config }),
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error updating container:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Delete a container
   */
  static async deleteContainer(
    containerId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/container/${containerId}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error deleting container:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * List containers for a user
   */
  static async listUserContainers(
    userId: string
  ): Promise<{ success: boolean; data?: { containers: ContainerInfo[]; totalCount: number }; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/user/${userId}/containers`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error listing containers:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Get container status
   */
  static async getContainerStatus(
    containerId: string
  ): Promise<{ success: boolean; data?: { status: string; isRunning: boolean }; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/container/${containerId}/status`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting container status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Execute command in container
   */
  static async executeCommand(
    containerId: string,
    command: string,
    workingDir?: string
  ): Promise<{ success: boolean; data?: { output: string }; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/container/${containerId}/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command, workingDir }),
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error executing command:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Get container resource statistics
   */
  static async getContainerStats(
    containerId: string
  ): Promise<{ success: boolean; data?: ContainerStats; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/container/${containerId}/stats`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting container stats:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Stream container logs
   */
  static streamContainerLogs(
    containerId: string,
    onMessage: (log: string) => void,
    onError: (error: Error) => void,
    tail: number = 100,
    follow: boolean = false
  ): () => void {
    const url = `${API_BASE}/container/${containerId}/logs?tail=${tail}&follow=${follow}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const logData = JSON.parse(event.data);
        if (logData.type === 'error') {
          onError(new Error(logData.error));
          return;
        }
        onMessage(logData.message || logData);
      } catch (error) {
        onMessage(event.data);
      }
    };

    eventSource.onerror = (event) => {
      onError(new Error('Container log streaming failed'));
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }

  /**
   * Get terminal sessions
   */
  static async getTerminalSessions(): Promise<{ 
    success: boolean; 
    data?: { sessions: TerminalSession[]; totalSessions: number; multiUserSessions: number }; 
    error?: string 
  }> {
    try {
      const response = await fetch(`${API_BASE}/sessions`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting terminal sessions:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Get specific terminal session
   */
  static async getTerminalSession(
    sessionId: string
  ): Promise<{ success: boolean; data?: TerminalSession; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/sessions/${sessionId}`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting terminal session:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Terminate terminal session
   */
  static async terminateSession(
    sessionId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error terminating session:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Get container sessions
   */
  static async getContainerSessions(
    containerId: string
  ): Promise<{ success: boolean; data?: { sessions: TerminalSession[] }; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/container/${containerId}/sessions`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting container sessions:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Get available container templates
   */
  static async getContainerTemplates(): Promise<{ 
    success: boolean; 
    data?: { templates: ContainerTemplate[]; totalTemplates: number }; 
    error?: string 
  }> {
    try {
      const response = await fetch(`${API_BASE}/templates`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting container templates:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Health check for terminal service
   */
  static async healthCheck(): Promise<{ success: boolean; status: string; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/health`);
      const data = await response.json();
      return {
        success: data.success,
        status: data.status,
        error: data.error,
      };
    } catch (error) {
      console.error('Terminal service health check error:', error);
      return {
        success: false,
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Connect to terminal WebSocket
   */
  static connectWebSocket(
    containerId: string,
    sessionId?: string,
    multiUser: boolean = false
  ): WebSocket {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${protocol}//${window.location.host}/api/terminal/${containerId}`;
    
    if (sessionId) {
      wsUrl += `/${sessionId}`;
    }
    
    if (multiUser) {
      wsUrl += `?multiUser=true`;
    }

    return new WebSocket(wsUrl);
  }
}

/**
 * React hooks for terminal functionality
 */
export const useTerminalService = () => {
  return {
    createContainer: TerminalService.createContainer,
    getContainer: TerminalService.getContainer,
    updateContainer: TerminalService.updateContainer,
    deleteContainer: TerminalService.deleteContainer,
    listUserContainers: TerminalService.listUserContainers,
    getContainerStatus: TerminalService.getContainerStatus,
    executeCommand: TerminalService.executeCommand,
    getContainerStats: TerminalService.getContainerStats,
    streamContainerLogs: TerminalService.streamContainerLogs,
    getTerminalSessions: TerminalService.getTerminalSessions,
    getTerminalSession: TerminalService.getTerminalSession,
    terminateSession: TerminalService.terminateSession,
    getContainerSessions: TerminalService.getContainerSessions,
    getContainerTemplates: TerminalService.getContainerTemplates,
    healthCheck: TerminalService.healthCheck,
    connectWebSocket: TerminalService.connectWebSocket,
  };
};

export default TerminalService;
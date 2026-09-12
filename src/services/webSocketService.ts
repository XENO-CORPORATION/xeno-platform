// WebSocket Service for Real-time File Synchronization
// Handles WebSocket connections, file operations, and real-time updates

export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export interface FileChangeEvent {
  type: 'file_change';
  filePath: string;
  changeType: 'add' | 'change' | 'delete';
  userId: string;
  timestamp: string;
}

export interface FileOperationRequest {
  type: 'file_operation';
  operation: 'read_file' | 'write_file' | 'delete_file' | 'list_directory';
  filePath: string;
  content?: string;
  data?: any;
}

export interface AuthMessage {
  type: 'authenticate';
  token: string;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnected = false;
  private clientIdValue: string | null = null;
  private messageHandlers: Map<string, ((message: WebSocketMessage) => void)[]> = new Map();
  private fileWatchers: Map<string, boolean> = new Map();

  constructor(private serverUrl: string = `ws://localhost:4003`) {
  }

  // Connect to WebSocket server
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      try {
        console.log('🔌 Attempting to connect to WebSocket server at:', this.serverUrl);
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          console.log('🔌 Connected to WebSocket server');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        this.ws.onclose = () => {
          console.log('🔌 WebSocket connection closed');
          this.isConnected = false;
          this.clientIdValue = null;
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('🔌 WebSocket error:', error);
          this.isConnected = false;
          reject(error);
        };

      } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        reject(error);
      }
    });
  }

  // Disconnect from WebSocket server
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.clientIdValue = null;
  }

  // Authenticate with session token
  authenticate(token: string): void {
    if (!this.isConnected) {
      console.warn('Cannot authenticate: WebSocket not connected');
      return;
    }

    const authMessage: AuthMessage = {
      type: 'authenticate',
      token: token
    };

    this.sendMessage(authMessage);
  }

  // Send message to server
  private sendMessage(message: WebSocketMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message: WebSocket not connected');
    }
  }

  // Handle incoming messages
  private handleMessage(message: WebSocketMessage): void {
    console.log('📨 Received WebSocket message:', message.type);

    // Handle welcome message
    if (message.type === 'welcome') {
      this.clientIdValue = message.clientId;
      console.log(`🔌 Client ID: ${this.clientIdValue}`);
    }

    // Handle authentication response
    else if (message.type === 'authenticated') {
      console.log('✅ WebSocket authenticated successfully');
      this.emit('authenticated', message);
    }

    // Handle authentication error
    else if (message.type === 'auth_error') {
      console.error('❌ WebSocket authentication failed:', message.message);
      this.emit('auth_error', message);
    }

    // Handle file changes
    else if (message.type === 'file_change') {
      this.emit('file_change', message as FileChangeEvent);
    }

    // Handle file operation responses
    else if (message.type === 'file_content') {
      this.emit('file_content', message);
    }

    else if (message.type === 'file_operation_success') {
      this.emit('file_operation_success', message);
    }

    else if (message.type === 'directory_listing') {
      this.emit('directory_listing', message);
    }

    // Handle errors
    else if (message.type === 'error') {
      console.error('🔌 WebSocket error:', message.message);
      this.emit('error', message);
    }

    // Handle other messages
    else {
      this.emit(message.type, message);
    }
  }

  // File operations
  readFile(filePath: string): void {
    const message: FileOperationRequest = {
      type: 'file_operation',
      operation: 'read_file',
      filePath: filePath
    };
    this.sendMessage(message);
  }

  writeFile(filePath: string, content: string): void {
    const message: FileOperationRequest = {
      type: 'file_operation',
      operation: 'write_file',
      filePath: filePath,
      content: content
    };
    this.sendMessage(message);
  }

  deleteFile(filePath: string): void {
    const message: FileOperationRequest = {
      type: 'file_operation',
      operation: 'delete_file',
      filePath: filePath
    };
    this.sendMessage(message);
  }

  listDirectory(directoryPath: string): void {
    const message: FileOperationRequest = {
      type: 'file_operation',
      operation: 'list_directory',
      filePath: directoryPath
    };
    this.sendMessage(message);
  }

  // Watch directories for changes
  async watchDirectories(directories: string[]): Promise<void> {
    try {
      const response = await fetch('/api/files/watch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          directories: directories,
          action: 'add'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to watch directories');
      }

      directories.forEach(dir => {
        this.fileWatchers.set(dir, true);
      });

      console.log(`👀 Now watching ${directories.length} directories`);
    } catch (error) {
      console.error('Error watching directories:', error);
      throw error;
    }
  }

  // Stop watching directories
  async unwatchDirectories(directories: string[]): Promise<void> {
    try {
      const response = await fetch('/api/files/watch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          directories: directories,
          action: 'remove'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to unwatch directories');
      }

      directories.forEach(dir => {
        this.fileWatchers.delete(dir);
      });

      console.log(`🙈 Stopped watching ${directories.length} directories`);
    } catch (error) {
      console.error('Error unwatching directories:', error);
      throw error;
    }
  }

  // Get watched directories
  async getWatchedDirectories(): Promise<string[]> {
    try {
      const response = await fetch('/api/files/watched');
      if (!response.ok) {
        throw new Error('Failed to get watched directories');
      }
      const data = await response.json();
      return data.directories || [];
    } catch (error) {
      console.error('Error getting watched directories:', error);
      return [];
    }
  }

  // Event system for handling messages
  on(eventType: string, handler: (message: WebSocketMessage) => void): void {
    if (!this.messageHandlers.has(eventType)) {
      this.messageHandlers.set(eventType, []);
    }
    this.messageHandlers.get(eventType)!.push(handler);
  }

  off(eventType: string, handler?: (message: WebSocketMessage) => void): void {
    if (!this.messageHandlers.has(eventType)) {
      return;
    }

    if (handler) {
      const handlers = this.messageHandlers.get(eventType)!;
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    } else {
      this.messageHandlers.delete(eventType);
    }
  }

  private emit(eventType: string, message: WebSocketMessage): void {
    const handlers = this.messageHandlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          console.error(`Error in ${eventType} handler:`, error);
        }
      });
    }
  }

  // Attempt to reconnect on connection loss
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`);

    setTimeout(() => {
      this.connect().catch(error => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }

  // Getters
  get isWebSocketConnected(): boolean {
    return this.isConnected;
  }

  get clientId(): string | null {
    return this.clientIdValue;
  }

  get watchedDirectories(): string[] {
    return Array.from(this.fileWatchers.keys());
  }
}

// Create singleton instance
export const webSocketService = new WebSocketService();

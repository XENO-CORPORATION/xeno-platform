/**
 * XenoOS Terminal Server
 * WebSocket-based terminal server with node-pty integration for Docker containers
 */

const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const pty = require('node-pty');
const Docker = require('dockerode');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

// Environment variables
const PORT = process.env.PORT || 8082;
const DOCKER_HOST = process.env.DOCKER_HOST;
const ALLOWED_COMMANDS = process.env.ALLOWED_COMMANDS?.split(',') || [];
const BLOCKED_COMMANDS = process.env.BLOCKED_COMMANDS?.split(',') || ['rm -rf /', 'dd if=/dev/zero', 'fork bomb'];

// Initialize Docker client
const docker = new Docker(DOCKER_HOST ? { host: DOCKER_HOST } : {});

// Create Express app
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    activeSessions: terminalSessions.size,
    activeContainers: containerSessions.size
  });
});

// Create HTTP server
const server = http.createServer(app);

// Store active terminal sessions
const terminalSessions = new Map();
const containerSessions = new Map();
const multiUserSessions = new Map();

// Terminal session class
class TerminalSession {
  constructor(containerId, sessionId = null, isMultiUser = false) {
    this.id = sessionId || uuidv4();
    this.containerId = containerId;
    this.isMultiUser = isMultiUser;
    this.clients = new Set();
    this.ptyProcess = null;
    this.container = null;
    this.createdAt = new Date();
    this.lastActiveAt = new Date();
    this.currentDirectory = '/home/xenolabs-user';
    this.environment = {};
    this.commandHistory = [];
  }

  async initialize() {
    try {
      // Get container reference
      this.container = docker.getContainer(this.containerId);
      
      // Check if container is running
      const containerInfo = await this.container.inspect();
      if (containerInfo.State.Status !== 'running') {
        throw new Error('Container is not running');
      }

      // Create exec instance for shell
      const exec = await this.container.exec({
        Cmd: ['/bin/bash', '-l'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Env: Object.entries(this.environment).map(([key, value]) => `${key}=${value}`),
        WorkingDir: this.currentDirectory
      });

      // Start the exec process
      const stream = await exec.start({
        hijack: true,
        stdin: true,
        Tty: true
      });

      this.execStream = stream;
      this.execInstance = exec;

      // Handle stream data
      stream.on('data', (data) => {
        const output = data.toString();
        this.broadcastToClients({
          type: 'output',
          data: output,
          timestamp: new Date().toISOString()
        });
      });

      stream.on('error', (error) => {
        console.error('Stream error:', error);
        this.broadcastToClients({
          type: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      });

      stream.on('end', () => {
        console.log('Stream ended for session:', this.id);
        this.cleanup();
      });

      return true;
    } catch (error) {
      console.error('Failed to initialize terminal session:', error);
      throw error;
    }
  }

  addClient(ws, clientId) {
    this.clients.add({ ws, clientId });
    this.lastActiveAt = new Date();
    
    // Send welcome message to new client
    ws.send(JSON.stringify({
      type: 'welcome',
      sessionId: this.id,
      containerId: this.containerId,
      isMultiUser: this.isMultiUser,
      currentDirectory: this.currentDirectory,
      timestamp: new Date().toISOString()
    }));

    // If multi-user, notify other clients about new user
    if (this.isMultiUser && this.clients.size > 1) {
      this.broadcastToClients({
        type: 'user_joined',
        userId: clientId,
        totalUsers: this.clients.size,
        timestamp: new Date().toISOString()
      }, ws);
    }
  }

  removeClient(ws, clientId) {
    this.clients = new Set([...this.clients].filter(client => client.ws !== ws));
    
    // If multi-user, notify other clients about user leaving
    if (this.isMultiUser && this.clients.size > 0) {
      this.broadcastToClients({
        type: 'user_left',
        userId: clientId,
        totalUsers: this.clients.size,
        timestamp: new Date().toISOString()
      });
    }

    // Clean up if no more clients
    if (this.clients.size === 0) {
      setTimeout(() => {
        if (this.clients.size === 0) {
          this.cleanup();
        }
      }, 30000); // 30 second grace period
    }
  }

  broadcastToClients(message, excludeClient = null) {
    const messageStr = JSON.stringify(message);
    this.clients.forEach(({ ws }) => {
      if (ws !== excludeClient && ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }

  async handleInput(data, clientId) {
    try {
      this.lastActiveAt = new Date();

      // Security check for dangerous commands
      if (this.isDangerousCommand(data)) {
        this.broadcastToClients({
          type: 'error',
          error: 'Command blocked for security reasons',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Log command for history
      if (data.trim().length > 0 && !data.startsWith('\x')) {
        this.commandHistory.push({
          command: data.trim(),
          timestamp: new Date(),
          userId: clientId
        });

        // Keep only last 1000 commands
        if (this.commandHistory.length > 1000) {
          this.commandHistory = this.commandHistory.slice(-1000);
        }
      }

      // Send input to container
      if (this.execStream && this.execStream.writable) {
        this.execStream.write(data);
      }

      // Broadcast to other clients in multi-user mode
      if (this.isMultiUser) {
        this.broadcastToClients({
          type: 'input_echo',
          data,
          userId: clientId,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error handling input:', error);
      this.broadcastToClients({
        type: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  async handleResize(cols, rows, clientId) {
    try {
      // Resize the terminal
      if (this.execInstance) {
        await this.execInstance.resize({
          h: rows,
          w: cols
        });
      }

      // Broadcast resize to other clients in multi-user mode
      if (this.isMultiUser) {
        this.broadcastToClients({
          type: 'resize',
          cols,
          rows,
          userId: clientId,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error resizing terminal:', error);
    }
  }

  isDangerousCommand(input) {
    const command = input.toLowerCase().trim();
    
    // Check blocked commands
    for (const blocked of BLOCKED_COMMANDS) {
      if (command.includes(blocked.toLowerCase())) {
        return true;
      }
    }

    // Additional security patterns
    const dangerousPatterns = [
      /rm\s+-rf\s+\/[^\/]/,
      /dd\s+if=\/dev\/(zero|urandom)/,
      /:\(\)\{.*;\};:/,  // Fork bomb pattern
      /curl.*\|\s*sh/,   // Pipe to shell
      /wget.*\|\s*sh/,   // Pipe to shell
      /chmod\s+777\s+\//,  // Dangerous permissions
      /chown\s+.*:.*\s+\//,  // Dangerous ownership changes
    ];

    return dangerousPatterns.some(pattern => pattern.test(command));
  }

  async cleanup() {
    console.log('Cleaning up terminal session:', this.id);

    // Close all client connections
    this.clients.forEach(({ ws }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Session terminated');
      }
    });

    // Clean up exec stream
    if (this.execStream) {
      try {
        this.execStream.end();
      } catch (error) {
        console.error('Error closing exec stream:', error);
      }
    }

    // Remove from sessions
    terminalSessions.delete(this.id);
    
    if (this.isMultiUser) {
      multiUserSessions.delete(this.id);
    }

    // Clean up container session tracking
    const containerSessions = containerSessions.get(this.containerId);
    if (containerSessions) {
      containerSessions.delete(this.id);
      if (containerSessions.size === 0) {
        containerSessions.delete(this.containerId);
      }
    }
  }

  getStats() {
    return {
      id: this.id,
      containerId: this.containerId,
      isMultiUser: this.isMultiUser,
      clientCount: this.clients.size,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
      commandHistory: this.commandHistory.slice(-10), // Last 10 commands
      currentDirectory: this.currentDirectory
    };
  }
}

// WebSocket server
const wss = new WebSocket.Server({ 
  server,
  path: '/api/terminal'
});

wss.on('connection', async (ws, req) => {
  let terminalSession = null;
  let clientId = null;

  try {
    // Parse URL to extract container ID and session ID
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathParts = url.pathname.split('/');
    const containerId = pathParts[3]; // /api/terminal/{containerId}
    const sessionId = pathParts[4]; // /api/terminal/{containerId}/{sessionId} (optional)
    
    if (!containerId) {
      ws.close(1008, 'Container ID required');
      return;
    }

    clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`Terminal connection: ${clientId} -> Container: ${containerId}, Session: ${sessionId || 'new'}`);

    // Find or create terminal session
    if (sessionId && terminalSessions.has(sessionId)) {
      // Join existing session
      terminalSession = terminalSessions.get(sessionId);
      if (terminalSession.containerId !== containerId) {
        ws.close(1008, 'Session belongs to different container');
        return;
      }
    } else {
      // Create new session
      const isMultiUser = url.searchParams.get('multiUser') === 'true';
      terminalSession = new TerminalSession(containerId, sessionId, isMultiUser);
      
      await terminalSession.initialize();
      
      terminalSessions.set(terminalSession.id, terminalSession);
      
      // Track container sessions
      if (!containerSessions.has(containerId)) {
        containerSessions.set(containerId, new Set());
      }
      containerSessions.get(containerId).add(terminalSession.id);

      if (isMultiUser) {
        multiUserSessions.set(terminalSession.id, terminalSession);
      }
    }

    // Add client to session
    terminalSession.addClient(ws, clientId);

    // Handle WebSocket messages
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case 'input':
            await terminalSession.handleInput(message.data, clientId);
            break;

          case 'binary':
            if (message.data && Array.isArray(message.data)) {
              const uint8Array = new Uint8Array(message.data);
              const str = String.fromCharCode.apply(null, Array.from(uint8Array));
              await terminalSession.handleInput(str, clientId);
            }
            break;

          case 'resize':
            await terminalSession.handleResize(message.cols, message.rows, clientId);
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            break;

          case 'get_history':
            ws.send(JSON.stringify({
              type: 'command_history',
              history: terminalSession.commandHistory.slice(-50), // Last 50 commands
              timestamp: new Date().toISOString()
            }));
            break;

          case 'change_directory':
            terminalSession.currentDirectory = message.path || '/home/xenolabs-user';
            break;

          case 'set_environment':
            if (message.env && typeof message.env === 'object') {
              terminalSession.environment = { ...terminalSession.environment, ...message.env };
            }
            break;

          default:
            console.warn('Unknown message type:', message.type);
        }
      } catch (error) {
        console.error('Error processing terminal message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Failed to process message',
          timestamp: new Date().toISOString()
        }));
      }
    });

    // Handle WebSocket close
    ws.on('close', (code, reason) => {
      console.log(`Terminal client disconnected: ${clientId}, code: ${code}, reason: ${reason}`);
      if (terminalSession) {
        terminalSession.removeClient(ws, clientId);
      }
    });

    // Handle WebSocket errors
    ws.on('error', (error) => {
      console.error('Terminal WebSocket error:', error);
      if (terminalSession) {
        terminalSession.removeClient(ws, clientId);
      }
    });

  } catch (error) {
    console.error('Error establishing terminal connection:', error);
    ws.close(1011, 'Internal server error');
  }
});

// REST API endpoints
app.get('/api/terminal/sessions', (req, res) => {
  const sessions = Array.from(terminalSessions.values()).map(session => session.getStats());
  res.json({
    success: true,
    data: {
      sessions,
      totalSessions: sessions.length,
      multiUserSessions: Array.from(multiUserSessions.keys()).length
    }
  });
});

app.get('/api/terminal/sessions/:sessionId', (req, res) => {
  const session = terminalSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Session not found'
    });
  }

  res.json({
    success: true,
    data: session.getStats()
  });
});

app.delete('/api/terminal/sessions/:sessionId', (req, res) => {
  const session = terminalSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Session not found'
    });
  }

  session.cleanup();
  res.json({
    success: true,
    message: 'Session terminated'
  });
});

app.get('/api/terminal/container/:containerId/sessions', (req, res) => {
  const containerSessionIds = containerSessions.get(req.params.containerId);
  if (!containerSessionIds) {
    return res.json({
      success: true,
      data: { sessions: [] }
    });
  }

  const sessions = Array.from(containerSessionIds)
    .map(sessionId => terminalSessions.get(sessionId))
    .filter(session => session)
    .map(session => session.getStats());

  res.json({
    success: true,
    data: { sessions }
  });
});

// Cleanup inactive sessions periodically
setInterval(() => {
  const now = new Date();
  const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  for (const [sessionId, session] of terminalSessions.entries()) {
    if (now - session.lastActiveAt > TIMEOUT_MS) {
      console.log(`Cleaning up inactive session: ${sessionId}`);
      session.cleanup();
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 XenoOS Terminal Server running on port ${PORT}`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
  console.log(`🔌 WebSocket endpoint: ws://localhost:${PORT}/api/terminal/{containerId}`);
});

// Graceful shutdown
const gracefulShutdown = () => {
  console.log('Shutting down terminal server...');
  
  // Clean up all sessions
  for (const session of terminalSessions.values()) {
    session.cleanup();
  }

  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = { server, wss, terminalSessions };
/**
 * XenoOS Collaborative WebSocket Server
 * Handles real-time cursor broadcasting, presence, and collaborative operations
 * Figma-style multiplayer collaboration for OS containers
 */

const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// Environment variables
const PORT = process.env.COLLAB_WS_PORT || 8082;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME || 'xenostudio',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'xenostudio_password',
  max: 10,
});

// Create Express app for health checks
const app = express();
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    sessions: sessions.size,
    connections: clients.size
  });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients by session
// Map<sessionId, Map<userId, ClientInfo>>
const sessions = new Map();

// Store all clients for quick lookup
// Map<WebSocket, ClientInfo>
const clients = new Map();

// Message types
const MessageTypes = {
  // Authentication
  AUTH: 'auth',
  AUTH_SUCCESS: 'auth_success',
  AUTH_ERROR: 'auth_error',

  // Session management
  JOIN_SESSION: 'join_session',
  LEAVE_SESSION: 'leave_session',
  SESSION_JOINED: 'session_joined',
  SESSION_LEFT: 'session_left',

  // Presence
  USER_JOINED: 'user_joined',
  USER_LEFT: 'user_left',
  USERS_LIST: 'users_list',

  // Cursor
  CURSOR_MOVE: 'cursor_move',
  CURSOR_UPDATE: 'cursor_update',

  // Selection
  SELECTION_CHANGE: 'selection_change',
  SELECTION_UPDATE: 'selection_update',

  // File operations
  FILE_OPERATION: 'file_operation',
  FILE_SYNC: 'file_sync',

  // Window operations
  WINDOW_OPERATION: 'window_operation',
  WINDOW_SYNC: 'window_sync',

  // Chat
  CHAT_MESSAGE: 'chat_message',

  // Icon position
  ICON_POSITION: 'icon_position',
  ICON_POSITION_UPDATE: 'icon_position_update',

  // Ping/Pong
  PING: 'ping',
  PONG: 'pong',

  // Errors
  ERROR: 'error'
};

// Verify JWT token
async function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (error) {
    return null;
  }
}

// Get user info from database
async function getUserInfo(userId) {
  try {
    const result = await pool.query(
      'SELECT id, display_name, avatar_url, email FROM users WHERE id = $1',
      [userId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error getting user info:', error);
    return null;
  }
}

// Get participant info from session
async function getParticipantInfo(sessionId, userId) {
  try {
    const result = await pool.query(
      'SELECT * FROM os_session_participants WHERE session_id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error getting participant info:', error);
    return null;
  }
}

// Update participant cursor in database (debounced)
const cursorUpdateQueue = new Map();
async function updateCursorInDB(sessionId, userId, x, y, windowId) {
  const key = `${sessionId}:${userId}`;

  // Debounce cursor updates to database
  if (cursorUpdateQueue.has(key)) {
    clearTimeout(cursorUpdateQueue.get(key));
  }

  cursorUpdateQueue.set(key, setTimeout(async () => {
    try {
      await pool.query(
        `UPDATE os_session_participants
         SET cursor_x = $1, cursor_y = $2, cursor_window_id = $3, last_seen_at = NOW()
         WHERE session_id = $4 AND user_id = $5`,
        [x, y, windowId, sessionId, userId]
      );
    } catch (error) {
      console.error('Error updating cursor in DB:', error);
    }
    cursorUpdateQueue.delete(key);
  }, 500)); // Update DB every 500ms max
}

// Broadcast to all users in a session except sender
function broadcastToSession(sessionId, message, excludeUserId = null) {
  const sessionClients = sessions.get(sessionId);
  if (!sessionClients) {
    console.log(`⚠️ No session found for ${sessionId}`);
    return;
  }

  const messageStr = JSON.stringify(message);
  let sentCount = 0;

  sessionClients.forEach((clientInfo, ws) => {
    if (excludeUserId && clientInfo.userId === excludeUserId) return;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(messageStr);
      sentCount++;
    }
  });

  // Log non-cursor broadcasts (cursor updates are too frequent)
  if (message.type !== 'cursor_update' && message.type !== 'pong') {
    console.log(`📢 Broadcast ${message.type} to ${sentCount} clients in session ${sessionId.substring(0, 8)}...`);
  }
}

// Broadcast to specific user in session
function sendToUser(sessionId, userId, message) {
  const sessionClients = sessions.get(sessionId);
  if (!sessionClients) return;

  const messageStr = JSON.stringify(message);

  sessionClients.forEach((clientInfo, ws) => {
    if (clientInfo.userId === userId && ws.readyState === WebSocket.OPEN) {
      ws.send(messageStr);
    }
  });
}

// Get all users in a session
function getSessionUsers(sessionId) {
  const sessionClients = sessions.get(sessionId);
  if (!sessionClients) return [];

  const users = [];
  sessionClients.forEach((clientInfo) => {
    users.push({
      id: clientInfo.userId,
      odea: clientInfo.userId,
      userId: clientInfo.userId,
      displayName: clientInfo.displayName,
      avatarUrl: clientInfo.avatarUrl,
      color: clientInfo.color,
      cursorX: clientInfo.cursorX,
      cursorY: clientInfo.cursorY,
      cursorWindowId: clientInfo.cursorWindowId,
      selection: clientInfo.selection
    });
  });

  return users;
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection');

  // Initialize client info
  const clientInfo = {
    odea: null,
    userId: null,
    sessionId: null,
    displayName: null,
    avatarUrl: null,
    color: '#3B82F6',
    cursorX: 0,
    cursorY: 0,
    cursorWindowId: null,
    selection: [],
    authenticated: false,
    lastActivity: Date.now()
  };

  clients.set(ws, clientInfo);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to XenoOS Collaboration Server'
  }));

  // Handle messages
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      const client = clients.get(ws);

      if (!client) return;

      client.lastActivity = Date.now();

      switch (message.type) {
        case MessageTypes.AUTH:
          // Authenticate user with JWT token
          const user = await verifyToken(message.token);
          if (!user) {
            ws.send(JSON.stringify({
              type: MessageTypes.AUTH_ERROR,
              error: 'Invalid or expired token'
            }));
            return;
          }

          const userInfo = await getUserInfo(user.userId || user.id);
          if (!userInfo) {
            ws.send(JSON.stringify({
              type: MessageTypes.AUTH_ERROR,
              error: 'User not found'
            }));
            return;
          }

          client.authenticated = true;
          client.userId = userInfo.id;
          client.odea = userInfo.id;  // Set odea to same as userId for consistency
          client.displayName = userInfo.display_name || 'User';
          client.avatarUrl = userInfo.avatar_url;

          ws.send(JSON.stringify({
            type: MessageTypes.AUTH_SUCCESS,
            user: {
              id: userInfo.id,
              displayName: client.displayName,
              avatarUrl: client.avatarUrl
            }
          }));
          break;

        case MessageTypes.JOIN_SESSION:
          if (!client.authenticated) {
            ws.send(JSON.stringify({
              type: MessageTypes.ERROR,
              error: 'Not authenticated'
            }));
            return;
          }

          const { sessionId } = message;

          // Get participant info
          const participant = await getParticipantInfo(sessionId, client.userId);
          if (!participant) {
            ws.send(JSON.stringify({
              type: MessageTypes.ERROR,
              error: 'Not a participant in this session'
            }));
            return;
          }

          // Update client info
          client.sessionId = sessionId;
          client.color = participant.color;
          client.permissions = participant.permissions;

          // Add to session map
          if (!sessions.has(sessionId)) {
            sessions.set(sessionId, new Map());
          }
          sessions.get(sessionId).set(ws, client);

          // Update participant as active in DB
          await pool.query(
            `UPDATE os_session_participants
             SET is_active = true, last_seen_at = NOW()
             WHERE session_id = $1 AND user_id = $2`,
            [sessionId, client.userId]
          );

          // Get existing users in session
          const existingUsers = getSessionUsers(sessionId);

          // Send session joined confirmation with existing users
          ws.send(JSON.stringify({
            type: MessageTypes.SESSION_JOINED,
            sessionId,
            userId: client.userId,
            color: client.color,
            users: existingUsers
          }));

          // Broadcast user joined to others
          broadcastToSession(sessionId, {
            type: MessageTypes.USER_JOINED,
            user: {
              id: client.userId,
              odea: client.userId,
              userId: client.userId,
              displayName: client.displayName,
              avatarUrl: client.avatarUrl,
              color: client.color
            }
          }, client.userId);

          console.log(`User ${client.displayName} joined session ${sessionId}`);
          break;

        case MessageTypes.LEAVE_SESSION:
          if (client.sessionId) {
            const sid = client.sessionId;

            // Remove from session map
            const sessionMap = sessions.get(sid);
            if (sessionMap) {
              sessionMap.delete(ws);
              if (sessionMap.size === 0) {
                sessions.delete(sid);
              }
            }

            // Update participant as inactive in DB
            await pool.query(
              `UPDATE os_session_participants
               SET is_active = false, last_seen_at = NOW()
               WHERE session_id = $1 AND user_id = $2`,
              [sid, client.userId]
            );

            // Broadcast user left
            broadcastToSession(sid, {
              type: MessageTypes.USER_LEFT,
              userId: client.userId
            });

            client.sessionId = null;

            ws.send(JSON.stringify({
              type: MessageTypes.SESSION_LEFT,
              sessionId: sid
            }));

            console.log(`User ${client.displayName} left session ${sid}`);
          }
          break;

        case MessageTypes.CURSOR_MOVE:
          if (!client.sessionId) return;
          if (!client.userId) {
            console.log('CURSOR_MOVE ignored - no userId');
            return;
          }

          const { x, y, windowId } = message;

          // Update local state
          client.cursorX = x;
          client.cursorY = y;
          client.cursorWindowId = windowId;

          // Update in database (debounced)
          updateCursorInDB(client.sessionId, client.userId, x, y, windowId);

          // Log occasionally (1 in 60 updates)
          if (Math.random() < 0.016) {
            console.log(`📍 Broadcasting cursor: ${client.displayName} (${client.userId}) at ${x},${y}`);
          }

          // Broadcast to session immediately
          broadcastToSession(client.sessionId, {
            type: MessageTypes.CURSOR_UPDATE,
            userId: client.userId,
            displayName: client.displayName,
            color: client.color,
            x,
            y,
            windowId
          }, client.userId);
          break;

        case MessageTypes.SELECTION_CHANGE:
          if (!client.sessionId) return;

          client.selection = message.selection || [];

          broadcastToSession(client.sessionId, {
            type: MessageTypes.SELECTION_UPDATE,
            userId: client.userId,
            color: client.color,
            selection: client.selection
          }, client.userId);
          break;

        case MessageTypes.FILE_OPERATION:
          if (!client.sessionId) return;

          // Broadcast file operation to all in session
          broadcastToSession(client.sessionId, {
            type: MessageTypes.FILE_SYNC,
            userId: client.userId,
            displayName: client.displayName,
            operation: message.operation, // create, delete, rename, move
            path: message.path,
            newPath: message.newPath,
            itemType: message.itemType, // file or folder
            timestamp: new Date().toISOString()
          });
          break;

        case MessageTypes.WINDOW_OPERATION:
          if (!client.sessionId) return;

          // Broadcast window operation to all in session
          broadcastToSession(client.sessionId, {
            type: MessageTypes.WINDOW_SYNC,
            userId: client.userId,
            displayName: client.displayName,
            operation: message.operation, // open, close, minimize, maximize, move, resize
            windowId: message.windowId,
            windowType: message.windowType,
            windowTitle: message.windowTitle,
            position: message.position,
            size: message.size,
            timestamp: new Date().toISOString()
          });
          break;

        case MessageTypes.CHAT_MESSAGE:
          if (!client.sessionId) return;

          // Broadcast chat message to all in session
          broadcastToSession(client.sessionId, {
            type: MessageTypes.CHAT_MESSAGE,
            userId: client.userId,
            displayName: client.displayName,
            avatarUrl: client.avatarUrl,
            color: client.color,
            message: message.message,
            timestamp: new Date().toISOString()
          });
          break;

        case MessageTypes.ICON_POSITION:
          if (!client.sessionId) return;

          // Broadcast icon position update to all in session
          broadcastToSession(client.sessionId, {
            type: MessageTypes.ICON_POSITION_UPDATE,
            userId: client.userId,
            displayName: client.displayName,
            iconId: message.iconId,
            position: message.position,
            isDragging: message.isDragging,
            timestamp: new Date().toISOString()
          }, client.userId);
          break;

        case MessageTypes.PING:
          ws.send(JSON.stringify({ type: MessageTypes.PONG }));
          break;

        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: MessageTypes.ERROR,
        error: 'Failed to process message'
      }));
    }
  });

  // Handle ping/pong for connection keepalive
  ws.on('ping', () => {
    ws.pong();
  });

  // Handle disconnection
  ws.on('close', async (code, reason) => {
    const client = clients.get(ws);

    if (client) {
      console.log(`Client disconnected: ${client.displayName || 'Unknown'}, code: ${code}`);

      // Remove from session
      if (client.sessionId) {
        const sessionMap = sessions.get(client.sessionId);
        if (sessionMap) {
          sessionMap.delete(ws);
          if (sessionMap.size === 0) {
            sessions.delete(client.sessionId);
          }
        }

        // Update participant as inactive in DB (only if userId is set)
        if (client.userId) {
          try {
            await pool.query(
              `UPDATE os_session_participants
               SET is_active = false, last_seen_at = NOW()
               WHERE session_id = $1 AND user_id = $2`,
              [client.sessionId, client.userId]
            );
          } catch (error) {
            console.error('Error updating participant on disconnect:', error);
          }

          // Only broadcast user left if userId is defined
          broadcastToSession(client.sessionId, {
            type: MessageTypes.USER_LEFT,
            userId: client.userId
          });
        } else {
          console.log('Client disconnected without userId, not broadcasting USER_LEFT');
        }
      }

      clients.delete(ws);
    }
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Cleanup inactive connections periodically
setInterval(() => {
  const now = Date.now();
  const timeout = 30000; // 30 seconds

  clients.forEach((client, ws) => {
    if (now - client.lastActivity > timeout) {
      // Send ping to check if still alive
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }
  });
}, 15000);

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 XenoOS Collaboration WebSocket Server running on port ${PORT}`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down Collaboration WebSocket server...');

  // Notify all clients
  clients.forEach((client, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'server_shutdown',
        message: 'Server is shutting down'
      }));
      ws.close();
    }
  });

  wss.close();
  server.close();
  pool.end();
});

process.on('SIGINT', () => {
  console.log('Shutting down Collaboration WebSocket server...');
  wss.close();
  server.close();
  pool.end();
});

module.exports = { wss, sessions, clients };

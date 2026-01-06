// XenoOS WebSocket Gateway Server
// Real-time collaboration and communication server

const WebSocket = require('ws');
const express = require('express');
const http = require('http');

// Environment variables
const PORT = process.env.PORT || 8081;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';

// Create Express app for health checks
const app = express();
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients
const clients = new Map();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientId = Date.now() + Math.random().toString(36).substr(2, 9);
  const clientInfo = {
    id: clientId,
    ip: req.socket.remoteAddress,
    connectedAt: new Date(),
    userAgent: req.headers['user-agent']
  };

  clients.set(ws, clientInfo);

  console.log(`Client connected: ${clientId} from ${req.socket.remoteAddress}`);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    clientId: clientId,
    message: 'Connected to XenoOS WebSocket Gateway'
  }));

  // Handle ping/pong to keep connection alive
  ws.on('ping', () => {
    console.log(`Ping received from ${clientId}`);
    ws.pong();
  });

  // Handle pong responses
  ws.on('pong', () => {
    console.log(`Pong received from ${clientId}`);
  });

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      // Broadcast to all other clients (basic implementation)
      clients.forEach((info, clientWs) => {
        if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            ...message,
            from: clientId,
            timestamp: new Date().toISOString()
          }));
        }
      });
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });

  // Handle disconnection
  ws.on('close', (code, reason) => {
    const info = clients.get(ws);
    if (info) {
      console.log(`Client disconnected: ${info.id}, code: ${code}, reason: ${reason.toString()}`);
      clients.delete(ws);
    }
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 XenoOS WebSocket Gateway running on port ${PORT}`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down WebSocket server...');
  wss.close();
  server.close();
});

process.on('SIGINT', () => {
  console.log('Shutting down WebSocket server...');
  wss.close();
  server.close();
});

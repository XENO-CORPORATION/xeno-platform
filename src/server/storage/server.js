// XenoOS File Storage Server
// Account-based file sharing and storage service

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

// Environment variables
const PORT = process.env.PORT || 8082;
const POSTGRES_URL = process.env.POSTGRES_URL;

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'XenoOS File Storage',
    timestamp: new Date().toISOString()
  });
});

// File operations API
app.get('/api/files', async (req, res) => {
  try {
    const { userId, shareId } = req.query;

    if (!userId && !shareId) {
      return res.status(400).json({
        error: 'Either userId or shareId is required'
      });
    }

    // Basic file listing (placeholder implementation)
    const basePath = shareId ? `/data/shared/${shareId}` : `/data/users/${userId}`;

    try {
      const files = await fs.readdir(basePath);
      res.json({
        files: files.map(file => ({
          name: file,
          path: path.join(basePath, file),
          type: 'file'
        }))
      });
    } catch (error) {
      // Directory doesn't exist yet, return empty list
      res.json({ files: [] });
    }
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create share endpoint
app.post('/api/shares', async (req, res) => {
  try {
    const { ownerId, shareName, shareType, permissions } = req.body;

    if (!ownerId || !shareName || !shareType) {
      return res.status(400).json({
        error: 'ownerId, shareName, and shareType are required'
      });
    }

    // Create share directory
    const sharePath = `/data/shared/${ownerId}_${shareName}`;
    await fs.mkdir(sharePath, { recursive: true });

    res.json({
      shareId: `${ownerId}_${shareName}`,
      shareName,
      shareType,
      sharePath,
      permissions: permissions || {},
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error creating share:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload file endpoint
app.post('/api/files/upload', async (req, res) => {
  try {
    const { userId, shareId, fileName } = req.body;

    if (!userId || !fileName) {
      return res.status(400).json({
        error: 'userId and fileName are required'
      });
    }

    const basePath = shareId ? `/data/shared/${shareId}` : `/data/users/${userId}`;
    const filePath = path.join(basePath, fileName);

    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Create a placeholder file
    await fs.writeFile(filePath, `XenoOS file: ${fileName}\nCreated: ${new Date().toISOString()}`);

    res.json({
      fileName,
      filePath,
      uploadedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 XenoOS File Storage Server running on port ${PORT}`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
  console.log(`📁 User data directory: /data/users`);
  console.log(`📁 Shared data directory: /data/shared`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down File Storage server...');
});

process.on('SIGINT', () => {
  console.log('Shutting down File Storage server...');
});

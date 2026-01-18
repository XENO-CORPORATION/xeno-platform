/**
 * Download Routes
 * API endpoints for media downloads from YouTube, Twitter, Instagram, TikTok
 */

import express from 'express';
import fs from 'fs';
import downloadService from '../services/downloadService.js';

const router = express.Router();

/**
 * POST /api/download/info
 * Fetch media information without downloading
 */
router.post('/info', async (req, res) => {
  try {
    const { url, platform } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required',
      });
    }

    // Validate URL format
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format',
      });
    }

    console.log(`[Download] Fetching info for: ${url}`);

    const mediaInfo = await downloadService.fetchMediaInfo(url);

    res.json({
      success: true,
      data: mediaInfo,
    });
  } catch (error) {
    console.error('[Download] Error fetching info:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch media info',
    });
  }
});

/**
 * POST /api/download/start
 * Start downloading media
 */
router.post('/start', async (req, res) => {
  try {
    const { url, quality, format, audioOnly } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required',
      });
    }

    console.log(`[Download] Starting download: ${url} (quality: ${quality})`);

    const downloadId = await downloadService.startDownload(url, {
      quality: quality || 'best',
      format: format || 'mp4',
      audioOnly: audioOnly || false,
    });

    res.json({
      success: true,
      data: {
        downloadId,
        message: 'Download started',
      },
    });
  } catch (error) {
    console.error('[Download] Error starting download:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start download',
    });
  }
});

/**
 * GET /api/download/status/:id
 * Get download progress/status
 */
router.get('/status/:id', (req, res) => {
  try {
    const { id } = req.params;

    const status = downloadService.getDownloadStatus(id);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Download not found',
      });
    }

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('[Download] Error getting status:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get download status',
    });
  }
});

/**
 * GET /api/download/list
 * List all active downloads
 */
router.get('/list', (req, res) => {
  try {
    const downloads = downloadService.getAllDownloads();

    res.json({
      success: true,
      data: downloads,
    });
  } catch (error) {
    console.error('[Download] Error listing downloads:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to list downloads',
    });
  }
});

/**
 * GET /api/download/file/:id
 * Download the completed file
 */
router.get('/file/:id', (req, res) => {
  try {
    const { id } = req.params;

    const fileInfo = downloadService.getDownloadFile(id);

    if (!fileInfo) {
      return res.status(404).json({
        success: false,
        error: 'File not found or download not completed',
      });
    }

    // Check if file exists
    if (!fs.existsSync(fileInfo.filepath)) {
      return res.status(404).json({
        success: false,
        error: 'File has been deleted',
      });
    }

    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.filename}"`);
    res.setHeader('Content-Length', fileInfo.filesize);

    // Determine content type
    const ext = fileInfo.filename.split('.').pop().toLowerCase();
    const contentTypes = {
      mp4: 'video/mp4',
      webm: 'video/webm',
      mkv: 'video/x-matroska',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
    };
    res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');

    // Stream the file
    const fileStream = fs.createReadStream(fileInfo.filepath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('[Download] Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Error streaming file',
        });
      }
    });
  } catch (error) {
    console.error('[Download] Error serving file:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to serve file',
    });
  }
});

/**
 * DELETE /api/download/:id
 * Delete a download
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    downloadService.deleteDownload(id);

    res.json({
      success: true,
      message: 'Download deleted',
    });
  } catch (error) {
    console.error('[Download] Error deleting download:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete download',
    });
  }
});

/**
 * POST /api/download/cleanup
 * Trigger manual cleanup of old downloads
 */
router.post('/cleanup', (req, res) => {
  try {
    downloadService.cleanupOldDownloads();

    res.json({
      success: true,
      message: 'Cleanup completed',
    });
  } catch (error) {
    console.error('[Download] Error during cleanup:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Cleanup failed',
    });
  }
});

/**
 * POST /api/download/cookies
 * Save YouTube cookies for authentication
 * Body: { cookies: "Netscape format cookie string" }
 */
router.post('/cookies', (req, res) => {
  try {
    const { cookies } = req.body;

    if (!cookies || typeof cookies !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Cookies string is required',
      });
    }

    downloadService.saveCookies(cookies);

    res.json({
      success: true,
      message: 'Cookies saved successfully',
    });
  } catch (error) {
    console.error('[Download] Error saving cookies:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to save cookies',
    });
  }
});

/**
 * GET /api/download/cookies/status
 * Check if cookies are configured
 */
router.get('/cookies/status', (req, res) => {
  try {
    const hasCookies = downloadService.hasCookies();

    res.json({
      success: true,
      data: {
        hasCookies,
      },
    });
  } catch (error) {
    console.error('[Download] Error checking cookies:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check cookies status',
    });
  }
});

/**
 * DELETE /api/download/cookies
 * Remove saved cookies
 */
router.delete('/cookies', (req, res) => {
  try {
    downloadService.deleteCookies();

    res.json({
      success: true,
      message: 'Cookies deleted',
    });
  } catch (error) {
    console.error('[Download] Error deleting cookies:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete cookies',
    });
  }
});

export default router;

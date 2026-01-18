/**
 * Download Service
 * Handles media downloads from YouTube, Twitter, Instagram, TikTok using yt-dlp
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Downloads directory
const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
const COOKIES_FILE = path.join(__dirname, '..', 'downloads', 'cookies.txt');

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Active downloads tracking
const activeDownloads = new Map();

/**
 * Save cookies for YouTube authentication
 * @param {string} cookiesContent - Netscape format cookies
 */
export const saveCookies = (cookiesContent) => {
  fs.writeFileSync(COOKIES_FILE, cookiesContent, 'utf8');
  return true;
};

/**
 * Check if cookies file exists
 */
export const hasCookies = () => {
  return fs.existsSync(COOKIES_FILE);
};

/**
 * Delete cookies file
 */
export const deleteCookies = () => {
  if (fs.existsSync(COOKIES_FILE)) {
    fs.unlinkSync(COOKIES_FILE);
  }
  return true;
};

// Platform detection
const detectPlatform = (url) => {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('tiktok.com')) return 'tiktok';
  return 'unknown';
};

/**
 * Fetch media information without downloading
 */
export const fetchMediaInfo = async (url) => {
  return new Promise((resolve, reject) => {
    const platform = detectPlatform(url);

    // yt-dlp arguments for fetching info only
    const args = [
      '--dump-json',
      '--no-download',
      '--no-warnings',
      '--no-check-certificates',
    ];

    // Add platform-specific options
    if (platform === 'youtube') {
      // Use cookies if available (required for bot detection bypass)
      if (hasCookies()) {
        args.push('--cookies', COOKIES_FILE);
      }
      // Try multiple clients to bypass bot detection
      args.push('--extractor-args', 'youtube:player_client=web');
      args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    } else if (platform === 'twitter') {
      args.push('--extractor-args', 'twitter:api=syndication');
    } else if (platform === 'instagram') {
      args.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1');
    }

    // Add URL last
    args.push(url);

    const ytdlp = spawn('yt-dlp', args);

    let stdout = '';
    let stderr = '';

    ytdlp.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code !== 0) {
        console.error('yt-dlp error:', stderr);
        reject(new Error(stderr || 'Failed to fetch media info'));
        return;
      }

      try {
        const info = JSON.parse(stdout);

        // Extract relevant information
        const mediaInfo = {
          id: info.id,
          title: info.title || 'Unknown Title',
          description: info.description || '',
          thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || '',
          duration: formatDuration(info.duration),
          durationSeconds: info.duration || 0,
          author: info.uploader || info.channel || info.creator || 'Unknown',
          authorUrl: info.uploader_url || info.channel_url || '',
          platform,
          originalUrl: url,
          uploadDate: info.upload_date || '',
          viewCount: info.view_count || 0,
          likeCount: info.like_count || 0,
          mediaType: determineMediaType(info),
          formats: extractFormats(info.formats || []),
          bestFormat: info.format || '',
        };

        resolve(mediaInfo);
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        reject(new Error('Failed to parse media info'));
      }
    });

    ytdlp.on('error', (error) => {
      console.error('yt-dlp spawn error:', error);
      reject(new Error('yt-dlp not available'));
    });
  });
};

/**
 * Start downloading media
 */
export const startDownload = async (url, options = {}) => {
  const downloadId = uuidv4();
  const platform = detectPlatform(url);

  const {
    quality = 'best',
    format = 'mp4',
    audioOnly = false,
  } = options;

  // Create download entry
  const downloadInfo = {
    id: downloadId,
    url,
    platform,
    status: 'starting',
    progress: 0,
    speed: '',
    eta: '',
    filename: '',
    filepath: '',
    filesize: 0,
    error: null,
    startedAt: new Date(),
    completedAt: null,
  };

  activeDownloads.set(downloadId, downloadInfo);

  // Build yt-dlp arguments
  const outputTemplate = path.join(DOWNLOADS_DIR, `${downloadId}.%(ext)s`);

  const args = [
    '-o', outputTemplate,
    '--no-warnings',
    '--no-check-certificates',
    '--newline', // Progress on new lines for parsing
  ];

  // Platform-specific options (same as fetchMediaInfo)
  if (platform === 'youtube') {
    if (hasCookies()) {
      args.push('--cookies', COOKIES_FILE);
    }
    args.push('--extractor-args', 'youtube:player_client=web');
    args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  } else if (platform === 'twitter') {
    args.push('--extractor-args', 'twitter:api=syndication');
  } else if (platform === 'instagram') {
    args.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1');
  } else if (platform === 'tiktok') {
    args.push('--user-agent', 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36');
  }

  // Quality/format options
  if (audioOnly) {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    switch (quality) {
      case 'best':
        args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
        break;
      case '1080p':
        args.push('-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best');
        break;
      case '720p':
        args.push('-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best');
        break;
      case '480p':
        args.push('-f', 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best');
        break;
      default:
        args.push('-f', 'best');
    }
  }

  // Add URL last
  args.push(url);

  // Start download process
  const ytdlp = spawn('yt-dlp', args);

  ytdlp.stdout.on('data', (data) => {
    const output = data.toString();
    parseProgress(downloadId, output);
  });

  ytdlp.stderr.on('data', (data) => {
    const output = data.toString();
    console.error('yt-dlp stderr:', output);

    // Check for errors
    if (output.includes('ERROR')) {
      const download = activeDownloads.get(downloadId);
      if (download) {
        download.status = 'error';
        download.error = output;
      }
    }
  });

  ytdlp.on('close', (code) => {
    const download = activeDownloads.get(downloadId);
    if (!download) return;

    if (code === 0) {
      // Find the downloaded file
      const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.startsWith(downloadId));
      if (files.length > 0) {
        const filename = files[0];
        const filepath = path.join(DOWNLOADS_DIR, filename);
        const stats = fs.statSync(filepath);

        download.status = 'completed';
        download.progress = 100;
        download.filename = filename;
        download.filepath = filepath;
        download.filesize = stats.size;
        download.completedAt = new Date();
      } else {
        download.status = 'error';
        download.error = 'Downloaded file not found';
      }
    } else {
      download.status = 'error';
      download.error = download.error || `Process exited with code ${code}`;
    }
  });

  ytdlp.on('error', (error) => {
    const download = activeDownloads.get(downloadId);
    if (download) {
      download.status = 'error';
      download.error = error.message;
    }
  });

  return downloadId;
};

/**
 * Parse yt-dlp progress output
 */
const parseProgress = (downloadId, output) => {
  const download = activeDownloads.get(downloadId);
  if (!download) return;

  // Update status
  if (download.status === 'starting') {
    download.status = 'downloading';
  }

  // Parse progress line: [download]  45.2% of 123.45MiB at 2.34MiB/s ETA 00:42
  const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%\s+of\s+(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)/);
  if (progressMatch) {
    download.progress = parseFloat(progressMatch[1]);
    download.filesize = progressMatch[2];
    download.speed = progressMatch[3];
    download.eta = progressMatch[4];
  }

  // Check for destination filename
  const destMatch = output.match(/\[download\] Destination: (.+)/);
  if (destMatch) {
    download.filename = path.basename(destMatch[1]);
  }

  // Check for merge message
  if (output.includes('[Merger]') || output.includes('Merging formats')) {
    download.status = 'merging';
  }
};

/**
 * Get download status
 */
export const getDownloadStatus = (downloadId) => {
  return activeDownloads.get(downloadId) || null;
};

/**
 * Get all active downloads
 */
export const getAllDownloads = () => {
  return Array.from(activeDownloads.values());
};

/**
 * Get download file path for serving
 */
export const getDownloadFile = (downloadId) => {
  const download = activeDownloads.get(downloadId);
  if (!download || download.status !== 'completed') {
    return null;
  }
  return {
    filepath: download.filepath,
    filename: download.filename,
    filesize: download.filesize,
  };
};

/**
 * Delete a download
 */
export const deleteDownload = (downloadId) => {
  const download = activeDownloads.get(downloadId);
  if (download && download.filepath && fs.existsSync(download.filepath)) {
    fs.unlinkSync(download.filepath);
  }
  activeDownloads.delete(downloadId);
};

/**
 * Clean up old downloads (files older than 1 hour)
 */
export const cleanupOldDownloads = () => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);

  // Clean up completed downloads from memory
  for (const [id, download] of activeDownloads.entries()) {
    if (download.completedAt && new Date(download.completedAt).getTime() < oneHourAgo) {
      deleteDownload(id);
    }
  }

  // Clean up orphaned files
  if (fs.existsSync(DOWNLOADS_DIR)) {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    for (const file of files) {
      const filepath = path.join(DOWNLOADS_DIR, file);
      const stats = fs.statSync(filepath);
      if (stats.mtimeMs < oneHourAgo) {
        fs.unlinkSync(filepath);
      }
    }
  }
};

// Helper functions
const formatDuration = (seconds) => {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const determineMediaType = (info) => {
  if (info.categories?.includes('Music') || info._type === 'audio') {
    return 'audio';
  }
  if (info.duration && info.duration > 0) {
    return 'video';
  }
  if (info.ext && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(info.ext)) {
    return 'image';
  }
  return 'video';
};

const extractFormats = (formats) => {
  // Filter and simplify format list
  return formats
    .filter(f => f.vcodec !== 'none' || f.acodec !== 'none')
    .map(f => ({
      formatId: f.format_id,
      ext: f.ext,
      resolution: f.resolution || (f.height ? `${f.height}p` : 'audio'),
      filesize: f.filesize || f.filesize_approx,
      hasVideo: f.vcodec !== 'none',
      hasAudio: f.acodec !== 'none',
    }))
    .slice(0, 10); // Limit to 10 formats
};

// Start cleanup interval
setInterval(cleanupOldDownloads, 15 * 60 * 1000); // Every 15 minutes

export default {
  fetchMediaInfo,
  startDownload,
  getDownloadStatus,
  getAllDownloads,
  getDownloadFile,
  deleteDownload,
  cleanupOldDownloads,
  saveCookies,
  hasCookies,
  deleteCookies,
};

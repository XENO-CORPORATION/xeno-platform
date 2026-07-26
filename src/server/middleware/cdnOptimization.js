/**
 * CDN & Cache Optimization Middleware
 *
 * - Sets proper Cache-Control headers for static assets
 * - R2 signed URL generation for private downloads
 * - ETag support for conditional requests
 * - Compression headers
 */

import crypto from 'crypto';
import { updatesOrigin } from '../config/hosts.js';

// --------------------------------------------------------------------------
// Cache header presets
// --------------------------------------------------------------------------
const CACHE_PROFILES = {
  // Immutable assets (hashed filenames) — cache for 1 year
  immutable: 'public, max-age=31536000, immutable',

  // Static assets (CSS, JS, images) — cache for 1 day, revalidate
  static: 'public, max-age=86400, stale-while-revalidate=3600',

  // HTML pages — cache briefly, always revalidate
  html: 'public, max-age=300, must-revalidate',

  // API responses — no cache by default
  api: 'no-store, no-cache, must-revalidate',

  // API responses that can be cached briefly (models list, etc.)
  apiShort: 'public, max-age=60, stale-while-revalidate=30',

  // Download files — cache for 1 hour
  download: 'public, max-age=3600',

  // Private/authenticated content — no shared cache
  private: 'private, no-cache, must-revalidate',
};

// File extension to cache profile mapping
const EXT_CACHE_MAP = {
  // Immutable (usually hashed in build)
  '.js': 'static',
  '.css': 'static',
  '.woff': 'immutable',
  '.woff2': 'immutable',
  '.ttf': 'immutable',

  // Static media
  '.png': 'static',
  '.jpg': 'static',
  '.jpeg': 'static',
  '.gif': 'static',
  '.svg': 'static',
  '.webp': 'static',
  '.ico': 'static',
  '.avif': 'static',

  // HTML — short cache
  '.html': 'html',

  // Downloads
  '.exe': 'download',
  '.dmg': 'download',
  '.AppImage': 'download',
  '.zip': 'download',
  '.tar.gz': 'download',

  // Data
  '.json': 'apiShort',
  '.xml': 'apiShort',
};

// --------------------------------------------------------------------------
// Static asset cache headers middleware
// --------------------------------------------------------------------------
export function staticCacheMiddleware(req, res, next) {
  // Only apply to GET requests
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const ext = getExtension(req.path);
  const profile = EXT_CACHE_MAP[ext];

  if (profile) {
    res.setHeader('Cache-Control', CACHE_PROFILES[profile]);

    // Add Vary header for content negotiation
    res.setHeader('Vary', 'Accept-Encoding');
  }

  // If the path contains a hash pattern (e.g., main.a1b2c3d4.js), use immutable
  if (/\.[0-9a-f]{8,}\.(js|css|woff2?|ttf|png|jpg|svg|webp)$/i.test(req.path)) {
    res.setHeader('Cache-Control', CACHE_PROFILES.immutable);
  }

  next();
}

// --------------------------------------------------------------------------
// API response cache middleware
// --------------------------------------------------------------------------
export function apiCacheMiddleware(req, res, next) {
  // Default: no-cache for API
  if (!res.getHeader('Cache-Control')) {
    res.setHeader('Cache-Control', CACHE_PROFILES.api);
  }

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');

  next();
}

// --------------------------------------------------------------------------
// R2 Signed URL generation for private downloads
// --------------------------------------------------------------------------

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET || 'xeno-hub-releases';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || updatesOrigin();

/**
 * Generate a signed URL for private R2 downloads
 * Uses HMAC-based signing compatible with S3/R2 presigned URLs
 *
 * @param {string} key - Object key in R2 bucket
 * @param {number} expiresIn - Seconds until expiration (default: 1 hour)
 * @returns {string} Signed URL
 */
export function generateSignedUrl(key, expiresIn = 3600) {
  if (!R2_ACCESS_KEY || !R2_SECRET_KEY) {
    // Fall back to public URL if no signing keys configured
    return `${R2_PUBLIC_URL}/${encodeURIComponent(key)}`;
  }

  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const stringToSign = `GET\n\n\n${expires}\n/${R2_BUCKET}/${key}`;

  const signature = crypto
    .createHmac('sha1', R2_SECRET_KEY)
    .update(stringToSign)
    .digest('base64');

  const encodedSignature = encodeURIComponent(signature);
  return `${R2_PUBLIC_URL}/${encodeURIComponent(key)}?AWSAccessKeyId=${R2_ACCESS_KEY}&Expires=${expires}&Signature=${encodedSignature}`;
}

/**
 * Generate a download URL for an app version
 *
 * @param {string} app - App name (e.g., 'pixel', 'hub')
 * @param {string} version - Version string (e.g., '0.1.0')
 * @param {string} filename - Installer filename
 * @param {boolean} signed - Whether to sign the URL
 * @returns {string} Download URL
 */
export function getDownloadUrl(app, version, filename, signed = false) {
  const key = `apps/${app}/v${version}/${filename}`;

  if (signed && R2_ACCESS_KEY) {
    return generateSignedUrl(key, 7200); // 2 hour expiry
  }

  return `${R2_PUBLIC_URL}/${key}`;
}

// --------------------------------------------------------------------------
// Security headers middleware (defense in depth)
// --------------------------------------------------------------------------
export function securityHeadersMiddleware(req, res, next) {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // XSS protection (legacy browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  next();
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function getExtension(filepath) {
  const lastDot = filepath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filepath.substring(lastDot).toLowerCase();
}

export default {
  staticCacheMiddleware,
  apiCacheMiddleware,
  generateSignedUrl,
  getDownloadUrl,
  securityHeadersMiddleware,
  CACHE_PROFILES,
};

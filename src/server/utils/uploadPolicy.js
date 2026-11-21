/**
 * What a person may upload: the declared types the platform accepts, one list for every upload path (POST /api/upload,
 * file versions, and XENO Storage upload sessions in services/storageUploads.js). Moved here from index.js on
 * 2026-11-21 so the sessions use the same list rather than a copy.
 */
export const ALLOWED_UPLOAD_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf', 'text/plain', 'application/json',
  'text/csv', 'text/markdown', 'text/html', 'application/xml',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/octet-stream',
  'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/mp4',
]);

/** The single-request limit: POST /api/upload sends one body, and Cloudflare refuses a body above 100 MB. */
export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

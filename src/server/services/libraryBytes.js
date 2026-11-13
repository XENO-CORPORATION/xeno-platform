/**
 * The ONE way server code reads the bytes of a person's Library file.
 *
 * Every caller that hands a Library file to something else (an image model as a reference, the chat's
 * code sandbox as an attachment) goes through here, so each gets the same checks:
 *   - the principal holds `viewer` on `library_asset:<id>` (ReBAC), and the file is not deleted;
 *   - the file has passed its scan (`ingestion_safe`);
 *   - the caller's type and size rules;
 *   - the bytes come from the managed uploads store only (realpath defeats a planted symlink/junction);
 *   - a bounded handle read defeats a file that grows between stat and read;
 *   - the bytes sniff as the recorded type and hash to the recorded SHA-256.
 *
 * Asset ids only: no model-controlled path or URL is accepted. Extracted 2026-11-13 from
 * mediaGenerations.readGenerationReferences so the sandbox would not grow a second, weaker reader.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuthorizedLibraryFile, sniffMime } from './libraryAssets.js';
import { localLibraryPath } from './storageObjects.js';
import { userPrincipal } from './chatProjectAuthority.js';

/** Types sniffMime recognises by magic number. */
const SIGNED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

/** A refusal with a stable reason; callers map it to their own error vocabulary. */
export class LibraryReadError extends Error {
  constructor(reason, message = reason) {
    super(message);
    this.name = 'LibraryReadError';
    this.reason = reason; // forbidden | not_ready | invalid_media | too_large | path_forbidden | changed
  }
}

/** The managed uploads roots. The folder is mounted at two paths in the containers. */
async function managedRoots(uploadsDir) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dirs = uploadsDir ? [uploadsDir] : [path.resolve(here, '../uploads'), path.resolve('src/server/uploads')];
  return (await Promise.all(dirs.map((dir) => fs.realpath(dir).catch(() => null)))).filter(Boolean);
}

/**
 * Read one Library file's bytes for a user, or throw LibraryReadError.
 *
 * @param {object}   db
 * @param {string}   userId           the person the read is for
 * @param {string}   assetId          the Library asset id
 * @param {object}   rules
 * @param {number}   rules.maxBytes   refuse anything larger
 * @param {string[]} [rules.allowedMimes]  when given, refuse any other recorded type
 * @param {string}   [rules.uploadsDir]    test seam: the managed store root
 * @param {object}   [rules.deps]          test seam: { getFile, localPath }
 * @returns {Promise<{ file: object, bytes: Buffer }>}
 */
export async function readAuthorizedLibraryBytes(db, userId, assetId, { maxBytes, allowedMimes = null, uploadsDir = null, deps = {} } = {}) {
  if (!(maxBytes > 0)) throw new Error('readAuthorizedLibraryBytes requires maxBytes');
  const getFile = deps.getFile || getAuthorizedLibraryFile;
  const localPath = deps.localPath || localLibraryPath;

  const file = await getFile(db, userPrincipal(userId), assetId);
  if (!file) throw new LibraryReadError('forbidden');
  if (!file.ingestion_safe) throw new LibraryReadError('not_ready');
  if (allowedMimes && !allowedMimes.includes(file.mime_type)) throw new LibraryReadError('invalid_media');
  if (Number(file.file_size) > maxBytes) throw new LibraryReadError(allowedMimes ? 'invalid_media' : 'too_large');

  await localPath(db, file); // XENO Storage: bring the bytes back from the object store when the cached copy is gone
  const roots = await managedRoots(uploadsDir);
  const real = await fs.realpath(file.storage_path).catch(() => null);
  if (!real || !roots.some((root) => real.startsWith(`${root}${path.sep}`))) throw new LibraryReadError('path_forbidden');

  const handle = await fs.open(real, 'r');
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new LibraryReadError('too_large');
    const buffer = Buffer.alloc(maxBytes + 1);
    let read = 0;
    while (read < buffer.length) {
      const chunk = await handle.read(buffer, read, buffer.length - read, null);
      if (!chunk.bytesRead) break;
      read += chunk.bytesRead;
    }
    if (read > maxBytes || read !== Number(file.file_size)) throw new LibraryReadError('changed');
    bytes = buffer.subarray(0, read);
  } finally {
    await handle.close();
  }
  // A type with a magic number must PROVE it from the bytes (sniffing with no declared type), so a
  // text file recorded as image/png is refused. Other types fall back to the recorded type.
  const recorded = file.mime_type || 'application/octet-stream';
  const sniffed = sniffMime(bytes, SIGNED_TYPES.has(recorded) ? 'application/octet-stream' : recorded);
  if (!bytes.length
    || sniffed !== recorded
    || crypto.createHash('sha256').update(bytes).digest('hex') !== file.content_sha256) {
    throw new LibraryReadError('changed');
  }
  return { file, bytes };
}

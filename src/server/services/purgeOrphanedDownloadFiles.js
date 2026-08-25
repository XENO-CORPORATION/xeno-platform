/**
 * Drop orphaned download FILES older than a cutoff.
 *
 * The downloads directory also holds `cookies/` (per-user yt-dlp jars). Those
 * must survive. A previous cleanup walked every name and called unlinkSync on
 * it; once the cookies directory aged past the cutoff, unlinkSync threw EISDIR,
 * the 15-minute interval had no catch, and uncaughtException exited the
 * process — Cloudflare 502 on every in-flight request until the next restart,
 * then again 15 minutes later.
 *
 * Directories, sockets, and anything that is not a regular file are skipped.
 * A single unlink failure never throws — that is what used to kill the box.
 */
import fs from 'fs';
import path from 'path';

/**
 * @param {string} dir
 * @param {number} olderThanMs
 * @param {number} [now]
 * @returns {string[]} basenames actually removed
 */
export function purgeOrphanedDownloadFiles(dir, olderThanMs, now = Date.now()) {
  const removed = [];
  if (!dir || !fs.existsSync(dir)) return removed;

  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return removed;
  }

  const cutoff = now - olderThanMs;
  for (const name of names) {
    const filepath = path.join(dir, name);
    let stats;
    try {
      stats = fs.lstatSync(filepath);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    if (stats.mtimeMs >= cutoff) continue;
    try {
      fs.unlinkSync(filepath);
      removed.push(name);
    } catch (err) {
      console.error('[downloadService] skipped unlink', filepath, err?.code || err?.message || err);
    }
  }
  return removed;
}

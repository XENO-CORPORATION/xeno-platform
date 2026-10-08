/**
 * "Download my data": a copy of what XENO holds about one person, as one .tar.gz.
 *
 * It is built in the background (Google Takeout and GitHub do the same) because a library can be
 * gigabytes and a request must not wait on it. The person asks, the row says `building`, then
 * `ready` with a size; the file is kept for EXPORT_KEEP_DAYS and then removed.
 *
 * What is in it is what the PERSON owns: their profile and settings, how they sign in, their
 * sessions and keys (never a secret or a hash), their own projects, chats, files, generated
 * pictures and credit history. What a WORKSPACE owns belongs to the workspace and is not in a
 * member's export; the workspaces they belong to are listed.
 *
 * Every section is read on its own. A section that cannot be read is named in manifest.json and
 * the rest is still delivered: a partial copy that says what is missing beats no copy.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import tar from 'tar-stream';
import { resolveManagedLibraryPath } from './libraryAssets.js';
import { listApiKeys } from './accountApiKeys.js';

export const EXPORT_KEEP_DAYS = 7;
export const EXPORTS_PER_DAY = 3;
export const EXPORT_MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;   // stored files past this total are listed, not copied
export const EXPORT_STALE_MINUTES = 60;                        // a build still "building" after this died with its process

export const exportDir = () => path.resolve(process.env.ACCOUNT_EXPORT_DIR || path.join(process.cwd(), 'storage', 'account-exports'));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeName = (s) => String(s || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';

const view = (row) => ({
  id: row.id, status: row.status, requested_at: row.requested_at, ready_at: row.ready_at, expires_at: row.expires_at,
  size_bytes: row.size_bytes == null ? null : Number(row.size_bytes), summary: row.summary || {},
  ...(row.status === 'failed' ? { error: 'The copy could not be built. Ask for a new one.' } : {}),
});

export async function listExports(db, userId) {
  const { rows } = await db.query('SELECT * FROM account_exports WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 20', [userId]);
  return rows.map(view);
}

/** Start one. Refuses while another is building, and past EXPORTS_PER_DAY in a day. */
export async function requestExport(db, userId, { start = startExportBuild } = {}) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  let row;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const recent = await client.query(
      `SELECT count(*) FILTER (WHERE status = 'building')::int AS building,
              count(*) FILTER (WHERE requested_at > NOW() - INTERVAL '24 hours')::int AS today
         FROM account_exports WHERE user_id = $1`,
      [userId],
    );
    if (recent.rows[0].building > 0) { await client.query('ROLLBACK'); return { conflict: true, code: 'export_in_progress' }; }
    if (recent.rows[0].today >= EXPORTS_PER_DAY) { await client.query('ROLLBACK'); return { conflict: true, code: 'export_limit', limit: EXPORTS_PER_DAY }; }
    row = (await client.query(`INSERT INTO account_exports (user_id, status) VALUES ($1, 'building') RETURNING *`, [userId])).rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (client !== db) client.release();
  }
  start(db, row.id);
  return { ok: true, export: view(row) };
}

/** Kick the build off after the response has gone. Errors are recorded on the row, never thrown. */
export function startExportBuild(db, exportId) {
  setImmediate(() => { buildExport(db, exportId).catch((error) => console.error('[AccountExport] build crashed:', error.message)); });
}

const SECTIONS = [
  ['account.json', `SELECT id, username, email, display_name, avatar_url, bio, created_at, updated_at, last_login, email_verified, status, role, plan, preferences, workspace_activated_at FROM users WHERE id = $1`],
  ['settings.json', `SELECT settings, created_at, updated_at FROM user_settings WHERE user_id = $1`],
  ['sign-in-methods.json', `SELECT provider, provider_email, provider_username, provider_name, created_at FROM oauth_accounts WHERE user_id = $1 ORDER BY created_at`],
  ['sessions.json', `SELECT id, created_at, last_active_at, expires_at, host(ip_address) AS ip_address, user_agent, device_type, browser, os FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC`],
  ['security-events.json', `SELECT event_type, host(ip_address::inet) AS ip_address, user_agent, metadata, created_at FROM security_events WHERE user_id = $1 ORDER BY created_at DESC`],
  ['workspaces.json', `SELECT w.id, w.name, w.workspace_type, t.relation AS your_role, w.created_at FROM relationship_tuples t JOIN workspaces w ON w.id::text = t.object_id WHERE t.object_type = 'workspace' AND t.subject_type = 'user' AND t.subject_id = $1::text ORDER BY w.created_at`],
  ['projects.json', `SELECT id, name, description, custom_instructions, settings, is_archived, created_at, updated_at FROM chat_projects WHERE owner_user_id = $1 ORDER BY created_at`],
  ['artifacts.json', `SELECT id, conversation_id, title, kind, language, content, created_at, updated_at FROM chat_artifacts WHERE owner_user_id = $1 ORDER BY created_at`],
  ['image-generations.json', `SELECT id, prompt, image_urls, model, aspect_ratio, resolution, created_at FROM image_generations WHERE user_id = $1 ORDER BY created_at`],
  ['credits/accounts.json', `SELECT id, balance, lifetime_earned, lifetime_spent, monthly_allowance, allowance_reset_date, created_at FROM credit_accounts WHERE user_id = $1`],
  ['credits/transactions.json', `SELECT id, type, amount, balance_after, reference_type, description, created_at FROM credit_transactions WHERE user_id = $1 ORDER BY created_at`],
];

const README = (when) => `XENO — a copy of your data
Made ${when}

account.json              your profile
settings.json             your settings
sign-in-methods.json      Google, GitHub or X accounts linked to this one (no tokens)
sessions.json             where you are signed in (no secrets)
api-keys.json             your API keys by name (the keys themselves are never stored)
security-events.json      sign-ins and security changes on your account
workspaces.json           the workspaces you belong to
projects.json             your own projects
conversations/            your own chats, one file each, with every message
artifacts.json            documents and code your chats made
image-generations.json    pictures you generated
library/index.json        your own files
library/files/            the files themselves
credits/                  your credit balance and history
manifest.json             what is in this copy, and anything that could not be included

Not in this copy: what a workspace owns. That belongs to the workspace, and its owner can export it.
`;

/** Build the archive for one export row. Sets the row to ready or failed. */
export async function buildExport(db, exportId, { now = () => new Date() } = {}) {
  const found = await db.query(`SELECT id, user_id FROM account_exports WHERE id = $1 AND status = 'building'`, [exportId]);
  if (!found.rows[0]) return { skipped: true };
  const userId = found.rows[0].user_id;
  const dir = exportDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, `${exportId}.tar.gz`);
  const partPath = `${finalPath}.part`;
  const summary = { sections: {}, conversations: 0, messages: 0, files: 0, file_bytes: 0, skipped_files: [], errors: [] };

  try {
    const pack = tar.pack();
    const written = pipeline(pack, zlib.createGzip({ level: 6 }), fs.createWriteStream(partPath, { mode: 0o600 }));
    const add = (name, value) => new Promise((resolve, reject) => {
      const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
      pack.entry({ name: `xeno-data/${name}`, size: body.length, mtime: now() }, body, (error) => (error ? reject(error) : resolve()));
    });
    const section = async (name, run) => {
      try { const rows = await run(); summary.sections[name] = Array.isArray(rows) ? rows.length : 1; await add(name, rows); }
      catch (error) { summary.errors.push({ section: name, error: String(error.code || error.message).slice(0, 120) }); }
    };

    await add('README.txt', README(now().toISOString()));
    for (const [name, sql] of SECTIONS) await section(name, async () => (await db.query(sql, [userId])).rows);
    await section('api-keys.json', () => listApiKeys(db, userId));

    // chats: an index, then one file per conversation so no single file holds everything
    let conversations = [];
    await section('conversations/index.json', async () => {
      conversations = (await db.query(
        `SELECT id, title, mode, model_id, project_id, is_archived, created_at, updated_at, last_message_at
           FROM chat_conversations
          -- a chat inside a project carries only its project (the scope rule allows exactly one owner), so own chats are
          -- the person's own plus every chat in a project they own
          WHERE (owner_user_id = $1 OR project_id IN (SELECT id FROM chat_projects WHERE owner_user_id = $1)) AND deleted_at IS NULL ORDER BY created_at`,
        [userId],
      )).rows;
      return conversations;
    });
    for (const c of conversations) {
      try {
        const messages = (await db.query(
          `SELECT id, parent_id, role, content, thinking, model_id, attachments, created_at, message_index FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at, message_index`,
          [c.id],
        )).rows;
        await add(`conversations/${c.id}.json`, { ...c, messages });
        summary.conversations += 1; summary.messages += messages.length;
      } catch (error) { summary.errors.push({ section: `conversations/${c.id}.json`, error: String(error.code || error.message).slice(0, 120) }); }
    }

    // files: the list, then the bytes
    let files = [];
    await section('library/index.json', async () => {
      files = (await db.query(
        `SELECT id, COALESCE(NULLIF(original_name, ''), filename) AS name, mime_type, file_size, content_sha256, metadata, created_at, storage_path
           FROM user_files WHERE owner_user_id = $1 AND deleted_at IS NULL AND storage_type = 'platform-upload' ORDER BY created_at`,
        [userId],
      )).rows;
      return files.map(({ storage_path: _path, ...file }) => ({ ...file, archived_as: `library/files/${file.id}-${safeName(file.name)}` }));
    });
    for (const f of files) {
      const resolved = resolveManagedLibraryPath(f.storage_path);
      const size = resolved ? (await fs.promises.stat(resolved)).size : 0;
      if (!resolved) { summary.skipped_files.push({ id: f.id, name: f.name, reason: 'stored file not found' }); continue; }
      if (summary.file_bytes + size > EXPORT_MAX_FILE_BYTES) { summary.skipped_files.push({ id: f.id, name: f.name, reason: 'this copy reached its size limit; download this file from your Library' }); continue; }
      await new Promise((resolve, reject) => {
        const entry = pack.entry({ name: `xeno-data/library/files/${f.id}-${safeName(f.name)}`, size, mtime: now() }, (error) => (error ? reject(error) : resolve()));
        fs.createReadStream(resolved).on('error', reject).pipe(entry);
      });
      summary.files += 1; summary.file_bytes += size;
    }

    await add('manifest.json', { export_id: exportId, user_id: userId, generated_at: now().toISOString(), ...summary });
    pack.finalize();
    await written;
    const { size } = await fs.promises.stat(partPath);
    await fs.promises.rename(partPath, finalPath);
    await db.query(
      `UPDATE account_exports SET status = 'ready', ready_at = NOW(), expires_at = NOW() + make_interval(days => $2), storage_path = $3, size_bytes = $4, summary = $5 WHERE id = $1`,
      [exportId, EXPORT_KEEP_DAYS, finalPath, size, JSON.stringify(summary)],
    );
    return { ok: true, size, summary };
  } catch (error) {
    await fs.promises.rm(partPath, { force: true }).catch(() => {});
    await db.query(`UPDATE account_exports SET status = 'failed', error = $2 WHERE id = $1`, [exportId, String(error.message).slice(0, 500)]).catch(() => {});
    return { failed: true, error: error.message };
  }
}

/** The file of a ready export the caller owns, or null. Never a path outside the export folder. */
export async function exportFile(db, { userId, exportId }) {
  if (!UUID_RE.test(String(exportId))) return null;
  const { rows } = await db.query(
    `SELECT id, storage_path, size_bytes, ready_at FROM account_exports WHERE id = $1 AND user_id = $2 AND status = 'ready' AND expires_at > NOW()`,
    [exportId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  const expected = path.join(exportDir(), `${row.id}.tar.gz`);
  if (path.resolve(row.storage_path || '') !== expected || !fs.existsSync(expected)) return null;
  return { path: expected, size: Number(row.size_bytes), name: `xeno-data-${new Date(row.ready_at).toISOString().slice(0, 10)}.tar.gz` };
}

/** Remove an export's file and mark it expired. The owner may do this at any time. */
export async function deleteExport(db, { userId, exportId }) {
  if (!UUID_RE.test(String(exportId))) return { notFound: true };
  const { rows } = await db.query(`UPDATE account_exports SET status = 'expired', storage_path = NULL WHERE id = $1 AND user_id = $2 AND status IN ('ready', 'failed') RETURNING id`, [exportId, userId]);
  if (!rows[0]) return { notFound: true };
  await fs.promises.rm(path.join(exportDir(), `${rows[0].id}.tar.gz`), { force: true }).catch(() => {});
  return { ok: true };
}

/** Background sweep: remove files past their time, and fail builds whose process died. */
export async function sweepExports(db) {
  const expired = (await db.query(`UPDATE account_exports SET status = 'expired', storage_path = NULL WHERE status = 'ready' AND expires_at <= NOW() RETURNING id`)).rows;
  for (const row of expired) await fs.promises.rm(path.join(exportDir(), `${row.id}.tar.gz`), { force: true }).catch(() => {});
  const stale = (await db.query(
    `UPDATE account_exports SET status = 'failed', error = 'the build did not finish' WHERE status = 'building' AND requested_at < NOW() - make_interval(mins => $1) RETURNING id`,
    [EXPORT_STALE_MINUTES],
  )).rows;
  for (const row of stale) await fs.promises.rm(path.join(exportDir(), `${row.id}.tar.gz.part`), { force: true }).catch(() => {});
  return { expired: expired.length, stale: stale.length };
}

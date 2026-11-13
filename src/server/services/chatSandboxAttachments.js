/**
 * The person's chat attachments, handed to the code sandbox as files (CHAT-CODE-EXECUTION-SPEC.md §7a).
 *
 * The leaders' model: a file uploaded into a chat is in the code tool from its first run, with its
 * exact bytes at a known path (OpenAI `container.file_ids` → /mnt/data; Anthropic `container_upload`).
 * Before this, a run here saw only what earlier runs had written, so an attached image was invisible to
 * the code and the agent had to ask for it again.
 *
 * Rules:
 *   - Attachments are referenced by Library asset id only, from the conversation's saved user messages
 *     and the current turn's parts. Never a path or URL from the model.
 *   - Every read goes through readAuthorizedLibraryBytes, as the person running the code: no access,
 *     not scanned yet, wrong bytes → the file is left out and reported, never fatal to the run.
 *   - They land under `attachments/` (ATTACHMENTS_DIR), are READ-ONLY inputs, and are never saved into
 *     the sandbox store or copied back to the Library: the Library already holds them.
 */
import { readAuthorizedLibraryBytes, LibraryReadError } from './libraryBytes.js';

export const ATTACHMENTS_DIR = 'attachments';
const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const MAX_ATTACHMENTS = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Is a sandbox-relative path inside the reserved attachments folder? */
export function isAttachmentPath(p) {
  const norm = String(p || '').replace(/\\/g, '/').replace(/^\.?\/+/, '');
  return norm === ATTACHMENTS_DIR || norm.startsWith(`${ATTACHMENTS_DIR}/`);
}

/** A file name that is safe as one path segment, keeping the extension; unique within `taken`. */
export function attachmentFileName(name, taken) {
  const raw = String(name || '').split(/[\\/]/).pop() || '';
  let clean = raw.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^[.\s]+/, '').replace(/\s+$/, '').slice(0, 120);
  if (!clean || clean === '.' || clean === '..') clean = 'attachment';
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  let candidate = clean;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${stem}-${n}${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Asset ids from message parts/attachments (`asset_id` or `assetId`), valid UUIDs only. */
export function assetIdsOf(items) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const id = item?.asset_id || item?.assetId;
    if (typeof id === 'string' && UUID_RE.test(id)) out.push({ id, name: item?.name || item?.filename || null });
  }
  return out;
}

/** The attachments on a conversation's saved user messages, oldest first. */
export async function conversationAttachments(db, conversationId) {
  if (!conversationId) return [];
  const { rows } = await db.query(
    `SELECT attachments FROM chat_messages
      WHERE conversation_id = $1 AND role = 'user' AND jsonb_typeof(attachments) = 'array'
      ORDER BY created_at, message_index NULLS LAST`,
    [conversationId],
  );
  return rows.flatMap((r) => assetIdsOf(r.attachments));
}

/**
 * Read the attachments as sandbox input files.
 *
 * @param {object} o
 * @param {object} o.db
 * @param {string} o.userId                the person running the code
 * @param {{id,name}[]} o.items           candidate attachments (duplicates allowed; first name wins)
 * @param {number} o.budgetBytes           what is left of the run's input budget
 * @param {function} [o.read]              test seam for readAuthorizedLibraryBytes
 * @returns {Promise<{ files: {path,content}[], manifest: {path,type,size,sha256}[], unavailable: {name,reason}[] }>}
 */
export async function readAttachmentsForRun({ db, userId, items, budgetBytes, read = readAuthorizedLibraryBytes, uploadsDir = null }) {
  const files = [];
  const manifest = [];
  const unavailable = [];
  const seen = new Set();
  const taken = new Set();
  let left = Math.max(0, Number(budgetBytes) || 0);

  for (const item of items || []) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (seen.size > MAX_ATTACHMENTS) { unavailable.push({ name: item.name || item.id, reason: 'too_many_attachments' }); continue; }
    let got;
    try {
      got = await read(db, userId, item.id, { maxBytes: Math.min(MAX_ATTACHMENT_BYTES, left || 1), uploadsDir });
    } catch (error) {
      if (!(error instanceof LibraryReadError) && !error?.reason) throw error;
      const reason = error.reason === 'too_large' && left < MAX_ATTACHMENT_BYTES ? 'over_run_budget' : error.reason;
      unavailable.push({ name: item.name || item.id, reason });
      continue;
    }
    const name = attachmentFileName(got.file.original_name || item.name || got.file.filename, taken);
    const relPath = `${ATTACHMENTS_DIR}/${name}`;
    files.push({ path: relPath, content: got.bytes.toString('base64') });
    manifest.push({ path: relPath, type: got.file.mime_type || 'application/octet-stream', size: got.bytes.length, sha256: got.file.content_sha256 });
    left -= got.bytes.length;
  }
  return { files, manifest, unavailable };
}

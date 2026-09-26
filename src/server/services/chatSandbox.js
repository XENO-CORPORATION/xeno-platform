/**
 * The per-chat CODE SANDBOX — a conversation's persistent filesystem for code execution.
 *
 * The industry model (CHAT-CODE-EXECUTION-SPEC.md): the WORKSPACE is per-chat and persistent, the
 * COMPUTE is ephemeral and pooled. This module owns the persistent half. It restores a conversation's
 * files INTO a run (as xenorun `files`) and captures what the run leaves (from xenorun `outputFiles`),
 * so a stateless one-shot engine gains per-chat statefulness with no long-lived container.
 *
 * Bytes live in `artifactStorage` (the platform's R2-or-fs object store) under
 * `chat-sandboxes/<sandbox id>/<path>`; `chat_sandbox_files` is the manifest that lists, restores and
 * bounds them. Named `sandbox`, not `workspace`, because `workspace` is the tenancy scope in chat.
 *
 * @unwired-by-design the SandboxSession seam (step 3) and the run_code tool (step 4) are the callers;
 * this is the storage layer they bind to. Reachability is proven end to end when run_code lands.
 */
import crypto from 'crypto';
import { artifactStorage } from './artifactStorage.js';

// Never push more than this into one run, however large the sandbox has grown.
const RESTORE_MAX_BYTES = 64 * 1024 * 1024;

/** The one sandbox for a conversation, created on first use. */
export async function getOrCreateSandbox(db, conversationId, ownerUserId = null) {
  const found = (await db.query('SELECT * FROM chat_sandboxes WHERE conversation_id = $1', [conversationId])).rows[0];
  if (found) return found;
  const id = crypto.randomUUID();
  const storagePrefix = `chat-sandboxes/${id}/`;
  return (
    await db.query(
      `INSERT INTO chat_sandboxes (id, conversation_id, owner_user_id, storage_prefix)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (conversation_id) DO UPDATE SET last_active_at = NOW()
       RETURNING *`,
      [id, conversationId, ownerUserId, storagePrefix],
    )
  ).rows[0];
}

/** The manifest for a sandbox, ordered by path. */
export async function listSandboxFiles(db, sandboxId) {
  return (
    await db.query(
      'SELECT path, size_bytes, content_hash, storage_key FROM chat_sandbox_files WHERE sandbox_id = $1 ORDER BY path',
      [sandboxId],
    )
  ).rows;
}

/**
 * Read the sandbox back as xenorun input files (`{ path, content }`, content base64), bounded by
 * RESTORE_MAX_BYTES. A file whose bytes are missing from the store is skipped, not fatal.
 */
export async function restoreSandboxFiles(db, sandboxId) {
  const store = artifactStorage();
  const manifest = await listSandboxFiles(db, sandboxId);
  const files = [];
  let total = 0;
  for (const f of manifest) {
    const size = Number(f.size_bytes);
    if (total + size > RESTORE_MAX_BYTES) break;
    const bytes = await store.get(f.storage_key);
    if (!bytes) continue;
    files.push({ path: f.path, content: bytes.toString('base64') });
    total += bytes.length;
  }
  return files;
}

/**
 * Persist a run's output files (xenorun `outputFiles`: `{ path, content, size }`, content base64) into
 * the sandbox. Unchanged files (same content hash) are skipped so an unmodified input is not rewritten.
 * The per-conversation quota is enforced: once a write would exceed it, remaining files are reported
 * as skipped rather than written. Returns what was saved/skipped and the sandbox's new totals.
 */
export async function saveSandboxFiles(db, sandbox, outputFiles) {
  const store = artifactStorage();
  const current = await listSandboxFiles(db, sandbox.id);
  const byPath = new Map(current.map((f) => [f.path, f]));
  const quota = Number(sandbox.quota_bytes);
  let total = Number(sandbox.total_bytes);
  const saved = [];
  const skipped = [];

  for (const f of outputFiles ?? []) {
    const bytes = Buffer.from(f.content, 'base64');
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const prior = byPath.get(f.path);
    if (prior && prior.content_hash === hash) continue; // unchanged — no rewrite

    const delta = bytes.length - (prior ? Number(prior.size_bytes) : 0);
    if (total + delta > quota) {
      skipped.push({ path: f.path, reason: 'quota_exceeded' });
      continue;
    }

    const storageKey = `${sandbox.storage_prefix}${f.path}`;
    await store.put(storageKey, bytes);
    await db.query(
      `INSERT INTO chat_sandbox_files (sandbox_id, path, size_bytes, content_hash, storage_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sandbox_id, path)
       DO UPDATE SET size_bytes = EXCLUDED.size_bytes, content_hash = EXCLUDED.content_hash,
                     storage_key = EXCLUDED.storage_key, updated_at = NOW()`,
      [sandbox.id, f.path, bytes.length, hash, storageKey],
    );
    total += delta;
    saved.push({ path: f.path, size: bytes.length });
  }

  const updated = (
    await db.query(
      `UPDATE chat_sandboxes
          SET total_bytes = $2,
              file_count = (SELECT COUNT(*) FROM chat_sandbox_files WHERE sandbox_id = $1),
              last_active_at = NOW()
        WHERE id = $1
        RETURNING total_bytes, file_count, quota_bytes`,
      [sandbox.id, total],
    )
  ).rows[0];

  return {
    saved,
    skipped,
    totalBytes: Number(updated.total_bytes),
    fileCount: updated.file_count,
    quotaBytes: Number(updated.quota_bytes),
  };
}

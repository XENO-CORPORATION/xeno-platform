/**
 * Library: rename, star, trash, restore, delete forever.
 *
 * The Library lists four stores as one (services/libraryAssets.js listLibraryItems). Every function
 * here takes an item the way the listing names it, `source` + `id`, and answers with one of:
 *   { ok: true, ... }            done
 *   { invalid: true }            the id or the name is not acceptable
 *   { unsupported: true }        this kind of item cannot do this
 *   { notFound: true }           no such item, or the caller may not see it. Never tells the two apart.
 *   { forbidden: true }          the caller can see it and may not change it
 *   { conflict: true, code }     the item's state refuses the change
 *
 * Who may do what follows the rule deleteLibraryItem already set:
 *   star      anyone who can see the item (a star is personal)
 *   rename    editor on a file or artifact; the account that made an image
 *   trash, restore, delete forever    owner
 */
import fs from 'fs';
import { check } from '../utils/authzReBAC.js';
import { withTransaction } from './chatProjectAuthority.js';
import { isLibraryUuid, listLibraryItems, resolveManagedLibraryPath } from './libraryAssets.js';

export const LIBRARY_SOURCES = Object.freeze(['file', 'artifact', 'generation', 'image_asset']);
export const TRASH_DAYS = 30;
const REBAC_OBJECT = { file: 'library_asset', artifact: 'artifact' };
const OWNED_TABLE = { generation: 'image_generations', image_asset: 'image_assets' };

const subjectOf = (principal) => `${principal.type || 'user'}:${principal.id}`;
const validTarget = (principal, source, id) => LIBRARY_SOURCES.includes(source) && isLibraryUuid(id) && isLibraryUuid(principal?.id);

/** Does the item exist in its store? A trashed file still exists: only its `deleted_at` is set. */
async function exists(db, source, id) {
  const sql = {
    file: `SELECT 1 FROM user_files f WHERE f.id = $1 AND (f.deleted_at IS NULL OR EXISTS (SELECT 1 FROM library_trash t WHERE t.source = 'file' AND t.source_id = f.id))`,
    artifact: 'SELECT 1 FROM chat_artifacts WHERE id = $1',
    generation: 'SELECT 1 FROM image_generations WHERE id = $1',
    image_asset: 'SELECT 1 FROM image_assets WHERE id = $1',
  }[source];
  return (await db.query(sql, [id])).rows.length > 0;
}

/** The caller's standing on one item: null when they may not see it, else the relations they hold. */
async function standing(db, principal, source, id) {
  if (!(await exists(db, source, id))) return null;
  if (REBAC_OBJECT[source]) {
    const object = `${REBAC_OBJECT[source]}:${id}`;
    const subject = subjectOf(principal);
    const viewer = await check(db, { object, relation: 'viewer', subject });
    if (!viewer.allowed) return null;
    const [editor, owner] = await Promise.all([
      check(db, { object, relation: 'editor', subject }),
      check(db, { object, relation: 'owner', subject }),
    ]);
    return { viewer: true, editor: editor.allowed, owner: owner.allowed };
  }
  const { rows } = await db.query(`SELECT 1 FROM ${OWNED_TABLE[source]} WHERE id = $1 AND user_id = $2`, [id, principal.id]);
  return rows.length ? { viewer: true, editor: true, owner: true } : null;
}

async function trashRow(db, source, id) {
  return (await db.query('SELECT trashed_at, purge_after FROM library_trash WHERE source = $1 AND source_id = $2', [source, id])).rows[0] || null;
}

/** A name a person typed. Returns the cleaned name, or null when it cannot be used. */
export function cleanLibraryName(value) {
  if (typeof value !== 'string') return null;
  // Control characters and path separators are refused BEFORE whitespace is tidied, or a line break
  // would be tidied into a space and accepted. The name is sent back in a Content-Disposition header
  // and may be written to a person's disk by their browser.
  if (/[\u0000-\u001f\u007f/\\]/.test(value)) return null;
  const name = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 255 || name === '.' || name === '..') return null;
  return name;
}

export async function starLibraryItem(db, principal, source, id, starred) {
  if (!validTarget(principal, source, id)) return { invalid: true };
  const who = await standing(db, principal, source, id);
  if (!who) return { notFound: true };
  if (starred) {
    await db.query(
      'INSERT INTO library_item_stars (user_id, source, source_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [principal.id, source, id],
    );
  } else {
    await db.query('DELETE FROM library_item_stars WHERE user_id = $1 AND source = $2 AND source_id = $3', [principal.id, source, id]);
  }
  return { ok: true, starred: Boolean(starred) };
}

export async function renameLibraryItem(db, principal, source, id, rawName) {
  if (!validTarget(principal, source, id)) return { invalid: true };
  const name = cleanLibraryName(rawName);
  if (!name) return { invalid: true, code: 'invalid_name' };
  // A legacy generation has no name of its own: the listing shows the start of its prompt, and the
  // prompt is the record of what was asked for. Changing it to rename the picture would falsify that.
  if (source === 'generation') return { unsupported: true, code: 'rename_unsupported' };
  const who = await standing(db, principal, source, id);
  if (!who) return { notFound: true };
  if (!who.editor) return { forbidden: true };
  if (await trashRow(db, source, id)) return { conflict: true, code: 'item_in_trash' };
  const sql = {
    file: 'UPDATE user_files SET original_name = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING id',
    artifact: 'UPDATE chat_artifacts SET title = $2, updated_at = NOW() WHERE id = $1 RETURNING id',
    image_asset: 'UPDATE image_assets SET name = $2 WHERE id = $1 RETURNING id',
  }[source];
  const { rows } = await db.query(sql, [id, name]);
  return rows.length ? { ok: true, name } : { notFound: true };
}

export async function trashLibraryItem(db, principal, source, id) {
  if (!validTarget(principal, source, id)) return { invalid: true };
  const who = await standing(db, principal, source, id);
  if (!who) return { notFound: true };
  if (!who.owner) return { forbidden: true };
  if (await trashRow(db, source, id)) return { conflict: true, code: 'already_in_trash' };
  if (source === 'file') {
    const references = await db.query('SELECT count(*)::int AS count FROM chat_project_assets WHERE asset_id = $1', [id]);
    if (references.rows[0].count > 0) return { conflict: true, code: 'asset_has_project_references', referenceCount: references.rows[0].count };
  }
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO library_trash (source, source_id, trashed_by_user_id, purge_after)
       VALUES ($1, $2, $3, NOW() + make_interval(days => $4))
       ON CONFLICT DO NOTHING RETURNING trashed_at, purge_after`,
      [source, id, principal.id, TRASH_DAYS],
    );
    if (!rows.length) return { conflict: true, code: 'already_in_trash' };
    // A trashed file must stop being served and stop being attachable at once. Every reader of
    // user_files already refuses a row whose deleted_at is set, so that one column does it.
    if (source === 'file') await tx.query('UPDATE user_files SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [id]);
    return { ok: true, trashedAt: rows[0].trashed_at, purgeAfter: rows[0].purge_after };
  });
}

export async function restoreLibraryItem(db, principal, source, id) {
  if (!validTarget(principal, source, id)) return { invalid: true };
  const who = await standing(db, principal, source, id);
  if (!who) return { notFound: true };
  if (!who.owner) return { forbidden: true };
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query('DELETE FROM library_trash WHERE source = $1 AND source_id = $2 RETURNING source_id', [source, id]);
    if (!rows.length) return { conflict: true, code: 'not_in_trash' };
    if (source === 'file') await tx.query('UPDATE user_files SET deleted_at = NULL WHERE id = $1', [id]);
    return { ok: true };
  });
}

/** Remove a purged file's bytes when no other file record points at the same stored object. */
async function removeBytes(db, storagePath, log = console) {
  if (!storagePath) return false;
  const shared = await db.query(
    `SELECT 1 FROM user_files f WHERE f.storage_path = $1
       AND (f.deleted_at IS NULL OR EXISTS (SELECT 1 FROM library_trash t WHERE t.source = 'file' AND t.source_id = f.id)) LIMIT 1`,
    [storagePath],
  );
  if (shared.rows.length) return false;
  const resolved = resolveManagedLibraryPath(storagePath);   // null unless it is a file under a managed upload root
  if (!resolved) return false;
  try { await fs.promises.unlink(resolved); return true; } catch (error) { log.warn?.(`[Library] could not remove purged bytes: ${error.code || error.message}`); return false; }
}

/** The irreversible half. The item must already be in the trash; `tx` is a transaction. */
async function purge(tx, source, id) {
  const gone = await tx.query('DELETE FROM library_trash WHERE source = $1 AND source_id = $2 RETURNING source_id', [source, id]);
  if (!gone.rows.length) return { conflict: true, code: 'not_in_trash' };
  await tx.query('DELETE FROM library_item_stars WHERE source = $1 AND source_id = $2', [source, id]);
  if (source === 'file') {
    await tx.query('UPDATE library_asset_link_grants SET revoked_at = NOW() WHERE asset_id = $1 AND revoked_at IS NULL', [id]);
    const { rows } = await tx.query('UPDATE user_files SET deleted_at = COALESCE(deleted_at, NOW()) WHERE id = $1 RETURNING storage_path', [id]);
    return { ok: true, storagePath: rows[0]?.storage_path || null };
  }
  const table = { artifact: 'chat_artifacts', generation: 'image_generations', image_asset: 'image_assets' }[source];
  await tx.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  return { ok: true, storagePath: null };
}

export async function purgeLibraryItem(db, principal, source, id) {
  if (!validTarget(principal, source, id)) return { invalid: true };
  const who = await standing(db, principal, source, id);
  if (!who) return { notFound: true };
  if (!who.owner) return { forbidden: true };
  const result = await withTransaction(db, (tx) => purge(tx, source, id));
  if (result.ok) result.bytesRemoved = await removeBytes(db, result.storagePath);
  delete result.storagePath;
  return result;
}

/** Empty the caller's trash: every trashed item they own. Returns how many were deleted forever. */
export async function emptyLibraryTrash(db, principal) {
  if (!isLibraryUuid(principal?.id)) return { invalid: true };
  // The trash as this person sees it, a page at a time. Items they can see and do not own are
  // skipped and counted, so the loop moves past them instead of asking for them again.
  let purged = 0, skipped = 0;
  for (let round = 0; round < 50; round += 1) {
    const page = await listLibraryItems(db, principal.id, { view: 'trash', limit: 200, offset: skipped, sort: 'created' });
    if (!page.items.length) break;
    const seen = new Set();
    for (const item of page.items) {
      const key = `${item.source}:${item.source_id}`;   // one generation lists once per picture
      if (seen.has(key)) continue;
      seen.add(key);
      const result = await purgeLibraryItem(db, principal, item.source, item.source_id);
      if (result.ok) purged += 1; else skipped += 1;
    }
  }
  return { ok: true, purged };
}

/** Background sweep: delete forever what has sat in the trash past its time. Bounded per run. */
export async function sweepLibraryTrash(db, { batch = 200, log = console } = {}) {
  const { rows } = await db.query('SELECT source, source_id FROM library_trash WHERE purge_after <= NOW() ORDER BY purge_after ASC LIMIT $1', [batch]);
  let purged = 0;
  for (const row of rows) {
    try {
      const result = await withTransaction(db, (tx) => purge(tx, row.source, row.source_id));
      if (result.ok) { purged += 1; await removeBytes(db, result.storagePath, log); }
    } catch (error) {
      log.error?.(`[Library] trash sweep could not purge ${row.source}:${row.source_id}: ${error.message}`);
    }
  }
  return { purged };
}

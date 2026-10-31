/**
 * XENO Stock (Studio › Libraries): photos, art and video free of copyright, that a workspace can search and save. One service: the screen
 * (routes/stockRoutes.js, prototypes/xeno-workspace/platform-stock.js) and agents (stockMcp.js) all call these functions.
 *
 * WHERE IT COMES FROM (owner decision 2026-10-31): open-licence media we host, plus images people generate on their own credits. The second
 * half is XENO's existing Generate, not a second generator: the screen hands a search to it and shows what the person already made.
 *
 * THE CATALOGUE is data, built by scripts/stock-catalogue.mjs, which takes an item only if its source states
 * CC0 on that item, and which records what it read and when. Every item was looked at before it shipped, because CC0 only speaks for copyright.
 * This code says so to the person rather than calling anything "safe": a museum's statement and an uploader's aren't the same, and neither
 * clears a person's or a brand's rights.
 *
 * A SAVE copies the file into the workspace's Library, so it counts against the plan, follows the Library's access rules, and carries where it
 * came from. It fetches only the catalogue's own URL and checks the bytes against the catalogue's hash: a caller can't name a URL.
 *
 * WITHDRAWING is XENO staff's, for a rights holder's complaint: the item stops being offered, saved copies are removed, and whoever saved one
 * is told why. The bytes on the CDN have to be removed too, and that is an operator step (../xeno-stock/SPEC.md).
 *
 * WHO (XENO-WORKFORCE-01 §8.11): anyone signed in searches, viewers read what a workspace saved, editors save. An agent saves too, marked as its own.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as customers from './customers.js';
import * as inbox from './inbox.js';
import { registerManagedLibraryFile } from './libraryAssets.js';
import { storeFileObject } from './storageObjects.js';

export class StockError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'StockError'; this.code = code; this.status = status; }
}
const here = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.resolve(here, '..', 'uploads');
const MIME = { jpg: 'image/jpeg', webm: 'video/webm' };
const PAGE = 48;
/** A save still claimed after this long belongs to a process that died, so another may take over. */
const CLAIM_STALE_MS = 10 * 60_000;

let cached = null;
export const catalogue = () => {
  if (!cached) cached = JSON.parse(fs.readFileSync(path.join(here, '../data/stockCatalogue.json'), 'utf8'));
  return cached;
};
/** Tests only: a small catalogue whose bytes they can hand back. */
export const _useCatalogue = (c) => { cached = c; };

const fileUrl = (c, file) => `${catalogue().base}/${c.id}/v${c.version}/${file}`;
const CONSENT = 'CC0 speaks for copyright only. It doesn’t clear a person’s or a brand’s rights, so check those before you use this to advertise something.';
const rightsOf = (c) => (c.source.statedBy === 'institution'
  ? `${c.source.name} publishes this as CC0. ${CONSENT}`
  : `Its uploader marked this CC0 and their own work on ${c.source.name}. XENO read that statement and looked at the file, but can’t prove who made it. ${CONSENT}`);
const creditOf = (c) => (c.source.statedBy === 'institution' ? `${c.creator}. ${c.title}. ${c.source.name}.` : `${c.creator}, via ${c.source.name} (CC0).`);
const view = (c) => ({
  id: c.id, kind: c.kind, collection: c.collection, title: c.title, creator: c.creator, tag: c.tag, width: c.width, height: c.height, ...(c.duration ? { duration: c.duration } : {}),
  bytes: c.bytes, previewUrl: fileUrl(c, 'preview.jpg'), fullUrl: fileUrl(c, `full.${c.ext}`),
  license: c.source.license, licenseUrl: c.source.licenseUrl, sourceName: c.source.name, sourceUrl: c.source.url, statedBy: c.source.statedBy, checkedAt: c.checkedAt, rights: rightsOf(c), credit: creditOf(c),
});
const withdrawnIds = async (db) => new Set((await db.query('SELECT stock_id FROM stock_withdrawn')).rows.map((r) => r.stock_id));
const itemById = (id) => catalogue().items.find((c) => c.id === String(id ?? '')) || null;
async function scope(db, actor, workspace, need) {
  try { return await customers.workspaceFor(db, actor, workspace, need); }
  catch (e) { if (e instanceof customers.CustomersError) throw new StockError(e.message, e.code, e.status); throw e; }
}

// ─────────────────────────────────────────── searching
/** Every word has to appear in the title, the creator or its subject. Newest idea first isn't a thing here: the order is the catalogue's. */
export async function search(db, { q = '', kind = '', collection = '', offset = 0 } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const gone = await withdrawnIds(db);
  const all = catalogue().items.filter((c) => !gone.has(c.id) && (!kind || c.kind === kind) && (!collection || c.collection === collection)
    && words.every((w) => `${c.title} ${c.creator} ${c.tag}`.toLowerCase().includes(w)));
  const from = Math.max(0, Number(offset) || 0);
  return { total: all.length, offset: from, items: all.slice(from, from + PAGE).map(view) };
}
export async function getItem(db, { id } = {}) {
  const c = itemById(id);
  if (!c || (await withdrawnIds(db)).has(c.id)) throw new StockError('That isn’t in Stock', 'item_not_found', 404);
  return { item: view(c) };
}

// ─────────────────────────────────────────── saving to the Library
async function defaultFetchBytes(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new StockError('That file couldn’t be fetched. Try again.', 'fetch_failed', 502);
  return Buffer.from(await r.arrayBuffer());
}
const liveFile = async (db, fileId) => Boolean(fileId && (await db.query('SELECT 1 FROM user_files WHERE id = $1 AND deleted_at IS NULL', [fileId])).rows[0]);

/** Copy an item into the workspace's Library. Saving it twice gives the same file, unless that file has since been deleted. */
export async function save(db, actor, { workspace, id } = {}, { fetchBytes = defaultFetchBytes } = {}) {
  const ctx = await scope(db, actor, workspace, 'editor');
  const c = itemById(id);
  if (!c || (await withdrawnIds(db)).has(c.id)) throw new StockError('That isn’t in Stock', 'item_not_found', 404);
  const claim = async () => (await db.query(`INSERT INTO stock_saves (workspace_id, stock_id, agent_saved, saved_by) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id, stock_id) DO NOTHING RETURNING id`, [ctx.workspaceId, c.id, !!ctx.agentId, ctx.userId])).rows[0];
  let mine = await claim();
  if (!mine) {
    const prior = (await db.query('SELECT id, file_id, created_at FROM stock_saves WHERE workspace_id = $1 AND stock_id = $2', [ctx.workspaceId, c.id])).rows[0];
    if (prior?.file_id && await liveFile(db, prior.file_id)) return { saved: { stockId: c.id, fileId: prior.file_id }, already: true };
    if (prior && !prior.file_id && Date.now() - new Date(prior.created_at).getTime() < CLAIM_STALE_MS) throw new StockError('That’s being saved already', 'save_in_progress', 409);
    await db.query('DELETE FROM stock_saves WHERE id = $1', [prior?.id]);
    mine = await claim();
    if (!mine) throw new StockError('That’s being saved already', 'save_in_progress', 409);
  }
  let storagePath = null;
  try {
    const bytes = await fetchBytes(fileUrl(c, `full.${c.ext}`));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== c.sha256) throw new StockError('That file doesn’t match the catalogue, so it wasn’t saved', 'hash_mismatch', 502);
    fs.mkdirSync(UPLOADS, { recursive: true });
    const filename = `stock-${crypto.randomUUID()}.${c.ext}`;
    storagePath = path.join(UPLOADS, filename);
    fs.writeFileSync(storagePath, bytes);
    const stored = await registerManagedLibraryFile(db, { userId: ctx.userId, workspaceId: ctx.workspaceId, enforceAllowance: true, filename,
      originalName: `${c.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim().slice(0, 200) || c.id}.${c.ext}`, mimeType: MIME[c.ext], fileSize: bytes.length, storagePath, area: 'studio',
      metadata: { source: 'stock', stockId: c.id, license: c.source.license, creator: c.creator, sourceUrl: c.source.url, credit: creditOf(c), checkedAt: c.checkedAt } });
    await db.query('UPDATE stock_saves SET file_id = $2 WHERE id = $1', [mine.id, stored.id]);
    storeFileObject(db, { id: stored.id, storage_path: storagePath, content_sha256: stored.content_sha256 }).catch((e) => console.warn('[Stock] object store:', e.message));
    return { saved: { stockId: c.id, fileId: stored.id }, already: false };
  } catch (e) {
    await db.query('DELETE FROM stock_saves WHERE id = $1', [mine.id]).catch(() => {});
    if (storagePath) { try { fs.unlinkSync(storagePath); } catch { /* best effort */ } }
    if (e && e.code === 'STORAGE_QUOTA') throw new StockError(e.message, 'STORAGE_QUOTA', 413);
    throw e;
  }
}
export async function listSaved(db, actor, { workspace } = {}) {
  const ctx = await scope(db, actor, workspace, 'viewer');
  const rows = (await db.query(`SELECT s.stock_id, s.file_id, s.agent_saved, s.created_at FROM stock_saves s JOIN user_files f ON f.id = s.file_id AND f.deleted_at IS NULL
    WHERE s.workspace_id = $1 ORDER BY s.created_at DESC`, [ctx.workspaceId])).rows;
  return { saved: rows.map((r) => { const c = itemById(r.stock_id); return c ? { ...view(c), fileId: r.file_id, agentSaved: r.agent_saved, savedAt: r.created_at } : null; }).filter(Boolean) };
}

// ─────────────────────────────────────────── withdrawing
/** A rights holder's complaint. The item goes, every saved copy goes, and whoever saved one is told why. */
export async function withdraw(db, staff, { id, reason } = {}) {
  if (!staff || !['admin', 'moderator'].includes(staff.role) || staff.kind !== 'human') throw new StockError('Only XENO staff can withdraw an item', 'staff_only', 403);
  const c = itemById(id);
  if (!c) throw new StockError('That isn’t in Stock', 'item_not_found', 404);
  const why = String(reason ?? '').trim();
  if (!why) throw new StockError('Say why it’s being withdrawn', 'reason_required');
  await db.query(`INSERT INTO stock_withdrawn (stock_id, reason, withdrawn_by) VALUES ($1,$2,$3) ON CONFLICT (stock_id) DO NOTHING`, [c.id, why.slice(0, 1000), staff.id]);
  const saves = (await db.query('SELECT file_id, saved_by FROM stock_saves WHERE stock_id = $1 AND file_id IS NOT NULL', [c.id])).rows;
  for (const s of saves) {
    await db.query('UPDATE user_files SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [s.file_id]);
    if (s.saved_by) await inbox.tell(db, { userId: s.saved_by, source: 'stock', kind: 'stock_withdrawn', ref: '/workspace/studio/spaces/libraries/stock', title: `“${c.title.slice(0, 80)}” was withdrawn from Stock`, detail: `Your saved copy was removed. ${why.slice(0, 300)}`, area: 'studio' });
  }
  await db.query('DELETE FROM stock_saves WHERE stock_id = $1', [c.id]);
  return { withdrawn: true, id: c.id, copiesRemoved: saves.length, cdnKeys: [`stock/${c.id}/v${c.version}/full.${c.ext}`, `stock/${c.id}/v${c.version}/preview.jpg`] };
}

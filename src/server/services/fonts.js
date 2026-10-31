/**
 * XENO Fonts (Studio › Libraries): the fonts a workspace uses. One service: the screen (routes/fontRoutes.js,
 * prototypes/xeno-workspace/platform-fonts.js) and agents (fontsMcp.js) all call these functions.
 *
 * WHERE FONTS COME FROM (owner decision 2026-10-31): an open-licence catalogue we host, plus a workspace's own uploads.
 *
 * THE CATALOGUE is data, built by scripts/fonts-catalogue.mjs, which reads each family's licence from its own files and refuses
 * anything else. Pairings are written by hand; this is not AI pairing and doesn't claim to be.
 *
 * AN UPLOAD is a private file in the workspace's Library, so it counts against the plan and follows the Library's access rules. It
 * needs a person to say they hold the rights, recorded with who and when, and the font's own licence bits must allow embedding:
 * someone's word can't override what the font says about itself. XENO staff can take one down; the uploader is told why.
 *
 * WHO (XENO-WORKFORCE-01 §8.11): viewers read, editors add and remove, staff take down. An agent reads as its owner and may add a
 * family from the open catalogue. It can't upload, because it can't hold rights, and it can't remove.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as customers from './customers.js';
import * as inbox from './inbox.js';
import { FontFileError, readFont, restrictedEmbedding, FONT_MIME } from '../utils/fontFile.js';
import { registerManagedLibraryFile } from './libraryAssets.js';

export class FontError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'FontError'; this.code = code; this.status = status; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const RIGHTS_STATEMENT = 'I confirm this workspace has the right to use this font.';

let cached = null;
export const catalogue = () => {
  if (!cached) cached = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/fontCatalogue.json'), 'utf8'));
  return cached;
};
const familyById = (id) => catalogue().families.find((f) => f.id === id) || null;
const fileUrl = (f, file) => `${catalogue().base}/${f.id}/v${f.version}/${file}`;
const summary = (f) => ({ id: f.id, family: f.family, category: f.category, weights: f.weights, styles: f.styles, license: f.license, licenseUrl: fileUrl(f, 'LICENSE.txt'), source: f.source });

async function scope(db, actor, workspace, need) {
  try { return await customers.workspaceFor(db, actor, workspace, need); }
  catch (e) { if (e instanceof customers.CustomersError) throw new FontError(e.message, e.code, e.status); throw e; }
}
const person = (ctx, what) => { if (ctx.agentId) throw new FontError(`Only a person can ${what}`, 'human_only', 403); };

// ─────────────────────────────────────────── the open catalogue
/** Families matching a search, with what each pairs well with. */
export function searchCatalogue({ q = '', category = '' } = {}) {
  const needle = String(q).trim().toLowerCase(), cat = String(category).trim().toLowerCase();
  return { families: catalogue().families.filter((f) => (!needle || f.family.toLowerCase().includes(needle) || f.id.includes(needle)) && (!cat || f.category === cat)).map((f) => ({ ...summary(f), pairsWith: pairsWith(f.id) })) };
}
/** Hand-written pairings, whichever side the family is on. */
export function pairsWith(id) {
  const out = [];
  for (const [a, b] of catalogue().pairings) { if (a === id) out.push({ id: b, family: familyById(b).family, role: 'body' }); else if (b === id) out.push({ id: a, family: familyById(a).family, role: 'heading' }); }
  return out;
}
/** @font-face rules for catalogue families. Fonts sit on our CDN under immutable versions; unicode-range loads a subset only when used. */
export function faceCss(ids, { weights = null } = {}) {
  const { unicodeRanges } = catalogue(), rules = [];
  for (const id of ids) {
    const f = familyById(id); if (!f) continue;
    for (const x of f.files) {
      if (weights && !weights.includes(x.weight)) continue;
      rules.push(`@font-face {\n  font-family: "${f.family}";\n  font-style: ${x.style};\n  font-weight: ${x.weight};\n  font-display: swap;\n  src: url("${fileUrl(f, x.file)}") format("woff2");${unicodeRanges[x.subset] ? `\n  unicode-range: ${unicodeRanges[x.subset]};` : ''}\n}`);
    }
  }
  return rules.join('\n');
}
/** The catalogue family behind a font name, for a brand kit's export. */
export const catalogueIdFor = (family) => catalogue().families.find((f) => f.family.toLowerCase() === String(family).trim().toLowerCase())?.id || null;

// ─────────────────────────────────────────── a workspace's fonts
const viewUpload = (r) => ({ id: r.id, family: r.family, style: r.style, weight: r.weight, italic: r.italic, format: r.format, fileId: r.file_id, contentUrl: `/api/library/assets/${r.file_id}/content`, rightsConfirmedAt: r.rights_confirmed_at, rightsConfirmedBy: r.by_name || null, createdAt: r.created_at });
export async function listWorkspaceFonts(db, actor, { workspace } = {}) {
  const ctx = await scope(db, actor, workspace, 'viewer');
  const open = (await db.query('SELECT family_id, agent_added, created_at FROM workspace_fonts WHERE workspace_id = $1 ORDER BY created_at DESC', [ctx.workspaceId])).rows;
  const ups = (await db.query(`SELECT u.*, us.display_name AS by_name FROM font_uploads u LEFT JOIN users us ON us.id = u.rights_confirmed_by WHERE u.workspace_id = $1 AND u.removed_at IS NULL ORDER BY u.family, u.weight`, [ctx.workspaceId])).rows;
  return { catalogue: open.map((r) => { const f = familyById(r.family_id); return f ? { ...summary(f), agentAdded: r.agent_added, addedAt: r.created_at, pairsWith: pairsWith(f.id) } : null; }).filter(Boolean), uploads: ups.map(viewUpload) };
}
export async function addFamily(db, actor, { workspace, family } = {}) {
  const ctx = await scope(db, actor, workspace, 'editor');
  const f = familyById(String(family ?? ''));
  if (!f) throw new FontError('That font isn’t in the catalogue', 'font_not_found', 404);
  await db.query(`INSERT INTO workspace_fonts (workspace_id, family_id, agent_added, added_by) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id, family_id) DO NOTHING`, [ctx.workspaceId, f.id, !!ctx.agentId, ctx.userId]);
  return { font: summary(f) };
}
export async function removeFamily(db, actor, { workspace, family } = {}) {
  const ctx = await scope(db, actor, workspace, 'editor');
  person(ctx, 'remove a font');
  const r = await db.query('DELETE FROM workspace_fonts WHERE workspace_id = $1 AND family_id = $2', [ctx.workspaceId, String(family ?? '')]);
  if (!r.rowCount) throw new FontError('That font isn’t in this workspace', 'font_not_found', 404);
  return { removed: true };
}

// ─────────────────────────────────────────── uploads
/** A font someone is adding. `storagePath` is where the upload landed. The caller removes it when this throws. */
export async function uploadFont(db, actor, { workspace, storagePath, originalName, size, rightsConfirmed } = {}) {
  const ctx = await scope(db, actor, workspace, 'editor');
  person(ctx, 'upload a font: it means saying you hold the rights to it');
  if (rightsConfirmed !== true && rightsConfirmed !== 'true') throw new FontError('Confirm you have the rights to this font first', 'rights_required');
  if (Number(size) > MAX_UPLOAD_BYTES) throw new FontError('A font can be 15 MB at most', 'font_too_large', 413);
  let info;
  try { info = readFont(await fs.promises.readFile(storagePath)); }
  catch (e) { if (e instanceof FontFileError) throw new FontError(e.message, e.code); throw e; }
  if (restrictedEmbedding(info.fsType)) throw new FontError('This font’s own licence says it can’t be embedded, so it can’t be used here.', 'font_restricted', 422);
  const stored = await registerManagedLibraryFile(db, { userId: ctx.userId, workspaceId: ctx.workspaceId, enforceAllowance: true, filename: path.basename(storagePath), originalName: String(originalName || `${info.family}.${info.format}`).slice(0, 255), mimeType: FONT_MIME[info.format], fileSize: Number(size), storagePath, metadata: { source: 'font-upload' }, area: 'studio' });
  const r = (await db.query(`INSERT INTO font_uploads (workspace_id, file_id, family, style, weight, italic, format, fs_type, rights_statement, rights_confirmed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [ctx.workspaceId, stored.id, info.family, info.style, Math.min(1000, Math.max(1, info.weight)), info.italic, info.format, info.fsType, RIGHTS_STATEMENT, ctx.userId])).rows[0];
  return { upload: viewUpload(r), fileId: stored.id, contentSha256: stored.content_sha256 };
}
async function uploadRow(db, id, workspaceId = null) {
  if (!UUID.test(String(id ?? ''))) throw new FontError('That font isn’t here', 'upload_not_found', 404);
  const r = (await db.query(`SELECT * FROM font_uploads WHERE id = $1 AND removed_at IS NULL${workspaceId ? ' AND workspace_id = $2' : ''}`, workspaceId ? [id, workspaceId] : [id])).rows[0];
  if (!r) throw new FontError('That font isn’t here', 'upload_not_found', 404);
  return r;
}
/** Remove an upload from the workspace's fonts. The file stays in the Library until someone deletes it there. */
export async function removeUpload(db, actor, { workspace, id } = {}) {
  const ctx = await scope(db, actor, workspace, 'editor');
  person(ctx, 'remove a font');
  const r = await uploadRow(db, id, ctx.workspaceId);
  await db.query(`UPDATE font_uploads SET removed_at = now(), removed_by = $2, removed_reason = 'Removed from the workspace' WHERE id = $1`, [r.id, ctx.userId]);
  return { removed: true, id: r.id };
}
/** A rights holder's complaint, handled by XENO staff: the font stops working and its file is removed. The person who confirmed the rights is told. */
export async function takeDown(db, staff, { id, reason } = {}) {
  if (!staff || !['admin', 'moderator'].includes(staff.role) || staff.kind !== 'human') throw new FontError('Only XENO staff can take a font down', 'staff_only', 403);
  const why = String(reason ?? '').trim();
  if (!why) throw new FontError('Say why it’s being taken down', 'reason_required');
  const r = await uploadRow(db, id);
  await db.query(`UPDATE font_uploads SET removed_at = now(), removed_by = $2, removed_reason = $3, taken_down = true WHERE id = $1`, [r.id, staff.id, why.slice(0, 1000)]);
  await db.query('UPDATE user_files SET deleted_at = now() WHERE id = $1', [r.file_id]);
  await inbox.tell(db, { userId: r.rights_confirmed_by, source: 'fonts', kind: 'font_taken_down', ref: '/workspace/studio/spaces/libraries/fonts', title: `The font ${r.family} was taken down`, detail: why.slice(0, 400), area: 'studio' });
  return { takenDown: true, id: r.id };
}

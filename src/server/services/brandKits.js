/**
 * XENO Assets (Studio › Libraries): a workspace's brand kits. One service: the screen (routes/brandKitRoutes.js,
 * prototypes/xeno-workspace/platform-assets.js) and agents (brandKitsMcp.js) all call these functions.
 *
 * WHO (XENO-WORKFORCE-01 §8.11): the WORKSPACE owns its kits. Viewers read, editors write the draft and publish, a human admin
 * deletes. An agent reads as its owner and may propose items in a draft, marked as its own until a person publishes. Publishing
 * is a person's act: an app or agent that follows a kit picks the change up, so it reaches everything (service AND a trigger).
 *
 * WHAT: a kit is tokens (color, number, string, shadow, typography, alias), logos and a voice. A token's value is the shape XENO
 * Canvas already uses (engine/document/types.ts TokenValue) with an alias naming a path, so Canvas reads a kit with no second
 * model. A logo points at an image in the workspace's Library; the bytes live there and only there.
 *
 * VERSIONS: the items are the draft. Publishing freezes them as a numbered, digested snapshot that never changes, so anything
 * pinned to a version stays right, and "latest" means the newest published, never someone's half-finished draft.
 *
 * EXPORTS: the W3C Design Tokens format (DTCG), CSS custom properties, a Tailwind theme, and Canvas's own tokens. Every value
 * was validated on the way in, so an export can't carry CSS or script somebody typed.
 */
import crypto from 'node:crypto';
import * as customers from './customers.js';
import { getAuthorizedLibraryFile } from './libraryAssets.js';

export class BrandKitError extends Error {
  constructor(message, code, status = 400, details = null) { super(message); this.name = 'BrandKitError'; this.code = code; this.status = status; this.details = details; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){0,7}$/;
const MODE = /^[a-z][a-z0-9-]{0,30}$/;
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;
const SAFE_TEXT = /^[^<>{};\\\u0000-\u001f]*$/;   // goes into CSS and JSON: nothing that could end a declaration or open a tag
export const TOKEN_KINDS = ['color', 'number', 'string', 'shadow', 'typography', 'alias'];
export const EXPORT_FORMATS = ['dtcg', 'css', 'tailwind', 'canvas'];
export const LIMITS = { items: 1000, modes: 8, kits: 200 };

const str = (v, field, max, required = false) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new BrandKitError(`${field} is required`, `${field.toLowerCase()}_required`);
  if (s.length > max) throw new BrandKitError(`${field} is longer than ${max} characters`, `${field.toLowerCase()}_too_long`);
  return s;
};
const fin = (v, what) => { const n = Number(v); if (v === '' || v == null || !Number.isFinite(n)) throw new BrandKitError(`${what} must be a number`, 'invalid_value'); return n; };
const color = (v, what = 'A color') => { const s = String(v ?? '').trim().toLowerCase(); if (!HEX.test(s)) throw new BrandKitError(`${what} must look like #1a2b3c`, 'invalid_color'); return s; };
const safe = (v, what, max = 300) => { const s = str(v, what, max, true); if (!SAFE_TEXT.test(s)) throw new BrandKitError(`${what} has characters that aren’t allowed`, 'invalid_value'); return s; };

/** A token value, checked and normalised. The result is exactly what gets stored and exported. */
export function cleanValue(raw) {
  const kind = String(raw?.kind ?? '');
  switch (kind) {
    case 'color': return { kind, value: color(raw.value) };
    case 'number': { const unit = raw.unit == null || raw.unit === '' ? null : String(raw.unit); if (unit !== null && !['px', 'rem', '%'].includes(unit)) throw new BrandKitError('A unit is px, rem or %', 'invalid_value'); return { kind, value: fin(raw.value, 'A number'), ...(unit ? { unit } : {}) }; }
    case 'string': return { kind, value: safe(raw.value, 'The text') };
    case 'shadow': { const s = raw.value || {}; return { kind, value: { offsetX: fin(s.offsetX, 'X'), offsetY: fin(s.offsetY, 'Y'), blur: fin(s.blur, 'Blur'), spread: fin(s.spread ?? 0, 'Spread'), color: color(s.color, 'A shadow’s color'), ...(s.inset === true ? { inset: true } : {}) } }; }
    case 'typography': { const t = raw.value || {}; return { kind, value: { fontFamily: safe(t.fontFamily, 'The font'), fontWeight: fin(t.fontWeight ?? 400, 'Weight'), fontSize: fin(t.fontSize, 'Size'), lineHeight: fin(t.lineHeight ?? 1.4, 'Line height'), ...(t.letterSpacing != null && t.letterSpacing !== '' ? { letterSpacing: fin(t.letterSpacing, 'Letter spacing') } : {}) } }; }
    case 'alias': { const p = String(raw.path ?? ''); if (!PATH.test(p)) throw new BrandKitError('An alias names another token', 'invalid_alias'); return { kind, path: p }; }
    default: throw new BrandKitError('Unknown kind of token', 'invalid_kind');
  }
}
const cleanPath = (p) => { const s = String(p ?? '').trim().toLowerCase(); if (!PATH.test(s)) throw new BrandKitError('A name is lowercase words joined by dots, like color.brand.primary', 'invalid_path'); return s; };
function cleanModes(list) {
  if (!Array.isArray(list)) throw new BrandKitError('modes must be a list', 'invalid_modes');
  const out = [...new Set(list.map((m) => String(m).trim().toLowerCase()))];
  if (out.length > LIMITS.modes || out.some((m) => !MODE.test(m))) throw new BrandKitError(`Up to ${LIMITS.modes} modes, in lowercase words`, 'invalid_modes');
  return out;
}

async function scope(db, actor, workspace, need) {
  try { return await customers.workspaceFor(db, actor, workspace, need); }
  catch (e) { if (e instanceof customers.CustomersError) throw new BrandKitError(e.message, e.code, e.status); throw e; }
}
const person = (ctx, what) => { if (ctx.agentId) throw new BrandKitError(`Only a person can ${what}`, 'human_only', 403); };
async function kitRow(db, ctx, id, { includeDeleted = false } = {}) {
  if (!UUID.test(String(id ?? ''))) throw new BrandKitError('Brand kit not found', 'kit_not_found', 404);
  const r = (await db.query(`SELECT k.*, (SELECT max(version) FROM brand_kit_versions v WHERE v.kit_id = k.id) AS latest FROM brand_kits k WHERE k.id = $1 AND k.workspace_id = $2${includeDeleted ? '' : ' AND k.deleted_at IS NULL'}`, [id, ctx.workspaceId])).rows[0];
  if (!r) throw new BrandKitError('Brand kit not found', 'kit_not_found', 404);
  return r;
}
const items = async (db, kitId) => (await db.query('SELECT * FROM brand_kit_items WHERE kit_id = $1 ORDER BY path', [kitId])).rows;
const viewItem = (r) => ({ id: r.id, path: r.path, kind: r.kind, value: r.value, valuesByMode: r.values_by_mode, description: r.description, agentDrafted: r.agent_drafted, updatedAt: r.updated_at });
const viewKit = (r, extra = {}) => ({ id: r.id, workspaceId: r.workspace_id, name: r.name, description: r.description, voice: r.voice, modes: r.modes, agentDrafted: r.agent_drafted, latestVersion: r.latest == null ? null : Number(r.latest), createdAt: r.created_at, updatedAt: r.updated_at, url: `/workspace/studio/spaces/libraries/${r.id}`, ...extra });

// ─────────────────────────────────────────── the snapshot: what a version freezes
function snapshotOf(kit, rows) {
  return { name: kit.name, description: kit.description, voice: kit.voice, modes: kit.modes,
    items: rows.map((r) => ({ path: r.path, kind: r.kind, value: r.value, valuesByMode: r.values_by_mode, description: r.description })) };
}
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v));
export const digestOf = (snap) => crypto.createHash('sha256').update(canonical(snap)).digest('hex');
/** Every alias must reach a real token, and no name may be both a token and a group (DTCG can't say that). */
function problemsIn(rows) {
  const by = new Map(rows.map((r) => [r.path, r])), out = [];
  const follow = (start) => { const seen = new Set(); let cur = start; while (cur && cur.kind === 'alias') { if (seen.has(cur.path)) return 'loop'; seen.add(cur.path); const next = by.get(cur.value.path); if (!next) return 'missing'; if (next.kind === 'logo') return 'missing'; cur = next; } return null; };
  for (const r of rows) {
    if (r.kind === 'alias') { const bad = follow(r); if (bad) out.push({ path: r.path, problem: bad === 'loop' ? 'This alias goes in a circle.' : `It points at ${r.value.path}, which doesn’t exist.` }); }
    for (const v of Object.values(r.values_by_mode || {})) if (v.kind === 'alias' && !by.has(v.path)) out.push({ path: r.path, problem: `A mode points at ${v.path}, which doesn’t exist.` });
    const parts = r.path.split('.');
    for (let i = 1; i < parts.length; i++) if (by.has(parts.slice(0, i).join('.'))) out.push({ path: r.path, problem: `${parts.slice(0, i).join('.')} is already a token, so it can’t also be a group.` });
  }
  return out;
}

// ─────────────────────────────────────────── kits
export async function listKits(db, actor, { workspace } = {}) {
  const ctx = await scope(db, actor, workspace, 'viewer');
  const { rows } = await db.query(`SELECT k.*, (SELECT max(version) FROM brand_kit_versions v WHERE v.kit_id = k.id) AS latest,
      (SELECT count(*) FROM brand_kit_items i WHERE i.kit_id = k.id) AS item_count
    FROM brand_kits k WHERE k.workspace_id = $1 AND k.deleted_at IS NULL ORDER BY k.updated_at DESC LIMIT ${LIMITS.kits}`, [ctx.workspaceId]);
  return { kits: rows.map((r) => viewKit(r, { items: Number(r.item_count) })) };
}
/** The draft: its items, what would stop it publishing, and whether it differs from the newest version. */
export async function getKit(db, actor, { workspace, id } = {}) {
  const ctx = await scope(db, actor, workspace, 'viewer');
  const kit = await kitRow(db, ctx, id), rows = await items(db, kit.id);
  const last = kit.latest == null ? null : (await db.query('SELECT digest FROM brand_kit_versions WHERE kit_id = $1 AND version = $2', [kit.id, kit.latest])).rows[0];
  return { kit: viewKit(kit, { items: rows.map(viewItem), problems: problemsIn(rows), unpublished: !last ? rows.length > 0 : last.digest !== digestOf(snapshotOf(kit, rows)) }) };
}
export async function createKit(db, actor, input = {}) {
  const ctx = await scope(db, actor, input.workspace, 'editor');
  const r = (await db.query(`INSERT INTO brand_kits (workspace_id, name, description, voice, modes, agent_drafted, created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING *`,
    [ctx.workspaceId, str(input.name, 'Name', 120, true), str(input.description, 'Description', 2000), str(input.voice, 'Voice', 8000), JSON.stringify(cleanModes(input.modes || [])), !!ctx.agentId, ctx.userId])).rows[0];
  return { kit: viewKit(r, { items: [], problems: [], unpublished: false }) };
}
export async function updateKit(db, actor, input = {}) {
  const ctx = await scope(db, actor, input.workspace, 'editor');
  const cur = await kitRow(db, ctx, input.id);
  const modes = input.modes !== undefined ? cleanModes(input.modes) : cur.modes;
  const r = (await db.query(`UPDATE brand_kits SET name = $2, description = $3, voice = $4, modes = $5::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
    [cur.id, input.name !== undefined ? str(input.name, 'Name', 120, true) : cur.name, input.description !== undefined ? str(input.description, 'Description', 2000) : cur.description,
      input.voice !== undefined ? str(input.voice, 'Voice', 8000) : cur.voice, JSON.stringify(modes)])).rows[0];
  return { kit: viewKit({ ...r, latest: cur.latest }) };
}
export async function deleteKit(db, actor, { workspace, id } = {}) {
  const ctx = await scope(db, actor, workspace, 'admin');
  const cur = await kitRow(db, ctx, id);
  await db.query('UPDATE brand_kits SET deleted_at = now(), updated_at = now() WHERE id = $1', [cur.id]);
  return { deleted: true, id: cur.id };
}
export async function restoreKit(db, actor, { workspace, id } = {}) {
  const ctx = await scope(db, actor, workspace, 'admin');
  const cur = await kitRow(db, ctx, id, { includeDeleted: true });
  const r = (await db.query('UPDATE brand_kits SET deleted_at = NULL, updated_at = now() WHERE id = $1 RETURNING *', [cur.id])).rows[0];
  return { kit: viewKit({ ...r, latest: cur.latest }) };
}

// ─────────────────────────────────────────── the draft's items
function cleanByMode(raw, modes) {
  const out = {};
  for (const [m, v] of Object.entries(raw || {})) {
    if (!modes.includes(m)) throw new BrandKitError(`This kit has no mode called ${m}`, 'unknown_mode');
    out[m] = cleanValue(v);
  }
  return out;
}
/** Add or change a token by its name. An agent's change is marked as its own until a person publishes. */
export async function putToken(db, actor, input = {}) {
  const ctx = await scope(db, actor, input.workspace, 'editor');
  const kit = await kitRow(db, ctx, input.id);
  const path = cleanPath(input.path), value = cleanValue(input.value), byMode = cleanByMode(input.valuesByMode, kit.modes);
  const others = await items(db, kit.id);
  if (others.length >= LIMITS.items && !others.some((r) => r.path === path)) throw new BrandKitError(`A kit can have ${LIMITS.items} items`, 'too_many_items');
  const next = [...others.filter((r) => r.path !== path), { path, kind: value.kind, value, values_by_mode: byMode }];
  const clash = problemsIn(next).find((p) => p.path === path || next.some((r) => r.path === p.path && p.problem.includes('group')));
  if (clash && clash.problem.includes('group')) throw new BrandKitError(clash.problem, 'path_conflict');
  const r = (await db.query(`INSERT INTO brand_kit_items (kit_id, path, kind, value, values_by_mode, description, agent_drafted, updated_by) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)
    ON CONFLICT (kit_id, path) DO UPDATE SET kind = EXCLUDED.kind, value = EXCLUDED.value, values_by_mode = EXCLUDED.values_by_mode, description = EXCLUDED.description, agent_drafted = EXCLUDED.agent_drafted, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING *`,
    [kit.id, path, value.kind, JSON.stringify(value), JSON.stringify(byMode), str(input.description, 'Description', 1000), !!ctx.agentId, ctx.userId])).rows[0];
  await db.query('UPDATE brand_kits SET updated_at = now() WHERE id = $1', [kit.id]);
  return { item: viewItem(r) };
}
/** Put an image from this workspace's Library in the kit. A person's act: it needs that person's access to the file. */
export async function addLogo(db, actor, { workspace, id, name, fileId } = {}) {
  const ctx = await scope(db, actor, workspace, 'editor');
  person(ctx, 'add a logo');
  const kit = await kitRow(db, ctx, id);
  const f = UUID.test(String(fileId ?? '')) ? await getAuthorizedLibraryFile(db, { type: 'user', id: ctx.userId }, String(fileId)) : null;
  if (!f) throw new BrandKitError('That file isn’t in your Library', 'logo_not_found', 404);
  if (!String(f.mime_type || '').startsWith('image/')) throw new BrandKitError('A logo must be an image', 'logo_not_image');
  // everyone in the workspace must be able to see it, or the kit shows them a hole
  if (String(f.workspace_id || '') !== ctx.workspaceId && !(f.workspace_id == null && String(f.owner_user_id) === ctx.userId)) throw new BrandKitError('Move the file into this workspace’s Library first, so everyone here can see it', 'logo_not_in_workspace');
  const path = `logo.${cleanPath(name)}`;
  const r = (await db.query(`INSERT INTO brand_kit_items (kit_id, path, kind, value, updated_by) VALUES ($1,$2,'logo',$3::jsonb,$4)
    ON CONFLICT (kit_id, path) DO UPDATE SET kind = 'logo', value = EXCLUDED.value, values_by_mode = '{}'::jsonb, agent_drafted = false, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING *`,
    [kit.id, path, JSON.stringify({ kind: 'logo', fileId: f.id, fileName: f.original_name, mime: f.mime_type, sha256: f.content_sha256 || null }), ctx.userId])).rows[0];
  await db.query('UPDATE brand_kits SET updated_at = now() WHERE id = $1', [kit.id]);
  return { item: viewItem(r) };
}
export async function removeItem(db, actor, { workspace, id, path } = {}) {
  const ctx = await scope(db, actor, workspace, 'editor');
  person(ctx, 'remove an item');
  const kit = await kitRow(db, ctx, id);
  const r = await db.query('DELETE FROM brand_kit_items WHERE kit_id = $1 AND path = $2', [kit.id, String(path ?? '')]);
  if (!r.rowCount) throw new BrandKitError('That item isn’t in this kit', 'item_not_found', 404);
  await db.query('UPDATE brand_kits SET updated_at = now() WHERE id = $1', [kit.id]);
  return { removed: true, path };
}

// ─────────────────────────────────────────── versions
export async function publish(db, actor, { workspace, id, note } = {}) {
  const ctx = await scope(db, actor, workspace, 'editor');
  person(ctx, 'publish a brand kit');
  const kit = await kitRow(db, ctx, id), rows = await items(db, kit.id);
  if (!rows.length) throw new BrandKitError('Add something to the kit first', 'kit_empty');
  const problems = problemsIn(rows);
  if (problems.length) throw new BrandKitError('Fix these first', 'kit_has_problems', 409, problems);
  const snap = snapshotOf(kit, rows), digest = digestOf(snap);
  const client = typeof db.connect === 'function' ? await db.connect() : db, owned = client !== db;
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM brand_kits WHERE id = $1 FOR UPDATE', [kit.id]);   // two people publishing get two numbers, not a clash
    const last = (await client.query('SELECT version, digest FROM brand_kit_versions WHERE kit_id = $1 ORDER BY version DESC LIMIT 1', [kit.id])).rows[0];
    if (last && last.digest === digest) throw new BrandKitError('Nothing has changed since the last version', 'nothing_to_publish', 409);
    const v = (await client.query(`INSERT INTO brand_kit_versions (kit_id, version, snapshot, digest, note, published_by) VALUES ($1,$2,$3::jsonb,$4,$5,$6) RETURNING version, digest, note, published_at`,
      [kit.id, (last?.version || 0) + 1, JSON.stringify(snap), digest, str(note, 'Note', 1000), ctx.userId])).rows[0];
    await client.query('UPDATE brand_kit_items SET agent_drafted = false WHERE kit_id = $1 AND agent_drafted', [kit.id]);
    await client.query('COMMIT');
    return { version: { version: v.version, digest: v.digest, note: v.note, publishedAt: v.published_at } };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { if (owned) client.release(); }
}
export async function listVersions(db, actor, { workspace, id } = {}) {
  const ctx = await scope(db, actor, workspace, 'viewer');
  const kit = await kitRow(db, ctx, id);
  const { rows } = await db.query(`SELECT v.version, v.digest, v.note, v.published_at, u.display_name AS by_name, jsonb_array_length(v.snapshot->'items') AS item_count
    FROM brand_kit_versions v LEFT JOIN users u ON u.id = v.published_by WHERE v.kit_id = $1 ORDER BY v.version DESC LIMIT 200`, [kit.id]);
  return { versions: rows.map((r) => ({ version: r.version, digest: r.digest, note: r.note, publishedAt: r.published_at, publishedBy: r.by_name || null, items: Number(r.item_count) })) };
}
/** A published version, the newest by default. What an app or agent should read. */
export async function readVersion(db, actor, { workspace, id, version } = {}) {
  const ctx = await scope(db, actor, workspace, 'viewer');
  const kit = await kitRow(db, ctx, id);
  const n = version == null || version === '' || version === 'latest' ? kit.latest : Number(version);
  if (n == null) throw new BrandKitError('This kit has no published version yet', 'not_published', 404);
  const r = Number.isInteger(n) && n > 0 ? (await db.query('SELECT * FROM brand_kit_versions WHERE kit_id = $1 AND version = $2', [kit.id, n])).rows[0] : null;
  if (!r) throw new BrandKitError('That version doesn’t exist', 'version_not_found', 404);
  return { version: r.version, digest: r.digest, note: r.note, publishedAt: r.published_at, snapshot: r.snapshot };
}

// ─────────────────────────────────────────── exports
const css = (path) => `--${path.replace(/\./g, '-')}`;
const num = (v) => `${v.value}${v.unit || ''}`;
const shadowCss = (s) => `${s.inset ? 'inset ' : ''}${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.spread}px ${s.color}`;
const tokensOf = (snap) => snap.items.filter((i) => i.kind !== 'logo');
const quoteFont = (f) => (/^[a-z0-9 -]+$/i.test(f) && !/\s/.test(f) ? f : `"${f.replace(/"/g, '')}"`);
function cssDecls(path, v) {
  switch (v.kind) {
    case 'color': return [[css(path), v.value]];
    case 'number': return [[css(path), num(v)]];
    case 'string': return [[css(path), `"${v.value.replace(/"/g, '')}"`]];
    case 'shadow': return [[css(path), shadowCss(v.value)]];
    case 'alias': return [[css(path), `var(${css(v.path)})`]];
    case 'typography': { const t = v.value; return [[`${css(path)}-font-family`, quoteFont(t.fontFamily)], [`${css(path)}-font-size`, `${t.fontSize}px`], [`${css(path)}-font-weight`, String(t.fontWeight)], [`${css(path)}-line-height`, String(t.lineHeight)], ...(t.letterSpacing != null ? [[`${css(path)}-letter-spacing`, `${t.letterSpacing}px`]] : [])]; }
    default: return [];
  }
}
function toCss(snap) {
  const block = (sel, decls) => (decls.length ? `${sel} {\n${decls.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n` : '');
  let out = block(':root', tokensOf(snap).flatMap((t) => cssDecls(t.path, t.value)));
  for (const m of snap.modes) out += `\n${block(`[data-theme="${m}"]`, tokensOf(snap).flatMap((t) => (t.valuesByMode?.[m] ? cssDecls(t.path, t.valuesByMode[m]) : [])))}`;
  return out.replace(/\n+$/, '\n');
}
const dim = (value, unit = 'px') => ({ value, unit });
function dtcgValue(v) {
  switch (v.kind) {
    case 'color': return { $type: 'color', $value: v.value };
    case 'number': return v.unit && v.unit !== '%' ? { $type: 'dimension', $value: dim(v.value, v.unit) } : { $type: 'number', $value: v.value };
    case 'string': return { $type: 'fontFamily', $value: v.value };
    case 'shadow': { const s = v.value; return { $type: 'shadow', $value: { color: s.color, offsetX: dim(s.offsetX), offsetY: dim(s.offsetY), blur: dim(s.blur), spread: dim(s.spread), ...(s.inset ? { inset: true } : {}) } }; }
    case 'typography': { const t = v.value; return { $type: 'typography', $value: { fontFamily: t.fontFamily, fontSize: dim(t.fontSize), fontWeight: t.fontWeight, lineHeight: t.lineHeight, letterSpacing: dim(t.letterSpacing ?? 0) } }; }
    case 'alias': return { $value: `{${v.path}}` };
    default: return {};
  }
}
function toDtcg(snap) {
  const root = { $description: snap.description || undefined };
  for (const t of tokensOf(snap)) {
    let node = root; const parts = t.path.split('.');
    for (const p of parts.slice(0, -1)) node = node[p] = node[p] || {};
    const modes = Object.entries(t.valuesByMode || {});
    node[parts[parts.length - 1]] = { ...dtcgValue(t.value), ...(t.description ? { $description: t.description } : {}), ...(modes.length ? { $extensions: { 'ai.xenosystem.modes': Object.fromEntries(modes.map(([m, v]) => [m, dtcgValue(v).$value])) } } : {}) };
  }
  return root;
}
/** A Tailwind theme. It reads the CSS variables, so a mode switch reaches everything built on it. */
function toTailwind(snap) {
  const theme = {};
  const put = (section, path, value) => { let n = (theme[section] = theme[section] || {}); const parts = path.split('.'); for (const p of parts.slice(0, -1)) n = n[p] = n[p] && typeof n[p] === 'object' ? n[p] : {}; n[parts[parts.length - 1]] = value; };
  const kindOf = (t) => { let cur = t; const by = new Map(tokensOf(snap).map((x) => [x.path, x])), seen = new Set(); while (cur?.value?.kind === 'alias' && !seen.has(cur.path)) { seen.add(cur.path); cur = by.get(cur.value.path); } return cur?.value?.kind; };
  for (const t of tokensOf(snap)) {
    const [top, ...rest] = t.path.split('.'), sub = rest.join('.') || top, k = kindOf(t), ref = `var(${css(t.path)})`;
    if (k === 'color') put('colors', top === 'color' || top === 'colors' ? sub : t.path, ref);
    else if (k === 'shadow') put('boxShadow', sub, ref);
    else if (k === 'number' && /^(space|spacing)$/.test(top)) put('spacing', sub, ref);
    else if (k === 'number' && /^(radius|radii|rounded)$/.test(top)) put('borderRadius', sub, ref);
    else if (k === 'typography') put('fontFamily', sub, `var(${css(t.path)}-font-family)`);
  }
  return `/** @type {import('tailwindcss').Config['theme']} ${snap.name.replace(/\*\//g, '')} */\nmodule.exports = { extend: ${JSON.stringify(theme, null, 2)} };\n`;
}
/** Canvas's own tokens (engine/document/types.ts), so a Canvas file can load a kit as it stands. */
function toCanvas(snap) {
  const id = (p) => `kit_${p.replace(/[.-]/g, '_')}`;
  const canvasValue = (v) => (v.kind === 'alias' ? { kind: 'alias', tokenId: id(v.path) } : v);
  return { modes: snap.modes, tokens: Object.fromEntries(tokensOf(snap).map((t) => [id(t.path), { id: id(t.path), name: t.path.replace(/\./g, '/'), ...(t.description ? { description: t.description } : {}), value: canvasValue(t.value), ...(Object.keys(t.valuesByMode || {}).length ? { valuesByMode: Object.fromEntries(Object.entries(t.valuesByMode).map(([m, v]) => [m, canvasValue(v)])) } : {}) }])) };
}
export function render(snap, format) {
  switch (format) {
    case 'dtcg': return { extension: 'tokens.json', type: 'application/design-tokens+json', body: `${JSON.stringify(toDtcg(snap), null, 2)}\n` };
    case 'css': return { extension: 'css', type: 'text/css', body: toCss(snap) };
    case 'tailwind': return { extension: 'tailwind.cjs', type: 'text/javascript', body: toTailwind(snap) };
    case 'canvas': return { extension: 'canvas-tokens.json', type: 'application/json', body: `${JSON.stringify(toCanvas(snap), null, 2)}\n` };
    default: throw new BrandKitError(`A format is one of ${EXPORT_FORMATS.join(', ')}`, 'invalid_format');
  }
}
export async function exportKit(db, actor, { workspace, id, version, format = 'dtcg' } = {}) {
  const v = await readVersion(db, actor, { workspace, id, version });
  const out = render(v.snapshot, format);
  const slug = v.snapshot.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'brand-kit';
  return { filename: `${slug}-v${v.version}.${out.extension}`, type: out.type, body: out.body, version: v.version, digest: v.digest, format };
}

// ─────────────────────────────────────────── importing the standard
function dtcgLeaves(node, prefix = '', inherited = null, out = []) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return out;
  const type = node.$type || inherited;
  if ('$value' in node) { out.push({ path: prefix, type, value: node.$value, description: node.$description }); return out; }
  for (const [k, v] of Object.entries(node)) if (!k.startsWith('$')) dtcgLeaves(v, prefix ? `${prefix}.${k.toLowerCase()}` : k.toLowerCase(), type, out);
  return out;
}
const unDim = (d) => (d && typeof d === 'object' ? Number(d.value) : Number(String(d).replace(/[a-z%]+$/i, '')));
function fromDtcg(t) {
  const v = t.value;
  if (typeof v === 'string' && /^\{[^}]+\}$/.test(v)) return { kind: 'alias', path: v.slice(1, -1).toLowerCase() };
  switch (t.type) {
    case 'color': return { kind: 'color', value: typeof v === 'object' && v?.hex ? v.hex : v };
    case 'number': return { kind: 'number', value: v };
    case 'dimension': return typeof v === 'object' ? { kind: 'number', value: v.value, unit: v.unit } : { kind: 'number', value: parseFloat(v), unit: String(v).replace(/^[-\d.]+/, '') || undefined };
    case 'fontFamily': return { kind: 'string', value: Array.isArray(v) ? v.join(', ') : v };
    case 'shadow': { const s = Array.isArray(v) ? v[0] : v; return { kind: 'shadow', value: { offsetX: unDim(s.offsetX), offsetY: unDim(s.offsetY), blur: unDim(s.blur), spread: unDim(s.spread ?? 0), color: typeof s.color === 'object' ? s.color.hex : s.color, inset: s.inset === true } }; }
    case 'typography': return { kind: 'typography', value: { fontFamily: Array.isArray(v.fontFamily) ? v.fontFamily.join(', ') : v.fontFamily, fontSize: unDim(v.fontSize), fontWeight: Number(v.fontWeight) || 400, lineHeight: Number(v.lineHeight) || 1.4, letterSpacing: v.letterSpacing != null ? unDim(v.letterSpacing) : undefined } };
    default: throw new BrandKitError(`${t.type || 'That kind of token'} isn’t supported yet`, 'unsupported_type');
  }
}
/** Bring in a DTCG file. It shows what it would do unless `confirm`, and never touches what the file doesn't name. */
export async function importDtcg(db, actor, { workspace, id, tokens, confirm = false } = {}) {
  const ctx = await scope(db, actor, workspace, 'editor');
  person(ctx, 'import tokens');
  const kit = await kitRow(db, ctx, id);
  let parsed = tokens;
  if (typeof tokens === 'string') { try { parsed = JSON.parse(tokens); } catch { throw new BrandKitError('That isn’t valid JSON', 'invalid_json'); } }
  const leaves = dtcgLeaves(parsed);
  if (!leaves.length) throw new BrandKitError('No tokens found in that file', 'no_tokens');
  const have = new Map((await items(db, kit.id)).map((r) => [r.path, r]));
  const add = [], change = [], same = [], refused = [], good = [];
  for (const t of leaves) {
    try {
      const path = cleanPath(t.path), value = cleanValue(fromDtcg(t));
      const old = have.get(path);
      if (old?.kind === 'logo') throw new BrandKitError('A logo has that name', 'path_conflict');
      if (old && canonical(old.value) === canonical(value)) { same.push(path); continue; }
      (old ? change : add).push(path);
      good.push({ path, value, description: str(t.description, 'Description', 1000) });
    } catch (e) { if (!(e instanceof BrandKitError) && !(e instanceof TypeError)) throw e; refused.push({ path: t.path, problem: e instanceof BrandKitError ? e.message : 'That token can’t be read.' }); }
  }
  const merged = [...[...have.values()].filter((r) => !good.some((g) => g.path === r.path)), ...good.map((g) => ({ path: g.path, kind: g.value.kind, value: g.value, values_by_mode: {} }))];
  if (merged.length > LIMITS.items) throw new BrandKitError(`A kit can have ${LIMITS.items} items`, 'too_many_items');
  const problems = problemsIn(merged);
  if (!confirm) return { dryRun: true, add, change, same: same.length, refused, problems };
  if (problems.some((p) => p.problem.includes('group'))) throw new BrandKitError('Some names clash', 'path_conflict', 409, problems);
  for (const g of good) {
    await db.query(`INSERT INTO brand_kit_items (kit_id, path, kind, value, description, updated_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6)
      ON CONFLICT (kit_id, path) DO UPDATE SET kind = EXCLUDED.kind, value = EXCLUDED.value, description = EXCLUDED.description, agent_drafted = false, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [kit.id, g.path, g.value.kind, JSON.stringify(g.value), g.description, ctx.userId]);
  }
  await db.query('UPDATE brand_kits SET updated_at = now() WHERE id = $1', [kit.id]);
  return { dryRun: false, add, change, same: same.length, refused, problems };
}

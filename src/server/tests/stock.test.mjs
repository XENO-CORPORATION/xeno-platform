/**
 * XENO Stock (services/stock.js + stockMcp.js) on real Postgres, with a small catalogue whose bytes the test hands back, plus every rule
 * on the real catalogue.
 *
 *   - the real catalogue: every item CC0, with who states it, what was read and when, under a versioned address; no refused source
 *   - search: every word has to match, filters, pages; what's said about rights differs by who states it, and never says "safe"
 *   - saving: an editor saves, a viewer can't; the bytes are checked; one copy per workspace; a failure leaves nothing; a deleted copy can be saved again
 *   - it's a private Library file with where it came from, and it can't be reached from another workspace
 *   - agents save, marked as their own
 *   - withdrawing is staff's: the item goes, copies go, and whoever saved one is told
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/stock.test.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples, check } from '../utils/authzReBAC.js';
import * as S from '../services/stock.js';
import * as Mcp from '../services/stockMcp.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const here = path.dirname(fileURLToPath(import.meta.url));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `sk${process.pid}`; let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log('  ok ', m); };
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$1,true,true,'x') RETURNING id`, [`${tag}${s}`, `${tag}${s}@example.test`])).rows[0].id;
const code = async (p) => { try { await p; return null; } catch (e) { return e.code || e.message; } };
const team = async (owner, name) => (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team',$2,$3) RETURNING id`, [owner, name, `${tag}-${name.toLowerCase()}`])).rows[0].id;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(200)]);
const JPEG2 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(300)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), crypto.randomBytes(300)]);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const entry = (id, title, bytes, over = {}) => ({ id, kind: 'image', collection: 'photo', title, creator: 'A Person', tag: 'forest', width: 3000, height: 2000, version: 1, ext: 'jpg', bytes: bytes.length, sha256: sha(bytes), previewBytes: 10, previewSha256: 'x', checkedAt: '2026-10-31',
  source: { name: 'Wikimedia Commons', url: 'https://commons.wikimedia.org/wiki/File:x', license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', statedBy: 'uploader', read: 'LicenseShortName: CC0; Credit: Own work' }, ...over });

async function main() {
  await runAllMigrations(pool);
  // ── the real catalogue
  const real = JSON.parse(fs.readFileSync(path.resolve(here, '../data/stockCatalogue.json'), 'utf8'));
  ok(real.items.length >= 100, `a real catalogue exists (${real.items.length} items)`);
  ok(real.items.every((c) => c.source.license === 'CC0-1.0' && ['institution', 'uploader'].includes(c.source.statedBy) && c.source.read && c.source.url.startsWith('https://') && /^\d{4}-\d{2}-\d{2}$/.test(c.checkedAt)), 'every item is CC0, says who states it, what was read, where and when');
  ok(real.items.every((c) => /^[0-9a-f]{64}$/.test(c.sha256) && /^[0-9a-f]{64}$/.test(c.previewSha256) && Number.isInteger(c.version) && /^[a-z]+-\d+$/.test(c.id)), 'every item has its hashes and a versioned address');
  ok(!real.items.some((c) => /unsplash|pexels|pixabay|pikwizard|avopix|artic\.edu/i.test(`${c.source.name} ${c.source.url} ${c.source.read}`)), 'nothing from a source whose terms or gates forbid it');
  ok(real.items.every((c) => c.source.statedBy !== 'uploader' || /Credit: Own work/.test(c.source.read)), 'a Commons file is the uploader’s own work, never a re-upload');
  ok(!/(\.|\/)(safe|cleared)\b/i.test(JSON.stringify(real.items.slice(0, 1))) && new Set(real.items.map((c) => c.id)).size === real.items.length, 'ids are unique');
  const review = JSON.parse(fs.readFileSync(path.resolve(here, '../../../scripts/data/stock-review.json'), 'utf8'));
  ok(review.reviewedAt && review.rejected.every((r) => r.id && r.why) && !real.items.some((c) => review.rejected.some((r) => r.id === c.id)), 'what was looked at and rejected is on record, with why, and stays out');

  // ── a catalogue this test can hand bytes back for
  S._useCatalogue({ base: 'https://cdn.example/stock', items: [
    entry('wc-1', 'Forest at dawn', JPEG), entry('wc-2', 'Mountain lake', JPEG2, { tag: 'lake' }),
    entry('cma-3', 'Waves', JPEG, { collection: 'art', creator: 'Winslow Homer', tag: 'sea', source: { name: 'Cleveland Museum of Art', url: 'https://clevelandart.org/art/1', license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', statedBy: 'institution', read: 'share_license_status: CC0' } }),
    entry('wc-4', 'River film', WEBM, { kind: 'video', collection: 'video', ext: 'webm', duration: 12, tag: 'river' }),
    ...Array.from({ length: 60 }, (_, i) => entry(`wc-${100 + i}`, `Filler ${i}`, JPEG, { tag: 'pagefill' })),
  ] });
  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger'), agentU = await user('agent'), staffU = await user('staff');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [agentU, editor]);
  const ws = await team(owner, 'Stock'), other = await team(stranger, 'Other');
  await writeTuples(pool, { writes: [['owner', owner], ['editor', editor], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation })).concat([{ object: `workspace:${other}`, subject: `user:${stranger}`, relation: 'owner' }]) });
  const E = { id: editor, kind: 'human' }, V = { id: viewer, kind: 'human' }, X = { id: stranger, kind: 'human' }, AG = { id: agentU, kind: 'agent' }, STAFF = { id: staffU, kind: 'human', role: 'admin' };
  const w = { workspace: ws };
  const served = new Map([['wc-1', JPEG], ['wc-2', JPEG2], ['cma-3', JPEG], ['wc-4', WEBM]]);
  const urls = [];
  const fetchBytes = async (u) => { urls.push(u); return served.get(u.split('/stock/')[1].split('/')[0]); };

  // ── search
  ok((await S.search(pool, { q: 'forest dawn' })).items.map((c) => c.id).join() === 'wc-1', 'every word has to match, across title and subject');
  ok((await S.search(pool, { q: 'forest ocean' })).total === 0, 'so a word that doesn’t match means nothing found');
  ok((await S.search(pool, { q: 'homer' })).items[0].id === 'cma-3', 'the creator counts');
  ok((await S.search(pool, { collection: 'art' })).total === 1 && (await S.search(pool, { kind: 'video' })).items[0].duration === 12, 'collection and kind filter');
  const p1 = await S.search(pool, { q: 'pagefill' }), p2 = await S.search(pool, { q: 'pagefill', offset: 48 });
  ok(p1.total === 60 && p1.items.length === 48 && p2.items.length === 12 && p1.items[0].id !== p2.items[0].id, 'results page');
  ok(p1.items[0].previewUrl === 'https://cdn.example/stock/wc-100/v1/preview.jpg' && p1.items[0].fullUrl.endsWith('/v1/full.jpg'), 'files sit at their versioned addresses');
  const museum = (await S.getItem(pool, { id: 'cma-3' })).item, uploader = (await S.getItem(pool, { id: 'wc-1' })).item;
  ok(/Cleveland Museum of Art publishes this as CC0/.test(museum.rights) && museum.credit === 'Winslow Homer. Waves. Cleveland Museum of Art.', 'a museum’s statement reads as the museum’s');
  ok(/uploader marked this CC0/.test(uploader.rights) && /can’t prove who made it/.test(uploader.rights), 'an uploader’s reads as an uploader’s, and doesn’t claim more');
  ok([museum, uploader].every((i) => /doesn’t clear a person’s or a brand’s rights/.test(i.rights) && !/\bsafe\b/i.test(i.rights)), 'and both say what CC0 doesn’t cover, and neither says “safe”');
  ok(await code(S.getItem(pool, { id: 'wc-999' })) === 'item_not_found', 'an unknown item is absent');

  // ── saving
  const save = (actor, id, opts = { fetchBytes }) => S.save(pool, actor, { ...w, id }, opts);
  ok(await code(save(V, 'wc-1')) === 'editor_required', 'a viewer can’t save');
  ok(await code(S.save(pool, X, { ...w, id: 'wc-1' }, { fetchBytes })) === 'not_a_member', 'nor can a stranger');
  ok(await code(save(E, 'wc-999')) === 'item_not_found', 'only what’s in the catalogue');
  const badFile = (await pool.query('SELECT count(*)::int AS n FROM user_files')).rows[0].n;
  ok(await code(save(E, 'wc-1', { fetchBytes: async () => Buffer.from('an error page, not the file') })) === 'hash_mismatch', 'bytes that don’t match the catalogue are refused');
  ok((await pool.query('SELECT count(*)::int AS n FROM user_files')).rows[0].n === badFile && !(await pool.query(`SELECT 1 FROM stock_saves WHERE stock_id = 'wc-1'`)).rows[0], 'and leave nothing behind, so it can be tried again');
  ok(await code(save(E, 'wc-1', { fetchBytes: async () => { throw new S.StockError('down', 'fetch_failed', 502); } })) === 'fetch_failed', 'a failed fetch says so');
  const s1 = await save(E, 'wc-1');
  ok(s1.already === false && s1.saved.fileId && urls[0] === 'https://cdn.example/stock/wc-1/v1/full.jpg', 'an editor saves it, fetched only from the catalogue’s own address');
  const f = (await pool.query('SELECT workspace_id, mime_type, file_size, metadata, storage_path FROM user_files WHERE id = $1', [s1.saved.fileId])).rows[0];
  ok(f.workspace_id === ws && f.mime_type === 'image/jpeg' && Number(f.file_size) === JPEG.length, 'it’s a file in this workspace’s Library, the right size');
  const meta = typeof f.metadata === 'string' ? JSON.parse(f.metadata) : f.metadata;
  ok(meta.source === 'stock' && meta.stockId === 'wc-1' && meta.license === 'CC0-1.0' && meta.sourceUrl && meta.credit && meta.checkedAt, 'and carries where it came from and its licence');
  ok(fs.readFileSync(f.storage_path).equals(JPEG), 'with exactly the catalogue’s bytes');
  ok((await check(pool, { object: `library_asset:${s1.saved.fileId}`, relation: 'viewer', subject: `user:${viewer}` })).allowed, 'everyone in the workspace can read it');
  ok(!(await check(pool, { object: `library_asset:${s1.saved.fileId}`, relation: 'viewer', subject: `user:${stranger}` })).allowed, 'nobody outside it can');
  const s2 = await save(E, 'wc-1');
  ok(s2.already === true && s2.saved.fileId === s1.saved.fileId && urls.length === 1, 'saving it again gives the same file, with no second fetch');
  const list = await S.listSaved(pool, V, w);
  ok(list.saved.length === 1 && list.saved[0].fileId === s1.saved.fileId && list.saved[0].id === 'wc-1' && list.saved[0].rights, 'a viewer sees what’s saved here, with its licence');
  ok(await code(S.listSaved(pool, X, w)) === 'not_a_member', 'a stranger doesn’t');
  ok((await S.listSaved(pool, X, { workspace: other })).saved.length === 0, 'and another workspace has its own');
  await pool.query('UPDATE user_files SET deleted_at = now() WHERE id = $1', [s1.saved.fileId]);
  ok((await S.listSaved(pool, V, w)).saved.length === 0, 'a copy deleted from the Library stops being listed');
  const s3 = await save(E, 'wc-1');
  ok(s3.already === false && s3.saved.fileId !== s1.saved.fileId, 'and can be saved again');
  const racing = await Promise.allSettled([save(E, 'wc-2'), save(E, 'wc-2')]);
  const fileIds = racing.filter((r) => r.status === 'fulfilled').map((r) => r.value.saved.fileId);
  ok((await pool.query(`SELECT count(*)::int AS n FROM user_files WHERE metadata->>'stockId' = 'wc-2'`)).rows[0].n === 1 && fileIds.length >= 1, 'two saves at once make one copy');
  await pool.query(`INSERT INTO stock_saves (workspace_id, stock_id, created_at) VALUES ($1,'wc-4', now() - interval '1 hour')`, [ws]);
  const reclaimed = await save(E, 'wc-4');
  ok(reclaimed.already === false && (await pool.query('SELECT mime_type FROM user_files WHERE id = $1', [reclaimed.saved.fileId])).rows[0].mime_type === 'video/webm', 'a save a dead process left half done can be taken over, and video keeps its type');

  // ── agents
  S._useCatalogue({ ...S.catalogue() });
  const found = await Mcp.callTool(pool, AG, 'search', { q: 'waves' });
  ok(found.structuredContent.items[0].id === 'cma-3', 'an agent searches');
  ok((await Mcp.callTool(pool, AG, 'get_item', { id: 'cma-3' })).structuredContent.item.credit, 'and reads an item');
  const agentSave = await S.save(pool, AG, { ...w, id: 'cma-3' }, { fetchBytes });
  ok(agentSave.saved.fileId && (await S.listSaved(pool, V, w)).saved.find((x) => x.id === 'cma-3').agentSaved === true, 'an agent saves, marked as its own');
  ok(!Mcp.TOOLS.some((t) => /withdraw/.test(t.name)), 'there is no agent tool to withdraw');
  await assert.rejects(Mcp.callTool(pool, AG, 'get_item', { id: 'nope' }), (e) => e instanceof Mcp.StockMcpError && e.code === 'item_not_found');

  // ── withdrawing
  ok(await code(S.withdraw(pool, E, { id: 'cma-3', reason: 'x' })) === 'staff_only' && await code(S.withdraw(pool, { id: agentU, kind: 'agent', role: 'admin' }, { id: 'cma-3', reason: 'x' })) === 'staff_only', 'only XENO staff can withdraw an item, and never an agent');
  ok(await code(S.withdraw(pool, STAFF, { id: 'cma-3', reason: ' ' })) === 'reason_required', 'it needs a reason');
  const out = await S.withdraw(pool, STAFF, { id: 'wc-1', reason: 'The photographer says it isn’t theirs to give away.' });
  ok(out.copiesRemoved === 1 && out.cdnKeys.some((k) => k === 'stock/wc-1/v1/full.jpg'), 'it removes the copies and names what the operator removes from the CDN');
  ok((await S.search(pool, { q: 'forest dawn' })).total === 0 && await code(S.getItem(pool, { id: 'wc-1' })) === 'item_not_found', 'the item stops being offered');
  ok(await code(save(E, 'wc-1')) === 'item_not_found', 'and can’t be saved');
  ok((await pool.query('SELECT deleted_at FROM user_files WHERE id = $1', [s3.saved.fileId])).rows[0].deleted_at, 'the saved copy stops being served');
  ok((await pool.query(`SELECT detail FROM user_notifications WHERE user_id = $1 AND source = 'stock'`, [editor])).rows.some((r) => /photographer/.test(r.detail)), 'whoever saved it is told why');
  ok((await S.withdraw(pool, STAFF, { id: 'wc-1', reason: 'again' })).copiesRemoved === 0, 'withdrawing twice changes nothing');

  console.log(`\nstock: ${passed} passed`);
}
main().then(async () => { await pool.end(); }).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

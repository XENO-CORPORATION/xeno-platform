/**
 * XENO Fonts (services/fonts.js + fontsMcp.js) on real Postgres.
 *
 *   - the catalogue: every family is an allowed licence with files, every pairing resolves, and CSS is well-formed
 *   - who: a stranger is refused, a viewer reads, an editor adds and removes; an agent adds from the catalogue and nothing else
 *   - uploads: only a person, only with rights confirmed; not a font and restricted embedding are refused; the rights are recorded
 *   - an upload is private to its workspace, and a takedown is staff's: the file goes and the person is told
 *   - a brand kit's CSS brings its catalogue fonts
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/fonts.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples, check } from '../utils/authzReBAC.js';
import * as F from '../services/fonts.js';
import * as Mcp from '../services/fontsMcp.js';
import * as K from '../services/brandKits.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `ft${process.pid}`; let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log('  ok ', m); };
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$1,true,true,'x') RETURNING id`, [`${tag}${s}`, `${tag}${s}@example.test`])).rows[0].id;
const code = async (p) => { try { await p; return null; } catch (e) { return e.code || e.message; } };
const team = async (owner, name) => (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team',$2,$3) RETURNING id`, [owner, name, `${tag}-${name.toLowerCase()}`])).rows[0].id;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeno-fonts-test-'));
const utf16be = (s) => { const b = Buffer.from(s, 'utf16le'); b.swap16(); return b; };
function ttf(family, { fsType = 0, weight = 400 } = {}) {
  const s = utf16be(family), name = Buffer.alloc(18 + s.length); name.writeUInt16BE(1, 2); name.writeUInt16BE(18, 4); name.writeUInt16BE(3, 6); name.writeUInt16BE(1, 8); name.writeUInt16BE(1, 12); name.writeUInt16BE(s.length, 14); s.copy(name, 18);
  const o2 = Buffer.alloc(78); o2.writeUInt16BE(weight, 4); o2.writeUInt16BE(fsType, 8);
  const head = Buffer.alloc(12 + 32); head.writeUInt32BE(0x00010000, 0); head.writeUInt16BE(2, 4); head.write('name', 12, 'latin1'); head.writeUInt32BE(44, 20); head.writeUInt32BE(name.length, 24); head.write('OS/2', 28, 'latin1'); head.writeUInt32BE(44 + name.length, 36); head.writeUInt32BE(78, 40);
  return Buffer.concat([head, name, o2]);
}
let n = 0;
const put = (buf) => { const p = path.join(dir, `f${n += 1}.ttf`); fs.writeFileSync(p, buf); return { storagePath: p, originalName: path.basename(p), size: buf.length }; };

async function main() {
  await runAllMigrations(pool);
  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger'), agentU = await user('agent'), staffU = await user('staff');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [agentU, editor]);
  const ws = await team(owner, 'Fonts'), other = await team(stranger, 'Other');
  await writeTuples(pool, { writes: [['owner', owner], ['editor', editor], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation })).concat([{ object: `workspace:${other}`, subject: `user:${stranger}`, relation: 'owner' }]) });
  const O = { id: owner, kind: 'human' }, E = { id: editor, kind: 'human' }, V = { id: viewer, kind: 'human' }, S = { id: stranger, kind: 'human' }, AG = { id: agentU, kind: 'agent' };
  const STAFF = { id: staffU, kind: 'human', role: 'admin' };
  const w = { workspace: ws };

  // ── the catalogue
  const cat = F.catalogue();
  ok(cat.families.length >= 40 && cat.families.every((f) => ['OFL-1.1', 'Apache-2.0'].includes(f.license.type) && f.files.length && f.files.every((x) => /^[0-9a-f]{64}$/.test(x.sha256))), `every family is an allowed licence with hashed files (${cat.families.length})`);
  ok(cat.pairings.every(([a, b]) => F.catalogue().families.some((f) => f.id === a) && F.catalogue().families.some((f) => f.id === b)), 'every pairing names real families');
  const inter = F.searchCatalogue({ q: 'inter' }).families.find((f) => f.id === 'inter');
  ok(inter && inter.pairsWith.some((p) => p.id === 'jetbrains-mono') && inter.licenseUrl.endsWith('/LICENSE.txt'), 'search finds a font with its pairings and licence');
  ok(F.searchCatalogue({ category: 'monospace' }).families.every((f) => f.category === 'monospace') && F.searchCatalogue({ q: 'zzzz' }).families.length === 0, 'search filters by category, and can find nothing');
  const css = F.faceCss(['inter'], { weights: [400] });
  ok(/font-family: "Inter"/.test(css) && /format\("woff2"\)/.test(css) && /unicode-range: U\+/.test(css) && !css.includes('undefined') && css.split('{').length === css.split('}').length, 'CSS is well-formed, with a unicode-range');
  ok(F.faceCss(['not-a-font']) === '', 'an unknown family makes no CSS');

  // ── who
  ok(await code(F.listWorkspaceFonts(pool, S, w)) === 'not_a_member', 'a stranger can’t see a workspace’s fonts');
  ok(await code(F.addFamily(pool, V, { ...w, family: 'inter' })) === 'editor_required', 'a viewer can’t add one');
  ok(await code(F.addFamily(pool, E, { ...w, family: 'comic-sans' })) === 'font_not_found', 'a font outside the catalogue is refused');
  await F.addFamily(pool, E, { ...w, family: 'inter' });
  await F.addFamily(pool, E, { ...w, family: 'inter' });
  ok((await F.listWorkspaceFonts(pool, V, w)).catalogue.filter((f) => f.id === 'inter').length === 1, 'adding twice is once, and a viewer reads it');
  const agentAdded = await Mcp.callTool(pool, AG, 'add_font', { ...w, family: 'lora' });
  ok(agentAdded.structuredContent.font.id === 'lora' && (await F.listWorkspaceFonts(pool, V, w)).catalogue.find((f) => f.id === 'lora').agentAdded === true, 'an agent adds from the catalogue, marked as its own');
  ok(await code(F.removeFamily(pool, AG, { ...w, family: 'lora' })) === 'human_only', 'an agent can’t remove one');
  ok(!Mcp.TOOLS.some((t) => /upload|remove|takedown/.test(t.name)), 'there is no agent tool to upload or remove');
  await F.removeFamily(pool, E, { ...w, family: 'lora' });
  ok(!(await F.listWorkspaceFonts(pool, V, w)).catalogue.some((f) => f.id === 'lora'), 'a person removes one');

  // ── uploads
  const up = (actor, buf, extra = {}) => F.uploadFont(pool, actor, { ...w, ...put(buf), rightsConfirmed: true, ...extra });
  ok(await code(F.uploadFont(pool, AG, { ...w, ...put(ttf('Acme')), rightsConfirmed: true })) === 'human_only', 'an agent can’t upload: it can’t hold rights');
  await assert.rejects(pool.query(`INSERT INTO font_uploads (workspace_id, file_id, family, format, rights_statement, rights_confirmed_by) VALUES ($1, gen_random_uuid(), 'X', 'ttf', 'yes', $2)`, [ws, agentU]), /only a person can confirm/);
  await assert.rejects(pool.query(`INSERT INTO font_uploads (workspace_id, file_id, family, format, rights_statement) VALUES ($1, gen_random_uuid(), 'X', 'ttf', 'yes')`, [ws]), /only a person can confirm/);
  ok(true, 'and the database refuses it too');
  ok(await code(F.uploadFont(pool, E, { ...w, ...put(ttf('Acme')) })) === 'rights_required' && await code(F.uploadFont(pool, E, { ...w, ...put(ttf('Acme')), rightsConfirmed: 'no' })) === 'rights_required', 'it needs the rights confirmed');
  ok(await code(up(V, ttf('Acme'))) === 'editor_required', 'a viewer can’t upload');
  ok(await code(up(E, Buffer.from('<svg>not a font, despite its name</svg>'))) === 'not_a_font', 'a file that isn’t a font is refused, whatever its name');
  ok(await code(up(E, ttf('Locked', { fsType: 2 }))) === 'font_restricted', 'a font whose own licence forbids embedding is refused');
  ok(await code(F.uploadFont(pool, E, { ...w, ...put(ttf('Acme')), rightsConfirmed: true, size: 16 * 1024 * 1024 })) === 'font_too_large', 'a huge file is refused');
  const u1 = (await up(E, ttf('Acme Display', { weight: 700 }))).upload;
  ok(u1.family === 'Acme Display' && u1.weight === 700 && u1.format === 'ttf', 'the font’s name and weight come from the file itself');
  const rec = (await pool.query('SELECT rights_statement, rights_confirmed_by, rights_confirmed_at FROM font_uploads WHERE id = $1', [u1.id])).rows[0];
  ok(rec.rights_confirmed_by === editor && rec.rights_statement === F.RIGHTS_STATEMENT && rec.rights_confirmed_at, 'who confirmed the rights, what they said and when are recorded');
  const file = (await pool.query('SELECT workspace_id, mime_type FROM user_files WHERE id = $1', [u1.fileId])).rows[0];
  ok(file.workspace_id === ws && file.mime_type === 'font/ttf', 'it’s a file in this workspace’s Library');
  ok((await check(pool, { object: `library_asset:${u1.fileId}`, relation: 'viewer', subject: `user:${viewer}` })).allowed, 'everyone in the workspace can load it');
  ok(!(await check(pool, { object: `library_asset:${u1.fileId}`, relation: 'viewer', subject: `user:${stranger}` })).allowed, 'nobody outside it can');
  ok((await F.listWorkspaceFonts(pool, V, w)).uploads.some((x) => x.id === u1.id), 'it’s listed for the workspace');
  ok(await code(F.removeUpload(pool, S, { workspace: other, id: u1.id })) === 'upload_not_found', 'another workspace can’t reach it');

  // ── takedown
  ok(await code(F.takeDown(pool, E, { id: u1.id, reason: 'x' })) === 'staff_only' && await code(F.takeDown(pool, { id: agentU, kind: 'agent', role: 'admin' }, { id: u1.id, reason: 'x' })) === 'staff_only', 'only XENO staff can take a font down, and never an agent');
  ok(await code(F.takeDown(pool, STAFF, { id: u1.id, reason: ' ' })) === 'reason_required', 'it needs a reason');
  await F.takeDown(pool, STAFF, { id: u1.id, reason: 'The foundry says this licence doesn’t cover it.' });
  ok(!(await F.listWorkspaceFonts(pool, V, w)).uploads.some((x) => x.id === u1.id), 'a taken-down font is gone from the workspace');
  ok((await pool.query('SELECT deleted_at FROM user_files WHERE id = $1', [u1.fileId])).rows[0].deleted_at, 'and its file stops being served');
  ok((await pool.query(`SELECT detail FROM user_notifications WHERE user_id = $1 AND source = 'fonts'`, [editor])).rows.some((r) => /foundry/.test(r.detail)), 'whoever confirmed the rights is told why');
  const u2 = (await up(E, ttf('Keep Me'))).upload;
  await F.removeUpload(pool, E, { ...w, id: u2.id });
  ok(!(await F.listWorkspaceFonts(pool, V, w)).uploads.some((x) => x.id === u2.id) && !(await pool.query('SELECT deleted_at FROM user_files WHERE id = $1', [u2.fileId])).rows[0].deleted_at, 'removing keeps the file in the Library');

  // ── brand kits
  const kit = (await K.createKit(pool, E, { ...w, name: 'Typed' })).kit;
  await K.putToken(pool, E, { ...w, id: kit.id, path: 'type.body', value: { kind: 'typography', value: { fontFamily: 'Inter', fontSize: 16, fontWeight: 700, lineHeight: 1.5 } } });
  await K.putToken(pool, E, { ...w, id: kit.id, path: 'type.brand', value: { kind: 'typography', value: { fontFamily: 'Not In The Catalogue', fontSize: 16, fontWeight: 400, lineHeight: 1.5 } } });
  await K.publish(pool, E, { ...w, id: kit.id });
  const out = (await K.exportKit(pool, V, { ...w, id: kit.id, format: 'css' })).body;
  ok(/@font-face \{\s+font-family: "Inter";\s+font-style: normal;\s+font-weight: 700;/.test(out) && !/font-weight: 400;\s+font-display/.test(out), 'a kit’s CSS brings its catalogue font, at the weight it uses');
  ok(!/@font-face \{\s+font-family: "Not In/.test(out), 'and only fonts from the catalogue');

  console.log(`\nfonts: ${passed} passed`);
}
main().then(async () => { fs.rmSync(dir, { recursive: true, force: true }); await pool.end(); }).catch(async (e) => { console.error(e); fs.rmSync(dir, { recursive: true, force: true }); await pool.end(); process.exit(1); });

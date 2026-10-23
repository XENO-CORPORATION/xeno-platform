/**
 * Office › Write and Notes (services/workspaceDocs.js + docsMcp.js) on real Postgres and a real upload folder.
 *
 *   - a document IS a Storage file: one user_files row per version, one stable file id, XENO Docs' .xdoc bytes;
 *   - the FORMAT is enforced on every write and every read: a script link, an unsafe image, an unknown block, an
 *     attribute the schema would not render are refused (an API caller or an agent cannot skip the editor's rules);
 *   - a document saved as Markdown before the shared format still reads, migrates to .xdoc as a new version, and
 *     restoring the previous version undoes the migration;
 *   - §8.11: an editor writes, a viewer reads, a stranger is refused; Personal documents are the owner's alone;
 *   - a save is a new version; a stale expectedVersion is refused; restoring the earlier version undoes it;
 *   - backlinks follow [label](xeno-doc:<id>), are rewritten on save, and never show a document the reader cannot see;
 *   - search runs through the Library search (title and opening text), workspace by workspace, kind by kind;
 *   - trash + untrash; an agent writes as its owner and the version says an agent made it; MCP has eight tools.
 *
 * Run (from src/server): DATABASE_URL=postgresql://… node tests/workspace-docs.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { ensurePersonalWorkspace } from '../services/personalWorkspace.js';
import * as D from '../services/workspaceDocs.js';
import * as Mcp from '../services/docsMcp.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `dc${process.pid}`; let seq = 0;
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const refuses = async (p, code) => { await assert.rejects(p, (e) => { assert.ok(e instanceof D.DocsError || e instanceof Mcp.DocsMcpError, String(e)); assert.equal(e.code, code); return true; }); };
const written = [];

async function main() {
  await runAllMigrations(pool);
  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger'), agentU = await user('agent');
  await pool.query(`INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)`, [agentU, editor]);
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Docs',$2) RETURNING id`, [owner, `${tag}-${seq += 1}`])).rows[0].id;
  await writeTuples(pool, { writes: [['owner', owner], ['editor', editor], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation })) });
  const E = { id: editor, kind: 'human' }, V = { id: viewer, kind: 'human' }, S = { id: stranger, kind: 'human' }, AG = { id: agentU, kind: 'agent' }, O = { id: owner, kind: 'human' };
  const w = { workspace: ws };

  // ── create: a Storage file
  await refuses(D.createDoc(pool, V, { ...w, kind: 'doc', title: 'No' }), 'editor_required');
  await refuses(D.createDoc(pool, S, { ...w, kind: 'doc', title: 'No' }), 'not_a_member');
  await refuses(D.createDoc(pool, E, { ...w, kind: 'sheet', title: 'No' }), 'invalid_kind');
  await refuses(D.createDoc(pool, E, { ...w, kind: 'doc', title: ' ' }), 'invalid_title');
  await refuses(D.createDoc(pool, E, { ...w, kind: 'doc', title: 'Big', markdown: 'x'.repeat(D.MAX_BYTES + 1) }), 'too_large');
  const a = (await D.createDoc(pool, E, { ...w, kind: 'doc', title: 'Q4 planning', markdown: '# Q4 planning\n\nShip the **ledger** migration first.' })).doc;
  const row = (await pool.query('SELECT file_id, mime_type, storage_path, workspace_id, owner_user_id FROM user_files WHERE id = $1', [a.versionId])).rows[0];
  written.push(row.storage_path);
  assert.equal(String(row.file_id), a.id); assert.equal(String(row.workspace_id), ws); assert.equal(row.owner_user_id, null, 'a team document belongs to the workspace');
  const onDisk = JSON.parse(fs.readFileSync(row.storage_path, 'utf8'));
  assert.equal(onDisk.format, 'xeno.xdoc', 'the bytes are a XENO Docs .xdoc file'); assert.equal(onDisk.title, 'Q4 planning');
  assert.equal(onDisk.content.content[0].type, 'heading'); assert.equal(row.mime_type, 'application/json');
  assert.equal(a.format, 'xdoc'); assert.equal(a.markdown, '# Q4 planning\n\nShip the **ledger** migration first.', 'Markdown in, the same Markdown back out');
  assert.equal(a.text, 'Q4 planning Ship the ledger migration first.');
  assert.equal(a.canEdit, true);
  const asViewer = await D.getDoc(pool, V, { id: a.id });
  assert.equal(asViewer.doc.markdown.startsWith('# Q4'), true); assert.equal(asViewer.doc.canEdit, false);

  // ── the format, on every write: what the editor would not render, nobody can store
  const P = (...c) => ({ type: 'doc', content: [{ type: 'paragraph', content: c }] });
  const hostile = {
    'a javascript: link': P({ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(document.cookie)' } }] }),
    'a data:text/html link': P({ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'data:text/html,<script>alert(1)</script>' } }] }),
    'an svg image': { type: 'doc', content: [{ type: 'image', attrs: { src: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+' } }] },
    'an onerror attribute': { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://a.example/x.png', onerror: 'alert(1)' } }] },
    'an html node': { type: 'doc', content: [{ type: 'html', attrs: { html: '<img src=x onerror=alert(1)>' } }] },
    'a page link whose id is markup': P({ type: 'text', text: 'x', marks: [{ type: 'wikiLink', attrs: { pageId: '"><script>alert(1)</script>' } }] }),
  };
  for (const [what, content] of Object.entries(hostile)) {
    await refuses(D.createDoc(pool, E, { ...w, kind: 'doc', title: 'X', content }), 'invalid_document');
    await refuses(D.saveDoc(pool, E, { id: a.id, content }), 'invalid_document');
    await refuses(D.saveDoc(pool, E, { id: a.id, xdoc: JSON.stringify({ format: 'xeno.xdoc', version: 1, title: 'x', content }) }), 'invalid_document');
    assert.ok(what);
  }
  await refuses(D.createDoc(pool, E, { ...w, kind: 'doc', title: 'X', xdoc: '<html><script>alert(1)</script>' }), 'invalid_document');
  await refuses(D.createDoc(pool, E, { ...w, kind: 'doc', title: 'X', markdown: 'a', content: P({ type: 'text', text: 'b' }) }), 'invalid_document');
  const fromMd = (await D.createDoc(pool, E, { ...w, kind: 'doc', title: 'Links', markdown: '[ok](https://xenosystem.ai) [bad](javascript:alert(1)) <script>alert(1)</script>' })).doc;
  const marks = JSON.stringify(fromMd.content);
  assert.ok(marks.includes('https://xenosystem.ai') && !marks.includes('javascript:'), 'Markdown keeps a safe link and drops a script one');
  assert.ok(fromMd.text.includes('<script>'), 'markup in Markdown is TEXT — the editor shows the characters, never runs them');
  const viaXdoc = (await D.saveDoc(pool, E, { id: fromMd.id, xdoc: JSON.stringify({ format: 'xeno.xdoc', version: 1, title: 'Links', content: P({ type: 'text', text: 'from a file' }) }) })).doc;
  assert.equal(viaXdoc.text, 'from a file', 'an .xdoc file is accepted as is');
  written.push((await pool.query('SELECT storage_path FROM user_files WHERE id = $1', [viaXdoc.versionId])).rows[0].storage_path);
  // a file changed BEHIND this module (on disk) is refused on read, not shown
  const tamper = (await pool.query('SELECT storage_path FROM user_files WHERE id = $1', [viaXdoc.versionId])).rows[0].storage_path;
  const good = fs.readFileSync(tamper, 'utf8');
  fs.writeFileSync(tamper, JSON.stringify({ format: 'xeno.xdoc', version: 1, title: 'x', content: hostile['a javascript: link'] }));
  await refuses(D.getDoc(pool, V, { id: fromMd.id }), 'invalid_document');
  fs.writeFileSync(tamper, good);
  await D.trashDoc(pool, O, { id: fromMd.id });
  await refuses(D.getDoc(pool, S, { id: a.id }), 'not_found');

  // ── save = a new version; stale is refused; restore undoes it
  await refuses(D.saveDoc(pool, V, { id: a.id, markdown: 'hijack' }), 'forbidden');
  const s1 = await D.saveDoc(pool, E, { id: a.id, title: 'Q4 plan', markdown: '# Q4 plan\n\nLedger, then search.', expectedVersion: a.versionId });
  assert.equal(s1.doc.id, a.id, 'the file id never changes'); assert.notEqual(s1.doc.versionId, a.versionId); assert.equal(s1.previousVersion, a.versionId);
  assert.equal(s1.doc.title, 'Q4 plan');
  await refuses(D.saveDoc(pool, E, { id: a.id, markdown: 'late', expectedVersion: a.versionId }), 'version_conflict');
  const vs = (await D.docVersions(pool, E, { id: a.id })).versions;
  assert.equal(vs.length, 2); assert.equal(vs[0].current, true);
  const back = await D.restoreDocVersion(pool, E, { id: a.id, versionId: a.versionId });
  assert.equal(back.doc.markdown, '# Q4 planning\n\nShip the **ledger** migration first.'); assert.equal(back.doc.title, 'Q4 planning', 'restore brings the title back too');
  assert.equal((await D.docVersions(pool, E, { id: a.id })).versions.length, 3, 'nothing in between is lost');

  // ── notes, backlinks
  const n = (await D.createDoc(pool, E, { ...w, kind: 'note', title: 'Meeting notes', markdown: `Decided: see [the plan](xeno-doc:${a.id}).` })).doc;
  assert.deepEqual(n.links, [a.id]);
  let bl = (await D.getDoc(pool, V, { id: a.id })).backlinks;
  assert.deepEqual(bl.map((x) => x.title), ['Meeting notes']);
  const personal = String((await ensurePersonalWorkspace(pool, stranger)).id);
  await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, subject: `user:${stranger}`, relation: 'viewer' }] });
  await D.createDoc(pool, S, { workspace: personal, kind: 'note', title: 'Secret', markdown: `[x](xeno-doc:${a.id})` });
  bl = (await D.getDoc(pool, V, { id: a.id })).backlinks;
  assert.deepEqual(bl.map((x) => x.title), ['Meeting notes'], 'a private note that links here is not shown to someone who cannot read it');
  assert.equal((await D.getDoc(pool, S, { id: a.id })).backlinks.length, 2, 'its owner sees it');
  await D.saveDoc(pool, E, { id: n.id, markdown: 'No links any more.' });
  assert.deepEqual((await D.getDoc(pool, V, { id: a.id })).backlinks.map((x) => x.title), [], 'backlinks follow the newest version');

  // ── lists and search (the Library search), per kind and per workspace
  assert.deepEqual((await D.listDocs(pool, V, { ...w, kind: 'doc' })).docs.map((x) => x.title), ['Q4 planning']);
  assert.deepEqual((await D.listDocs(pool, V, { ...w, kind: 'note' })).docs.map((x) => x.title), ['Meeting notes']);
  const other = (await D.createDoc(pool, E, { ...w, kind: 'doc', title: 'Hiring plan', markdown: 'Two designers.' })).doc;
  assert.deepEqual((await D.listDocs(pool, V, { ...w, kind: 'doc', query: 'ledger' })).docs.map((x) => x.id), [a.id], 'text in the document is found, and only that document');
  assert.deepEqual((await D.listDocs(pool, V, { ...w, kind: 'doc', query: 'hiring' })).docs.map((x) => x.id), [other.id], 'and by title');
  await D.trashDoc(pool, O, { id: other.id });
  assert.deepEqual((await D.listDocs(pool, V, { ...w, kind: 'doc', query: 'nothing-like-this' })).docs, []);
  assert.deepEqual((await D.listDocs(pool, S, { workspace: personal, kind: 'note' })).docs.map((x) => x.title), ['Secret']);
  await refuses(D.listDocs(pool, E, { workspace: personal, kind: 'note' }), 'not_a_member');
  const mine = String((await ensurePersonalWorkspace(pool, editor)).id);
  assert.deepEqual((await D.listDocs(pool, E, { workspace: mine, kind: 'doc' })).docs, [], 'a team document is not in the Personal list');

  // ── trash and back (the Library trash)
  const t = await D.trashDoc(pool, O, { id: a.id });
  assert.equal(t.undo, 'restore');
  assert.equal((await D.listDocs(pool, V, { ...w, kind: 'doc' })).docs.length, 0);
  await refuses(D.getDoc(pool, V, { id: a.id }), 'not_found');
  assert.equal((await D.untrashDoc(pool, O, { id: a.id })).doc.title, 'Q4 planning');
  assert.equal((await D.listDocs(pool, V, { ...w, kind: 'doc' })).docs.length, 1);

  // ── an agent writes as its owner; the version says so
  const ag = (await D.createDoc(pool, AG, { ...w, kind: 'note', title: 'Agent summary', markdown: 'Summary.' })).doc;
  assert.equal((await pool.query(`SELECT metadata->>'last_edited_by_agent' AS a FROM user_files WHERE id = $1`, [ag.versionId])).rows[0].a, String(agentU));
  const hs = await D.saveDoc(pool, E, { id: ag.id, markdown: 'Summary, checked.' });
  assert.equal((await pool.query(`SELECT metadata->>'last_edited_by_agent' AS a FROM user_files WHERE id = $1`, [hs.doc.versionId])).rows[0].a, null, 'a person’s save clears it');

  // ── MCP: the same functions
  assert.deepEqual(Mcp.TOOLS.map((x) => x.name).sort(), ['create_doc', 'get_doc', 'list_docs', 'list_versions', 'restore_version', 'save_doc', 'trash_doc', 'untrash_doc']);
  const got = (await Mcp.callTool(pool, AG, 'get_doc', { id: a.id })).structuredContent.doc;
  await refuses(Mcp.callTool(pool, AG, 'save_doc', { id: a.id, markdown: 'x', expected_version: '00000000-0000-4000-8000-000000000000' }), 'version_conflict');
  const ms = (await Mcp.callTool(pool, AG, 'save_doc', { id: a.id, markdown: got.markdown + '\n\nAdded by an agent.', expected_version: got.versionId })).structuredContent;
  const undo = (await Mcp.callTool(pool, AG, 'restore_version', { id: a.id, version_id: ms.previousVersion })).structuredContent;
  assert.equal(undo.doc.markdown, got.markdown, 'an agent undoes its own save');

  // ── a document saved as Markdown before the shared format (2026-10-20 → 10-23): reads, migrates, undoes
  const old = (await D.createDoc(pool, E, { ...w, kind: 'note', title: 'Old note', markdown: 'x' })).doc;
  const oldRow = (await pool.query('SELECT storage_path FROM user_files WHERE id = $1', [old.versionId])).rows[0];
  const legacyMd = `# Old note\n\nWritten in **Markdown**, linking [the plan](xeno-doc:${a.id}).`;
  fs.writeFileSync(oldRow.storage_path, legacyMd);   // exactly what the first Write/Notes stored: the Markdown, verbatim
  const sha = crypto.createHash('sha256').update(legacyMd).digest('hex');
  await pool.query(`UPDATE user_files SET mime_type = 'text/markdown', content_sha256 = $2, file_size = $3, metadata = jsonb_set(metadata, '{xeno_doc}', (metadata->'xeno_doc') - 'format') WHERE id = $1`, [old.versionId, sha, Buffer.byteLength(legacyMd)]);
  await pool.query('DELETE FROM storage_objects WHERE file_id = $1', [old.versionId]).catch(() => {});
  const legacy = (await D.getDoc(pool, V, { id: old.id })).doc;
  assert.equal(legacy.format, 'markdown', 'a pre-format document says what it is');
  assert.ok(JSON.stringify(legacy.content).includes('"wikiLink"'), 'its page link reads as the wikiLink mark');
  assert.deepEqual(legacy.links, [a.id]);
  const pending = await D.legacyDocs(pool);
  assert.ok(pending.some((r) => String(r.file_id) === old.id), 'the migration finds it');
  const migrated = await D.migrateLegacyDoc(pool, pending.find((r) => String(r.file_id) === old.id));
  assert.equal(migrated.doc.format, 'xdoc'); assert.equal(migrated.doc.text, legacy.text, 'the same words, now in the shared format');
  assert.equal(JSON.parse(fs.readFileSync((await pool.query('SELECT storage_path FROM user_files WHERE id = $1', [migrated.doc.versionId])).rows[0].storage_path, 'utf8')).format, 'xeno.xdoc');
  assert.ok(!(await D.legacyDocs(pool)).some((r) => String(r.file_id) === old.id), 'migrating twice finds nothing to do');
  const undone = await D.restoreDocVersion(pool, E, { id: old.id, versionId: migrated.previousVersion });
  assert.equal(undone.doc.format, 'markdown', 'restoring the previous version undoes the migration');
  assert.equal(undone.doc.text, legacy.text);

  for (const r of (await pool.query(`SELECT storage_path FROM user_files WHERE metadata->>'source' = 'xeno-docs'`)).rows) written.push(r.storage_path);
  console.log('workspace-docs: all checks passed');
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exitCode = 1; })
  .finally(() => { for (const p of new Set(written)) { try { fs.unlinkSync(p); } catch {} } });

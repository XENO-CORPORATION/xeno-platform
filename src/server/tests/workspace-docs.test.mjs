/**
 * Office › Write and Notes (services/workspaceDocs.js + docsMcp.js) on real Postgres and a real upload folder.
 *
 *   - a document IS a Storage file: one user_files row per version, one stable file id, text/markdown bytes;
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
  assert.equal(fs.readFileSync(row.storage_path, 'utf8'), '# Q4 planning\n\nShip the **ledger** migration first.', 'the bytes are the Markdown, verbatim');
  assert.equal(a.canEdit, true);
  const asViewer = await D.getDoc(pool, V, { id: a.id });
  assert.equal(asViewer.doc.markdown.startsWith('# Q4'), true); assert.equal(asViewer.doc.canEdit, false);
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

  for (const r of (await pool.query(`SELECT storage_path FROM user_files WHERE metadata->>'source' = 'xeno-docs'`)).rows) written.push(r.storage_path);
  console.log('workspace-docs: all checks passed');
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exitCode = 1; })
  .finally(() => { for (const p of new Set(written)) { try { fs.unlinkSync(p); } catch {} } });

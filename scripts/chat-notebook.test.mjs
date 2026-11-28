// Notebooks in XENO Chat, on real Postgres (xeno-corpus docs/specs/2026-11-27-notebooks-in-chat.md).
// A file's own ingestion writes its notebook passages in the same run; the notebook lists its sources with a state;
// a project's answers are grounded in those passages through Corpus's retrieve(), numbered [n]; an answer's marks are
// checked by Corpus's cite() against exactly what the manifest says the model was given; and none of the notebook's
// rows leak into the platform's own readers (the worker, "safe to serve", the chunk path).
//   TEST_DATABASE_URL=postgresql://… node --test --test-force-exit scripts/chat-notebook.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';

import { writeTuples } from '../src/server/utils/authzReBAC.js';
import { createAuthorizedProject, linkAssetToProject, userPrincipal } from '../src/server/services/chatProjectAuthority.js';
import { registerManagedLibraryFile, getAuthorizedLibraryFile } from '../src/server/services/libraryAssets.js';
import { assembleProjectContext } from '../src/server/services/chatProjectContext.js';
import { extractAsset } from '../src/server/services/library/assetExtractors.js';
import { ingestLibraryAsset } from '../src/server/services/library/assetIngestionService.js';
import { claimLibraryIngestion } from '../src/server/workers/libraryIngestionWorker.js';
import {
  notebookSources, selectFileSource, authorisedPassages, citationsFor, notebookActive, PASSAGE_VERSION,
} from '../src/server/services/chatNotebook.js';

process.env.LIBRARY_CONTENT_SECRET ||= 'notebook-test-library-content-secret';
const connectionString = process.env.TEST_DATABASE_URL;
const pool = connectionString ? new pg.Pool({ connectionString, max: 4 }) : null;
const marker = `nb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const semanticIndexer = async (db, id) => (await db.query("UPDATE library_asset_ingestions SET semantic_status='disabled' WHERE id=$1 RETURNING *", [id])).rows[0];
let ownerId, outsiderId, project, conversationId, dir;

const DOC = [
  '# Returns',
  '',
  'A customer may return an order within thirty days with its receipt.',
  '',
  '# Shipping',
  '',
  'Orders above fifty euros ship free to every country in the union.',
  '',
  '# Warranty',
  '',
  'Every console carries a two year warranty against hardware faults.',
].join('\n');

async function addFile(name, body, mime = 'text/markdown') {
  const storagePath = path.join(dir, `${marker}-${name}`);
  await fs.writeFile(storagePath, body, 'utf8');
  const asset = await registerManagedLibraryFile(pool, {
    userId: ownerId, filename: `${marker}-${name}`, originalName: name, mimeType: mime,
    fileSize: (await fs.stat(storagePath)).size, storagePath, metadata: { source: 'notebook-test' },
  });
  await linkAssetToProject(pool, { principal: userPrincipal(ownerId), projectId: project.id, assetId: asset.id });
  await ingestLibraryAsset(pool, asset.id, { scanner: async () => {}, extractor: extractAsset, semanticIndexer });
  return asset;
}

test.before(async () => {
  if (!pool) return;
  const user = async (n) => (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`, [`${marker}-${n}`, `${marker}-${n}@example.test`])).rows[0].id;
  ownerId = await user('owner');
  outsiderId = await user('outsider');
  project = await createAuthorizedProject(pool, { principal: userPrincipal(ownerId), name: `${marker} notebook` });
  conversationId = (await pool.query(
    `INSERT INTO chat_conversations(user_id,title,model_id,project_id) VALUES($1,'Notebook','gpt-5.6',$2) RETURNING id`,
    [ownerId, project.id])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `conversation:${conversationId}`, relation: 'parent', subject: `project:${project.id}` }] });
  dir = path.join(process.cwd(), 'uploads', marker);
  await fs.mkdir(dir, { recursive: true });
});

test.after(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  if (pool) await pool.end();
});

let policy;
test('a file\'s ingestion writes its notebook passages in the same run, anchored at its headings', { skip: !pool }, async () => {
  policy = await addFile('policy.md', DOC);
  const rows = (await pool.query(
    `SELECT extractor_id, extractor_version, state, content_sha256, semantic_status FROM library_asset_ingestions WHERE asset_id=$1 ORDER BY created_at`,
    [policy.id])).rows;
  assert.equal(rows.length, 2, 'the platform ingestion and the notebook ingestion');
  const [platform, nb] = rows;
  assert.equal(platform.state, 'ready');
  assert.notEqual(platform.extractor_id, 'corpus-notebook');
  assert.equal(nb.extractor_id, 'corpus-notebook');
  assert.equal(nb.extractor_version, PASSAGE_VERSION);
  assert.equal(nb.state, 'ready');
  assert.equal(nb.content_sha256, platform.content_sha256, 'the passages describe the same bytes');
  assert.equal(nb.semantic_status, 'disabled', 'the embedding worker never picks a notebook row up');
  const passages = (await pool.query(
    `SELECT c.content, c.source_locator FROM library_asset_chunks c JOIN library_asset_ingestions i ON i.id=c.ingestion_id
      WHERE i.asset_id=$1 AND i.extractor_id='corpus-notebook' ORDER BY c.ordinal`, [policy.id])).rows;
  assert.equal(passages.length, 3);
  assert.deepEqual(passages.map((p) => p.source_locator.heading), ['Returns', 'Shipping', 'Warranty']);
  for (const p of passages) assert.match(p.source_locator.passageId, /^p_[0-9a-f]{24}$/);
});

test('the notebook lists the file as indexed with its passages; an outsider sees nothing', { skip: !pool }, async () => {
  const sources = await notebookSources(pool, userPrincipal(ownerId), project.id);
  assert.equal(sources.length, 1);
  assert.deepEqual({ kind: sources[0].kind, state: sources[0].state, selected: sources[0].selected, passages: sources[0].passages },
    { kind: 'file', state: 'indexed', selected: true, passages: 3 });
  await assert.rejects(notebookSources(pool, userPrincipal(outsiderId), project.id));
  await assert.rejects(authorisedPassages(pool, userPrincipal(outsiderId), project.id));
});

test('the notebook\'s rows never reach the platform\'s readers', { skip: !pool }, async () => {
  // the worker reclaims FAILED rows: a failed notebook row must still never be claimed as an extraction job
  await pool.query("UPDATE library_asset_ingestions SET state='failed', attempt_count=0 WHERE asset_id=$1 AND extractor_id='corpus-notebook'", [policy.id]);
  const claimed = await claimLibraryIngestion(pool, `${marker}-worker`);
  if (claimed) {
    assert.notEqual(claimed.extractor_id, 'corpus-notebook', 'the worker claimed a notebook row');
    await pool.query('UPDATE library_asset_ingestions SET lease_owner=NULL, lease_expires_at=NULL WHERE id=$1', [claimed.id]);
  }
  await pool.query("UPDATE library_asset_ingestions SET state='ready' WHERE asset_id=$1 AND extractor_id='corpus-notebook'", [policy.id]);
  // the platform's own chunk count is unchanged by the passages (the chunk path reads one ingestion)
  const chunkRows = (await pool.query(
    `SELECT count(*)::int AS n FROM library_asset_chunks c JOIN library_asset_ingestions i ON i.id=c.ingestion_id
      WHERE c.asset_id=$1 AND i.state='ready' AND i.extractor_id IS DISTINCT FROM 'corpus-notebook'`, [policy.id])).rows[0].n;
  assert.ok(chunkRows >= 1);
  assert.ok(await getAuthorizedLibraryFile(pool, userPrincipal(ownerId), policy.id), 'the file is still served from its own scan');
});

let manifest;
test('a project answer is grounded in the notebook: numbered passages, the mode, and the manifest cite() checks', { skip: !pool }, async () => {
  assert.equal(await notebookActive(pool, project.id), true);
  const ctx = await assembleProjectContext({
    db: pool, principal: userPrincipal(ownerId), projectId: project.id, conversationId,
    query: 'How long does a customer have to return an order?', modelId: 'gpt-5.6', maxInputTokens: 8_000,
  });
  assert.equal(ctx.manifest.semantic_status, 'notebook');
  assert.equal(ctx.manifest.notebook.mode, 'full', 'three short passages fit: the model sees them all');
  assert.equal(ctx.manifest.notebook.given.length, 3);
  assert.deepEqual(ctx.manifest.notebook.given.map((g) => g.n), [1, 2, 3]);
  const first = JSON.parse(ctx.contentBlocks[0].content);
  assert.equal(first.cite_as, '[1]');
  assert.equal(first.trust, 'untrusted-evidence');
  assert.match(first.content, /thirty days/);
  assert.match(ctx.instructions, /cite it as \[n\]/);
  manifest = ctx.manifest;
});

test('ranking takes over when the passages do not fit, best first', { skip: !pool }, async () => {
  const ctx = await assembleProjectContext({
    db: pool, principal: userPrincipal(ownerId), projectId: project.id, conversationId,
    query: 'warranty on hardware faults', modelId: 'gpt-5.6', maxInputTokens: 2_030,
  });
  assert.equal(ctx.manifest.notebook.mode, 'retrieval');
  assert.equal(ctx.manifest.notebook.given[0].anchor.heading, 'Warranty');
});

test('an answer may cite only what it was given: an invented mark is refused, never shown', { skip: !pool }, async () => {
  const c = citationsFor('Customers have thirty days [1]. Shipping is free above fifty euros [2]. Consoles fly [9].', { notebook: manifest.notebook });
  assert.equal(c.ok, false);
  assert.deepEqual(c.citations.map((x) => x.n), [1, 2]);
  assert.equal(c.citations[0].source, 'policy.md');
  assert.equal(c.citations[0].anchor.heading, 'Returns');
  assert.equal(c.refused.length, 1);
  assert.match(c.refused[0].why, /no given passage 9/);
  const clean = citationsFor('Customers have thirty days [1].', { notebook: manifest.notebook });
  assert.equal(clean.ok, true);
  assert.equal(citationsFor('No notebook here [1].', { sources: [] }), null, 'a non-notebook answer has no citations to check');
});

test('a source with nothing readable is failed with its reason, never an empty success (D22)', { skip: !pool }, async () => {
  const empty = await addFile('blank.md', '   \n\n   \n');
  const s = (await notebookSources(pool, userPrincipal(ownerId), project.id)).find((x) => x.id === String(empty.id));
  assert.ok(s, 'the file is listed');
  assert.equal(s.state, 'failed');
  assert.ok(s.reason, 'and says why');
});

test('a file whose extraction moved on is stale until it is read again, and is not used', { skip: !pool }, async () => {
  await pool.query(
    `UPDATE library_asset_ingestions SET completed_at = NOW() + INTERVAL '1 minute'
      WHERE asset_id=$1 AND extractor_id IS DISTINCT FROM 'corpus-notebook'`, [policy.id]);
  const s = (await notebookSources(pool, userPrincipal(ownerId), project.id)).find((x) => x.id === String(policy.id));
  assert.equal(s.state, 'stale');
  assert.equal(s.reason, 'extraction_changed');
  assert.equal((await authorisedPassages(pool, userPrincipal(ownerId), project.id)).length, 0, 'stale passages are not given to the model');
  await pool.query(
    `UPDATE library_asset_ingestions SET completed_at = NOW() - INTERVAL '1 minute'
      WHERE asset_id=$1 AND extractor_id IS DISTINCT FROM 'corpus-notebook'`, [policy.id]);
});

test('turning a file off removes it from answers; only an editor may', { skip: !pool }, async () => {
  await assert.rejects(selectFileSource(pool, userPrincipal(outsiderId), project.id, policy.id, false));
  await selectFileSource(pool, userPrincipal(ownerId), project.id, policy.id, false);
  assert.equal((await authorisedPassages(pool, userPrincipal(ownerId), project.id)).length, 0);
  await assert.rejects(selectFileSource(pool, userPrincipal(ownerId), project.id, '00000000-0000-4000-8000-000000000000', true), /Not a source/);
  await selectFileSource(pool, userPrincipal(ownerId), project.id, policy.id, true);
  assert.equal((await authorisedPassages(pool, userPrincipal(ownerId), project.id)).length, 3);
});

test('corpus_sources refuses a malformed source at the database', { skip: !pool }, async () => {
  // a personal project's corpus sits in its owner's personal workspace (corpus_corpora_guard)
  const workspaceId = (await pool.query(`SELECT id FROM workspaces WHERE owner_user_id=$1 AND workspace_type='personal'`, [ownerId])).rows[0]?.id;
  assert.ok(workspaceId, 'every account has its personal workspace');
  const corpus = (await pool.query(
    `INSERT INTO corpus_corpora(workspace_id, scope_kind, project_id, subject) VALUES ($1, 'project', $2::uuid, 'project:' || $2::text) RETURNING id`,
    [workspaceId, project.id])).rows[0];
  await assert.rejects(pool.query(`INSERT INTO corpus_sources(corpus_id, kind, title) VALUES ($1, 'web', 'no url')`, [corpus.id]));
  await assert.rejects(pool.query(`INSERT INTO corpus_sources(corpus_id, kind, title) VALUES ($1, 'file', 'a file')`, [corpus.id]));
  await assert.rejects(pool.query(`INSERT INTO corpus_sources(corpus_id, kind, title, state) VALUES ($1, 'note', 'n', 'failed')`, [corpus.id]));
  const ok = await pool.query(`INSERT INTO corpus_sources(corpus_id, kind, title, url) VALUES ($1, 'web', 'page', 'https://example.test/a') RETURNING id`, [corpus.id]);
  assert.ok(ok.rows[0].id);
  const listed = (await notebookSources(pool, userPrincipal(ownerId), project.id)).find((x) => x.kind === 'web');
  assert.equal(listed.state, 'queued');
});

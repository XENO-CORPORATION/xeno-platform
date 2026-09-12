import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';

import { CHAT_PROJECT_CONTRACTS } from '../src/server/config/chatProjectContracts.js';
import { createAuthorizedProject, linkAssetToProject, userPrincipal } from '../src/server/services/chatProjectAuthority.js';
import { registerManagedLibraryFile } from '../src/server/services/libraryAssets.js';
import { indexLibraryAssetEmbeddings } from '../src/server/services/library/assetIngestionService.js';
import { retrieveAuthorizedAssetChunks } from '../src/server/services/library/assetRetrievalService.js';
import { writeTuples } from '../src/server/utils/authzReBAC.js';

const connectionString = process.env.TEST_DATABASE_URL;
const embeddingBaseUrl = process.env.XENO_EMBEDDING_BASE_URL;
const pool = connectionString && embeddingBaseUrl ? new pg.Pool({ connectionString, max: 4 }) : null;
const marker = `semantic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
let ownerId;
let outsiderId;
let project;
let outsiderProject;
let targetAsset;
let exactAsset;
let outsiderAsset;
let tempDirectory;

async function createAsset({ userId, projectId, name, chunks }) {
  const storagePath = path.join(tempDirectory, `${marker}-${name}.txt`);
  await fs.writeFile(storagePath, chunks.join('\n'), 'utf8');
  const asset = await registerManagedLibraryFile(pool, {
    userId,
    filename: path.basename(storagePath),
    originalName: `${name}.txt`,
    mimeType: 'text/plain',
    fileSize: (await fs.stat(storagePath)).size,
    storagePath,
    metadata: { source: 'semantic-integration-test' },
  });
  await linkAssetToProject(pool, {
    principal: userPrincipal(userId), projectId, assetId: asset.id,
  });
  const ingestion = (await pool.query(
    `UPDATE library_asset_ingestions
     SET state='ready', extractor_id='semantic-test', extractor_version='1', completed_at=NOW()
     WHERE asset_id=$1 RETURNING id`,
    [asset.id],
  )).rows[0];
  for (let ordinal = 0; ordinal < chunks.length; ordinal += 1) {
    await pool.query(
      `INSERT INTO library_asset_chunks(ingestion_id,asset_id,ordinal,content,token_count,source_locator)
       VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
      [ingestion.id, asset.id, ordinal, chunks[ordinal], chunks[ordinal].split(/\s+/).length, JSON.stringify({ line: ordinal + 1 })],
    );
  }
  const indexed = await indexLibraryAssetEmbeddings(pool, ingestion.id);
  assert.equal(indexed.semantic_status, 'ready');
  return asset;
}

test.before(async () => {
  if (!pool) return;
  tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'xeno-semantic-'));
  ownerId = (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`,
    [`${marker}-owner`, `${marker}-owner@example.test`],
  )).rows[0].id;
  outsiderId = (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`,
    [`${marker}-outsider`, `${marker}-outsider@example.test`],
  )).rows[0].id;
  project = await createAuthorizedProject(pool, {
    principal: userPrincipal(ownerId), name: `${marker} authorized`,
  });
  outsiderProject = await createAuthorizedProject(pool, {
    principal: userPrincipal(outsiderId), name: `${marker} outsider`,
  });
  targetAsset = await createAsset({
    userId: ownerId,
    projectId: project.id,
    name: 'paris-source',
    chunks: ['The Eiffel Tower stands in Paris, France.'],
  });
  exactAsset = await createAsset({
    userId: ownerId,
    projectId: project.id,
    name: 'exact-source',
    chunks: ['The project-only launch code is ORBIT-7429.'],
  });
  outsiderAsset = await createAsset({
    userId: outsiderId,
    projectId: outsiderProject.id,
    name: 'cross-tenant-lure',
    chunks: Array.from({ length: 192 }, (_, index) => (
      `Tourists visit the famous wrought-iron Eiffel landmark in the private outsider city record ${index}.`
    )),
  });
});

test.after(async () => {
  if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true });
  if (pool) await pool.end();
});

test('real XENO embeddings recover a semantic answer with no exact query terms', { skip: !pool }, async () => {
  const result = await retrieveAuthorizedAssetChunks(pool, {
    principal: userPrincipal(ownerId),
    projectId: project.id,
    query: 'In which city can travelers see the celebrated wrought-iron monument?',
    limit: 12,
  });
  assert.equal(result.diagnostic.semantic_status, 'ready');
  assert.equal(result.chunks[0].asset_id, targetAsset.id);
  assert.match(result.chunks[0].content, /Paris/);
  assert.ok(result.chunks[0].retrieval_channels.includes('semantic'));
});

test('tenant predicates and per-asset ReBAC prevent a stronger cross-tenant lure', { skip: !pool }, async () => {
  const result = await retrieveAuthorizedAssetChunks(pool, {
    principal: userPrincipal(ownerId),
    projectId: project.id,
    query: 'famous wrought-iron Eiffel landmark city',
    limit: 12,
  });
  assert.ok(result.diagnostic.semantic_candidates > 0);
  assert.equal(result.chunks.some((chunk) => chunk.asset_id === outsiderAsset.id), false);
  assert.equal(result.chunks.every((chunk) => [targetAsset.id, exactAsset.id].includes(chunk.asset_id)), true);
});

test('semantic outage degrades explicitly while lexical exact identifiers still work', { skip: !pool }, async () => {
  const previous = process.env.XENO_EMBEDDING_BASE_URL;
  process.env.XENO_EMBEDDING_BASE_URL = 'http://127.0.0.1:1';
  try {
    const result = await retrieveAuthorizedAssetChunks(pool, {
      principal: userPrincipal(ownerId), projectId: project.id, query: 'ORBIT-7429', limit: 12,
    });
    assert.equal(result.diagnostic.semantic_status, 'degraded_lexical_only');
    assert.equal(result.diagnostic.semantic_error_code, 'embedding_runtime_unavailable');
    assert.equal(result.chunks[0].asset_id, exactAsset.id);
    assert.match(result.chunks[0].content, /ORBIT-7429/);
  } finally {
    process.env.XENO_EMBEDDING_BASE_URL = previous;
  }
});

test('removing the asset parent tuple excludes already indexed chunks immediately', { skip: !pool }, async () => {
  await pool.query(
    `DELETE FROM relationship_tuples
     WHERE object_type='library_asset' AND object_id=$1 AND relation='parent'
       AND subject_type='project' AND subject_id=$2`,
    [targetAsset.id, project.id],
  );
  const result = await retrieveAuthorizedAssetChunks(pool, {
    principal: userPrincipal(ownerId), projectId: project.id, query: 'Eiffel Tower Paris', limit: 12,
  });
  assert.equal(result.chunks.some((chunk) => chunk.asset_id === targetAsset.id), false);
});

test('locked model/index contract is present in the qualified database', { skip: !pool }, async () => {
  const { rows } = await pool.query(
    `SELECT model_id,revision,dimensions,normalization,pooling,pgvector_version,
            hnsw_iterative_scan,hnsw_ef_search,hnsw_max_scan_tuples,minimum_recall_at_12
     FROM chat_embedding_contracts WHERE active=TRUE`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].model_id, CHAT_PROJECT_CONTRACTS.retrieval.embeddingModelId);
  assert.equal(rows[0].revision, CHAT_PROJECT_CONTRACTS.retrieval.embeddingRevision);
  assert.equal(rows[0].dimensions, CHAT_PROJECT_CONTRACTS.retrieval.embeddingDimensions);
  assert.equal(rows[0].pgvector_version, CHAT_PROJECT_CONTRACTS.retrieval.pgvectorVersion);
  assert.equal(rows[0].minimum_recall_at_12, CHAT_PROJECT_CONTRACTS.retrieval.hnsw.minimumRecallAt12);
});

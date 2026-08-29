import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import pg from 'pg';

import { CHAT_PROJECT_CONTRACTS } from '../src/server/config/chatProjectContracts.js';
import { createAuthorizedProject, linkAssetToProject, userPrincipal } from '../src/server/services/chatProjectAuthority.js';
import { registerManagedLibraryFile } from '../src/server/services/libraryAssets.js';

const connectionString = process.env.TEST_DATABASE_URL;
const pool = connectionString ? new pg.Pool({ connectionString, max: 4 }) : null;
const ROWS_PER_PROJECT = 50_000;
const TOTAL_ROWS = ROWS_PER_PROJECT * 2;
const MODEL_ID = CHAT_PROJECT_CONTRACTS.retrieval.embeddingModelId;
const RECALL_LIMIT = 12;
const QUERY_ROWS = [311, 997, 2_003, 4_099, 7_919, 11_003, 15_013, 19_001, 23_021, 27_011,
  31_019, 35_023, 39_031, 43_009, 47_017, 49_901];

function vectorLiteral(row) {
  const values = [
    Math.sin(row / 997), Math.cos(row / 997),
    Math.sin(row / 313), Math.cos(row / 313),
    Math.sin(row / 89), Math.cos(row / 89),
    Math.sin(row / 37), Math.cos(row / 37),
    ...Array(504).fill(0),
  ];
  return `[${values.join(',')}]`;
}

async function partitionRemainder(client, projectId) {
  const { rows } = await client.query(
    `SELECT remainder
     FROM generate_series(0,63) AS remainder
     WHERE satisfies_hash_partition(
       'chat_project_chunk_embeddings'::regclass, 64, remainder, $1::uuid
     )`,
    [projectId],
  );
  assert.equal(rows.length, 1, 'project must resolve to exactly one hash partition');
  return Number(rows[0].remainder);
}

async function createUser(client, marker, role) {
  return (await client.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'scale-qualification-only',$1,TRUE,NOW()) RETURNING id`,
    [`${marker}-${role}`, `${marker}-${role}@example.test`],
  )).rows[0].id;
}

async function createCollidingProjects(db, client, ownerId, outsiderId, marker) {
  const owner = await createAuthorizedProject(db, {
    principal: userPrincipal(ownerId), name: `${marker} authorized scale`,
  });
  const targetRemainder = await partitionRemainder(client, owner.id);
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const candidate = await createAuthorizedProject(db, {
      principal: userPrincipal(outsiderId), name: `${marker} outsider scale ${attempt}`,
    });
    if (await partitionRemainder(client, candidate.id) === targetRemainder) {
      return { owner, outsider: candidate, remainder: targetRemainder };
    }
  }
  throw new Error('failed to construct a same-partition project adversary');
}

async function createScaleAsset(db, client, { userId, projectId, marker, role, tempDirectory }) {
  const storagePath = path.join(tempDirectory, `${role}.txt`);
  await fs.writeFile(storagePath, `${role} scale qualification seed`, 'utf8');
  const asset = await registerManagedLibraryFile(db, {
    userId,
    filename: `${marker}-${role}.txt`,
    originalName: `${role}-scale-source.txt`,
    mimeType: 'text/plain',
    fileSize: (await fs.stat(storagePath)).size,
    storagePath,
    metadata: { source: 'semantic-scale-qualification' },
  });
  await linkAssetToProject(db, {
    principal: userPrincipal(userId), projectId, assetId: asset.id,
  });
  const ingestion = (await client.query(
    `UPDATE library_asset_ingestions
     SET state='ready', semantic_status='indexing', extractor_id='scale-qualification',
         extractor_version='1', embedding_model_id=$2, embedding_dimensions=512,
         completed_at=NOW(), updated_at=NOW()
     WHERE asset_id=$1 RETURNING id`,
    [asset.id, MODEL_ID],
  )).rows[0];
  return { asset, ingestion };
}

async function insertScaleRows(client, { ingestionId, assetId, offset, lexicalMarker }) {
  await client.query(
    `INSERT INTO library_asset_chunks(
       ingestion_id,asset_id,ordinal,content,token_count,embedding_model_id,source_locator,embedding
     )
     SELECT $1,$2,g-1,
       CASE WHEN g=25000 THEN $5 ELSE 'semantic scale row ' || (g+$3)::text END,
       5,$4,jsonb_build_object('qualification_row',g+$3),
       (ARRAY[
         sin((g+$3)::double precision/997)::real, cos((g+$3)::double precision/997)::real,
         sin((g+$3)::double precision/313)::real, cos((g+$3)::double precision/313)::real,
         sin((g+$3)::double precision/89)::real, cos((g+$3)::double precision/89)::real,
         sin((g+$3)::double precision/37)::real, cos((g+$3)::double precision/37)::real
       ] || array_fill(0::real,ARRAY[504]))::vector
     FROM generate_series(1,$6) AS g`,
    [ingestionId, assetId, offset, MODEL_ID, lexicalMarker, ROWS_PER_PROJECT],
  );
  await client.query(
    `UPDATE library_asset_ingestions
     SET semantic_status='ready', updated_at=NOW() WHERE id=$1`,
    [ingestionId],
  );
}

async function populateProjectIndex(client, projectId, assetId) {
  await client.query(
    `INSERT INTO chat_project_chunk_embeddings(project_id,chunk_id,asset_id,embedding_model_id,embedding)
     SELECT $1,c.id,c.asset_id,c.embedding_model_id,c.embedding
     FROM library_asset_chunks c WHERE c.asset_id=$2
     ON CONFLICT(project_id,chunk_id) DO NOTHING`,
    [projectId, assetId],
  );
}

const nearestSql = `
  SELECT chunk_id,asset_id
  FROM chat_project_chunk_embeddings
  WHERE project_id=$1 AND embedding_model_id=$2
  ORDER BY embedding::vector(512) <=> $3::vector(512)
  LIMIT ${RECALL_LIMIT}`;

async function exactNearest(client, projectId, queryVector) {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL enable_indexscan=off');
    await client.query('SET LOCAL enable_indexonlyscan=off');
    await client.query('SET LOCAL enable_bitmapscan=off');
    return (await client.query(nearestSql, [projectId, MODEL_ID, queryVector])).rows;
  } finally {
    await client.query('ROLLBACK');
  }
}

async function approximateNearest(client, projectId, queryVector) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL hnsw.iterative_scan='strict_order'");
    await client.query('SET LOCAL hnsw.ef_search=400');
    await client.query('SET LOCAL hnsw.max_scan_tuples=100000');
    await client.query('SET LOCAL hnsw.scan_mem_multiplier=4');
    return (await client.query(nearestSql, [projectId, MODEL_ID, queryVector])).rows;
  } finally {
    await client.query('ROLLBACK');
  }
}

function percentile95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function collectPlanNodes(node, result = []) {
  result.push(node);
  for (const child of node.Plans || []) collectPlanNodes(child, result);
  return result;
}

test('100k same-partition HNSW qualification meets recall, latency, pruning, and tenant gates', {
  skip: !pool,
  timeout: 20 * 60 * 1000,
}, async () => {
  const client = await pool.connect();
  const marker = `scale-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const lexicalMarker = `ORBITQUAL${Date.now()}`;
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'xeno-semantic-scale-'));
  try {
    const ownerId = await createUser(client, marker, 'owner');
    const outsiderId = await createUser(client, marker, 'outsider');
    const projects = await createCollidingProjects(pool, client, ownerId, outsiderId, marker);
    const ownerSource = await createScaleAsset(pool, client, {
      userId: ownerId, projectId: projects.owner.id, marker, role: 'authorized', tempDirectory,
    });
    const outsiderSource = await createScaleAsset(pool, client, {
      userId: outsiderId, projectId: projects.outsider.id, marker, role: 'outsider', tempDirectory,
    });

    await insertScaleRows(client, {
      ingestionId: ownerSource.ingestion.id,
      assetId: ownerSource.asset.id,
      offset: 0,
      lexicalMarker,
    });
    await insertScaleRows(client, {
      ingestionId: outsiderSource.ingestion.id,
      assetId: outsiderSource.asset.id,
      offset: ROWS_PER_PROJECT,
      lexicalMarker: `${lexicalMarker}OUTSIDER`,
    });
    await populateProjectIndex(client, projects.owner.id, ownerSource.asset.id);
    await populateProjectIndex(client, projects.outsider.id, outsiderSource.asset.id);
    await client.query('ANALYZE chat_project_chunk_embeddings');

    const population = await client.query(
      `SELECT count(*)::int AS count, count(DISTINCT project_id)::int AS projects,
              count(DISTINCT tableoid)::int AS physical_partitions
       FROM chat_project_chunk_embeddings WHERE project_id=ANY($1::uuid[])`,
      [[projects.owner.id, projects.outsider.id]],
    );
    assert.deepEqual(population.rows[0], {
      count: TOTAL_ROWS, projects: 2, physical_partitions: 1,
    });

    let matches = 0;
    let possible = 0;
    const latencies = [];
    for (const row of QUERY_ROWS) {
      const vector = vectorLiteral(row);
      const exact = await exactNearest(client, projects.owner.id, vector);
      const startedAt = performance.now();
      const approximate = await approximateNearest(client, projects.owner.id, vector);
      latencies.push(performance.now() - startedAt);
      const exactIds = new Set(exact.map((entry) => entry.chunk_id));
      matches += approximate.filter((entry) => exactIds.has(entry.chunk_id)).length;
      possible += exact.length;
      assert.equal(
        approximate.some((entry) => entry.asset_id === outsiderSource.asset.id),
        false,
        'same-partition outsider rows must never enter an authorized result',
      );
    }
    const recallAt12 = matches / possible;
    const p95Ms = percentile95(latencies);
    assert.ok(recallAt12 >= CHAT_PROJECT_CONTRACTS.retrieval.hnsw.minimumRecallAt12,
      `recall@12 ${recallAt12} is below the locked threshold`);
    assert.ok(p95Ms < 750, `HNSW p95 ${p95Ms.toFixed(2)}ms exceeds 750ms`);

    const explain = await client.query(
      `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${nearestSql}`,
      [projects.owner.id, MODEL_ID, vectorLiteral(QUERY_ROWS[0])],
    );
    const plan = explain.rows[0]['QUERY PLAN'][0].Plan;
    const nodes = collectPlanNodes(plan);
    const pceRelations = nodes
      .map((node) => node['Relation Name'])
      .filter((name) => name?.startsWith('chat_project_chunk_embeddings_p'));
    assert.equal(new Set(pceRelations).size, 1, 'the plan must prune to one project partition');
    const indexNode = nodes.find((node) => node['Index Name'] && node['Relation Name']?.startsWith('chat_project_chunk_embeddings_p'));
    assert.ok(indexNode, 'the plan must use a child-partition index scan');
    const index = (await client.query(
      'SELECT indexdef FROM pg_indexes WHERE indexname=$1', [indexNode['Index Name']],
    )).rows[0];
    assert.match(index?.indexdef || '', /USING hnsw/i);
    assert.match(JSON.stringify(plan), new RegExp(projects.owner.id, 'i'),
      'the pruned/indexed plan must retain the concrete project predicate');

    const lexical = await client.query(
      `SELECT content FROM library_asset_chunks
       WHERE asset_id=$1 AND search_vector @@ plainto_tsquery('simple',$2)`,
      [ownerSource.asset.id, lexicalMarker],
    );
    assert.equal(lexical.rowCount, 1);
    assert.match(lexical.rows[0].content, new RegExp(lexicalMarker));

    console.log(JSON.stringify({
      marker,
      rows: TOTAL_ROWS,
      samePartitionRemainder: projects.remainder,
      recallAt12,
      p95Ms,
      measuredQueries: latencies.length,
      partition: pceRelations[0],
      index: indexNode['Index Name'],
      lexicalMarker,
    }));
  } finally {
    client.release();
    await fs.rm(tempDirectory, { recursive: true, force: true });
    await pool.end();
  }
});

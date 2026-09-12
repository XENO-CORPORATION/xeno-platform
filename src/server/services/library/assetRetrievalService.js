import { performance } from 'node:perf_hooks';

import { CHAT_PROJECT_CONTRACTS } from '../../config/chatProjectContracts.js';
import { check } from '../../utils/authzReBAC.js';
import { withTransaction } from '../chatProjectAuthority.js';
import { embedQuery, isSemanticStoreQualified, toPgVector } from './xenoEmbeddingService.js';

const retrieval = CHAT_PROJECT_CONTRACTS.retrieval;

function lexicalExpression(query) {
  return [...new Set(String(query || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])]
    .slice(0, 32)
    .map((term) => `${term}:*`)
    .join(' | ');
}

async function lexicalCandidates(db, projectId, query, limit) {
  const lexicalQuery = lexicalExpression(query);
  if (!lexicalQuery) return [];
  const { rows } = await db.query(
    `SELECT c.id, c.asset_id, c.ordinal, c.content, c.token_count, c.source_locator,
            COALESCE(f.original_name, f.filename, 'Project source') AS display_name,
            f.mime_type,
            ts_rank_cd(c.search_vector, to_tsquery('simple', $2)) AS lexical_score
     FROM chat_project_assets pa
     JOIN relationship_tuples parent
       ON parent.object_type='library_asset' AND parent.object_id=pa.asset_id::text
      AND parent.relation='parent' AND parent.subject_type='project'
      AND parent.subject_id=pa.project_id::text
     JOIN library_asset_ingestions i ON i.asset_id = pa.asset_id AND i.state = 'ready'
     JOIN library_asset_chunks c ON c.ingestion_id = i.id
     JOIN user_files f ON f.id = c.asset_id AND f.deleted_at IS NULL
     WHERE pa.project_id = $1 AND pa.retrieval_enabled = TRUE
       AND c.search_vector @@ to_tsquery('simple', $2)
     ORDER BY lexical_score DESC, c.asset_id, c.ordinal
     LIMIT $3`,
    [projectId, lexicalQuery, limit],
  );
  return rows;
}

async function semanticCandidates(db, projectId, query, limit) {
  if (!await isSemanticStoreQualified(db)) {
    throw Object.assign(new Error('Qualified semantic store is unavailable'), {
      code: 'semantic_store_unavailable',
    });
  }
  const queryVector = await embedQuery(query);
  const vectorLiteral = toPgVector(queryVector);
  return withTransaction(db, async (tx) => {
    await tx.query(`SET LOCAL hnsw.iterative_scan = '${retrieval.hnsw.iterativeScan}'`);
    await tx.query(`SET LOCAL hnsw.ef_search = ${retrieval.hnsw.efSearch}`);
    await tx.query(`SET LOCAL hnsw.max_scan_tuples = ${retrieval.hnsw.maxScanTuples}`);
    await tx.query(`SET LOCAL hnsw.scan_mem_multiplier = ${retrieval.hnsw.scanMemMultiplier}`);
    const { rows } = await tx.query(
      `SELECT c.id, c.asset_id, c.ordinal, c.content, c.token_count, c.source_locator,
              COALESCE(f.original_name, f.filename, 'Project source') AS display_name,
              f.mime_type,
              1 - (c.embedding::vector(512) <=> $2::vector(512)) AS semantic_score
       FROM chat_project_assets pa
       JOIN relationship_tuples parent
         ON parent.object_type='library_asset' AND parent.object_id=pa.asset_id::text
        AND parent.relation='parent' AND parent.subject_type='project'
        AND parent.subject_id=pa.project_id::text
       JOIN chat_project_chunk_embeddings pce ON pce.project_id=pa.project_id
        AND pce.asset_id=pa.asset_id AND pce.embedding_model_id=$3
       JOIN library_asset_chunks c ON c.id=pce.chunk_id AND c.asset_id=pce.asset_id
       JOIN library_asset_ingestions i ON i.id=c.ingestion_id
        AND i.state='ready' AND i.semantic_status='ready'
       JOIN user_files f ON f.id=c.asset_id AND f.deleted_at IS NULL
       WHERE pa.project_id=$1 AND pa.retrieval_enabled=TRUE
       ORDER BY pce.embedding::vector(512) <=> $2::vector(512)
       LIMIT $4`,
      [projectId, vectorLiteral, retrieval.embeddingModelId, limit],
    );
    return rows;
  });
}

function reciprocalRankFuse(lexical, semantic, limit) {
  const fused = new Map();
  const add = (row, channel, rank) => {
    const current = fused.get(row.id) || { ...row, retrieval_channels: [], rrf_score: 0 };
    current.rrf_score += 1 / (retrieval.hnsw.reciprocalRankConstant + rank + 1);
    current.retrieval_channels.push(channel);
    if (row.lexical_score != null) current.lexical_score = Number(row.lexical_score);
    if (row.semantic_score != null) current.semantic_score = Number(row.semantic_score);
    fused.set(row.id, current);
  };
  lexical.forEach((row, rank) => add(row, 'lexical', rank));
  semantic.forEach((row, rank) => add(row, 'semantic', rank));
  return [...fused.values()]
    .sort((left, right) => right.rrf_score - left.rrf_score
      || String(left.asset_id).localeCompare(String(right.asset_id))
      || left.ordinal - right.ordinal)
    .slice(0, limit);
}

function semanticErrorCode(error) {
  const code = String(error?.code || 'semantic_retrieval_failed');
  return /^[a-z0-9_]{1,64}$/i.test(code) ? code : 'semantic_retrieval_failed';
}

export async function retrieveAuthorizedAssetChunks(db, {
  principal,
  projectId,
  query,
  limit = 12,
}) {
  const startedAt = performance.now();
  const boundedLimit = Math.min(Math.max(limit, 1), 50);
  const projectAccess = await check(db, {
    object: `project:${projectId}`,
    relation: 'viewer',
    subject: `${principal.type}:${principal.id}`,
  });
  if (!projectAccess.allowed) return {
    chunks: [],
    diagnostic: { semantic_status: 'not_authorized', total_ms: performance.now() - startedAt },
  };

  const lexicalStartedAt = performance.now();
  const lexical = await lexicalCandidates(db, projectId, query, boundedLimit * 3);
  const lexicalMs = performance.now() - lexicalStartedAt;
  let semantic = [];
  let semanticStatus = 'disabled';
  let semanticCode = null;
  let semanticMs = 0;
  if (retrieval.semanticEnabledByDefault && process.env.CHAT_SEMANTIC_RETRIEVAL !== '0'
      && String(query || '').trim()) {
    const semanticStartedAt = performance.now();
    try {
      semantic = await semanticCandidates(db, projectId, query, boundedLimit * 3);
      semanticStatus = 'ready';
    } catch (error) {
      semanticStatus = 'degraded_lexical_only';
      semanticCode = semanticErrorCode(error);
    }
    semanticMs = performance.now() - semanticStartedAt;
  }

  const fused = reciprocalRankFuse(lexical, semantic, boundedLimit * 2);
  const authorized = [];
  for (const row of fused) {
    const assetAccess = await check(db, {
      object: `library_asset:${row.asset_id}`,
      relation: 'viewer',
      subject: `${principal.type}:${principal.id}`,
    });
    if (assetAccess.allowed) authorized.push(row);
    if (authorized.length >= boundedLimit) break;
  }
  return {
    chunks: authorized,
    diagnostic: {
      semantic_status: semanticStatus,
      semantic_error_code: semanticCode,
      lexical_candidates: lexical.length,
      semantic_candidates: semantic.length,
      fused_candidates: fused.length,
      lexical_ms: lexicalMs,
      semantic_ms: semanticMs,
      total_ms: performance.now() - startedAt,
    },
  };
}

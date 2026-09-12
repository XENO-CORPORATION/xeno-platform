-- UP
-- REQUIRES: pgvector>=0.8.6
-- The image and model/index identity are locked together. This migration stays
-- pending on plain PostgreSQL rather than being falsely recorded as applied.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chat_embedding_contracts (
  model_id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  normalization TEXT NOT NULL,
  pooling TEXT NOT NULL,
  pgvector_version TEXT NOT NULL,
  hnsw_iterative_scan TEXT NOT NULL CHECK (hnsw_iterative_scan IN ('strict_order', 'relaxed_order')),
  hnsw_ef_search INTEGER NOT NULL CHECK (hnsw_ef_search BETWEEN 1 AND 1000),
  hnsw_max_scan_tuples INTEGER NOT NULL CHECK (hnsw_max_scan_tuples > 0),
  hnsw_scan_mem_multiplier INTEGER NOT NULL CHECK (hnsw_scan_mem_multiplier > 0),
  minimum_recall_at_12 DOUBLE PRECISION NOT NULL CHECK (minimum_recall_at_12 BETWEEN 0 AND 1),
  tenant_strategy TEXT NOT NULL,
  tenant_partition_count INTEGER NOT NULL CHECK (tenant_partition_count > 0),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_embedding_contract_active
  ON chat_embedding_contracts(active) WHERE active = TRUE;

UPDATE chat_embedding_contracts SET active = FALSE WHERE active = TRUE;
INSERT INTO chat_embedding_contracts(
  model_id, revision, dimensions, normalization, pooling, pgvector_version,
  hnsw_iterative_scan, hnsw_ef_search, hnsw_max_scan_tuples,
  hnsw_scan_mem_multiplier, minimum_recall_at_12, active
  , tenant_strategy, tenant_partition_count
)
SELECT
  'nomic-ai/nomic-embed-text-v1.5',
  'a15734e81021ea6c92b09050d2c7085001db8f36',
  512,
  'layer_norm_768_then_truncate_512_then_l2',
  'attention_mask_mean',
  extversion,
  'strict_order',
  400,
  100000,
  4,
  0.98,
  TRUE,
  'project_hash_partition_pruning',
  64
FROM pg_extension WHERE extname = 'vector'
ON CONFLICT (model_id) DO UPDATE SET
  revision = EXCLUDED.revision,
  dimensions = EXCLUDED.dimensions,
  normalization = EXCLUDED.normalization,
  pooling = EXCLUDED.pooling,
  pgvector_version = EXCLUDED.pgvector_version,
  hnsw_iterative_scan = EXCLUDED.hnsw_iterative_scan,
  hnsw_ef_search = EXCLUDED.hnsw_ef_search,
  hnsw_max_scan_tuples = EXCLUDED.hnsw_max_scan_tuples,
  hnsw_scan_mem_multiplier = EXCLUDED.hnsw_scan_mem_multiplier,
  minimum_recall_at_12 = EXCLUDED.minimum_recall_at_12,
  tenant_strategy = EXCLUDED.tenant_strategy,
  tenant_partition_count = EXCLUDED.tenant_partition_count,
  active = TRUE,
  updated_at = NOW();

ALTER TABLE library_asset_chunks ADD COLUMN IF NOT EXISTS embedding vector;
ALTER TABLE library_asset_chunks DROP CONSTRAINT IF EXISTS library_asset_chunks_embedding_contract_check;
ALTER TABLE library_asset_chunks ADD CONSTRAINT library_asset_chunks_embedding_contract_check CHECK (
  embedding IS NULL OR (
    embedding_model_id = 'nomic-ai/nomic-embed-text-v1.5'
    AND vector_dims(embedding) = 512
  )
);

CREATE INDEX IF NOT EXISTS idx_library_asset_chunks_nomic_v15_hnsw
  ON library_asset_chunks
  USING hnsw ((embedding::vector(512)) vector_cosine_ops)
  WITH (m = 16, ef_construction = 128)
  WHERE embedding IS NOT NULL
    AND embedding_model_id = 'nomic-ai/nomic-embed-text-v1.5';

-- Retrieval is relation-scoped before HNSW. The canonical vector remains on
-- the Library chunk; this derived project index duplicates only vectors and
-- foreign keys, never content. PostgreSQL prunes 63/64 partitions from the
-- project equality predicate before approximate search.
CREATE TABLE IF NOT EXISTS chat_project_chunk_embeddings (
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES library_asset_chunks(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
  embedding_model_id TEXT NOT NULL,
  embedding vector NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(project_id, chunk_id),
  FOREIGN KEY(project_id, asset_id)
    REFERENCES chat_project_assets(project_id, asset_id) ON DELETE CASCADE,
  CHECK (embedding_model_id = 'nomic-ai/nomic-embed-text-v1.5'),
  CHECK (vector_dims(embedding) = 512)
) PARTITION BY HASH(project_id);

DO $$
DECLARE partition_number INTEGER;
BEGIN
  FOR partition_number IN 0..63 LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS chat_project_chunk_embeddings_p%s PARTITION OF chat_project_chunk_embeddings FOR VALUES WITH (MODULUS 64, REMAINDER %s)',
      lpad(partition_number::text, 2, '0'),
      partition_number
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_project_chunk_embeddings_nomic_hnsw
  ON chat_project_chunk_embeddings
  USING hnsw ((embedding::vector(512)) vector_cosine_ops)
  WITH (m = 16, ef_construction = 128)
  WHERE embedding_model_id = 'nomic-ai/nomic-embed-text-v1.5';

INSERT INTO chat_project_chunk_embeddings(project_id,chunk_id,asset_id,embedding_model_id,embedding)
SELECT pa.project_id,c.id,c.asset_id,c.embedding_model_id,c.embedding
FROM library_asset_chunks c
JOIN chat_project_assets pa ON pa.asset_id=c.asset_id AND pa.retrieval_enabled=TRUE
WHERE c.embedding IS NOT NULL AND c.embedding_model_id='nomic-ai/nomic-embed-text-v1.5'
ON CONFLICT(project_id,chunk_id) DO UPDATE SET
  embedding=EXCLUDED.embedding,
  embedding_model_id=EXCLUDED.embedding_model_id,
  updated_at=NOW();

-- DOWN
DROP INDEX IF EXISTS idx_library_asset_chunks_nomic_v15_hnsw;
DROP TABLE IF EXISTS chat_project_chunk_embeddings;
ALTER TABLE library_asset_chunks DROP CONSTRAINT IF EXISTS library_asset_chunks_embedding_contract_check;
ALTER TABLE library_asset_chunks DROP COLUMN IF EXISTS embedding;
DROP TABLE IF EXISTS chat_embedding_contracts;

-- UP
-- Preserve and remove only exact duplicate authority/identity rows that can
-- exist when a formerly incomplete restore left a valid-looking unique index
-- without entries for every heap tuple.  The removed physical rows remain
-- fully recoverable and auditable in chat_data_repair_archive.
CREATE TABLE IF NOT EXISTS chat_data_repair_archive (
  repair_key TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_row_id UUID NOT NULL,
  row_data JSONB NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (repair_key, source_table, source_row_id)
);

WITH ranked AS (
  SELECT r.*,
         ROW_NUMBER() OVER (
           PARTITION BY object_type, object_id, relation, subject_type, subject_id
           ORDER BY created_at, id
         ) AS duplicate_rank
  FROM relationship_tuples r
), archived AS (
  INSERT INTO chat_data_repair_archive(repair_key, source_table, source_row_id, row_data)
  SELECT '20260829-unique-index-drift', 'relationship_tuples', id, TO_JSONB(ranked) - 'duplicate_rank'
  FROM ranked
  WHERE duplicate_rank > 1
  ON CONFLICT (repair_key, source_table, source_row_id) DO NOTHING
  RETURNING source_row_id
)
DELETE FROM relationship_tuples target
USING archived
WHERE target.id = archived.source_row_id;

WITH ranked AS (
  SELECT e.*,
         ROW_NUMBER() OVER (
           PARTITION BY source_system, platform_user_id
           ORDER BY created_at, id
         ) AS duplicate_rank
  FROM external_identity_links e
), archived AS (
  INSERT INTO chat_data_repair_archive(repair_key, source_table, source_row_id, row_data)
  SELECT '20260829-unique-index-drift', 'external_identity_links', id, TO_JSONB(ranked) - 'duplicate_rank'
  FROM ranked
  WHERE duplicate_rank > 1
  ON CONFLICT (repair_key, source_table, source_row_id) DO NOTHING
  RETURNING source_row_id
)
DELETE FROM external_identity_links target
USING archived
WHERE target.id = archived.source_row_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'relationship_tuples_object_type_object_id_relation_subject__key'
      AND conrelid = 'relationship_tuples'::regclass
  ) THEN
    REINDEX INDEX relationship_tuples_object_type_object_id_relation_subject__key;
  ELSE
    ALTER TABLE relationship_tuples
      ADD CONSTRAINT relationship_tuples_object_type_object_id_relation_subject__key
      UNIQUE (object_type, object_id, relation, subject_type, subject_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_eil_source_platform
  ON external_identity_links(source_system, platform_user_id);
REINDEX INDEX uq_eil_source_platform;

COMMENT ON TABLE chat_data_repair_archive IS
  'Recoverable row-level evidence for narrowly-scoped production data repairs.';

-- UP
-- Notebooks in XENO Chat (xeno-corpus docs/specs/2026-11-27-notebooks-in-chat.md §3.1, agreed with XENO - CORPUS).
-- A Chat project's corpus row (corpus_corpora, scope_kind 'project') IS its notebook. Its sources are:
--   files       chat_project_assets (retrieval_enabled = "use in answers") + each file's latest ingestion. NOT here
--               (agreed point A: two tables naming the same file is how they drift).
--   web, note,  this table: the kinds the platform did not have.
--   local_corpus
-- A web page or note is read into a library snapshot (snapshot_asset_id → user_files) and ingested like any asset, so
-- its passages are library_asset_chunks too (§3.1: "Passages reuse library_asset_chunks. No second chunk table.").
-- A local corpus is read over the relay at question time (services/corpusLocalMcp.js) and has no snapshot.
-- Additive: one new table.
CREATE TABLE IF NOT EXISTS corpus_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corpus_id uuid NOT NULL REFERENCES corpus_corpora(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('web', 'note', 'local_corpus')),
  url text CHECK (url IS NULL OR (char_length(url) <= 2048 AND url ~ '^https?://')),
  local_binding_id uuid REFERENCES browser_installations(id) ON DELETE SET NULL,
  local_project_id text CHECK (local_project_id IS NULL OR char_length(local_project_id) BETWEEN 1 AND 200),
  snapshot_asset_id uuid REFERENCES user_files(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  selected boolean NOT NULL DEFAULT true,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'indexed', 'stale', 'failed')),
  state_reason text CHECK (state_reason IS NULL OR char_length(state_reason) <= 500),
  content_sha256 text CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$'),
  extractor_version text CHECK (extractor_version IS NULL OR char_length(extractor_version) <= 80),
  indexed_at timestamptz,
  added_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- what each kind must name: a web page its address, a local corpus the PC and the project on it
  CONSTRAINT corpus_sources_kind_shape CHECK (
    (kind = 'web' AND url IS NOT NULL AND local_binding_id IS NULL AND local_project_id IS NULL)
    OR (kind = 'note' AND url IS NULL AND local_binding_id IS NULL AND local_project_id IS NULL)
    OR (kind = 'local_corpus' AND url IS NULL AND local_project_id IS NOT NULL AND snapshot_asset_id IS NULL)),
  -- "nothing could be read" is never "no results" (D22): a failed source always says why
  CONSTRAINT corpus_sources_failed_has_reason CHECK (state <> 'failed' OR state_reason IS NOT NULL),
  CONSTRAINT corpus_sources_indexed_when CHECK (state <> 'indexed' OR indexed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS corpus_sources_corpus ON corpus_sources (corpus_id, created_at);
-- the same page twice in one notebook is one source
CREATE UNIQUE INDEX IF NOT EXISTS corpus_sources_web_once ON corpus_sources (corpus_id, url) WHERE kind = 'web';
CREATE UNIQUE INDEX IF NOT EXISTS corpus_sources_local_once ON corpus_sources (corpus_id, local_binding_id, local_project_id) WHERE kind = 'local_corpus';
-- DOWN
DROP TABLE IF EXISTS corpus_sources;

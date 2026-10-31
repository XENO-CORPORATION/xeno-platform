-- XENO Research on the platform (xeno-research/SPEC.md §8 item 4; services/xenoResearch.js).
--
-- A NOTEBOOK is an .ipynb that belongs to a project (the project's ReBAC relation is its access; no second store),
-- with its environment LOCK (pip format, hashes, the Box image in its header). A RUN executes that notebook in
-- XENO Box and keeps what it produced: the provenance record, its Ed25519 signature, and -- for a re-run -- the
-- verdict against the run it re-checked (reproduced | changed | not-reproduced). Claims are NOT stored here:
-- a claimed cell is a project-scoped tenet in XENO Corpus (corpus_tenets), found by its provenance.
--
-- Ids are prefixed ("nb_", "rr_") so an address can tell a research run from a workforce run without a lookup:
-- /workspace/projects/<pid>/runs/rr_... is a research run, /workspace/projects/<pid>/runs/<uuid> is an admission.
-- Additive only. The DOWN path drops exactly these two tables and their function.

CREATE TABLE IF NOT EXISTS research_notebooks (
  id TEXT PRIMARY KEY DEFAULT ('nb_' || replace(gen_random_uuid()::text, '-', '')),
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  notebook JSONB NOT NULL,
  notebook_sha256 TEXT NOT NULL CHECK (notebook_sha256 ~ '^[0-9a-f]{64}$'),
  lock_text TEXT,
  locked_at TIMESTAMPTZ,
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT research_notebook_id_shape CHECK (id ~ '^nb_[0-9a-f]{32}$'),
  CONSTRAINT research_notebook_size CHECK (pg_column_size(notebook) < 8388608)
);
CREATE INDEX IF NOT EXISTS research_notebooks_project ON research_notebooks (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY DEFAULT ('rr_' || replace(gen_random_uuid()::text, '-', '')),
  notebook_id TEXT NOT NULL REFERENCES research_notebooks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('lock', 'run', 'verify')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'refused')),
  reason_code TEXT,
  reason TEXT,
  verify_of_run_id TEXT REFERENCES research_runs(id) ON DELETE SET NULL,
  notebook_sha256 TEXT NOT NULL,
  provenance JSONB,
  signature JSONB,
  output_notebook JSONB,
  verdict TEXT CHECK (verdict IN ('reproduced', 'changed', 'not-reproduced')),
  comparison JSONB,
  -- a re-check of a claim: { tenetId, cell, expect, admissionId, actorId }; its verdict is recorded in Corpus
  recheck JSONB,
  requested_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  CONSTRAINT research_run_id_shape CHECK (id ~ '^rr_[0-9a-f]{32}$'),
  -- a finished run carries its record and its signature; a refused or failed one says why; a verdict needs a verify
  CONSTRAINT research_run_done_is_signed CHECK (status <> 'done' OR kind = 'lock' OR (provenance IS NOT NULL AND signature IS NOT NULL)),
  CONSTRAINT research_run_refusal_has_reason CHECK (status NOT IN ('refused', 'failed') OR (reason_code IS NOT NULL AND reason IS NOT NULL)),
  CONSTRAINT research_run_verdict_is_verify CHECK (verdict IS NULL OR (kind = 'verify' AND verify_of_run_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS research_runs_project ON research_runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_runs_notebook ON research_runs (notebook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_runs_open ON research_runs (status, created_at) WHERE status IN ('queued', 'running');

-- A run belongs to its notebook's project and workspace -- never another one's. Its record is immutable once done.
CREATE OR REPLACE FUNCTION research_runs_guard() RETURNS trigger AS $$
DECLARE nb RECORD;
BEGIN
  SELECT project_id, workspace_id INTO nb FROM research_notebooks WHERE id = NEW.notebook_id;
  IF nb.project_id IS DISTINCT FROM NEW.project_id OR nb.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'research_run_wrong_scope' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('done', 'failed', 'refused') THEN
    RAISE EXCEPTION 'research_run_finished' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS research_runs_guard ON research_runs;
CREATE TRIGGER research_runs_guard BEFORE INSERT OR UPDATE ON research_runs FOR EACH ROW EXECUTE FUNCTION research_runs_guard();

-- DOWN
DROP TABLE IF EXISTS research_runs;
DROP FUNCTION IF EXISTS research_runs_guard();
DROP TABLE IF EXISTS research_notebooks;

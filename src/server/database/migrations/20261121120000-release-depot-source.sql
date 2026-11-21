-- UP
-- Every release record says which XENO Depot revision it was built from (xeno-depot decision 0001 §7: "Index records
-- the Depot rev each release came from"). ADDITIVE ONLY: two nullable columns on the two tables that describe what
-- shipped, both-or-neither, so every existing row, writer and reader is unchanged. A row without a source is a release
-- built from git (GitHub) as before; NULL never means "unknown Depot revision".
ALTER TABLE release_deploys ADD COLUMN IF NOT EXISTS source_depot_repo_id TEXT;
ALTER TABLE release_deploys ADD COLUMN IF NOT EXISTS source_rev TEXT;
ALTER TABLE release_changes ADD COLUMN IF NOT EXISTS source_depot_repo_id TEXT;
ALTER TABLE release_changes ADD COLUMN IF NOT EXISTS source_rev TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'release_deploys_source_pair') THEN
    ALTER TABLE release_deploys ADD CONSTRAINT release_deploys_source_pair
      CHECK ((source_depot_repo_id IS NULL) = (source_rev IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'release_changes_source_pair') THEN
    ALTER TABLE release_changes ADD CONSTRAINT release_changes_source_pair
      CHECK ((source_depot_repo_id IS NULL) = (source_rev IS NULL));
  END IF;
END $$;

-- "Which releases came from this revision?" — the question Runner, Audit and the review screen ask.
CREATE INDEX IF NOT EXISTS idx_release_deploys_source ON release_deploys(source_depot_repo_id, source_rev) WHERE source_rev IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_release_changes_source ON release_changes(source_depot_repo_id, source_rev) WHERE source_rev IS NOT NULL;

-- DOWN
-- Refused once any row carries a source: dropping the columns would erase which revision a release came from.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM release_deploys WHERE source_rev IS NOT NULL)
     OR EXISTS (SELECT 1 FROM release_changes WHERE source_rev IS NOT NULL) THEN
    RAISE EXCEPTION 'release-depot-source rollback refused: rows carry a Depot source, and dropping it loses provenance' USING ERRCODE = '23514';
  END IF;
  DROP INDEX IF EXISTS idx_release_changes_source;
  DROP INDEX IF EXISTS idx_release_deploys_source;
  ALTER TABLE release_changes DROP CONSTRAINT IF EXISTS release_changes_source_pair;
  ALTER TABLE release_deploys DROP CONSTRAINT IF EXISTS release_deploys_source_pair;
  ALTER TABLE release_changes DROP COLUMN IF EXISTS source_rev;
  ALTER TABLE release_changes DROP COLUMN IF EXISTS source_depot_repo_id;
  ALTER TABLE release_deploys DROP COLUMN IF EXISTS source_rev;
  ALTER TABLE release_deploys DROP COLUMN IF EXISTS source_depot_repo_id;
END $$;

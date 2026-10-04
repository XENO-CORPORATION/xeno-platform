-- UP
-- VIEW-05: scope-bound query keys carry a revision. Every scoped read names
-- its (scope, key); every scoped write bumps the scope revision. A response
-- carrying an older revision than the scope's current one is stale -- even
-- when the content compares equal (the A->B->A fence). Monotonicity is
-- schema-pinned: revisions only advance via bump (no decrement path exists).
CREATE TABLE IF NOT EXISTS scoped_read_revisions (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM scoped_read_revisions WHERE revision <> 0) THEN
    RAISE EXCEPTION 'scoped read rollback refused: revisions advanced' USING ERRCODE='23514';
  END IF;
  DROP TABLE scoped_read_revisions;
END $$;

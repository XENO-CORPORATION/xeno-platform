-- UP
-- The platform's own release record (owner, 2026-10-20). Three layers, one record:
--   1. release_deploys   — every deploy of the platform: time, sha, previous sha, PRs and migrations included, who,
--                          healthcheck, rollback point. Written by scripts/deploy-platform.mjs on the box, never by hand.
--   2. release_features  — each feature: status, where it is enabled, its changes (PRs, releases, tags, commits), proof.
--   3. release_notes     — plain-language "what's new" per feature; drafted by anyone on staff (agents included),
--                          APPROVED only by a human on staff, shown to a customer only for a feature enabled for them.
-- Nothing here is public. PR/code/spec links are staff fields: the customer read path never selects them.

CREATE TABLE IF NOT EXISTS release_features (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9._:-]{0,119}$'),
  title           TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  repo            TEXT NOT NULL,
  area            TEXT,
  status          TEXT NOT NULL DEFAULT 'built' CHECK (status IN ('built', 'live', 'retired')),
  -- who sees it: none (nobody — the default, so an unreleased feature is invisible), all, plans, workspaces
  enabled_scope   TEXT NOT NULL DEFAULT 'none' CHECK (enabled_scope IN ('none', 'all', 'plans', 'workspaces')),
  enabled_plans   TEXT[] NOT NULL DEFAULT '{}',
  spec_ref        TEXT,                     -- staff only: the requirement or spec it implements
  test_proof      TEXT,                     -- staff only: the command or test that proves it
  provenance      TEXT NOT NULL DEFAULT 'recorded' CHECK (provenance IN ('recorded', 'derived')),
  evidence        TEXT,                     -- for a derived row: how it was derived
  first_change_at TIMESTAMPTZ,
  last_change_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (enabled_scope <> 'plans' OR cardinality(enabled_plans) > 0)
);
CREATE INDEX IF NOT EXISTS idx_release_features_repo ON release_features(repo, last_change_at DESC);

CREATE TABLE IF NOT EXISTS release_feature_workspaces (
  feature_id   UUID NOT NULL REFERENCES release_features(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (feature_id, workspace_id)
);

-- A change is one thing that happened in a repo: a merged PR, a published release, a tag, or a direct commit to
-- the default branch (history before PRs). Its natural key makes every import idempotent.
CREATE TABLE IF NOT EXISTS release_changes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('pr', 'release', 'tag', 'commit')),
  external_id  TEXT NOT NULL,              -- PR number, tag name, commit sha
  title        TEXT NOT NULL DEFAULT '',
  url          TEXT,
  author       TEXT,
  sha          TEXT,
  at           TIMESTAMPTZ,                -- merged / published / committed; NULL when the source carries no date
  labels       TEXT[] NOT NULL DEFAULT '{}',
  feature_id   UUID REFERENCES release_features(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo, kind, external_id)
);
CREATE INDEX IF NOT EXISTS idx_release_changes_feature ON release_changes(feature_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_release_changes_repo ON release_changes(repo, at DESC);

CREATE TABLE IF NOT EXISTS release_deploys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  natural_key    TEXT NOT NULL UNIQUE,     -- service|sha|started_at — the same deploy recorded twice is one row
  repo           TEXT NOT NULL DEFAULT 'xeno-platform',
  service        TEXT NOT NULL,
  sha            TEXT NOT NULL,
  previous_sha   TEXT,
  mode           TEXT NOT NULL CHECK (mode IN ('swap', 'build-only', 'rollback')),
  status         TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'interrupted')),
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  deployed_by    TEXT,                     -- the git identity that ran the deploy; NULL when the source never recorded it
  healthcheck    TEXT,
  rollback_point TEXT,                     -- the image the box would roll back to
  prs            INTEGER[] NOT NULL DEFAULT '{}',
  migrations     TEXT[] NOT NULL DEFAULT '{}',
  provenance     TEXT NOT NULL CHECK (provenance IN ('recorded', 'reconstructed')),
  evidence       TEXT,                     -- for a reconstructed row: where it came from
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (provenance = 'recorded' OR evidence IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_release_deploys_time ON release_deploys(started_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS release_notes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id       UUID NOT NULL REFERENCES release_features(id) ON DELETE CASCADE,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  body             TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  state            TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'approved', 'withdrawn')),
  drafted_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  drafted_by_kind  TEXT NOT NULL CHECK (drafted_by_kind IN ('human', 'agent')),
  approved_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (state <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_release_notes_feature ON release_notes(feature_id, state);

-- A customer sees a note only after a HUMAN on staff approved it. The service checks; the database holds it too, so
-- no path (an agent tool, a script, a hand-written UPDATE) can approve as an agent or as a non-staff person.
CREATE OR REPLACE FUNCTION release_note_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'approved' AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM 'approved' OR OLD.approved_by IS DISTINCT FROM NEW.approved_by) THEN
    IF EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.approved_by)
       OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.approved_by AND role IN ('admin', 'moderator') AND COALESCE(is_active, TRUE)) THEN
      RAISE EXCEPTION 'release notes: only a human on XENO staff may approve a note' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS release_note_approval_guard ON release_notes;
CREATE TRIGGER release_note_approval_guard BEFORE INSERT OR UPDATE ON release_notes FOR EACH ROW EXECUTE FUNCTION release_note_approval_guard();

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM release_deploys) OR EXISTS (SELECT 1 FROM release_notes) THEN
    RAISE EXCEPTION 'release-record rollback refused: deploys or notes exist, and dropping them loses the release history' USING ERRCODE = '23514';
  END IF;
  DROP TABLE IF EXISTS release_notes;
  DROP FUNCTION IF EXISTS release_note_approval_guard();
  DROP TABLE IF EXISTS release_deploys;
  DROP TABLE IF EXISTS release_changes;
  DROP TABLE IF EXISTS release_feature_workspaces;
  DROP TABLE IF EXISTS release_features;
END $$;

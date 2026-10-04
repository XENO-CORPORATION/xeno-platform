-- UP
-- FORGE-01: host-neutral repository bindings plus a neutral change
-- store (branches, change requests, reviews, checks) that reference
-- providers exercise. Capabilities decide which operations each
-- provider permits; the store itself is neutral ground.
CREATE TABLE IF NOT EXISTS forge_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 80),
  remote_id TEXT NOT NULL CHECK (length(btrim(remote_id)) BETWEEN 1 AND 512),
  installation_ref TEXT NULL CHECK (installation_ref IS NULL OR length(installation_ref) BETWEEN 1 AND 512),
  refs JSONB NOT NULL DEFAULT '{}'::jsonb,
  access_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  forked_from_binding_id UUID NULL REFERENCES forge_bindings(id) ON DELETE SET NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, remote_id)
);
CREATE INDEX IF NOT EXISTS idx_forge_bindings_project ON forge_bindings(project_id);
CREATE TABLE IF NOT EXISTS forge_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id UUID NOT NULL REFERENCES forge_bindings(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  head_rev TEXT NOT NULL CHECK (length(btrim(head_rev)) BETWEEN 1 AND 512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (binding_id, name)
);
CREATE TABLE IF NOT EXISTS forge_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id UUID NOT NULL REFERENCES forge_bindings(id) ON DELETE CASCADE,
  source_branch TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'merged', 'closed')),
  head_rev TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forge_crs_binding ON forge_change_requests(binding_id, status);
CREATE TABLE IF NOT EXISTS forge_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cr_id UUID NOT NULL REFERENCES forge_change_requests(id) ON DELETE CASCADE,
  reviewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'request_changes', 'reject')),
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS forge_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cr_id UUID NOT NULL REFERENCES forge_change_requests(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'pending')),
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM forge_bindings) THEN
    RAISE EXCEPTION 'forge rollback refused: bindings exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE forge_checks;
  DROP TABLE forge_reviews;
  DROP TABLE forge_change_requests;
  DROP TABLE forge_branches;
  DROP TABLE forge_bindings;
END $$;

-- UP
-- XENO Assets (Studio › Libraries, services/brandKits.js): a workspace's brand kits. ADDITIVE ONLY: three new tables, a
-- function and triggers. DOWN drops exactly them.
--
-- A kit has one DRAFT (its items) and any number of published VERSIONS, each an immutable snapshot with a digest, so an app
-- or an agent can pin one and know it will never change under it. Publishing is a person's act: agents may propose items
-- and never publish (held by the service and by the trigger below). A token's value is the shape XENO Canvas already uses
-- (engine/document/types.ts TokenValue), with an alias naming a path. A logo points at a file in the workspace's Library;
-- its bytes are never stored here.
CREATE TABLE IF NOT EXISTS brand_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  voice text NOT NULL DEFAULT '' CHECK (length(voice) <= 8000),
  modes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(modes) = 'array'),
  agent_drafted boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS brand_kits_ws ON brand_kits (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS brand_kit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id uuid NOT NULL REFERENCES brand_kits(id) ON DELETE CASCADE,
  path text NOT NULL CHECK (length(path) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('color', 'number', 'string', 'shadow', 'typography', 'alias', 'logo')),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  values_by_mode jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(values_by_mode) = 'object'),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  agent_drafted boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kit_id, path)
);

CREATE TABLE IF NOT EXISTS brand_kit_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id uuid NOT NULL REFERENCES brand_kits(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kit_id, version)
);

-- publishing is a person's act, and a published version never changes
CREATE OR REPLACE FUNCTION brand_kit_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.published_by IS NULL OR EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.published_by) THEN
      RAISE EXCEPTION 'brand kits: only a person can publish a version' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- a person deleted later only loses their name on it; the content stays as it was
  IF NEW.kit_id = OLD.kit_id AND NEW.version = OLD.version AND NEW.snapshot = OLD.snapshot AND NEW.digest = OLD.digest AND NEW.note = OLD.note AND NEW.published_at = OLD.published_at AND NEW.published_by IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'brand kits: a published version never changes' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brand_kit_version_guard ON brand_kit_versions;
CREATE TRIGGER brand_kit_version_guard BEFORE INSERT OR UPDATE ON brand_kit_versions
  FOR EACH ROW EXECUTE FUNCTION brand_kit_version_guard();

-- DOWN
DROP TRIGGER IF EXISTS brand_kit_version_guard ON brand_kit_versions;
DROP FUNCTION IF EXISTS brand_kit_version_guard();
DROP TABLE IF EXISTS brand_kit_versions;
DROP TABLE IF EXISTS brand_kit_items;
DROP INDEX IF EXISTS brand_kits_ws;
DROP TABLE IF EXISTS brand_kits;

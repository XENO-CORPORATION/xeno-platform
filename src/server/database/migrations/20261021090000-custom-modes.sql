-- UP
-- XENO MODES - SPEC.md §8 + §8c (decisions D-CM1..D-CM7 DECIDED by the owner 2026-10-20: "yes to all").
--
-- 1. `custom_modes` — a custom mode is a MANIFEST (name + products) that a person or a workspace owns. It replaces the
--    prototype's localStorage (prototypes/xeno-workspace/custom-modes.js). Exactly one owner. A mode written by a trade
--    pack carries the receipt that wrote it (`source_application_id`) so Undo can find it; `edited_at` is set the
--    moment a PERSON changes it, and an edited mode is kept on revert (never delete authored work).
-- 2. Marketplace listing kind `mode` (D-CM1): a trade pack. Its version carries the pack (`mode_pack`, hashed) and
--    depends on other listings BY VERSION (`marketplace_mode_dependencies`), never by copy. Publishing a `mode`
--    version needs a verified or official developer (D-CM2), a well-formed pack, and every dependency PUBLISHED.
-- 3. `workspace_mode_applications` — the receipt of applying a pack: version, answers, plan hash, every record id it
--    created, who applied it. Append-only; the only change ever allowed is the single revert stamp.
--
-- Additive only. DOWN refuses while any row of the new shape exists.

CREATE TABLE IF NOT EXISTS custom_modes (
  row_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode_id               TEXT NOT NULL CHECK (mode_id ~ '^c-[a-z0-9][a-z0-9-]{0,39}$'),
  owner_user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  owner_workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  products              JSONB NOT NULL CHECK (jsonb_typeof(products) = 'array' AND jsonb_array_length(products) BETWEEN 1 AND 40),
  position              INTEGER NOT NULL DEFAULT 0,
  source_application_id UUID,
  created_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at             TIMESTAMPTZ,
  archived_at           TIMESTAMPTZ,
  CONSTRAINT custom_modes_one_owner CHECK ((owner_user_id IS NULL) <> (owner_workspace_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_modes_user ON custom_modes (owner_user_id, mode_id) WHERE owner_user_id IS NOT NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_modes_workspace ON custom_modes (owner_workspace_id, mode_id) WHERE owner_workspace_id IS NOT NULL AND archived_at IS NULL;

-- D-CM1: a pack is its own listing kind.
ALTER TABLE marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_kind_check;
ALTER TABLE marketplace_listings ADD CONSTRAINT marketplace_listings_kind_check
  CHECK (kind IN ('app-native','app-sandboxed','panel','plugin','mcp','model','mind','swarm','team','mode'));

ALTER TABLE marketplace_listing_versions
  ADD COLUMN IF NOT EXISTS mode_pack JSONB,
  ADD COLUMN IF NOT EXISTS mode_pack_hash TEXT CHECK (mode_pack_hash IS NULL OR mode_pack_hash ~ '^[0-9a-f]{64}$');

-- A pack depends on other listings at an exact version; it never copies them, so updates and revenue share reach
-- each author.
CREATE TABLE IF NOT EXISTS marketplace_mode_dependencies (
  version_id             UUID NOT NULL REFERENCES marketplace_listing_versions(id) ON DELETE CASCADE,
  depends_on_listing_id  UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE RESTRICT,
  depends_on_version     VARCHAR(40) NOT NULL,
  PRIMARY KEY (version_id, depends_on_listing_id)
);

CREATE OR REPLACE FUNCTION marketplace_mode_pack_valid(p JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p) = 'object' AND p->>'format' = 'xeno-mode-pack' AND p->'schemaVersion' = '1'::jsonb
     AND jsonb_typeof(p->'mode') = 'object' AND jsonb_typeof(p->'mode'->'name') = 'string'
     AND jsonb_typeof(p->'mode'->'products') = 'array' AND jsonb_array_length(p->'mode'->'products') BETWEEN 1 AND 40
     AND (p->'tasks' IS NULL OR (jsonb_typeof(p->'tasks') = 'array' AND jsonb_array_length(p->'tasks') <= 20))
$$;

-- What must be true whoever writes the rows: a published `mode` version is valid, made by a verified/official
-- developer, and depends only on published versions. A published pack is immutable.
CREATE OR REPLACE FUNCTION marketplace_mode_version_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE k TEXT; tier TEXT;
BEGIN
  SELECT l.kind, d.trust_tier INTO k, tier FROM marketplace_listings l LEFT JOIN marketplace_developers d ON d.id = l.developer_id WHERE l.id = NEW.listing_id;
  IF k IS DISTINCT FROM 'mode' THEN
    IF NEW.mode_pack IS NOT NULL THEN RAISE EXCEPTION 'mode_pack only on a mode listing' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL
     AND (NEW.mode_pack IS DISTINCT FROM OLD.mode_pack OR NEW.mode_pack_hash IS DISTINCT FROM OLD.mode_pack_hash) THEN
    RAISE EXCEPTION 'a published mode pack is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.published_at IS NOT NULL THEN
    IF tier IS NULL OR tier NOT IN ('verified','official') THEN
      RAISE EXCEPTION 'a mode pack is published by a verified or official developer (D-CM2)' USING ERRCODE = '23514';
    END IF;
    IF NEW.mode_pack IS NULL OR NEW.mode_pack_hash IS NULL OR NOT marketplace_mode_pack_valid(NEW.mode_pack) THEN
      RAISE EXCEPTION 'a published mode version carries a valid pack' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM marketplace_mode_dependencies md
               WHERE md.version_id = NEW.id AND NOT EXISTS (
                 SELECT 1 FROM marketplace_listing_versions v WHERE v.listing_id = md.depends_on_listing_id
                   AND v.version = md.depends_on_version AND v.published_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'every dependency of a mode pack is a published version' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_mode_version_guard ON marketplace_listing_versions;
CREATE TRIGGER marketplace_mode_version_guard BEFORE INSERT OR UPDATE ON marketplace_listing_versions
  FOR EACH ROW EXECUTE FUNCTION marketplace_mode_version_guard();

CREATE TABLE IF NOT EXISTS workspace_mode_applications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pack_id              TEXT NOT NULL,
  pack_version         TEXT NOT NULL,
  pack_hash            TEXT NOT NULL CHECK (pack_hash ~ '^[0-9a-f]{64}$'),
  listing_version_id   UUID REFERENCES marketplace_listing_versions(id) ON DELETE RESTRICT,
  answers              JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan_hash            TEXT NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key      TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  created_records      JSONB NOT NULL,
  applied_by_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  applied_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverted_at          TIMESTAMPTZ,
  reverted_by_user_id  UUID REFERENCES users(id) ON DELETE RESTRICT,
  revert_report        JSONB,
  UNIQUE (workspace_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_mode_applications_workspace ON workspace_mode_applications (workspace_id, applied_at DESC);

-- Append-only: the receipt never changes, except ONE revert stamp, once. It is never deleted.
CREATE OR REPLACE FUNCTION workspace_mode_application_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'a mode application receipt is retained' USING ERRCODE = '23514'; END IF;
  IF OLD.reverted_at IS NOT NULL OR NEW.reverted_at IS NULL OR NEW.reverted_by_user_id IS NULL
     OR (to_jsonb(NEW) - ARRAY['reverted_at','reverted_by_user_id','revert_report']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['reverted_at','reverted_by_user_id','revert_report']) THEN
    RAISE EXCEPTION 'a mode application receipt is immutable except its single revert' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_mode_application_immutable ON workspace_mode_applications;
CREATE TRIGGER workspace_mode_application_immutable BEFORE UPDATE OR DELETE ON workspace_mode_applications
  FOR EACH ROW EXECUTE FUNCTION workspace_mode_application_immutable();

-- Onboarding (§8c.4 step 1): "What do you do?" is recorded as a column, so it can be counted.
ALTER TABLE user_onboarding ADD COLUMN IF NOT EXISTS trade TEXT CHECK (trade IS NULL OR trade ~ '^[a-z][a-z0-9-]{0,39}$');

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM custom_modes) OR EXISTS (SELECT 1 FROM workspace_mode_applications)
     OR EXISTS (SELECT 1 FROM marketplace_listings WHERE kind = 'mode')
     OR EXISTS (SELECT 1 FROM user_onboarding WHERE trade IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused: custom modes, mode listings, applications or trades exist' USING ERRCODE = '23514';
  END IF;
END $$;
ALTER TABLE user_onboarding DROP COLUMN IF EXISTS trade;
DROP TABLE IF EXISTS workspace_mode_applications;
DROP FUNCTION IF EXISTS workspace_mode_application_immutable();
DROP TRIGGER IF EXISTS marketplace_mode_version_guard ON marketplace_listing_versions;
DROP FUNCTION IF EXISTS marketplace_mode_version_guard();
DROP FUNCTION IF EXISTS marketplace_mode_pack_valid(JSONB);
DROP TABLE IF EXISTS marketplace_mode_dependencies;
ALTER TABLE marketplace_listing_versions DROP COLUMN IF EXISTS mode_pack_hash, DROP COLUMN IF EXISTS mode_pack;
ALTER TABLE marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_kind_check;
ALTER TABLE marketplace_listings ADD CONSTRAINT marketplace_listings_kind_check
  CHECK (kind IN ('app-native','app-sandboxed','panel','plugin','mcp','model','mind','swarm','team'));
DROP TABLE IF EXISTS custom_modes;

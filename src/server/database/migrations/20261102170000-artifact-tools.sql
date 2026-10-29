-- A tool a person makes is a XENO Artifact of kind 'tool' (docs/decisions/2026-10-29-personal-tools-are-artifacts.md).
-- Additive: the kind check widens from ('page') to ('page','tool'); every existing row stays a page. `category` is one
-- of XENO Tools' categories, set only on tools. The undo is the section below; it turns every tool back into a page.
-- UP
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_kind_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_kind_check CHECK (kind IN ('page', 'tool'));
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_category_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_category_check CHECK (
  category IS NULL OR (kind = 'tool' AND category IN ('generator', 'extractor', 'converter', 'ai', 'capture', 'utility'))
);
CREATE INDEX IF NOT EXISTS artifacts_owner_tools_idx ON artifacts (owner_user_id, updated_at DESC) WHERE kind = 'tool' AND deleted_at IS NULL;

-- DOWN
DROP INDEX IF EXISTS artifacts_owner_tools_idx;
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_category_check;
UPDATE artifacts SET kind = 'page' WHERE kind = 'tool';
ALTER TABLE artifacts DROP COLUMN IF EXISTS category;
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_kind_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_kind_check CHECK (kind IN ('page'));

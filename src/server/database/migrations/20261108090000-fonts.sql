-- UP
-- XENO Fonts (Studio › Libraries, services/fonts.js): the fonts a workspace uses. ADDITIVE ONLY: two new tables, a function and a
-- trigger. DOWN drops exactly them.
--
-- The catalogue of open-licence fonts is data (src/server/data/fontCatalogue.json), with its bytes on R2. A workspace adds a family
-- from it, or uploads its own (owner decision 2026-10-31). An upload is a file in the workspace's Library, private to that workspace,
-- with a record of who said they have the rights to it and when. Only a person can say that, so only a person can upload.
CREATE TABLE IF NOT EXISTS workspace_fonts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  family_id text NOT NULL CHECK (family_id ~ '^[a-z0-9-]{1,80}$'),
  agent_added boolean NOT NULL DEFAULT false,
  added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, family_id)
);

CREATE TABLE IF NOT EXISTS font_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_id uuid NOT NULL,   -- user_files.id: the bytes live in the Library, which keeps its own lifecycle
  family text NOT NULL CHECK (length(family) BETWEEN 1 AND 120),
  style text NOT NULL DEFAULT 'Regular' CHECK (length(style) <= 120),
  weight integer NOT NULL DEFAULT 400 CHECK (weight BETWEEN 1 AND 1000),
  italic boolean NOT NULL DEFAULT false,
  format text NOT NULL CHECK (format IN ('woff2', 'woff', 'ttf', 'otf')),
  fs_type integer NOT NULL DEFAULT 0,
  rights_statement text NOT NULL CHECK (length(rights_statement) BETWEEN 1 AND 500),
  rights_confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  rights_confirmed_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  removed_reason text CHECK (removed_reason IS NULL OR length(removed_reason) <= 1000),
  taken_down boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS font_uploads_ws ON font_uploads (workspace_id, family) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS font_uploads_one_file ON font_uploads (workspace_id, file_id);

-- saying you hold the rights to a font is a person's act
CREATE OR REPLACE FUNCTION font_upload_rights_by_a_person() RETURNS trigger AS $$
BEGIN
  IF NEW.rights_confirmed_by IS NULL OR EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.rights_confirmed_by) THEN
    RAISE EXCEPTION 'fonts: only a person can confirm the rights to a font' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS font_upload_rights_by_a_person ON font_uploads;
CREATE TRIGGER font_upload_rights_by_a_person BEFORE INSERT ON font_uploads
  FOR EACH ROW EXECUTE FUNCTION font_upload_rights_by_a_person();

-- DOWN
DROP TRIGGER IF EXISTS font_upload_rights_by_a_person ON font_uploads;
DROP FUNCTION IF EXISTS font_upload_rights_by_a_person();
DROP TABLE IF EXISTS font_uploads;
DROP TABLE IF EXISTS workspace_fonts;

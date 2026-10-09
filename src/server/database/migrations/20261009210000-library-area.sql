-- UP
-- AREA for Library items (see 20261009200000-resource-area.sql for the rule: each area of the workspace has its
-- own library; only Overview shows everything; one home per item).
--
-- The Library lists four stores as one (files, chat artifacts, legacy generations, image assets). Where an item
-- lives is kept here, once, for all four, the same way stars and the trash are (library_item_stars,
-- library_trash), instead of a column on each store.
--
-- A chat artifact with no row here lives where its CONVERSATION lives (read through it, never copied), so a
-- picture or document a Dev chat made is in Dev's library. A row here places an item explicitly and wins.
CREATE TABLE IF NOT EXISTS library_item_areas (
  source     TEXT NOT NULL CHECK (source IN ('file', 'artifact', 'generation', 'image_asset')),
  source_id  UUID NOT NULL,
  area       TEXT NOT NULL CHECK (area ~ '^[a-z][a-z0-9_-]{0,39}$'),
  placed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_library_item_areas_area ON library_item_areas (area);

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM library_item_areas) THEN
    RAISE EXCEPTION 'library-area rollback refused: items have been placed in an area, and dropping the table would lose where they live' USING ERRCODE='23514';
  END IF;
  DROP TABLE library_item_areas;
END $$;

-- UP
-- Library: stars and a trash, for every kind of item the Library lists.
--
-- The Library is a read model over four stores (uploaded files, chat artifacts, legacy image
-- generations, image assets). Neither table below copies an item; each one marks an item that
-- lives in its own store, addressed the way the listing already addresses it: (source, source_id).
--
-- A star is personal: two people in one workspace star different files. So it is keyed by user.
-- The trash is a property of the item: once trashed it is gone from everyone's Library until it is
-- restored or its time runs out. So it is keyed by the item alone.
CREATE TABLE IF NOT EXISTS library_item_stars (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source     TEXT NOT NULL CHECK (source IN ('file', 'artifact', 'generation', 'image_asset')),
  source_id  UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_library_item_stars_item ON library_item_stars (source, source_id);

CREATE TABLE IF NOT EXISTS library_trash (
  source             TEXT NOT NULL CHECK (source IN ('file', 'artifact', 'generation', 'image_asset')),
  source_id          UUID NOT NULL,
  trashed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  trashed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  purge_after        TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (source, source_id),
  CHECK (purge_after > trashed_at)
);
CREATE INDEX IF NOT EXISTS idx_library_trash_purge_after ON library_trash (purge_after);

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM library_trash) THEN
    RAISE EXCEPTION 'library-organise rollback refused: the trash holds items that could no longer be restored' USING ERRCODE='23514';
  END IF;
  DROP TABLE library_trash;
  DROP TABLE library_item_stars;
END $$;

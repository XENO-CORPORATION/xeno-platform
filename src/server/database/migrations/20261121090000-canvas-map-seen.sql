-- UP
-- A project's canvas stays complete: each open adds what's new. This remembers what was already offered, so a card
-- someone took off the map stays off. NULL on a map made before this: its first open adds whatever is missing.
ALTER TABLE canvases ADD COLUMN IF NOT EXISTS map_seen text[];

-- DOWN
ALTER TABLE canvases DROP COLUMN IF EXISTS map_seen;

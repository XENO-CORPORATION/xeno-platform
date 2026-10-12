-- UP
-- A person can mark a generation as a favorite, and remove one from their history.
-- Removal hides the row from that person; the row itself stays, because it is the record of admitted work
-- and of a money commitment (the same reason the table's own DOWN keeps it).
ALTER TABLE media_generations ADD COLUMN IF NOT EXISTS favorite boolean NOT NULL DEFAULT false;
ALTER TABLE media_generations ADD COLUMN IF NOT EXISTS removed_at timestamptz;
CREATE INDEX IF NOT EXISTS media_generations_history ON media_generations(owner_user_id, created_at DESC) WHERE removed_at IS NULL;
-- DOWN
-- Retained deliberately: dropping removed_at would put removed items back in people's histories.

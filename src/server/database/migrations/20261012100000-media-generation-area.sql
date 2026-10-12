-- UP
-- AREA: a generation belongs to the area of the workspace it was made in (Studio, Dev, one the person made),
-- or to none. Each area lists its own; Overview lists them all. Same rule as chats and Library items
-- (20261009200000-resource-area.sql). It is a label on the person's own items, never an authority.
ALTER TABLE media_generations ADD COLUMN IF NOT EXISTS area text;
CREATE INDEX IF NOT EXISTS media_generations_area ON media_generations(owner_user_id, area, created_at DESC) WHERE removed_at IS NULL;
-- DOWN
-- Retained deliberately: dropping it would merge every area's history into one.

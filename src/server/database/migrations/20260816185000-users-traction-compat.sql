-- UP
-- The activation migration immediately after this file grandfathers users from
-- workspace_activated_at. On established databases migrateAccountV2 created the
-- traction column out-of-band, but a fresh versioned migration run reaches the
-- activation migration before migrateAccountV2. Own that dependency here so a
-- fresh database and an upgraded database execute the same chain.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS workspace_activated_at TIMESTAMPTZ;

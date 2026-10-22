-- UP
-- How a personal access code was used (owner, 2026-10-22): 'link' = the code
-- rode a shared link (/?code=...), 'access' = typed at the /access entry,
-- 'form' = typed in the folded Coming-soon form. Recorded per redemption so
-- /workspace/support/access can show where each use came from. Analytics
-- only — redemption rules are unchanged, and rows from before this column
-- simply have no channel.
ALTER TABLE site_access_code_events
  ADD COLUMN IF NOT EXISTS via TEXT CHECK (via IS NULL OR via IN ('link', 'access', 'form'));

-- DOWN
ALTER TABLE site_access_code_events DROP COLUMN IF EXISTS via;

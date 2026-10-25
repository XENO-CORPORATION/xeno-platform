-- UP
-- A code LINK opened by someone the gate already lets in (signed-in staff, or an earlier cookie) never reaches Coming
-- soon, so nothing was redeemed and the usage list showed nothing — owner, 2026-10-25: "even if [they] enter on it,
-- it needs to be recognised". 'opened' records that visit: no use spent, no cookie minted. Additive.
ALTER TABLE site_access_code_events DROP CONSTRAINT IF EXISTS site_access_code_events_event_check;
ALTER TABLE site_access_code_events ADD CONSTRAINT site_access_code_events_event_check
  CHECK (event IN ('created', 'redeemed', 'revoked', 'used_by_account', 'opened'));

-- DOWN
-- The 'opened' rows are analytics only; they cannot survive the narrower check, so they go with it.
DELETE FROM site_access_code_events WHERE event = 'opened';
ALTER TABLE site_access_code_events DROP CONSTRAINT IF EXISTS site_access_code_events_event_check;
ALTER TABLE site_access_code_events ADD CONSTRAINT site_access_code_events_event_check
  CHECK (event IN ('created', 'redeemed', 'revoked', 'used_by_account'));

-- UP
-- D-6 (XENO-WORKFORCE-01 §8.11.1, DECIDED 2026-10-20): the Marketplace SELLER is a WORKSPACE, with an accountable
-- human per listing. D-1 makes the workspace the unit of ownership and billing, so earnings and payouts belong to the
-- seller's workspace and survive the accountable person leaving it (OWN-05); a solo seller's workspace is their
-- personal workspace, so a one-person company and a team sell the same way.
--
-- EXPAND only (parallel change): new nullable columns, backfilled, kept filled by triggers on every insert path.
-- marketplace_developers.user_id stays and now means "the accountable human"; nothing reads it as the owner of
-- record any more where seller_workspace_id is set. The CONTRACT step (NOT NULL, and dropping user_id as an owner
-- key) is a recorded follow-up, taken once every reader prefers the workspace. DOWN is exact.

ALTER TABLE marketplace_developers ADD COLUMN IF NOT EXISTS seller_workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE marketplace_listings   ADD COLUMN IF NOT EXISTS seller_workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE marketplace_listings   ADD COLUMN IF NOT EXISTS accountable_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE marketplace_payouts    ADD COLUMN IF NOT EXISTS seller_workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_mkt_developers_seller_ws ON marketplace_developers(seller_workspace_id);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_seller_ws   ON marketplace_listings(seller_workspace_id);
CREATE INDEX IF NOT EXISTS idx_mkt_payouts_seller_ws    ON marketplace_payouts(seller_workspace_id);

-- backfill: a developer's seller is its person's personal workspace; listings and payouts take their developer's
UPDATE marketplace_developers d SET seller_workspace_id = w.id
  FROM workspaces w WHERE d.seller_workspace_id IS NULL AND w.owner_user_id = d.user_id AND w.workspace_type = 'personal';
UPDATE marketplace_listings l SET seller_workspace_id = d.seller_workspace_id, accountable_user_id = COALESCE(l.accountable_user_id, d.user_id)
  FROM marketplace_developers d WHERE l.developer_id = d.id AND l.seller_workspace_id IS NULL;
UPDATE marketplace_payouts p SET seller_workspace_id = d.seller_workspace_id
  FROM marketplace_developers d WHERE p.developer_id = d.id AND p.seller_workspace_id IS NULL;

-- every insert path fills the seller scope, so a path written before this migration cannot leave it empty
CREATE OR REPLACE FUNCTION marketplace_developer_seller_fill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.seller_workspace_id IS NULL THEN
    SELECT w.id INTO NEW.seller_workspace_id FROM workspaces w WHERE w.owner_user_id = NEW.user_id AND w.workspace_type = 'personal' LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION marketplace_seller_from_developer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.seller_workspace_id IS NULL THEN
    SELECT seller_workspace_id INTO NEW.seller_workspace_id FROM marketplace_developers WHERE id = NEW.developer_id;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION marketplace_listing_accountable_fill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.accountable_user_id IS NULL THEN
    SELECT user_id INTO NEW.accountable_user_id FROM marketplace_developers WHERE id = NEW.developer_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_developer_seller_fill ON marketplace_developers;
CREATE TRIGGER marketplace_developer_seller_fill BEFORE INSERT ON marketplace_developers FOR EACH ROW EXECUTE FUNCTION marketplace_developer_seller_fill();
DROP TRIGGER IF EXISTS marketplace_listing_seller_fill ON marketplace_listings;
CREATE TRIGGER marketplace_listing_seller_fill BEFORE INSERT ON marketplace_listings FOR EACH ROW EXECUTE FUNCTION marketplace_seller_from_developer();
DROP TRIGGER IF EXISTS marketplace_listing_accountable_fill ON marketplace_listings;
CREATE TRIGGER marketplace_listing_accountable_fill BEFORE INSERT ON marketplace_listings FOR EACH ROW EXECUTE FUNCTION marketplace_listing_accountable_fill();
DROP TRIGGER IF EXISTS marketplace_payout_seller_fill ON marketplace_payouts;
CREATE TRIGGER marketplace_payout_seller_fill BEFORE INSERT ON marketplace_payouts FOR EACH ROW EXECUTE FUNCTION marketplace_seller_from_developer();

-- DOWN
DROP TRIGGER IF EXISTS marketplace_payout_seller_fill ON marketplace_payouts;
DROP TRIGGER IF EXISTS marketplace_listing_accountable_fill ON marketplace_listings;
DROP TRIGGER IF EXISTS marketplace_listing_seller_fill ON marketplace_listings;
DROP TRIGGER IF EXISTS marketplace_developer_seller_fill ON marketplace_developers;
DROP FUNCTION IF EXISTS marketplace_listing_accountable_fill();
DROP FUNCTION IF EXISTS marketplace_seller_from_developer();
DROP FUNCTION IF EXISTS marketplace_developer_seller_fill();
DROP INDEX IF EXISTS idx_mkt_payouts_seller_ws;
DROP INDEX IF EXISTS idx_mkt_listings_seller_ws;
DROP INDEX IF EXISTS idx_mkt_developers_seller_ws;
ALTER TABLE marketplace_payouts    DROP COLUMN IF EXISTS seller_workspace_id;
ALTER TABLE marketplace_listings   DROP COLUMN IF EXISTS accountable_user_id;
ALTER TABLE marketplace_listings   DROP COLUMN IF EXISTS seller_workspace_id;
ALTER TABLE marketplace_developers DROP COLUMN IF EXISTS seller_workspace_id;

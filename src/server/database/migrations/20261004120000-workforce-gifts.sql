-- UP
-- Account gifts (ACCT-03/04): a sender-authorized transfer of verified value between two
-- ordinary user accounts. Additive only; no existing table is altered.
--
-- PROVENANCE IS STRUCTURAL: every gift lot names the sender lot it consumed AND the root
-- stripe lot the value descends from, so quarantine/expiry/refund checks that read roots
-- keep working across hops without a recursive walk. A recipient lot is ordinary ledger
-- value (spendable, re-giftable); it is NOT contribution-eligible, because the contribution
-- gate keys on stripe checkout sessions and a gift deliberately breaks that chain (v1).
--
-- credit_grants is created by account-v2 after the versioned chain, so grant references are
-- plain UUIDs here; the deferred lineage trigger below checks their rows at commit time.
CREATE TABLE IF NOT EXISTS workforce_gifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 128),
  operation_id UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  amount_micro BIGINT NOT NULL CHECK (amount_micro > 0),
  state TEXT NOT NULL DEFAULT 'completed' CHECK (state IN ('completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_gifts_no_self CHECK (sender_user_id <> recipient_user_id),
  UNIQUE(sender_user_id, client_id, operation_id)
);
CREATE TABLE IF NOT EXISTS workforce_gift_lots (
  gift_id UUID NOT NULL REFERENCES workforce_gifts(id) ON DELETE RESTRICT,
  origin_grant_id UUID NOT NULL,
  recipient_grant_id UUID NOT NULL,
  root_origin_grant_id UUID NOT NULL,
  amount_micro BIGINT NOT NULL CHECK (amount_micro > 0),
  PRIMARY KEY(gift_id, origin_grant_id, recipient_grant_id)
);
CREATE INDEX IF NOT EXISTS idx_workforce_gift_lots_recipient ON workforce_gift_lots(recipient_grant_id);
CREATE INDEX IF NOT EXISTS idx_workforce_gift_lots_origin ON workforce_gift_lots(origin_grant_id);
CREATE INDEX IF NOT EXISTS idx_workforce_gift_lots_root ON workforce_gift_lots(root_origin_grant_id);
CREATE INDEX IF NOT EXISTS idx_workforce_gifts_recipient ON workforce_gifts(recipient_user_id, created_at DESC);

CREATE FUNCTION workforce_gift_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g record; total numeric; bad integer;
BEGIN
  SELECT * INTO g FROM workforce_gifts WHERE id=NEW.id;
  SELECT coalesce(sum(amount_micro),0) INTO total FROM workforce_gift_lots WHERE gift_id=g.id;
  IF total<>g.amount_micro THEN RAISE EXCEPTION 'gift lot total disagrees with receipt' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO bad FROM workforce_gift_lots l
    LEFT JOIN credit_grants source ON source.id=l.origin_grant_id
    LEFT JOIN credit_grants dest ON dest.id=l.recipient_grant_id
    LEFT JOIN credit_grants root ON root.id=l.root_origin_grant_id
    LEFT JOIN credit_grant_payment_origins o ON o.grant_id=root.id
    LEFT JOIN credit_accounts dacct ON dacct.id=dest.account_id
    WHERE l.gift_id=g.id AND (source.id IS NULL OR dest.id IS NULL OR root.id IS NULL
      OR o.grant_id IS NULL
      OR source.user_id<>g.sender_user_id OR dest.user_id<>g.recipient_user_id
      OR dacct.user_id<>g.recipient_user_id OR dacct.owner_kind<>'user'
      OR dest.kind<>'paid' OR dest.amount_micro<>l.amount_micro
      OR dest.source_ref<>'gift:' || g.id::text || ':' || l.origin_grant_id::text
      OR source.expires_at IS DISTINCT FROM dest.expires_at);
  IF bad<>0 THEN RAISE EXCEPTION 'gift lineage, ownership or expiry mismatch' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER workforce_gift_lineage AFTER INSERT OR UPDATE ON workforce_gifts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce_gift_lineage_guard();
DO $harden$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_gift_lineage_guard() SET search_path = %I, pg_temp',current_schema(),current_schema());
END $harden$;

-- DOWN
-- Never silently discard financial provenance.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_gift_lots)
     OR EXISTS (SELECT 1 FROM workforce_gifts) THEN
    RAISE EXCEPTION 'gift rollback refused: gift history exists' USING ERRCODE='23514';
  END IF;
END $$;
DROP TRIGGER workforce_gift_lineage ON workforce_gifts;
DROP FUNCTION workforce_gift_lineage_guard();
DROP TABLE IF EXISTS workforce_gift_lots;
DROP TABLE IF EXISTS workforce_gifts;

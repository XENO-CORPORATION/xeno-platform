-- UP
-- Gift returns and dispute reversals (ACCT-05): a return is a linked reverse gift over the
-- same rails -- never unlinked money. Additive only.
CREATE TABLE IF NOT EXISTS workforce_gift_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_id UUID NOT NULL REFERENCES workforce_gifts(id) ON DELETE RESTRICT,
  return_gift_id UUID NOT NULL REFERENCES workforce_gifts(id) ON DELETE RESTRICT,
  reversed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('recipient_return','dispute_reversal')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  amount_micro BIGINT NOT NULL CHECK (amount_micro > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(return_gift_id)
);
CREATE INDEX IF NOT EXISTS idx_workforce_gift_returns_gift ON workforce_gift_returns(gift_id);

-- DOWN
-- Never silently discard financial provenance.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_gift_returns) THEN
    RAISE EXCEPTION 'gift-return rollback refused: return history exists' USING ERRCODE='23514';
  END IF;
END $$;
DROP TABLE IF EXISTS workforce_gift_returns;

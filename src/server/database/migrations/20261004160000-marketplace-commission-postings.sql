-- UP
-- FUND-19: exact, partition-independent commission arithmetic. A stable
-- billing item accrues cumulative eligible service micro-credits under one
-- price version; posted commission is ALWAYS floor(cumulative * 15 / 100)
-- and each event posts only the difference from what was posted before, so
-- splitting events cannot change the total. Refunds reverse under the
-- ORIGINAL price version. The floor residue (hundredths of a micro carried
-- forward) is recorded per event: the only rounding in the monetary contract,
-- stored separately from fee and net.
CREATE TABLE marketplace_commission_postings (
  billing_item_key TEXT NOT NULL CHECK (length(btrim(billing_item_key)) BETWEEN 1 AND 200),
  price_version TEXT NOT NULL CHECK (length(btrim(price_version)) BETWEEN 1 AND 128),
  cumulative_gross_micro BIGINT NOT NULL CHECK (cumulative_gross_micro >= 0),
  posted_fee_micro BIGINT NOT NULL CHECK (posted_fee_micro >= 0),
  CHECK (posted_fee_micro = FLOOR(cumulative_gross_micro::numeric * 15 / 100)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (billing_item_key, price_version)
);
CREATE TABLE marketplace_commission_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_item_key TEXT NOT NULL,
  price_version TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('charge','refund')),
  gross_micro BIGINT NOT NULL CHECK (gross_micro > 0),
  fee_delta_micro BIGINT NOT NULL CHECK (fee_delta_micro >= 0),
  creator_delta_micro BIGINT NOT NULL CHECK (creator_delta_micro >= 0),
  cumulative_after_micro BIGINT NOT NULL CHECK (cumulative_after_micro >= 0),
  residue_after SMALLINT NOT NULL CHECK (residue_after >= 0 AND residue_after < 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (billing_item_key, price_version)
    REFERENCES marketplace_commission_postings (billing_item_key, price_version)
    ON DELETE RESTRICT,
  CHECK (gross_micro = fee_delta_micro + creator_delta_micro)
);

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM marketplace_commission_events) THEN
    RAISE EXCEPTION 'commission rollback refused: posted fee events exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP TABLE marketplace_commission_events;
DROP TABLE marketplace_commission_postings;

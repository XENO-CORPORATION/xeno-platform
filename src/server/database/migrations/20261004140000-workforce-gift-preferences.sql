-- UP
-- Gift preferences (ACCT-06): per-account opt-out of unsolicited gifts and dispute pause.
-- Absent row means defaults (accepting, unpaused). Additive only.
CREATE TABLE IF NOT EXISTS workforce_gift_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  accepts_unsolicited BOOLEAN NOT NULL DEFAULT true,
  gifting_paused BOOLEAN NOT NULL DEFAULT false,
  gifting_paused_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DOWN
-- Losing a restriction silently re-enables it: refuse while any account restricts.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_gift_preferences WHERE accepts_unsolicited=false OR gifting_paused=true) THEN
    RAISE EXCEPTION 'gift-preference rollback refused: restrictions exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP TABLE IF EXISTS workforce_gift_preferences;

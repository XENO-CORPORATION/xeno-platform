-- Activation CODES — v2 of the signup gate.
--
-- ── WHY A CODE AND NOT JUST A LINK ─────────────────────────────────────────
--
-- v1 shipped a link that committed on GET. Corporate mail security — Microsoft
-- Defender Safe Links, Proofpoint URL Defense, Mimecast — PRE-FETCHES every URL
-- in an inbound message, and consumer clients prefetch for previews. So a
-- scanner activated the account with no human involved.
--
-- That is not a small bug. The entire premise of this gate is proof of INTENT,
-- and an appliance was manufacturing that proof automatically — silently, so
-- the activation log could not tell a real click from a scan.
--
-- A code cannot be typed by a scanner. It also solves the cross-device case
-- (signed up on a desktop, mail read on a phone) without landing a session on
-- the wrong device, and it keeps the secret out of a URL, where it would
-- otherwise leak through Referer headers, history, screenshots and logs.
--
-- ── WHY THE CODE IS HASHED ─────────────────────────────────────────────────
--
-- Same reason a password is. A dump of this table must not hand anyone a set of
-- working activation codes. Six digits is a small space, so the hash is salted
-- per row by construction (bcrypt) rather than a bare digest, which would be
-- trivially rainbow-tabled at 10^6 candidates.

CREATE TABLE IF NOT EXISTS account_activation_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  -- Counted in the DATABASE, not in memory: an attempt counter that resets on
  -- restart is not a limit, and this process is replicated.
  attempts   INT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The hot path is "the newest live code for this user".
CREATE INDEX IF NOT EXISTS idx_activation_codes_user
  ON account_activation_codes(user_id, created_at DESC);

-- 🔴 AT MOST ONE LIVE CODE PER USER, enforced by the database.
--
-- Two live codes means the old one still works after a resend, which is the
-- whole point of resending — and it doubles the guess surface for free. Doing
-- this in application code alone loses the race between two concurrent
-- resends; a partial unique index cannot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_activation_codes_one_live
  ON account_activation_codes(user_id)
  WHERE consumed_at IS NULL;

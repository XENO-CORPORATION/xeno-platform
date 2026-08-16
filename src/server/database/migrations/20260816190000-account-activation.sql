-- Account activation — proof of INTENT, not proof of address ownership.
--
-- ── WHY A TABLE AND NOT A COLUMN ───────────────────────────────────────────
--
-- Two existing columns look like they would do this job, and both are wrong:
--
--   users.email_verified       — hardcoded TRUE on the OAuth insert
--                                (authRoutes.js, position 7). Every Google
--                                signup is "verified" the instant it is
--                                created, without anything being verified. It
--                                is also FACTUALLY fine — Google really did
--                                confirm the address — so the field is not
--                                lying; it simply answers a different
--                                question than the one being asked.
--
--   users.workspace_activated_at — already a TRACTION METRIC. v2MeRoutes.js
--                                sets it on the first /api/v2/me call from any
--                                product. Gating on it would corrupt the
--                                metric AND auto-satisfy the gate, since the
--                                first product call would activate the account
--                                nobody deliberately activated.
--
-- So this is a relation, following the same rule agent identity follows
-- (xeno-platform/CLAUDE.md): "It is a RELATION table, never a column on
-- `users`." Presence of the row IS the fact. It cannot drift from a flag
-- somebody forgot to set, and `ON DELETE CASCADE` means deleting an account
-- deletes its activation — which is more than can currently be said for
-- api_keys or oauth_refresh_tokens (2026-08-16: a purge left 9 live API keys
-- and 24 valid refresh tokens behind, because 20 tables carry user_id with no
-- foreign key at all).
--
-- ── WHAT IT GATES ──────────────────────────────────────────────────────────
--
-- Not login. You can always sign in, see your own state, and re-request the
-- link. What it gates is the PLATFORM — spending credits, generating, writing.
-- A gate that blocks login turns "confirm your email" into "your account is
-- broken", and support cannot tell the two apart either.

CREATE TABLE IF NOT EXISTS account_activations (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- How it happened, so a support question has an answer and a bulk
  -- grandfather is distinguishable from a real click forever after.
  method       TEXT NOT NULL CHECK (method IN ('email_link', 'grandfathered', 'admin')),
  ip           TEXT
);

CREATE INDEX IF NOT EXISTS idx_account_activations_at ON account_activations(activated_at);

-- ── GRANDFATHER EVERY EXISTING ACCOUNT ─────────────────────────────────────
--
-- Non-negotiable, and it is the step a migration like this usually forgets.
-- Turning on a gate without back-filling locks out every existing user
-- including the admin — and the admin is the one who would have to fix it.
--
-- `method='grandfathered'` keeps them honestly separate from anyone who
-- actually clicked, so the activation rate of NEW signups stays measurable.
INSERT INTO account_activations (user_id, activated_at, method)
SELECT id, COALESCE(workspace_activated_at, created_at, NOW()), 'grandfathered'
  FROM users
ON CONFLICT (user_id) DO NOTHING;

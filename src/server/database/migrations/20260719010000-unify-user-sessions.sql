-- UP
-- Unify user_sessions onto ONE schema (session-backed JWT revocation).
--
-- History: user_sessions had TWO incompatible writer shapes —
--   * authRoutes /init inline CREATE:      token_hash NOT NULL + plaintext session_token
--   * database/migrate-auth-v2.js CREATE:  access_token_hash NOT NULL (+ device columns)
-- so depending on which path created the table, ONE writer always failed (silently,
-- behind try/catch). The unified contract every writer now uses is:
--   id (uuid PK = the JWT's `sid` claim), user_id, token_hash = sha256(jwt),
--   expires_at, ip_address, user_agent, created_at.
-- The plaintext JWT is NEVER stored again (session_token is scrubbed + retired).
--
-- Additive-only: no drops of columns or data. Legacy NOT NULLs are relaxed so no
-- historical shape can hard-fail the unified writer.

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  token_hash VARCHAR(255),
  expires_at TIMESTAMP NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Ensure the unified columns exist on EVERY historical shape.
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS token_hash VARCHAR(255);
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

-- Relax legacy NOT NULL constraints so no old shape can reject the unified writer:
--   * access_token_hash NOT NULL (migrate-auth-v2 shape) broke the password-login writer;
--   * token_hash NOT NULL (/init shape) would break nothing new (we always write it),
--     but is relaxed defensively for symmetry with rows written by the OAuth path.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'user_sessions' AND column_name = 'access_token_hash'
                AND is_nullable = 'NO') THEN
    ALTER TABLE user_sessions ALTER COLUMN access_token_hash DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'user_sessions' AND column_name = 'token_hash'
                AND is_nullable = 'NO') THEN
    ALTER TABLE user_sessions ALTER COLUMN token_hash DROP NOT NULL;
  END IF;
END $$;

-- Scrub any legacy PLAINTEXT JWTs stored by the old writers (bearer credentials at
-- rest). The column is kept (additive-only) but is never written again.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'user_sessions' AND column_name = 'session_token') THEN
    UPDATE user_sessions SET session_token = NULL WHERE session_token IS NOT NULL;
  END IF;
END $$;

-- Lookup paths: resolveAuthedUser hits (id, user_id, expires_at); revocation hits user_id.
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at);

-- DOWN
-- Intentionally a no-op: the UP is additive (columns kept, constraints only relaxed,
-- plaintext scrub is not reversible by design).
SELECT 1;

-- UP
-- ============================================================
-- Inference grants — single-use, 60-second handles. Never the secret.
--
-- Spec §6. The gateway exchanges one of these for one credential, for one
-- request. The row stores the HASH of the grant and the binding; the
-- plaintext secret stays in user_provider_credentials, sealed, and is
-- decrypted only inside useCredential's callback at exchange time.
--
-- 🔴 Do not add a secret column here. A grant that carried the key would
-- just be the key with extra steps.
-- ============================================================

CREATE TABLE IF NOT EXISTS inference_grants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_hash     CHAR(64) NOT NULL UNIQUE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  surface        VARCHAR(64) NOT NULL,
  model          VARCHAR(256) NOT NULL DEFAULT '',
  credential_id  UUID NOT NULL REFERENCES user_provider_credentials(id) ON DELETE CASCADE,
  expires_at     TIMESTAMPTZ NOT NULL,
  spent_at       TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ig_unspent_idx
  ON inference_grants (grant_hash) WHERE spent_at IS NULL;

CREATE INDEX IF NOT EXISTS ig_user_idx
  ON inference_grants (user_id, created_at DESC);

-- DOWN
DROP TABLE IF EXISTS inference_grants;

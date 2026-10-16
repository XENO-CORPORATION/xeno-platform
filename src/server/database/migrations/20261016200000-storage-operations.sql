-- UP
-- XENO Storage: an upload, a new version or a restore can be retried safely (xeno-storage/SPEC.md §7.3, "Restore and
-- retry contract"). A client sends an Idempotency-Key; the FIRST request with it that COMMITS is recorded here with
-- its response, and a later request with the same key and the same binding gets that response back instead of a
-- second write. A request that did not commit records nothing, so the key can be used again for a corrected request.
--
-- The key is never stored: its SHA-256 is (the key is a client secret of sorts — anyone holding it could read the
-- response). `binding_sha256` covers principal, route, target, workspace, expected revision and the fingerprint of
-- the bytes the server actually accepted; a different binding under the same key is a conflict, never a replay.
-- Records are kept 24 hours (storage_operations_sweep), after which the key reads as unknown.
CREATE TABLE IF NOT EXISTS storage_operations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_sha256 text NOT NULL CHECK (key_sha256 ~ '^[0-9a-f]{64}$'),
  route text NOT NULL CHECK (route IN ('upload', 'version', 'restore')),
  binding_sha256 text NOT NULL CHECK (binding_sha256 ~ '^[0-9a-f]{64}$'),
  status smallint NOT NULL CHECK (status BETWEEN 200 AND 299),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key_sha256)
);
CREATE INDEX IF NOT EXISTS storage_operations_age ON storage_operations (created_at);

-- DOWN
DROP TABLE IF EXISTS storage_operations;

-- UP
-- PUB-11: a public conversation is not a public transcript. The
-- default surface is owner-selected updates; full transcript or live
-- publication names an explicit scope and needs every participant's
-- consent to that exact scope. Public artifact links carry their own
-- state plus expiry and purge retention, independent of any
-- conversation publication.
CREATE TABLE IF NOT EXISTS conversation_publications (
  conversation_id UUID PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('updates', 'transcript', 'live_full')),
  state TEXT NOT NULL CHECK (state IN ('published', 'pending', 'revoked')),
  scope JSONB NULL,
  scope_hash TEXT NULL,
  published_by_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (state <> 'pending' OR scope IS NOT NULL),
  CHECK (mode = 'updates' OR state = 'revoked' OR scope IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS conversation_publication_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversation_publications(conversation_id) ON DELETE CASCADE,
  message_id UUID NULL REFERENCES chat_messages(id) ON DELETE SET NULL,
  excerpt TEXT NOT NULL CHECK (length(btrim(excerpt)) BETWEEN 1 AND 8000),
  published_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversation_publication_updates
  ON conversation_publication_updates(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS publication_consents (
  conversation_id UUID NOT NULL REFERENCES conversation_publications(conversation_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_hash TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS artifact_public_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  link_token_digest TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('published', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  purge_after TIMESTAMPTZ NOT NULL,
  published_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (purge_after > expires_at),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_artifact_public_links_digest ON artifact_public_links(link_token_digest);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM conversation_publications WHERE state = 'published') THEN
    RAISE EXCEPTION 'publication rollback refused: live publications exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM artifact_public_links WHERE state = 'published') THEN
    RAISE EXCEPTION 'publication rollback refused: live artifact links exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM conversation_publications) THEN
    RAISE EXCEPTION 'publication rollback refused: publications exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM artifact_public_links) THEN
    RAISE EXCEPTION 'publication rollback refused: artifact links exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE artifact_public_links;
  DROP TABLE publication_consents;
  DROP TABLE conversation_publication_updates;
  DROP TABLE conversation_publications;
END $$;

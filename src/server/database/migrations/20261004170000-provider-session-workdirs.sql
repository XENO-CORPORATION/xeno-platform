-- UP
-- SES-02: when a provider needs a cwd but the chat selected no directory,
-- the host supplies isolated session storage, labeled as such. One row per
-- conversation: a deterministic path under the host session root plus a scope
-- label that can only ever read 'session-isolated'. Bound conversations
-- (project_id/workspace_id set) are resolved by the authorized-root path
-- (SES-03), never here -- this table cannot express a project grant.
CREATE TABLE provider_session_workdirs (
  conversation_id UUID PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE CHECK (length(btrim(path)) BETWEEN 2 AND 1024),
  scope TEXT NOT NULL CHECK (scope = 'session-isolated'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM provider_session_workdirs) THEN
    RAISE EXCEPTION 'session workdir rollback refused: isolated workdirs exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP TABLE provider_session_workdirs;

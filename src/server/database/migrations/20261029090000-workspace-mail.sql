-- UP
-- Office › Mail = XENO Mail (services/xenoMail.js). The platform is a FRONT-END: no mail, no message text and no
-- mail credential is stored here. Mail lives in xeno-mail (mail-core); every call carries a 60-second assertion the
-- platform signs (aud xeno-mail). These tables hold only which mailbox to address and who proposed what:
--
--   mail_workspace_mailboxes  which of the PERSON's own addresses a workspace uses (no secret). mail-core binds that
--                             connection or refuses (xeno-mail PR #4), so a mapping can never reach someone else's mail.
--   mail_agent_drafts         ids of drafts an agent wrote for its owner — the person reviews and sends them. Only ids:
--                             the draft itself stays in xeno-mail.
--
-- ADDITIVE: two new tables and a widened tasks.source CHECK. DOWN drops both tables and restores the CHECK NOT VALID,
-- so tasks made from mail survive a rollback.
CREATE TABLE IF NOT EXISTS mail_workspace_mailboxes (
  workspace_id  UUID NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address       TEXT NOT NULL CHECK (address = lower(address) AND length(address) BETWEEN 3 AND 320 AND position('@' in address) > 1),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS mail_agent_drafts (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  draft_id      TEXT NOT NULL CHECK (length(draft_id) BETWEEN 1 AND 300),
  agent_id      UUID NOT NULL,
  workspace_id  UUID NOT NULL,
  address       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, draft_id)
);
CREATE INDEX IF NOT EXISTS mail_agent_drafts_ws ON mail_agent_drafts (workspace_id, user_id, created_at DESC);

-- A task can now come from mail (xenoMail.toTask). Widened, never narrowed.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_source_check CHECK (source IN ('manual', 'chat', 'forum_ticket', 'forum_thread', 'agent', 'mail'));
-- DOWN
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_source_check CHECK (source IN ('manual', 'chat', 'forum_ticket', 'forum_thread', 'agent')) NOT VALID;
DROP TABLE IF EXISTS mail_agent_drafts;
DROP TABLE IF EXISTS mail_workspace_mailboxes;

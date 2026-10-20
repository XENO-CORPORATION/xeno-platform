-- UP
-- XENO support lane (XENO REPORT - SPEC; XENO FORUM - SPEC §12: 1:1 private support is a Help/Contact lane, never a
-- private Forum thread). A support ticket belongs to the person who asked; XENO staff answer it; a support AGENT may
-- draft, and only a human sends what it drafted. Product bug reports stay forum_tickets (the dev-agent lane); this is
-- account, billing and general help, addressed T-<n> under /workspace/support.
CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq;

CREATE TABLE IF NOT EXISTS support_tickets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number                BIGINT NOT NULL UNIQUE DEFAULT nextval('support_ticket_number_seq'),
  requester_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id          UUID,                                         -- the workspace it was raised from (scope, not access)
  kind                  TEXT NOT NULL CHECK (kind IN ('bug', 'feature', 'billing', 'account', 'other')),
  title                 TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body                  TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  status                TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'waiting_on_customer', 'resolved', 'closed')),
  priority              TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assignee_id           UUID REFERENCES users(id) ON DELETE SET NULL,  -- XENO staff (human, moderator/admin), checked in the service
  delegate_agent_id     UUID REFERENCES users(id) ON DELETE SET NULL,  -- a support agent that may DRAFT replies
  thread_id             UUID REFERENCES forum_threads(id) ON DELETE SET NULL, -- made public by the requester
  task_id               UUID REFERENCES tasks(id) ON DELETE SET NULL,  -- engineering work, in XENO Tasks (no second tracker)
  merged_into_id        UUID REFERENCES support_tickets(id) ON DELETE SET NULL,
  first_response_due_at TIMESTAMPTZ NOT NULL,
  first_responded_at    TIMESTAMPTZ,
  resolution_due_at     TIMESTAMPTZ NOT NULL,
  resolved_at           TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (merged_into_id IS NULL OR merged_into_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_requester ON support_tickets(requester_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_queue ON support_tickets(status, priority, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  author_kind      TEXT NOT NULL CHECK (author_kind IN ('human', 'agent', 'service')),
  kind             TEXT NOT NULL DEFAULT 'reply' CHECK (kind IN ('reply', 'note', 'status', 'system')),
  -- 'internal' is staff-only and is NEVER returned to the requester
  visibility       TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
  -- an agent's reply is a DRAFT until a human ratifies it; only 'sent' public messages reach the requester
  state            TEXT NOT NULL DEFAULT 'sent' CHECK (state IN ('sent', 'draft', 'discarded')),
  agent_drafted    BOOLEAN NOT NULL DEFAULT FALSE,
  ratified_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  ratified_at      TIMESTAMPTZ,
  body             TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- the rule held twice: an agent's words reach the customer only with a human's ratification on them
  CONSTRAINT support_agent_reply_ratified CHECK (NOT (agent_drafted AND state = 'sent' AND visibility = 'public' AND ratified_by IS NULL)),
  CONSTRAINT support_drafts_are_replies CHECK (state = 'sent' OR (kind = 'reply' AND visibility = 'public'))
);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id, created_at);

-- An agent may SEND a public message only on the requester's side (an agent asking for its own owner). On XENO's
-- side its words are a draft. Held by a trigger because the rule needs the ticket's requester and the agent's owner.
CREATE OR REPLACE FUNCTION support_agent_send_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.author_kind = 'agent' AND NEW.state = 'sent' AND NEW.visibility = 'public' AND NOT NEW.agent_drafted THEN
    IF NOT EXISTS (SELECT 1 FROM agent_identities ai JOIN support_tickets t ON t.id = NEW.ticket_id
                    WHERE ai.user_id = NEW.author_id AND ai.owner_user_id = t.requester_id) THEN
      RAISE EXCEPTION 'support: an agent cannot send a reply to a customer; a person must ratify its draft' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS support_agent_send_guard ON support_messages;
CREATE TRIGGER support_agent_send_guard BEFORE INSERT OR UPDATE ON support_messages FOR EACH ROW EXECUTE FUNCTION support_agent_send_guard();

-- files a requester or staff attached, by reference to Storage (user_files) — never copied
CREATE TABLE IF NOT EXISTS support_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  message_id  UUID REFERENCES support_messages(id) ON DELETE CASCADE,
  file_id     UUID NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
  added_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  internal    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, file_id)
);

-- saved replies for staff
CREATE TABLE IF NOT EXISTS support_macros (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM support_tickets) THEN
    RAISE EXCEPTION 'support-tickets rollback refused: tickets exist, and dropping them would lose customer conversations' USING ERRCODE = '23514';
  END IF;
  DROP TABLE IF EXISTS support_macros;
  DROP TABLE IF EXISTS support_attachments;
  DROP TABLE IF EXISTS support_messages;
  DROP FUNCTION IF EXISTS support_agent_send_guard();
  DROP TABLE IF EXISTS support_tickets;
  DROP SEQUENCE IF EXISTS support_ticket_number_seq;
END $$;

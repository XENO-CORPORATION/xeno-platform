-- UP
-- Workspace architect (owner, 2026-10-20): "from one idea, or a pile of documents, propose the whole workspace".
--
-- `architect_proposals` holds a PROPOSAL, never applied by itself. It carries:
--   sources      what the caller gave (idea text hash, Storage file/folder ids, corpus refs) and what was refused
--   proposal     the model's answer after validation: every element cites the passages that drove it
--   pack         the applicable part, in the exact format services/modeApply.js plans and applies
--                (mode + starter tasks). A person may edit it (edited_at); applying goes through
--                modeApply plan → apply → receipt → revert as pack `proposal:<id>`, a human admin confirming.
--   based_on     the application this proposal was diffed against on a re-run (never overwrites a person's edits)
-- Additive only. DOWN refuses while a proposal exists (they are a person's authored review state).
CREATE TABLE IF NOT EXISTS architect_proposals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  sources               JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposal              JSONB NOT NULL,
  pack                  JSONB NOT NULL,
  based_on_application_id UUID,
  model                 TEXT,
  credits_charged       NUMERIC,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at             TIMESTAMPTZ,
  edited_by_user_id     UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS architect_proposals_ws ON architect_proposals (workspace_id, created_at DESC);
-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'architect_proposals')
     AND EXISTS (SELECT 1 FROM architect_proposals) THEN
    RAISE EXCEPTION 'architect_proposals holds proposals; refusing to drop';
  END IF;
END $$;
DROP TABLE IF EXISTS architect_proposals;

-- UP
-- Phase 5 — resource tenancy seam. ADDITIVE + REVERSIBLE. Links the primary
-- resource (chat_conversations) to a workspace; NULL = personal (current behaviour).
-- Membership/authorization is enforced via ReBAC parent inheritance
-- (conversation:<id>#parent@workspace:<wsId>) — see authzReBAC.check userset rewrite.
-- Guarded so it's a no-op where the table isn't present in this environment.
DO $$
BEGIN
  IF to_regclass('public.chat_conversations') IS NOT NULL THEN
    ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS workspace_id UUID;
    CREATE INDEX IF NOT EXISTS idx_chat_conversations_workspace ON chat_conversations (workspace_id);
  END IF;
END $$;

-- DOWN
DO $$
BEGIN
  IF to_regclass('public.chat_conversations') IS NOT NULL THEN
    DROP INDEX IF EXISTS idx_chat_conversations_workspace;
    ALTER TABLE chat_conversations DROP COLUMN IF EXISTS workspace_id;
  END IF;
END $$;

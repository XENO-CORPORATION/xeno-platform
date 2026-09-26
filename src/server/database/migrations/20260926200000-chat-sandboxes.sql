-- Per-chat CODE SANDBOX: a persistent filesystem for a conversation's code execution.
--
-- WHY
-- ---
-- Chat can run code today only through the manual "Run" button, one-shot and stateless (xenorun
-- discards its /workspace tmpfs on exit). ChatGPT/Claude give each conversation a persistent working
-- directory over ephemeral, pooled compute (CHAT-CODE-EXECUTION-SPEC.md). This is the persistent half:
-- the files survive between turns; the compute stays ephemeral (xenorun, restored per run).
--
-- NAMING
-- ------
-- Called `chat_sandboxes`, NOT `chat_workspaces`: `workspace` already means the TENANCY scope in chat
-- (`chat_conversations.workspace_id`, personal/company). This is the code sandbox, ChatGPT's own term.
--
-- WHAT
-- ----
-- `chat_sandboxes`      — one row per conversation; where its files live (storage_prefix) and how much
--                         (file_count/total_bytes against quota_bytes). One sandbox per conversation.
-- `chat_sandbox_files`  — the file index: path (relative to the run's /workspace), size, content hash,
--                         and the object-store key the bytes live at. Bytes are in artifactStorage
--                         under `chat-sandboxes/<sandbox id>/<path>`; this table is the manifest that
--                         restores the sandbox into a run and enforces the per-chat quota.
--
-- Additive and idempotent. No existing table is altered.

CREATE TABLE IF NOT EXISTS chat_sandboxes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL UNIQUE REFERENCES chat_conversations(id) ON DELETE CASCADE,
  owner_user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
  storage_prefix TEXT NOT NULL,
  file_count     INTEGER NOT NULL DEFAULT 0,
  total_bytes    BIGINT NOT NULL DEFAULT 0,
  quota_bytes    BIGINT NOT NULL DEFAULT 104857600, -- 100 MB per conversation
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_sandbox_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_id   UUID NOT NULL REFERENCES chat_sandboxes(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL,
  content_hash TEXT NOT NULL,
  storage_key  TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sandbox_id, path)
);

CREATE INDEX IF NOT EXISTS idx_chat_sandbox_files_sandbox ON chat_sandbox_files(sandbox_id);

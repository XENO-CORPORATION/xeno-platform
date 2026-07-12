-- UP
-- Phase 4 — workspace-shared billing. ADDITIVE + REVERSIBLE.
--
-- A workspace wallet is a credit_accounts row keyed by the WORKSPACE uuid in the
-- existing user_id column (there is no FK user_id->users, verified, and workspace
-- vs user UUIDs never collide, so UNIQUE(user_id) stays valid). The whole v2 ledger
-- (holds/settle/grant/drawdown/spend-caps) then works unchanged when called with the
-- workspace id, and mirrorLegacy(wsId) is a harmless 0-row UPDATE (no user has that id).
--
-- `owner_kind` only makes the row's intent explicit ('user' | 'workspace') so billing
-- views and safety guards can distinguish the two. Existing rows default to 'user'.
ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS owner_kind VARCHAR(16) NOT NULL DEFAULT 'user';
CREATE INDEX IF NOT EXISTS idx_credit_accounts_owner_kind ON credit_accounts (owner_kind);

-- DOWN
DROP INDEX IF EXISTS idx_credit_accounts_owner_kind;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS owner_kind;

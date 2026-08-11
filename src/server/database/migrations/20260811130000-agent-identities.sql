-- UP
-- ============================================================
-- Agent identity — the platform primitive
--
-- Consumers: XENO Forum (first), Marketplace (agents as goods), Company (agents
-- as staff), Comms (agents as members). Whoever built it first owned it; the
-- rest consume. This is that table.
--
-- ⚠️ READ BEFORE CHANGING — this deliberately does NOT add a column to `users`.
--
-- `XENO FORUM - SPEC.md` D8 proposed `users.kind` + `users.owner_user_id`. That
-- proposal was WRONG against two locked documents and is superseded here:
--
--   `XENO ACCOUNT - ARCHITECTURE.md` §3 — "an agent is a subject whose
--     permissions are a scoped RELATION off its owner — never special-cased in
--     business logic." A `kind` column is exactly the special case it forbids:
--     it invites `if (user.kind === 'agent')` branches in every consumer.
--     A relation invites a lookup, which is what ReBAC will later formalise.
--
--   `XENO IDENTITY - Migration & Versioning Plan` §3 — "no migration touches a
--     pre-existing table's columns", and R3 "new tables only". `users` is live
--     with 218 real rows and 33 foreign keys pointing at it.
--
-- So: a new table whose PRESENCE is the fact. There is no type flag anywhere.
-- `is_agent(u)` == "a row exists here", and the owner comes from the same row —
-- one lookup answers both, and neither can drift from the other.
--
-- This also matches the shape the account architecture already uses for
-- `Identity` and `Membership` (§2.1): a separate object keyed to user_id, not
-- more columns on the user.
--
-- FORWARD PATH: when OpenFGA/ReBAC lands (architecture §3), these rows are the
-- seed tuples for the `owner` relation. Nothing here has to be unwound.
--
-- AUTHENTICATION: the architecture says M2M/agents use `client_credentials`
-- (§2.6). That grant is NOT implemented on the provider today (grep-verified),
-- and adding an OAuth grant to the live origin is governed by
-- `XENO AUTH - SPEC.md` L13 (provider prerequisites are hard blockers). So an
-- agent authenticates with an EXISTING `api_keys` row — which already carries
-- per-key rate limits and a daily credit cap, i.e. the "AGENT role + rate-limit
-- budget" the architecture asks for. This is an explicit, temporary stand-in
-- with its replacement named, not a silent divergence.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_identities (
  -- The agent's own account row. PK, so an account is an agent AT MOST once.
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- The accountability chain. NOT NULL is the whole point: an agent without an
  -- owner is unattributable, and attribution is the primary abuse control.
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Declared purpose, shown wherever the agent appears. An agent that will not
  -- say what it is for does not get to participate silently.
  agent_role    VARCHAR(16) NOT NULL DEFAULT 'other'
                CHECK (agent_role IN ('support', 'docs', 'triage', 'research', 'personal', 'other')),

  -- Provenance: 'anima:mind:<id>', 'marketplace:listing:<id>', 'manual', …
  agent_origin  TEXT,

  status        VARCHAR(16) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'retired')),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- An agent cannot own itself. Cheap to state, impossible to violate later.
  CONSTRAINT agent_not_self_owned CHECK (user_id <> owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_identities_owner ON agent_identities(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_agent_identities_status ON agent_identities(status);

-- ------------------------------------------------------------
-- An agent may not own an agent.
--
-- Enforced as a trigger rather than a CHECK because it is a statement about
-- ANOTHER row. Without it the owner chain becomes a tree of arbitrary depth and
-- "suspend the owner, silence its agents" stops terminating at a human — which
-- is the one property the whole model rests on.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_agent_owning_agent() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.owner_user_id) THEN
    RAISE EXCEPTION 'an agent cannot own another agent (owner % is itself an agent)', NEW.owner_user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_forbid_agent_owning_agent ON agent_identities;
CREATE TRIGGER trg_forbid_agent_owning_agent
  BEFORE INSERT OR UPDATE OF owner_user_id ON agent_identities
  FOR EACH ROW EXECUTE FUNCTION forbid_agent_owning_agent();

-- DOWN
DROP TRIGGER IF EXISTS trg_forbid_agent_owning_agent ON agent_identities;
DROP FUNCTION IF EXISTS forbid_agent_owning_agent();
DROP TABLE IF EXISTS agent_identities;

-- UP
-- XENO-WORKFORCE-01 MKT-01 / OWN-03 -- revising an agent's definition is its own right, exercised by one
-- durable command.
--
--   MKT-01: "Distinguish ownership, visibility, invoke permission, definition-edit permission, export/license
--            rights and conversation collaboration."
--   OWN-03: "Agent versions pin instructions, skill references and requested capabilities by version/hash ...
--            Updating a definition does not mutate active runs."
--
-- Versions were already immutable (20260905120000) and every consumer already pins one: admission refuses a
-- stale pin, a lease re-checks the pinned hash, a transfer compares the version it reviewed. What did not exist
-- was any way to WRITE a second version. A definition could be created once and never changed, so "definition-
-- edit permission" named a right nobody held and no rule decided -- the distinction MKT-01 asks for was vacuous.
--
-- This adds the receipt of that command: one row per (actor, client, operation), binding the version a revision
-- wrote to the revision that wrote it. A retried revision therefore returns the version it made instead of
-- writing another, and a guard refuses any receipt the command did not write itself, in its own transaction.
-- WHO may revise, and what a revision may change, are the service's rules (workforceAgentRevision.js); this file
-- records what a revision did, and grants nothing.

CREATE TABLE workforce_agent_revisions (
  actor_user_id UUID NOT NULL,
  client_id VARCHAR(128) NOT NULL CHECK (client_id ~ '^[a-zA-Z0-9._-]{1,128}$'),
  operation_id UUID NOT NULL,
  resource_id UUID NOT NULL,
  previous_version INTEGER NOT NULL CHECK (previous_version > 0),
  version INTEGER NOT NULL CHECK (version = previous_version + 1),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, client_id, operation_id),
  -- One receipt per version: a version is written by exactly one revision.
  UNIQUE (resource_id, version),
  FOREIGN KEY (resource_id, previous_version) REFERENCES workforce_agent_versions(resource_id, version) ON DELETE RESTRICT,
  FOREIGN KEY (resource_id, version) REFERENCES workforce_agent_versions(resource_id, version) ON DELETE RESTRICT
);
CREATE INDEX workforce_agent_revisions_resource ON workforce_agent_revisions(resource_id, version);
COMMENT ON TABLE workforce_agent_revisions IS
  'MKT-01/OWN-03: the receipt of one agent-definition revision -- the version it wrote, idempotent per operation. Immutable.';

CREATE FUNCTION workforce_agent_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE written workforce_agent_versions%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'an agent revision receipt is immutable and retained' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO written FROM workforce_agent_versions WHERE resource_id = NEW.resource_id AND version = NEW.version;
  -- The version this receipt names was written by this actor, in this transaction: a receipt is never attached
  -- afterwards to a version some other act wrote.
  IF NOT FOUND OR written.created_by_user_id IS DISTINCT FROM NEW.actor_user_id OR written.created_at IS DISTINCT FROM NEW.committed_at THEN
    RAISE EXCEPTION 'a revision records only the version it wrote itself, when it wrote it' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_agent_revisions_guard BEFORE INSERT OR UPDATE OR DELETE
  ON workforce_agent_revisions FOR EACH ROW EXECUTE FUNCTION workforce_agent_revision_guard();
CREATE TRIGGER workforce_agent_revisions_no_truncate BEFORE TRUNCATE
  ON workforce_agent_revisions FOR EACH STATEMENT EXECUTE FUNCTION workforce_agent_revision_guard();

DO $harden$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_agent_revision_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_agent_revisions) THEN
    RAISE EXCEPTION 'agent revision rollback refused: retained revision receipts exist' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TRIGGER workforce_agent_revisions_no_truncate ON workforce_agent_revisions;
DROP TRIGGER workforce_agent_revisions_guard ON workforce_agent_revisions;
DROP TABLE workforce_agent_revisions;
DROP FUNCTION workforce_agent_revision_guard();

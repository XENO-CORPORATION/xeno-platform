-- UP
-- The INTERNAL release note (owner, 2026-10-21): one per deploy, STAFF ONLY, never reachable by a customer.
-- Drafted automatically at every deploy from the PRs it shipped (services/releaseInternalNotes.js, a deterministic
-- template — no model call), edited by staff or a staff agent, SIGNED OFF only by a human on staff.
--
--   release_internal_notes           the current note: its sections, the facts it was drafted from, who signed which version
--   release_internal_note_revisions  every version ever written (the draft is revision 1), so an edit never loses words
--
-- Additive only: no existing table or column changes. Nothing here is read by the customer path (whatsNew).

CREATE TABLE IF NOT EXISTS release_internal_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deploy_id       UUID NOT NULL UNIQUE REFERENCES release_deploys(id) ON DELETE CASCADE,
  content         JSONB NOT NULL,          -- {summary, why, features, migrations, risks, switches, tests, rollback}: plain text per section
  sources         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- the facts the draft was built from (PR titles/bodies/files, env diff, migration down paths)
  provenance      TEXT NOT NULL CHECK (provenance IN ('drafted_at_deploy', 'drafted_from_history')),
  state           TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'signed')),
  version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  edited          BOOLEAN NOT NULL DEFAULT FALSE,       -- a person or agent changed the words: the deploy never redrafts over them
  signed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  signed_at       TIMESTAMPTZ,
  signed_version  INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (state <> 'signed' OR (signed_by IS NOT NULL AND signed_at IS NOT NULL AND signed_version = version))
);

CREATE TABLE IF NOT EXISTS release_internal_note_revisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id         UUID NOT NULL REFERENCES release_internal_notes(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  content         JSONB NOT NULL,
  edited_by       UUID REFERENCES users(id) ON DELETE SET NULL,   -- NULL for the automatic draft
  edited_by_kind  TEXT NOT NULL CHECK (edited_by_kind IN ('system', 'human', 'agent')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (note_id, version)
);

-- Sign-off is a person's act. The service checks; the database holds it too, so no path (an agent tool, a script,
-- a hand-written UPDATE) can sign as an agent or as someone who is not on staff.
CREATE OR REPLACE FUNCTION release_internal_note_signoff_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'signed' AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM 'signed' OR OLD.signed_by IS DISTINCT FROM NEW.signed_by) THEN
    IF EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.signed_by)
       OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.signed_by AND role IN ('admin', 'moderator') AND COALESCE(is_active, TRUE)) THEN
      RAISE EXCEPTION 'internal release notes: only a human on XENO staff may sign off' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS release_internal_note_signoff_guard ON release_internal_notes;
CREATE TRIGGER release_internal_note_signoff_guard BEFORE INSERT OR UPDATE ON release_internal_notes FOR EACH ROW EXECUTE FUNCTION release_internal_note_signoff_guard();

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM release_internal_note_revisions WHERE edited_by_kind <> 'system') OR EXISTS (SELECT 1 FROM release_internal_notes WHERE state = 'signed') THEN
    RAISE EXCEPTION 'internal-notes rollback refused: notes carry human edits or sign-offs, and dropping them loses them' USING ERRCODE = '23514';
  END IF;
  DROP TABLE IF EXISTS release_internal_note_revisions;
  DROP TABLE IF EXISTS release_internal_notes;
  DROP FUNCTION IF EXISTS release_internal_note_signoff_guard();
END $$;

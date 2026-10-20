-- XENO Corpus on the platform (XENO CORPUS - SPEC.md; BUILD DECISIONS BD-10; D211, D227, D228).
--
-- A corpus is a scope's body of verified truth: TENETS (a claim bound to the procedure that disproves it),
-- their ASSAYS (the procedure, stored on the tenet as in corpus-v0's tenets/*.json), and SIGNED VERDICTS
-- (append-only, hash-chained, signed with the platform's own OIDC key). The workspace owns every corpus.
--
-- Scope: one corpus per workspace, per division, per project. There is NO stored parent: the ancestor
-- chain is DERIVED from the live structure (project -> its owning division -> parent divisions ->
-- workspace), so moving a project between divisions re-chains its corpus without a migration.
--
-- Nesting (D227/D228): doctrine inherits DOWN, facts aggregate UP by reference only, and an ancestor may
-- never assert a claim about a descendant's subject. Enforced here by trigger, not only in the service.
--
-- Agents PROPOSE; humans RATIFY (D211). A proposal is never applied automatically: the database refuses a
-- ratification decided by an agent principal, and refuses a tenet written by an agent principal at all.

CREATE TABLE IF NOT EXISTS corpus_corpora (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('workspace', 'division', 'project')),
  division_id UUID REFERENCES workforce_divisions(id) ON DELETE RESTRICT,
  project_id UUID REFERENCES chat_projects(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT corpus_scope_shape CHECK (
    (scope_kind = 'workspace' AND division_id IS NULL AND project_id IS NULL AND subject = 'workspace:' || workspace_id::text)
    OR (scope_kind = 'division' AND division_id IS NOT NULL AND project_id IS NULL AND subject = 'division:' || division_id::text)
    OR (scope_kind = 'project' AND project_id IS NOT NULL AND division_id IS NULL AND subject = 'project:' || project_id::text))
);
CREATE UNIQUE INDEX IF NOT EXISTS corpus_corpora_subject ON corpus_corpora (subject);
CREATE INDEX IF NOT EXISTS corpus_corpora_workspace ON corpus_corpora (workspace_id);

-- A scope's corpus belongs to that scope's workspace -- never another one's.
CREATE OR REPLACE FUNCTION corpus_corpora_guard() RETURNS trigger AS $$
DECLARE ws UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'a corpus scope is immutable' USING ERRCODE = '23514'; END IF;
  IF NEW.scope_kind = 'division' THEN
    SELECT workspace_id INTO ws FROM workforce_divisions WHERE id = NEW.division_id;
  ELSIF NEW.scope_kind = 'project' THEN
    -- the same rule as workforce_project_divisions: a project with no workspace is in its owner's personal one
    SELECT COALESCE(p.workspace_id, (SELECT w.id FROM workspaces w WHERE w.owner_user_id = p.owner_user_id AND w.workspace_type = 'personal' ORDER BY w.created_at LIMIT 1))
      INTO ws FROM chat_projects p WHERE p.id = NEW.project_id;
  ELSE ws := NEW.workspace_id; END IF;
  IF ws IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'corpus_wrong_workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS corpus_corpora_guard ON corpus_corpora;
CREATE TRIGGER corpus_corpora_guard BEFORE INSERT OR UPDATE ON corpus_corpora FOR EACH ROW EXECUTE FUNCTION corpus_corpora_guard();

-- The ancestor corpora of a corpus, nearest first, derived from the LIVE structure.
CREATE OR REPLACE FUNCTION corpus_ancestors(cid UUID) RETURNS UUID[] AS $$
DECLARE c corpus_corpora%ROWTYPE; d UUID; out UUID[] := '{}'; anc UUID; guard INT := 0;
BEGIN
  SELECT * INTO c FROM corpus_corpora WHERE id = cid;
  IF NOT FOUND OR c.scope_kind = 'workspace' THEN RETURN out; END IF;
  IF c.scope_kind = 'project' THEN
    SELECT division_id INTO d FROM workforce_project_divisions WHERE project_id = c.project_id;
  ELSE
    SELECT parent_division_id INTO d FROM workforce_divisions WHERE id = c.division_id;
  END IF;
  WHILE d IS NOT NULL AND guard < 64 LOOP
    SELECT id INTO anc FROM corpus_corpora WHERE subject = 'division:' || d::text;
    IF anc IS NOT NULL THEN out := out || anc; END IF;
    anc := NULL;
    SELECT parent_division_id INTO d FROM workforce_divisions WHERE id = d;
    guard := guard + 1;
  END LOOP;
  SELECT id INTO anc FROM corpus_corpora WHERE subject = 'workspace:' || c.workspace_id::text;
  IF anc IS NOT NULL THEN out := out || anc; END IF;
  RETURN out;
END $$ LANGUAGE plpgsql STABLE;

CREATE TABLE IF NOT EXISTS corpus_tenets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corpus_id UUID NOT NULL REFERENCES corpus_corpora(id) ON DELETE CASCADE,
  tenet_key TEXT NOT NULL CHECK (tenet_key ~ '^[A-Za-z0-9][A-Za-z0-9._#:/-]{0,199}$'),
  kind TEXT NOT NULL DEFAULT 'tenet' CHECK (kind IN ('tenet', 'doctrine')),
  subject TEXT NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 200),
  claim TEXT NOT NULL CHECK (length(btrim(claim)) BETWEEN 1 AND 4000),
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The assay: the procedure that would disprove the claim (corpus-v0 shape: {kind, run}). Doctrine has none (D50).
  assay JSONB,
  expect TEXT,
  cadence TEXT CHECK (cadence IS NULL OR cadence ~ '^[0-9]{1,5}h$'),
  warn_after TEXT CHECK (warn_after IS NULL OR warn_after ~ '^[0-9]{1,5}h$'),
  expire_after TEXT CHECK (expire_after IS NULL OR expire_after ~ '^[0-9]{1,5}h$'),
  source TEXT,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  origin TEXT NOT NULL CHECK (origin IN ('authored', 'ratified', 'imported')),
  proposal_id UUID,
  binding_id UUID REFERENCES project_directory_bindings(id) ON DELETE RESTRICT,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ,
  superseded_by UUID REFERENCES corpus_tenets(id) ON DELETE SET NULL,
  CONSTRAINT corpus_tenet_assay CHECK ((kind = 'doctrine') OR (assay IS NOT NULL AND expect IS NOT NULL)),
  CONSTRAINT corpus_tenet_ratified CHECK ((origin = 'ratified') = (proposal_id IS NOT NULL)),
  CONSTRAINT corpus_tenet_imported CHECK ((origin = 'imported') = (binding_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS corpus_tenets_live_key ON corpus_tenets (corpus_id, tenet_key) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS corpus_tenets_subject ON corpus_tenets (subject) WHERE superseded_at IS NULL;

-- D228 + D211, enforced where no code path can forget them.
CREATE OR REPLACE FUNCTION corpus_tenets_guard() RETURNS trigger AS $$
DECLARE c corpus_corpora%ROWTYPE; hit TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only supersession may change a tenet: its content is what verdicts were taken against.
    IF NEW.claim IS DISTINCT FROM OLD.claim OR NEW.assay IS DISTINCT FROM OLD.assay OR NEW.expect IS DISTINCT FROM OLD.expect
       OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.corpus_id IS DISTINCT FROM OLD.corpus_id
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION 'corpus_tenet_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  -- D211: an agent proposes and never writes truth. Only a person (or an import read from a bound directory
  -- by a person's installation) may create a tenet.
  IF NEW.created_by_user_id IS NULL OR EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.created_by_user_id) THEN
    RAISE EXCEPTION 'corpus_agent_cannot_write_tenet' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO c FROM corpus_corpora WHERE id = NEW.corpus_id;
  -- A scope subject (workspace:/division:/project:) is owned by its own corpus only.
  IF NEW.subject ~ '^(workspace|division|project):' AND NEW.subject <> c.subject THEN
    RAISE EXCEPTION 'corpus_subject_outside_scope' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'tenet' THEN
    -- D228: an ancestor may never assert about a descendant's subject ...
    SELECT t.subject INTO hit FROM corpus_tenets t JOIN corpus_corpora d ON d.id = t.corpus_id
     WHERE d.workspace_id = c.workspace_id AND t.superseded_at IS NULL AND t.kind = 'tenet'
       AND t.subject = NEW.subject AND NEW.corpus_id = ANY(corpus_ancestors(d.id)) LIMIT 1;
    IF hit IS NOT NULL THEN RAISE EXCEPTION 'corpus_ancestor_asserts_descendant_subject' USING ERRCODE = '23514'; END IF;
    -- ... and a descendant does not make its ancestor do so by claiming a subject the ancestor already owns.
    SELECT t.subject INTO hit FROM corpus_tenets t
     WHERE t.superseded_at IS NULL AND t.kind = 'tenet' AND t.subject = NEW.subject
       AND t.corpus_id = ANY(corpus_ancestors(NEW.corpus_id)) LIMIT 1;
    IF hit IS NOT NULL THEN RAISE EXCEPTION 'corpus_subject_owned_by_ancestor' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS corpus_tenets_guard ON corpus_tenets;
CREATE TRIGGER corpus_tenets_guard BEFORE INSERT OR UPDATE ON corpus_tenets FOR EACH ROW EXECUTE FUNCTION corpus_tenets_guard();

-- Verdicts: append-only, hash-chained per tenet, each signed (ES256, the platform OIDC key) and each taken
-- under a run admission of the person who recorded it (the assay run is an admitted run, never a bare POST).
CREATE TABLE IF NOT EXISTS corpus_verdicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenet_id UUID NOT NULL REFERENCES corpus_tenets(id) ON DELETE CASCADE,
  tenet_content_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('held', 'lapsed', 'error')),
  observed TEXT CHECK (observed IS NULL OR length(observed) <= 4000),
  instrument TEXT CHECK (instrument IS NULL OR length(instrument) <= 1000),
  admission_id UUID NOT NULL REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
  recorded_by_user_id UUID NOT NULL,
  -- who sent it: the person, or the agent acting for them (the admission is the person's)
  reported_by_user_id UUID NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  prev_hash TEXT,
  hash TEXT NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  signing_kid TEXT NOT NULL,
  signature TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS corpus_verdicts_tenet ON corpus_verdicts (tenet_id, at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS corpus_verdicts_chain ON corpus_verdicts (tenet_id, prev_hash) NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION corpus_verdicts_guard() RETURNS trigger AS $$
DECLARE a RECORD; ws UUID; last TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'corpus_verdicts_append_only' USING ERRCODE = '23514'; END IF;
  SELECT * INTO a FROM workforce_run_admissions WHERE id = NEW.admission_id;
  IF a.actor_user_id IS DISTINCT FROM NEW.recorded_by_user_id THEN
    RAISE EXCEPTION 'corpus_verdict_admission_not_yours' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM workforce_run_revocations WHERE admission_id = NEW.admission_id) THEN
    RAISE EXCEPTION 'corpus_verdict_admission_revoked' USING ERRCODE = '23514';
  END IF;
  SELECT c.workspace_id INTO ws FROM corpus_tenets t JOIN corpus_corpora c ON c.id = t.corpus_id WHERE t.id = NEW.tenet_id;
  IF a.target_workspace_id IS NOT NULL AND a.target_workspace_id <> ws THEN
    RAISE EXCEPTION 'corpus_verdict_admission_other_workspace' USING ERRCODE = '23514';
  END IF;
  SELECT hash INTO last FROM corpus_verdicts WHERE tenet_id = NEW.tenet_id ORDER BY at DESC, id DESC LIMIT 1;
  IF last IS DISTINCT FROM NEW.prev_hash THEN RAISE EXCEPTION 'corpus_verdict_chain_broken' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS corpus_verdicts_guard ON corpus_verdicts;
CREATE TRIGGER corpus_verdicts_guard BEFORE INSERT OR UPDATE OR DELETE ON corpus_verdicts FOR EACH ROW EXECUTE FUNCTION corpus_verdicts_guard();

-- Proposals (D211): what an agent (or a person) suggests. Shown to a person who reads it; never applied
-- without a HUMAN ratification, and ratifying is the only path from a proposal to a tenet.
CREATE TABLE IF NOT EXISTS corpus_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corpus_id UUID NOT NULL REFERENCES corpus_corpora(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('add', 'supersede', 'retire')),
  target_tenet_id UUID REFERENCES corpus_tenets(id) ON DELETE SET NULL,
  tenet JSONB,
  rationale TEXT NOT NULL CHECK (length(btrim(rationale)) BETWEEN 1 AND 4000),
  proposed_by_user_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'ratified', 'rejected')),
  decided_by_user_id UUID,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT corpus_proposal_shape CHECK (
    (action = 'add' AND tenet IS NOT NULL AND target_tenet_id IS NULL)
    OR (action = 'supersede' AND tenet IS NOT NULL)
    OR (action = 'retire' AND tenet IS NULL)),
  CONSTRAINT corpus_proposal_decided CHECK ((state = 'proposed') = (decided_by_user_id IS NULL AND decided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS corpus_proposals_open ON corpus_proposals (corpus_id, created_at DESC) WHERE state = 'proposed';

CREATE OR REPLACE FUNCTION corpus_proposals_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'corpus_proposals_kept' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state <> 'proposed' THEN RAISE EXCEPTION 'corpus_proposal_already_decided' USING ERRCODE = '23514'; END IF;
    IF NEW.tenet IS DISTINCT FROM OLD.tenet OR NEW.action IS DISTINCT FROM OLD.action OR NEW.corpus_id IS DISTINCT FROM OLD.corpus_id
       OR NEW.proposed_by_user_id IS DISTINCT FROM OLD.proposed_by_user_id THEN
      RAISE EXCEPTION 'corpus_proposal_immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.state = 'ratified' AND (NEW.decided_by_user_id IS NULL
        OR EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.decided_by_user_id)) THEN
      RAISE EXCEPTION 'corpus_ratification_requires_a_person' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS corpus_proposals_guard ON corpus_proposals;
CREATE TRIGGER corpus_proposals_guard BEFORE UPDATE OR DELETE ON corpus_proposals FOR EACH ROW EXECUTE FUNCTION corpus_proposals_guard();

ALTER TABLE corpus_tenets DROP CONSTRAINT IF EXISTS corpus_tenets_proposal_fk;
ALTER TABLE corpus_tenets ADD CONSTRAINT corpus_tenets_proposal_fk FOREIGN KEY (proposal_id) REFERENCES corpus_proposals(id) ON DELETE RESTRICT;

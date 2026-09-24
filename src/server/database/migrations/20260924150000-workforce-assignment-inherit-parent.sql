-- UP
-- XENO-WORKFORCE-01 ASN-06 -- the third permission mode, with its parent BOUND.
--
--   "Permissions use explicit modes such as `none`, `explicit`, `inherit_parent`. Empty collections
--    do not encode all three. The legacy empty=inherited policy is migrated with its effective
--    parent bound, never changed implicitly."
--
-- The foundation shipped two modes and REFUSED `inherit_parent` (20260905122000), which made the
-- requirement's first sentence false in code and left the legacy policy unrepresentable. The legacy
-- policy is the Interface's, and it is an ENCODING BY EMPTINESS: `resolveTeamDirectories` reads
-- `team.allowedDirectories.length ? … : workspace.directories`, so one empty array means "inherit
-- everything my parent has" while the same empty array under an explicit mode means "nothing".
-- Those are opposite grants written identically. Migrating that data needs a mode that says which
-- one was meant -- and says WHICH PARENT, because the Interface resolves it at read time against
-- whatever the parent happens to be.
--
-- ── WHAT "BOUND" MEANS HERE, AND WHY IT IS CHEAP ────────────────────────────────────────────────
-- A bound parent is `{assignmentId, revision}` inside the policy: the exact record whose terms were
-- approved, at the revision that was seen. Binding is only worth having if the parent cannot then
-- change underneath, and in this table it cannot -- 20260905122000's guard already refuses to alter
-- a source-approved assignment's terms ("revoke and repropose"), so an accepted parent's policy is
-- immutable for its lifetime. The revision therefore pins WHICH APPROVAL was inherited, and the
-- only thing that can still change is the parent's LIFECYCLE.
--
-- So "never changed implicitly" holds in both directions, and each has its own enforcement:
--   * the parent's terms cannot change under an accepted child      -- the existing terms guard;
--   * a parent that stops being live stops granting, and the child does NOT keep the old set and
--     does NOT re-resolve to some other ancestor -- workforce_assignment_effective_policy below.
--
-- ── ONE HOP, NEVER A CHAIN ─────────────────────────────────────────────────────────────────────
-- The bound parent must carry a CONCRETE policy (`none` or `explicit`); an assignment may not
-- inherit from an assignment that itself inherits. Nothing becomes unrepresentable, because a
-- nested division may bind any ancestor DIRECTLY, including the workspace-level assignment. What it
-- buys: resolution is a single join with no recursion, no cycle, and no chain that could be live at
-- one link and revoked at another -- the shape where a grant survives because nobody walked far
-- enough. §21's repair asks for action-specific predicates rather than more parent edges; this adds
-- no ReBAC parent edge at all, and what is inherited is a NAMED CAPABILITY LIST, never "whatever
-- the parent may do".

CREATE OR REPLACE FUNCTION workforce_assignment_policy_valid(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE capability JSONB; seen TEXT[] := '{}'; name TEXT; parent JSONB; revision NUMERIC;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'object' OR octet_length(value::text) > 16384 THEN RETURN FALSE; END IF;
  IF NOT (value ?& ARRAY['schemaVersion','mode','capabilities'])
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(value) AS field WHERE field NOT IN ('schemaVersion','mode','capabilities','parent'))
     OR value->'schemaVersion' <> '1'::jsonb OR jsonb_typeof(value->'mode') <> 'string'
     OR value->>'mode' NOT IN ('none','explicit','inherit_parent')
     OR jsonb_typeof(value->'capabilities') <> 'array' THEN RETURN FALSE; END IF;
  -- Only an EXPLICIT policy names capabilities. `none` grants nothing and `inherit_parent` takes
  -- the parent's set, so a capability written beside either is a contradiction, not a default --
  -- refusing it is what stops a list from quietly meaning two things.
  IF jsonb_array_length(value->'capabilities') > 64
     OR (value->>'mode' <> 'explicit' AND jsonb_array_length(value->'capabilities') <> 0) THEN RETURN FALSE; END IF;
  -- The bound parent is present EXACTLY when the mode inherits. An `explicit` policy carrying a
  -- parent would be two answers to one question, and an `inherit_parent` without one is the
  -- unbound form this requirement exists to forbid.
  IF (value ? 'parent') <> (value->>'mode' = 'inherit_parent') THEN RETURN FALSE; END IF;
  IF value ? 'parent' THEN
    parent := value->'parent';
    IF jsonb_typeof(parent) <> 'object'
       OR NOT (parent ?& ARRAY['assignmentId','revision'])
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(parent) AS field WHERE field NOT IN ('assignmentId','revision'))
       OR jsonb_typeof(parent->'assignmentId') <> 'string'
       OR (parent->>'assignmentId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR jsonb_typeof(parent->'revision') <> 'number' THEN RETURN FALSE; END IF;
    revision := (parent->>'revision')::numeric;
    IF revision < 1 OR revision <> trunc(revision) OR revision > 9223372036854775807 THEN RETURN FALSE; END IF;
  END IF;
  FOR capability IN SELECT jsonb_array_elements(value->'capabilities') LOOP
    IF jsonb_typeof(capability) <> 'string' THEN RETURN FALSE; END IF;
    name := capability #>> '{}';
    IF name !~ '^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$' OR name = 'all' OR name = ANY(seen) THEN RETURN FALSE; END IF;
    seen := array_append(seen, name);
  END LOOP;
  RETURN TRUE;
END;
$$;

-- The grammar above proves a policy is WELL FORMED. Whether the record it names exists, is the same
-- resource, sits above this one and was approved at the revision claimed is a relational fact, and
-- belongs in a trigger that can read other rows.
CREATE FUNCTION workforce_assignment_inherit_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE bound workforce_workspace_assignments%ROWTYPE; bound_id UUID; bound_revision BIGINT;
        walker UUID; depth INT := 0; ancestor BOOLEAN := FALSE;
BEGIN
  IF NEW.policy->>'mode' <> 'inherit_parent' THEN RETURN NEW; END IF;
  -- Checked whenever the binding is MADE -- on insert, and on any change to the policy of a row
  -- that is still proposed (a new policy is a new binding) -- and again when the assignment is
  -- accepted. Those are the moments the grant is decided. Not on every other update: a parent
  -- revoked after acceptance must still leave the child revocable, and re-running a freshness
  -- check there would refuse the revocation itself. What a dead parent does to the grant is the
  -- view's job, below.
  IF NOT (TG_OP = 'INSERT' OR NEW.policy IS DISTINCT FROM OLD.policy
          OR (NEW.state = 'accepted' AND OLD.state IS DISTINCT FROM 'accepted')) THEN
    RETURN NEW;
  END IF;
  IF NEW.target_division_id IS NULL THEN
    RAISE EXCEPTION 'a workspace-level assignment has no parent scope to inherit from' USING ERRCODE='23514';
  END IF;
  bound_id := (NEW.policy->'parent'->>'assignmentId')::uuid;
  bound_revision := (NEW.policy->'parent'->>'revision')::bigint;
  IF bound_id = NEW.id THEN
    RAISE EXCEPTION 'an assignment cannot inherit from itself' USING ERRCODE='23514';
  END IF;
  SELECT * INTO bound FROM workforce_workspace_assignments WHERE id = bound_id FOR SHARE;
  IF NOT FOUND OR bound.resource_id <> NEW.resource_id OR bound.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'bound parent must be an assignment of the same resource in the same workspace' USING ERRCODE='23514';
  END IF;
  IF bound.policy->>'mode' = 'inherit_parent' THEN
    RAISE EXCEPTION 'bound parent must carry a concrete policy; bind the ancestor directly' USING ERRCODE='23514';
  END IF;
  -- An ancestor SCOPE, never a sibling: a division may inherit from the workspace-level assignment
  -- (target_division_id IS NULL) or from an assignment to a division above it. Binding sideways
  -- would let one department take another's grant.
  IF bound.target_division_id IS NOT NULL THEN
    SELECT parent_division_id INTO walker FROM workforce_divisions WHERE id = NEW.target_division_id;
    WHILE walker IS NOT NULL AND depth < 32 LOOP
      IF walker = bound.target_division_id THEN ancestor := TRUE; EXIT; END IF;
      SELECT parent_division_id INTO walker FROM workforce_divisions WHERE id = walker;
      depth := depth + 1;
    END LOOP;
    IF NOT ancestor THEN
      RAISE EXCEPTION 'bound parent must target an ancestor scope of this assignment' USING ERRCODE='23514';
    END IF;
  END IF;
  -- Revocation is terminal, and it is the truthful reason: checked before the revision, which a
  -- revocation also advances, so the refusal names what actually happened.
  IF bound.state = 'revoked' THEN
    RAISE EXCEPTION 'bound parent is revoked; there is nothing to inherit' USING ERRCODE='23514';
  END IF;
  -- What is inherited is an APPROVAL, so it must exist. A proposed parent has no approved terms
  -- yet, and its revision will advance when it is accepted -- a binding to it could only ever be
  -- to terms nobody approved.
  IF bound.state <> 'accepted' THEN
    RAISE EXCEPTION 'bound parent must be accepted; inherit an approval that exists' USING ERRCODE='23514';
  END IF;
  -- The revision pins WHICH approval was inherited. A binding written against an older revision was
  -- approved against terms that are no longer the parent's current ones, so it is refused rather
  -- than silently re-pointed at whatever the parent says now.
  IF bound.revision <> bound_revision THEN
    RAISE EXCEPTION 'bound parent revision is stale; rebind to the approval you read' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workforce_workspace_assignments_inherit_guard
BEFORE INSERT OR UPDATE ON workforce_workspace_assignments
FOR EACH ROW EXECUTE FUNCTION workforce_assignment_inherit_guard();

-- What an assignment ACTUALLY grants right now, in one place.
--
-- 🔴 It resolves the assignment's OWN liveness too, not only its parent's. A projection reporting
-- that a revoked assignment effectively grants `files.read` is true about the policy column and
-- false about the world, and every consumer would have to remember to check state beside it. The
-- one that forgot would be a silent grant, so the check lives here instead of in each caller.
CREATE VIEW workforce_assignment_effective_policy AS
SELECT
  a.id AS assignment_id, a.resource_id, a.workspace_id, a.target_division_id,
  a.policy->>'mode' AS declared_mode,
  CASE WHEN a.policy->>'mode' = 'inherit_parent'
    THEN (a.policy->'parent'->>'assignmentId')::uuid END AS inherited_from,
  CASE WHEN a.policy->>'mode' = 'inherit_parent'
    THEN (a.policy->'parent'->>'revision')::bigint END AS inherited_revision,
  CASE
    WHEN NOT live.self THEN 'none'
    WHEN a.policy->>'mode' <> 'inherit_parent' THEN a.policy->>'mode'
    WHEN p.id IS NULL OR NOT live.parent THEN 'none'
    ELSE p.policy->>'mode'
  END AS effective_mode,
  CASE
    WHEN NOT live.self THEN '[]'::jsonb
    WHEN a.policy->>'mode' <> 'inherit_parent' THEN a.policy->'capabilities'
    WHEN p.id IS NULL OR NOT live.parent THEN '[]'::jsonb
    ELSE p.policy->'capabilities'
  END AS effective_capabilities
FROM workforce_workspace_assignments a
LEFT JOIN workforce_workspace_assignments p
  ON a.policy->>'mode' = 'inherit_parent'
 AND p.id = (a.policy->'parent'->>'assignmentId')::uuid
CROSS JOIN LATERAL (SELECT
  a.state = 'accepted' AND a.valid_from <= now() AND (a.valid_until IS NULL OR a.valid_until > now()) AS self,
  p.state = 'accepted' AND p.valid_from <= now() AND (p.valid_until IS NULL OR p.valid_until > now()) AS parent
) live;

-- Same hardening as the functions this migration's neighbours carry: a resolved search_path so a
-- caller cannot shadow `workforce_divisions` or the assignment table with its own.
DO $harden$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_assignment_inherit_guard() SET search_path = %I, pg_temp',
    current_schema(), current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM workforce_workspace_assignments WHERE policy->>'mode' = 'inherit_parent') THEN
    RAISE EXCEPTION 'inherit_parent rollback refused: inherited assignments exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP VIEW workforce_assignment_effective_policy;
DROP TRIGGER workforce_workspace_assignments_inherit_guard ON workforce_workspace_assignments;
DROP FUNCTION workforce_assignment_inherit_guard();
CREATE OR REPLACE FUNCTION workforce_assignment_policy_valid(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE capability JSONB; seen TEXT[] := '{}'; name TEXT;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'object' OR octet_length(value::text) > 16384 THEN RETURN FALSE; END IF;
  IF NOT (value ?& ARRAY['schemaVersion','mode','capabilities'])
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(value) AS field WHERE field NOT IN ('schemaVersion','mode','capabilities'))
     OR value->'schemaVersion' <> '1'::jsonb OR jsonb_typeof(value->'mode') <> 'string' OR value->>'mode' NOT IN ('none','explicit')
     OR jsonb_typeof(value->'capabilities') <> 'array' THEN RETURN FALSE; END IF;
  IF jsonb_array_length(value->'capabilities') > 64
     OR (value->>'mode' = 'none' AND jsonb_array_length(value->'capabilities') <> 0) THEN RETURN FALSE; END IF;
  FOR capability IN SELECT jsonb_array_elements(value->'capabilities') LOOP
    IF jsonb_typeof(capability) <> 'string' THEN RETURN FALSE; END IF;
    name := capability #>> '{}';
    IF name !~ '^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$' OR name = 'all' OR name = ANY(seen) THEN RETURN FALSE; END IF;
    seen := array_append(seen, name);
  END LOOP;
  RETURN TRUE;
END;
$$;

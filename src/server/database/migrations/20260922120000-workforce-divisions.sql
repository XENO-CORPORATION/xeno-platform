-- UP
-- XENO-WORKFORCE-01 §8.2b (DIV-01..DIV-10), decisions D15/D16/D17.
--
-- A DIVISION is an operating unit INSIDE a workspace: it owns teams and projects, has a head, and
-- carries a budget scope. It is a department -- the thing a company reorganises, staffs and funds.
--
-- THREE PROPERTIES ARE PRESENT FROM DAY ONE because each is cheap now and expensive later:
--
--   D15  divisions MAY NEST. `parent_division_id` exists from this migration even though the API
--        may refuse depth > 1 in v1. Adding a parent column later is additive; retrofitting an
--        intersection-correct authorizer onto live grants is a SECURITY migration. The authorizer
--        half already landed: authzReBAC.check no longer inherits through ANY `parent` tuple, and
--        `division` is deliberately NOT in its PARENT_INHERITS set, so a grant on a parent
--        division is not silently a grant on its children.
--
--   D16  ANY workspace may have divisions -- `personal` as well as `company`. A personal account
--        already IS a `workspaces` row (workspace_type IN ('personal','team')), so this adds no
--        tier there either. Refusing it would have required a special case; supporting it costs
--        nothing. Divisions are OPTIONAL EVERYWHERE and PRESENT NOWHERE BY DEFAULT: this migration
--        seeds no rows in any workspace.
--
--   D17  the OWNING division and the FUNDING scope are TWO INDEPENDENT EDGES -- the reporting line
--        and the paying line are different facts (Workday's supervisory org vs cost centre; SAP
--        SuccessFactors the same). A shared platform team reporting to `dev` while three
--        departments fund it is the ordinary case. Creating the ownership edge defaults the
--        funding edge to the same division, so the common case needs one act; A DEFAULT IS NOT A
--        FUSION. Once one column has meant two things, re-attributing historical spend is a
--        money-integrity migration under §12.1's conservation rule.

CREATE TABLE workforce_divisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- DIV-02: a child scope of EXACTLY ONE workspace. Never a tenant, never a ReBAC root, never a
  -- wallet owner. RESTRICT, not CASCADE: deleting a workspace must not silently erase the
  -- structure its spend and history were attributed to.
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  -- D15. Self-referencing and nullable: NULL = a top-level division of its workspace.
  parent_division_id UUID REFERENCES workforce_divisions(id) ON DELETE RESTRICT,
  -- DIV-03: the vocabulary is PER WORKSPACE with a seeded default set, not a closed enum. A
  -- workspace may rename, add or retire divisions, so `key` is validated for shape and uniqueness
  -- rather than against a fixed list.
  key VARCHAR(64) NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{0,63}$'),
  name VARCHAR(200) NOT NULL CHECK (length(btrim(name)) > 0),
  seeded BOOLEAN NOT NULL DEFAULT false,
  -- DIV-06: the head is a PRINCIPAL (users(id)) -- human or agent, per ROLE-04. SET NULL rather
  -- than RESTRICT: a division must survive its head's departure (OWN-05's continuity rule), and a
  -- headless division is a real, reportable state rather than a deletion blocker.
  head_principal_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- DIV-07: a REFERENCE to an allocation on the existing ledger, never a balance and never a
  -- wallet. Balance is ledger-derived. There is no division_wallets table, exactly as there is no
  -- organizations table.
  budget_allocation_id UUID,
  -- OWN-06: archive blocks new admissions; retained history stays readable. Never a cascade.
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','archived')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  -- A division cannot be its own parent. The deeper cycle case is handled by the guard below.
  CONSTRAINT workforce_division_not_self_parent CHECK (parent_division_id IS NULL OR parent_division_id <> id),
  -- Lets the child FK below carry workspace_id, so a cross-workspace parent is unrepresentable
  -- rather than merely checked.
  UNIQUE (id, workspace_id)
);

-- DIV-03: one `key` per workspace. Case is already constrained by the CHECK above.
CREATE UNIQUE INDEX workforce_division_key ON workforce_divisions(workspace_id, key);
CREATE INDEX workforce_division_parent ON workforce_divisions(parent_division_id) WHERE parent_division_id IS NOT NULL;
CREATE INDEX workforce_division_workspace ON workforce_divisions(workspace_id, lifecycle);

-- A nested division must live in the SAME workspace as its parent. Expressed as a composite FK so
-- the database refuses a cross-workspace parent outright -- a trigger could be bypassed by a
-- direct UPDATE, and "a division belongs to exactly one workspace" (DIV-02) is the one property
-- the whole tenancy argument rests on.
ALTER TABLE workforce_divisions
  ADD CONSTRAINT workforce_division_parent_same_workspace
  FOREIGN KEY (parent_division_id, workspace_id)
  REFERENCES workforce_divisions(id, workspace_id) ON DELETE RESTRICT;

CREATE FUNCTION workforce_division_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE walker UUID; hops INT := 0;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- The workspace is the tenancy fact. Moving a division between workspaces would re-tenant
    -- every team, project and spend record that points at it, so it is refused rather than
    -- audited.
    IF NEW.workspace_id <> OLD.workspace_id THEN
      RAISE EXCEPTION 'a division cannot change workspace' USING ERRCODE='23514';
    END IF;
    -- An FK's ON DELETE SET NULL performs an UPDATE that carries no revision bump. Without this
    -- hatch the guard refuses a referential action this table itself declares, and a division
    -- would pin its head's account against deletion forever -- the same defect
    -- `member_principal_id` records in the membership migration, reached from the other side.
    -- Deliberately narrow: the head column goes NULL, the user row is ALREADY gone, and nothing
    -- else on the row moved. A blanket "skip when revision is unchanged" would let any update
    -- bypass revisioning.
    IF NOT (NEW.head_principal_id IS NULL AND OLD.head_principal_id IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM users WHERE id = OLD.head_principal_id)
            AND (to_jsonb(NEW) - 'head_principal_id' - 'updated_at')
              = (to_jsonb(OLD) - 'head_principal_id' - 'updated_at'))
       AND NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'division revision must advance by exactly one' USING ERRCODE='23514';
    END IF;
    -- OWN-06: archive is one-way here. Re-activating would silently re-admit work to a scope
    -- somebody deliberately closed; that is a new division, or an explicit operator action.
    IF OLD.lifecycle = 'archived' AND NEW.lifecycle = 'active' THEN
      RAISE EXCEPTION 'an archived division cannot be reactivated' USING ERRCODE='23514';
    END IF;
  END IF;

  -- Cycle guard. The composite FK pins the workspace; it cannot see a loop. Walk to the root and
  -- refuse if we return to ourselves. Bounded so a pre-existing loop cannot spin forever.
  IF NEW.parent_division_id IS NOT NULL THEN
    walker := NEW.parent_division_id;
    WHILE walker IS NOT NULL AND hops < 64 LOOP
      IF walker = NEW.id THEN
        RAISE EXCEPTION 'division parent cycle' USING ERRCODE='23514';
      END IF;
      SELECT parent_division_id INTO walker FROM workforce_divisions WHERE id = walker;
      hops := hops + 1;
    END LOOP;
    IF hops >= 64 THEN
      RAISE EXCEPTION 'division hierarchy too deep or cyclic' USING ERRCODE='23514';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_division_guard_trigger
  BEFORE INSERT OR UPDATE ON workforce_divisions
  FOR EACH ROW EXECUTE FUNCTION workforce_division_guard();

-- ── DIV-04: the OWNING edge. At most one per resource, mirroring OWN-01. ─────────────────────
-- Absence is workspace-level and legitimate; "unassigned" is an explicit state, never an empty
-- collection meaning "all" (ASN-06).
CREATE TABLE workforce_division_ownership (
  resource_id UUID NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('agent','team')),
  division_id UUID NOT NULL REFERENCES workforce_divisions(id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- AT MOST ONE owning division per resource -- the primary key says so, rather than a trigger.
  PRIMARY KEY (resource_id),
  FOREIGN KEY (resource_id, resource_kind) REFERENCES workforce_resources(id, kind) ON DELETE RESTRICT
);

-- ── D17: the FUNDING edge. A SECOND, INDEPENDENT table. ─────────────────────────────────────
-- Not a column on the ownership row, because that is exactly the fusion D17 retracts: one row per
-- fact means a team can be re-parented without re-attributing its spend, and re-funded without
-- moving its reporting line.
CREATE TABLE workforce_division_funding (
  resource_id UUID NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('agent','team')),
  division_id UUID NOT NULL REFERENCES workforce_divisions(id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_id),
  FOREIGN KEY (resource_id, resource_kind) REFERENCES workforce_resources(id, kind) ON DELETE RESTRICT
);

-- Both edges must point at a division in the resource's OWN workspace, and a workspace-owned
-- resource cannot be owned by another workspace's division. A personally-owned resource may sit in
-- a division of any workspace it has been assigned to, so that case is left to the assignment
-- layer rather than guessed at here.
CREATE FUNCTION workforce_division_edge_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_ws UUID; div_ws UUID; div_state TEXT;
BEGIN
  SELECT owner_workspace_id INTO owner_ws FROM workforce_resources WHERE id = NEW.resource_id;
  SELECT workspace_id, lifecycle INTO div_ws, div_state FROM workforce_divisions WHERE id = NEW.division_id;

  IF owner_ws IS NOT NULL AND owner_ws <> div_ws THEN
    RAISE EXCEPTION 'a workspace-owned resource cannot belong to another workspace''s division'
      USING ERRCODE='23514';
  END IF;

  -- DIV-03 / OWN-06: an archived division admits nothing new. Existing edges are untouched --
  -- archiving is not a cascade, and the history stays attributable.
  IF TG_OP = 'INSERT' AND div_state <> 'active' THEN
    RAISE EXCEPTION 'an archived division admits no new resources' USING ERRCODE='23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'division edge revision must advance by exactly one' USING ERRCODE='23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_division_ownership_guard
  BEFORE INSERT OR UPDATE ON workforce_division_ownership
  FOR EACH ROW EXECUTE FUNCTION workforce_division_edge_guard();

CREATE TRIGGER workforce_division_funding_guard
  BEFORE INSERT OR UPDATE ON workforce_division_funding
  FOR EACH ROW EXECUTE FUNCTION workforce_division_edge_guard();

-- D17's ergonomic half: creating an OWNING edge defaults the FUNDING edge to the same division, so
-- a small workspace never meets the second concept. It is a DEFAULT, not a fusion -- the funding
-- row is independently updatable and independently revisioned from the moment it exists.
CREATE FUNCTION workforce_division_default_funding() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO workforce_division_funding(resource_id, resource_kind, division_id, created_by_user_id)
  VALUES (NEW.resource_id, NEW.resource_kind, NEW.division_id, NEW.created_by_user_id)
  ON CONFLICT (resource_id) DO NOTHING;   -- never overwrite a funding scope somebody chose
  RETURN NULL;
END;
$$;

CREATE TRIGGER workforce_division_default_funding_trigger
  AFTER INSERT ON workforce_division_ownership
  FOR EACH ROW EXECUTE FUNCTION workforce_division_default_funding();

-- DOWN
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM workforce_divisions)
     OR EXISTS(SELECT 1 FROM workforce_division_ownership)
     OR EXISTS(SELECT 1 FROM workforce_division_funding) THEN
    RAISE EXCEPTION 'workforce division rollback refused: retained records exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP TRIGGER workforce_division_default_funding_trigger ON workforce_division_ownership;
DROP FUNCTION workforce_division_default_funding();
DROP TRIGGER workforce_division_funding_guard ON workforce_division_funding;
DROP TRIGGER workforce_division_ownership_guard ON workforce_division_ownership;
DROP FUNCTION workforce_division_edge_guard();
DROP TABLE workforce_division_funding;
DROP TABLE workforce_division_ownership;
DROP TRIGGER workforce_division_guard_trigger ON workforce_divisions;
DROP FUNCTION workforce_division_guard();
DROP TABLE workforce_divisions;

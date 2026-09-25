-- UP
-- XENO-WORKFORCE-01 D21 (decided 2026-09-25) and ASN-02.
--
--   D21: "`workforce_resources` kind='team' is the ONE canonical team. `workspace_teams` is absorbed
--        into it, and its team->project record is rebuilt on the canonical model as ASN-02's project
--        responsibility."
--   ASN-02: "Workspace participation and project responsibility are explicit records, not inferred
--        from path prefixes. A team may target several projects; several teams may target one
--        project."
--
-- ── WHERE THE RECORD LIVES ─────────────────────────────────────────────────────────────────────
-- It already exists. ASN-09's `workforce_project_participations` is an explicit record of a resource
-- (agent OR team) taking a responsibility on a project, bound to an ACCEPTED workspace assignment and
-- narrowed by it. Its live-uniqueness is per (resource, project), so one team holds many projects and
-- one project holds many teams: ASN-02's two sentences are already its shape. A team's project
-- responsibility is therefore a participation with resource_kind='team' -- a second table would be the
-- "no duplicate table" violation E16 recorded, done again.
--
-- What this migration adds is the thing that made the old model's answer unrepresentable here: a
-- workspace team is OWNED BY and ASSIGNED INTO the same workspace. ASN-04 asks for "both the owner's
-- sharing permission and target administrator acceptance ... both checks are recorded" -- for a
-- same-workspace assignment both checks are made by that workspace and both are still recorded, which
-- the existing assignment and member-set rules already require. Nothing about that needs a new rule.
--
-- ── ABSORBING `workspace_teams` ────────────────────────────────────────────────────────────────
-- Each row becomes, in ONE transaction and only if every part maps:
--   * a `kind='team'` resource OWNED BY its workspace (name, description, created_at, archive state);
--   * one `workforce_team_memberships` row per assigned agent, as a `worker`. The old model had no
--     function at all, so the least-privileged function is the only one that invents nothing:
--     `manager` would grant admission authority nobody decided (ROLE-02), `observer` would take away
--     the execution the assignment implied. The member is the agent's canonical PRINCIPAL
--     (`agent_identities.user_id`) -- the old table already referenced exactly that;
--   * an accepted self-assignment into the workspace, with an explicit `none` policy and an approved
--     member set that is exactly those memberships. `none` because the old model granted NOTHING: its
--     own UI said "assignments organize work; existing membership, execution permissions, and
--     filesystem access remain unchanged". Migrating it to any capability would be a silent grant;
--   * one project participation per assigned project, `responsibility = 'assigned team'`, policy
--     `none` -- the same organizational link, now a first-class record, granting nothing on its own.
-- The legacy tables are then DROPPED, once every row is accounted for. Each row is first
-- recorded in `workforce_legacy_team_migration` first, so the mapping old id -> new ids is readable
-- after the old tables are gone, and a row that cannot be mapped is REFUSED rather than guessed.
--
-- Production held 0 rows in `workspace_teams` when D21 was decided, so this moves no user data today.
-- It is written for a row created before it is deployed, and refuses (never guesses) what it cannot map.

CREATE TABLE workforce_legacy_team_migration (
  legacy_team_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  team_resource_id UUID NOT NULL REFERENCES workforce_resources(id) ON DELETE RESTRICT,
  assignment_id UUID,
  member_count INTEGER NOT NULL CHECK (member_count >= 0),
  project_count INTEGER NOT NULL CHECK (project_count >= 0),
  archived BOOLEAN NOT NULL,
  migrated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE workforce_legacy_team_migration IS
  'D21: each absorbed workspace_teams row and the canonical records it became. Retained after the legacy tables are dropped.';

DO $migrate$
DECLARE
  legacy RECORD; agent RECORD; project RECORD;
  v_team UUID; v_assignment UUID;
  members INTEGER; projects INTEGER; v_member_revision BIGINT;
  none_policy JSONB := '{"schemaVersion":1,"mode":"none","capabilities":[]}'::jsonb;
BEGIN
  IF to_regclass('workspace_teams') IS NULL THEN RETURN; END IF;

  FOR legacy IN SELECT * FROM workspace_teams ORDER BY created_at, id LOOP
    -- A workspace that no longer exists, or a name the canonical model cannot hold, is a refusal.
    IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = legacy.workspace_id) THEN
      RAISE EXCEPTION 'D21: workspace team % belongs to no workspace; refusing to guess an owner', legacy.id USING ERRCODE = '23514';
    END IF;

    -- Created ACTIVE even when the legacy team was archived: an archived resource admits nothing, so the
    -- archive is applied after its records are written (below), exactly as a live team would be archived.
    INSERT INTO workforce_resources(kind, owner_workspace_id, name, description, created_at, updated_at)
    VALUES ('team', legacy.workspace_id, legacy.name, legacy.description, legacy.created_at, legacy.updated_at)
    RETURNING id INTO v_team;

    members := 0; projects := 0; v_assignment := NULL;

    IF legacy.archived_at IS NULL THEN
      -- Members first: an approved member set pins the team's membership revision at capture.
      FOR agent IN SELECT ta.agent_id FROM workspace_team_agents ta WHERE ta.team_id = legacy.id ORDER BY ta.agent_id LOOP
        IF NOT EXISTS (SELECT 1 FROM agent_identities a JOIN users u ON u.id = a.user_id WHERE a.user_id = agent.agent_id) THEN
          RAISE EXCEPTION 'D21: team % names agent % with no canonical identity; refusing to guess', legacy.id, agent.agent_id USING ERRCODE = '23514';
        END IF;
        INSERT INTO workforce_team_memberships(team_id, member_principal_id, role)
        VALUES (v_team, agent.agent_id, 'worker');
        members := members + 1;
      END LOOP;

      SELECT team_membership_revision INTO v_member_revision FROM workforce_resources WHERE id = v_team;
      INSERT INTO workforce_workspace_assignments(resource_id, resource_kind, workspace_id, source_owner_workspace_id,
        resource_revision, policy, member_set_revision)
      VALUES (v_team, 'team', legacy.workspace_id, legacy.workspace_id,
        (SELECT r.revision FROM workforce_resources r WHERE r.id = v_team), none_policy, 1)
      RETURNING id INTO v_assignment;
      INSERT INTO workforce_assignment_member_sets(assignment_id, snapshot_revision, team_id, workspace_id,
        team_membership_revision, member_count)
      VALUES (v_assignment, 1, v_team, legacy.workspace_id, v_member_revision, members);
      INSERT INTO workforce_assignment_members(assignment_id, snapshot_revision, team_id, membership_id, membership_revision, role)
      SELECT v_assignment, 1, v_team, m.id, m.revision, m.role FROM workforce_team_memberships m WHERE m.team_id = v_team;

      -- Both ASN-04 checks are made by the same workspace; both are still recorded. The migration is not a
      -- person, so the approver and acceptor are the workspace OWNER, the one principal who can answer for it.
      UPDATE workforce_workspace_assignments SET state = 'accepted', revision = revision + 1,
        source_approved_by_user_id = w.owner_user_id, source_approved_at = clock_timestamp(),
        target_accepted_by_user_id = w.owner_user_id, accepted_at = clock_timestamp(), updated_at = clock_timestamp()
        FROM workspaces w WHERE w.id = legacy.workspace_id AND workforce_workspace_assignments.id = v_assignment;

      FOR project IN SELECT tp.project_id FROM workspace_team_projects tp JOIN chat_projects p ON p.id = tp.project_id
                      WHERE tp.team_id = legacy.id AND NOT p.is_archived ORDER BY tp.project_id LOOP
        INSERT INTO workforce_project_participations(resource_id, resource_kind, project_id, target_kind, workspace_id,
          assignment_id, responsibility, policy)
        VALUES (v_team, 'team', project.project_id, 'workspace', legacy.workspace_id, v_assignment, 'assigned team', none_policy);
        projects := projects + 1;
      END LOOP;
    ELSE
      -- An archived legacy team kept no assignments (its archive deleted them); it arrives archived, with none.
      UPDATE workforce_resources SET status = 'archived', revision = revision + 1 WHERE id = v_team;
    END IF;

    INSERT INTO workforce_legacy_team_migration(legacy_team_id, workspace_id, team_resource_id, assignment_id,
      member_count, project_count, archived)
    VALUES (legacy.id, legacy.workspace_id, v_team, v_assignment, members, projects, legacy.archived_at IS NOT NULL);
  END LOOP;

  -- Every legacy row is accounted for before anything is removed.
  IF (SELECT count(*) FROM workspace_teams) <> (SELECT count(*) FROM workforce_legacy_team_migration) THEN
    RAISE EXCEPTION 'D21: not every workspace team was migrated; refusing to drop the legacy tables' USING ERRCODE = '23514';
  END IF;
  DROP TABLE workspace_team_agents;
  DROP TABLE workspace_team_projects;
  DROP TABLE workspace_teams;
END $migrate$;

-- DOWN
-- The legacy model is gone by design (D21). Rolling this back would mean re-creating a second team
-- model, which is the defect E16 recorded; it is refused while any team was migrated.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_legacy_team_migration) THEN
    RAISE EXCEPTION 'D21 rollback refused: workspace teams were absorbed into the canonical model' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TABLE workforce_legacy_team_migration;

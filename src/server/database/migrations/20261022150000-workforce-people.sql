-- UP
-- XENO Company employee features (xeno-company/SPEC.md §7.3 D-EMP, DECIDED 2026-10-20; XENO-WORKFORCE-01 §8.2d
-- LIFE-01 and decision D18). Employment is an ADMISSION plus a TITLE: membership stays the workspace's
-- relationship_tuples (humans and agents alike), divisions stay workforce_divisions, teams stay workforce_resources.
-- These tables are an ANNEX to that membership — profile facts, time off and onboarding receipts — and are NEVER
-- consulted for a permission decision. There is no second org store: a profile names a division and a team by their
-- existing ids, and the org chart is the manager edge read across the roster.

CREATE TABLE workforce_employee_profiles (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  principal_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL DEFAULT '',
  division_id UUID,
  team_resource_id UUID REFERENCES workforce_resources(id) ON DELETE SET NULL,
  manager_principal_id UUID REFERENCES users(id) ON DELETE SET NULL,
  start_date DATE,
  end_date DATE,
  location VARCHAR(120) NOT NULL DEFAULT '',
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  -- { "days": [1..7 ISO weekday], "start": "HH:MM", "end": "HH:MM" } in `timezone`; NULL = no stated hours
  working_hours JSONB,
  -- PRIVATE: readable by the person, the workspace's admins and their managers (any level) only.
  private_phone VARCHAR(40) NOT NULL DEFAULT '',
  emergency_contact VARCHAR(200) NOT NULL DEFAULT '',
  private_notes TEXT NOT NULL DEFAULT '',
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, principal_id),
  CONSTRAINT workforce_profile_not_own_manager CHECK (manager_principal_id IS NULL OR manager_principal_id <> principal_id),
  CONSTRAINT workforce_profile_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  -- the division must be of the SAME workspace: unrepresentable otherwise (workforce_divisions UNIQUE (id, workspace_id))
  CONSTRAINT workforce_profile_division FOREIGN KEY (division_id, workspace_id) REFERENCES workforce_divisions(id, workspace_id) ON DELETE RESTRICT
);
CREATE INDEX workforce_profile_manager ON workforce_employee_profiles(workspace_id, manager_principal_id) WHERE manager_principal_id IS NOT NULL;

CREATE TABLE workforce_time_off (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  principal_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('vacation', 'sick', 'leave', 'holiday', 'other')),
  note VARCHAR(500) NOT NULL DEFAULT '',  -- private, like the profile's private fields
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT workforce_time_off_span CHECK (ends_at > starts_at)
);
CREATE INDEX workforce_time_off_principal ON workforce_time_off(workspace_id, principal_id, starts_at) WHERE cancelled_at IS NULL;

-- One receipt per onboarding / offboarding: what it created or changed. Append-only.
CREATE TABLE workforce_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  principal_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('onboarding', 'offboarding')),
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workforce_lifecycle_one_onboarding ON workforce_lifecycle_events(workspace_id, principal_id) WHERE kind = 'onboarding';

CREATE OR REPLACE FUNCTION workforce_lifecycle_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'workforce_lifecycle_events is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER workforce_lifecycle_immutable BEFORE UPDATE OR DELETE ON workforce_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION workforce_lifecycle_immutable();

-- DOWN
DROP TRIGGER IF EXISTS workforce_lifecycle_immutable ON workforce_lifecycle_events;
DROP FUNCTION IF EXISTS workforce_lifecycle_immutable();
DROP TABLE IF EXISTS workforce_lifecycle_events;
DROP TABLE IF EXISTS workforce_time_off;
DROP TABLE IF EXISTS workforce_employee_profiles;

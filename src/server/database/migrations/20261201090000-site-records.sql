-- UP
-- XENO Sites: a published site as a WORKSPACE RECORD (xeno-sites decision 0001 §3, coordinated with the Workshop session
-- 2026-11-09; owner: "wokrshop i thin klwill need sites yes but coorindte with it").
--
-- The site is built in XENO Workshop and served by XENO Sites hosting (xeno-sites/hosting, decision 0002). Workshop's own
-- tables are the source of truth for its screens; these rows are the workspace's record of what is public, by whom and
-- since when, and what agents read on XENO MCP. They are written ONLY from events the building app sends as the signed-in
-- person (POST /api/sites/events, scope sites:write); nothing here talks to the hosting.
--
-- Three tables, one fact each:
--   site_records          the site: its hosting id and name, the address, which version is live, its domains
--   site_record_versions  every frozen version the app published (a preview until made live). Never changes.
--   site_record_events    who did what, when. Never changes. Going live, rolling back and unpublishing are a PERSON's
--                         act: the service refuses an agent and so does the trigger below.

CREATE TABLE site_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- which app built it and its project there (Workshop: client xeno-workshop, its project uuid)
  app TEXT NOT NULL CHECK (app ~ '^[a-z][a-z0-9-]{1,63}$'),
  project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
  hosting_site_id TEXT NOT NULL CHECK (hosting_site_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name TEXT NOT NULL CHECK (name ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  url TEXT NOT NULL CHECK (url ~ '^https://[a-z0-9.-]+(/.*)?$' AND length(url) <= 300),
  live_deploy TEXT CHECK (live_deploy IS NULL OR live_deploy ~ '^[A-Za-z0-9_-]{1,64}$'),
  live_since TIMESTAMPTZ,
  domains JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(domains) = 'array'),
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (app, hosting_site_id)
);
CREATE INDEX site_records_workspace ON site_records(workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE site_record_versions (
  site_id UUID NOT NULL REFERENCES site_records(id) ON DELETE CASCADE,
  deploy TEXT NOT NULL CHECK (deploy ~ '^[A-Za-z0-9_-]{1,64}$'),
  url TEXT NOT NULL CHECK (url ~ '^https://[a-z0-9.-]+(/.*)?$' AND length(url) <= 300),
  files INTEGER NOT NULL CHECK (files BETWEEN 0 AND 20000),
  bytes BIGINT NOT NULL CHECK (bytes BETWEEN 0 AND 524288000),
  branch TEXT CHECK (branch IS NULL OR length(branch) <= 200),
  -- the building app's preflight result, as data: {ok, warnings: [codes]}
  checks JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checks) = 'object'),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, deploy)
);

CREATE TABLE site_record_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES site_records(id) ON DELETE CASCADE,
  -- the app's own id for the event: a retried send is the same event, recorded once
  event_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('claimed','version','live','unpublished','renamed','disabled','enabled','domain_added','domain_removed','deleted')),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  deploy TEXT CHECK (deploy IS NULL OR deploy ~ '^[A-Za-z0-9_-]{1,64}$'),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (site_id, event_id)
);
CREATE INDEX site_record_events_site ON site_record_events(site_id, at DESC);

-- A published version and the log never change; a person deleted later only loses their name on it. The trigger's
-- argument names the one column a user deletion may clear (ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION site_record_frozen() RETURNS trigger AS $$
DECLARE who TEXT := TG_ARGV[0];
BEGIN
  IF (to_jsonb(NEW) ->> who) IS NULL AND (to_jsonb(NEW) - who) = (to_jsonb(OLD) - who) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'sites: a version and its log never change' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER site_record_versions_frozen BEFORE UPDATE ON site_record_versions FOR EACH ROW EXECUTE FUNCTION site_record_frozen('created_by');
CREATE TRIGGER site_record_events_frozen BEFORE UPDATE ON site_record_events FOR EACH ROW EXECUTE FUNCTION site_record_frozen('actor_user_id');

-- Making a site live, rolling it back or taking it down is a person's act, whatever the service does.
CREATE OR REPLACE FUNCTION site_record_live_by_person() RETURNS trigger AS $$
BEGIN
  IF NEW.kind IN ('live','unpublished') AND (NEW.actor_user_id IS NULL OR EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.actor_user_id)) THEN
    RAISE EXCEPTION 'sites: only a person can make a site live or take it down' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER site_record_events_live_by_person BEFORE INSERT ON site_record_events FOR EACH ROW EXECUTE FUNCTION site_record_live_by_person();

-- DOWN
DO $$ BEGIN
  IF to_regclass('site_records') IS NOT NULL AND EXISTS (SELECT 1 FROM site_records) THEN
    RAISE EXCEPTION 'site record rollback refused: sites are recorded (who published what is kept)' USING ERRCODE = 'check_violation';
  END IF;
END $$;
DROP TRIGGER IF EXISTS site_record_events_live_by_person ON site_record_events;
DROP TRIGGER IF EXISTS site_record_events_frozen ON site_record_events;
DROP TRIGGER IF EXISTS site_record_versions_frozen ON site_record_versions;
DROP FUNCTION IF EXISTS site_record_live_by_person();
DROP FUNCTION IF EXISTS site_record_frozen();
DROP TABLE IF EXISTS site_record_events;
DROP TABLE IF EXISTS site_record_versions;
DROP TABLE IF EXISTS site_records;

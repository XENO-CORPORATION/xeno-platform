-- UP
-- XENO Places, phase 1 (xeno-places/SPEC.md §3, "Places Backend Contract.md" §3; WORKFORCE-01 §8.11 D-7).
-- Places owns exactly three things: a building's LAYOUT, ephemeral PRESENCE (never persisted) and HOSTED SESSIONS.
-- Every org fact (floors, pods, desks, occupants) is READ from the workforce records at request time; nothing here
-- names a division, team or membership as an owner. A place is a PROJECTION owned by the scope it shows: it is
-- created with its workspace (trigger below), never transferred, and recreated rather than moved.
--
-- ADDITIVE ONLY: four new tables, two functions, one trigger. Nothing existing is altered. DOWN drops exactly these.

CREATE TABLE IF NOT EXISTS places (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- D-7: owned by the scope it shows. CASCADE is correct for a projection: it is recreated, never transferred.
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL CHECK (length(btrim(name)) > 0),
  style         TEXT NOT NULL DEFAULT 'glass' CHECK (style IN ('glass','concrete','loft')),
  -- where it stands: a XENO city (polis/geo.js CITIES) chosen from the owner's own Language & region setting
  city_id       TEXT NOT NULL,
  region_id     TEXT NOT NULL,
  location_source TEXT NOT NULL CHECK (location_source IN ('owner_region','owner_timezone','default')),
  plot_index    INTEGER NOT NULL CHECK (plot_index >= 0),
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  lifecycle     TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','archived')),
  revision      BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at     TIMESTAMPTZ,
  archived_at   TIMESTAMPTZ
);
-- one building per workspace among active places
CREATE UNIQUE INDEX IF NOT EXISTS places_one_active_per_workspace ON places (workspace_id) WHERE lifecycle = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS places_plot_unique ON places (city_id, plot_index);

-- The layout keeps COORDINATES ONLY (contract §7): bays, desk slot per membership id, pod positions, fixtures.
-- Who belongs where is never stored here; the service refuses any other key.
CREATE TABLE IF NOT EXISTS place_layouts (
  place_id   UUID PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  bays       INTEGER NOT NULL DEFAULT 4 CHECK (bays BETWEEN 4 AND 8),
  layout     JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(layout) = 'object'),
  revision   BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A time-boxed guest pass. It narrows and never widens: permissions ⊆ watch·talk·handoff (never edit/host).
CREATE TABLE IF NOT EXISTS place_hosted_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id          UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  host_principal_id UUID REFERENCES users(id) ON DELETE SET NULL,
  code              TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  audience          TEXT NOT NULL CHECK (audience IN ('invite','code','public')),
  invitees          UUID[] NOT NULL DEFAULT '{}',
  permissions       TEXT[] NOT NULL CHECK (permissions <@ ARRAY['watch','talk','handoff']::text[] AND 'watch' = ANY(permissions)),
  floors            UUID[],          -- NULL = all floors; otherwise division ids
  title             TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 120),
  state             TEXT NOT NULL DEFAULT 'live' CHECK (state IN ('live','ended')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at           TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ,
  CHECK (ends_at > started_at AND ends_at <= started_at + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS place_hosted_sessions_live ON place_hosted_sessions (place_id) WHERE state = 'live';
CREATE TABLE IF NOT EXISTS place_session_guests (
  session_id UUID NOT NULL REFERENCES place_hosted_sessions(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);

-- Idempotency fence (contract §2): (actor, op, requestId) answers the ORIGINAL receipt on retry; the same key with a
-- different input is refused.
CREATE TABLE IF NOT EXISTS place_operations (
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  op            TEXT NOT NULL,
  request_id    TEXT NOT NULL CHECK (request_id ~ '^[A-Za-z0-9._:-]{8,128}$'),
  input_hash    TEXT NOT NULL,
  operation_id  UUID NOT NULL DEFAULT gen_random_uuid(),
  result        JSONB NOT NULL,
  receipt       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, op, request_id)
);

-- Where a person's building stands. THE ONE MAPPING (the backfill and the trigger both call it): the person's own
-- Language & region setting (user_settings.settings.workspace.region = { region: <ISO country>, tz: <IANA zone> },
-- written by Settings › Language & region), country first, then time zone, else the first XENO city.
CREATE OR REPLACE FUNCTION places_home_city(p_owner UUID, OUT city_id TEXT, OUT region_id TEXT, OUT source TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE cc TEXT; tz TEXT;
BEGIN
  SELECT upper(s.settings #>> '{workspace,region,region}'), s.settings #>> '{workspace,region,tz}'
    INTO cc, tz FROM user_settings s WHERE s.user_id = p_owner LIMIT 1;
  region_id := CASE
    WHEN cc IN ('US') AND tz ~ '^America/(Los_Angeles|Vancouver|Phoenix|Denver|Boise|Anchorage)' THEN 'na-west'
    WHEN cc IN ('US') THEN 'na-east'
    WHEN cc IN ('CA') THEN 'na-north'
    WHEN cc IN ('BR','AR','CL','UY','PY') THEN 'sa-south'
    WHEN cc IN ('SE','NO','DK','FI','IS') THEN 'eu-north'
    WHEN cc IN ('DE','AT','CH','PL','CZ','SK','HU','RO','BG','SI','HR','RS','UA','LT','LV','EE') THEN 'eu-central'
    WHEN cc IN ('GB','IE','FR','ES','PT','IT','NL','BE','LU','MT','GR','CY') THEN 'eu-west'
    WHEN cc IN ('AE','SA','QA','KW','BH','OM') THEN 'af-gulf'
    WHEN cc IN ('NG','GH','SN','CI') THEN 'af-west'
    WHEN cc IN ('JP','KR','TW') THEN 'as-east'
    WHEN cc IN ('IN','PK','BD','LK','NP') THEN 'as-south'
    WHEN cc IN ('SG','MY','TH','ID','PH','VN') THEN 'as-se'
    WHEN cc IN ('AU','NZ') THEN 'oc-aus'
  END;
  IF region_id IS NOT NULL THEN source := 'owner_region';
  ELSE
    region_id := CASE
      WHEN tz ~ '^America/(Los_Angeles|Vancouver|Tijuana|Phoenix|Denver|Boise|Anchorage)' THEN 'na-west'
      WHEN tz ~ '^America/(Toronto|Montreal|Winnipeg|Edmonton|Halifax|Regina)' THEN 'na-north'
      WHEN tz ~ '^America/(New_York|Chicago|Detroit|Indiana|Kentucky)' THEN 'na-east'
      WHEN tz ~ '^America/(Sao_Paulo|Argentina|Buenos_Aires|Santiago|Montevideo|Asuncion)' THEN 'sa-south'
      WHEN tz ~ '^Europe/(Stockholm|Oslo|Copenhagen|Helsinki)|^Atlantic/Reykjavik' THEN 'eu-north'
      WHEN tz ~ '^Europe/(Berlin|Vienna|Zurich|Warsaw|Prague|Bratislava|Budapest|Bucharest|Sofia|Ljubljana|Zagreb|Belgrade|Kyiv|Kiev|Vilnius|Riga|Tallinn)' THEN 'eu-central'
      WHEN tz ~ '^Europe/' THEN 'eu-west'
      WHEN tz ~ '^Asia/(Dubai|Riyadh|Qatar|Kuwait|Bahrain|Muscat)' THEN 'af-gulf'
      WHEN tz ~ '^Africa/(Lagos|Accra|Dakar|Abidjan)' THEN 'af-west'
      WHEN tz ~ '^Asia/(Tokyo|Seoul|Taipei)' THEN 'as-east'
      WHEN tz ~ '^Asia/(Kolkata|Calcutta|Karachi|Dhaka|Colombo|Kathmandu)' THEN 'as-south'
      WHEN tz ~ '^Asia/(Singapore|Kuala_Lumpur|Bangkok|Jakarta|Manila|Ho_Chi_Minh)' THEN 'as-se'
      WHEN tz ~ '^(Australia/|Pacific/Auckland)' THEN 'oc-aus'
    END;
    source := CASE WHEN region_id IS NOT NULL THEN 'owner_timezone' ELSE 'default' END;
    region_id := COALESCE(region_id, 'eu-west');
  END IF;
  city_id := CASE region_id
    WHEN 'eu-west' THEN 'meridian' WHEN 'na-west' THEN 'halcyon' WHEN 'eu-central' THEN 'lindgren'
    WHEN 'na-east' THEN 'harbor' WHEN 'eu-north' THEN 'nordhavn' WHEN 'as-east' THEN 'sakura'
    WHEN 'as-se' THEN 'lumen' WHEN 'as-south' THEN 'vega' WHEN 'sa-south' THEN 'solace'
    WHEN 'af-west' THEN 'atlas' WHEN 'af-gulf' THEN 'aurum' WHEN 'oc-aus' THEN 'southgate'
    WHEN 'na-north' THEN 'aurora' END;
END $$;

-- Give one workspace its default building. Idempotent: an active place is kept as it is.
CREATE OR REPLACE FUNCTION places_provision(p_workspace UUID) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE w RECORD; loc RECORD; pid UUID; nxt INTEGER;
BEGIN
  SELECT id INTO pid FROM places WHERE workspace_id = p_workspace AND lifecycle = 'active';
  IF pid IS NOT NULL THEN RETURN pid; END IF;
  SELECT id, owner_user_id, name, status INTO w FROM workspaces WHERE id = p_workspace;
  IF w.id IS NULL OR w.status <> 'active' THEN RETURN NULL; END IF;
  SELECT * INTO loc FROM places_home_city(w.owner_user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('places-plot:' || loc.city_id, 0));
  SELECT COALESCE(max(plot_index) + 1, 0) INTO nxt FROM places WHERE city_id = loc.city_id;
  INSERT INTO places (workspace_id, name, city_id, region_id, location_source, plot_index)
    VALUES (w.id, w.name, loc.city_id, loc.region_id, loc.source, nxt) RETURNING id INTO pid;
  INSERT INTO place_layouts (place_id) VALUES (pid);
  RETURN pid;
END $$;

CREATE OR REPLACE FUNCTION places_on_workspace_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM places_provision(NEW.id); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS places_default_building ON workspaces;
CREATE TRIGGER places_default_building AFTER INSERT ON workspaces FOR EACH ROW EXECUTE FUNCTION places_on_workspace_insert();

-- DOWN
DROP TRIGGER IF EXISTS places_default_building ON workspaces;
DROP FUNCTION IF EXISTS places_on_workspace_insert();
DROP FUNCTION IF EXISTS places_provision(UUID);
DROP FUNCTION IF EXISTS places_home_city(UUID);
DROP TABLE IF EXISTS place_operations;
DROP TABLE IF EXISTS place_session_guests;
DROP TABLE IF EXISTS place_hosted_sessions;
DROP TABLE IF EXISTS place_layouts;
DROP TABLE IF EXISTS places;

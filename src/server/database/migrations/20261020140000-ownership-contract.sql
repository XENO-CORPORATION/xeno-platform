-- UP
-- D-1 / D-6 CONTRACT step (XENO-WORKFORCE-01 §8.11.1, owner approval 2026-10-20). The expand steps
-- (20261016180000 personal workspaces, 20261020100000 seller workspace) made the workspace the owner of record and
-- kept both shapes readable. This step makes the workspace the ONLY shape:
--   - every user_files row names its workspace; a legacy workspace-less file moves to its owner's PERSONAL
--     workspace (an agent's file to its accountable human's), exactly what ownerScopeOf already resolved it to;
--   - a person who holds such a row but has no personal workspace yet gets one, made the way
--     personalWorkspace.ensurePersonalWorkspace makes it (row + owner tuple + audit);
--   - marketplace developers and payouts always name their seller workspace; a listing names one unless it is
--     FIRST-PARTY (developer_id IS NULL): its NULL seller means XENO, and that is allowed explicitly.
-- A row with no person behind it (a service principal's file) is REFUSED, not guessed: the count is in the error,
-- and scripts/ownership-contract-dryrun.mjs reports it before deploy.
-- Idempotent. Every row it rewrites or creates is recorded, so DOWN restores the expand-step state exactly.

CREATE TABLE IF NOT EXISTS ownership_contract_backfill (
  kind TEXT NOT NULL CHECK (kind IN ('user_file', 'workspace', 'developer', 'listing', 'payout')),
  id   UUID NOT NULL,
  PRIMARY KEY (kind, id)
);

-- the person behind an owner id: an agent resolves to its accountable human; a service principal has none
CREATE OR REPLACE FUNCTION ownership_person_of(owner UUID) RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT p.id FROM users p
   WHERE p.id = COALESCE((SELECT ai.owner_user_id FROM agent_identities ai WHERE ai.user_id = owner), owner)
     AND p.role IS DISTINCT FROM 'service'
     AND NOT EXISTS (SELECT 1 FROM agent_identities a2 WHERE a2.user_id = p.id)
$$;

-- a person's personal workspace, made when missing (the SQL twin of ensurePersonalWorkspace, same lock key);
-- `record` notes a workspace this migration created so DOWN can remove exactly those
CREATE OR REPLACE FUNCTION ownership_personal_workspace(person UUID, record BOOLEAN DEFAULT FALSE) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE ws UUID; label TEXT;
BEGIN
  IF person IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO ws FROM workspaces WHERE owner_user_id = person AND workspace_type = 'personal' LIMIT 1;
  IF ws IS NOT NULL THEN RETURN ws; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-workspace-creation:' || person::text, 0));
  SELECT id INTO ws FROM workspaces WHERE owner_user_id = person AND workspace_type = 'personal' LIMIT 1;
  IF ws IS NOT NULL THEN RETURN ws; END IF;
  SELECT COALESCE(NULLIF(TRIM(COALESCE(display_name, username)), ''), 'Personal') INTO label FROM users WHERE id = person;
  INSERT INTO workspaces (owner_user_id, workspace_type, name, slug)
  VALUES (person, 'personal', LEFT(CASE WHEN label ~* 'workspace' THEN label ELSE label || '''s Workspace' END, 200),
          'personal-' || md5(random()::text || clock_timestamp()::text || person::text))
  RETURNING id INTO ws;
  INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id)
  VALUES ('workspace', ws::text, 'owner', 'user', person::text) ON CONFLICT DO NOTHING;
  INSERT INTO workspace_audit (workspace_id, actor_user_id, action, target, metadata)
  VALUES (ws, person, 'workspace.create', ws::text, '{"type":"personal","by":"ownership-contract"}'::jsonb);
  IF record THEN INSERT INTO ownership_contract_backfill (kind, id) VALUES ('workspace', ws) ON CONFLICT DO NOTHING; END IF;
  RETURN ws;
END $$;

-- 1. files: a workspace-less file moves to its person's personal workspace (keeping owner_user_id: the person stays
--    the accountable owner of a personal file; the replacement scope rule is the trigger in step 4)
ALTER TABLE user_files DROP CONSTRAINT IF EXISTS user_files_scope_check;
WITH moved AS (
  UPDATE user_files f SET workspace_id = ownership_personal_workspace(ownership_person_of(COALESCE(f.owner_user_id, f.user_id)), TRUE)
   WHERE f.workspace_id IS NULL AND ownership_person_of(COALESCE(f.owner_user_id, f.user_id)) IS NOT NULL
  RETURNING f.id
)
INSERT INTO ownership_contract_backfill (kind, id) SELECT 'user_file', id FROM moved ON CONFLICT DO NOTHING;

-- 2. marketplace: developers, then their listings and payouts
WITH d AS (
  UPDATE marketplace_developers d SET seller_workspace_id = ownership_personal_workspace(ownership_person_of(d.user_id), TRUE)
   WHERE d.seller_workspace_id IS NULL AND ownership_person_of(d.user_id) IS NOT NULL RETURNING d.id
) INSERT INTO ownership_contract_backfill (kind, id) SELECT 'developer', id FROM d ON CONFLICT DO NOTHING;
WITH l AS (
  UPDATE marketplace_listings l SET seller_workspace_id = d.seller_workspace_id FROM marketplace_developers d
   WHERE l.developer_id = d.id AND l.seller_workspace_id IS NULL AND d.seller_workspace_id IS NOT NULL RETURNING l.id
) INSERT INTO ownership_contract_backfill (kind, id) SELECT 'listing', id FROM l ON CONFLICT DO NOTHING;
WITH p AS (
  UPDATE marketplace_payouts p SET seller_workspace_id = d.seller_workspace_id FROM marketplace_developers d
   WHERE p.developer_id = d.id AND p.seller_workspace_id IS NULL AND d.seller_workspace_id IS NOT NULL RETURNING p.id
) INSERT INTO ownership_contract_backfill (kind, id) SELECT 'payout', id FROM p ON CONFLICT DO NOTHING;

-- 3. refuse to contract over rows with no person behind them
DO $$
DECLARE n_files INT; n_dev INT; n_pay INT; n_list INT;
BEGIN
  SELECT count(*) INTO n_files FROM user_files WHERE workspace_id IS NULL;
  SELECT count(*) INTO n_dev   FROM marketplace_developers WHERE seller_workspace_id IS NULL;
  SELECT count(*) INTO n_pay   FROM marketplace_payouts WHERE seller_workspace_id IS NULL;
  SELECT count(*) INTO n_list  FROM marketplace_listings WHERE developer_id IS NOT NULL AND seller_workspace_id IS NULL;
  IF n_files + n_dev + n_pay + n_list > 0 THEN
    RAISE EXCEPTION 'ownership contract refused: % file(s), % developer(s), % payout(s), % third-party listing(s) have no person to own them (see scripts/ownership-contract-dryrun.mjs)', n_files, n_dev, n_pay, n_list;
  END IF;
END $$;

-- 4. every new file names its workspace: a writer that predates D-1 gets its person's personal workspace.
-- The scope rule (20260829120000 user_files_scope_check: exactly one of owner_user_id / workspace_id) becomes:
-- workspace_id always set, and an owner_user_id (a PERSONAL file) is allowed only inside that owner's person's
-- personal workspace. A CHECK cannot read another table, so the trigger enforces it.
CREATE OR REPLACE FUNCTION user_files_workspace_fill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := ownership_personal_workspace(ownership_person_of(COALESCE(NEW.owner_user_id, NEW.user_id)));
  END IF;
  IF NEW.owner_user_id IS NOT NULL AND NEW.workspace_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id AND w.workspace_type = 'personal'
          AND w.owner_user_id = ownership_person_of(NEW.owner_user_id)) THEN
    RAISE EXCEPTION 'user_files scope: a personal file (owner set) belongs to its owner''s personal workspace'
      USING ERRCODE = '23514', CONSTRAINT = 'user_files_scope_check';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS user_files_workspace_fill ON user_files;
CREATE TRIGGER user_files_workspace_fill BEFORE INSERT OR UPDATE OF workspace_id, owner_user_id ON user_files
  FOR EACH ROW EXECUTE FUNCTION user_files_workspace_fill();

-- a developer registered by a person with no personal workspace yet gets one (was: left NULL)
CREATE OR REPLACE FUNCTION marketplace_developer_seller_fill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.seller_workspace_id IS NULL THEN
    NEW.seller_workspace_id := ownership_personal_workspace(ownership_person_of(NEW.user_id));
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE user_files ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE marketplace_developers ALTER COLUMN seller_workspace_id SET NOT NULL;
ALTER TABLE marketplace_payouts ALTER COLUMN seller_workspace_id SET NOT NULL;
-- a third-party listing names its seller; a FIRST-PARTY listing (developer_id IS NULL) sells as XENO: NULL seller
ALTER TABLE marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_seller_named;
ALTER TABLE marketplace_listings ADD CONSTRAINT marketplace_listings_seller_named
  CHECK (developer_id IS NULL OR seller_workspace_id IS NOT NULL);

-- DOWN
ALTER TABLE marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_seller_named;
ALTER TABLE marketplace_payouts ALTER COLUMN seller_workspace_id DROP NOT NULL;
ALTER TABLE marketplace_developers ALTER COLUMN seller_workspace_id DROP NOT NULL;
ALTER TABLE user_files ALTER COLUMN workspace_id DROP NOT NULL;
DROP TRIGGER IF EXISTS user_files_workspace_fill ON user_files;
DROP FUNCTION IF EXISTS user_files_workspace_fill();
-- the expand step's developer fill, exactly as 20261020100000 wrote it
CREATE OR REPLACE FUNCTION marketplace_developer_seller_fill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.seller_workspace_id IS NULL THEN
    SELECT w.id INTO NEW.seller_workspace_id FROM workspaces w WHERE w.owner_user_id = NEW.user_id AND w.workspace_type = 'personal' LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
UPDATE marketplace_payouts SET seller_workspace_id = NULL WHERE id IN (SELECT id FROM ownership_contract_backfill WHERE kind = 'payout');
UPDATE marketplace_listings SET seller_workspace_id = NULL WHERE id IN (SELECT id FROM ownership_contract_backfill WHERE kind = 'listing');
UPDATE marketplace_developers SET seller_workspace_id = NULL WHERE id IN (SELECT id FROM ownership_contract_backfill WHERE kind = 'developer');
-- every personal file (owner set) goes back to the expand shape, including ones the trigger filled after UP
UPDATE user_files SET workspace_id = NULL WHERE owner_user_id IS NOT NULL;
ALTER TABLE user_files DROP CONSTRAINT IF EXISTS user_files_scope_check;
ALTER TABLE user_files ADD CONSTRAINT user_files_scope_check CHECK ((owner_user_id IS NULL) <> (workspace_id IS NULL));
DELETE FROM relationship_tuples WHERE object_type = 'workspace' AND object_id IN (SELECT id::text FROM ownership_contract_backfill WHERE kind = 'workspace');
DELETE FROM workspace_audit WHERE workspace_id IN (SELECT id FROM ownership_contract_backfill WHERE kind = 'workspace');
DELETE FROM workspaces WHERE id IN (SELECT id FROM ownership_contract_backfill WHERE kind = 'workspace');
DROP FUNCTION IF EXISTS ownership_personal_workspace(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS ownership_person_of(UUID);
DROP TABLE IF EXISTS ownership_contract_backfill;

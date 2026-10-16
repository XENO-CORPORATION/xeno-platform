-- UP
-- The workspace is the tenancy ROOT, from the moment an account exists (owner, 2026-10-16: "a workspace is the main
-- thing ... we do not have workspace creations for global accounts, that own the projects, teams, agents").
--
-- 1. COMPANY is a workspace type (xeno-company/SPEC.md §4.1: "generalize workspaces, do not create organizations").
--    'team' stays readable: older rows and older code keep working, and every reader that tested `!== 'personal'`
--    already treats both as an organization. New organizations are created as 'company'.
-- 2. EVERY PERSON HAS A PERSONAL WORKSPACE. Until now one was made lazily on the first workspace request, so an
--    account could own projects, files and agents with no root, and three different functions created it. From now
--    on the account-creation paths make it (services/personalWorkspace.ensurePersonalWorkspace), and this backfills
--    every human account that has none. Agents and service principals are not people and get no workspace: an agent
--    belongs to its owner's scope (agent_identities), never to a workspace of its own.
--
-- xeno-company/SPEC.md §4.1 said a backfill had "zero benefit" because provisioning was lazy. That held while nothing
-- below a workspace needed it to exist; divisions, company agents, Storage team folders and connections all do, and a
-- lazily created root is created by whichever code happens to ask first, under no lock.
ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_workspace_type_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_workspace_type_check CHECK (workspace_type IN ('personal', 'team', 'company'));

WITH people AS (
  SELECT u.id, COALESCE(NULLIF(trim(u.display_name), ''), NULLIF(trim(u.username), ''), 'Personal') AS label
    FROM users u
   WHERE NOT EXISTS (SELECT 1 FROM agent_identities ai WHERE ai.user_id = u.id)
     AND COALESCE(u.role, 'user') <> 'service'
     AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_user_id = u.id AND w.workspace_type = 'personal')
), made AS (
  INSERT INTO workspaces (owner_user_id, workspace_type, name, slug)
  SELECT id, 'personal',
         left(CASE WHEN label ~* 'workspace' THEN label ELSE label || '''s Workspace' END, 200),
         left(trim(both '-' from regexp_replace(lower(label), '[^a-z0-9]+', '-', 'g')), 100) || '-' || substr(md5(id::text || clock_timestamp()::text), 1, 24)
    FROM people
  ON CONFLICT DO NOTHING
  RETURNING id, owner_user_id
), owners AS (
  INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id)
  SELECT 'workspace', id::text, 'owner', 'user', owner_user_id::text FROM made
  ON CONFLICT DO NOTHING
  RETURNING object_id
)
INSERT INTO workspace_audit (workspace_id, actor_user_id, action, target, metadata)
SELECT m.id, m.owner_user_id, 'workspace.create', m.id::text, '{"type":"personal","by":"backfill"}'::jsonb FROM made m;

-- an existing personal workspace whose owner tuple went missing is healed, not left unreachable
INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id)
SELECT 'workspace', w.id::text, 'owner', 'user', w.owner_user_id::text FROM workspaces w
 WHERE w.workspace_type = 'personal' AND w.owner_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- DOWN
-- The backfilled personal workspaces are kept (rows other code may already point at); only the type is narrowed back,
-- which fails, correctly, while any 'company' workspace exists.
ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_workspace_type_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_workspace_type_check CHECK (workspace_type IN ('personal', 'team'));

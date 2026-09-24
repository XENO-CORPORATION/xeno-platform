-- UP
-- XENO-WORKFORCE-01 SES-01 -- a personal workspace backs its owner's scope; it is not a container.
--
--   "Global New Chat defaults to personal conversation ownership with no organizational assignment.
--    Backing personal account scope is not presented as a forced user-created workspace."
--   §12: "resolve personal workspace wrappers through one adapter."
--
-- The adapter (services/personalScope.js) stops NEW resources being parented to a personal wrapper.
-- This migration returns the EXISTING ones to their owner, so the chat a person started on the web
-- stops being readable by whoever is later admitted to that wrapper. Measured before building,
-- 2026-09-23: 26 conversations in production parented to a personal workspace, 0 of them readable by
-- anyone but their owner, because no personal workspace had a second member yet.
--
-- WHICH ROWS MOVE, and why only these. A row moves only when there is exactly ONE plausible owner
-- and it is the wrapper's owner:
--   * a conversation whose workspace_id is a personal wrapper and whose CREATOR is that wrapper's
--     owner -- the web New Chat, which is the whole of the defect;
--   * a project whose workspace_id is a personal wrapper and whose creator is that wrapper's owner;
--   * a library asset under the same rule.
-- A row created by SOMEONE ELSE inside another person's personal wrapper is not guessed at (§18.3:
-- "do not infer personal vs company from ... currently selected workspace"). It stays as it is and is
-- listed by `personal_wrapper_migration_issues` for a person to decide.
--
-- WHAT A MOVE IS. The row's scope columns swap (workspace_id NULL, owner_user_id = the owner) and
-- its `parent@workspace:<wrapper>` tuple is replaced by an `owner@user:<owner>` tuple, in ONE
-- statement per table so the scope CHECKs hold throughout. Nothing else on the row changes, and no
-- message, file or history is touched.
--
-- IDEMPOTENT: every step is keyed on rows still in the old shape, so re-running moves nothing.

DROP TABLE IF EXISTS pg_temp._personal_wrapper_moves;
CREATE TEMP TABLE _personal_wrapper_moves(object_type TEXT, object_id UUID, owner_user_id UUID, wrapper_id UUID) ON COMMIT DROP;

INSERT INTO _personal_wrapper_moves
SELECT 'conversation', c.id, w.owner_user_id, w.id
  FROM chat_conversations c JOIN workspaces w ON w.id = c.workspace_id AND w.workspace_type = 'personal'
 WHERE c.project_id IS NULL AND c.owner_user_id IS NULL AND c.created_by_user_id = w.owner_user_id;
INSERT INTO _personal_wrapper_moves
SELECT 'project', p.id, w.owner_user_id, w.id
  FROM chat_projects p JOIN workspaces w ON w.id = p.workspace_id AND w.workspace_type = 'personal'
 WHERE p.owner_user_id IS NULL AND p.created_by_user_id = w.owner_user_id;
INSERT INTO _personal_wrapper_moves
SELECT 'library_asset', f.id, w.owner_user_id, w.id
  FROM user_files f JOIN workspaces w ON w.id = f.workspace_id AND w.workspace_type = 'personal'
 WHERE f.owner_user_id IS NULL AND f.created_by_user_id = w.owner_user_id;

UPDATE chat_conversations c SET owner_user_id = m.owner_user_id, workspace_id = NULL
  FROM _personal_wrapper_moves m WHERE m.object_type = 'conversation' AND m.object_id = c.id;
UPDATE chat_projects p SET owner_user_id = m.owner_user_id, workspace_id = NULL
  FROM _personal_wrapper_moves m WHERE m.object_type = 'project' AND m.object_id = p.id;
UPDATE user_files f SET owner_user_id = m.owner_user_id, workspace_id = NULL
  FROM _personal_wrapper_moves m WHERE m.object_type = 'library_asset' AND m.object_id = f.id;

-- The tuple half. The parent edge is what made a wrapper member able to read the row; the owner
-- edge is what the adapter writes for a personal resource.
DELETE FROM relationship_tuples t USING _personal_wrapper_moves m
 WHERE t.object_type = m.object_type AND t.object_id = m.object_id::text
   AND t.relation = 'parent' AND t.subject_type = 'workspace' AND t.subject_id = m.wrapper_id::text;
INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT m.object_type, m.object_id::text, 'owner', 'user', m.owner_user_id::text FROM _personal_wrapper_moves m
ON CONFLICT DO NOTHING;

-- What was NOT moved, visibly: resources still parented to a personal wrapper. After this migration
-- the only rows here are ones somebody other than the wrapper's owner created, which is the case this
-- migration refuses to decide.
CREATE OR REPLACE VIEW personal_wrapper_migration_issues AS
SELECT 'conversation'::text AS object_type, c.id AS object_id, w.id AS wrapper_id, w.owner_user_id AS wrapper_owner_id,
       c.created_by_user_id
  FROM chat_conversations c JOIN workspaces w ON w.id = c.workspace_id AND w.workspace_type = 'personal'
UNION ALL
SELECT 'project', p.id, w.id, w.owner_user_id, p.created_by_user_id
  FROM chat_projects p JOIN workspaces w ON w.id = p.workspace_id AND w.workspace_type = 'personal'
UNION ALL
SELECT 'library_asset', f.id, w.id, w.owner_user_id, f.created_by_user_id
  FROM user_files f JOIN workspaces w ON w.id = f.workspace_id AND w.workspace_type = 'personal';

-- DOWN
-- The view only. The data move is deliberately NOT reversed: returning a person's chats to a
-- container that other people can be admitted to would re-open the disclosure this fixes, and a
-- rollback is not a reason to disclose.
DROP VIEW IF EXISTS personal_wrapper_migration_issues;

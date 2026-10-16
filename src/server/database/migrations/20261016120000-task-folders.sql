-- UP
-- Task folders: a task names the Storage folders its work lives in (owner, 2026-10-16: "assign to that task access to
-- a folder in the storage, so I upload files there and whoever takes the task has access to that folder / knows
-- exactly where to take the data from").
--
-- A link is a POINTER, not a copy: the files stay where they are and keep their own sharing. While the link stands,
-- whoever works the task — its assignee, its delegate (an agent), its reviewer — may OPEN the folder and everything in
-- it, now and later, through the same `storage_access` + tuple reconciliation every folder share uses
-- (storageShares.reconcileShares). The role is per link: `viewer` (read the inputs) or `editor` (also put results
-- back: upload into it, rename, new versions). Removing the link, or the person leaving the task, takes the access
-- away again on the next reconcile — access follows the task, it is never left behind.
--
-- Only someone who can EDIT the folder may link it (a person cannot hand out a folder that is not theirs to share),
-- and only someone who can edit the task. A team folder follows its workspace and needs no grant.
CREATE TABLE IF NOT EXISTS task_folders (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  folder_id uuid NOT NULL REFERENCES storage_folders(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, folder_id)
);
CREATE INDEX IF NOT EXISTS task_folders_folder ON task_folders (folder_id);

-- DOWN
DROP TABLE IF EXISTS task_folders;

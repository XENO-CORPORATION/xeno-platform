-- UP
-- Phase 5 — resource tenancy for creative projects. ADDITIVE + REVERSIBLE + guarded.
DO $$
BEGIN
  IF to_regclass('public.image_projects') IS NOT NULL THEN
    ALTER TABLE image_projects ADD COLUMN IF NOT EXISTS workspace_id UUID;
    CREATE INDEX IF NOT EXISTS idx_image_projects_workspace ON image_projects (workspace_id);
  END IF;
  IF to_regclass('public.video_projects') IS NOT NULL THEN
    ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS workspace_id UUID;
    CREATE INDEX IF NOT EXISTS idx_video_projects_workspace ON video_projects (workspace_id);
  END IF;
END $$;

-- DOWN
DO $$
BEGIN
  IF to_regclass('public.image_projects') IS NOT NULL THEN
    DROP INDEX IF EXISTS idx_image_projects_workspace;
    ALTER TABLE image_projects DROP COLUMN IF EXISTS workspace_id;
  END IF;
  IF to_regclass('public.video_projects') IS NOT NULL THEN
    DROP INDEX IF EXISTS idx_video_projects_workspace;
    ALTER TABLE video_projects DROP COLUMN IF EXISTS workspace_id;
  END IF;
END $$;

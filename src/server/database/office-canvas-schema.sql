-- Office Canvas schema
-- Supports multi-canvas persistence, sharing, and collaborator permissions

CREATE TABLE IF NOT EXISTS office_canvases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT 'Untitled Canvas',
  canvas_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  share_token VARCHAR(64) UNIQUE,
  is_public_edit BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS office_canvas_collaborators (
  canvas_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'editor',
  added_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (canvas_id, user_id)
);

-- Backward compatible table evolution (if table already existed)
ALTER TABLE office_canvases ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE office_canvases ADD COLUMN IF NOT EXISTS share_token VARCHAR(64);
ALTER TABLE office_canvases ADD COLUMN IF NOT EXISTS is_public_edit BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE office_canvases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE office_canvases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE office_canvas_collaborators ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'editor';
ALTER TABLE office_canvas_collaborators ADD COLUMN IF NOT EXISTS added_by UUID;
ALTER TABLE office_canvas_collaborators ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_office_canvases_owner ON office_canvases(owner_id);
CREATE INDEX IF NOT EXISTS idx_office_canvases_updated ON office_canvases(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_office_canvases_share_token ON office_canvases(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_office_canvas_collaborators_user ON office_canvas_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_office_canvas_collaborators_canvas ON office_canvas_collaborators(canvas_id);

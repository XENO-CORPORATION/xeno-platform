-- ============================================
-- XENOSTUDIO IMAGE STUDIO DATABASE SCHEMA
-- ============================================
-- This schema defines tables for Image Studio project management,
-- including projects, sessions (chat history), and assets.
-- Pattern follows VideoStudio implementation for consistency.
-- ============================================

-- ============================================
-- IMAGE PROJECTS TABLE
-- ============================================
-- Stores main project metadata and settings
CREATE TABLE IF NOT EXISTS image_projects (
  -- Primary Keys
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Project Info
  title VARCHAR(255) NOT NULL DEFAULT 'Untitled Project',
  description TEXT,

  -- Generation Settings
  model VARCHAR(100) DEFAULT 'flux-kontext',
  seed VARCHAR(50),
  guidance_scale DECIMAL(5, 2) DEFAULT 7.0,
  aspect_ratio VARCHAR(10) DEFAULT '1:1',
  num_images INTEGER DEFAULT 1,

  -- Canvas State (JSON)
  -- Stores: layers, edits, segmentation masks, canvas dimensions, etc.
  canvas_data JSONB,

  -- Style Settings
  style_type VARCHAR(20),  -- 'image', 'prompt', 'preset', null
  style_content TEXT,       -- URL or prompt text
  style_name VARCHAR(255),  -- Display name

  -- Project State
  status VARCHAR(20) DEFAULT 'draft',  -- 'draft', 'completed', 'archived'
  thumbnail_url VARCHAR(500),
  primary_image_url VARCHAR(500),

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_opened_at TIMESTAMP,

  -- Sharing
  is_public BOOLEAN DEFAULT FALSE,
  share_token VARCHAR(255) UNIQUE
);

-- ============================================
-- IMAGE PROJECT SESSIONS TABLE
-- ============================================
-- Stores chat history and conversation snapshots
-- Each session is a saved state/checkpoint in the project
CREATE TABLE IF NOT EXISTS image_project_sessions (
  -- Primary Keys
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES image_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Session Info
  session_title VARCHAR(255) NOT NULL,

  -- State Snapshots (JSON)
  messages JSONB NOT NULL,          -- Full chat messages array
  canvas_snapshot JSONB,             -- Canvas state at this checkpoint
  settings_snapshot JSONB,           -- Generation settings at this checkpoint

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  message_count INTEGER DEFAULT 0,
  thumbnail_url VARCHAR(500)
);

-- ============================================
-- IMAGE ASSETS TABLE
-- ============================================
-- Stores all images (generated, uploaded, edited)
CREATE TABLE IF NOT EXISTS image_assets (
  -- Primary Keys
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES image_projects(id) ON DELETE CASCADE,
  session_id UUID REFERENCES image_project_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Asset Info
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL,  -- 'generated', 'uploaded', 'edited', 'canvas'
  format VARCHAR(50),          -- 'png', 'jpg', 'webp', etc.
  file_url VARCHAR(500) NOT NULL,
  thumbnail_url VARCHAR(500),

  -- Image Properties
  width INTEGER,
  height INTEGER,
  file_size BIGINT,

  -- Generation Metadata (for generated images)
  model_used VARCHAR(100),
  prompt TEXT,
  negative_prompt TEXT,
  seed VARCHAR(50),
  guidance_scale DECIMAL(5, 2),
  generation_time DECIMAL(10, 2),  -- seconds

  -- Source Info
  source VARCHAR(50) DEFAULT 'generation',  -- 'generation', 'upload', 'edit', 'canvas'
  created_at TIMESTAMP DEFAULT NOW(),

  -- Additional Properties
  metadata JSONB  -- response_id, context_id, tags, etc.
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Image Projects
CREATE INDEX IF NOT EXISTS idx_image_projects_user
  ON image_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_image_projects_updated
  ON image_projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_projects_status
  ON image_projects(status);
CREATE INDEX IF NOT EXISTS idx_image_projects_share_token
  ON image_projects(share_token) WHERE share_token IS NOT NULL;

-- Image Project Sessions
CREATE INDEX IF NOT EXISTS idx_image_project_sessions_project
  ON image_project_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_image_project_sessions_user
  ON image_project_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_image_project_sessions_created
  ON image_project_sessions(created_at DESC);

-- Image Assets
CREATE INDEX IF NOT EXISTS idx_image_assets_project
  ON image_assets(project_id);
CREATE INDEX IF NOT EXISTS idx_image_assets_session
  ON image_assets(session_id);
CREATE INDEX IF NOT EXISTS idx_image_assets_user
  ON image_assets(user_id);
CREATE INDEX IF NOT EXISTS idx_image_assets_type
  ON image_assets(type);
CREATE INDEX IF NOT EXISTS idx_image_assets_created
  ON image_assets(created_at DESC);

-- ============================================
-- TRIGGERS FOR AUTO-UPDATING updated_at
-- ============================================

-- Update updated_at timestamp on image_projects
CREATE OR REPLACE FUNCTION update_image_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_image_projects_updated_at
  BEFORE UPDATE ON image_projects
  FOR EACH ROW
  EXECUTE FUNCTION update_image_projects_updated_at();

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE image_projects IS
  'Stores Image Studio projects with generation settings and canvas state';

COMMENT ON TABLE image_project_sessions IS
  'Stores chat history and conversation checkpoints for each project';

COMMENT ON TABLE image_assets IS
  'Stores all images (generated, uploaded, edited) associated with projects';

COMMENT ON COLUMN image_projects.canvas_data IS
  'JSONB storing canvas layers, edits, segmentation masks, and canvas state';

COMMENT ON COLUMN image_project_sessions.messages IS
  'JSONB array of chat messages (role, content, images, timestamp)';

COMMENT ON COLUMN image_assets.metadata IS
  'JSONB storing additional properties like response_id, context_id, tags, etc.';

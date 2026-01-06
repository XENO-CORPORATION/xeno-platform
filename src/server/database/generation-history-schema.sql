-- ============================================
-- XENO IMAGE GENERATION HISTORY SCHEMA
-- ============================================
-- Simple flat table for Midjourney-style history.
-- One row per generation, filtered by user_id.
-- ============================================

-- ============================================
-- IMAGE GENERATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS image_generations (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User ownership (required - login enforced)
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Generation data
  prompt TEXT NOT NULL,
  image_urls JSONB NOT NULL DEFAULT '[]',  -- Array of URLs ["url1", "url2", ...]

  -- Model & Settings
  model VARCHAR(100) NOT NULL,
  aspect_ratio VARCHAR(20),
  resolution VARCHAR(20),
  count INTEGER DEFAULT 1,

  -- Provider metadata
  provider VARCHAR(50),  -- 'fal' or 'replicate'
  generation_time_ms INTEGER,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Primary lookup: user's generations sorted by newest first
CREATE INDEX IF NOT EXISTS idx_image_generations_user
  ON image_generations(user_id);

CREATE INDEX IF NOT EXISTS idx_image_generations_user_created
  ON image_generations(user_id, created_at DESC);

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE image_generations IS
  'Stores all image generations for each user (Midjourney-style flat history)';

COMMENT ON COLUMN image_generations.image_urls IS
  'JSONB array of generated image URLs from CDN';

COMMENT ON COLUMN image_generations.provider IS
  'AI provider used: fal (fal.ai) or replicate (replicate.com)';

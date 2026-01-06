-- Video Studio Database Schema
-- Tables for managing user video projects, assets, and rendering jobs

-- Video Projects Table
CREATE TABLE IF NOT EXISTS video_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Project Settings (from Canvas Interface Settings)
  width INTEGER NOT NULL DEFAULT 1920,
  height INTEGER NOT NULL DEFAULT 1080,
  fps DECIMAL(6, 2) NOT NULL DEFAULT 24, -- Supports fractional framerates (23.976, 29.97, 59.94)
  duration DECIMAL(10, 2) NOT NULL DEFAULT 10.0, -- in seconds
  quality VARCHAR(20) DEFAULT 'high', -- low, medium, high, ultra
  aspect_ratio VARCHAR(50) DEFAULT '16:9',
  
  -- Video Generation Settings
  generation_steps INTEGER DEFAULT 50,
  output_format VARCHAR(10) DEFAULT 'mp4', -- mp4, webm, avi, mov
  
  -- Timeline State (JSON)
  timeline_data JSONB, -- Stores tracks, clips, effects

  -- Professional Project Settings (metadata from ProjectCreationModal)
  project_metadata JSONB, -- Stores professional settings (renderer, display formats, sequence settings, etc.)

  -- Project State
  status VARCHAR(20) DEFAULT 'draft', -- draft, rendering, completed, failed
  thumbnail_url VARCHAR(500),
  output_video_url VARCHAR(500),

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_opened_at TIMESTAMP,
  file_size BIGINT, -- in bytes
  render_duration DECIMAL(10, 2), -- rendering time in seconds
  
  -- Sharing & Collaboration (future)
  is_public BOOLEAN DEFAULT FALSE,
  share_token VARCHAR(255)
);

-- Video Assets Table (media library items)
CREATE TABLE IF NOT EXISTS video_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Asset Info
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL, -- video, image, audio
  format VARCHAR(50), -- mp4, png, jpg, mp3, etc
  file_url VARCHAR(500) NOT NULL,
  thumbnail_url VARCHAR(500),
  
  -- Media Properties
  duration DECIMAL(10, 2), -- for video/audio in seconds
  width INTEGER,
  height INTEGER,
  file_size BIGINT, -- in bytes
  
  -- Upload Info
  source VARCHAR(50) DEFAULT 'upload', -- upload, generated, imported
  uploaded_at TIMESTAMP DEFAULT NOW(),
  
  -- Metadata
  metadata JSONB -- Additional properties (codec, bitrate, etc)
);

-- Video Rendering Jobs Table
CREATE TABLE IF NOT EXISTS video_render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Job Configuration
  render_settings JSONB NOT NULL, -- Quality, format, resolution, etc
  
  -- Job Status
  status VARCHAR(20) DEFAULT 'queued', -- queued, processing, completed, failed, cancelled
  progress DECIMAL(5, 2) DEFAULT 0, -- 0-100%
  current_frame INTEGER,
  total_frames INTEGER,
  
  -- Result
  output_url VARCHAR(500),
  error_message TEXT,
  
  -- Resource Usage
  container_id VARCHAR(255), -- Docker container ID
  credits_used INTEGER DEFAULT 0,
  processing_time DECIMAL(10, 2), -- in seconds
  
  -- Timestamps
  queued_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Video Project Sessions (history/versions)
CREATE TABLE IF NOT EXISTS video_project_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Session Data
  session_title VARCHAR(255),
  timeline_snapshot JSONB, -- Full timeline state at this point
  settings_snapshot JSONB, -- Project settings at this point
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  message_count INTEGER DEFAULT 0, -- For chat-based sessions
  thumbnail_url VARCHAR(500)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_video_projects_user ON video_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_video_projects_status ON video_projects(status);
CREATE INDEX IF NOT EXISTS idx_video_projects_updated ON video_projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_assets_project ON video_assets(project_id);
CREATE INDEX IF NOT EXISTS idx_video_assets_user ON video_assets(user_id);
CREATE INDEX IF NOT EXISTS idx_video_render_jobs_user ON video_render_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_video_render_jobs_status ON video_render_jobs(status);
CREATE INDEX IF NOT EXISTS idx_video_project_sessions_project ON video_project_sessions(project_id);

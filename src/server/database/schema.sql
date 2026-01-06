-- File Conversion System Database Schema

-- Uploaded files awaiting conversion
CREATE TABLE IF NOT EXISTS conversion_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    original_name VARCHAR(500) NOT NULL,
    stored_filename VARCHAR(500) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);

-- Conversion jobs and results
CREATE TABLE IF NOT EXISTS conversions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES conversion_files(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    input_format VARCHAR(50) NOT NULL,
    output_format VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
    progress INTEGER DEFAULT 0,
    settings JSONB,
    output_filename VARCHAR(500),
    output_path TEXT,
    output_size BIGINT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Track user storage usage
CREATE TABLE IF NOT EXISTS user_storage_usage (
    user_id VARCHAR(255) PRIMARY KEY,
    total_files INTEGER DEFAULT 0,
    total_size BIGINT DEFAULT 0,
    last_updated TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_storage ON user_storage_usage(user_id, total_size);
CREATE INDEX IF NOT EXISTS idx_conversions_status ON conversions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_conversions_user ON conversions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversion_files_user ON conversion_files(user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversions_completed ON conversions(completed_at) WHERE completed_at IS NOT NULL;


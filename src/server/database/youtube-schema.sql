-- YouTube Channel Management Schema
-- Created for xeno-platform Content Creation feature

-- ============================================
-- YOUTUBE CHANNELS TABLE
-- Store connected YouTube channels and OAuth tokens
-- ============================================

CREATE TABLE IF NOT EXISTS youtube_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- YouTube Channel Info
    channel_id VARCHAR(50) NOT NULL,           -- YouTube channel ID (UC...)
    channel_title VARCHAR(255) NOT NULL,
    channel_description TEXT,
    channel_thumbnail_url VARCHAR(500),
    channel_custom_url VARCHAR(255),           -- @handle
    channel_banner_url VARCHAR(500),

    -- Channel Statistics (cached from YouTube API)
    subscriber_count BIGINT DEFAULT 0,
    video_count INTEGER DEFAULT 0,
    view_count BIGINT DEFAULT 0,

    -- OAuth Tokens
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMP NOT NULL,
    scopes TEXT[],                             -- Array of granted OAuth scopes

    -- Status & Metadata
    is_active BOOLEAN DEFAULT TRUE,
    is_monetized BOOLEAN DEFAULT FALSE,        -- Whether channel has monetization enabled
    last_sync_at TIMESTAMP,
    sync_error TEXT,                           -- Last sync error message if any
    sync_metadata JSONB DEFAULT '{}',          -- Additional sync metadata (last_sync_type, etc.)

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP,                      -- Soft delete

    -- Constraints
    UNIQUE(user_id, channel_id)
);

-- Add sync_metadata column if it doesn't exist (for existing installations)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'youtube_channels' AND column_name = 'sync_metadata') THEN
        ALTER TABLE youtube_channels ADD COLUMN sync_metadata JSONB DEFAULT '{}';
    END IF;
END $$;

-- Indexes for youtube_channels
CREATE INDEX IF NOT EXISTS idx_youtube_channels_user
    ON youtube_channels(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_youtube_channels_channel_id
    ON youtube_channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_youtube_channels_active
    ON youtube_channels(user_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_youtube_channels_token_expires
    ON youtube_channels(token_expires_at) WHERE deleted_at IS NULL;

-- ============================================
-- YOUTUBE ANALYTICS CACHE TABLE
-- Cache analytics data to avoid YouTube API rate limits
-- ============================================

CREATE TABLE IF NOT EXISTS youtube_analytics_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,

    -- Cache Key
    metric_type VARCHAR(50) NOT NULL,          -- 'dashboard', 'overview', 'videos', 'demographics', 'traffic_sources', 'revenue', 'realtime'
    date_range VARCHAR(20) NOT NULL,           -- 'last_7_days', 'last_28_days', 'last_90_days', 'last_365_days', 'lifetime'

    -- Cached Data
    data JSONB NOT NULL,

    -- Cache Metadata
    cached_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    etag VARCHAR(64),                          -- ETag for conditional requests (MD5 hash of data)

    -- Constraints
    UNIQUE(channel_id, metric_type, date_range)
);

-- Add etag column if it doesn't exist (for existing installations)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'youtube_analytics_cache' AND column_name = 'etag') THEN
        ALTER TABLE youtube_analytics_cache ADD COLUMN etag VARCHAR(64);
    END IF;
END $$;

-- Indexes for youtube_analytics_cache
CREATE INDEX IF NOT EXISTS idx_youtube_analytics_cache_lookup
    ON youtube_analytics_cache(channel_id, metric_type, date_range);
CREATE INDEX IF NOT EXISTS idx_youtube_analytics_cache_expiry
    ON youtube_analytics_cache(expires_at);

-- ============================================
-- YOUTUBE VIDEOS CACHE TABLE
-- Cache video data for top videos display
-- ============================================

CREATE TABLE IF NOT EXISTS youtube_videos_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,

    -- Video Info
    video_id VARCHAR(20) NOT NULL,             -- YouTube video ID
    title VARCHAR(500) NOT NULL,
    description TEXT,
    thumbnail_url VARCHAR(500),
    published_at TIMESTAMP,
    duration_seconds INTEGER,

    -- Video Statistics
    view_count BIGINT DEFAULT 0,
    like_count BIGINT DEFAULT 0,
    comment_count BIGINT DEFAULT 0,

    -- Analytics (from YouTube Analytics API)
    watch_time_minutes BIGINT DEFAULT 0,
    average_view_duration_seconds INTEGER DEFAULT 0,
    average_view_percentage DECIMAL(5,2) DEFAULT 0,

    -- Cache Metadata
    cached_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,

    -- Constraints
    UNIQUE(channel_id, video_id)
);

-- Indexes for youtube_videos_cache
CREATE INDEX IF NOT EXISTS idx_youtube_videos_cache_channel
    ON youtube_videos_cache(channel_id);
CREATE INDEX IF NOT EXISTS idx_youtube_videos_cache_views
    ON youtube_videos_cache(channel_id, view_count DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_videos_cache_published
    ON youtube_videos_cache(channel_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_videos_cache_expiry
    ON youtube_videos_cache(expires_at);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to clean expired cache entries
CREATE OR REPLACE FUNCTION cleanup_youtube_cache() RETURNS void AS $$
BEGIN
    DELETE FROM youtube_analytics_cache WHERE expires_at < NOW();
    DELETE FROM youtube_videos_cache WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to update channel stats
CREATE OR REPLACE FUNCTION update_youtube_channel_stats(
    p_channel_uuid UUID,
    p_subscriber_count BIGINT,
    p_video_count INTEGER,
    p_view_count BIGINT
) RETURNS void AS $$
BEGIN
    UPDATE youtube_channels
    SET
        subscriber_count = p_subscriber_count,
        video_count = p_video_count,
        view_count = p_view_count,
        last_sync_at = NOW(),
        updated_at = NOW(),
        sync_error = NULL
    WHERE id = p_channel_uuid AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- YOUTUBE CHANNEL GROUPS TABLE
-- Custom groups/categories for organizing channels
-- ============================================

CREATE TABLE IF NOT EXISTS youtube_channel_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Group Info
    name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(20) DEFAULT '#ef4444',      -- Hex color for group
    icon VARCHAR(50) DEFAULT 'folder',         -- Lucide icon name

    -- Ordering
    sort_order INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Constraints
    UNIQUE(user_id, name)
);

-- Indexes for youtube_channel_groups
CREATE INDEX IF NOT EXISTS idx_youtube_channel_groups_user
    ON youtube_channel_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_youtube_channel_groups_order
    ON youtube_channel_groups(user_id, sort_order);

-- ============================================
-- YOUTUBE CHANNEL GROUP MEMBERS TABLE
-- Junction table for many-to-many relationship
-- ============================================

CREATE TABLE IF NOT EXISTS youtube_channel_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES youtube_channel_groups(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,

    -- Ordering within group
    sort_order INTEGER DEFAULT 0,

    -- Timestamps
    added_at TIMESTAMP DEFAULT NOW(),

    -- Constraints
    UNIQUE(group_id, channel_id)
);

-- Indexes for youtube_channel_group_members
CREATE INDEX IF NOT EXISTS idx_youtube_channel_group_members_group
    ON youtube_channel_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_youtube_channel_group_members_channel
    ON youtube_channel_group_members(channel_id);
CREATE INDEX IF NOT EXISTS idx_youtube_channel_group_members_order
    ON youtube_channel_group_members(group_id, sort_order);

-- ============================================
-- YOUTUBE CHANNEL LANGUAGES TABLE
-- Language tags for channels
-- ============================================

CREATE TABLE IF NOT EXISTS youtube_channel_languages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
    language_code VARCHAR(10) NOT NULL,  -- e.g., 'fi', 'sv', 'de', 'no', 'ja', 'en', 'fr', 'ro', 'da', 'nl'

    -- Timestamps
    added_at TIMESTAMP DEFAULT NOW(),

    -- Constraints
    UNIQUE(channel_id, language_code)
);

-- Indexes for youtube_channel_languages
CREATE INDEX IF NOT EXISTS idx_youtube_channel_languages_channel
    ON youtube_channel_languages(channel_id);
CREATE INDEX IF NOT EXISTS idx_youtube_channel_languages_lang
    ON youtube_channel_languages(language_code);

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE youtube_channels IS 'Stores connected YouTube channels with OAuth tokens for each user';
COMMENT ON TABLE youtube_analytics_cache IS 'Caches YouTube Analytics API responses to reduce API calls';
COMMENT ON TABLE youtube_videos_cache IS 'Caches video data and statistics for top videos display';
COMMENT ON COLUMN youtube_channels.channel_id IS 'YouTube channel ID starting with UC';
COMMENT ON COLUMN youtube_channels.scopes IS 'Array of OAuth scopes granted by user';
COMMENT ON COLUMN youtube_analytics_cache.metric_type IS 'Type of analytics: overview, videos, demographics, traffic_sources, revenue, realtime';
COMMENT ON COLUMN youtube_analytics_cache.date_range IS 'Time period: last_7_days, last_28_days, last_90_days, last_365_days, lifetime';

-- ============================================
-- YOUTUBE OAUTH STATES TABLE
-- Temporary storage for OAuth state tokens during authorization flow
-- ============================================

CREATE TABLE IF NOT EXISTS youtube_oauth_states (
    state VARCHAR(255) PRIMARY KEY,
    data JSONB NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_oauth_states_expires
    ON youtube_oauth_states(expires_at);

-- ============================================
-- YOUTUBE DAILY SNAPSHOTS TABLE
-- Store daily subscriber count history for tracking growth
-- ============================================

CREATE TABLE IF NOT EXISTS youtube_daily_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,

    -- Date (one record per channel per day)
    snapshot_date DATE NOT NULL,

    -- Daily Stats
    subscriber_count BIGINT NOT NULL,
    subscribers_gained INTEGER DEFAULT 0,
    subscribers_lost INTEGER DEFAULT 0,
    view_count BIGINT DEFAULT 0,
    views_gained INTEGER DEFAULT 0,
    watch_time_minutes BIGINT DEFAULT 0,
    video_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Constraints
    UNIQUE(channel_id, snapshot_date)
);

-- Indexes for youtube_daily_snapshots
CREATE INDEX IF NOT EXISTS idx_youtube_daily_snapshots_channel
    ON youtube_daily_snapshots(channel_id);
CREATE INDEX IF NOT EXISTS idx_youtube_daily_snapshots_date
    ON youtube_daily_snapshots(channel_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_daily_snapshots_range
    ON youtube_daily_snapshots(channel_id, snapshot_date);

COMMENT ON TABLE youtube_daily_snapshots IS 'Stores daily subscriber count snapshots for tracking channel growth over time';

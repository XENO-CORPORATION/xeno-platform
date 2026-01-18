-- XenoOS Collaborative Sessions Database Schema
-- Enables Figma-style real-time collaboration on OS containers

-- Collaborative sessions table
-- Each session represents a shared container workspace
CREATE TABLE IF NOT EXISTS os_collaborative_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    container_id VARCHAR(255) NOT NULL,
    owner_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL DEFAULT 'Collaborative Session',
    share_token VARCHAR(64) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    max_participants INTEGER DEFAULT 10,
    allow_anonymous BOOLEAN DEFAULT false,
    permissions JSONB DEFAULT '{"canEdit": true, "canDelete": false, "canCreateFiles": true}'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,
    last_activity_at TIMESTAMP DEFAULT NOW()
);

-- Session participants table
-- Tracks who is currently in a session with their cursor positions
CREATE TABLE IF NOT EXISTS os_session_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES os_collaborative_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    cursor_x FLOAT DEFAULT 0,
    cursor_y FLOAT DEFAULT 0,
    cursor_window_id VARCHAR(255),
    color VARCHAR(7) NOT NULL DEFAULT '#3B82F6',
    is_active BOOLEAN DEFAULT true,
    permissions JSONB DEFAULT '{"canEdit": true}'::jsonb,
    joined_at TIMESTAMP DEFAULT NOW(),
    last_seen_at TIMESTAMP DEFAULT NOW(),
    last_cursor_update TIMESTAMP DEFAULT NOW(),
    UNIQUE(session_id, user_id)
);

-- Session invitations table
-- Stores pending invitations to sessions
CREATE TABLE IF NOT EXISTS os_session_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES os_collaborative_sessions(id) ON DELETE CASCADE,
    invited_by UUID NOT NULL,
    invited_email VARCHAR(255),
    invited_user_id UUID,
    invitation_token VARCHAR(64) UNIQUE NOT NULL,
    permissions JSONB DEFAULT '{"canEdit": true}'::jsonb,
    message TEXT,
    status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, declined, expired
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '7 days',
    accepted_at TIMESTAMP
);

-- Session activity log
-- Tracks all actions in a session for audit and replay
CREATE TABLE IF NOT EXISTS os_session_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES os_collaborative_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    action_type VARCHAR(50) NOT NULL, -- cursor_move, file_create, file_delete, window_open, etc.
    action_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_collab_sessions_owner ON os_collaborative_sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_collab_sessions_container ON os_collaborative_sessions(container_id);
CREATE INDEX IF NOT EXISTS idx_collab_sessions_token ON os_collaborative_sessions(share_token);
CREATE INDEX IF NOT EXISTS idx_collab_sessions_active ON os_collaborative_sessions(is_active, last_activity_at);

CREATE INDEX IF NOT EXISTS idx_session_participants_session ON os_session_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_session_participants_user ON os_session_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_session_participants_active ON os_session_participants(session_id, is_active);

CREATE INDEX IF NOT EXISTS idx_session_invitations_session ON os_session_invitations(session_id);
CREATE INDEX IF NOT EXISTS idx_session_invitations_token ON os_session_invitations(invitation_token);
CREATE INDEX IF NOT EXISTS idx_session_invitations_email ON os_session_invitations(invited_email);
CREATE INDEX IF NOT EXISTS idx_session_invitations_status ON os_session_invitations(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_session_activity_session ON os_session_activity(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_activity_user ON os_session_activity(user_id, created_at DESC);

-- Function to generate unique tokens
CREATE OR REPLACE FUNCTION generate_share_token() RETURNS VARCHAR(64) AS $$
BEGIN
    RETURN encode(gen_random_bytes(32), 'hex');
END;
$$ LANGUAGE plpgsql;

-- Function to update last_activity_at on session
CREATE OR REPLACE FUNCTION update_session_activity() RETURNS TRIGGER AS $$
BEGIN
    UPDATE os_collaborative_sessions
    SET last_activity_at = NOW(), updated_at = NOW()
    WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update session activity when participant activity changes
DROP TRIGGER IF EXISTS trigger_update_session_activity ON os_session_participants;
CREATE TRIGGER trigger_update_session_activity
    AFTER INSERT OR UPDATE ON os_session_participants
    FOR EACH ROW
    EXECUTE FUNCTION update_session_activity();

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions() RETURNS void AS $$
BEGIN
    -- Mark sessions as inactive if expired
    UPDATE os_collaborative_sessions
    SET is_active = false
    WHERE expires_at IS NOT NULL AND expires_at < NOW() AND is_active = true;

    -- Mark participants as inactive if not seen in 5 minutes
    UPDATE os_session_participants
    SET is_active = false
    WHERE last_seen_at < NOW() - INTERVAL '5 minutes' AND is_active = true;

    -- Expire old invitations
    UPDATE os_session_invitations
    SET status = 'expired'
    WHERE expires_at < NOW() AND status = 'pending';
END;
$$ LANGUAGE plpgsql;

-- Assign colors to new participants
CREATE OR REPLACE FUNCTION assign_participant_color() RETURNS TRIGGER AS $$
DECLARE
    colors VARCHAR[] := ARRAY['#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#EF4444', '#6366F1', '#14B8A6', '#F97316', '#06B6D4'];
    used_colors VARCHAR[];
    new_color VARCHAR;
BEGIN
    -- Get colors already used in this session
    SELECT array_agg(color) INTO used_colors
    FROM os_session_participants
    WHERE session_id = NEW.session_id AND id != NEW.id;

    -- Find first unused color
    FOR i IN 1..array_length(colors, 1) LOOP
        IF used_colors IS NULL OR NOT colors[i] = ANY(used_colors) THEN
            new_color := colors[i];
            EXIT;
        END IF;
    END LOOP;

    -- Default to first color if all used
    IF new_color IS NULL THEN
        new_color := colors[1];
    END IF;

    NEW.color := new_color;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_assign_color ON os_session_participants;
CREATE TRIGGER trigger_assign_color
    BEFORE INSERT ON os_session_participants
    FOR EACH ROW
    EXECUTE FUNCTION assign_participant_color();

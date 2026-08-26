-- UP
-- Chat full-scale tables — artifacts, projects, files, scheduled tasks, skills, memories.
--
-- Moved from src/server/migrations/015_chat_full_scale.sql. That folder is not
-- MIGRATIONS_DIR. migrationRunner.js only reads src/server/database/migrations
-- and only keeps files matching ^(\d{14})[-_](.+)\.sql$, so the 015_ copy was
-- a schema that existed as a file and as a service and was created nowhere.
--
-- Idempotent throughout: CREATE/INDEX/ADD COLUMN all use IF NOT EXISTS.
-- The runner wraps every migration in its own transaction — no BEGIN/COMMIT
-- here (see 20260824200000-evidence-survives-erasure.sql).

-- ============================================================================
-- 1. CHAT ARTIFACTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
    message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    kind VARCHAR(50) NOT NULL CHECK (kind IN ('document', 'code', 'image', 'html')),
    language VARCHAR(50),
    content TEXT NOT NULL,
    preview_text TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_artifacts_user ON chat_artifacts(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_artifacts_conv ON chat_artifacts(conversation_id);

-- ============================================================================
-- 2. CHAT PROJECTS & KNOWLEDGE FILES (Must exist before scheduled tasks foreign key)
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    custom_instructions TEXT,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_project_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    storage_key VARCHAR(512),
    content_text TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_projects_user ON chat_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_project_files_proj ON chat_project_files(project_id);

ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES chat_projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_chat_conversations_project ON chat_conversations(project_id);

-- ============================================================================
-- 3. CHAT SCHEDULED AUTOMATION TASKS
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_scheduled_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
    project_id UUID REFERENCES chat_projects(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    prompt TEXT NOT NULL,
    model_id VARCHAR(255) NOT NULL DEFAULT 'google/gemini-2.5-flash-preview-05-20',
    cadence VARCHAR(50) NOT NULL CHECK (cadence IN ('once', 'daily', 'weekly', 'monthly')),
    cadence_label VARCHAR(100) NOT NULL,
    cron_expression VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    next_run_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_run_at TIMESTAMP WITH TIME ZONE,
    last_run_status VARCHAR(20),
    last_run_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_scheduled_next ON chat_scheduled_tasks(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_chat_scheduled_user ON chat_scheduled_tasks(user_id);

-- ============================================================================
-- 4. CHAT CUSTOM AGENT SKILLS
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    summary VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    author VARCHAR(100) NOT NULL DEFAULT 'You',
    source VARCHAR(50) NOT NULL DEFAULT 'created' CHECK (source IN ('built_in', 'created', 'catalog', 'imported')),
    visibility VARCHAR(20) NOT NULL DEFAULT 'global' CHECK (visibility IN ('global', 'chat')),
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
    origin_id UUID REFERENCES chat_skills(id) ON DELETE SET NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'general',
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_skills_user ON chat_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_skills_conv ON chat_skills(conversation_id);

-- ============================================================================
-- 5. CHAT MEMORIES & PERSONALIZATION
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_user_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source_conversation_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_memories_user ON chat_user_memories(user_id);

-- Schema that used to be created during requests (routes/*, billingSchema, inHouseDailyLimit, billingAccountBinding).
-- The running app now connects as xeno_app, which cannot run DDL (database/runtime-role.js), so every object it relies on
-- must come from a migration. Idempotent: production already has all of these, and a fresh database gets them here.
-- UP
CREATE TABLE IF NOT EXISTS chat_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT 'New Chat',
    model_id VARCHAR(255),
    system_prompt TEXT,
    persona_id VARCHAR(50),
    interface_id VARCHAR(100) DEFAULT 'playground',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_message_at TIMESTAMP,
    deleted_at TIMESTAMP,
    is_archived BOOLEAN DEFAULT FALSE
  );
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    model_id VARCHAR(255),
    thinking TEXT,
    has_thinking BOOLEAN DEFAULT FALSE,
    attachments JSONB,
    search_context JSONB,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    message_index INTEGER NOT NULL,
    turn JSONB
  );
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS turn JSONB;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_chat_messages_parent ON chat_messages(parent_id);
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS active_leaf_id UUID;
CREATE TABLE IF NOT EXISTS chat_personas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    prompt TEXT NOT NULL,
    icon VARCHAR(50),
    color VARCHAR(20),
    use_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    sort_order INTEGER DEFAULT 0,
    is_favorite BOOLEAN DEFAULT FALSE
  );
CREATE TABLE IF NOT EXISTS chat_shared_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    share_token VARCHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    revoked_at TIMESTAMP,
    accept_count INTEGER DEFAULT 0
  );
CREATE TABLE IF NOT EXISTS chat_share_acceptances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id UUID NOT NULL REFERENCES chat_shared_conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    new_conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    accepted_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(share_id, user_id)
  );
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON chat_conversations(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated ON chat_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, message_index);
CREATE INDEX IF NOT EXISTS idx_chat_personas_user ON chat_personas(user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_chat_shared_token ON chat_shared_conversations(share_token);
CREATE INDEX IF NOT EXISTS idx_chat_shared_conv ON chat_shared_conversations(conversation_id, owner_id);
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
CREATE TABLE IF NOT EXISTS user_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255),
    file_type VARCHAR(100),
    mime_type VARCHAR(100),
    file_size INTEGER,
    storage_path VARCHAR(500),
    storage_type VARCHAR(50) DEFAULT 'local',
    metadata JSONB DEFAULT '{}',
    last_used_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
  );
CREATE TABLE IF NOT EXISTS user_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    model_id VARCHAR(255) NOT NULL,
    provider VARCHAR(100),
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    request_count INTEGER DEFAULT 0,
    estimated_cost DECIMAL(10, 6) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, date, model_id)
  );
CREATE INDEX IF NOT EXISTS idx_user_files_user ON user_files(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_user_files_last_used ON user_files(user_id, last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_usage_user_date ON user_usage(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_user_usage_model ON user_usage(user_id, model_id);
CREATE TABLE IF NOT EXISTS image_generations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    image_urls JSONB NOT NULL DEFAULT '[]',
    model VARCHAR(100) NOT NULL,
    aspect_ratio VARCHAR(20),
    resolution VARCHAR(20),
    count INTEGER DEFAULT 1,
    provider VARCHAR(50),
    generation_time_ms INTEGER,
    is_favorite BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
  );
ALTER TABLE image_generations
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT false;
ALTER TABLE image_generations
  ADD COLUMN IF NOT EXISTS reference_images JSONB DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_image_generations_user
    ON image_generations(user_id);
CREATE INDEX IF NOT EXISTS idx_image_generations_user_created
    ON image_generations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_generations_user_favorites
    ON image_generations(user_id, is_favorite) WHERE is_favorite = true;
CREATE TABLE IF NOT EXISTS credit_usage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      feature VARCHAR(100) NOT NULL,
      credits_used INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
CREATE TABLE IF NOT EXISTS inhouse_daily_usage (
  user_id uuid NOT NULL,
  day     date NOT NULL,
  count   int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS billing_account_binding (
  singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
  account_id text NOT NULL CHECK (account_id ~ '^acct_[A-Za-z0-9]+$'),
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_customers (
  user_id            text PRIMARY KEY,
  stripe_customer_id text UNIQUE NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_events (
  event_id   text PRIMARY KEY,
  type       text,
  user_id    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_charges (
  payment_intent text PRIMARY KEY,
  user_id        text NOT NULL,
  credits_micro  bigint NOT NULL,
  refunded_micro bigint NOT NULL DEFAULT 0,
  event_id       text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS xeno_account_plans (
  user_id                text PRIMARY KEY,
  plan                   text NOT NULL DEFAULT 'free',
  status                 text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- DOWN
-- Nothing: these tables hold data and predate this file, which only records them.

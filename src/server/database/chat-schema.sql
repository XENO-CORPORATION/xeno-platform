-- Chat Conversations Database Schema
-- ============================================
-- Tables for storing user chat conversations, messages, and custom personas
-- ============================================

-- ============================================
-- CHAT CONVERSATIONS TABLE
-- ============================================
-- Stores conversation metadata
CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Conversation Info
  title VARCHAR(255) NOT NULL DEFAULT 'New Chat',

  -- Settings used in this conversation
  model_id VARCHAR(255),
  system_prompt TEXT,
  persona_id VARCHAR(50),  -- 'engineer', 'lawyer', 'copywriter', or custom UUID

  -- Interface tracking (for multi-interface support)
  interface_id VARCHAR(100) DEFAULT 'playground',

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_message_at TIMESTAMP,

  -- Soft delete
  deleted_at TIMESTAMP,
  is_archived BOOLEAN DEFAULT FALSE
);

-- ============================================
-- CHAT MESSAGES TABLE
-- ============================================
-- Stores individual messages in conversations
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Message Content
  role VARCHAR(20) NOT NULL,  -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,

  -- AI Response metadata
  model_id VARCHAR(255),      -- Model used to generate response
  thinking TEXT,              -- Extended thinking output (if available)
  has_thinking BOOLEAN DEFAULT FALSE,

  -- Attachments (stored as JSON array)
  attachments JSONB,          -- [{type, name, content, mimeType}]

  -- Search context (if Xeno search was used)
  search_context JSONB,

  -- Token usage tracking
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),

  -- Message ordering within conversation
  message_index INTEGER NOT NULL
);

-- ============================================
-- CUSTOM PERSONAS TABLE
-- ============================================
-- Stores user-created custom system prompts/personas
CREATE TABLE IF NOT EXISTS chat_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Persona Info
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  prompt TEXT NOT NULL,

  -- Display
  icon VARCHAR(50),           -- Icon name or emoji
  color VARCHAR(20),          -- Hex color for UI

  -- Usage tracking
  use_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Ordering
  sort_order INTEGER DEFAULT 0,
  is_favorite BOOLEAN DEFAULT FALSE
);

-- ============================================
-- INDEXES
-- ============================================
-- Conversations indexes
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON chat_conversations(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated ON chat_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_interface ON chat_conversations(user_id, interface_id);

-- Messages indexes
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, message_index);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id, created_at DESC);

-- Personas indexes
CREATE INDEX IF NOT EXISTS idx_chat_personas_user ON chat_personas(user_id, sort_order);

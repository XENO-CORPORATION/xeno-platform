-- UP
-- XENO Chat projects full semantics: additive core schema and compatibility backfill.
-- Semantic/vector columns deliberately live in a later migration after pgvector
-- and the embedding model contract are qualified.

-- ---------------------------------------------------------------------------
-- Project tenancy. Legacy user_id remains a nullable compatibility column.
-- ---------------------------------------------------------------------------
ALTER TABLE chat_projects ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE chat_projects ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE chat_projects ADD COLUMN IF NOT EXISTS instructions_revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE chat_projects ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE chat_projects ADD COLUMN IF NOT EXISTS updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE chat_projects
SET owner_user_id = COALESCE(owner_user_id, user_id),
    created_by_user_id = COALESCE(created_by_user_id, user_id),
    updated_by_user_id = COALESCE(updated_by_user_id, user_id)
WHERE owner_user_id IS NULL OR created_by_user_id IS NULL OR updated_by_user_id IS NULL;

ALTER TABLE chat_projects ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE chat_projects DROP CONSTRAINT IF EXISTS chat_projects_user_id_fkey;
ALTER TABLE chat_projects
  ADD CONSTRAINT chat_projects_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_projects_scope_check') THEN
    ALTER TABLE chat_projects ADD CONSTRAINT chat_projects_scope_check
      CHECK ((owner_user_id IS NULL) <> (workspace_id IS NULL)) NOT VALID;
  END IF;
END $$;
ALTER TABLE chat_projects VALIDATE CONSTRAINT chat_projects_scope_check;

CREATE INDEX IF NOT EXISTS idx_chat_projects_workspace_updated
  ON chat_projects(workspace_id, updated_at DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_projects_owner_updated
  ON chat_projects(owner_user_id, updated_at DESC) WHERE owner_user_id IS NOT NULL;

ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_project_id_fkey;
ALTER TABLE chat_conversations
  ADD CONSTRAINT chat_conversations_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES chat_projects(id) ON DELETE RESTRICT;

-- Conversation/message creator identity is attribution, not shared-resource
-- authority. Baseline user_id cascades would erase project/workspace history
-- when its creator is deleted.
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
UPDATE chat_conversations
SET created_by_user_id = COALESCE(created_by_user_id, user_id),
    owner_user_id = CASE
      WHEN project_id IS NULL AND workspace_id IS NULL THEN COALESCE(owner_user_id, user_id)
      ELSE NULL
    END,
    workspace_id = CASE WHEN project_id IS NOT NULL THEN NULL ELSE workspace_id END;
ALTER TABLE chat_conversations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_user_id_fkey;
ALTER TABLE chat_conversations
  ADD CONSTRAINT chat_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_conversations_scope_check') THEN
    ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_scope_check
      CHECK (num_nonnulls(owner_user_id, project_id, workspace_id) = 1) NOT VALID;
  END IF;
END $$;
ALTER TABLE chat_conversations VALIDATE CONSTRAINT chat_conversations_scope_check;
CREATE INDEX IF NOT EXISTS idx_chat_conversations_owner_updated
  ON chat_conversations(owner_user_id, updated_at DESC) WHERE owner_user_id IS NOT NULL;

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
UPDATE chat_messages SET created_by_user_id = COALESCE(created_by_user_id, user_id);
ALTER TABLE chat_messages ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_user_id_fkey;
ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Canonical Library ownership and immutable-content metadata.
-- ---------------------------------------------------------------------------
ALTER TABLE user_files ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE user_files ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE user_files ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE user_files ADD COLUMN IF NOT EXISTS content_sha256 TEXT;
ALTER TABLE user_files ADD COLUMN IF NOT EXISTS replaces_asset_id UUID REFERENCES user_files(id) ON DELETE SET NULL;
ALTER TABLE user_files ALTER COLUMN file_size TYPE BIGINT USING file_size::BIGINT;

UPDATE user_files
SET owner_user_id = COALESCE(owner_user_id, user_id),
    created_by_user_id = COALESCE(created_by_user_id, user_id)
WHERE owner_user_id IS NULL OR created_by_user_id IS NULL;

ALTER TABLE user_files ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE user_files DROP CONSTRAINT IF EXISTS user_files_user_id_fkey;
ALTER TABLE user_files
  ADD CONSTRAINT user_files_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_files_scope_check') THEN
    ALTER TABLE user_files ADD CONSTRAINT user_files_scope_check
      CHECK ((owner_user_id IS NULL) <> (workspace_id IS NULL)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_files_sha256_check') THEN
    ALTER TABLE user_files ADD CONSTRAINT user_files_sha256_check
      CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$') NOT VALID;
  END IF;
END $$;
ALTER TABLE user_files VALIDATE CONSTRAINT user_files_scope_check;
ALTER TABLE user_files VALIDATE CONSTRAINT user_files_sha256_check;

CREATE INDEX IF NOT EXISTS idx_user_files_owner_active
  ON user_files(owner_user_id, last_used_at DESC) WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_files_workspace_active
  ON user_files(workspace_id, last_used_at DESC) WHERE workspace_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_files_sha256 ON user_files(content_sha256) WHERE content_sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_project_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES user_files(id) ON DELETE RESTRICT,
  added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  retrieval_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_project_assets_asset ON chat_project_assets(asset_id, project_id);

CREATE TABLE IF NOT EXISTS library_asset_link_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
  issued_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  authorizing_resource_type TEXT NOT NULL
    CHECK (authorizing_resource_type IN ('user', 'project', 'workspace')),
  authorizing_resource_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_library_asset_link_grants_active
  ON library_asset_link_grants(asset_id, expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Lexical ingestion. Scanning/quarantine are durable states, not UI fiction.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_asset_ingestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  mime_type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'quarantined'
    CHECK (state IN ('queued', 'quarantined', 'scanning', 'extracting', 'indexing', 'ready', 'unsupported', 'failed')),
  extractor_id TEXT,
  extractor_version TEXT,
  embedding_model_id TEXT,
  embedding_dimensions INTEGER CHECK (embedding_dimensions IS NULL OR embedding_dimensions > 0),
  semantic_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (semantic_status IN ('disabled', 'pending', 'indexing', 'ready', 'degraded')),
  semantic_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (semantic_attempt_count >= 0),
  semantic_error_code TEXT,
  semantic_error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_code TEXT,
  error_message TEXT,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_library_asset_ingestion_revision
  ON library_asset_ingestions(asset_id, content_sha256, extractor_version, embedding_model_id)
  NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_library_asset_ingestions_state
  ON library_asset_ingestions(state, created_at);
CREATE INDEX IF NOT EXISTS idx_library_asset_ingestions_claimable
  ON library_asset_ingestions(state, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_library_asset_ingestions_semantic_pending
  ON library_asset_ingestions(semantic_status, updated_at)
  WHERE state = 'ready' AND semantic_status IN ('pending', 'degraded');

CREATE TABLE IF NOT EXISTS library_asset_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_id UUID NOT NULL REFERENCES library_asset_ingestions(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL CHECK (token_count >= 0),
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  embedding_model_id TEXT,
  source_locator JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(ingestion_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_library_asset_chunks_search
  ON library_asset_chunks USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_library_asset_chunks_asset
  ON library_asset_chunks(asset_id, ingestion_id, ordinal);

-- ---------------------------------------------------------------------------
-- Durable scheduler state and exactly-once committed message effect.
-- ---------------------------------------------------------------------------
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS run_as_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS schedule_kind TEXT;
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS timezone_source TEXT;
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS dtstart_local TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS rrule TEXT;
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS misfire_policy TEXT NOT NULL DEFAULT 'run_once';
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS overlap_policy TEXT NOT NULL DEFAULT 'skip';
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS max_catch_up_runs INTEGER NOT NULL DEFAULT 1;
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS catch_up_window_seconds INTEGER NOT NULL DEFAULT 86400;
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS paused_reason TEXT;

UPDATE chat_scheduled_tasks
SET created_by_user_id = COALESCE(created_by_user_id, user_id),
    run_as_user_id = COALESCE(run_as_user_id, user_id),
    schedule_kind = COALESCE(schedule_kind, CASE WHEN cadence = 'once' THEN 'once' ELSE 'recurring' END),
    timezone = COALESCE(timezone, 'UTC'),
    timezone_source = COALESCE(timezone_source, 'legacy_default_utc'),
    dtstart_local = COALESCE(dtstart_local, next_run_at AT TIME ZONE 'UTC'),
    rrule = COALESCE(rrule, CASE cadence
      WHEN 'daily' THEN 'FREQ=DAILY'
      WHEN 'weekly' THEN 'FREQ=WEEKLY'
      WHEN 'monthly' THEN 'FREQ=MONTHLY'
      ELSE NULL
    END);

ALTER TABLE chat_scheduled_tasks DROP CONSTRAINT IF EXISTS chat_scheduled_tasks_status_check;
ALTER TABLE chat_scheduled_tasks ADD CONSTRAINT chat_scheduled_tasks_status_check
  CHECK (status IN ('active', 'paused', 'cancelled', 'needs_review'));
UPDATE chat_scheduled_tasks
SET status = 'needs_review', paused_reason = 'timezone_confirmation_required'
WHERE schedule_kind = 'recurring' AND timezone_source = 'legacy_default_utc' AND status = 'active';

ALTER TABLE chat_scheduled_tasks ALTER COLUMN schedule_kind SET NOT NULL;
ALTER TABLE chat_scheduled_tasks ALTER COLUMN timezone SET NOT NULL;
ALTER TABLE chat_scheduled_tasks ALTER COLUMN timezone_source SET NOT NULL;
ALTER TABLE chat_scheduled_tasks ALTER COLUMN dtstart_local SET NOT NULL;
ALTER TABLE chat_scheduled_tasks ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE chat_scheduled_tasks DROP CONSTRAINT IF EXISTS chat_scheduled_tasks_user_id_fkey;
ALTER TABLE chat_scheduled_tasks
  ADD CONSTRAINT chat_scheduled_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE chat_scheduled_tasks DROP CONSTRAINT IF EXISTS chat_scheduled_tasks_conversation_id_fkey;
ALTER TABLE chat_scheduled_tasks
  ADD CONSTRAINT chat_scheduled_tasks_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE RESTRICT;
ALTER TABLE chat_scheduled_tasks DROP CONSTRAINT IF EXISTS chat_scheduled_tasks_project_id_fkey;
ALTER TABLE chat_scheduled_tasks
  ADD CONSTRAINT chat_scheduled_tasks_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES chat_projects(id) ON DELETE RESTRICT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_scheduled_tasks_kind_check') THEN
    ALTER TABLE chat_scheduled_tasks ADD CONSTRAINT chat_scheduled_tasks_kind_check
      CHECK (schedule_kind IN ('once', 'recurring'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_scheduled_tasks_rrule_check') THEN
    ALTER TABLE chat_scheduled_tasks ADD CONSTRAINT chat_scheduled_tasks_rrule_check
      CHECK ((schedule_kind = 'once' AND rrule IS NULL) OR (schedule_kind = 'recurring' AND rrule IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_scheduled_tasks_timezone_source_check') THEN
    ALTER TABLE chat_scheduled_tasks ADD CONSTRAINT chat_scheduled_tasks_timezone_source_check
      CHECK (timezone_source IN ('user_confirmed', 'legacy_default_utc'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_scheduled_tasks_policy_check') THEN
    ALTER TABLE chat_scheduled_tasks ADD CONSTRAINT chat_scheduled_tasks_policy_check
      CHECK (misfire_policy IN ('skip', 'run_once', 'catch_up')
        AND overlap_policy IN ('skip', 'queue_one')
        AND max_catch_up_runs BETWEEN 1 AND 24
        AND catch_up_window_seconds BETWEEN 60 AND 604800
        AND max_attempts BETWEEN 1 AND 20);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS chat_scheduled_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES chat_scheduled_tasks(id) ON DELETE CASCADE,
  occurrence_key TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'running', 'succeeded', 'failed', 'cancelled', 'skipped', 'reconciliation_required')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE RESTRICT,
  context_manifest JSONB,
  model_id TEXT,
  provider_request_id TEXT,
  result_staging JSONB,
  gateway_retry_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, occurrence_key)
);
CREATE INDEX IF NOT EXISTS idx_chat_scheduled_runs_claim
  ON chat_scheduled_runs(status, lease_expires_at, scheduled_for);

-- Gateway-owned run-key cache. The inference gateway uses this table through
-- its canonical platform DB connection; Chat never writes cached responses.
CREATE TABLE IF NOT EXISTS chat_gateway_run_requests (
  run_key UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  status TEXT NOT NULL CHECK (status IN ('pending','completed','retryable_failed','reconciliation_required','expired')),
  downstream_dispatch_started BOOLEAN NOT NULL DEFAULT FALSE,
  downstream_dispatch_started_at TIMESTAMPTZ,
  response_status INTEGER,
  response_body JSONB,
  provider_request_id TEXT,
  failure_code TEXT,
  manual_retry_acknowledged_at TIMESTAMPTZ,
  tombstoned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  CHECK ((status = 'completed') = (response_status IS NOT NULL AND response_body IS NOT NULL)),
  CHECK (downstream_dispatch_started = (downstream_dispatch_started_at IS NOT NULL)),
  CHECK (status <> 'reconciliation_required' OR downstream_dispatch_started),
  CHECK (status <> 'retryable_failed' OR NOT downstream_dispatch_started),
  CHECK ((status = 'expired') = (tombstoned_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_chat_gateway_run_requests_expiry
  ON chat_gateway_run_requests(expires_at)
  WHERE status IN ('completed','retryable_failed','reconciliation_required');

-- The request-path role never needs DELETE. Response retention is implemented
-- by a separately granted maintenance function that preserves the immutable
-- run-key/principal/hash binding as an expired tombstone.
CREATE OR REPLACE FUNCTION chat_tombstone_expired_gateway_run_requests(p_limit INTEGER DEFAULT 250)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  affected INTEGER;
BEGIN
  WITH expired AS (
    SELECT run_key
    FROM public.chat_gateway_run_requests
    WHERE expires_at < NOW()
      AND status IN ('completed','retryable_failed','reconciliation_required')
    ORDER BY expires_at ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 1000)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.chat_gateway_run_requests target
  SET status = 'expired',
      response_status = NULL,
      response_body = NULL,
      provider_request_id = NULL,
      failure_code = NULL,
      tombstoned_at = NOW(),
      updated_at = NOW()
  FROM expired
  WHERE target.run_key = expired.run_key;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION chat_tombstone_expired_gateway_run_requests(INTEGER) FROM PUBLIC;

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS scheduled_run_id UUID REFERENCES chat_scheduled_runs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_scheduled_run_role
  ON chat_messages(scheduled_run_id, role)
  WHERE scheduled_run_id IS NOT NULL AND role IN ('user', 'assistant');

DO $$
DECLARE duplicate_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO duplicate_count FROM (
    SELECT conversation_id, message_index
    FROM chat_messages
    GROUP BY conversation_id, message_index
    HAVING COUNT(*) > 1
  ) duplicates;
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'chat_messages has % duplicate conversation/message indexes; repair before core migration', duplicate_count;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_conversation_index
  ON chat_messages(conversation_id, message_index);

-- Interactive generation context is staged server-side before the provider call.
-- The browser receives only this opaque handle plus a safe source projection, then
-- consumes the handle when it persists the assistant message. This prevents a
-- client from forging the provenance manifest stored for an answer.
CREATE TABLE IF NOT EXISTS chat_generation_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_hash TEXT CHECK (response_hash IS NULL OR response_hash ~ '^[a-f0-9]{64}$'),
  context_manifest JSONB NOT NULL,
  safe_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  consumed_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_chat_generation_contexts_consume
  ON chat_generation_contexts(id, conversation_id, user_id)
  WHERE consumed_message_id IS NULL;

CREATE TABLE IF NOT EXISTS chat_message_context_manifests (
  message_id UUID PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE RESTRICT,
  context_manifest JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Server-authoritative connector/plugin/share/artifact extensions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_connector_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'connected', 'expired', 'failed', 'revoked')),
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  sealed_credentials TEXT CHECK (sealed_credentials IS NULL OR sealed_credentials LIKE 'v1.%'),
  credentials_expires_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, connector_key)
);

CREATE TABLE IF NOT EXISTS chat_plugin_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL,
  installed_version TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  entitlement_reference TEXT,
  entitlement_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (entitlement_status IN ('unverified', 'active', 'expired', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, listing_id)
);

ALTER TABLE chat_shared_conversations ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE chat_shared_conversations ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE chat_shared_conversations ADD COLUMN IF NOT EXISTS token_digest TEXT;
UPDATE chat_shared_conversations
SET token_digest = encode(sha256(convert_to(share_token, 'UTF8')), 'hex')
WHERE token_digest IS NULL;
ALTER TABLE chat_shared_conversations ALTER COLUMN token_digest SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_shared_conversations_visibility_check') THEN
    ALTER TABLE chat_shared_conversations ADD CONSTRAINT chat_shared_conversations_visibility_check
      CHECK (visibility IN ('public', 'workspace')
        AND ((visibility = 'workspace') = (workspace_id IS NOT NULL)));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_shared_conversations_token_digest
  ON chat_shared_conversations(token_digest);

ALTER TABLE chat_artifacts ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES chat_projects(id) ON DELETE RESTRICT;
ALTER TABLE chat_artifacts ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE chat_artifacts ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE chat_artifacts ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
UPDATE chat_artifacts a
SET project_id = c.project_id,
    workspace_id = CASE WHEN c.project_id IS NULL THEN c.workspace_id ELSE NULL END,
    owner_user_id = CASE
      WHEN c.project_id IS NULL AND c.workspace_id IS NULL THEN c.owner_user_id
      ELSE NULL
    END,
    created_by_user_id = COALESCE(a.created_by_user_id, a.user_id)
FROM chat_conversations c
WHERE a.conversation_id = c.id
  AND (a.project_id IS NULL OR a.workspace_id IS NULL OR a.owner_user_id IS NULL OR a.created_by_user_id IS NULL);
UPDATE chat_artifacts
SET owner_user_id = COALESCE(owner_user_id, user_id),
    created_by_user_id = COALESCE(created_by_user_id, user_id)
WHERE conversation_id IS NULL;
ALTER TABLE chat_artifacts ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE chat_artifacts DROP CONSTRAINT IF EXISTS chat_artifacts_user_id_fkey;
ALTER TABLE chat_artifacts
  ADD CONSTRAINT chat_artifacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_artifacts_scope_check') THEN
    ALTER TABLE chat_artifacts ADD CONSTRAINT chat_artifacts_scope_check
      CHECK (num_nonnulls(owner_user_id, project_id, workspace_id) = 1) NOT VALID;
  END IF;
END $$;
ALTER TABLE chat_artifacts VALIDATE CONSTRAINT chat_artifacts_scope_check;

ALTER TABLE chat_skills ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE chat_skills ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
UPDATE chat_skills
SET owner_user_id = CASE WHEN conversation_id IS NULL THEN COALESCE(owner_user_id, user_id) ELSE NULL END,
    created_by_user_id = COALESCE(created_by_user_id, user_id);
ALTER TABLE chat_skills ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE chat_skills DROP CONSTRAINT IF EXISTS chat_skills_user_id_fkey;
ALTER TABLE chat_skills
  ADD CONSTRAINT chat_skills_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_skills_scope_check') THEN
    ALTER TABLE chat_skills ADD CONSTRAINT chat_skills_scope_check
      CHECK (num_nonnulls(owner_user_id, conversation_id) = 1) NOT VALID;
  END IF;
END $$;
ALTER TABLE chat_skills VALIDATE CONSTRAINT chat_skills_scope_check;

-- ---------------------------------------------------------------------------
-- Generated-output mappings and explicit migration exception reporting.
-- ---------------------------------------------------------------------------
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS library_asset_id UUID REFERENCES user_files(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_image_assets_library_asset
  ON image_assets(library_asset_id) WHERE library_asset_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS image_generation_assets (
  generation_id UUID NOT NULL REFERENCES image_generations(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  asset_id UUID NOT NULL REFERENCES user_files(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(generation_id, ordinal),
  UNIQUE(asset_id)
);

INSERT INTO image_generation_assets(generation_id, ordinal, asset_id)
SELECT g.id,
       CASE WHEN f.metadata->>'legacy_ordinal' ~ '^[1-9][0-9]*$'
         THEN (f.metadata->>'legacy_ordinal')::INTEGER END,
       f.id
FROM user_files f
JOIN image_generations g ON g.id::TEXT = f.metadata->>'legacy_generation_id'
WHERE f.metadata->>'source' = 'legacy-image-generation'
  AND f.metadata->>'legacy_ordinal' ~ '^[1-9][0-9]*$'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS chat_migration_exceptions (
  id BIGSERIAL PRIMARY KEY,
  exception_type TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE(exception_type, source_table, source_id)
);

INSERT INTO chat_project_assets(project_id, asset_id, added_by_user_id)
SELECT pf.project_id, f.id, pf.user_id
FROM chat_project_files pf
JOIN user_files f ON f.id::TEXT = pf.storage_key
ON CONFLICT(project_id, asset_id) DO NOTHING;

INSERT INTO chat_migration_exceptions(exception_type, source_table, source_id, details)
SELECT 'unresolved_project_file', 'chat_project_files', pf.id::TEXT,
       jsonb_build_object('project_id', pf.project_id, 'storage_key', pf.storage_key, 'name', pf.name)
FROM chat_project_files pf
LEFT JOIN chat_project_assets pa ON pa.project_id = pf.project_id
  AND pa.asset_id::TEXT = pf.storage_key
WHERE pa.id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO chat_migration_exceptions(exception_type, source_table, source_id, details)
SELECT 'unresolved_generated_output', 'image_generations',
       g.id::TEXT || ':' || generated.ordinality::TEXT,
       jsonb_build_object(
         'generation_id', g.id,
         'ordinal', generated.ordinality,
         'materializable_data_url', generated.url LIKE 'data:image/%;base64,%'
       )
FROM image_generations g
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(g.image_urls) = 'array' THEN g.image_urls ELSE '[]'::jsonb END
) WITH ORDINALITY AS generated(url, ordinality)
LEFT JOIN image_generation_assets ga
  ON ga.generation_id = g.id AND ga.ordinal = generated.ordinality
WHERE ga.asset_id IS NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- ReBAC backfill. These tuples make inheritance concrete for every producer.
-- ---------------------------------------------------------------------------
INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'project', id::TEXT, 'owner', 'user', owner_user_id::TEXT
FROM chat_projects WHERE owner_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'project', id::TEXT, 'parent', 'workspace', workspace_id::TEXT
FROM chat_projects WHERE workspace_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'conversation', id::TEXT, 'owner', 'user', user_id::TEXT
FROM chat_conversations WHERE user_id IS NOT NULL AND project_id IS NULL AND workspace_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'conversation', id::TEXT, 'parent', 'project', project_id::TEXT
FROM chat_conversations WHERE project_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'conversation', id::TEXT, 'parent', 'workspace', workspace_id::TEXT
FROM chat_conversations WHERE project_id IS NULL AND workspace_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'library_asset', id::TEXT, 'owner', 'user', owner_user_id::TEXT
FROM user_files WHERE owner_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'library_asset', id::TEXT, 'parent', 'workspace', workspace_id::TEXT
FROM user_files WHERE workspace_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'library_asset', asset_id::TEXT, 'parent', 'project', project_id::TEXT
FROM chat_project_assets
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'schedule', id::TEXT, 'owner', 'user', created_by_user_id::TEXT
FROM chat_scheduled_tasks WHERE created_by_user_id IS NOT NULL AND project_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'schedule', id::TEXT, 'parent', 'project', project_id::TEXT
FROM chat_scheduled_tasks WHERE project_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'artifact', a.id::TEXT, 'parent', 'project', a.project_id::TEXT
FROM chat_artifacts a WHERE a.project_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'artifact', a.id::TEXT, 'parent', 'workspace', a.workspace_id::TEXT
FROM chat_artifacts a WHERE a.project_id IS NULL AND a.workspace_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'artifact', a.id::TEXT, 'owner', 'user', a.owner_user_id::TEXT
FROM chat_artifacts a WHERE a.owner_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'skill', s.id::TEXT, 'parent', 'conversation', s.conversation_id::TEXT
FROM chat_skills s WHERE s.conversation_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'skill', s.id::TEXT, 'owner', 'user', s.owner_user_id::TEXT
FROM chat_skills s WHERE s.owner_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO relationship_tuples(object_type, object_id, relation, subject_type, subject_id)
SELECT 'skill', s.id::TEXT, 'owner', 'user', s.user_id::TEXT
FROM chat_skills s WHERE s.conversation_id IS NULL AND s.user_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO workspace_audit(workspace_id, actor_user_id, action, target, metadata)
SELECT p.workspace_id, p.created_by_user_id, 'chat_project_backfilled', 'project:' || p.id::TEXT,
       jsonb_build_object('migration', '20260829120000')
FROM chat_projects p WHERE p.workspace_id IS NOT NULL;

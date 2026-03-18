-- UP
-- Infrastructure tables for webhooks, analytics, background jobs, and email logs

-- ============================================================
-- Webhooks
-- ============================================================
CREATE TABLE IF NOT EXISTS webhooks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  secret          VARCHAR(255),
  events          TEXT[] NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_events ON webhooks USING gin(events);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event           VARCHAR(100) NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  status_code     INTEGER,
  response_body   TEXT,
  attempt         INTEGER NOT NULL DEFAULT 1,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  next_retry_at   TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(next_retry_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;

-- ============================================================
-- Background Jobs (BullMQ-compatible tracking table)
-- ============================================================
CREATE TABLE IF NOT EXISTS background_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue           VARCHAR(100) NOT NULL,
  type            VARCHAR(100) NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  result          JSONB,
  error           TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  priority        INTEGER NOT NULL DEFAULT 0,
  scheduled_for   TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_background_jobs_queue_status ON background_jobs(queue, status);
CREATE INDEX IF NOT EXISTS idx_background_jobs_scheduled ON background_jobs(scheduled_for)
  WHERE status = 'pending';

-- ============================================================
-- Analytics Events
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_events (
  id              BIGSERIAL PRIMARY KEY,
  event_type      VARCHAR(100) NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id      VARCHAR(255),
  properties      JSONB NOT NULL DEFAULT '{}',
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at);

-- Daily aggregate stats (materialized by cron)
CREATE TABLE IF NOT EXISTS analytics_daily_stats (
  id              SERIAL PRIMARY KEY,
  date            DATE NOT NULL,
  metric          VARCHAR(100) NOT NULL,
  dimension       VARCHAR(255) DEFAULT 'total',
  value           BIGINT NOT NULL DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  UNIQUE(date, metric, dimension)
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_date ON analytics_daily_stats(date);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_metric ON analytics_daily_stats(metric, date);

-- ============================================================
-- Email Logs
-- ============================================================
CREATE TABLE IF NOT EXISTS email_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  to_email        VARCHAR(255) NOT NULL,
  template        VARCHAR(100) NOT NULL,
  subject         VARCHAR(500),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed', 'bounced')),
  provider_id     VARCHAR(255),
  error           TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_user ON email_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);

-- DOWN
DROP TABLE IF EXISTS email_logs;
DROP TABLE IF EXISTS analytics_daily_stats;
DROP TABLE IF EXISTS analytics_events;
DROP TABLE IF EXISTS background_jobs;
DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS webhooks;

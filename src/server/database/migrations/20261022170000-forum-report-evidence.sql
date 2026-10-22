-- UP
-- Evidence inherits the visibility of the exact post or private ticket.
CREATE TABLE IF NOT EXISTS forum_report_submissions (
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reporter_id, submission_id)
);
CREATE TABLE IF NOT EXISTS forum_report_evidence (
  id UUID PRIMARY KEY,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES forum_tickets(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp','video/webm','video/mp4')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((post_id IS NOT NULL)::int + (ticket_id IS NOT NULL)::int = 1),
  CHECK (octet_length(content) = size_bytes)
);
CREATE INDEX IF NOT EXISTS idx_forum_report_evidence_ticket ON forum_report_evidence(ticket_id);
CREATE INDEX IF NOT EXISTS idx_forum_report_evidence_actor ON forum_report_evidence(reporter_id,created_at);
CREATE INDEX IF NOT EXISTS idx_forum_report_submissions_rate ON forum_report_submissions(reporter_id,created_at);
CREATE TABLE IF NOT EXISTS forum_report_product_grants (
  agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product TEXT NOT NULL,
  granted_by UUID NOT NULL REFERENCES users(id),
  PRIMARY KEY (agent_id, product)
);

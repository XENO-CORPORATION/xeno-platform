-- UP
-- XENO Customers (corpo.customers): the workspace's CRM. Contacts and companies are owned by the WORKSPACE
-- (XENO-WORKFORCE-01 §8.11) — members read, editors write, deletes and GDPR erasure are a HUMAN admin's act. Agents
-- read and DRAFT (a draft note or deal waits for a person); a CHECK + trigger hold that here as well as in the service.
-- Support tickets and XENO Tasks are LINKED, never copied: there is no second ticket store and no second tracker.
CREATE TABLE IF NOT EXISTS crm_companies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  domain        TEXT CHECK (domain IS NULL OR length(domain) <= 200),
  notes         TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 20000),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_companies_domain_uq ON crm_companies (workspace_id, lower(domain)) WHERE domain IS NOT NULL;

CREATE TABLE IF NOT EXISTS crm_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  company_id    UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  email         TEXT CHECK (email IS NULL OR length(email) <= 320),
  phone         TEXT CHECK (phone IS NULL OR length(phone) <= 60),
  title         TEXT CHECK (title IS NULL OR length(title) <= 200),
  tags          TEXT[] NOT NULL DEFAULT '{}',
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'form', 'agent')),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Dedupe: one contact per email per workspace (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_email_uq ON crm_contacts (workspace_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_contacts_ws ON crm_contacts (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_stages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  position      INT NOT NULL DEFAULT 0,
  outcome       TEXT NOT NULL DEFAULT 'open' CHECK (outcome IN ('open', 'won', 'lost')),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS crm_deals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  contact_id    UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  company_id    UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  stage_id      UUID NOT NULL REFERENCES crm_stages(id),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  amount_cents  BIGINT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency      TEXT NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  close_date    DATE,
  state         TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('draft', 'active')),
  drafted_by_agent UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The timeline: notes, calls, emails, meetings, stage moves, links. An agent's note is a draft until a person keeps it.
CREATE TABLE IF NOT EXISTS crm_activities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  contact_id    UUID REFERENCES crm_contacts(id) ON DELETE CASCADE,
  company_id    UUID REFERENCES crm_companies(id) ON DELETE CASCADE,
  deal_id       UUID REFERENCES crm_deals(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('note', 'call', 'email', 'meeting', 'stage', 'link', 'system')),
  body          TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  state         TEXT NOT NULL DEFAULT 'kept' CHECK (state IN ('draft', 'kept')),
  author_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  agent_drafted BOOLEAN NOT NULL DEFAULT FALSE,
  kept_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (contact_id IS NOT NULL OR company_id IS NOT NULL OR deal_id IS NOT NULL),
  -- an agent's words are never "kept" without a person who kept them
  CHECK (NOT agent_drafted OR state = 'draft' OR kept_by IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS crm_activities_contact ON crm_activities (contact_id, created_at DESC);

CREATE OR REPLACE FUNCTION crm_agent_keep_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.agent_drafted AND NEW.state = 'kept' AND NEW.kept_by IS NOT NULL
     AND EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.kept_by) THEN
    RAISE EXCEPTION 'an agent cannot keep an agent''s draft' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS crm_agent_keep_guard ON crm_activities;
CREATE TRIGGER crm_agent_keep_guard BEFORE INSERT OR UPDATE ON crm_activities FOR EACH ROW EXECUTE FUNCTION crm_agent_keep_guard();

-- Links to other owners' records. Read through THEIR service, which decides who may see them.
CREATE TABLE IF NOT EXISTS crm_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  contact_id    UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  target_kind   TEXT NOT NULL CHECK (target_kind IN ('support_ticket', 'task')),
  target_key    TEXT NOT NULL CHECK (length(target_key) <= 40),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, target_kind, target_key)
);

-- GDPR: erasure leaves a tombstone with no personal data, so the act itself is accountable.
CREATE TABLE IF NOT EXISTS crm_erasures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  contact_id    UUID NOT NULL,
  erased_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  erased_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM crm_contacts) OR EXISTS (SELECT 1 FROM crm_companies) THEN
    RAISE EXCEPTION 'customers rollback refused: contacts exist, and dropping them would lose the workspace''s customers' USING ERRCODE = '23514';
  END IF;
  DROP TABLE IF EXISTS crm_erasures;
  DROP TABLE IF EXISTS crm_links;
  DROP TRIGGER IF EXISTS crm_agent_keep_guard ON crm_activities;
  DROP FUNCTION IF EXISTS crm_agent_keep_guard();
  DROP TABLE IF EXISTS crm_activities;
  DROP TABLE IF EXISTS crm_deals;
  DROP TABLE IF EXISTS crm_stages;
  DROP TABLE IF EXISTS crm_contacts;
  DROP TABLE IF EXISTS crm_companies;
END $$;

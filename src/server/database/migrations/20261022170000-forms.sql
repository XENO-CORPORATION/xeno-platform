-- UP
-- XENO Forms (Corpo › Forms): forms a WORKSPACE owns (XENO-WORKFORCE-01 §8.11), the links that open them, and the
-- responses they collect (services/forms.js). ADDITIVE ONLY: three new tables. DOWN drops exactly them.
--
-- A form's fields are a validated list (forms.js refuses any type it does not know). A link is either SIGNIN
-- (opening it needs a XENO account) or PUBLIC (anyone with it). Only a PERSON may create a public link: the CHECK
-- below holds that, so no code path — and no agent — can mint one. Only the token's SHA-256 is stored.
-- A response is the workspace's data. Actions taken on it (contact, task, support ticket) are recorded on it.
CREATE TABLE IF NOT EXISTS forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fields) = 'array' AND jsonb_array_length(fields) <= 50),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  confirmation text NOT NULL DEFAULT 'Thank you — your response was received.' CHECK (length(confirmation) <= 1000),
  auto_actions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(auto_actions) = 'array'),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS forms_ws ON forms (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS form_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('signin', 'public')),
  token_sha256 text NOT NULL UNIQUE,
  label text CHECK (label IS NULL OR length(label) <= 120),
  created_by_user_id uuid NOT NULL,
  created_by_kind text NOT NULL CHECK (created_by_kind IN ('human', 'agent')),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- a public link is a person's act, never an agent's
  CONSTRAINT form_links_public_by_human CHECK (kind <> 'public' OR created_by_kind = 'human')
);
CREATE INDEX IF NOT EXISTS form_links_form ON form_links (form_id, created_at DESC);

CREATE TABLE IF NOT EXISTS form_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  link_id uuid REFERENCES form_links(id) ON DELETE SET NULL,
  answers jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
  submitter_user_id uuid,
  source_hash text,                       -- SHA-256 of (form, client address): rate limits, never the address itself
  spam boolean NOT NULL DEFAULT false,
  actions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(actions) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS form_responses_form ON form_responses (form_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS form_responses_source ON form_responses (source_hash, created_at DESC);
-- DOWN
DROP INDEX IF EXISTS form_responses_source;
DROP INDEX IF EXISTS form_responses_form;
DROP TABLE IF EXISTS form_responses;
DROP INDEX IF EXISTS form_links_form;
DROP TABLE IF EXISTS form_links;
DROP INDEX IF EXISTS forms_ws;
DROP TABLE IF EXISTS forms;

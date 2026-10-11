-- UP
CREATE TABLE IF NOT EXISTS media_generations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL REFERENCES users(id), actor_user_id uuid NOT NULL REFERENCES users(id),
 request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 160),
 request jsonb NOT NULL, request_hash text NOT NULL, version integer NOT NULL DEFAULT 1,
 quote jsonb NOT NULL, state text NOT NULL CHECK (state IN ('awaiting_approval','queued','submitting','running','reconciling','cancel_requested','importing','succeeded','failed','cancelled')),
 project_id uuid, conversation_id uuid, hold_id text NOT NULL,
 gateway_key text NOT NULL UNIQUE, gateway_job_id text, gateway_request jsonb, gateway_payer_id uuid,
 upstream_billing jsonb, provider_result jsonb, result_asset_ids uuid[] NOT NULL DEFAULT '{}',
 retail_cost_micro bigint NOT NULL CHECK (retail_cost_micro >= 0), error_code text,
 cancel_requested_at timestamptz, approved_by_user_id uuid, approved_at timestamptz,
 lease_owner uuid, lease_expires_at timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_user_id,request_key)
);
CREATE INDEX IF NOT EXISTS media_generations_work ON media_generations(next_attempt_at,created_at)
 WHERE state NOT IN ('awaiting_approval','succeeded','failed','cancelled');
-- Fresh bootstrap runs versioned migrations before migrateAccountV2. Preserve the SAME ordinary
-- hold schema here so the additive columns are valid on both fresh and established databases.
CREATE TABLE IF NOT EXISTS credit_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, account_id uuid,
 hold_id text NOT NULL, surface varchar(64) NOT NULL, operation varchar(128) NOT NULL,
 amount_micro bigint NOT NULL CHECK(amount_micro>0), settled_micro bigint NOT NULL DEFAULT 0,
 state varchar(16) NOT NULL DEFAULT 'held', expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,hold_id)
);
ALTER TABLE credit_holds ADD COLUMN IF NOT EXISTS media_generation_id uuid REFERENCES media_generations(id);
ALTER TABLE credit_holds ADD COLUMN IF NOT EXISTS media_committed boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS credit_holds_media_generation ON credit_holds(media_generation_id) WHERE media_generation_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS media_generation_outputs (
 generation_id uuid NOT NULL REFERENCES media_generations(id), ordinal integer NOT NULL CHECK (ordinal >= 0),
 asset_id uuid NOT NULL REFERENCES user_files(id), PRIMARY KEY(generation_id,ordinal), UNIQUE(asset_id)
);
CREATE OR REPLACE FUNCTION immutable_media_generation_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.request IS DISTINCT FROM OLD.request OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
 OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
 OR NEW.request_key IS DISTINCT FROM OLD.request_key OR NEW.gateway_key IS DISTINCT FROM OLD.gateway_key
 OR NEW.hold_id IS DISTINCT FROM OLD.hold_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
 OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
 OR (OLD.gateway_request IS NOT NULL AND NEW.gateway_request IS DISTINCT FROM OLD.gateway_request)
 OR (OLD.gateway_job_id IS NOT NULL AND NEW.gateway_job_id IS DISTINCT FROM OLD.gateway_job_id)
 OR (OLD.approved_at IS NOT NULL AND NEW.retail_cost_micro IS DISTINCT FROM OLD.retail_cost_micro) THEN RAISE EXCEPTION 'immutable media generation request'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS media_generation_immutable ON media_generations;
CREATE TRIGGER media_generation_immutable BEFORE UPDATE ON media_generations FOR EACH ROW EXECUTE FUNCTION immutable_media_generation_request();
-- DOWN
-- Retained deliberately: admitted work and money commitments cannot be removed by rollback.

-- UP
-- A person may change a proposal's settings (ratio, quality…) before approving it. The proposal's request stays
-- exactly as the agent made it (media_generation_immutable refuses any change to it): the person's version is a NEW
-- generation, priced and approved by them, and the proposal is cancelled and points at it, so the chat card that
-- showed the proposal follows to what actually ran. Additive: a column, a check, and one more clause in the existing
-- immutability trigger — `replaced_by` is set once and never changed or cleared.
ALTER TABLE media_generations ADD COLUMN IF NOT EXISTS replaced_by uuid NULL REFERENCES media_generations(id);
ALTER TABLE media_generations DROP CONSTRAINT IF EXISTS media_generations_replaced_not_self;
ALTER TABLE media_generations ADD CONSTRAINT media_generations_replaced_not_self CHECK (replaced_by IS NULL OR replaced_by <> id);

CREATE OR REPLACE FUNCTION immutable_media_generation_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.request IS DISTINCT FROM OLD.request OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
 OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
 OR NEW.request_key IS DISTINCT FROM OLD.request_key OR NEW.gateway_key IS DISTINCT FROM OLD.gateway_key
 OR NEW.hold_id IS DISTINCT FROM OLD.hold_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
 OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
 OR (OLD.gateway_request IS NOT NULL AND NEW.gateway_request IS DISTINCT FROM OLD.gateway_request)
 OR (OLD.gateway_job_id IS NOT NULL AND NEW.gateway_job_id IS DISTINCT FROM OLD.gateway_job_id)
 OR (OLD.approved_at IS NOT NULL AND NEW.retail_cost_micro IS DISTINCT FROM OLD.retail_cost_micro)
 OR (OLD.replaced_by IS NOT NULL AND NEW.replaced_by IS DISTINCT FROM OLD.replaced_by) THEN RAISE EXCEPTION 'immutable media generation request'; END IF;
 RETURN NEW;
END $$;

-- DOWN
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
ALTER TABLE media_generations DROP CONSTRAINT IF EXISTS media_generations_replaced_not_self;
ALTER TABLE media_generations DROP COLUMN IF EXISTS replaced_by;

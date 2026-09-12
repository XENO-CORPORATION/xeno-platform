-- Promote the alias map into a real model CATALOG.
--
-- 20260912180000 added public_id -> internal_id, which is only the alias slice.
-- A catalog also has to say WHO SERVES a model, or "adding DeepSeek is a row"
-- is still false: the row would rename a model without routing it anywhere.
--
-- 🔴 HOW THIS RELATES TO inference_routes, because two things that both look
-- like "model config" is how drift starts. They are different axes and both are
-- needed:
--   gateway_model_aliases  WHAT exists      — catalog: models, aliases, provider
--   inference_routes       WHICH PATH       — per (user_id, surface): premium |
--                                             byok | inhouse, per the Accepted
--                                             2026-09-11 ADR
-- Catalog answers "is this a real model and who serves it". Routing answers
-- "for THIS user, whose account pays". Entity catalog + targeting rules is the
-- same split LaunchDarkly and Stripe use; collapsing them into one table is what
-- makes config systems unmaintainable.
--
-- Pricing still deliberately does NOT live here — see 20260912180000.

ALTER TABLE gateway_model_aliases ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE gateway_model_aliases ADD COLUMN IF NOT EXISTS is_alias boolean;

-- Derive the provider from the id prefix for the seeded rows. This is a
-- one-time backfill of what the compiled-in map implied but never stated.
UPDATE gateway_model_aliases SET provider = CASE
  WHEN public_id LIKE 'claude%'   THEN 'anthropic'
  WHEN public_id LIKE 'gpt%'      THEN 'openai'
  WHEN public_id LIKE 'grok%'     THEN 'xai'
  WHEN public_id LIKE 'gemini%'   THEN 'google'
  WHEN public_id LIKE 'deepseek%' THEN 'deepseek'
  ELSE 'unknown'
END WHERE provider IS NULL;

-- An alias is a row whose public id differs from its internal id. Stating it
-- explicitly means a reader does not have to infer intent from a string compare.
UPDATE gateway_model_aliases SET is_alias = (public_id IS DISTINCT FROM internal_id)
  WHERE is_alias IS NULL;

ALTER TABLE gateway_model_aliases ALTER COLUMN provider SET NOT NULL;
ALTER TABLE gateway_model_aliases ALTER COLUMN provider SET DEFAULT 'unknown';
ALTER TABLE gateway_model_aliases ALTER COLUMN is_alias SET NOT NULL;
ALTER TABLE gateway_model_aliases ALTER COLUMN is_alias SET DEFAULT false;

CREATE INDEX IF NOT EXISTS gateway_model_aliases_provider_idx
  ON gateway_model_aliases(provider) WHERE enabled;

COMMENT ON COLUMN gateway_model_aliases.provider IS
  'Who serves this model. Adding a provider is rows here plus a credential in user_provider_credentials — never a gateway deploy.';

-- DOWN
DROP INDEX IF EXISTS gateway_model_aliases_provider_idx;
ALTER TABLE gateway_model_aliases DROP COLUMN IF EXISTS provider;
ALTER TABLE gateway_model_aliases DROP COLUMN IF EXISTS is_alias;

-- A provider credential can only serve its provider's models. Routing did not know.
--
-- WHY
-- ---
-- 2026-09-17: the operator's account default was set to byok -> a DeepSeek key.
-- A claude-sonnet-5 request then resolved byok, the grant was exchanged, and the
-- gateway sent Claude's model id to DeepSeek -> 400 provider_error. Every model
-- the key could NOT serve was broken for ~15 minutes, on the one account that
-- runs many providers. inference_routes is keyed by surface only; a credential
-- had no way to say which models it serves. The retired gateway store had this
-- right (byok_routes.model).
--
-- WHAT
-- ----
-- `models`: the explicit allow-list of model ids this credential may serve.
--   - For pass-through providers (compatible, openrouter, azure-openai) the
--     endpoint serves arbitrary ids, so this list is THE rule: unset or empty
--     means the credential serves nothing, and a byok route to it does not apply
--     to any request. Fail closed — a typo or an unconfigured key must never
--     route the wrong model to the wrong provider.
--   - For first-party providers (openai, anthropic, google) the platform's own
--     catalogue (gateway_model_aliases.provider) decides; this list, when set,
--     NARROWS it further. It never widens it past the provider.
--
-- Additive, nullable, one-row table today. No data change.

ALTER TABLE user_provider_credentials
  ADD COLUMN IF NOT EXISTS models text[] NULL;

COMMENT ON COLUMN user_provider_credentials.models IS
  'Model ids this credential may serve. Required (the whole rule) for pass-through providers; optional narrowing for first-party ones. NULL/empty on a pass-through credential serves nothing.';

-- Usage rows gain a DIMENSIONS column: why a call was routed the way it was.
--
-- WHY
-- ---
-- 2026-09-17: routing became provider-aware (20260917070000). A request can now
-- resolve `provider-mismatch` — the user's BYOK key was skipped because it cannot
-- serve the model — and fall through to premium, billed. The gateway reports that
-- (`routeReason`, `routeMismatchBasis`) on the settle body and on the usage body;
-- the platform had nowhere to put it. A usage row that says "premium, 4 credits"
-- with no record that the user's own key was passed over is exactly the row a
-- support case asks about.
--
-- Stripe Meters and Orb both carry free-form dimensions on the usage EVENT, not
-- on the price, so a report can slice by them later without a schema change.
-- Same here: `dimensions` is small, structured, and never PII — request_params
-- is the column that carries the request, and erasure scrubs it. This one holds
-- routing facts (route_reason, route_mismatch_basis, usage_source, agent_user_id)
-- and survives erasure, like cost and tokens.
--
-- Additive, nullable. No data change.

ALTER TABLE api_usage_logs
  ADD COLUMN IF NOT EXISTS dimensions jsonb NULL;

COMMENT ON COLUMN api_usage_logs.dimensions IS
  'Routing/attribution facts for the row (route_reason, route_mismatch_basis, usage_source, agent_user_id). Vocabulary is enforced in code (utils/usageDimensions.js); unknown keys are dropped, never stored. Not PII; survives erasure.';

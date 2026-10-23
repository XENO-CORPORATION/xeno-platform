-- The funding-budget branch of workforce_event_capture() (20261022090000) read `project_id` from
-- workforce_funding_pools, which has no such column: a pool belongs to a campaign and the CAMPAIGN holds the project.
-- plpgsql binds that lookup at run time, so the migration applied cleanly and every INSERT or UPDATE on
-- workforce_funding_budgets then failed with 42703 — no project funding budget could be proposed or decided.
-- Found by `npm run ci:local` on 2026-10-23 (23 funding and ledger proofs, all with this one error).
--
-- Forward fix, additive: the budgets trigger moves to its own function with the correct lookup, emitting the same
-- event (type, subject, actor, data) the shared function meant to emit. That function's budget branch is left in
-- place and becomes unreachable, so no other table's events change.
CREATE OR REPLACE FUNCTION workforce_funding_budget_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proj uuid;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
    SELECT c.project_id INTO proj
      FROM workforce_funding_pools p JOIN workforce_funding_campaigns c ON c.id = p.campaign_id
     WHERE p.id = NEW.pool_id;
    PERFORM workforce_event_emit('funding.budget_' || NEW.state, 'funding_budget', NEW.id, COALESCE(NEW.decided_by_user_id, NEW.proposed_by_user_id), NULL, NULL, proj,
      jsonb_build_object('poolId', NEW.pool_id, 'spenderUserId', NEW.spender_user_id, 'maximumMicro', NEW.maximum_micro::text, 'revision', NEW.revision::text));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS workforce_funding_budgets_event ON workforce_funding_budgets;
CREATE TRIGGER workforce_funding_budgets_event AFTER INSERT OR UPDATE ON workforce_funding_budgets
  FOR EACH ROW EXECUTE FUNCTION workforce_funding_budget_event();

-- DOWN
DROP TRIGGER IF EXISTS workforce_funding_budgets_event ON workforce_funding_budgets;
CREATE TRIGGER workforce_funding_budgets_event AFTER INSERT OR UPDATE ON workforce_funding_budgets
  FOR EACH ROW EXECUTE FUNCTION workforce_event_capture();
DROP FUNCTION IF EXISTS workforce_funding_budget_event();

-- UP
-- A restricted ledger account cannot become an ordinary wallet by changing its
-- kind or address. Existing user/workspace accounts and balances are untouched.
CREATE FUNCTION credit_account_restricted_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.owner_kind NOT IN ('user','workspace') OR NEW.owner_kind NOT IN ('user','workspace'))
     AND ROW(NEW.id,NEW.user_id,NEW.owner_kind) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.owner_kind) THEN
    RAISE EXCEPTION 'restricted ledger account identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credit_account_restricted_identity_guard BEFORE UPDATE ON credit_accounts
  FOR EACH ROW EXECUTE FUNCTION credit_account_restricted_identity_guard();
DO $harden$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.credit_account_restricted_identity_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM credit_accounts WHERE owner_kind NOT IN ('user','workspace')) THEN
    RAISE EXCEPTION 'cannot remove restricted account protection while restricted accounts exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP TRIGGER credit_account_restricted_identity_guard ON credit_accounts;
DROP FUNCTION credit_account_restricted_identity_guard();

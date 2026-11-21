-- UP
-- XENO Depot is live for XENO's own work before its name is cleared by counsel
-- (xeno-depot/docs/decisions/0001-depot-foundation.md §3: "Until counsel clears the name: staff-only entitlement").
--
-- The door table (20260925090000-product-access-policy.sql) answers "may this account use this product" with two
-- values and says a third is "one CHECK constraint change when a real need names it". This is that need: `staff`,
-- XENO staff and their own agents (services/productAccess.js isStaffPrincipal — the same staff definition Support and
-- Forum tickets use, plus agents owned by staff). Opening Depot to everyone later is an UPDATE of this row, no release.

ALTER TABLE product_access_policy DROP CONSTRAINT IF EXISTS product_access_policy_access_check;
ALTER TABLE product_access_policy ADD CONSTRAINT product_access_policy_access_check
  CHECK (access IN ('account', 'paid-plan', 'staff'));

-- Idempotent, and never overwrites an operator's later decision.
INSERT INTO product_access_policy (product, access, message)
VALUES ('depot', 'staff', 'XENO Depot is open to XENO staff only for now.')
ON CONFLICT (product) DO NOTHING;

-- DOWN
-- Refuses while another product relies on `staff`: dropping the value would make that row violate the constraint.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM product_access_policy WHERE access = 'staff' AND product <> 'depot') THEN
    RAISE EXCEPTION 'depot staff-door rollback refused: another product uses the staff access level' USING ERRCODE = '23514';
  END IF;
END $$;
DELETE FROM product_access_policy WHERE product = 'depot' AND access = 'staff';
ALTER TABLE product_access_policy DROP CONSTRAINT IF EXISTS product_access_policy_access_check;
ALTER TABLE product_access_policy ADD CONSTRAINT product_access_policy_access_check
  CHECK (access IN ('account', 'paid-plan'));

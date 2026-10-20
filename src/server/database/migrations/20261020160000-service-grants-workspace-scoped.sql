-- UP
-- D-3 grants are SCOPED to a workspace (security fix to #820). A service-account grant is the ReBAC tuple
--   capability:<capability>@<workspace id> #grantee @ user:<service id>
-- An UNSCOPED tuple (object_id = <capability>, no workspace) was read platform-wide, so one workspace's admin could
-- open every tenant. The gate no longer reads those; this constraint refuses writing new ones.
--
-- ADDITIVE: a NOT VALID check, so existing rows are left in place (they grant nothing) and no row is rewritten.
-- The down path is exact: it drops the constraint.
ALTER TABLE relationship_tuples DROP CONSTRAINT IF EXISTS relationship_tuples_capability_scoped;
ALTER TABLE relationship_tuples ADD CONSTRAINT relationship_tuples_capability_scoped
  CHECK (object_type <> 'capability'
         OR object_id ~ '^[a-z.]+@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') NOT VALID;

-- DOWN
ALTER TABLE relationship_tuples DROP CONSTRAINT IF EXISTS relationship_tuples_capability_scoped;

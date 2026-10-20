-- UP
-- XENO WORKSPACE AGENT SURFACE - SPEC.md P2: workspace grants name a CATALOGUE capability
-- (capability:<division.domain.verb>@<workspace>), and catalogue segments are lowercase snake_case
-- (define.js NAME: [a-z][a-z0-9_]*), e.g. agent.resource.create_and_assign. The D-3 check
-- (20261020160000) allowed only [a-z.]+, so such a grant could not be written. This widens the NAME part
-- only; the rule it exists for — every capability tuple names exactly one workspace — is unchanged.
ALTER TABLE relationship_tuples DROP CONSTRAINT IF EXISTS relationship_tuples_capability_scoped;
ALTER TABLE relationship_tuples ADD CONSTRAINT relationship_tuples_capability_scoped
  CHECK (object_type <> 'capability'
         OR object_id ~ '^[a-z][a-z0-9_.]*@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') NOT VALID;
-- DOWN
ALTER TABLE relationship_tuples DROP CONSTRAINT IF EXISTS relationship_tuples_capability_scoped;
ALTER TABLE relationship_tuples ADD CONSTRAINT relationship_tuples_capability_scoped
  CHECK (object_type <> 'capability'
         OR object_id ~ '^[a-z.]+@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') NOT VALID;

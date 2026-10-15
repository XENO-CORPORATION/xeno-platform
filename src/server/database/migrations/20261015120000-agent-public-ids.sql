-- UP
-- Platform agents that other tools bind to (XENO Spawn profiles, agent CLIs over XENO MCP).
-- public_id: the stable, opaque id a tool stores — never a name, survives a rename.
-- description: what the agent is for, shown wherever it appears.
ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS public_id text;
ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '' CHECK (length(description) <= 500);
UPDATE agent_identities SET public_id = 'agt_' || replace(user_id::text, '-', '') WHERE public_id IS NULL;
ALTER TABLE agent_identities ALTER COLUMN public_id SET DEFAULT ('agt_' || replace(gen_random_uuid()::text, '-', ''));
ALTER TABLE agent_identities ALTER COLUMN public_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agent_identities_public_id ON agent_identities (public_id);

-- DOWN
DROP INDEX IF EXISTS agent_identities_public_id;
ALTER TABLE agent_identities DROP COLUMN IF EXISTS public_id, DROP COLUMN IF EXISTS description;

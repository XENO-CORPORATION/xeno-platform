-- UP
-- The browser relay carries a second kind of device: XENO Corpus on a person's PC, so agents connected to XENO MCP can read a project
-- the person turned on there (owner decision 2026-10-31, services/corpusLocalMcp.js). ADDITIVE ONLY: four columns with defaults, so
-- every existing row reads exactly as before and the extension's wire does not change. DOWN removes them and the rows that need them.
--
-- A Corpus row keeps `tools` empty and says what it offers in `offered_tools` instead. resolveChatBrowser only offers a device with
-- tools, so a Corpus PC can't be offered to a chat as a browser even by code that has never heard of `surface`, such as a rolled-back
-- image reading this schema.
ALTER TABLE browser_installations ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'browser' CHECK (surface IN ('browser', 'corpus'));
-- the projects the person turned on, as an id and a name. Never a path.
ALTER TABLE browser_installations ADD COLUMN IF NOT EXISTS projects jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(projects) = 'array');
ALTER TABLE browser_installations ADD COLUMN IF NOT EXISTS offered_tools jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(offered_tools) = 'array');
-- A Corpus answer is the person's private document, so its row holds it only until the caller reads it, then keeps the size alone.
ALTER TABLE browser_calls ADD COLUMN IF NOT EXISTS result_bytes integer;

-- DOWN
-- A Corpus row can't outlive its column, or it would read as a browser.
DELETE FROM browser_installations WHERE surface <> 'browser';
ALTER TABLE browser_calls DROP COLUMN IF EXISTS result_bytes;
ALTER TABLE browser_installations DROP COLUMN IF EXISTS offered_tools;
ALTER TABLE browser_installations DROP COLUMN IF EXISTS projects;
ALTER TABLE browser_installations DROP COLUMN IF EXISTS surface;

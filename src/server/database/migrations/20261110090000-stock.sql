-- UP
-- XENO Stock (Studio › Libraries, services/stock.js). ADDITIVE ONLY: two new tables. DOWN drops exactly them.
--
-- The catalogue is data (src/server/data/stockCatalogue.json), with its bytes on our CDN. A save copies an item into the workspace's Library,
-- so an app or an agent uses it like any other file; this row says which item it was, and who saved it.
CREATE TABLE IF NOT EXISTS stock_saves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stock_id text NOT NULL CHECK (stock_id ~ '^[a-z]+-[0-9]{1,20}$'),
  file_id uuid,   -- user_files.id. Empty only while the copy is being made, which is what stops two saves making two copies.
  agent_saved boolean NOT NULL DEFAULT false,
  saved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, stock_id)
);
CREATE INDEX IF NOT EXISTS stock_saves_item ON stock_saves (stock_id);

-- A rights holder's complaint, handled by XENO staff. An item here stops being offered, and saved copies are removed.
CREATE TABLE IF NOT EXISTS stock_withdrawn (
  stock_id text PRIMARY KEY CHECK (stock_id ~ '^[a-z]+-[0-9]{1,20}$'),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  withdrawn_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE IF EXISTS stock_withdrawn;
DROP TABLE IF EXISTS stock_saves;

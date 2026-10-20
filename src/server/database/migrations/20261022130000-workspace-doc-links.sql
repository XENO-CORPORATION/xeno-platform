-- UP
-- XENO Docs and Notes (services/workspaceDocs.js): a document IS a Storage file (user_files, stable file_id,
-- versions, shares, trash — nothing about a document is stored twice). This table is only the link index that
-- makes backlinks cheap: which document links to which, by FILE id, rewritten from the document's newest version
-- on every save. It can be rebuilt from the files at any time, so it holds no fact of its own.
-- ADDITIVE ONLY: one new table. DOWN drops exactly it.
CREATE TABLE IF NOT EXISTS workspace_doc_links (
  source_file_id uuid NOT NULL,
  target_file_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_file_id, target_file_id),
  CHECK (source_file_id <> target_file_id)
);
CREATE INDEX IF NOT EXISTS workspace_doc_links_target ON workspace_doc_links (target_file_id);
-- DOWN
DROP INDEX IF EXISTS workspace_doc_links_target;
DROP TABLE IF EXISTS workspace_doc_links;

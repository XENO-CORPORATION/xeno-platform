-- UP
-- XENO Storage (codename Arca): the object that holds a file's bytes in object storage. One row per file
-- row; a row means the object was written and read back at its size. Content-addressed, so two files with
-- the same bytes point at one object. Additive: it changes no existing table.
CREATE TABLE IF NOT EXISTS storage_objects (
  file_id uuid PRIMARY KEY,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  object_key text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  backend text NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storage_objects_sha ON storage_objects(sha256);
-- DOWN
-- Retained deliberately: the rows are the record of which object holds which file.

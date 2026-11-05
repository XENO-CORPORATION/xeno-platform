-- UP
-- The relay carries a third kind of device: a PC running XENO Agent and the devices that control it (xeno-agent-interface
-- decision 0006). ADDITIVE ONLY: one wider CHECK and one nullable column, so every existing row reads exactly as before.
-- Sealed frames are not stored here or anywhere else: this table knows devices, never content.
ALTER TABLE browser_installations DROP CONSTRAINT IF EXISTS browser_installations_surface_check;
ALTER TABLE browser_installations ADD CONSTRAINT browser_installations_surface_check CHECK (surface IN ('browser', 'corpus', 'remote'));
ALTER TABLE browser_installations ADD COLUMN IF NOT EXISTS remote_role text CHECK (remote_role IN ('host', 'device'));
ALTER TABLE browser_installations DROP CONSTRAINT IF EXISTS browser_installations_remote_role_check_surface;
ALTER TABLE browser_installations ADD CONSTRAINT browser_installations_remote_role_check_surface CHECK ((surface = 'remote') = (remote_role IS NOT NULL));

-- DOWN
-- A remote row can't outlive its column, or it would fail the narrower CHECK.
DELETE FROM browser_installations WHERE surface = 'remote';
ALTER TABLE browser_installations DROP CONSTRAINT IF EXISTS browser_installations_remote_role_check_surface;
ALTER TABLE browser_installations DROP COLUMN IF EXISTS remote_role;
ALTER TABLE browser_installations DROP CONSTRAINT IF EXISTS browser_installations_surface_check;
ALTER TABLE browser_installations ADD CONSTRAINT browser_installations_surface_check CHECK (surface IN ('browser', 'corpus'));

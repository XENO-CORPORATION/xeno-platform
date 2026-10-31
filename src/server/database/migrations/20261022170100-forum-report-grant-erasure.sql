-- UP
-- A platform authorization survives erasure of the staff identity that issued
-- it. Keep the grant, but remove the erased actor reference; never block erasure.
ALTER TABLE forum_report_product_grants ALTER COLUMN granted_by DROP NOT NULL;
ALTER TABLE forum_report_product_grants DROP CONSTRAINT forum_report_product_grants_granted_by_fkey;
ALTER TABLE forum_report_product_grants ADD CONSTRAINT forum_report_product_grants_granted_by_fkey
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL;

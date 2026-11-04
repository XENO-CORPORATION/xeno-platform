-- UP
-- The backend behind XENO Company's dashboard (services/companyOrgs.js). A company is a workspace; everything it can derive
-- from workspaces, tuples, invites, the audit log and the ledger stays there. Only two facts had nowhere to live:
--
-- org_agent_employments  which Mind an employed agent runs, a fact an admission can't hold. XENO-WORKFORCE-01 D18: employment
--                        is an admission plus a title, this table is a legal annex and is NEVER read for a permission. So
--                        its role is a relationship_tuples row, and its capabilities are the agent definition's
--                        requestedCapabilities, which run admission already intersects.
-- org_issued_invoices    tax documents. Immutable once issued: a correction is a credit note that references the original.
-- org_invoice_series     numbering. Taken inside the transaction that stores the invoice, so a refused or failed invoice
--                        consumes no number and the series stays gapless, which the law requires.
CREATE TABLE IF NOT EXISTS org_agent_employments (
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mind_id       TEXT NOT NULL CHECK (length(btrim(mind_id)) BETWEEN 1 AND 200),
  employed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (workspace_id, agent_user_id)
);

CREATE TABLE IF NOT EXISTS org_invoice_series (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  series       TEXT NOT NULL CHECK (length(series) BETWEEN 1 AND 40),
  last_number  INTEGER NOT NULL CHECK (last_number >= 0),
  PRIMARY KEY (workspace_id, series)
);

-- RESTRICT, never CASCADE: a tax document outlives the workspace that issued it. The buyer and seller inside the document
-- are the document, so erasing a person does not reach them; retention law wins (issued_by is only who pressed the button).
CREATE TABLE IF NOT EXISTS org_issued_invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  number            TEXT NOT NULL CHECK (length(number) BETWEEN 1 AND 60),
  kind              TEXT NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
  document          JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  ubl               TEXT NOT NULL CHECK (length(ubl) > 0),
  credits_number    TEXT,   -- a credit note: the invoice it reverses
  credited_by       TEXT,   -- an invoice: the credit note that reversed it
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (workspace_id, number),
  CHECK ((kind = 'credit_note') = (credits_number IS NOT NULL)),
  CHECK (kind = 'invoice' OR credited_by IS NULL)
);
CREATE INDEX IF NOT EXISTS org_issued_invoices_workspace ON org_issued_invoices(workspace_id, issued_at DESC, number DESC);

-- The only change an issued invoice ever takes: recording, once, the credit note that reversed it (and a deleted account
-- losing its name on issued_by). Everything else, and any delete or truncate, is refused whoever asks.
CREATE OR REPLACE FUNCTION org_issued_invoices_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'credited_by' - 'issued_by_user_id') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'credited_by' - 'issued_by_user_id')
     AND (NEW.issued_by_user_id IS NOT DISTINCT FROM OLD.issued_by_user_id OR NEW.issued_by_user_id IS NULL)
     AND (NEW.credited_by IS NOT DISTINCT FROM OLD.credited_by OR (OLD.credited_by IS NULL AND NEW.kind = 'invoice')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'an issued invoice is a legal document: correct it with a credit note' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS org_issued_invoices_guard ON org_issued_invoices;
CREATE TRIGGER org_issued_invoices_guard BEFORE UPDATE OR DELETE ON org_issued_invoices
  FOR EACH ROW EXECUTE FUNCTION org_issued_invoices_immutable();
DROP TRIGGER IF EXISTS org_issued_invoices_no_truncate ON org_issued_invoices;
CREATE TRIGGER org_issued_invoices_no_truncate BEFORE TRUNCATE ON org_issued_invoices
  FOR EACH STATEMENT EXECUTE FUNCTION org_issued_invoices_immutable();

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM org_issued_invoices) THEN
    RAISE EXCEPTION 'rollback refused: issued invoices exist, and they are legal documents' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TABLE IF EXISTS org_issued_invoices;
DROP FUNCTION IF EXISTS org_issued_invoices_immutable();
DROP TABLE IF EXISTS org_invoice_series;
DROP TABLE IF EXISTS org_agent_employments;

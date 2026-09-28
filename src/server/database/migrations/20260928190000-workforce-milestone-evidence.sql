-- UP
-- Milestone acceptance extends the existing auditable operation ledger. The
-- contributor-facing statement is explicitly authored, never copied from a run.
ALTER TABLE workforce_operations DROP CONSTRAINT workforce_operations_kind_check;
ALTER TABLE workforce_operations ADD CONSTRAINT workforce_operations_kind_check CHECK(kind IN (
 'member.admit','member.remove','member.promote','division.assign','division.transfer','budget.set',
 'handoff.offer','handoff.accept','handoff.decline','handoff.expire','resource.transfer','milestone.accept'));
ALTER TABLE workforce_operations DROP CONSTRAINT workforce_operations_subject_type_check;
ALTER TABLE workforce_operations ADD CONSTRAINT workforce_operations_subject_type_check CHECK(subject_type IN (
 'resource','membership','division','handoff','budget','milestone'));
CREATE TABLE workforce_milestone_acceptances (
 milestone_id uuid PRIMARY KEY REFERENCES workforce_funding_milestones(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL,
 client_id text NOT NULL,
 operation_id uuid NOT NULL,
 terms_version integer NOT NULL CHECK(terms_version>0),
 contributor_statement text NOT NULL CHECK(octet_length(contributor_statement) BETWEEN 1 AND 4000),
 criteria_count integer NOT NULL CHECK(criteria_count>0),
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(actor_user_id,client_id,operation_id) REFERENCES workforce_operations(actor_user_id,client_id,operation_id) ON DELETE RESTRICT
);
CREATE TABLE workforce_milestone_evidence (
 milestone_id uuid NOT NULL REFERENCES workforce_milestone_acceptances(milestone_id) ON DELETE RESTRICT,
 admission_id uuid NOT NULL REFERENCES workforce_run_results(admission_id) ON DELETE RESTRICT,
 report_hash text NOT NULL CHECK(report_hash ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(milestone_id,admission_id)
);
CREATE TRIGGER workforce_milestone_acceptance_retained BEFORE UPDATE OR DELETE ON workforce_milestone_acceptances
 FOR EACH ROW EXECUTE FUNCTION workforce_operation_immutable();
CREATE TRIGGER workforce_milestone_acceptance_no_truncate BEFORE TRUNCATE ON workforce_milestone_acceptances
 FOR EACH STATEMENT EXECUTE FUNCTION workforce_operation_immutable();
CREATE TRIGGER workforce_milestone_evidence_retained BEFORE UPDATE OR DELETE ON workforce_milestone_evidence
 FOR EACH ROW EXECUTE FUNCTION workforce_operation_immutable();
CREATE TRIGGER workforce_milestone_evidence_no_truncate BEFORE TRUNCATE ON workforce_milestone_evidence
 FOR EACH STATEMENT EXECUTE FUNCTION workforce_operation_immutable();

-- DOWN
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM workforce_milestone_acceptances) OR EXISTS(SELECT 1 FROM workforce_operations WHERE kind='milestone.accept') THEN
  RAISE EXCEPTION 'milestone evidence rollback refused: retained decisions exist' USING ERRCODE='23514';
 END IF;
END $$;
DROP TABLE workforce_milestone_evidence;
DROP TABLE workforce_milestone_acceptances;
ALTER TABLE workforce_operations DROP CONSTRAINT workforce_operations_kind_check;
ALTER TABLE workforce_operations ADD CONSTRAINT workforce_operations_kind_check CHECK(kind IN (
 'member.admit','member.remove','member.promote','division.assign','division.transfer','budget.set',
 'handoff.offer','handoff.accept','handoff.decline','handoff.expire','resource.transfer'));
ALTER TABLE workforce_operations DROP CONSTRAINT workforce_operations_subject_type_check;
ALTER TABLE workforce_operations ADD CONSTRAINT workforce_operations_subject_type_check CHECK(subject_type IN ('resource','membership','division','handoff','budget'));

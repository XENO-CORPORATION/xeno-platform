-- UP
-- Scope ceilings constrain every pool in that scope, not an independent wallet.
CREATE TABLE workforce_scope_spend_caps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scope_kind text NOT NULL CHECK(scope_kind IN ('project','workspace')),
 scope_id uuid NOT NULL,
 project_id uuid REFERENCES chat_projects(id) ON DELETE RESTRICT,
 workspace_id uuid REFERENCES workspaces(id) ON DELETE RESTRICT,
 proposed_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 client_id text NOT NULL,
 operation_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 window_seconds integer NOT NULL CHECK(window_seconds BETWEEN 1 AND 31536000),
 limit_micro bigint NOT NULL CHECK(limit_micro>=0),
 state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','approved','rejected','superseded')),
 decided_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 decision_operation_id uuid,
 decided_at timestamptz,
 superseded_by uuid REFERENCES workforce_scope_spend_caps(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(proposed_by_user_id,client_id,operation_id),
 CHECK((scope_kind='project' AND project_id=scope_id AND workspace_id IS NULL AND project_id IS NOT NULL)
   OR (scope_kind='workspace' AND workspace_id=scope_id AND project_id IS NULL AND workspace_id IS NOT NULL)),
 CHECK(decided_by_user_id IS NULL OR decided_by_user_id<>proposed_by_user_id),
 CHECK((decided_by_user_id IS NULL)=(decision_operation_id IS NULL)),
 CHECK((decided_by_user_id IS NULL)=(decided_at IS NULL))
);
CREATE UNIQUE INDEX workforce_scope_spend_cap_active ON workforce_scope_spend_caps(scope_kind,scope_id,window_seconds) WHERE state='approved';
CREATE FUNCTION workforce_scope_spend_cap_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'scope cap decisions are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'proposed' OR NEW.decided_by_user_id IS NOT NULL OR NEW.superseded_by IS NOT NULL THEN
   RAISE EXCEPTION 'scope cap begins as a proposal' USING ERRCODE='23514';
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','decided_by_user_id','decision_operation_id','decided_at','superseded_by']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','decided_by_user_id','decision_operation_id','decided_at','superseded_by']) THEN
   RAISE EXCEPTION 'scope cap terms are immutable' USING ERRCODE='23514';
  END IF;
  IF NOT ((OLD.state='proposed' AND NEW.state IN ('approved','rejected') AND NEW.decided_by_user_id IS NOT NULL AND NEW.superseded_by IS NULL)
   OR (OLD.state='approved' AND NEW.state='superseded' AND NEW.superseded_by IS NOT NULL
      AND ROW(NEW.decided_by_user_id,NEW.decision_operation_id,NEW.decided_at) IS NOT DISTINCT FROM ROW(OLD.decided_by_user_id,OLD.decision_operation_id,OLD.decided_at))) THEN
   RAISE EXCEPTION 'invalid scope cap transition' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workforce_scope_spend_cap_guard BEFORE INSERT OR UPDATE OR DELETE ON workforce_scope_spend_caps
 FOR EACH ROW EXECUTE FUNCTION workforce_scope_spend_cap_guard();
CREATE TRIGGER workforce_scope_spend_cap_retained BEFORE TRUNCATE ON workforce_scope_spend_caps
 FOR EACH STATEMENT EXECUTE FUNCTION workforce_scope_spend_cap_guard();
DO $harden$ BEGIN
 EXECUTE format('ALTER FUNCTION %I.workforce_scope_spend_cap_guard() SET search_path = %I, pg_temp',current_schema(),current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM workforce_scope_spend_caps) THEN RAISE EXCEPTION 'scope cap rollback refused: retained decisions exist' USING ERRCODE='23514'; END IF;
END $$;
DROP TABLE workforce_scope_spend_caps;
DROP FUNCTION workforce_scope_spend_cap_guard();

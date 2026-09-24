-- UP
-- XENO-WORKFORCE-01 HAND-06 -- no silent history transfer.
--
--   "As with SES-05, a handoff shows the target audience and the included historical content.
--    Handing work to another division does not disclose the sender's private transcript."
--   T98: "... no transcript disclosed to the target beyond the declared audience (HAND-06)"
--
-- Measured before building: workforce_handoffs carries a work reference and an optional
-- artifact_ref, and nothing else. No column names an audience or the history a handoff includes,
-- so there was nothing to show and nothing to consent to. The handoff suite refused to cite HAND-06
-- for exactly that reason: a handoff could not carry a transcript, but "cannot carry one" is an
-- absence, and HAND-06 asks for a disclosure the sender declares and the target can see.
--
-- ── THE DISCLOSURE IS PART OF THE OFFER, FIXED WHEN IT IS MADE ──────────────────────────────
-- Two columns on the handoff itself, rather than a child table, so the offer and the history it
-- carries are ONE atomic declaration. The target accepts the row, and with it exactly this
-- disclosure. A child table could gain a message after the target looked and before it
-- accepted, which is the silent transfer this requirement forbids.
--
--   disclosed_message_ids   the exact messages included, by id. Default empty: a handoff that
--                           declares nothing discloses nothing.
--   disclosure_audience     the exact principals who may read them. Must contain the target
--                           whenever anything is included. Wider is allowed, but only by declaring it.
--
-- Both are immutable after the insert. Widening the audience or adding a message is a new offer.
--
-- ── ONLY HISTORY THE SENDER MAY DISCLOSE ────────────────────────────────────────────────────
-- An included message must belong to a conversation the SOURCE principal may hand on:
--   * its own personal conversation (its private transcript, disclosed because it says so),
--   * a conversation in the handoff's SOURCE workspace, or
--   * a conversation in a project the source owns personally or that belongs to the source
--     workspace.
-- A sender cannot pass on someone else's private conversation or another workspace's history,
-- even for messages it can see.
--
-- ── WHAT CROSSES, AND WHEN ─────────────────────────────────────────────────────────────────
--   workforce_handoff_disclosure_manifest(handoff)   what is included: message, conversation,
--       role and time, with no content. This is what "shows the included historical content"
--       means before anyone has agreed to anything, and it is readable at every state.
--   workforce_handoff_disclosed_history(handoff, reader)   the content, and only for a reader in
--       the declared audience of an ACCEPTED handoff. The query uses the declared ids, never
--       the conversation, so the rest of the sender's transcript does not come with it.
--       Offered, declined and expired handoffs disclose nothing.
--
-- Both are plpgsql, so chat_messages is a RUNTIME dependency, not one the migration needs to
-- apply. The workforce chain still applies from an empty database.

ALTER TABLE workforce_handoffs
  ADD COLUMN disclosed_message_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN disclosure_audience UUID[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT workforce_handoff_disclosure_shape CHECK (
    cardinality(disclosed_message_ids) <= 500 AND cardinality(disclosure_audience) <= 64
    AND array_position(disclosed_message_ids, NULL) IS NULL
    AND array_position(disclosure_audience, NULL) IS NULL),
  -- The target always reads what it is handed. A disclosure whose audience omits the target would
  -- show history to people who are not doing the work, and not to the one who is.
  ADD CONSTRAINT workforce_handoff_disclosure_reaches_target CHECK (
    cardinality(disclosed_message_ids) = 0 OR target_principal_id = ANY(disclosure_audience));

CREATE FUNCTION workforce_handoff_disclosure_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE msg UUID; conv RECORD; proj RECORD; disclosable BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.disclosed_message_ids IS DISTINCT FROM OLD.disclosed_message_ids
       OR NEW.disclosure_audience IS DISTINCT FROM OLD.disclosure_audience THEN
      RAISE EXCEPTION 'a handoff''s disclosure is what the target was offered; it is immutable -- make a new offer'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF (SELECT count(DISTINCT x) FROM unnest(NEW.disclosure_audience) x) <> cardinality(NEW.disclosure_audience)
     OR (SELECT count(DISTINCT x) FROM unnest(NEW.disclosed_message_ids) x) <> cardinality(NEW.disclosed_message_ids) THEN
    RAISE EXCEPTION 'a disclosure names each message and each reader once' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.disclosure_audience) a WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = a)) THEN
    RAISE EXCEPTION 'a disclosure audience names real principals' USING ERRCODE='23514';
  END IF;

  FOREACH msg IN ARRAY NEW.disclosed_message_ids LOOP
    SELECT c.owner_user_id, c.project_id, c.workspace_id INTO conv
      FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
     WHERE m.id = msg;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'a disclosure declares messages that exist' USING ERRCODE='23514';
    END IF;
    IF conv.owner_user_id IS NOT NULL THEN
      disclosable := conv.owner_user_id = NEW.source_principal_id;
    ELSIF conv.workspace_id IS NOT NULL THEN
      disclosable := conv.workspace_id = NEW.source_workspace_id;
    ELSE
      SELECT owner_user_id, workspace_id INTO proj FROM chat_projects WHERE id = conv.project_id;
      disclosable := FOUND AND (proj.owner_user_id = NEW.source_principal_id
                                OR proj.workspace_id = NEW.source_workspace_id);
    END IF;
    IF NOT coalesce(disclosable, false) THEN
      RAISE EXCEPTION 'a sender may disclose only its own transcript or its source workspace''s history'
        USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workforce_handoff_disclosure_guard_trigger
BEFORE INSERT OR UPDATE ON workforce_handoffs
FOR EACH ROW EXECUTE FUNCTION workforce_handoff_disclosure_guard();

-- What the handoff includes, readable in every state: which messages, from which conversation,
-- by which role and when. No content.
CREATE FUNCTION workforce_handoff_disclosure_manifest(p_handoff UUID)
RETURNS TABLE(message_id UUID, conversation_id UUID, role TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT m.id, m.conversation_id, m.role::text, m.created_at::timestamptz
    FROM workforce_handoffs h
    JOIN chat_messages m ON m.id = ANY(h.disclosed_message_ids)
   WHERE h.id = p_handoff
   ORDER BY m.conversation_id, m.message_index, m.id;
END;
$$;

-- The content: only the declared messages, only to the declared audience, only once accepted.
CREATE FUNCTION workforce_handoff_disclosed_history(p_handoff UUID, p_reader UUID)
RETURNS TABLE(message_id UUID, conversation_id UUID, role TEXT, content TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT m.id, m.conversation_id, m.role::text, m.content, m.created_at::timestamptz
    FROM workforce_handoffs h
    JOIN chat_messages m ON m.id = ANY(h.disclosed_message_ids)
   WHERE h.id = p_handoff AND h.state = 'accepted' AND p_reader = ANY(h.disclosure_audience)
   ORDER BY m.conversation_id, m.message_index, m.id;
END;
$$;

DO $harden$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_handoff_disclosure_guard() SET search_path = %I, pg_temp',
    current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_handoff_disclosure_manifest(uuid) SET search_path = %I, pg_temp',
    current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_handoff_disclosed_history(uuid, uuid) SET search_path = %I, pg_temp',
    current_schema(), current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_handoffs WHERE cardinality(disclosed_message_ids) > 0) THEN
    RAISE EXCEPTION 'handoff disclosure rollback refused: declared disclosures exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP FUNCTION workforce_handoff_disclosed_history(uuid, uuid);
DROP FUNCTION workforce_handoff_disclosure_manifest(uuid);
DROP TRIGGER workforce_handoff_disclosure_guard_trigger ON workforce_handoffs;
DROP FUNCTION workforce_handoff_disclosure_guard();
ALTER TABLE workforce_handoffs
  DROP CONSTRAINT workforce_handoff_disclosure_reaches_target,
  DROP CONSTRAINT workforce_handoff_disclosure_shape,
  DROP COLUMN disclosure_audience,
  DROP COLUMN disclosed_message_ids;

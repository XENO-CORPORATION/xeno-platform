-- chat_messages remembers the TURN — what the assistant did before it answered.
--
-- WHY
-- ---
-- A Chat turn is no longer one call: it searches (up to three times), reads, thinks, then
-- answers. The client showed that as a live "Searching: …" placeholder and then threw it
-- away — the stored message kept the answer, the thinking and the evidence receipt, but not
-- the sequence of steps, so a reopened conversation had no rail to fold or unfold. The
-- transcript (D10 of XENO AGENT PANEL - SPEC, consumed from @xenosystem/agent-conversation)
-- renders the turn as a clock line over a rail of steps; it needs the steps to survive.
--
-- WHAT
-- ----
-- One nullable JSONB column, `turn`, written by the client that observed the turn:
-- { schema: 'xeno.chat.turn.v1', startedAt, endedAt?, thinkingMs?, steps: [...] }.
-- It is PRESENTATIONAL — the record of what was shown — never evidence. Provenance of
-- what was read stays in `search_context`, which remains server-owned. The route bounds
-- and validates the shape before storing it.

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS turn JSONB;

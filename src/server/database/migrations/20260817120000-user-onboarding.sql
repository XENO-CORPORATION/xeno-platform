-- ═══════════════════════════════════════════════════════════════════════════
-- Onboarding answers.
--
-- WHY A TABLE AND NOT A BLOB IN user_settings
-- -------------------------------------------
-- `user_settings.settings` is a jsonb bag for UI preferences — theme, panel
-- widths, things nobody queries across users. Onboarding answers are the
-- opposite: their whole value is the aggregate. "What are people signing up to
-- do?" and "where did they hear about us?" are the two questions this data
-- exists to answer, and both are `GROUP BY` queries.
--
-- Answers buried in jsonb make those queries possible but awkward, and — more
-- to the point — unenforceable: nothing stops one release writing `role` and
-- the next writing `userRole`, and you find out months later when the report is
-- half empty. Columns make the shape a schema decision instead of a convention.
--
-- ONE ROW PER USER, and the PK enforces it. Onboarding is a thing you finish,
-- not an event stream — re-running it corrects your answers rather than
-- appending a second opinion. That is what the UPSERT in the route relies on.
--
-- ON DELETE CASCADE because this is worthless without the user, and because
-- the account purge already found twenty tables that hold user_id with no FK
-- and therefore survived deletion. Not adding a twenty-first.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_onboarding (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    -- Step 1 — who they are. `display_name` is deliberately NOT copied into
    -- users.name: this is what they want to be called, which is not always the
    -- name on the account, and overwriting the account name from an optional
    -- onboarding field is a surprise nobody asked for.
    display_name   TEXT,
    heard_from     TEXT,

    -- Step 2 — one role. Free text rather than an enum: an enum here needs a
    -- migration every time the list changes, and the list WILL change. The UI
    -- offers a fixed set; the column records what was chosen.
    role           TEXT,

    -- Step 3 — many interests, stored as the catalog's own category strings so
    -- this joins to productCatalog without a translation table that can rot.
    interests      TEXT[]    NOT NULL DEFAULT '{}',

    -- Step 4 — where they actually went. NULL means they finished onboarding
    -- without picking anything, which is a real and different answer from
    -- never having reached the step.
    starting_point TEXT,

    -- Completion. `skipped_at` is separate from `completed_at` on purpose:
    -- "skipped immediately" and "answered everything" are both terminal, and
    -- collapsing them into one timestamp destroys the only signal that says
    -- whether the flow is worth keeping.
    completed_at   TIMESTAMPTZ,
    skipped_at     TIMESTAMPTZ,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The aggregate queries this table exists for. Partial, because rows in
-- progress are noise in every one of them.
CREATE INDEX IF NOT EXISTS idx_user_onboarding_role
    ON user_onboarding(role) WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_onboarding_heard_from
    ON user_onboarding(heard_from) WHERE heard_from IS NOT NULL;

-- GIN so `interests && ARRAY['Create']` is an index scan rather than a
-- sequential scan over every account.
CREATE INDEX IF NOT EXISTS idx_user_onboarding_interests
    ON user_onboarding USING GIN(interests);

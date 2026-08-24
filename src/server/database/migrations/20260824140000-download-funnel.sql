-- The download funnel: one intent, carried across every boundary.
--
-- ── THE IDEA ────────────────────────────────────────────────────────────────
--
-- A person expresses ONE intent — "I want Hub for Windows" — and then has to
-- cross up to four boundaries: identity, profile, payment, entitlement. Every
-- one of those currently destroys the intent, which is why the funnel leaks and
-- why nobody can answer "did this account exist because someone wanted Pixel?".
--
-- An intent is created the moment the wish is expressed, by anyone, signed in or
-- not, and it survives all four crossings.
--
-- 🔴 AN INTENT CARRIES NO AUTHORITY. It names a wish, never a permission. The
-- token is minted before we know who the person is, it travels in URLs, through
-- Stripe, and through an OAuth round-trip via a third party — so it must be
-- worthless to steal. Everything that opens bytes stays behind the short-lived,
-- artifact-bound download grant, which is minted only against a live entitlement
-- check. Someone else's intent token gets an attacker exactly one thing: the
-- name of a product they could have read off the website anyway.
--
-- That is why there is no `entitled` column here and never should be. The moment
-- this table records a permission, a pre-auth object becomes a credential.

CREATE TABLE IF NOT EXISTS download_intents (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Opaque, URL-safe, unguessable. Not the id: the id is ours, the token is
    -- what we hand out, and keeping them distinct means a leaked URL never
    -- exposes a primary key or its ordering.
    token          TEXT NOT NULL UNIQUE,

    -- What was wanted. Resolved at fulfilment, not now — "latest" on Monday is a
    -- different file from "latest" on Friday, and the intent records the WISH.
    slug           TEXT NOT NULL,
    os             TEXT NOT NULL,
    version        TEXT NOT NULL DEFAULT '',
    channel        TEXT NOT NULL DEFAULT 'stable',

    -- Who. `anon_id` is a first-party visitor id that exists BEFORE an account
    -- does; it is the only way to attribute a signup to the download that caused
    -- it. `user_id` is filled the moment we learn it and never cleared.
    anon_id        TEXT,
    user_id        UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Where it started. This is the marketing question — which page, which
    -- campaign, produced the wish.
    origin_path    TEXT,
    referrer       TEXT,
    utm            JSONB NOT NULL DEFAULT '{}'::jsonb,

    status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'fulfilled', 'expired')),

    -- Denormalised attribution. Derivable from the event log, kept here because
    -- the questions this exists to answer ("how many accounts were created BY a
    -- download attempt?") are aggregate queries, and making every one of them a
    -- window function over an event table is how a funnel stops being measured.
    -- The event log stays the source of truth; these are a materialised summary.
    required_signin     BOOLEAN NOT NULL DEFAULT FALSE,
    required_signup     BOOLEAN NOT NULL DEFAULT FALSE,
    required_onboarding BOOLEAN NOT NULL DEFAULT FALSE,
    required_purchase   BOOLEAN NOT NULL DEFAULT FALSE,
    purchased_plan      TEXT,
    checkout_session_id TEXT,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fulfilled_at   TIMESTAMPTZ,

    -- An intent is a shopping trip, not a licence. It expires so the table does
    -- not become an unbounded log of every button press ever made.
    expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX IF NOT EXISTS idx_download_intents_user    ON download_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_download_intents_anon    ON download_intents(anon_id);
CREATE INDEX IF NOT EXISTS idx_download_intents_slug    ON download_intents(slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_download_intents_open    ON download_intents(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_download_intents_session ON download_intents(checkout_session_id)
    WHERE checkout_session_id IS NOT NULL;

-- ── The event log ───────────────────────────────────────────────────────────
--
-- Append-only. Every step the person took, in order, with the timestamp. This is
-- what answers "who signed in when, and what were they trying to download".
--
-- `step` is deliberately NOT an enum. A funnel gains steps — that is what a
-- funnel does — and a CHECK constraint here means every new step is a migration
-- plus a deploy, which is exactly the friction that makes people stop recording
-- steps. The vocabulary is asserted in code, where it is cheap to extend.

CREATE TABLE IF NOT EXISTS download_intent_events (
    id          BIGSERIAL PRIMARY KEY,
    intent_id   UUID NOT NULL REFERENCES download_intents(id) ON DELETE CASCADE,
    step        TEXT NOT NULL,
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    client_ip   TEXT,
    at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dl_events_intent ON download_intent_events(intent_id, at);
CREATE INDEX IF NOT EXISTS idx_dl_events_step   ON download_intent_events(step, at DESC);

-- ── The grant audit ─────────────────────────────────────────────────────────
--
-- Every grant ever minted. Separate from the intent log on purpose: a grant is
-- an EXERCISE OF AUTHORITY and an intent is a wish, and the two have different
-- retention, different sensitivity and different readers. Conflating them means
-- expiring the funnel analytics also expires the security audit.
--
-- This is also the substrate for abuse detection: an account minting grants for
-- eleven products in four minutes is visible here and nowhere else.

CREATE TABLE IF NOT EXISTS download_grants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    intent_id   UUID REFERENCES download_intents(id) ON DELETE SET NULL,
    slug        TEXT NOT NULL,
    os          TEXT NOT NULL,
    version     TEXT NOT NULL DEFAULT '',
    plan        TEXT,
    client_ip   TEXT,
    user_agent  TEXT,
    at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_download_grants_user ON download_grants(user_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_download_grants_slug ON download_grants(slug, at DESC);

-- Minimum supported client version, per product.
--
-- ── THE PROBLEM THIS SOLVES, STATED HONESTLY ────────────────────────────────
--
-- An installer built before licence enforcement existed has no licence check
-- compiled into it. Nothing we deploy can make that binary refuse itself — the
-- code is not there, and no amount of server work puts it there.
--
-- 🔴 But a XENO app is only worth running because of what it can REACH. Auth,
-- credits, inference, cloud sync, the agent, the marketplace — all of it is on
-- our side of the wire. So the enforceable question is not "can we make the old
-- binary stop?" but "can we stop answering it?", and that we control completely.
--
-- ── WHY THIS WORKS ON BUILDS THAT PREDATE IT ────────────────────────────────
--
-- Because clients already identify themselves without ever having been asked to.
-- Measured in production on 2026-08-24, `api_usage_logs.user_agent` carries
-- `XenoCode/0.2.0` and `XenoHarbor/0.2.0` — Electron and Node set a versioned
-- User-Agent by default. A build from before any of this was designed is
-- therefore still attributable to a product and a version.
--
-- That is the whole reason this control can be retroactive. If clients were
-- anonymous, it could only ever bind builds that opted in — which is exactly the
-- population that does not need binding.
--
-- ── WHAT IT DELIBERATELY CANNOT DO ──────────────────────────────────────────
--
-- ⚠️ A caller that sends no recognisable identity cannot be refused BY VERSION,
-- because there is nothing to compare. Those requests fall through to ordinary
-- auth and entitlement, which still refuse an account with no plan. Refusing
-- unidentified callers outright would break `curl`, the SDKs and every
-- integration, to catch a case the account gate already covers.
--
-- ⚠️ And local, offline work in an old build keeps working. Editing a file on
-- someone's own laptop is not something we are in a position to stop, and
-- pretending otherwise in a schema comment would be the dishonest option.

CREATE TABLE IF NOT EXISTS client_version_policy (
    product          TEXT PRIMARY KEY,

    -- Below this, the API refuses with 426. NULL = no floor, which is the
    -- DEFAULT for every product: a policy row must be created deliberately.
    -- Defaulting to a floor would mean adding this table silently locked out
    -- every existing user of every product at once.
    min_supported    TEXT,

    -- Below this, requests succeed but carry an advisory header. This is the
    -- honest middle: "you should update" is a different statement from "you may
    -- not continue", and collapsing them removes the only warning a user gets.
    min_recommended  TEXT,

    -- Shown to the person, not logged for us. It must say what to DO.
    message          TEXT,

    -- When the floor actually starts being enforced. A policy can therefore be
    -- published and announced BEFORE it bites, which is the difference between
    -- a deprecation and an outage.
    enforced_at      TIMESTAMPTZ,

    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by       UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Every refusal is recorded. Without this, "how many people did we just lock
-- out, and which builds were they on?" is unanswerable at exactly the moment it
-- is most urgent — and a version floor is the kind of control whose blast radius
-- is invisible until someone complains.
CREATE TABLE IF NOT EXISTS client_version_refusals (
    id          BIGSERIAL PRIMARY KEY,
    product     TEXT NOT NULL,
    version     TEXT,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    path        TEXT,
    client_ip   TEXT,
    user_agent  TEXT,
    at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cvr_product ON client_version_refusals(product, at DESC);
CREATE INDEX IF NOT EXISTS idx_cvr_user    ON client_version_refusals(user_id, at DESC);

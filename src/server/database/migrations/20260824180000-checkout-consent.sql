-- Consent captured at checkout — the record that makes a digital sale final.
--
-- ⚠️ NOT LEGAL ADVICE. This implements a mechanism; whether the wording and the
-- tax position are correct for your entity is a question for a Rechtsanwalt and a
-- Steuerberater. What is engineering, and is done here, is CAPTURING and PROVING
-- the consent — because a policy page nobody clicked is not consent.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
--
-- Under the EU Consumer Rights Directive (2011/83/EU; in Germany §§ 312g, 356
-- BGB) a consumer buying at a distance has 14 days to withdraw, for any reason.
--
-- For digital content delivered immediately that right CAN be lost, but only if
-- the trader obtains, before delivery, BOTH:
--
--   1. express prior consent to begin performance during the withdrawal period, AND
--   2. acknowledgement that doing so LOSES the right of withdrawal
--
-- and then confirms that consent on a durable medium.
--
-- 🔴 Miss any part and the right SURVIVES: a customer can use the software for
-- thirteen days and demand a full refund, and be entitled to it. The download
-- gate makes this sharper rather than softer — we hand over an installer the
-- moment payment clears, which is exactly the "immediate performance" the
-- directive is about.
--
-- ── WHY A TABLE AND NOT A CHECKBOX ──────────────────────────────────────────
--
-- The obligation is not "show a checkbox", it is "be able to demonstrate that
-- this person consented, to this wording, at this time". A checkbox whose state
-- is never stored proves nothing three months later in a chargeback. So the
-- WORDING is stored with the consent — a later edit to the terms page must not
-- silently rewrite what someone agreed to.

CREATE TABLE IF NOT EXISTS checkout_consents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- What they were buying. Not a foreign key: catalogue ids are code, and a
    -- consent must outlive the item being renamed or retired.
    item_id       TEXT NOT NULL,

    -- The two separate acknowledgements. Kept as distinct columns because they
    -- are distinct legal acts, and a single "agreed: true" cannot show which.
    immediate_performance   BOOLEAN NOT NULL,
    withdrawal_acknowledged BOOLEAN NOT NULL,
    terms_accepted          BOOLEAN NOT NULL,

    -- 🔴 The exact text shown, hashed AND stored. Storing only a version string
    -- means a silent edit to the page rewrites history; storing the text means
    -- the record answers "what did they actually agree to?" without trusting
    -- that anything else was kept.
    consent_text  TEXT NOT NULL,
    consent_hash  TEXT NOT NULL,
    locale        TEXT,

    -- Evidence of the act itself.
    client_ip     TEXT,
    user_agent    TEXT,
    consented_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Linked once the Stripe session exists, so a consent can be tied to the
    -- payment it authorised.
    checkout_session_id TEXT,

    -- A consent authorises ONE purchase. Reusing an old one would let a single
    -- historic click stand in for every future sale.
    consumed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_checkout_consents_user ON checkout_consents(user_id, consented_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkout_consents_session ON checkout_consents(checkout_session_id)
    WHERE checkout_session_id IS NOT NULL;
-- Unconsumed consents, for the lookup on the checkout path.
CREATE INDEX IF NOT EXISTS idx_checkout_consents_open ON checkout_consents(user_id, item_id)
    WHERE consumed_at IS NULL;

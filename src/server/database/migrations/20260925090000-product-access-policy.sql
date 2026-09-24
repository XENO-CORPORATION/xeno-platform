-- Who may USE a product — per product, decided on the server.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
--
-- Every XENO desktop app is being put behind the same door (XENO AUTH - AUTH GATE
-- DELTA §9): nothing of the app renders until the person is signed in AND the
-- server says this account may use this product. The app never decides that
-- itself — it asks `/api/billing/entitlements` and shows the answer.
--
-- Until now the only answer was one global flag, `entitlements.canUse`, which is
-- true for a free account. That is right for "may this account call our servers"
-- and wrong for "may this account use Canvas", which is a per-product decision
-- the owner wants to make, and change, without shipping an app.
--
-- ── THE VOCABULARY, AND WHY IT IS SMALL ─────────────────────────────────────
--
--   account    any signed-in account in good standing (suspension is refused
--              separately, before any route — middleware/suspensionGate.js)
--   paid-plan  an active paid or staff plan — the same boundary as the download
--              gate (`entitlements.canDownload`)
--
-- Two values, not a rules engine. Feature gates (agent, sync, collaboration)
-- already live in PLAN_ENTITLEMENTS and are enforced where the feature runs;
-- this table answers only the door's question. A third value is one CHECK
-- constraint change when a real need names it.
--
-- ── DEFAULT: NO ROW ─────────────────────────────────────────────────────────
--
-- A product with no row keeps today's behaviour exactly (`canUse`). A table that
-- defaulted to a policy would have changed every product's door the moment it
-- was created — the same reasoning as client_version_policy's NULL floor.

CREATE TABLE IF NOT EXISTS product_access_policy (
    product     TEXT PRIMARY KEY,
    access      TEXT NOT NULL CHECK (access IN ('account', 'paid-plan')),
    -- Shown to the person the door refuses. It must say what to DO.
    message     TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Canvas is the first product behind the door (DELTA §9.4): paid or staff only,
-- which is what "secure our development and loop out the people who got it
-- before" requires while signup is open. Idempotent, and it never overwrites an
-- operator's later decision.
INSERT INTO product_access_policy (product, access, message)
VALUES ('canvas', 'paid-plan', 'XENO Canvas needs an active XENO plan.')
ON CONFLICT (product) DO NOTHING;

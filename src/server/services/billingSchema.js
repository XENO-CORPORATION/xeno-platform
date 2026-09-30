// ── Schema (idempotent, lazy) ────────────────────────────────────────────────
let schemaPromise = null;
export function ensureSchema(pool) {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS billing_customers (
        user_id            text PRIMARY KEY,
        stripe_customer_id text UNIQUE NOT NULL,
        created_at         timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS billing_events (
        event_id   text PRIMARY KEY,
        type       text,
        user_id    text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      -- Maps a settled charge (payment_intent) → the credits it granted, so a later
      -- refund/dispute can claw back the right amount. refunded_micro tracks the
      -- cumulative clawback so partial + repeated refunds never over/under-reverse.
      CREATE TABLE IF NOT EXISTS billing_charges (
        payment_intent text PRIMARY KEY,
        user_id        text NOT NULL,
        credits_micro  bigint NOT NULL,
        refunded_micro bigint NOT NULL DEFAULT 0,
        event_id       text,
        created_at     timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS xeno_account_plans (
        user_id                text PRIMARY KEY,
        plan                   text NOT NULL DEFAULT 'free',
        status                 text,
        stripe_subscription_id text,
        current_period_end     timestamptz,
        updated_at             timestamptz NOT NULL DEFAULT now()
      );
    `).catch((e) => { schemaPromise = null; throw e; });
  }
  return schemaPromise;
}

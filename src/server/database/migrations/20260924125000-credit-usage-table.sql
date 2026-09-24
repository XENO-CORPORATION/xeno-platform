-- credit_usage is written by the marketplace acquisition path (marketplaceService.acquireListing), by
-- utils/creditTransactions.logUsage and read by analyticsRoutes -- but NO migration created it. It
-- existed only on databases set up before versioned migrations, from credit-usage-schema.sql, which
-- nothing runs. So on any database built from migrations, buying, subscribing to or renting a
-- listing failed with 42P01 AFTER the credits had been debited (the purchase then refunded).
--
-- Found 2026-09-24 by marketplace-rentals.test.mjs on a migrated database. The DDL below is the same
-- as credit-usage-schema.sql, and every statement is IF NOT EXISTS: a no-op on a database that already
-- has the table, the missing table everywhere else.
CREATE TABLE IF NOT EXISTS credit_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature VARCHAR(255) NOT NULL,
    credits_used INTEGER NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_usage_user_id ON credit_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_usage_created_at ON credit_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_usage_feature ON credit_usage(feature);

/**
 * Marketplace service — data access + commerce logic for /api/marketplace.
 *
 * Source of truth lives in Postgres (SPEC §3). This module owns:
 *   - catalog/listing serialization (signed-URL resolution for gated artifacts)
 *   - entitlement resolution + checks
 *   - the purchase / subscribe / rent flow (entitlement + transaction +
 *     credits-ledger entry + creator-earnings accrual), all in one DB txn
 *   - the payoutsProvider seam (real Stripe cash-out is not yet wired; the
 *     request is persisted and returned as `not_implemented` — NOT faked)
 *
 * Credits ledger reality (D6): the existing ledger is `users.credits` (balance)
 * + the `credit_usage` log, with helpers in utils/creditTransactions.js. We
 * reuse those helpers directly — deductCredits() does row-locked atomic spend,
 * logUsage() writes the ledger row. No new ledger system is invented.
 */

import { deductCredits, refundCredits, logUsage } from '../utils/creditTransactions.js';
import { generateSignedUrl } from '../middleware/cdnOptimization.js';

// Platform fee, configurable via env. Default 25% (SPEC §12 open Q1: propose
// 20–30%; 0 for official first-party since there is no external creator).
const DEFAULT_PLATFORM_FEE_PCT = Number(process.env.MARKETPLACE_PLATFORM_FEE_PCT ?? 25);
const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60; // 6h, matches the model-catalog precedent

function platformFeePct(listing) {
  // First-party / official listings take 0% (no external creator to pay).
  if (listing.is_first_party || listing.trust_tier === 'official' || !listing.developer_id) return 0;
  const pct = DEFAULT_PLATFORM_FEE_PCT;
  return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : 25;
}

// --------------------------------------------------------------------------
// Serialization
// --------------------------------------------------------------------------

export function serializeListingSummary(row) {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    category: row.category,
    trustTier: row.trust_tier,
    iconUrl: row.icon_url,
    screenshots: Array.isArray(row.screenshots) ? row.screenshots : [],
    license: row.license,
    status: row.status,
    currentVersion: row.current_version,
    isFirstParty: row.is_first_party,
    developerId: row.developer_id,
    developerName: row.developer_name ?? null,
    ratingAvg: Number(row.rating_avg ?? 0),
    ratingCount: row.rating_count ?? 0,
    installCount: Number(row.install_count ?? 0),
    pricing: Array.isArray(row.pricing) ? row.pricing.map(serializePricing) : [],
    publishedAt: row.published_at,
    // Install metadata for app-native listings (executableName, installDirName,
    // versionUrl). Consumed by Hub to drive the creativeApps install pipeline.
    installMeta: row.install_meta ?? null,
    // The first-party creative-app id an app-native listing maps onto (seed slug
    // convention is `app-<id>`, e.g. app-pixel → pixel). Explicit so Hub need not
    // parse the slug.
    nativeAppId:
      row.kind === 'app-native' && typeof row.slug === 'string' && row.slug.startsWith('app-')
        ? row.slug.slice(4)
        : null,
  };
}

export function serializePricing(p) {
  return {
    model: p.model,
    priceCredits: p.price_credits,
    priceUsd: p.price_usd != null ? Number(p.price_usd) : null,
    period: p.period ?? null,
    meterUnit: p.meter_unit ?? null,
  };
}

/**
 * Serialize a version. Resolves a download URL only when `entitled` is true and
 * the artifact is entitlement-gated; otherwise returns the public artifact_url
 * (used by official native installers distributed openly on R2).
 */
export function serializeVersion(v, { entitled = false, gated = false } = {}) {
  let downloadUrl = null;
  if (v.artifact_url) {
    downloadUrl = v.artifact_url; // openly distributed
  } else if (v.artifact_r2_key && (!gated || entitled)) {
    downloadUrl = generateSignedUrl(v.artifact_r2_key, SIGNED_URL_TTL_SECONDS);
  }
  return {
    id: v.id,
    version: v.version,
    releaseNotes: v.release_notes,
    declaredCapabilities: Array.isArray(v.declared_capabilities) ? v.declared_capabilities : [],
    sha256: v.artifact_sha256,
    sizeBytes: v.artifact_size_bytes != null ? Number(v.artifact_size_bytes) : null,
    signed: Boolean(v.ed25519_sig && v.ed25519_pubkey),
    downloadUrl,
    publishedAt: v.published_at,
  };
}

// --------------------------------------------------------------------------
// Catalog queries
// --------------------------------------------------------------------------

/**
 * List/filter/search published listings. Generalizes local-model-catalog.
 */
export async function queryCatalog(db, { kind, category, trustTier, q, limit = 50, offset = 0 } = {}) {
  const where = ["l.status = 'published'"];
  const params = [];
  let i = 1;

  if (kind) { where.push(`l.kind = $${i++}`); params.push(kind); }
  if (category) { where.push(`l.category = $${i++}`); params.push(category); }
  if (trustTier) { where.push(`l.trust_tier = $${i++}`); params.push(trustTier); }
  if (q) {
    where.push(`(l.title ILIKE $${i} OR l.summary ILIKE $${i} OR l.description ILIKE $${i})`);
    params.push(`%${q}%`);
    i++;
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  params.push(safeLimit, safeOffset);

  const sql = `
    SELECT l.*, d.display_name AS developer_name,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'model', p.model, 'price_credits', p.price_credits, 'price_usd', p.price_usd,
          'period', p.period, 'meter_unit', p.meter_unit))
        FROM marketplace_listing_pricing p
        WHERE p.listing_id = l.id AND p.is_active = true
      ), '[]'::jsonb) AS pricing
    FROM marketplace_listings l
    LEFT JOIN marketplace_developers d ON d.id = l.developer_id
    WHERE ${where.join(' AND ')}
    ORDER BY l.is_first_party DESC, l.install_count DESC, l.created_at DESC
    LIMIT $${i++} OFFSET $${i++}
  `;

  const { rows } = await db.query(sql, params);
  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM marketplace_listings l
    WHERE ${where.join(' AND ')}
  `;
  const { rows: countRows } = await db.query(countSql, params.slice(0, params.length - 2));

  return {
    listings: rows.map((r) => ({ ...serializeListingSummary(r), pricing: (r.pricing || []).map(serializePricing) })),
    total: countRows[0]?.total ?? rows.length,
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function getListingBySlug(db, slug) {
  const { rows } = await db.query(
    `SELECT l.*, d.display_name AS developer_name, d.slug AS developer_slug, d.trust_tier AS developer_trust
     FROM marketplace_listings l
     LEFT JOIN marketplace_developers d ON d.id = l.developer_id
     WHERE l.slug = $1`,
    [slug],
  );
  return rows[0] || null;
}

export async function getListingById(db, id) {
  const { rows } = await db.query(`SELECT * FROM marketplace_listings WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function getPricing(db, listingId, model) {
  if (model) {
    const { rows } = await db.query(
      `SELECT * FROM marketplace_listing_pricing WHERE listing_id = $1 AND model = $2 AND is_active = true`,
      [listingId, model],
    );
    return rows[0] || null;
  }
  const { rows } = await db.query(
    `SELECT * FROM marketplace_listing_pricing WHERE listing_id = $1 AND is_active = true`,
    [listingId],
  );
  return rows;
}

export async function getVersionsForListing(db, listingId) {
  const { rows } = await db.query(
    `SELECT * FROM marketplace_listing_versions WHERE listing_id = $1 ORDER BY published_at DESC NULLS LAST, created_at DESC`,
    [listingId],
  );
  return rows;
}

export async function getVersionById(db, versionId) {
  const { rows } = await db.query(
    `SELECT v.*, l.slug AS listing_slug, l.kind AS listing_kind, l.trust_tier AS listing_trust,
            l.is_first_party AS listing_is_first_party, l.id AS listing_id
     FROM marketplace_listing_versions v
     JOIN marketplace_listings l ON l.id = v.listing_id
     WHERE v.id = $1`,
    [versionId],
  );
  return rows[0] || null;
}

export async function getReviews(db, listingId, limit = 25) {
  const safe = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const { rows } = await db.query(
    `SELECT r.id, r.rating, r.title, r.text, r.created_at, u.display_name AS author
     FROM marketplace_app_reviews r
     JOIN users u ON u.id = r.user_id
     WHERE r.listing_id = $1
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [listingId, safe],
  );
  return rows;
}

// --------------------------------------------------------------------------
// Entitlements
// --------------------------------------------------------------------------

/**
 * Resolve the user's active entitlement for a listing, treating expired
 * subscriptions/rentals as not-entitled. Returns null if none.
 */
export async function getActiveEntitlement(db, userId, listingId) {
  const { rows } = await db.query(
    `SELECT * FROM marketplace_entitlements
     WHERE user_id = $1 AND listing_id = $2 AND status = 'active'
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId, listingId],
  );
  return rows[0] || null;
}

export async function listEntitlements(db, userId) {
  // Alias columns explicitly to avoid the e.kind (entitlement type) /
  // l.kind (listing kind) name collision.
  const { rows } = await db.query(
    `SELECT e.id, e.listing_id, e.kind AS entitlement_kind, e.granted_at, e.expires_at,
            l.slug, l.title, l.kind AS listing_kind, l.icon_url, l.current_version
     FROM marketplace_entitlements e
     JOIN marketplace_listings l ON l.id = e.listing_id
     WHERE e.user_id = $1 AND e.status = 'active'
       AND (e.expires_at IS NULL OR e.expires_at > NOW())
     ORDER BY e.granted_at DESC`,
    [userId],
  );
  return rows.map((e) => ({
    id: e.id,
    listingId: e.listing_id,
    slug: e.slug,
    title: e.title,
    listingKind: e.listing_kind,
    entitlementType: e.entitlement_kind, // owned | subscribed | rental
    iconUrl: e.icon_url,
    currentVersion: e.current_version,
    grantedAt: e.granted_at,
    expiresAt: e.expires_at,
  }));
}

// --------------------------------------------------------------------------
// Purchase / subscribe / rent
// --------------------------------------------------------------------------

const ENTITLEMENT_KIND_BY_PRICING = {
  one_time: 'owned',
  free: 'owned',
  subscription: 'subscribed',
  rental: 'rental',
  pay_per_use: 'owned', // grants access; per-use is metered separately at invoke time
};

function computeExpiry(pricingModel, period) {
  if (pricingModel === 'subscription' || pricingModel === 'rental') {
    const now = Date.now();
    const days = { day: 1, week: 7, month: 30, year: 365 }[period || 'month'] ?? 30;
    return new Date(now + days * 24 * 60 * 60 * 1000);
  }
  return null; // perpetual
}

/**
 * Execute an acquisition (purchase | subscribe | rent). Atomic across:
 *   credits debit (row-locked) → transaction row → ledger log →
 *   entitlement upsert → creator earnings accrual → install_count bump.
 *
 * @returns {Promise<{ ok: true, entitlement, transaction, newBalance } |
 *                    { ok: false, status: number, error: string, currentCredits?: number }>}
 */
export async function acquireListing(db, { user, listing, pricing, txnType }) {
  const entitlementKind = ENTITLEMENT_KIND_BY_PRICING[pricing.model];
  if (!entitlementKind) {
    return { ok: false, status: 400, error: `Unsupported pricing model: ${pricing.model}` };
  }

  const cost = Number(pricing.price_credits) || 0;
  const feePct = platformFeePct(listing);
  const platformFee = Math.round((cost * feePct) / 100);
  const creatorNet = cost - platformFee;
  const expiresAt = computeExpiry(pricing.model, pricing.period);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Atomic credit debit with row lock (only when there is a cost).
    let newBalance = null;
    if (cost > 0) {
      const { rows: lockRows } = await client.query(
        'SELECT credits FROM users WHERE id = $1 FOR UPDATE',
        [user.id],
      );
      if (lockRows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, error: 'User not found' };
      }
      const current = lockRows[0].credits;
      if (current < cost) {
        await client.query('ROLLBACK');
        return { ok: false, status: 402, error: 'Insufficient credits', currentCredits: current };
      }
      const { rows: upd } = await client.query(
        'UPDATE users SET credits = credits - $1 WHERE id = $2 RETURNING credits',
        [cost, user.id],
      );
      newBalance = upd[0].credits;
    }

    // Transaction record.
    const { rows: txnRows } = await client.query(
      `INSERT INTO marketplace_transactions
         (user_id, listing_id, developer_id, type, gross, platform_fee, creator_net, currency, status, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'credits','completed',$8::jsonb)
       RETURNING *`,
      [
        user.id, listing.id, listing.developer_id || null, txnType,
        cost, platformFee, creatorNet,
        JSON.stringify({ pricingModel: pricing.model, period: pricing.period || null, feePct }),
      ],
    );
    const transaction = txnRows[0];

    // Credits ledger entry (reuse existing credit_usage log table).
    await client.query(
      `INSERT INTO credit_usage (user_id, feature, credits_used, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        user.id, `marketplace:${txnType}`, cost,
        JSON.stringify({ listingId: listing.id, listingSlug: listing.slug, transactionId: transaction.id }),
      ],
    );

    // Entitlement upsert (renewals update in place).
    const { rows: entRows } = await client.query(
      `INSERT INTO marketplace_entitlements
         (user_id, listing_id, kind, expires_at, status, source_txn_id, updated_at)
       VALUES ($1,$2,$3,$4,'active',$5, NOW())
       ON CONFLICT (user_id, listing_id) DO UPDATE
         SET kind = EXCLUDED.kind,
             expires_at = EXCLUDED.expires_at,
             status = 'active',
             source_txn_id = EXCLUDED.source_txn_id,
             updated_at = NOW()
       RETURNING *`,
      [user.id, listing.id, entitlementKind, expiresAt, transaction.id],
    );
    const entitlement = entRows[0];

    // Creator earnings accrual (only when there is a developer + net > 0).
    if (listing.developer_id && creatorNet > 0) {
      await client.query(
        `INSERT INTO marketplace_creator_earnings (developer_id, transaction_id, amount_credits, state)
         VALUES ($1, $2, $3, 'available')`,
        [listing.developer_id, transaction.id, creatorNet],
      );
    }

    // Bump install/acquire count.
    await client.query(
      `UPDATE marketplace_listings SET install_count = install_count + 1 WHERE id = $1`,
      [listing.id],
    );

    await client.query('COMMIT');
    return { ok: true, entitlement, transaction, newBalance };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Meter a single hosted-agent invocation (pay_per_use, SPEC §4b). Charges the
 * per-use cost against the buyer's credits, records a `usage` transaction +
 * ledger entry, accrues creator net. Platform-brokered: the actual agent call
 * is performed by the caller; this only does accounting.
 */
export async function meterInvocation(db, { user, listing, pricing, units = 1, meta = {} }) {
  const perUnit = Number(pricing.price_credits) || 0;
  const cost = perUnit * (Number(units) || 1);

  const debit = await deductCredits(db, user.id, cost);
  if (!debit.success) {
    return { ok: false, status: 402, error: 'Insufficient credits', currentCredits: debit.currentCredits };
  }

  const feePct = platformFeePct(listing);
  const platformFee = Math.round((cost * feePct) / 100);
  const creatorNet = cost - platformFee;

  const { rows: txnRows } = await db.query(
    `INSERT INTO marketplace_transactions
       (user_id, listing_id, developer_id, type, gross, platform_fee, creator_net, currency, status, meta)
     VALUES ($1,$2,$3,'usage',$4,$5,$6,'credits','completed',$7::jsonb)
     RETURNING *`,
    [user.id, listing.id, listing.developer_id || null, cost, platformFee, creatorNet,
     JSON.stringify({ units, meterUnit: pricing.meter_unit || 'invocation', ...meta })],
  );

  await logUsage(db, user.id, `marketplace:invoke`, cost, {
    listingId: listing.id, units, transactionId: txnRows[0].id,
  });

  if (listing.developer_id && creatorNet > 0) {
    await db.query(
      `INSERT INTO marketplace_creator_earnings (developer_id, transaction_id, amount_credits, state)
       VALUES ($1, $2, $3, 'available')`,
      [listing.developer_id, txnRows[0].id, creatorNet],
    );
  }

  return { ok: true, transaction: txnRows[0], newBalance: debit.newBalance };
}

// --------------------------------------------------------------------------
// Earnings + payouts (D6)
// --------------------------------------------------------------------------

export async function getEarningsSummary(db, developerId) {
  const { rows } = await db.query(
    `SELECT
       COALESCE(SUM(amount_credits) FILTER (WHERE state = 'available'), 0)::int AS available,
       COALESCE(SUM(amount_credits) FILTER (WHERE state = 'pending'), 0)::int   AS pending,
       COALESCE(SUM(amount_credits) FILTER (WHERE state = 'paid_out'), 0)::int  AS paid_out,
       COALESCE(SUM(amount_credits), 0)::int AS lifetime
     FROM marketplace_creator_earnings
     WHERE developer_id = $1`,
    [developerId],
  );
  return rows[0];
}

/**
 * payoutsProvider seam (D6 / SPEC §5). Real Stripe-Connect transfer requires
 * KYC + live keys we do not have. This records the request and returns a
 * truthful `not_implemented` state — it is NOT a fake success. Everything up to
 * the cash-out call (earnings accrual, balance accounting) is real.
 */
export async function requestPayout(db, { developerId, amountCredits }) {
  const summary = await getEarningsSummary(db, developerId);
  if (amountCredits > summary.available) {
    return { ok: false, status: 400, error: 'Requested amount exceeds available earnings', available: summary.available };
  }

  // USD conversion rate is informational only at v1.
  const usdPerCredit = Number(process.env.MARKETPLACE_USD_PER_CREDIT ?? 0.01);
  const amountUsd = Number((amountCredits * usdPerCredit).toFixed(2));

  const { rows } = await db.query(
    `INSERT INTO marketplace_payouts (developer_id, amount_credits, amount_usd, state, provider, kyc_status, failure_reason)
     VALUES ($1, $2, $3, 'not_implemented', 'stripe_connect', 'unverified',
             'Stripe Connect cash-out not yet wired (no live keys/KYC). Earnings remain available.')
     RETURNING *`,
    [developerId, amountCredits, amountUsd],
  );

  // TODO(payoutsProvider): when Stripe Connect is live —
  //   1. ensure developer.payout_account_id (Connect account) + KYC verified
  //   2. stripe.transfers.create({ amount, currency, destination })
  //   3. on success: mark payout 'paid', insert negative creator_earnings row (state 'paid_out')
  //   4. handle 1099/VAT, holds, velocity checks, chargebacks (SPEC §5/§11)
  return { ok: true, payout: rows[0], note: 'not_implemented' };
}

export { refundCredits, DEFAULT_PLATFORM_FEE_PCT };

export default {
  serializeListingSummary,
  serializePricing,
  serializeVersion,
  queryCatalog,
  getListingBySlug,
  getListingById,
  getPricing,
  getVersionsForListing,
  getVersionById,
  getReviews,
  getActiveEntitlement,
  listEntitlements,
  acquireListing,
  meterInvocation,
  getEarningsSummary,
  requestPayout,
};

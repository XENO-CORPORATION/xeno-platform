/**
 * XENO Marketplace API — /api/marketplace
 *
 * Implements the full SPEC §8 surface: catalog, listing detail, entitlements,
 * purchase/subscribe/rent, metered invoke, entitlement-gated download,
 * developer publishing (register/listings/versions/submit/earnings/payouts),
 * and admin submission review.
 *
 * Patterns reused (verified against the codebase):
 *   - express.Router(), default export (aiRoutes.js)
 *   - req.user from authMiddleware; req.db = pool from databaseMiddleware
 *   - parameterized queries only (never string-interpolated)
 *   - generateSignedUrl for entitlement-gated R2 delivery (cdnOptimization.js)
 *   - credits ledger via marketplaceService (users.credits + credit_usage)
 *
 * Auth model: catalog reads are public (optionalAuthMiddleware so we can flag
 * the caller's entitlements); commerce + developer + admin routes require auth.
 * Note: authMiddleware does NOT select users.role, so admin checks query
 * users.role here (the column exists, default 'user').
 */

import express from 'express';
import crypto from 'crypto';
import authMiddleware, { optionalAuthMiddleware } from '../middleware/auth.js';
import * as svc from '../services/marketplaceService.js';
import {
  VALID_KINDS, VALID_PRICING_MODELS,
  verifyEd25519, runAutomatedChecks, resolvePublishTrustTier,
} from '../services/marketplacePublish.js';

const router = express.Router();

// --------------------------------------------------------------------------
// Small validation helpers
// --------------------------------------------------------------------------
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isString = (v) => typeof v === 'string';

function slugify(value) {
  return String(value).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function badRequest(res, error) {
  return res.status(400).json({ success: false, error });
}

/** Resolve the caller's developer profile, or null. */
async function getDeveloperForUser(db, userId) {
  const { rows } = await db.query(
    `SELECT * FROM marketplace_developers WHERE user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

/** Admin guard — authMiddleware omits role, so query it explicitly. */
async function requireAdmin(req, res, next) {
  try {
    const { rows } = await req.db.query(`SELECT role FROM users WHERE id = $1`, [req.user.id]);
    if (rows[0]?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin privileges required' });
    }
    next();
  } catch (error) {
    console.error('[Marketplace] admin guard error:', error.message);
    res.status(500).json({ success: false, error: 'Authorization check failed' });
  }
}

// A native download is only entitlement-gated when the artifact lives behind an
// R2 key with no public artifact_url. Official native installers are openly
// distributed, so they are never gated.
function isGatedVersion(version) {
  return Boolean(version.artifact_r2_key) && !version.artifact_url;
}

// ==========================================================================
// CATALOG (public, optional auth)
// ==========================================================================

/**
 * GET /catalog — list/filter/search. Generalizes /api/ai/local-model-catalog.
 * Query: kind, category, trust_tier, q, limit, offset
 */
router.get('/catalog', optionalAuthMiddleware, async (req, res) => {
  try {
    const { kind, category, trust_tier: trustTier, q, limit, offset } = req.query;

    if (kind && !VALID_KINDS.has(kind)) return badRequest(res, `Invalid kind: ${kind}`);
    if (trustTier && !['community', 'verified', 'official'].includes(trustTier)) {
      return badRequest(res, `Invalid trust_tier: ${trustTier}`);
    }

    const result = await svc.queryCatalog(req.db, {
      kind: kind || undefined,
      category: category || undefined,
      trustTier: trustTier || undefined,
      q: isNonEmptyString(q) ? q.trim() : undefined,
      limit, offset,
    });

    res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
    res.json({ success: true, source: 'platform', ...result });
  } catch (error) {
    console.error('[Marketplace] catalog error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load catalog' });
  }
});

/**
 * GET /listings/:slug — detail + versions + pricing + reviews.
 * If authenticated, includes the caller's entitlement + gated download URLs.
 */
router.get('/listings/:slug', optionalAuthMiddleware, async (req, res) => {
  try {
    const listing = await svc.getListingBySlug(req.db, req.params.slug);
    if (!listing || listing.status === 'draft') {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    const [versions, pricing, reviews] = await Promise.all([
      svc.getVersionsForListing(req.db, listing.id),
      svc.getPricing(req.db, listing.id),
      svc.getReviews(req.db, listing.id),
    ]);

    let entitlement = null;
    if (req.user) {
      entitlement = await svc.getActiveEntitlement(req.db, req.user.id, listing.id);
    }
    const entitled = Boolean(entitlement);

    res.json({
      success: true,
      listing: svc.serializeListingSummary({ ...listing, pricing }),
      description: listing.description,
      versions: versions.map((v) => svc.serializeVersion(v, { entitled, gated: isGatedVersion(v) })),
      reviews: reviews.map((r) => ({
        id: r.id, rating: r.rating, title: r.title, text: r.text, author: r.author, createdAt: r.created_at,
      })),
      entitlement: entitlement
        ? { type: entitlement.kind, expiresAt: entitlement.expires_at, status: entitlement.status }
        : null,
    });
  } catch (error) {
    console.error('[Marketplace] listing detail error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load listing' });
  }
});

// ==========================================================================
// ENTITLEMENTS (auth)
// ==========================================================================

router.get('/me/entitlements', authMiddleware, async (req, res) => {
  try {
    const entitlements = await svc.listEntitlements(req.db, req.user.id);
    res.json({ success: true, entitlements });
  } catch (error) {
    console.error('[Marketplace] entitlements error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load entitlements' });
  }
});

// ==========================================================================
// COMMERCE: purchase / subscribe / rent (auth)
// ==========================================================================

/**
 * Shared acquisition handler. `expectedModel` constrains which pricing model
 * the endpoint accepts so /purchase can't be used to start a subscription, etc.
 */
function makeAcquireHandler(expectedModels, txnType) {
  return async (req, res) => {
    try {
      const listing = await svc.getListingById(req.db, req.params.id);
      if (!listing || listing.status !== 'published') {
        return res.status(404).json({ success: false, error: 'Listing not found or not published' });
      }

      // Choose pricing: client may specify model; else pick the single matching one.
      const requestedModel = isNonEmptyString(req.body?.model) ? req.body.model : null;
      if (requestedModel && !expectedModels.includes(requestedModel)) {
        return badRequest(res, `This endpoint does not support pricing model "${requestedModel}"`);
      }

      const allPricing = await svc.getPricing(req.db, listing.id);
      const candidates = allPricing.filter((p) => expectedModels.includes(p.model));
      if (candidates.length === 0) {
        return badRequest(res, `Listing has no ${expectedModels.join('/')} pricing`);
      }
      const pricing = requestedModel
        ? candidates.find((p) => p.model === requestedModel)
        : candidates[0];
      if (!pricing) return badRequest(res, 'Requested pricing option not available');

      // Idempotency for perpetual ownership: already owned → return existing.
      if (pricing.model === 'one_time' || pricing.model === 'free') {
        const existing = await svc.getActiveEntitlement(req.db, req.user.id, listing.id);
        if (existing && existing.kind === 'owned') {
          return res.json({
            success: true, alreadyOwned: true,
            entitlement: { type: existing.kind, expiresAt: existing.expires_at, status: existing.status },
          });
        }
      }

      const result = await svc.acquireListing(req.db, {
        user: req.user, listing, pricing, txnType,
      });
      if (!result.ok) {
        return res.status(result.status).json({
          success: false, error: result.error,
          ...(result.currentCredits != null ? { currentCredits: result.currentCredits } : {}),
        });
      }

      res.json({
        success: true,
        entitlement: {
          type: result.entitlement.kind,
          expiresAt: result.entitlement.expires_at,
          status: result.entitlement.status,
        },
        transaction: {
          id: result.transaction.id, type: result.transaction.type,
          gross: result.transaction.gross, platformFee: result.transaction.platform_fee,
          creatorNet: result.transaction.creator_net,
        },
        newBalance: result.newBalance,
      });
    } catch (error) {
      console.error(`[Marketplace] ${txnType} error:`, error.message);
      res.status(500).json({ success: false, error: `Failed to ${txnType}` });
    }
  };
}

router.post('/listings/:id/purchase', authMiddleware, makeAcquireHandler(['one_time', 'free'], 'purchase'));
router.post('/listings/:id/subscribe', authMiddleware, makeAcquireHandler(['subscription'], 'subscribe'));
router.post('/listings/:id/rent', authMiddleware, makeAcquireHandler(['rental'], 'rent'));

/**
 * POST /invoke/:listingId — platform-brokered metered hosted-agent call (§4b).
 * Charges per-use credits and records usage. The actual brokered agent call to
 * xeno-rt / the creator's hosted agent is a separate integration; this endpoint
 * owns the metering + access check. Requires an active entitlement OR pay_per_use
 * pricing the buyer pays into per call.
 */
router.post('/invoke/:listingId', authMiddleware, async (req, res) => {
  try {
    const listing = await svc.getListingById(req.db, req.params.listingId);
    if (!listing || listing.status !== 'published') {
      return res.status(404).json({ success: false, error: 'Listing not found or not published' });
    }
    if (!['mind', 'swarm'].includes(listing.kind)) {
      return badRequest(res, 'Only mind/swarm listings are invocable');
    }

    const units = Number.isFinite(Number(req.body?.units)) && Number(req.body.units) > 0
      ? Math.floor(Number(req.body.units)) : 1;

    // Rental/subscription entitlement → unmetered (or capped) within window.
    const entitlement = await svc.getActiveEntitlement(req.db, req.user.id, listing.id);
    if (entitlement && (entitlement.kind === 'rental' || entitlement.kind === 'subscribed')) {
      return res.json({
        success: true, metered: false, brokered: true,
        message: 'Invocation authorized under active rental/subscription window',
        // NOTE: the brokered call to the creator's hosted agent / xeno-rt is
        // performed by the agent gateway; this endpoint authorizes + accounts.
      });
    }

    // Otherwise require pay_per_use pricing and meter the call.
    const pricing = await svc.getPricing(req.db, listing.id, 'pay_per_use');
    if (!pricing) {
      return res.status(402).json({ success: false, error: 'No active entitlement and no pay-per-use pricing' });
    }

    const result = await svc.meterInvocation(req.db, {
      user: req.user, listing, pricing, units,
      meta: { ref: isString(req.body?.ref) ? req.body.ref.slice(0, 200) : null },
    });
    if (!result.ok) {
      return res.status(result.status).json({
        success: false, error: result.error,
        ...(result.currentCredits != null ? { currentCredits: result.currentCredits } : {}),
      });
    }

    res.json({
      success: true, metered: true, brokered: true, units,
      charged: result.transaction.gross,
      newBalance: result.newBalance,
      transactionId: result.transaction.id,
    });
  } catch (error) {
    console.error('[Marketplace] invoke error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to invoke' });
  }
});

// ==========================================================================
// DOWNLOAD (auth, entitlement-gated)
// ==========================================================================

/**
 * GET /download/:listingVersionId — returns a (signed) download URL.
 * Free/official-open versions are downloadable by anyone authenticated;
 * paid/gated versions require an active entitlement.
 */
router.get('/download/:listingVersionId', authMiddleware, async (req, res) => {
  try {
    const version = await svc.getVersionById(req.db, req.params.listingVersionId);
    if (!version) return res.status(404).json({ success: false, error: 'Version not found' });

    const gated = isGatedVersion(version);
    if (gated) {
      const entitlement = await svc.getActiveEntitlement(req.db, req.user.id, version.listing_id);
      if (!entitlement) {
        return res.status(403).json({ success: false, error: 'You do not have access to this download' });
      }
    }

    const serialized = svc.serializeVersion(version, { entitled: true, gated });
    if (!serialized.downloadUrl) {
      return res.status(404).json({ success: false, error: 'No downloadable artifact for this version' });
    }

    res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
    res.json({
      success: true,
      version: serialized.version,
      sha256: serialized.sha256,
      sizeBytes: serialized.sizeBytes,
      signed: serialized.signed,
      downloadUrl: serialized.downloadUrl,
    });
  } catch (error) {
    console.error('[Marketplace] download error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to resolve download' });
  }
});

// ==========================================================================
// REVIEWS (auth) — only entitled users may review
// ==========================================================================

router.post('/listings/:id/reviews', authMiddleware, async (req, res) => {
  try {
    const listing = await svc.getListingById(req.db, req.params.id);
    if (!listing || listing.status !== 'published') {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return badRequest(res, 'rating must be an integer 1–5');
    }
    const title = isString(req.body?.title) ? req.body.title.slice(0, 200) : null;
    const text = isString(req.body?.text) ? req.body.text.slice(0, 5000) : null;

    const entitlement = await svc.getActiveEntitlement(req.db, req.user.id, listing.id);
    if (!entitlement) {
      return res.status(403).json({ success: false, error: 'Only users who own this listing can review it' });
    }

    await req.db.query(
      `INSERT INTO marketplace_app_reviews (listing_id, user_id, rating, title, text)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (listing_id, user_id) DO UPDATE
         SET rating = EXCLUDED.rating, title = EXCLUDED.title, text = EXCLUDED.text, updated_at = NOW()`,
      [listing.id, req.user.id, rating, title, text],
    );

    // Recompute aggregate rating.
    await req.db.query(
      `UPDATE marketplace_listings l SET
         rating_count = sub.cnt, rating_avg = sub.avg
       FROM (SELECT COUNT(*)::int AS cnt, COALESCE(AVG(rating),0)::numeric(3,2) AS avg
             FROM marketplace_app_reviews WHERE listing_id = $1) sub
       WHERE l.id = $1`,
      [listing.id],
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[Marketplace] review error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to submit review' });
  }
});

// ==========================================================================
// DEVELOPER (auth)
// ==========================================================================

/** POST /developer/register — create a community developer profile. */
router.post('/developer/register', authMiddleware, async (req, res) => {
  try {
    const displayName = req.body?.displayName ?? req.body?.display_name;
    if (!isNonEmptyString(displayName) || displayName.length > 120) {
      return badRequest(res, 'displayName is required (1–120 chars)');
    }
    const existing = await getDeveloperForUser(req.db, req.user.id);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Developer profile already exists', developerId: existing.id });
    }

    let slug = isNonEmptyString(req.body?.slug) ? slugify(req.body.slug) : slugify(displayName);
    if (!slug) slug = `dev-${req.user.id.slice(0, 8)}`;
    // Ensure slug uniqueness.
    const { rows: clash } = await req.db.query(`SELECT 1 FROM marketplace_developers WHERE slug = $1`, [slug]);
    if (clash.length) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;

    const bio = isString(req.body?.bio) ? req.body.bio.slice(0, 2000) : null;
    const website = isString(req.body?.website) ? req.body.website.slice(0, 500) : null;

    const { rows } = await req.db.query(
      `INSERT INTO marketplace_developers (user_id, display_name, slug, bio, website, trust_tier, status)
       VALUES ($1,$2,$3,$4,$5,'community','active')
       RETURNING id, display_name, slug, trust_tier, status, created_at`,
      [req.user.id, displayName, slug, bio, website],
    );
    res.status(201).json({ success: true, developer: rows[0] });
  } catch (error) {
    console.error('[Marketplace] developer register error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to register developer' });
  }
});

router.get('/developer/me', authMiddleware, async (req, res) => {
  try {
    const dev = await getDeveloperForUser(req.db, req.user.id);
    if (!dev) return res.status(404).json({ success: false, error: 'No developer profile' });
    res.json({
      success: true,
      developer: {
        id: dev.id, displayName: dev.display_name, slug: dev.slug,
        trustTier: dev.trust_tier, status: dev.status, verifiedAt: dev.verified_at,
      },
    });
  } catch (error) {
    console.error('[Marketplace] developer me error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load developer profile' });
  }
});

/** POST /listings — create a draft listing owned by the caller's developer. */
router.post('/listings', authMiddleware, async (req, res) => {
  try {
    const dev = await getDeveloperForUser(req.db, req.user.id);
    if (!dev) return res.status(403).json({ success: false, error: 'Register a developer profile first' });
    if (dev.status !== 'active') return res.status(403).json({ success: false, error: 'Developer account is not active' });

    const { kind, title } = req.body || {};
    if (!isNonEmptyString(title) || title.length > 200) return badRequest(res, 'title is required (1–200 chars)');
    if (!VALID_KINDS.has(kind)) return badRequest(res, `Invalid kind. One of: ${[...VALID_KINDS].join(', ')}`);

    // D1 enforced up front: community devs cannot create app-native listings.
    const trustTier = resolvePublishTrustTier(dev.trust_tier);
    if (trustTier === 'community' && kind === 'app-native') {
      return res.status(403).json({
        success: false,
        error: 'Native app listings are restricted to verified/official publishers (D1)',
      });
    }

    const summary = isString(req.body?.summary) ? req.body.summary.slice(0, 500) : null;
    const description = isString(req.body?.description) ? req.body.description.slice(0, 20000) : null;
    const category = isString(req.body?.category) ? req.body.category.slice(0, 80) : null;
    const license = isString(req.body?.license) ? req.body.license.slice(0, 120) : null;
    const iconUrl = isString(req.body?.iconUrl) ? req.body.iconUrl.slice(0, 500) : null;
    const screenshots = Array.isArray(req.body?.screenshots)
      ? req.body.screenshots.filter(isString).slice(0, 12) : [];

    let slug = isNonEmptyString(req.body?.slug) ? slugify(req.body.slug) : slugify(`${dev.slug}-${title}`);
    const { rows: clash } = await req.db.query(`SELECT 1 FROM marketplace_listings WHERE slug = $1`, [slug]);
    if (clash.length) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;

    // Validate pricing payload if provided.
    const pricing = Array.isArray(req.body?.pricing) ? req.body.pricing : [];
    for (const p of pricing) {
      if (!VALID_PRICING_MODELS.has(p?.model)) return badRequest(res, `Invalid pricing model: ${p?.model}`);
      if (p.priceCredits != null && (!Number.isInteger(p.priceCredits) || p.priceCredits < 0)) {
        return badRequest(res, 'priceCredits must be a non-negative integer');
      }
    }

    const { rows } = await req.db.query(
      `INSERT INTO marketplace_listings
         (slug, kind, developer_id, title, summary, description, category, trust_tier,
          icon_url, screenshots, license, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,'draft')
       RETURNING *`,
      [slug, kind, dev.id, title, summary, description, category, trustTier,
       iconUrl, JSON.stringify(screenshots), license],
    );
    const listing = rows[0];

    for (const p of pricing) {
      await req.db.query(
        `INSERT INTO marketplace_listing_pricing (listing_id, model, price_credits, price_usd, period, meter_unit)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (listing_id, model) DO UPDATE
           SET price_credits = EXCLUDED.price_credits, price_usd = EXCLUDED.price_usd,
               period = EXCLUDED.period, meter_unit = EXCLUDED.meter_unit, is_active = true`,
        [listing.id, p.model, Number(p.priceCredits) || 0, p.priceUsd ?? null, p.period ?? null, p.meterUnit ?? null],
      );
    }

    res.status(201).json({ success: true, listing: svc.serializeListingSummary(listing) });
  } catch (error) {
    console.error('[Marketplace] create listing error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create listing' });
  }
});

/** POST /listings/:id/versions — add a signed artifact version to a listing. */
router.post('/listings/:id/versions', authMiddleware, async (req, res) => {
  try {
    const dev = await getDeveloperForUser(req.db, req.user.id);
    if (!dev) return res.status(403).json({ success: false, error: 'Register a developer profile first' });

    const listing = await svc.getListingById(req.db, req.params.id);
    if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });
    if (listing.developer_id !== dev.id) {
      return res.status(403).json({ success: false, error: 'You do not own this listing' });
    }

    const { version } = req.body || {};
    if (!isNonEmptyString(version) || version.length > 40) return badRequest(res, 'version is required (e.g. 1.0.0)');

    const artifactR2Key = isString(req.body?.artifactR2Key) ? req.body.artifactR2Key.slice(0, 1000) : null;
    const artifactUrl = isString(req.body?.artifactUrl) ? req.body.artifactUrl.slice(0, 1000) : null;
    const sha256 = isString(req.body?.sha256) ? req.body.sha256.trim() : null;
    const sigB64 = isString(req.body?.ed25519Sig) ? req.body.ed25519Sig : null;
    const pubKeyB64 = isString(req.body?.ed25519PubKey) ? req.body.ed25519PubKey : null;
    const releaseNotes = isString(req.body?.releaseNotes) ? req.body.releaseNotes.slice(0, 10000) : null;
    const declaredCaps = Array.isArray(req.body?.declaredCapabilities) ? req.body.declaredCapabilities : [];
    const manifest = (req.body?.manifest && typeof req.body.manifest === 'object') ? req.body.manifest : {};
    const sizeBytes = Number.isFinite(Number(req.body?.sizeBytes)) ? Math.floor(Number(req.body.sizeBytes)) : null;
    const hasNativeBinary = Boolean(req.body?.hasNativeBinary);

    // If a signature is supplied, verify it cryptographically against the sha256.
    if (sigB64 && pubKeyB64 && sha256) {
      if (!/^[0-9a-f]{64}$/i.test(sha256)) return badRequest(res, 'sha256 must be a 64-char hex digest');
      const ver = verifyEd25519(sha256, sigB64, pubKeyB64);
      if (!ver.valid) return badRequest(res, `Ed25519 signature verification failed: ${ver.error || 'invalid'}`);
    }

    const { rows: clash } = await req.db.query(
      `SELECT 1 FROM marketplace_listing_versions WHERE listing_id = $1 AND version = $2`,
      [listing.id, version],
    );
    if (clash.length) return res.status(409).json({ success: false, error: 'Version already exists' });

    const { rows } = await req.db.query(
      `INSERT INTO marketplace_listing_versions
         (listing_id, version, artifact_r2_key, artifact_url, artifact_sha256, artifact_size_bytes,
          ed25519_sig, ed25519_pubkey, release_notes, declared_capabilities, manifest, has_native_binary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
       RETURNING *`,
      [listing.id, version, artifactR2Key, artifactUrl, sha256, sizeBytes,
       sigB64, pubKeyB64, releaseNotes, JSON.stringify(declaredCaps), JSON.stringify(manifest), hasNativeBinary],
    );

    res.status(201).json({ success: true, version: svc.serializeVersion(rows[0], { entitled: true, gated: false }) });
  } catch (error) {
    console.error('[Marketplace] create version error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create version' });
  }
});

/** POST /listings/:id/submit — run automated checks, enqueue for review (or auto-reject on D1). */
router.post('/listings/:id/submit', authMiddleware, async (req, res) => {
  try {
    const dev = await getDeveloperForUser(req.db, req.user.id);
    if (!dev) return res.status(403).json({ success: false, error: 'Register a developer profile first' });

    const listing = await svc.getListingById(req.db, req.params.id);
    if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });
    if (listing.developer_id !== dev.id) {
      return res.status(403).json({ success: false, error: 'You do not own this listing' });
    }

    // Submit the latest version unless a specific one is named.
    const versions = await svc.getVersionsForListing(req.db, listing.id);
    if (versions.length === 0) return badRequest(res, 'Listing has no versions to submit');
    const versionId = isNonEmptyString(req.body?.versionId) ? req.body.versionId : versions[0].id;
    const versionRow = versions.find((v) => v.id === versionId);
    if (!versionRow) return res.status(404).json({ success: false, error: 'Version not found on this listing' });

    // Automated checks (SPEC §6) — D1 enforced server-side inside runAutomatedChecks.
    const { passed, checks } = runAutomatedChecks(
      { kind: listing.kind, trustTier: listing.trust_tier, license: listing.license },
      versionRow,
    );

    const state = passed ? 'in_review' : 'checks_failed';
    const { rows } = await req.db.query(
      `INSERT INTO marketplace_submissions (listing_id, listing_version_id, developer_id, state, checks)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       RETURNING *`,
      [listing.id, versionRow.id, dev.id, state, JSON.stringify(checks)],
    );

    if (passed) {
      await req.db.query(`UPDATE marketplace_listings SET status = 'in_review', updated_at = NOW() WHERE id = $1`, [listing.id]);
    }

    res.status(passed ? 202 : 422).json({
      success: passed,
      submission: { id: rows[0].id, state, checks },
      ...(passed ? {} : { error: 'Automated checks failed — see checks for details' }),
    });
  } catch (error) {
    console.error('[Marketplace] submit error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to submit listing' });
  }
});

/** GET /developer/earnings — accrual summary + recent transactions. */
router.get('/developer/earnings', authMiddleware, async (req, res) => {
  try {
    const dev = await getDeveloperForUser(req.db, req.user.id);
    if (!dev) return res.status(403).json({ success: false, error: 'Register a developer profile first' });

    const summary = await svc.getEarningsSummary(req.db, dev.id);
    const { rows: recent } = await req.db.query(
      `SELECT id, type, gross, platform_fee, creator_net, created_at
       FROM marketplace_transactions
       WHERE developer_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [dev.id],
    );
    res.json({
      success: true,
      earnings: { availableCredits: summary.available, pendingCredits: summary.pending,
                  paidOutCredits: summary.paid_out, lifetimeCredits: summary.lifetime },
      recentTransactions: recent.map((t) => ({
        id: t.id, type: t.type, gross: t.gross, platformFee: t.platform_fee,
        creatorNet: t.creator_net, createdAt: t.created_at,
      })),
    });
  } catch (error) {
    console.error('[Marketplace] earnings error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load earnings' });
  }
});

/** POST /developer/payouts — request a cash-out (payoutsProvider seam → not_implemented). */
router.post('/developer/payouts', authMiddleware, async (req, res) => {
  try {
    const dev = await getDeveloperForUser(req.db, req.user.id);
    if (!dev) return res.status(403).json({ success: false, error: 'Register a developer profile first' });

    const amount = Number(req.body?.amountCredits);
    if (!Number.isInteger(amount) || amount <= 0) return badRequest(res, 'amountCredits must be a positive integer');

    const result = await svc.requestPayout(req.db, { developerId: dev.id, amountCredits: amount });
    if (!result.ok) {
      return res.status(result.status).json({ success: false, error: result.error, available: result.available });
    }

    // Truthful: the request is recorded, but cash-out is not yet wired.
    res.status(501).json({
      success: false,
      status: 'not_implemented',
      message: 'Payout recorded but Stripe Connect cash-out is not yet enabled. Earnings remain available.',
      payout: {
        id: result.payout.id, amountCredits: result.payout.amount_credits,
        amountUsd: result.payout.amount_usd, state: result.payout.state,
      },
    });
  } catch (error) {
    console.error('[Marketplace] payout error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to request payout' });
  }
});

// ==========================================================================
// ADMIN REVIEW (auth + admin)
// ==========================================================================

router.get('/submissions', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const state = isNonEmptyString(req.query?.state) ? req.query.state : null;
    const params = [];
    let where = '';
    if (state) { params.push(state); where = `WHERE s.state = $1`; }
    const { rows } = await req.db.query(
      `SELECT s.id, s.state, s.checks, s.notes, s.submitted_at, s.decided_at,
              l.slug, l.title, l.kind, l.trust_tier, v.version, d.display_name AS developer
       FROM marketplace_submissions s
       JOIN marketplace_listings l ON l.id = s.listing_id
       JOIN marketplace_listing_versions v ON v.id = s.listing_version_id
       LEFT JOIN marketplace_developers d ON d.id = s.developer_id
       ${where}
       ORDER BY s.submitted_at DESC
       LIMIT 100`,
      params,
    );
    res.json({ success: true, submissions: rows });
  } catch (error) {
    console.error('[Marketplace] submissions list error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load submissions' });
  }
});

router.post('/submissions/:id/approve', authMiddleware, requireAdmin, async (req, res) => {
  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const { rows: subRows } = await client.query(
      `SELECT * FROM marketplace_submissions WHERE id = $1 FOR UPDATE`, [req.params.id],
    );
    const submission = subRows[0];
    if (!submission) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Submission not found' }); }
    if (submission.state === 'approved') { await client.query('ROLLBACK'); return res.status(409).json({ success: false, error: 'Already approved' }); }

    const notes = isString(req.body?.notes) ? req.body.notes.slice(0, 5000) : null;

    await client.query(
      `UPDATE marketplace_submissions SET state = 'approved', reviewer = $1, notes = $2, decided_at = NOW() WHERE id = $3`,
      [req.user.id, notes, submission.id],
    );
    // Publish the listing + mark the version published + set current_version.
    const { rows: verRows } = await client.query(
      `UPDATE marketplace_listing_versions SET published_at = NOW() WHERE id = $1 RETURNING version`,
      [submission.listing_version_id],
    );
    await client.query(
      `UPDATE marketplace_listings
       SET status = 'published', current_version = $1, published_at = COALESCE(published_at, NOW()), updated_at = NOW()
       WHERE id = $2`,
      [verRows[0]?.version || null, submission.listing_id],
    );

    await client.query('COMMIT');
    res.json({ success: true, listingId: submission.listing_id, publishedVersion: verRows[0]?.version });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Marketplace] approve error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to approve submission' });
  } finally {
    client.release();
  }
});

router.post('/submissions/:id/reject', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const notes = isString(req.body?.notes) ? req.body.notes.slice(0, 5000) : null;
    const { rows } = await req.db.query(
      `UPDATE marketplace_submissions SET state = 'rejected', reviewer = $1, notes = $2, decided_at = NOW()
       WHERE id = $3 AND state <> 'approved' RETURNING listing_id`,
      [req.user.id, notes, req.params.id],
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Submission not found or already approved' });

    // Return the listing to draft so the developer can revise + resubmit.
    await req.db.query(
      `UPDATE marketplace_listings SET status = 'draft', updated_at = NOW() WHERE id = $1 AND status = 'in_review'`,
      [rows[0].listing_id],
    );
    res.json({ success: true });
  } catch (error) {
    console.error('[Marketplace] reject error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to reject submission' });
  }
});

export default router;

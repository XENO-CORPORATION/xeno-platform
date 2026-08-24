/*
 * productDownloadRoutes — PRODUCT-PAGES-SPEC.md §4, as amended by the
 * 2026-08-24 owner override: an installer now requires an active paid plan.
 *
 *   GET  /product/:slug/download/:os[/:version]?grant=…   → 302 to the asset
 *   POST /api/downloads/grant                             → mint that grant
 *
 * ── THE DEEP LINK IS STILL PUBLIC, AND STILL SERVES NOTHING ────────────────
 *
 * The URL shape is unchanged, because it is printed in release notes and
 * emails. What changed is that it no longer hands over bytes on its own.
 *
 * It cannot simply be mounted behind authMiddleware, and the reason is
 * structural rather than a preference:
 *
 *   "the app authenticates via `Authorization: Bearer` and sets NO auth cookie"
 *                                              — src/server/middleware/auth.js
 *
 * A download is a plain <a href> navigation, and a browser sends cookies on
 * those, never an Authorization header. Auth middleware here would refuse
 * every real customer — a gate that looks like it works because it refuses
 * everyone. So the SPA, which does hold the token, mints a short-lived signed
 * grant and navigates to the link with it.
 *
 * Without a valid grant:
 *   - a browser navigation is redirected to sign in / to pricing
 *   - anything else gets 401/403 JSON
 *   - and in NO case does this route 302 to an installer
 *
 * ⚠️ The bytes themselves are still on a public CDN, so this closes OUR door
 * and not every door. See docs/DOWNLOAD-GATE.md before claiming otherwise.
 */
import express from 'express';
import { updatesOrigin } from '../config/hosts.js';
import { assertEntitlement } from '../middleware/requireEntitlement.js';
import { mintDownloadGrant, verifyDownloadGrant, GRANT_TTL_SECONDS } from '../utils/downloadGrant.js';
import { rateLimitKey } from '../utils/clientIp.js';
import { subjectHashForUser } from '../services/subjectHash.js';
import {
  findIntent, claimIntent, record, flag, STEPS, funnelReady,
} from '../services/downloadFunnel.js';

const router = express.Router();

/** A browser NAVIGATION wants a page; an API client wants JSON. */
function wantsHtml(req) {
  return String(req.headers.accept || '').includes('text/html');
}

const R2_PUBLIC = process.env.XENO_UPDATES_BASE || updatesOrigin();
const OS_ALIASES = {
  win: 'windows', windows: 'windows',
  mac: 'mac', macos: 'mac', osx: 'mac',
  linux: 'linux', appimage: 'linux',
};

// 30s in-process cache of releases.json per slug (SPEC §9).
const TTL_MS = 30_000;
const cache = new Map(); // slug -> { at, releases }

async function loadReleases(slug) {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.releases;

  let releases = [];
  try {
    const res = await fetch(`${R2_PUBLIC}/apps/${slug}/releases.json`, { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      releases = Array.isArray(data) ? data : Array.isArray(data?.releases) ? data.releases : [];
    }
  } catch { /* no releases.json -> no download; see below */ }

  // ─────────────────────────────────────────────────────────────────────────
  // There is deliberately NO fallback to version.json here.
  //
  // A `version.json` with no `releases.json` used to synthesize a one-entry
  // release, which made this route 302 to a real installer for ANY app that had
  // ever pushed a latest-pointer — regardless of whether the product was ready.
  // On 2026-07-27 that was serving 85 MB scaffold builds of XENO Sheets, Slides
  // and Notes to visitors, while the site marketed all three as "coming soon".
  // Those artifacts predated their own engine commits: at that build, Sheets had
  // no formula evaluator, Slides no persistence or export, Notes no links.
  //
  // The two files mean different things and the fallback conflated them:
  //   version.json  = the moving latest pointer the in-app updater polls. An app
  //                   writes it as soon as it builds ANYTHING.
  //   releases.json = the curated, prepend-only release HISTORY. Publishing it is
  //                   the deliberate act of saying "this is downloadable."
  //
  // So releases.json is the gate, and its ABSENCE is a decision, not a gap to be
  // papered over. Verified before removing: every shipping product (hub, pixel,
  // motion, sound, canvas, docs, browser, shell, comms, workflow, agent-cli) has
  // both files. The only slugs that relied on this fallback were exactly the
  // three that must not be downloadable. Blast radius of removal: zero.
  //
  // If a product SHOULD be downloadable, publish its releases.json with
  // scripts/xeno-release.mjs. Do not re-add a fallback here.
  // ─────────────────────────────────────────────────────────────────────────

  cache.set(slug, { at: Date.now(), releases });
  return releases;
}

function pickRelease(releases, { version, channel }) {
  if (version) {
    const want = String(version).replace(/^v/i, '');
    return releases.find((r) => r.version === want) || null;
  }
  const ch = channel || 'stable';
  return (
    releases.find((r) => (r.channel || 'stable') === ch) ||
    releases.find((r) => r.latest) ||
    releases[0] ||
    null
  );
}

router.get('/:slug/download/:os/:version?', async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const osParam = String(req.params.os || '').toLowerCase();
  const os = OS_ALIASES[osParam];
  res.set('Cache-Control', 'no-store');

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(404).json({ error: { code: 'BAD_SLUG', message: 'Unknown product' } });
  }
  if (!os) {
    return res.status(404).json({ error: { code: 'BAD_OS', message: `Unknown OS "${osParam}" (use win|mac|linux)` } });
  }
  const channel = req.query.channel === 'beta' ? 'beta' : 'stable';

  /* ── The paywall. Before any asset lookup, so an unentitled request cannot
   * learn a filename or a version from the shape of the error. */
  const wanted = { slug, os, version: req.params.version || '' };
  const verdict = verifyDownloadGrant(req.query.grant, wanted);
  if (!verdict.ok) {
    if (wantsHtml(req)) {
      // Send the browser somewhere it can act. The SPA reads returnUrl and
      // comes back here with a grant once the account can actually download.
      const back = encodeURIComponent(req.originalUrl.split('?')[0]);
      return res.redirect(302, `/auth?returnUrl=${back}`);
    }
    return res.status(401).json({
      error: {
        code: 'download_grant_required',
        message: 'Downloading requires a signed-in account with an active plan.',
        reason: verdict.reason,
        mint: '/api/downloads/grant',
      },
    });
  }

  const releases = await loadReleases(slug);
  if (!releases.length) {
    return res.status(404).json({ error: { code: 'NO_RELEASES', message: `No releases published for "${slug}"` } });
  }

  const release = pickRelease(releases, { version: req.params.version, channel });
  if (!release) {
    return res.status(404).json({ error: { code: 'NO_RELEASE', message: `Release ${req.params.version || `(${channel})`} not found for "${slug}"` } });
  }

  const asset = release.assets?.[os]?.[0];
  if (!asset?.file) {
    return res.status(404).json({ error: { code: 'NO_ASSET', message: `No ${os} build for ${slug} ${release.version}` } });
  }

  // Build the absolute R2 URL (file is relative to apps/:slug/). Encode spaces
  // etc. but keep path separators.
  const url = `${R2_PUBLIC}/apps/${slug}/${encodeURI(asset.file)}`;
  return res.redirect(302, url);
});

/**
 * The authenticated half. Mount at /api/downloads behind databaseMiddleware +
 * authMiddleware, so 401 is owned by auth and 403 by the entitlement.
 *
 * Returns a URL rather than the bytes: the browser then navigates to it, which
 * keeps the large transfer on the CDN instead of through Node.
 */
/**
 * The per-account bound and the audit row, shared by BOTH minting paths.
 *
 * 🔴 Extracted rather than copied. The download route had a cap and an audit; the
 * updater route minted the SAME authority — a grant that opens an installer —
 * with neither. Two paths to one permission where only one is instrumented is
 * not a weaker control, it is an unmonitored door next to a monitored one, and
 * the attacker picks the door.
 *
 * Copying the block would have fixed today and drifted tomorrow: the next change
 * to the cap would land on whichever path its author was looking at.
 */
async function enforceGrantCap(req, userId) {
  const CAP = Number(process.env.GRANT_HOURLY_CAP || 60);
  try {
    const recent = await req.db.query(
      "SELECT count(*)::int AS n FROM download_grants WHERE user_id = $1 AND at > NOW() - INTERVAL '1 hour'",
      [userId],
    );
    if ((recent.rows[0]?.n || 0) >= CAP) {
      console.warn(`[Downloads] grant cap reached for user ${userId} (${CAP}/hour)`);
      return {
        error: {
          code: 'grant_rate_limited',
          message: 'Too many downloads started recently. Try again in a little while.',
          retryAfterSeconds: 900,
        },
      };
    }
  } catch (e) {
    /* Fails OPEN: the entitlement has already passed, so the caller has PAID.
     * Refusing them because we could not read a count would punish a customer
     * for our database. */
    console.error('[Downloads] grant cap check failed, allowing:', e.message);
  }
  return null;
}

/**
 * Record that a grant was issued. Never throws — this is a log, not a gate, and
 * a failed write must not refuse a download that was legitimately authorised.
 */
async function auditGrant(req, { userId, intentId, slug, os, version, plan }) {
  try {
    /* Survives the account. `user_id` is SET NULL on deletion, so without a
     * handle an erased customer's download history becomes unattributable —
     * and a chargeback or a leaked-build investigation arrives after the fact,
     * often after the account is gone. */
    const subject = await subjectHashForUser(req.db, userId);
    await req.db.query(
      `INSERT INTO download_grants (user_id, intent_id, slug, os, version, plan, client_ip, user_agent, subject_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, intentId || null, slug, os, version || '', plan || null,
        ipOfReq(req), String(req.headers['user-agent'] || '').slice(0, 512), subject],
    );
  } catch (e) {
    console.error('[Downloads] failed to audit grant', e.message);
  }
}

const ipOfReq = (req) => { try { return rateLimitKey(req); } catch { return null; } };

export const grantRouter = express.Router();

grantRouter.post('/grant', async (req, res) => {
  const slug = String(req.body?.slug || '').toLowerCase();
  const osParam = String(req.body?.os || '').toLowerCase();
  const os = OS_ALIASES[osParam];
  const version = req.body?.version ? String(req.body.version).replace(/^v/i, '') : '';
  res.set('Cache-Control', 'no-store');

  if (!/^[a-z0-9-]+$/.test(slug) || !os) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'slug and os are required' } });
  }
  // authMiddleware owns 401; reaching here without a user is a wiring bug.
  const userId = req.user?.id;
  if (!userId || !req.db) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to download.' } });
  }

  // Fails CLOSED to free, so a database fault refuses rather than hands over.
  const check = await assertEntitlement(req.db, userId, 'canDownload');
  if (!check.allowed) return res.status(403).json(check.body);

  /* ── Per-ACCOUNT bound ──────────────────────────────────────────────────
   *
   * 🔴 The global limiter is per-IP, and this endpoint is the authority path:
   * one call produces the permission to take a 140 MB binary. Per-IP alone means
   * a single compromised paid account can mint grants from anywhere, and the
   * account is the thing being abused, not the address.
   *
   * The cap is deliberately generous — a person on three machines re-downloading
   * a suite after a reinstall is NORMAL, and a limit that catches them is a
   * support ticket wearing a security costume. It exists to stop a script, and
   * it is measured against the audit table we already write, so it needs no new
   * state and cannot drift from what actually happened.
   *
   * Fails OPEN: if the audit table cannot be read we allow the download. The
   * entitlement has already passed, so the caller has PAID — refusing them over
   * a failed count would punish a customer for our database. */
  const capped = await enforceGrantCap(req, userId);
  if (capped) return res.status(429).json(capped);

  const grant = mintDownloadGrant({ userId, slug, os, version });
  const path = version
    ? `/product/${slug}/download/${osParam}/${version}`
    : `/product/${slug}/download/${osParam}`;

  /* ── The audit, and it is not optional ──────────────────────────────────
   * A grant is an exercise of authority. Minting one without a record means
   * the only question that matters after an incident — "what did this account
   * actually take, and when?" — has no answer at all. Recorded AFTER the
   * entitlement passed, so the table holds grants, not attempts.
   *
   * Wrapped, because the audit must not be able to refuse a download that was
   * legitimately authorised: this is a log, not a second gate. A write failure
   * is loud in the server log and invisible to the customer. */
  const clientIp = (() => { try { return rateLimitKey(req); } catch { return null; } })();
  let intent = null;
  try {
    if (req.body?.intent && await funnelReady(req.db)) {
      intent = await findIntent(req.db, String(req.body.intent));
      if (intent && (!intent.user_id || intent.user_id === userId)) {
        intent = await claimIntent(req.db, intent, userId, { clientIp });
      } else {
        intent = null;
      }
    }
  } catch (e) {
    console.error('[Downloads] intent lookup failed', e.message);
  }

  await auditGrant(req, {
    userId, intentId: intent?.id, slug, os, version, plan: check.ent?.plan,
  });

  if (intent) {
    /* Fulfilment is the funnel's terminal event and the only one that means the
     * person got what they came for. */
    try {
      await req.db.query(
        "UPDATE download_intents SET status = 'fulfilled', fulfilled_at = NOW(), updated_at = NOW() WHERE id = $1 AND status <> 'fulfilled'",
        [intent.id],
      );
    } catch (e) {
      console.error('[Downloads] failed to mark intent fulfilled', e.message);
    }
    await record(req.db, intent.id, STEPS.GRANT_MINTED, { slug, os, version }, { userId, clientIp });
  }

  return res.json({
    url: `${path}?grant=${encodeURIComponent(grant)}`,
    expiresInSeconds: GRANT_TTL_SECONDS,
  });
});

export default router;

/**
 * The UPDATER's half — Phase 3 of docs/DOWNLOAD-GATE.md.
 *
 * Mount at /api/updates behind databaseMiddleware + authMiddleware.
 *
 *   GET /api/updates/:slug/grant?os=win[&version=…][&channel=beta]
 *     → 200 { version, filename, url, expiresInSeconds }
 *     → 403 plan_upgrade_required
 *     → 404 NO_RELEASES | NO_RELEASE | NO_ASSET
 *
 * ── WHY THIS IS NOT JUST `POST /api/downloads/grant` ────────────────────────
 *
 * Two reasons, and the second is the one that matters.
 *
 * 1. It RESOLVES as well as mints. A browser already knows which version it
 *    wants because the page rendered it; an updater does not, and making it do
 *    an unauthenticated version.json fetch first would mean the fact that an
 *    update exists is public while the bytes are not — two sources of truth for
 *    one decision. One authenticated call returns both.
 *
 * 2. 🔴 It keeps UPDATE and DOWNLOAD separable. They are not obviously the same
 *    permission: "may this account install our software for the first time" and
 *    "may this account receive a SECURITY FIX for software it already installed
 *    and paid for" have different right answers, and the second one is the kind
 *    of question a company gets wrong by never having asked it. Collapsing the
 *    two endpoints today would foreclose that with no decision having been made.
 *
 * Both check `canDownload` right now, because nobody has decided otherwise and
 * inventing a `canUpdate` policy here would be making a product call that is not
 * mine to make. The seam is the CAPABILITY constant below: splitting them later
 * is one line here plus a row in PLAN_ENTITLEMENTS, not a refactor.
 *
 * ⚠️ This endpoint does not yet close the updater door — it opens the LOCK, it
 * does not turn it. Installed Hubs still poll the public CDN directly and will
 * keep working until R2 is locked, which must not happen until a Hub that calls
 * this has actually reached users. See docs/DOWNLOAD-GATE.md.
 */
const UPDATE_CAPABILITY = 'canDownload';

export const updateGrantRouter = express.Router();

updateGrantRouter.get('/:slug/grant', async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const osParam = String(req.query.os || '').toLowerCase();
  const os = OS_ALIASES[osParam];
  const version = req.query.version ? String(req.query.version).replace(/^v/i, '') : '';
  const channel = req.query.channel === 'beta' ? 'beta' : 'stable';
  res.set('Cache-Control', 'no-store');

  if (!/^[a-z0-9-]+$/.test(slug) || !os) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'slug and os are required (os = win|mac|linux)' } });
  }

  // authMiddleware owns 401; reaching here without a user is a wiring bug.
  const userId = req.user?.id;
  if (!userId || !req.db) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to update.' } });
  }

  /* The paywall, BEFORE the lookup — same ordering rule as the deep link, and
   * for the same reason: a refusal must not leak the version it refused. */
  const check = await assertEntitlement(req.db, userId, UPDATE_CAPABILITY);
  if (!check.allowed) return res.status(403).json(check.body);

  const releases = await loadReleases(slug);
  if (!releases.length) {
    return res.status(404).json({ error: { code: 'NO_RELEASES', message: `No releases published for "${slug}"` } });
  }
  const release = pickRelease(releases, { version, channel });
  if (!release) {
    return res.status(404).json({ error: { code: 'NO_RELEASE', message: `Release ${version || `(${channel})`} not found for "${slug}"` } });
  }
  const asset = release.assets?.[os]?.[0];
  if (!asset?.file) {
    return res.status(404).json({ error: { code: 'NO_ASSET', message: `No ${os} build for ${slug} ${release.version}` } });
  }

  /* Same bound as the download path — this mints the same authority, so it gets
   * the same limit and the same audit row. */
  const capped = await enforceGrantCap(req, userId);
  if (capped) return res.status(429).json(capped);

  /* Bound to the RESOLVED version, never to the empty "latest". An updater that
   * held a latest-shaped grant across a release would silently start pointing at
   * different bytes than the ones it decided to install. */
  const grant = mintDownloadGrant({ userId, slug, os, version: release.version });

  await auditGrant(req, {
    userId, slug, os, version: release.version, plan: check.ent?.plan || null,
  });
  return res.json({
    version: release.version,
    channel: release.channel || 'stable',
    filename: asset.file,
    url: `/product/${slug}/download/${osParam}/${release.version}?grant=${encodeURIComponent(grant)}`,
    expiresInSeconds: GRANT_TTL_SECONDS,
  });
});

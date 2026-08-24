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

  const grant = mintDownloadGrant({ userId, slug, os, version });
  const path = version
    ? `/product/${slug}/download/${osParam}/${version}`
    : `/product/${slug}/download/${osParam}`;
  return res.json({
    url: `${path}?grant=${encodeURIComponent(grant)}`,
    expiresInSeconds: GRANT_TTL_SECONDS,
  });
});

export default router;

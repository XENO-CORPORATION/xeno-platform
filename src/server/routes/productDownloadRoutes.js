/*
 * productDownloadRoutes — PRODUCT-PAGES-SPEC.md §4.
 *
 * Stable, public download deep-links. The URL never changes as versions bump;
 * the backend resolves the current asset from R2 at request time and 302s to it.
 *
 *   GET /product/:slug/download/:os              → latest STABLE asset for :os
 *   GET /product/:slug/download/:os/:version     → that version's asset
 *   GET /product/:slug/download/:os?channel=beta → latest BETA asset
 *
 * Mounted PUBLIC (no auth) at `/product`. nginx proxies only the OS-specific
 * subpath here; `/product/:slug` and `/product/:slug/download` (the pages) fall
 * through to the SPA.
 */
import express from 'express';
import { updatesOrigin } from '../config/hosts.js';

const router = express.Router();

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

export default router;

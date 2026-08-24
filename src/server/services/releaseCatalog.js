/**
 * "Which file is the current build of <slug> for <os>?" — asked from two places.
 *
 * The download route needs it to redirect. The funnel state machine needs it to
 * answer "is there even an artifact for this?" before telling someone they are
 * ready.
 *
 * ⚠️ It lives here rather than being copied because the two callers must agree.
 * A funnel that says READY for a platform the route then 404s on is worse than
 * either bug alone: the person is told to expect a download that cannot happen,
 * after paying.
 *
 * Deliberately NOT a fallback to version.json. A `version.json` with no
 * `releases.json` used to synthesize a one-entry release, which made the
 * download route serve an installer for any app that had ever pushed a
 * latest-pointer — in 2026-07 that was handing out 85 MB scaffold builds of
 * Sheets, Slides and Notes while the site marketed all three as "coming soon".
 * The two files mean different things and the fallback conflated them.
 */
import { updatesOrigin } from '../config/hosts.js';

const R2_PUBLIC = process.env.XENO_UPDATES_BASE || updatesOrigin();

const OS_ALIASES = {
  win: 'windows', windows: 'windows',
  mac: 'mac', macos: 'mac', osx: 'mac',
  linux: 'linux', appimage: 'linux',
};

export const normaliseOs = (raw) => OS_ALIASES[String(raw || '').toLowerCase()] || null;

const TTL_MS = 30_000;
const cache = new Map(); // slug -> { at, releases }

export async function loadReleases(slug) {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.releases;

  let releases = [];
  try {
    const res = await fetch(`${R2_PUBLIC}/apps/${slug}/releases.json`, { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      releases = Array.isArray(data) ? data : Array.isArray(data?.releases) ? data.releases : [];
    }
  } catch { /* no releases.json -> no download */ }

  cache.set(slug, { at: Date.now(), releases });
  return releases;
}

export function pickRelease(releases, { version, channel }) {
  if (version) {
    const want = String(version).replace(/^v/i, '');
    return releases.find((r) => r.version === want) || null;
  }
  const ch = channel || 'stable';
  return (
    releases.find((r) => (r.channel || 'stable') === ch)
    || releases.find((r) => r.latest)
    || releases[0]
    || null
  );
}

/**
 * The resolved asset, or null. `os` may be an alias.
 * Returns `{ version, file, channel }` — never a URL, because the caller decides
 * whether the person is allowed to be told one.
 */
export async function assetFor(slug, os, version = '', channel = 'stable') {
  const norm = normaliseOs(os);
  if (!norm || !/^[a-z0-9-]+$/.test(String(slug || ''))) return null;
  const releases = await loadReleases(slug);
  if (!releases.length) return null;
  const release = pickRelease(releases, { version, channel });
  const file = release?.assets?.[norm]?.[0]?.file;
  if (!file) return null;
  return { version: release.version, file, channel: release.channel || 'stable' };
}

/** The shape `downloadFunnel.resolve()` expects, so the funnel need not import
 *  the fetch policy — it asks a question, it does not choose a cache. */
export const releaseLookup = {
  assetFor: (slug, os, version, channel) => assetFor(slug, os, version, channel),
};

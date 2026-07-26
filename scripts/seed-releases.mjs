#!/usr/bin/env node
/*
 * seed-releases.mjs — PRODUCT-PAGES-SPEC.md §13 step 1.
 *
 * Seeds `releases.json` on R2 from each product's existing `version.json`, so the
 * canonical product pages (/product/:slug) light up immediately. Writes ONE
 * latest-stable entry per product. Only touches `releases.json` — never
 * `version.json` or the installers.
 *
 * ⚠ THIS SCRIPT IS DESTRUCTIVE AND IT DOES NOT LOOK IT.
 *
 * It REPLACES releases.json with a single synthesised entry. releases.json is the
 * canonical, prepend-only release HISTORY, R2 has no object versioning, and there is
 * no server-side copy — so running it against a product that already has a history
 * DELETES that history irreversibly. It is a ONE-OFF BOOTSTRAP for a product that has
 * a version.json but no releases.json yet; it is not a republish tool.
 *
 * On 2026-07-26 a bare `import()` of this module — no arguments, no intent to publish —
 * executed main() on the DEFAULT slug list and wiped the histories of hub, pixel,
 * motion and sound. Two design choices made that possible and both are now fixed:
 *
 *   1. Importing the module ran it. Now main() only runs when this file is the
 *      process entry point, so importing it is inert.
 *   2. It published by default. Now it PLANS by default and requires an explicit
 *      --confirm to write. There is no way to destroy a history by forgetting a flag.
 *
 * Usage:
 *   node scripts/seed-releases.mjs [slug ...]             # PLAN only (default)
 *   node scripts/seed-releases.mjs [slug ...] --confirm   # actually write
 *   (default slugs: hub pixel motion sound)
 *
 * Requires: rclone with an `r2:` remote pointing at the xeno-hub-releases bucket.
 */
import { pathToFileURL } from 'node:url';
import { updatesOrigin } from '../src/server/config/hosts.js';
import { R2Publisher } from './lib/r2-upload.mjs';

const R2_PUBLIC = process.env.XENO_UPDATES_BASE || updatesOrigin();
const R2_REMOTE = 'r2:xeno-hub-releases';
const DEFAULT_SLUGS = ['hub', 'pixel', 'motion', 'sound'];
const LABELS = { windows: 'Windows (x64)', mac: 'macOS', linux: 'Linux (AppImage)' };

/** version.json (latest pointer) → a canonical Release object (SPEC §5.1). */
export function toRelease(v) {
  const assets = {};
  for (const os of ['windows', 'mac', 'linux']) {
    if (v[os]) assets[os] = [{ label: LABELS[os], file: `v${v.version}/${v[os]}` }];
  }
  return {
    version: v.version,
    date: v.date ?? '',
    latest: true,
    type: 'release',
    channel: 'stable',
    severity: 'normal',
    notes: v.notes ?? '',
    ...(Object.keys(assets).length ? { assets } : {}),
  };
}

async function defaultFetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * @param {string[]} argv
 * @param {{fetchJson?:Function, makePublisher?:Function}} deps injectable so the
 *        history-flattening guard can be tested without touching R2.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const confirm = argv.includes('--confirm');
  const slugs = argv.filter((a) => !a.startsWith('--'));
  const targets = slugs.length ? slugs : DEFAULT_SLUGS;

  if (!confirm) {
    console.log('seed-releases: PLAN ONLY — pass --confirm to write.\n');
  }
  const r2 = deps.makePublisher
    ? deps.makePublisher({ remote: R2_REMOTE, dryRun: !confirm })
    : new R2Publisher({ remote: R2_REMOTE, dryRun: !confirm });
  let ok = 0;
  const overwrites = [];

  for (const slug of targets) {
    let v;
    try {
      v = await fetchJson(`${R2_PUBLIC}/apps/${slug}/version.json`);
    } catch (e) {
      console.log(`[${slug}] version.json unreadable (${e.message}) — skip`);
      continue;
    }
    if (!v?.version) {
      console.log(`[${slug}] version.json has no "version" — skip`);
      continue;
    }

    // Refuse to silently flatten an existing history. This is the whole hazard.
    let existing = null;
    try {
      existing = await fetchJson(`${R2_PUBLIC}/apps/${slug}/releases.json`);
    } catch { /* none yet — the intended bootstrap case */ }
    const existingCount = Array.isArray(existing) ? existing.length : 0;
    if (existingCount > 1) {
      overwrites.push({ slug, existingCount });
      console.error(
        `[${slug}] ✖ REFUSED — releases.json already holds ${existingCount} entries.\n` +
        `           Seeding would replace that history with ONE entry and it cannot be undone\n` +
        `           (R2 has no object versioning). This script bootstraps a product that has NO\n` +
        `           history yet. To publish a new version use scripts/xeno-release.mjs, which\n` +
        `           PREPENDS. If you truly mean to flatten it, pass --force-flatten.`,
      );
      if (!argv.includes('--force-flatten')) continue;
      console.warn(`[${slug}] ⚠ --force-flatten given: replacing ${existingCount} entries with 1.`);
    }

    const releases = [toRelease(v)];
    // Routed through the gated choke point (scripts/lib/r2-upload.mjs) like every
    // other R2 write — there is deliberately no unchecked upload path left.
    await r2.putPointer(
      JSON.stringify(releases, null, 2),
      `apps/${slug}/releases.json`,
      { label: `${slug}/releases.json` },
    );
    const osList = Object.keys(releases[0].assets ?? {}).join('+') || 'no-assets';
    console.log(`[${slug}] ${confirm ? '✓ seeded' : '→ would seed'} releases.json (v${v.version}, ${osList})`);
    ok++;
  }

  console.log(`\n${confirm ? 'Seeded' : 'Planned'} ${ok}/${targets.length} products.`);
  if (overwrites.length && !argv.includes('--force-flatten')) {
    console.log(`Skipped ${overwrites.length} product(s) that already have a release history.`);
  }
  if (!confirm) console.log('Nothing was written. Re-run with --confirm to apply.');
  return { seeded: ok, refused: overwrites, wrote: r2.uploads.map((u) => u.key) };
}

// Only run when invoked directly. Importing this module must never publish.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}

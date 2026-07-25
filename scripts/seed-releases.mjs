#!/usr/bin/env node
/*
 * seed-releases.mjs — PRODUCT-PAGES-SPEC.md §13 step 1.
 *
 * Seeds `releases.json` on R2 from each product's existing `version.json`, so the
 * canonical product pages (/product/:slug) light up immediately. Writes ONE
 * latest-stable entry per product (full history can be backfilled later). Only
 * touches `releases.json` — never `version.json` or the installers.
 *
 * Usage:  node scripts/seed-releases.mjs [slug ...]    (default: hub pixel motion sound)
 * Requires: rclone with an `r2:` remote pointing at the xeno-hub-releases bucket.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updatesOrigin } from '../src/server/config/hosts.js';

const R2_PUBLIC = process.env.XENO_UPDATES_BASE || updatesOrigin();
const R2_REMOTE = 'r2:xeno-hub-releases';
const DEFAULT_SLUGS = ['hub', 'pixel', 'motion', 'sound'];
const LABELS = { windows: 'Windows (x64)', mac: 'macOS', linux: 'Linux (AppImage)' };

const slugs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SLUGS;

/** version.json (latest pointer) → a canonical Release object (SPEC §5.1). */
function toRelease(v) {
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

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'xeno-rel-'));
  let ok = 0;
  for (const slug of slugs) {
    let v;
    try {
      const res = await fetch(`${R2_PUBLIC}/apps/${slug}/version.json`, { cache: 'no-cache' });
      if (!res.ok) {
        console.log(`[${slug}] no version.json (HTTP ${res.status}) — skip`);
        continue;
      }
      v = await res.json();
    } catch (e) {
      console.log(`[${slug}] version.json unreadable (${e.message}) — skip`);
      continue;
    }
    if (!v?.version) {
      console.log(`[${slug}] version.json has no "version" — skip`);
      continue;
    }
    const releases = [toRelease(v)];
    const file = join(tmp, `${slug}.releases.json`);
    writeFileSync(file, JSON.stringify(releases, null, 2));
    execFileSync(
      'rclone',
      [
        'copyto', file, `${R2_REMOTE}/apps/${slug}/releases.json`,
        '--header-upload', 'Cache-Control: no-cache',
        '--no-traverse',
      ],
      { stdio: 'inherit' },
    );
    const osList = Object.keys(toRelease(v).assets ?? {}).join('+') || 'no-assets';
    console.log(`[${slug}] ✓ seeded releases.json (v${v.version}, ${osList})`);
    ok++;
  }
  console.log(`\nSeeded ${ok}/${slugs.length} products.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

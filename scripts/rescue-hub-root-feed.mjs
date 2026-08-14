#!/usr/bin/env node
/**
 * Rescue the Hub installs stranded on the legacy ROOT updater feed.
 *
 * Background: Hub's `publish.url` was reverted from `apps/hub/` to the R2 root by the ACP
 * landing merge (e37209d), so every build from 0.7.0 through 0.9.0 has
 * `https://updates.xenostudio.ai/` compiled into its `app-update.yml`. That feed still
 * advertises **0.5.1** — an OLDER version — so those clients see no update and never will.
 *
 * The URL is baked into each installed copy, so it cannot be corrected server-side. Fixing it
 * forward (0.9.1 points at `apps/hub/`) helps only NEW installs. The people already running Hub
 * are reachable through exactly one channel: the root feed they are still polling.
 *
 * So this republishes the ROOT `latest.yml` as a copy of the current `apps/hub/latest.yml`, with
 * every `url:` rewritten from feed-relative (`v0.9.1/…`) to root-relative (`apps/hub/v0.9.1/…`).
 * Same file, same sha512, same size — only the path differs, because the two manifests sit at
 * different depths.
 *
 * Verified safe to repoint: no other product publishes to or polls the bare root (checked across
 * every xeno-* desktop repo). The root feed is Hub's own legacy location.
 *
 * Writes through R2Publisher.putPointer, which snapshots the outgoing bytes first — R2 has no
 * object versioning, so an overwritten pointer is otherwise irrecoverable.
 *
 * Usage: node scripts/rescue-hub-root-feed.mjs --version 0.9.1 [--dry-run]
 */
import { R2Publisher } from './lib/r2-upload.mjs';

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const dryRun = argv.includes('--dry-run');
const version = arg('version');

if (!version) {
  console.error('Usage: node scripts/rescue-hub-root-feed.mjs --version <x.y.z> [--dry-run]');
  process.exit(1);
}

const BASE = 'https://updates.xenostudio.ai';

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Rewrite feed-relative asset paths to root-relative ones. */
function toRootRelative(yml) {
  // `    - url: v0.9.1/XENO-HUB Setup 0.9.1.exe`  ->  `apps/hub/v0.9.1/…`
  // and the trailing bare `path:` field electron-updater also reads.
  return yml.replace(/^(\s*(?:-\s*)?(?:url|path):\s*)(v\d[^\r\n]*)$/gm, (_m, head, rest) => `${head}apps/hub/${rest}`);
}

const main = async () => {
  console.log(`rescue-hub-root-feed: ${version}${dryRun ? ' [DRY RUN]' : ''}`);

  const canonical = await fetchText(`${BASE}/apps/hub/latest.yml`);
  if (!canonical.includes(`version: ${version}`)) {
    throw new Error(`apps/hub/latest.yml is not at ${version} yet — publish the release first.`);
  }

  const before = await fetchText(`${BASE}/latest.yml`).catch(() => '(absent)');
  const beforeVersion = (before.match(/^version:\s*(\S+)/m) || [])[1] ?? '(none)';
  console.log(`  root feed currently advertises: ${beforeVersion}`);
  console.log(`  canonical feed advertises:      ${version}`);

  const rescued = toRootRelative(canonical);

  // Prove the rewrite did what it claims before anything is uploaded: every asset path must be
  // root-relative, and none may still be feed-relative.
  const paths = [...rescued.matchAll(/^\s*(?:-\s*)?(?:url|path):\s*(\S.*)$/gm)].map((m) => m[1]);
  if (!paths.length) throw new Error('no asset paths found in the manifest — refusing to publish an empty feed');
  const bad = paths.filter((p) => !p.startsWith('apps/hub/'));
  if (bad.length) throw new Error(`rewrite failed, these are not root-relative: ${bad.join(', ')}`);
  console.log(`  rewrote ${paths.length} asset path(s):`);
  for (const p of paths) console.log(`    ${p}`);

  // Confirm each rewritten path actually resolves, so the rescue cannot point at a 404.
  for (const p of [...new Set(paths)]) {
    const url = `${BASE}/${p.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, { method: 'HEAD' });
    console.log(`    ${res.status}  ${p}`);
    if (!res.ok) throw new Error(`rescued feed would point at a missing asset: ${p}`);
  }

  // Same remote every other publisher uses. Omitting it silently yields `undefined/latest.yml`
  // and a snapshot probe that reports "does not exist yet" for a pointer that very much does —
  // i.e. an overwrite with no backup. The dry run caught exactly that.
  const publisher = new R2Publisher({ remote: 'r2:xeno-hub-releases', dryRun });
  await publisher.putPointer(rescued, 'latest.yml', { label: 'root latest.yml (legacy-feed rescue)' });

  console.log('');
  if (dryRun) {
    console.log('DRY RUN — nothing uploaded.');
  } else {
    const after = await fetchText(`${BASE}/latest.yml`);
    const afterVersion = (after.match(/^version:\s*(\S+)/m) || [])[1];
    console.log(`  root feed now advertises: ${afterVersion}`);
    if (afterVersion !== version) throw new Error(`root feed still reports ${afterVersion}`);
    console.log(`✓ stranded clients on the legacy root feed can now reach ${version}.`);
  }
};

main().catch((err) => {
  console.error(`rescue-hub-root-feed FAILED: ${err.message}`);
  process.exit(1);
});

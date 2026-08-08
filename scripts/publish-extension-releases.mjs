#!/usr/bin/env node
/**
 * publish-extension-releases.mjs — publish the xeno-extension download feed to R2.
 *
 * WHY: the browser extension lives in the PRIVATE repo XENO-CORPORATION/xeno-extension.
 * The platform backend used to hit the GitHub API with a stored `GITHUB_TOKEN` to list
 * releases for the download page — a standing credential on the box, and the private
 * `browser_download_url`s didn't even work for anonymous users. This script mirrors the
 * release assets + a metadata feed to R2 (public `updates.xenostudio.ai/apps/extension/`),
 * so the backend serves extension downloads with NO GitHub credential at all.
 *
 * Auth: uses your local `gh` (already authenticated) to read the private repo — no token
 * is stored or passed to the backend. Uses `rclone` (r2: remote) to publish.
 *
 * Run after each extension release:
 *   node scripts/publish-extension-releases.mjs           # publish
 *   node scripts/publish-extension-releases.mjs --dry-run # show what it would do
 *
 * Produces on R2 (bucket xeno-hub-releases):
 *   apps/extension/<tag>/<asset>       the mirrored .zip + manifests
 *   apps/extension/releases.json       the metadata feed the backend reads (no-cache)
 *
 * ⚠ THIS IS THE SCRIPT THAT LEAKED A LIVE PLATFORM KEY.
 * It mirrors PRE-BUILT GitHub release assets — artifacts built long before the
 * current source, by a process this repo does not control — straight onto a public
 * CDN. On 2026-07-14 it uploaded three 2026-03-13 ZIPs whose bundled JS still
 * carried a working `xeno-…` platform API key; the key had been removed from source
 * on 2026-07-10 and xeno-extension's own CI guardrail was green the whole time,
 * because THIS PATH NEVER TOUCHES CI. Every upload now goes through
 * scripts/lib/r2-upload.mjs, which unpacks each ZIP and scans every entry before
 * rclone runs. Do not re-introduce a direct rclone call here.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { R2Publisher, GateError } from './lib/r2-upload.mjs';

const REPO = process.env.EXTENSION_RELEASES_REPO || 'XENO-CORPORATION/xeno-extension';
const R2_REMOTE = process.env.R2_REMOTE || 'r2:xeno-hub-releases';
const R2_PREFIX = 'apps/extension';
const PUBLIC_BASE = process.env.EXTENSION_PUBLIC_BASE || 'https://updates.xenostudio.ai/apps/extension';
const DRY = process.argv.includes('--dry-run');

const log = (m) => console.log(m);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });

// --- mapping (kept in parity with the shape ExtensionDownload.tsx consumes) ---
function classifyChannel(r) {
  const h = `${r.tag_name || ''} ${r.name || ''}`.toLowerCase();
  if (h.includes('preview')) return 'preview';
  if (h.includes('beta')) return 'beta';
  return r.prerelease ? 'beta' : 'stable';
}
function extractVersion(r) {
  const m = `${r.name || ''} ${r.tag_name || ''}`.match(/\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)*/);
  return m ? m[0] : r.tag_name;
}
function summarizeNotes(body = '') {
  return body.replace(/`/g, '').replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^#+\s+/gm, '').replace(/^\s*[-*]\s+/gm, '').replace(/\r/g, '').trim().slice(0, 320);
}
function mapAsset(a, tag) {
  return {
    id: a.id, name: a.name, size: a.size,
    downloadCount: a.download_count, updatedAt: a.updated_at,
    // Rewrite the private GitHub URL to the public R2 mirror.
    url: `${PUBLIC_BASE}/${encodeURIComponent(tag)}/${encodeURIComponent(a.name)}`,
  };
}
function mapRelease(r) {
  const channel = classifyChannel(r);
  const assets = (r.assets || [])
    .filter((a) => a.name.endsWith('.zip') || a.name.endsWith('.json'))
    .map((a) => mapAsset(a, r.tag_name));
  const primaryAsset = assets.find((a) => a.name.endsWith('.zip')) || null;
  return {
    id: r.id, channel, tag: r.tag_name, name: r.name, version: extractVersion(r),
    prerelease: r.prerelease, publishedAt: r.published_at, htmlUrl: r.html_url,
    notes: r.body || '', notesSummary: summarizeNotes(r.body || ''),
    assets, primaryAsset,
  };
}

async function main() {
  log(`[ext-publish] reading releases from ${REPO} via gh …`);
  const releases = JSON.parse(sh('gh', ['api', `repos/${REPO}/releases?per_page=20`]));
  const live = releases.filter((r) => !r.draft);
  log(`[ext-publish] ${live.length} non-draft release(s)`);

  const stage = mkdtempSync(join(tmpdir(), 'xeno-ext-'));
  const r2 = new R2Publisher({ remote: R2_REMOTE, dryRun: DRY });
  try {
    const mapped = [];
    for (const r of live) {
      const tag = r.tag_name;
      const dir = join(stage, tag);
      log(`[ext-publish] ${tag}: downloading assets …`);
      // Assets must be downloaded even in a dry run: the whole point of the gate is
      // to inspect the BYTES, and a dry run that skips the download would validate
      // nothing. Only the upload is suppressed.
      sh('gh', ['release', 'download', tag, '--repo', REPO, '--dir', dir, '--clobber'], { stdio: 'inherit' });
      log(`[ext-publish] ${tag}: scanning assets before upload …`);
      await r2.putDirectory(dir, `${R2_PREFIX}/${tag}/`);
      log(`[ext-publish] ${tag}: → R2 ${R2_PREFIX}/${tag}/`);
      mapped.push(mapRelease(r));
    }
    mapped.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    /* A channel pointer must resolve to something INSTALLABLE. The 1.0.0
     * stable/beta/preview releases had their ZIPs withdrawn (they embedded the
     * retired shared key) and now carry only provenance JSON, so selecting them
     * would advertise a "beta channel" whose download does not exist — the
     * reassuring-direction lie the secret gate exists to prevent, one layer up.
     * Withdrawn releases stay in recentReleases, where their notes explain why. */
    const installable = mapped.filter((m) => m.primaryAsset);
    const withdrawn = mapped.filter((m) => !m.primaryAsset);
    if (withdrawn.length) {
      log(`[ext-publish] ${withdrawn.length} release(s) have no downloadable asset and are NOT offered as a channel: `
        + withdrawn.map((m) => m.tag).join(', '));
    }

    const feed = {
      repo: REPO,
      generatedAt: new Date().toISOString(),
      channels: {
        stable: installable.find((m) => m.channel === 'stable') || null,
        beta: installable.find((m) => m.channel === 'beta') || null,
        preview: installable.find((m) => m.channel === 'preview') || null,
      },
      recentReleases: mapped.map((m) => (m.primaryAsset ? m : { ...m, withdrawn: true })).slice(0, 12),
    };

    log(`[ext-publish] feed: channels=${Object.entries(feed.channels).filter(([, v]) => v).map(([k]) => k).join(',')}`);
    // no-cache is applied by putPointer — it cannot be forgotten here.
    await r2.putPointer(JSON.stringify(feed, null, 2), `${R2_PREFIX}/releases.json`, { label: 'releases.json' });
    if (DRY) log(JSON.stringify(feed, null, 2).slice(0, 600));
    else log(`[ext-publish] published → ${PUBLIC_BASE}/releases.json`);
    log(`[ext-publish] ${r2.coverageSummary()}`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

main().catch((e) => {
  if (e instanceof GateError) {
    console.error('[ext-publish] REFUSED —', e.message);
    console.error('  Nothing was uploaded. This is the gate that the 2026-07-14 key leak needed.');
    process.exit(4);
  }
  console.error('[ext-publish] FAILED:', e.message);
  process.exit(1);
});

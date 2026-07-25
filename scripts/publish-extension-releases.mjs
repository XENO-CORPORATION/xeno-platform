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
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  try {
    const mapped = [];
    for (const r of live) {
      const tag = r.tag_name;
      const dir = join(stage, tag);
      log(`[ext-publish] ${tag}: downloading assets …`);
      if (!DRY) sh('gh', ['release', 'download', tag, '--repo', REPO, '--dir', dir, '--clobber'], { stdio: 'inherit' });
      log(`[ext-publish] ${tag}: → R2 ${R2_PREFIX}/${tag}/`);
      if (!DRY) sh('rclone', ['copy', dir, `${R2_REMOTE}/${R2_PREFIX}/${tag}/`], { stdio: 'inherit' });
      mapped.push(mapRelease(r));
    }
    mapped.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    const feed = {
      repo: REPO,
      generatedAt: new Date().toISOString(),
      channels: {
        stable: mapped.find((m) => m.channel === 'stable') || null,
        beta: mapped.find((m) => m.channel === 'beta') || null,
        preview: mapped.find((m) => m.channel === 'preview') || null,
      },
      recentReleases: mapped.slice(0, 12),
    };

    const feedPath = join(stage, 'releases.json');
    writeFileSync(feedPath, JSON.stringify(feed, null, 2));
    log(`[ext-publish] feed: channels=${Object.entries(feed.channels).filter(([, v]) => v).map(([k]) => k).join(',')}`);
    if (DRY) {
      log(`[ext-publish] DRY-RUN — would upload releases.json to ${R2_REMOTE}/${R2_PREFIX}/releases.json`);
      log(JSON.stringify(feed, null, 2).slice(0, 600));
    } else {
      // no-cache so the download page always sees the latest feed (like version.json).
      sh('rclone', ['copyto', feedPath, `${R2_REMOTE}/${R2_PREFIX}/releases.json`, '--header-upload', 'Cache-Control: no-cache'], { stdio: 'inherit' });
      log(`[ext-publish] published → ${PUBLIC_BASE}/releases.json`);
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error('[ext-publish] FAILED:', e.message); process.exit(1); });

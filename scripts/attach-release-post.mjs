#!/usr/bin/env node
/**
 * Give a release that already shipped its post, without touching its installers or its update feed.
 * Dry run unless --confirm. It refuses a release that already has a post, and the gated publisher
 * snapshots releases.json before replacing it.
 *
 *   node scripts/attach-release-post.mjs --app agent --version 0.3.29 --post <folder> [--channel stable] [--confirm]
 */
import { parseArgs } from 'node:util';
import { R2Publisher } from './lib/r2-upload.mjs';
import { validateReleasePost, withReleasePost } from './lib/release-post.mjs';

const R2_REMOTE = 'r2:xeno-hub-releases';
const R2_PUBLIC = 'https://updates.xenostudio.ai';

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    version: { type: 'string' },
    post: { type: 'string' },
    channel: { type: 'string', default: 'stable' },
    confirm: { type: 'boolean', default: false },
  },
});
const { app, version, post: postDir, channel, confirm } = values;
if (!app || !version || !postDir) throw new Error('--app, --version and --post are required');

const { files } = validateReleasePost(postDir);
const response = await fetch(`${R2_PUBLIC}/apps/${app}/releases.json?t=${Date.now()}`);
if (!response.ok) throw new Error(`could not read releases.json: HTTP ${response.status}`);
const current = await response.json();
const next = withReleasePost(current, version, channel, `v${version}/post/post.json`);

const r2 = new R2Publisher({ remote: R2_REMOTE, dryRun: !confirm });
const keyDir = `apps/${app}/v${version}/post`;
for (const file of files) await r2.gate(file.path, { requireStructural: false });
console.log(`${confirm ? 'Attaching' : 'Dry run:'} ${files.length} files to ${app} ${version} (${channel})`);
for (const file of files) await r2.putArtifact(file.path, `${keyDir}/${file.name}`, { requireStructural: false, label: file.name });
await r2.putPointer(JSON.stringify(next, null, 2), `apps/${app}/releases.json`, { label: 'releases.json' });
if (!confirm) process.exit(0);

for (const file of files) {
  const live = await fetch(`${R2_PUBLIC}/${keyDir}/${file.name}`, { headers: { Range: 'bytes=0-0' } });
  if (![200, 206].includes(live.status)) throw new Error(`${file.name} is not live: HTTP ${live.status}`);
}
const live = await (await fetch(`${R2_PUBLIC}/apps/${app}/releases.json?t=${Date.now()}`)).json();
const row = (Array.isArray(live) ? live : live.releases).find((release) => release.version === version);
if (row?.kind !== 'major' || !row.post) throw new Error('releases.json did not take the post');
console.log(`Live: ${files.length} files and the release row. Now major, post ${row.post}`);

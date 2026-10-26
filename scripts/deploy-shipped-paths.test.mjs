// Every file the frontend Dockerfile COPYs must be in the paths deploy-platform.mjs ships. Otherwise the build on the
// box fails with "not found" while every local build passes (2026-10-26: tool-host.html, two failed deploys).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const block = read('./deploy-platform.mjs').match(/\n  frontend: \[([\s\S]*?)\],\n/);
const shipped = block ? [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
const covered = (p) => shipped.some((s) => p === s || p.startsWith(s.replace(/\/$/, '') + '/') || (p.includes('*') && s.startsWith(p.split('*')[0])));

test('the frontend Dockerfile copies only paths the deploy ships', () => {
  assert.ok(shipped.length > 5, 'could not read the frontend paths from deploy-platform.mjs');
  const sources = [];
  for (const line of read('../Dockerfile.frontend').split('\n')) {
    const m = line.match(/^COPY\s+(?!--from)(.+)$/);
    if (!m) continue;
    const parts = m[1].trim().split(/\s+/).filter((x) => !x.startsWith('--'));
    parts.pop(); // the destination
    for (const p of parts) sources.push(p.replace(/^\.\//, '').replace(/\/$/, ''));
  }
  assert.ok(sources.length > 5, 'no COPY lines found in Dockerfile.frontend');
  assert.deepEqual(sources.filter((p) => !covered(p)), []);
});

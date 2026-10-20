// The release record's pure helpers: the deploy-log parser, the deploy row a deploy writes, and the history plan.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDeployLog, buildDeployRecord, prNumbersFromMerges, migrationsFromDiff } from './lib/deploy-record.mjs';
import { featureFor, plan, countsByRepo, REPOS } from './lib/release-history.mjs';

const LOG = `[2026-07-14T14:28:44Z] === deploy start service=backend sha=1e8efba mode=build-only nocache=no ===
[2026-07-14T14:29:40Z] === deploy end (build-only) service=backend sha=1e8efba OK ===
[2026-07-15T09:00:00Z] === deploy start service=backend sha=2f00aa1 mode=swap nocache=no ===
[2026-07-15T09:00:05Z] tagged current xeno-platform-backend (sha256:a8a51cebd1928a8883d45383f7be0a30e7eb2db6801d59b0c444cd95a7d00c34) -> :rollback
[2026-07-15T09:02:00Z] healthcheck PASSED (http://127.0.0.1:4000/api/ready)
[2026-07-15T09:02:01Z] === deploy end service=backend sha=2f00aa1 OK ===
[2026-07-16T09:00:00Z] === deploy start service=frontend sha=3a3a3a3 mode=swap nocache=no ===
[2026-07-16T10:00:00Z] === deploy start service=frontend sha=4b4b4b4 mode=swap nocache=no ===
[2026-07-16T10:03:00Z] === deploy end service=frontend sha=4b4b4b4 FAILED ===
`;

test('the deploy log becomes one row per deploy: ok, failed, interrupted, with healthcheck and rollback point', () => {
  const d = parseDeployLog(LOG);
  assert.equal(d.length, 4);
  assert.deepEqual(d.map((x) => [x.service, x.sha, x.mode, x.status]), [
    ['backend', '1e8efba', 'build-only', 'ok'], ['backend', '2f00aa1', 'swap', 'ok'], ['frontend', '3a3a3a3', 'swap', 'interrupted'], ['frontend', '4b4b4b4', 'swap', 'failed']]);
  assert.match(d[1].healthcheck, /PASSED/);
  assert.equal(d[1].rollbackPoint, 'xeno-platform-backend:rollback (sha256:a8a51cebd192)');
  assert.equal(d[1].startedAt, '2026-07-15T09:00:00Z');
  assert.equal(d[1].finishedAt, '2026-07-15T09:02:01Z');
  assert.equal(d[1].deployedBy, undefined, 'the log never recorded who deployed; nothing invents it');
});

test('a deploy names the PRs and migrations it shipped', () => {
  assert.deepEqual(prNumbersFromMerges('Merge pull request #859 from X/y\nfix: z (#12)\nMerge pull request #858 from X/w\nplain'), [12, 858, 859]);
  assert.deepEqual(migrationsFromDiff('src/server/database/migrations/20261023100000-release-record.sql\nsrc/server/x.js\n'), ['20261023100000-release-record.sql']);
  const row = buildDeployRecord({ service: 'backend', sha: 'abc1234', previousSha: 'def5678', mode: 'swap', ok: false, startedAt: 0, finishedAt: 1000, deployedBy: 'a@b', prs: [1], migrations: [] });
  assert.equal(row.status, 'failed');
  assert.equal(row.healthcheck, 'failed /api/ready');
  assert.equal(row.rollbackPoint, 'xeno-platform-backend:rollback');
});

test('changes map to features by Feature: line, then label, then conventional scope — never by guessing', () => {
  assert.deepEqual(featureFor('xeno-platform', { title: 'anything', body: 'x\nFeature: platform:support\n' }), { slug: 'platform:support', title: 'Support', derived: false });
  assert.equal(featureFor('xeno-platform', { title: 'x', labels: ['feature:platform:tasks'] }).slug, 'platform:tasks');
  assert.deepEqual(featureFor('xeno-post', { title: 'feat(inbox): mentions' }), { slug: 'post:inbox', title: 'Inbox (post)', derived: true });
  assert.equal(featureFor('xeno-post', { title: 'Update README' }), null);
});

test('the plan marks a platform feature live only when it is in the last OK deploy', () => {
  const p = plan({ repos: [{ repo: 'xeno-platform', deployedShas: ['s1'], prs: [{ number: 1, title: 'feat(a): x', mergedAt: '2026-01-01T00:00:00Z', mergeSha: 's1', labels: [] }, { number: 2, title: 'feat(b): y', mergedAt: '2026-01-02T00:00:00Z', mergeSha: 's2', labels: [] }], releases: [], tags: [], commits: [] }] });
  assert.deepEqual(p.features.map((f) => [f.slug, f.status, f.provenance]).sort(), [['platform:a', 'live', 'derived'], ['platform:b', 'built', 'derived']]);
  assert.equal(countsByRepo(p)['xeno-platform'].pr, 2);
});

test('the repo list covers the platform, places, post and every product published to R2', () => {
  for (const r of ['xeno-platform', 'xeno-places', 'xeno-post', 'xeno-hub', 'xeno-canvas', 'xeno-motion', 'xeno-agent-interface', 'xeno-extension']) assert.ok(REPOS.includes(r), r);
});

test('every deploy writes its row, OK and failed, through the backend on the box', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./deploy-platform.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const loop = src.slice(src.indexOf('step(`Deploying ${s} (${mode})`)'), src.indexOf('ok(`${s}: ${mode} complete'));
  assert.match(loop, /catch \(err\) \{\s*recordDeploy\(\{[^}]*ok: false/, 'a failed deploy records itself before rethrowing');
  assert.match(loop, /\}\s*recordDeploy\(\{[^}]*ok: true/, 'a successful deploy records itself');
  assert.match(src, /docker compose exec -T backend node \/app\/scripts\/record-deploy\.mjs/);
});

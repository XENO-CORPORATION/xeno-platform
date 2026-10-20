#!/usr/bin/env node
/**
 * Backfill the platform's release record (services/releaseRecord.js) with the FULL history, from the beginning.
 *
 * Two steps, so the production import needs no GitHub access on the box and no database on the workstation:
 *
 *   1. collect — read-only. For every repo in scripts/lib/release-history.mjs REPOS: merged PRs, published releases,
 *      tags, and every default-branch commit (`gh`); plus, for xeno-platform, the deploy log
 *      the box keeps (.deploy/deploy.log, fetched read-only over ssh, or --deploy-log <file>). Writes one JSON file.
 *
 *        node scripts/import-release-history.mjs collect --out history.json [--deploy-log deploy.log] [--repos a,b]
 *
 *   2. import — DRY-RUN BY DEFAULT: prints counts per repo and writes nothing. `--confirm` writes, through the one
 *      service, idempotently (every row has a natural key: running it twice changes nothing the second time).
 *
 *        DATABASE_URL=… node scripts/import-release-history.mjs import --file history.json [--confirm]
 *
 * Nothing is invented. Deploys come from the box's own log and are marked `reconstructed` with that log as evidence;
 * the log never recorded who ran a deploy, so that stays empty. Features grouped from PR titles are `derived` and say
 * how. No customer note is created: notes need a person's approval, and every imported feature starts enabled for
 * nobody.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOS, plan, countsByRepo } from './lib/release-history.mjs';
import { parseDeployLog, prNumbersFromMerges, migrationsFromDiff } from './lib/deploy-record.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORG = 'XENO-CORPORATION';
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d = null) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const ghJson = (args) => JSON.parse(gh(args) || 'null');
/** `gh api --paginate` of an array endpoint, concatenated. */
const ghPages = (path) => { const out = gh(['api', '--paginate', path, '--jq', '.[]']); return out.split('\n').filter(Boolean).map((l) => JSON.parse(l)); };
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();

function collectRepo(repo) {
  const full = `${ORG}/${repo}`;
  const view = spawnSync('gh', ['repo', 'view', full, '--json', 'defaultBranchRef,createdAt'], { encoding: 'utf8' });
  if (view.status !== 0) return { repo, missing: true };
  const meta = JSON.parse(view.stdout);
  const branch = meta.defaultBranchRef?.name || 'main';
  const prs = ghJson(['pr', 'list', '--repo', full, '--state', 'merged', '--limit', '5000', '--json', 'number,title,mergedAt,mergeCommit,author,url,labels,body,baseRefName'])
    .filter((p) => p.baseRefName === branch)
    .map((p) => ({ number: p.number, title: p.title, mergedAt: p.mergedAt, mergeSha: p.mergeCommit?.oid || null, author: p.author?.login || null, url: p.url,
      labels: (p.labels || []).map((l) => l.name), featureLine: (/^\s*Feature:\s*([a-z0-9][a-z0-9._:-]{0,119})\s*$/im.exec(p.body || '') || [])[1] || null }));
  const releases = ghJson(['release', 'list', '--repo', full, '--limit', '1000', '--json', 'tagName,name,publishedAt,isPrerelease,isDraft'])
    .map((r) => ({ ...r, url: `https://github.com/${full}/releases/tag/${encodeURIComponent(r.tagName)}` }));
  const tags = ghPages(`repos/${full}/tags?per_page=100`).map((t) => ({ name: t.name, sha: t.commit?.sha || null }));
  // every default-branch commit — the history before pull requests and every direct push since. A PR's merge commit
  // is its PR row, so it is not repeated as a commit.
  const mergeShas = new Set(prs.map((p) => p.mergeSha).filter(Boolean));
  const commits = ghPages(`repos/${full}/commits?sha=${encodeURIComponent(branch)}&per_page=100`)
    .filter((c) => !mergeShas.has(c.sha))
    .map((c) => ({ sha: c.sha, title: String(c.commit?.message || '').split('\n')[0].slice(0, 300), author: c.author?.login || c.commit?.author?.name || null, at: c.commit?.committer?.date || c.commit?.author?.date || null, url: c.html_url }));
  return { repo, branch, createdAt: meta.createdAt, prs, releases, tags, commits };
}

function collectDeploys(logText) {
  const runs = parseDeployLog(logText);
  // previous sha + the PRs and migrations between consecutive OK swaps of the same service, from this repo's history
  const lastOk = new Map();
  const known = (s) => spawnSync('git', ['cat-file', '-e', `${s}^{commit}`], { cwd: ROOT }).status === 0;
  return runs.map((d) => {
    const prev = d.mode === 'swap' ? lastOk.get(d.service) || null : null;
    let prs = [], migrations = [];
    if (prev && known(prev) && known(d.sha)) {
      try { prs = prNumbersFromMerges(git(['log', '--first-parent', '--format=%s', `${prev}..${d.sha}`])); migrations = migrationsFromDiff(git(['diff', '--name-only', '--diff-filter=A', prev, d.sha, '--', 'src/server/database/migrations'])); } catch { /* unknown range */ }
    }
    if (d.mode === 'swap' && d.status === 'ok') lastOk.set(d.service, d.sha);
    return { ...d, previousSha: prev, prs, migrations, provenance: 'reconstructed', evidence: 'xeno-platform-001:/mnt/projects/xeno-platform/.deploy/deploy.log' };
  });
}

function deployedShas(deploys) {
  const last = [...deploys].reverse().find((d) => d.mode === 'swap' && d.status === 'ok' && d.service === 'backend');
  if (!last) return [];
  try { return git(['rev-list', last.sha]).split('\n').filter(Boolean); } catch { return []; }
}

async function main() {
  if (cmd === 'collect') {
    const out = opt('--out'); if (!out) throw new Error('collect needs --out <file>');
    const repos = (opt('--repos') || REPOS.join(',')).split(',').filter(Boolean);
    const logFile = opt('--deploy-log');
    const logText = logFile ? readFileSync(logFile, 'utf8')
      : execFileSync('ssh', ['xeno-platform-001', 'cat /mnt/projects/xeno-platform/.deploy/deploy.log'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const deploys = collectDeploys(logText);
    const snap = { collectedAt: new Date().toISOString(), org: ORG, deploys, repos: [] };
    const shas = deployedShas(deploys);
    for (const repo of repos) {
      process.stderr.write(`collect ${repo}… `);
      const r = collectRepo(repo);
      if (repo === 'xeno-platform') r.deployedShas = shas;
      snap.repos.push(r);
      process.stderr.write(r.missing ? 'not found\n' : `${r.prs.length} PRs, ${r.releases.length} releases, ${r.tags.length} tags, ${r.commits.length} default-branch commits\n`);
    }
    writeFileSync(out, JSON.stringify(snap));
    console.log(`wrote ${out}`);
    return;
  }
  if (cmd === 'import') {
    const file = opt('--file'); if (!file) throw new Error('import needs --file <history.json>');
    const snap = JSON.parse(readFileSync(file, 'utf8'));
    const p = plan(snap);
    const counts = countsByRepo(p, snap.deploys || []);
    console.log(`release history from ${file} (collected ${snap.collectedAt})`);
    console.log('repo'.padEnd(24) + ['PRs', 'releases', 'tags', 'commits', 'attached', 'features', 'deploys'].map((h) => h.padStart(9)).join(''));
    for (const [repo, c] of Object.entries(counts).sort()) console.log(repo.padEnd(24) + [c.pr, c.release, c.tag, c.commit, c.attached, c.features, c.deploys || 0].map((n) => String(n).padStart(9)).join(''));
    const tot = (k) => Object.values(counts).reduce((s, c) => s + (c[k] || 0), 0);
    console.log('TOTAL'.padEnd(24) + ['pr', 'release', 'tag', 'commit', 'attached', 'features', 'deploys'].map((k) => String(tot(k)).padStart(9)).join(''));
    console.log(`deploys by status: ${JSON.stringify((snap.deploys || []).reduce((m, d) => ((m[d.status] = (m[d.status] || 0) + 1), m), {}))}; live features: ${p.features.filter((f) => f.status === 'live').length}`);
    if (!has('--confirm')) { console.log('DRY-RUN — nothing written. Pass --confirm to import.'); return; }
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to import');
    const pg = (await import('pg')).default;
    const rel = await import('../src/server/services/releaseRecord.js');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const n = { features: 0, changes: 0, deploys: 0 };
    try {
      for (const f of p.features) if ((await rel.upsertFeature(pool, null, f, { system: true })).inserted) n.features += 1;
      for (const c of p.changes) if ((await rel.recordChange(pool, c)).inserted) n.changes += 1;
      for (const d of snap.deploys || []) if ((await rel.recordDeploy(pool, d)).inserted) n.deploys += 1;
    } finally { await pool.end(); }
    console.log(`imported: ${n.features} new features, ${n.changes} new changes, ${n.deploys} new deploys (existing rows left as they were)`);
    return;
  }
  console.error('usage: import-release-history.mjs collect --out <file> | import --file <file> [--confirm]');
  process.exit(2);
}

main().catch((e) => { console.error(`import-release-history: ${e.message}`); process.exit(1); });

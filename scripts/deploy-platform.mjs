#!/usr/bin/env node
/**
 * deploy-platform.mjs — codified deploy for the xeno-platform Docker stack.
 *
 * Replaces the hand-typed `git archive HEAD … | ssh … sudo docker compose build/up`
 * one-liner (release-guide/04 §3) with a versioned, gated, auto-rollback deploy that
 * covers the money BACKEND as well as the frontend.
 *
 * What it guarantees that the one-liner did not:
 *   - DEFAULT IS DRY-RUN. Nothing mutates prod unless you pass --execute.
 *   - Commit-before-deploy is ENFORCED, not just documented: the shipped paths must be
 *     clean vs HEAD, because the deploy ships `git archive HEAD` (committed bytes only).
 *   - Build-before-swap + a REAL healthcheck gate (/api/ready for backend) + AUTO-ROLLBACK.
 *   - The built image is tagged with the git SHA, so "what's running" is knowable.
 *   - Every deploy appends an audit line to .deploy/deploy.log on the box.
 *
 * Transport is scp-of-a-tar (not a fragile cross-platform pipe): `git archive` writes a
 * tar locally, scp ships it + this repo's scripts/remote-deploy.sh to /tmp/xeno-deploy on
 * the box, and `sudo bash remote-deploy.sh` does the on-box work. Windows-friendly.
 *
 * Usage:
 *   node scripts/deploy-platform.mjs <backend|frontend|both> [options]
 *
 * Options:
 *   --execute            Actually deploy (swap). Without it: dry-run (prints the plan).
 *   --build-only         Ship + build the image but DO NOT swap. Zero prod impact.
 *                        (The current container keeps serving; use to validate a build.)
 *   --no-cache           docker compose build --no-cache (bust a stale layer).
 *   --host <alias>       SSH host (default: xeno-platform-001).
 *   --root <path>        Box repo path (default: /mnt/projects/xeno-platform).
 *   --allow-dirty        Skip the clean-worktree guard (NOT recommended).
 *   --rollback           Emergency: retag :rollback -> :latest and up -d (no build).
 *
 * Examples:
 *   node scripts/deploy-platform.mjs backend                 # dry-run plan
 *   node scripts/deploy-platform.mjs backend --build-only --execute   # validate build, no swap
 *   node scripts/deploy-platform.mjs frontend --execute      # real frontend deploy
 *   node scripts/deploy-platform.mjs both --execute          # backend then frontend
 *   node scripts/deploy-platform.mjs backend --rollback --execute     # emergency rollback
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const REMOTE_TMP = '/tmp/xeno-deploy';

// --- Path sets shipped per service ----------------------------------------
// backend: ship the image inputs plus docker-compose.yml. Runtime wiring (service
//   hostnames, feature flags, provider keys) is part of a correct backend release,
//   not host-local state that may silently drift from the committed contract.
// frontend: Dockerfile.frontend's builder copies configs + public/ + src/ + scripts/.
//   We ship a superset of exactly those, existence-filtered against HEAD.
const PATHS = {
  backend: ['src/server', 'Dockerfile.backend', 'docker-compose.yml'],
  frontend: [
    'src', 'public', 'scripts', 'index.html', 'Dockerfile.frontend', '.dockerignore', 'nginx',
    'package.json', 'package-lock.json',
    'vite.config.ts', 'vite.config.js',
    'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
    'tailwind.config.js', 'tailwind.config.ts', 'postcss.config.js', 'components.json',
  ],
};

// --- arg parsing ----------------------------------------------------------
const argv = process.argv.slice(2);
const services = [];
const opts = { execute: false, buildOnly: false, noCache: false, allowDirty: false, rollback: false,
               host: 'xeno-platform-001', root: '/mnt/projects/xeno-platform' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === 'backend' || a === 'frontend') services.push(a);
  else if (a === 'both') { services.push('backend', 'frontend'); }
  else if (a === '--execute' || a === '-y') opts.execute = true;
  else if (a === '--build-only') opts.buildOnly = true;
  else if (a === '--no-cache') opts.noCache = true;
  else if (a === '--allow-dirty') opts.allowDirty = true;
  else if (a === '--rollback') opts.rollback = true;
  else if (a === '--host') opts.host = argv[++i];
  else if (a === '--root') opts.root = argv[++i];
  else { console.error(`deploy: unknown arg: ${a}`); process.exit(2); }
}
if (services.length === 0) {
  console.error('deploy: specify a service — backend | frontend | both');
  console.error('       run with no --execute for a dry-run plan.');
  process.exit(2);
}

// --- small helpers --------------------------------------------------------
const C = { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', cyn: '\x1b[36m', rst: '\x1b[0m' };
const log = (m) => console.log(m);
const step = (m) => console.log(`${C.cyn}▶ ${m}${C.rst}`);
const ok = (m) => console.log(`${C.grn}✓ ${m}${C.rst}`);
const warn = (m) => console.log(`${C.yel}! ${m}${C.rst}`);

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}
function run(cmd, args, { capture = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}${r.stderr ? `\n${r.stderr}` : ''}`);
  }
  return capture ? (r.stdout || '').trim() : '';
}
// paths in HEAD only (git archive errors on a missing pathspec)
function existingInHead(paths) {
  return paths.filter((p) => {
    const r = spawnSync('git', ['cat-file', '-e', `HEAD:${p}`], { cwd: REPO_ROOT });
    return r.status === 0;
  });
}
function dirtyPaths(paths) {
  // any tracked change (staged or unstaged) under the shipped paths?
  const out = spawnSync('git', ['status', '--porcelain', '--', ...paths], { cwd: REPO_ROOT, encoding: 'utf8' });
  return (out.stdout || '').trim();
}

// --- preflight ------------------------------------------------------------
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const sha = git(['rev-parse', '--short', 'HEAD']);
const fullSha = git(['rev-parse', 'HEAD']);

log(`${C.dim}────────────────────────────────────────────────────────${C.rst}`);
log(`${C.cyn}xeno-platform deploy${C.rst}  services=${services.join('+')}  branch=${branch}  sha=${sha}`);
log(`  host=${opts.host}  root=${opts.root}`);
log(`  mode=${opts.rollback ? 'ROLLBACK' : opts.buildOnly ? 'build-only' : 'swap'}  ${opts.execute ? `${C.grn}EXECUTE${C.rst}` : `${C.yel}DRY-RUN${C.rst}`}${opts.noCache ? '  --no-cache' : ''}`);
log(`${C.dim}────────────────────────────────────────────────────────${C.rst}`);

// Emergency rollback path: no build, just flip images on the box.
if (opts.rollback) {
  const cmds = services.map((s) =>
    `docker image inspect xeno-platform-${s}:rollback >/dev/null 2>&1 && ` +
    `docker tag xeno-platform-${s}:rollback xeno-platform-${s}:latest && ` +
    `docker compose up -d --no-deps --force-recreate ${s} && echo "rolled back ${s}" || echo "no rollback image for ${s}"`,
  );
  const remote = `cd ${opts.root} && ${cmds.join(' && ')}`;
  step('Emergency rollback (retag :rollback -> :latest, recreate)');
  log(`${C.dim}  ssh ${opts.host} sudo bash -c '${remote}'${C.rst}`);
  if (!opts.execute) { warn('DRY-RUN — pass --execute to perform the rollback.'); process.exit(0); }
  run('ssh', [opts.host, `sudo bash -c ${shq(remote)}`]);
  ok('Rollback complete.');
  process.exit(0);
}

// Clean-worktree guard (deploy ships committed bytes only).
for (const s of services) {
  const dirty = dirtyPaths(PATHS[s]);
  if (dirty && !opts.allowDirty) {
    console.error(`${C.red}✗ Uncommitted changes under ${s} paths — they would NOT ship (deploy uses git archive HEAD).${C.rst}`);
    console.error(dirty);
    console.error('  Commit them first, or pass --allow-dirty to deploy HEAD anyway.');
    process.exit(1);
  }
  if (dirty) warn(`--allow-dirty: uncommitted changes under ${s} will NOT ship (HEAD is deployed).`);
}

// Build the union of shipped paths, existence-filtered.
const shipPaths = existingInHead([...new Set(services.flatMap((s) => PATHS[s]))]);
ok(`Shipping ${shipPaths.length} path(s) at HEAD ${sha}: ${shipPaths.join(', ')}`);

// --- dry-run: print the plan and stop -------------------------------------
if (!opts.execute) {
  step('DRY-RUN plan (no changes will be made):');
  log(`  1. git archive HEAD -> deploy-${sha}.tar  (paths above)`);
  log(`  2. scp tar + scripts/remote-deploy.sh -> ${opts.host}:${REMOTE_TMP}/`);
  for (const s of services) {
    log(`  3.${s}. ssh ${opts.host}: sudo bash remote-deploy.sh --service ${s} --sha ${sha} --mode ${opts.buildOnly ? 'build-only' : 'swap'}${opts.noCache ? ' --no-cache' : ''}`);
    log(`        -> tag :latest->:rollback, compose build ${s}, tag :${sha}${opts.buildOnly ? '' : `, up -d, gate on ${s === 'backend' ? '/api/ready' : '/health'}, auto-rollback on fail`}`);
  }
  warn('DRY-RUN — pass --execute to run it for real.');
  process.exit(0);
}

// --- execute --------------------------------------------------------------
const stage = mkdtempSync(join(tmpdir(), 'xeno-deploy-'));
const tarLocal = join(stage, `deploy-${sha}.tar`);
try {
  step(`Packing git archive HEAD (${sha}) -> tar`);
  // git archive writes committed bytes only (LF; core.autocrlf=true).
  run('git', ['archive', '--format=tar', '-o', tarLocal, 'HEAD', '--', ...shipPaths]);
  ok(`packed ${tarLocal}`);

  step(`Provisioning ${opts.host}:${REMOTE_TMP}`);
  run('ssh', [opts.host, `mkdir -p ${REMOTE_TMP}`]);

  step('Shipping tar + remote-deploy.sh');
  run('scp', ['-q', tarLocal, `${opts.host}:${REMOTE_TMP}/deploy-${sha}.tar`]);
  run('scp', ['-q', join(REPO_ROOT, 'scripts', 'remote-deploy.sh'), `${opts.host}:${REMOTE_TMP}/remote-deploy.sh`]);
  ok('shipped');

  const mode = opts.buildOnly ? 'build-only' : 'swap';
  for (const s of services) {
    step(`Deploying ${s} (${mode})`);
    const remoteCmd =
      `cd ${opts.root} && sudo bash ${REMOTE_TMP}/remote-deploy.sh ` +
      `--service ${s} --sha ${sha} --tar ${REMOTE_TMP}/deploy-${sha}.tar ` +
      `--mode ${mode} --root ${opts.root}${opts.noCache ? ' --no-cache' : ''}`;
    run('ssh', [opts.host, remoteCmd]);
    ok(`${s}: ${mode} complete${opts.buildOnly ? ' (not swapped)' : ' + healthcheck passed'}`);
  }

  log(`${C.dim}────────────────────────────────────────────────────────${C.rst}`);
  ok(`Deploy OK — ${services.join('+')} @ ${sha} (${branch})`);
  if (opts.buildOnly) warn('build-only: the running containers were NOT swapped.');
} catch (err) {
  console.error(`${C.red}✗ Deploy failed: ${err.message}${C.rst}`);
  console.error(`${C.dim}  The remote script is build-before-swap + auto-rollback; the previous`);
  console.error(`  container should still be serving. Check: ssh ${opts.host} 'tail -30 ${opts.root}/.deploy/deploy.log'${C.rst}`);
  process.exitCode = 1;
} finally {
  try { rmSync(stage, { recursive: true, force: true }); } catch { /* noop */ }
}

// POSIX single-quote shell-escape for the one place we interpolate into `sudo bash -c`.
function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

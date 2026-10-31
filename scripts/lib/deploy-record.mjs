/**
 * Pure helpers for the deploy half of the release record (services/releaseRecord.js). Used by
 * scripts/deploy-platform.mjs to write a row at the end of every deploy, and by the history import to parse the box's
 * .deploy/deploy.log. Kept free of I/O so both are testable.
 */

/** PR numbers from `git log --first-parent --merges --format=%s` (GitHub's "Merge pull request #N from …"). */
export function prNumbersFromMerges(lines) {
  const out = new Set();
  for (const l of String(lines || '').split(/\r?\n/)) {
    const m = /^Merge pull request #(\d+)\b/.exec(l.trim()) || /\(#(\d+)\)\s*$/.exec(l.trim());
    if (m) out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

/** Migration file names from `git diff --name-only --diff-filter=A` output. */
export function migrationsFromDiff(lines) {
  return String(lines || '').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => /^src\/server\/database\/migrations\/[^/]+\.sql$/.test(l))
    .map((l) => l.split('/').pop()).sort();
}

export const GATES = { backend: '/api/ready', 'chat-workers': 'internal /ready/semantic', frontend: '/health' };

/** The row deploy-platform.mjs sends to record-deploy.mjs. Every field is something this deploy observed. */
export function buildDeployRecord({ service, sha, previousSha = null, mode, ok, startedAt, finishedAt, deployedBy = null, prs = [], migrations = [] }) {
  const swapped = mode === 'swap';
  return {
    service, sha, previousSha, mode, status: ok ? 'ok' : 'failed',
    startedAt: new Date(startedAt).toISOString(), finishedAt: new Date(finishedAt).toISOString(), deployedBy,
    healthcheck: swapped ? `${ok ? 'passed' : 'failed'} ${GATES[service] || 'healthcheck'}` : (ok ? 'build only: not swapped' : 'build failed'),
    rollbackPoint: `xeno-platform-${service}:rollback`,
    prs, migrations,
  };
}

/**
 * Parse the box's .deploy/deploy.log into deploys. Each `=== deploy start … ===` opens one; the matching
 * `=== deploy end … ===` closes it with OK or FAILED; a start with no end before the next start of the same service
 * is `interrupted`. The log never recorded who ran a deploy, so `deployedBy` stays null.
 */
export function parseDeployLog(text) {
  const out = [];
  const open = new Map();
  const ts = (l) => (/^\[([0-9T:\-]+Z)\]/.exec(l) || [])[1] || null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const at = ts(line);
    let m = /=== deploy start service=(\S+) sha=([0-9a-f]+) mode=(\S+)/.exec(line);
    if (m) {
      const [, service, sha, mode] = m;
      if (open.has(service)) out.push({ ...open.get(service), status: 'interrupted' });
      open.set(service, { service, sha, mode: mode === 'build-only' ? 'build-only' : 'swap', startedAt: at, finishedAt: null, healthcheck: null, rollbackPoint: null });
      continue;
    }
    m = /=== deploy end(?: \(build-only\))? service=(\S+) sha=([0-9a-f]+) (OK|FAILED)/.exec(line);
    if (m) {
      const cur = open.get(m[1]);
      if (cur && cur.sha === m[2]) { out.push({ ...cur, finishedAt: at, status: m[3] === 'OK' ? 'ok' : 'failed' }); open.delete(m[1]); }
      continue;
    }
    for (const cur of open.values()) {
      if (/healthcheck (PASSED|FAILED)/.test(line)) cur.healthcheck = line.replace(/^\[[^\]]*\]\s*/, '').slice(0, 200);
      const r = /tagged current (xeno-platform-\S+) \((sha256:[0-9a-f]{12})/.exec(line);
      if (r && line.includes(cur.service)) cur.rollbackPoint = `${r[1]}:rollback (${r[2]})`;
    }
  }
  for (const cur of open.values()) out.push({ ...cur, status: 'interrupted' });
  return out.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

/**
 * Collect the facts an INTERNAL release note is drafted from (src/server/services/releaseInternalNoteTemplate.js),
 * on the WORKSTATION — the box has no GitHub access. Used by scripts/deploy-platform.mjs at every deploy and by
 * scripts/draft-internal-notes.mjs for the history backfill. I/O is injected so it is testable:
 *
 *   git(args)      → stdout of `git <args>` in this repo (throws on failure)
 *   prText(number) → {title, body, url} from GitHub, or null when it cannot be read
 *
 * Returns {prs: [{number, title, body, url, files}], migrations: [{name, text}], env: {added, removed} | null, collectedBy}.
 * Nothing is invented: a PR GitHub could not answer for keeps its merge subject as title and an empty body.
 */
import { envChangesFromDiff } from '../../src/server/services/releaseInternalNoteTemplate.js';

const MIG_DIR = 'src/server/database/migrations';
const ENV_PATHS = ['src/server', 'docker-compose.yml', '.env.example', 'nginx', 'Dockerfile.backend', 'Dockerfile.frontend'];

export function collectNoteSources({ git, prText = () => null, previousSha, sha, prs = [], migrations = [] }) {
  const tryGit = (args) => { try { return git(args); } catch { return null; } };
  // merge commits on the first-parent line, so each PR's files are exactly what its merge brought in
  const merges = new Map();
  if (previousSha) {
    for (const line of String(tryGit(['log', '--first-parent', '--format=%H %s', `${previousSha}..${sha}`]) || '').split(/\r?\n/)) {
      const m = /^([0-9a-f]{40}) (.*)$/.exec(line.trim()); if (!m) continue;
      const n = /^Merge pull request #(\d+)\b/.exec(m[2]) || /\(#(\d+)\)\s*$/.exec(m[2]);
      if (n && !merges.has(Number(n[1]))) merges.set(Number(n[1]), { sha: m[1], subject: m[2] });
    }
  }
  let fromGithub = 0;
  const outPrs = [...new Set(prs.map(Number))].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b).map((number) => {
    const t = prText(number);
    if (t) fromGithub += 1;
    const mc = merges.get(number);
    const files = mc ? String(tryGit(['diff', '--name-only', `${mc.sha}^1`, mc.sha]) || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
    return { number, title: (t && t.title) || (mc ? mc.subject : ''), body: (t && t.body) || '', url: (t && t.url) || null, files };
  });
  const outMig = migrations.map((name) => ({ name, text: tryGit(['show', `${sha}:${MIG_DIR}/${name}`]) }));
  const diff = previousSha ? tryGit(['diff', '-U0', previousSha, sha, '--', ...ENV_PATHS]) : null;
  return { prs: outPrs, migrations: outMig, env: diff == null ? null : envChangesFromDiff(diff), collectedBy: fromGithub ? 'gh' : 'git' };
}

/** `gh pr view` for one PR, or null. */
export function ghPrText(spawnSync, repo = 'XENO-CORPORATION/xeno-platform') {
  return (number) => {
    const r = spawnSync('gh', ['pr', 'view', String(number), '--repo', repo, '--json', 'title,body,url'], { encoding: 'utf8', timeout: 30_000 });
    if (r.status !== 0) return null;
    try { const j = JSON.parse(r.stdout); return { title: j.title || '', body: j.body || '', url: j.url || null }; } catch { return null; }
  };
}

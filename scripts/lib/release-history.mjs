/**
 * Pure helpers for importing the release record's history (scripts/import-release-history.mjs). No I/O.
 *
 * A change maps to a feature by, in order:
 *   1. a `Feature: <slug>` line in the PR body (the rule going forward — release-guide and the PR template say so);
 *   2. a `feature:<slug>` label;
 *   3. for history, the conventional-commit scope of its title — `feat(support): …` in xeno-platform is
 *      `platform:support`. These features are `derived`, and say so.
 * A change with none of the three (a bare "Update README") stays unattached: it is recorded, never guessed into a
 * feature.
 */

/** The repositories whose work reaches users through the platform: the platform itself, the products it hosts, and
 *  every product published to R2 (scripts/shipped-versions.mjs PRODUCTS, mapped slug → repo). */
export const REPOS = [
  'xeno-platform', 'xeno-places', 'xeno-post', 'xeno-spawn',
  'xeno-hub', 'xeno-canvas', 'xeno-pixel', 'xeno-motion', 'xeno-sound', 'xeno-shell', 'xeno-browser', 'xeno-workflow',
  'xeno-docs', 'xeno-sheets', 'xeno-slides', 'xeno-notes', 'xeno-comms', 'xeno-agent-interface', 'xeno-apps',
  'xeno-architect', 'xeno-form', 'xeno-3d', 'xeno-engine', 'xeno-tools', 'xeno-extension',
];

export const shortName = (repo) => String(repo).replace(/^xeno-/, '');
const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

export function featureLine(body) {
  const m = /^\s*Feature:\s*([a-z0-9][a-z0-9._:-]{0,119})\s*$/im.exec(String(body || ''));
  return m ? m[1].toLowerCase() : null;
}

export function scopeOf(title) {
  const m = /^(?:feat|fix|perf|refactor|chore|docs|test|ci|build|style|revert|security|ops|content|release)(?:\(([^)]+)\))?!?:\s*\S/i.exec(String(title || '').trim());
  if (!m || !m[1]) return null;
  return clean(m[1].split(/[,/ ]/)[0]);
}

/** The feature a change belongs to: { slug, title, derived } or null. */
export function featureFor(repo, change) {
  const explicit = featureLine(change.body) || (change.labels || []).map((l) => (/^feature:(.+)$/i.exec(l) || [])[1]).find(Boolean);
  if (explicit) return { slug: explicit.toLowerCase(), title: humanize(explicit.split(':').pop()), derived: false };
  const scope = scopeOf(change.title);
  if (!scope) return null;
  return { slug: `${shortName(repo)}:${scope}`, title: `${humanize(scope)} (${shortName(repo)})`, derived: true };
}

export function humanize(s) {
  const t = String(s || '').replace(/[-_.]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : 'General';
}

/**
 * Build the import plan from one collected snapshot: features (with first/last change and a derived status) and
 * changes (with the slug they attach to). `deployedShas` is the set of commits reachable from the platform's last
 * OK swap; `releaseTimes` is each repo's published release dates — a change before a release of its repo is in it.
 */
export function plan(snapshot) {
  const features = new Map(), changes = [];
  for (const r of snapshot.repos || []) {
    const deployed = new Set(r.deployedShas || []);
    const releases = (r.releases || []).filter((x) => x.publishedAt && !x.isDraft).map((x) => Date.parse(x.publishedAt)).sort((a, b) => a - b);
    const lastRelease = releases.length ? releases[releases.length - 1] : null;
    const add = (c) => {
      const f = c.kind === 'pr' || c.kind === 'commit' ? featureFor(r.repo, c) : null;
      changes.push({ repo: r.repo, kind: c.kind, externalId: String(c.externalId), title: c.title || '', url: c.url || null, author: c.author || null, sha: c.sha || null, at: c.at || null, labels: c.labels || [], featureSlug: f ? f.slug : null });
      if (!f) return;
      const at = c.at ? Date.parse(c.at) : null;
      const shipped = r.repo === 'xeno-platform' ? (c.sha && deployed.has(c.sha)) : (at != null && lastRelease != null && at <= lastRelease);
      const cur = features.get(f.slug) || { slug: f.slug, title: f.title, repo: r.repo, area: f.slug.split(':')[1] || null, derived: f.derived, first: at, last: at, live: false };
      if (at != null) { cur.first = cur.first == null ? at : Math.min(cur.first, at); cur.last = cur.last == null ? at : Math.max(cur.last, at); }
      cur.live = cur.live || !!shipped;
      cur.derived = cur.derived && f.derived;
      features.set(f.slug, cur);
    };
    for (const c of r.prs || []) add({ kind: 'pr', externalId: c.number, title: c.title, url: c.url, author: c.author, sha: c.mergeSha, at: c.mergedAt, labels: c.labels, body: c.featureLine ? `Feature: ${c.featureLine}` : '' });
    for (const c of r.commits || []) add({ kind: 'commit', externalId: c.sha, title: c.title, url: c.url, author: c.author, sha: c.sha, at: c.at });
    for (const c of r.releases || []) add({ kind: 'release', externalId: c.tagName, title: c.name || c.tagName, url: c.url, sha: null, at: c.publishedAt });
    for (const c of r.tags || []) add({ kind: 'tag', externalId: c.name, title: c.name, sha: c.sha, at: c.at || null });
  }
  const evidenceFor = (f) => f.repo === 'xeno-platform'
    ? 'grouped from PR titles by conventional-commit scope; live = a change is in the last OK platform deploy (.deploy/deploy.log)'
    : 'grouped from PR titles by conventional-commit scope; live = a change predates a published GitHub release of the repo';
  return {
    features: [...features.values()].map((f) => ({
      slug: f.slug, title: f.title, repo: f.repo, area: f.area, status: f.live ? 'live' : 'built',
      provenance: f.derived ? 'derived' : 'recorded', evidence: f.derived ? evidenceFor(f) : null,
      firstChangeAt: f.first != null ? new Date(f.first).toISOString() : null, lastChangeAt: f.last != null ? new Date(f.last).toISOString() : null,
    })),
    changes,
  };
}

/** Counts per repo for the dry-run summary. */
export function countsByRepo(p, deploys = []) {
  const out = {};
  for (const c of p.changes) { const r = (out[c.repo] ||= { pr: 0, release: 0, tag: 0, commit: 0, attached: 0, features: 0 }); r[c.kind] += 1; if (c.featureSlug) r.attached += 1; }
  for (const f of p.features) (out[f.repo] ||= { pr: 0, release: 0, tag: 0, commit: 0, attached: 0, features: 0 }).features += 1;
  if (deploys.length) (out['xeno-platform'] ||= { pr: 0, release: 0, tag: 0, commit: 0, attached: 0, features: 0 }).deploys = deploys.length;
  return out;
}

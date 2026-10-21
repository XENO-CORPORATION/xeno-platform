/**
 * The internal release note's template — PURE and deterministic: the same deploy and the same facts always give the
 * same words. No model call, no I/O. Used by services/releaseInternalNotes.js at every deploy and by the history
 * backfill. Staff edit the result afterwards; this only writes the first draft.
 *
 * Input:
 *   deploy   {service, sha, previousSha, mode, status, prs[], migrations[], rollbackPoint, healthcheck}
 *   sources  {prs: [{number, title, body, url, files[]}], migrations: [{name, down}], env: {added[], removed[]}, collectedBy}
 *   features [{slug, title, status}]   — features the shipped PRs are attached to in the release record
 *
 * Output: {summary, why, features, migrations, risks, switches, tests, rollback} — plain text per section.
 */

export const SECTIONS = [
  ['summary', 'What changed'],
  ['why', 'Why'],
  ['features', 'Features touched'],
  ['migrations', 'Migrations and their down path'],
  ['risks', 'Risks'],
  ['switches', 'Switched on or off'],
  ['tests', 'Tests that prove it'],
  ['rollback', 'How to roll back'],
];
export const SECTION_KEYS = SECTIONS.map(([k]) => k);
export const SECTION_MAX = 8000;

const GATES = { backend: '/api/ready', 'chat-workers': 'internal /ready/semantic', frontend: '/health' };
const clip = (s, n) => { const t = String(s || '').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const noise = (l) => /^🤖 Generated with|^Co-Authored-By:|^<!--|^-->$/i.test(l.trim());

/** A PR body split by markdown headings (`#…` or a line that is only `**bold**`). The text before the first is ''. */
export function bodySections(body) {
  const out = [{ heading: '', lines: [] }];
  for (const raw of String(body || '').replace(/\r\n/g, '\n').split('\n')) {
    if (noise(raw)) continue;
    const h = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(raw) || /^\s*\*\*([^*]{2,80})\*\*:?\s*$/.exec(raw);
    if (h) { out.push({ heading: h[1].replace(/[*_`:]/g, '').trim(), lines: [] }); continue; }
    out[out.length - 1].lines.push(raw);
  }
  return out.map((s) => ({ heading: s.heading, text: s.lines.join('\n').trim() })).filter((s) => s.heading || s.text);
}
const firstParagraph = (t) => String(t || '').split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^[-*|>]/.test(p)) || '';
const pick = (secs, re) => secs.filter((s) => re.test(s.heading)).map((s) => s.text).filter(Boolean);
const bulletLines = (t) => String(t || '').split('\n').map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim()).filter(Boolean);

/** Why a PR was made: its Why/Summary/Context section, else the text before the first heading. */
export function whyOf(pr) {
  const secs = bodySections(pr.body);
  const named = pick(secs, /\b(why|summary|context|motivation|problem|background)\b/i);
  const lead = secs.find((s) => !s.heading)?.text || '';
  return clip(oneLine(firstParagraph(named[0] || lead || '')), 600);
}

const TEST_LINE = /npm run (?:test|proof|smoke|ci:local)[\w:-]*|node (?:--test )?\S*\.test\.mjs|\S*-test\.mjs|\bmutation[- ]check/i;
const TEST_FILE = /(^|\/)tests?\/|\.test\.(?:m?js|ts)$|-test\.mjs$|mutation-check/i;
/** Tests a PR names (its Test/Proof/Verification section and any line naming a test command) and test files it touched. */
export function testsOf(pr) {
  const secs = bodySections(pr.body);
  const fromHeading = pick(secs, /\b(test|tests|testing|proof|proven|verif\w*|evidence|gates?)\b/i).flatMap(bulletLines);
  const fromLines = String(pr.body || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => TEST_LINE.test(l)).map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''));
  const files = (pr.files || []).filter((f) => TEST_FILE.test(f));
  const lines = [...new Set([...fromHeading, ...fromLines].map((l) => clip(oneLine(l), 240)))].slice(0, 12);
  return { lines, files: [...new Set(files)].sort().slice(0, 30) };
}

const RISK_HEAD = /\b(risks?|caveats?|not built|known|limitations?|watch|open|follow[- ]?ups?|breaking)\b/i;
/** Risks a PR states: a Risk/Caveat/Not built/Limitations section, and any ⚠️ line. */
export function risksOf(pr) {
  const secs = bodySections(pr.body);
  const head = pick(secs, RISK_HEAD).flatMap(bulletLines);
  const warn = String(pr.body || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(?:[-*]\s*)?(?:⚠️|⚠|🔴|Risk:|Caveat:)/u.test(l));
  return [...new Set([...head, ...warn].map((l) => clip(oneLine(l.replace(/^[-*]\s*/, '')), 300)))].slice(0, 10);
}

/** Lines of a PR body that switch something: an UPPER_SNAKE env name next to on/off words, or `NAME=value`. */
export function switchesOf(pr) {
  return [...new Set(String(pr.body || '').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/.test(l) && (/\b(flag|env|switch|enable[ds]?|disable[ds]?|turn(?:s|ed)? (?:on|off)|set|unset|gate)\b/i.test(l) || /\b[A-Z][A-Z0-9_]+=\S/.test(l)))
    .map((l) => clip(oneLine(l.replace(/^[-*]\s*/, '')), 240)))].slice(0, 10);
}

/** A migration's down path, described from its `-- DOWN` section. */
export function downPathOf(name, text) {
  if (text == null) return { name, down: 'unknown', detail: 'the file was not available when this was drafted' };
  const m = /^\s*--\s*DOWN\b[^\n]*\n([\s\S]*)$/im.exec(String(text));
  const body = m ? m[1].split('\n').filter((l) => l.trim() && !/^\s*--/.test(l)).join(' ') : '';
  if (!body.trim()) return { name, down: 'none', detail: 'forward-only: no DOWN section; reversing it needs a new corrective migration' };
  const guarded = /RAISE EXCEPTION[^;]*refus/i.test(body);
  return { name, down: guarded ? 'guarded' : 'present', detail: clip(oneLine(body), 280) + (guarded ? ' (refuses when data would be lost)' : '') };
}

/** Env names added or removed by a unified diff (`git diff -U0`): process.env.X, compose `- X=`/`X:` and .env lines. */
export function envChangesFromDiff(diff) {
  const added = new Set(), removed = new Set();
  const re = [/process\.env\.([A-Z][A-Z0-9_]{2,})/g, /^[+-]\s*-?\s*([A-Z][A-Z0-9_]{2,})\s*[:=]/g];
  for (const line of String(diff || '').split(/\r?\n/)) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)\s/.test(line)) continue;
    const names = new Set();
    for (const r of re) for (const m of line.matchAll(new RegExp(r.source, 'g'))) names.add(m[1]);
    for (const n of names) (line[0] === '+' ? added : removed).add(n);
  }
  // a name both added and removed was only moved or reformatted
  for (const n of [...added]) if (removed.has(n)) { added.delete(n); removed.delete(n); }
  return { added: [...added].sort(), removed: [...removed].sort() };
}

const list = (items, empty) => (items.length ? items.map((l) => `- ${l}`).join('\n') : empty);

/** The first draft of a deploy's internal note. Deterministic: same input, same words. */
export function buildInternalNote({ deploy, sources = {}, features = [] }) {
  const d = deploy || {};
  const prs = [...(sources.prs || [])].sort((a, b) => a.number - b.number);
  const known = new Set(prs.map((p) => p.number));
  const missing = (d.prs || []).filter((n) => !known.has(n)).sort((a, b) => a - b);
  const range = d.previousSha ? `${d.previousSha}..${d.sha}` : `${d.sha} (no earlier recorded deploy of ${d.service}, so the range is unknown)`;
  const result = d.status === 'ok' ? (d.mode === 'build-only' ? 'built, not swapped' : 'deployed and passed its healthcheck') : d.status === 'failed' ? 'FAILED — the previous container kept serving' : 'interrupted';

  const summary = [
    `${d.service} @ ${d.sha} — ${result}. Range ${range}.`,
    `${prs.length + missing.length} pull request(s), ${(d.migrations || []).length} migration(s).`,
    '',
    list(prs.map((p) => `#${p.number} ${oneLine(p.title)}`).concat(missing.map((n) => `#${n} (title not collected)`)), '- No pull requests between this deploy and the previous one.'),
  ].join('\n');

  const why = list(prs.map((p) => `#${p.number}: ${whyOf(p) || 'the PR body gives no reason — ask its author'}`), '- Nothing shipped, so nothing to explain.');

  const slugLines = [...new Set(prs.map((p) => (/^\s*Feature:\s*([a-z0-9][a-z0-9._:-]{0,119})\s*$/im.exec(p.body || '') || [])[1]).filter(Boolean))];
  const featureLines = [...features].sort((a, b) => String(a.slug).localeCompare(String(b.slug))).map((f) => `${f.title} (${f.slug}) — ${f.status}`);
  for (const s of slugLines) if (!features.some((f) => f.slug === s)) featureLines.push(`${s} — named by a PR, not yet in the release record`);
  const featuresText = list(featureLines, '- No feature in the release record is linked to these PRs yet.');

  const migText = sources.migrations && sources.migrations.length ? sources.migrations : (d.migrations || []).map((name) => ({ name, text: null }));
  const downs = migText.map((m) => (m.down && typeof m.down === 'object' ? m.down : downPathOf(m.name, m.text))).sort((a, b) => a.name.localeCompare(b.name));
  const migrations = list(downs.map((m) => `${m.name} — down path: ${m.down}. ${m.detail}`), '- None. No schema change in this deploy.');

  const risks = [];
  for (const m of downs) if (m.down === 'none') risks.push(`${m.name} has no down path: rolling back the code leaves the schema change in place.`);
  if (downs.length) risks.push('Schema changed: the rollback image must still run against the migrated schema.');
  const env = sources.env || { added: [], removed: [] };
  if ((env.removed || []).length) risks.push(`Configuration names removed from the code or compose file: ${env.removed.join(', ')} — check nothing still sets or needs them.`);
  if (d.status !== 'ok') risks.push(`This deploy ${d.status === 'failed' ? 'failed' : 'was interrupted'}; read the deploy log before trusting the running version.`);
  for (const p of prs) for (const r of risksOf(p)) risks.push(`#${p.number}: ${r}`);
  if (missing.length) risks.push(`PR text was not collected for ${missing.map((n) => '#' + n).join(', ')}: this note is incomplete for them.`);
  const risksText = list([...new Set(risks)], '- None stated by the PRs and none detected.');

  const sw = [];
  if ((env.added || []).length) sw.push(`New configuration read: ${env.added.join(', ')}`);
  if ((env.removed || []).length) sw.push(`Configuration no longer read: ${env.removed.join(', ')}`);
  for (const p of prs) for (const s of switchesOf(p)) sw.push(`#${p.number}: ${s}`);
  const switches = list([...new Set(sw)], '- Nothing switched on or off that the diff or the PRs show.') + (sources.env ? '' : '\n(The configuration diff was not collected.)');

  const tl = [];
  for (const p of prs) {
    const t = testsOf(p);
    for (const l of t.lines) tl.push(`#${p.number}: ${l}`);
    if (t.files.length) tl.push(`#${p.number} touched: ${t.files.join(', ')}`);
  }
  const tests = list([...new Set(tl)], '- The PRs name no test and touched no test file. Treat this deploy as unproven.');

  const gate = GATES[d.service] || 'its healthcheck';
  const rollback = [
    `Rollback point: ${d.rollbackPoint || 'not recorded'}${d.previousSha ? ` (was serving ${d.previousSha})` : ''}.`,
    `1. node scripts/deploy-platform.mjs ${d.service} --rollback --execute — retags :rollback to :latest and recreates ${d.service}.`,
    `2. Check ${gate} answers, then the release console shows the rollback.`,
    downs.length ? `3. Schema: ${downs.map((m) => `${m.name} (${m.down === 'none' ? 'forward-only — write a corrective migration' : m.down === 'unknown' ? 'down path unknown — read the file' : 'has a DOWN section; run it only if the old code cannot read the new schema'})`).join('; ')}.` : '3. No migration to undo.',
  ].join('\n');

  const cap = (s) => clip(s, SECTION_MAX);
  return { summary: cap(summary), why: cap(why), features: cap(featuresText), migrations: cap(migrations), risks: cap(risksText), switches: cap(switches), tests: cap(tests), rollback: cap(rollback) };
}

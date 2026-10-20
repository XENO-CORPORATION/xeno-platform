#!/usr/bin/env node
/**
 * `npm run parity` — the platform agent/person parity gate (XENO AGENT CAPABILITY - SPEC.md §12.2, §19.4).
 *
 * The owner, 2026-10-19: agents must be able to use the whole platform, "and all the features we are missing we
 * should build it". That sentence only stays true if a new feature cannot land without deciding its agent story.
 * So: every action a person can take is DERIVED from the code (never a hand list), and every one must carry a
 * decision in src/server/capabilities/parity-ledger.json:
 *
 *   capability : an agent can do it today — names a declaration in the capability catalogue
 *   planned    : an acknowledged gap — the DEBT, owned by the action's division; that list is the backlog
 *   excluded   : deliberately never agent-callable — one of EXCLUSION_CATEGORIES, with a reason
 *   (missing)  : FAILS
 *
 * The actions:
 *   route:<file>:<METHOD> <path>     every Express route in src/server/routes/*.js
 *   ui:<file>:data-<attr>[=<value>]  every click-delegated data-* action in prototypes/xeno-workspace/*.js —
 *                                    an attribute is an action when the file dispatches on it with
 *                                    closest('[data-<attr>]'); each literal value is its own action
 *
 * It also fails when a ledger entry names an action that no longer exists (a stale decision is a lie about the
 * product), a capability the catalogue does not declare, a file with no division, or when the generated
 * docs/AGENT-PARITY-DEBT.md is out of date.
 *
 *   npm run parity              the gate
 *   npm run parity -- --write   regenerate docs/AGENT-PARITY-DEBT.md
 *   npm run parity -- --json    coverage numbers as JSON
 *   npm run parity -- --seed    record every undecided action as `planned` (explicit, reviewed in the diff)
 *   npm run parity -- --classify  fill a missing `class` / `scope` / `because` with the derived default (reviewed in the diff)
 *   npm run parity -- --report    regenerate docs/AGENT-WORKSPACE-SURFACE-REPORT.md (XENO WORKSPACE AGENT SURFACE - SPEC.md P0)
 *
 * Every entry also carries (SPEC P0): `class` (safe | reversible | irreversible | external — §4 reversibility),
 * `scope` (the xeno-workspace area scope an agent would need, or "none" for an exclusion) and, for an exclusion,
 * `because`. The owning division corrects a derived default by editing the entry.
 *
 * Dependency-free: it reads source as text and the catalogue's committed snapshot.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_CLASSES, WORKSPACE_SCOPES, DIVISION_AREA, scopeFor, ledgerClassOf } from '../src/server/capabilities/scopes.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES = join(ROOT, 'src', 'server', 'routes');
const UI = join(ROOT, 'prototypes', 'xeno-workspace');
const LEDGER = join(ROOT, 'src', 'server', 'capabilities', 'parity-ledger.json');
const SNAPSHOT = join(ROOT, 'src', 'server', 'capabilities', 'catalogue.snapshot.json');
const DEBT_DOC = join(ROOT, 'docs', 'AGENT-PARITY-DEBT.md');
const REPORT_DOC = join(ROOT, 'docs', 'AGENT-WORKSPACE-SURFACE-REPORT.md');

/** The only reasons an action may be withheld from agents permanently. */
export const EXCLUSION_CATEGORIES = Object.freeze({
  'unauthenticated': 'reachable without a signed-in person (public pages, health, sign-in itself)',
  'protocol': 'a transport or protocol endpoint (OAuth, MCP transport, provider webhooks), not an action',
  'service': 'service-to-service: called by another XENO service with a service credential, never by a person',
  'self-authority': 'mints or widens the caller’s own authority (keys, sessions, grants) — an agent must not',
  'view-state': 'changes only what this screen shows (navigation, tabs, sort, theme, open/close)',
  'covered-by': 'the same action as another entry, named in `of`',
});

// ───────────────────────────── extraction (derived from the code)

const METHOD_CALL = /^\s*([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|all)\(\s*(\[[^\]]*\]|(['"`])([^'"`]*)\4)/gm;
export function routesOf(file, src) {
  const out = [];
  for (const m of src.matchAll(METHOD_CALL)) {
    const [, recv, method, raw] = m;
    if (/^(res|req|app|map|cache|axios|client|http|redis|db|pool|fetch)$/i.test(recv)) continue;
    const paths = raw.startsWith('[') ? [...raw.matchAll(/['"`]([^'"`]*)['"`]/g)].map((x) => x[1]) : [m[5]];
    for (const p of paths) out.push(`route:${file}:${method.toUpperCase()} ${p}${recv === 'router' ? '' : ` (${recv})`}`);
  }
  return out;
}

export function uiActionsOf(file, src) {
  const attrs = new Set([...src.matchAll(/closest\(\s*'\[data-([a-z0-9-]+)\]'\s*\)/g)].map((m) => m[1]));
  const out = new Set();
  for (const a of attrs) {
    const literals = new Set();
    const re = new RegExp(`data-${a.replace(/-/g, '\\-')}="([^"$<>{}]*)"`, 'g');
    for (const m of src.matchAll(re)) if (m[1] && !m[1].includes('${')) literals.add(m[1]);
    if (literals.size) for (const v of literals) out.add(`ui:${file}:data-${a}=${v}`);
    else out.add(`ui:${file}:data-${a}`);
  }
  return [...out];
}

export function extract(root = ROOT) {
  const actions = new Map(); // id → file
  const rdir = join(root, 'src', 'server', 'routes'), udir = join(root, 'prototypes', 'xeno-workspace');
  for (const f of readdirSync(rdir).filter((x) => x.endsWith('.js')).sort()) for (const id of routesOf(f, readFileSync(join(rdir, f), 'utf8'))) actions.set(id, f);
  for (const f of readdirSync(udir).filter((x) => x.endsWith('.js')).sort()) for (const id of uiActionsOf(f, readFileSync(join(udir, f), 'utf8'))) actions.set(id, f);
  return actions;
}

// ───────────────────────────── the gate

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);

export function evaluate(actions, ledger, capabilityNames, capabilityScopes = null) {
  const problems = [];
  const decisions = ledger.actions || {};
  const divisions = ledger.divisions || {};
  const files = new Set(actions.values());
  for (const f of files) if (!divisions[f]) problems.push(`no division for ${f} — add it to "divisions" in the ledger`);
  for (const [id] of actions) if (!decisions[id]) problems.push(`undecided: ${id}`);
  for (const [id, d] of Object.entries(decisions)) {
    if (!actions.has(id)) { problems.push(`stale: ${id} is in the ledger but no longer in the code`); continue; }
    // P3 (XENO WORKSPACE AGENT SURFACE - SPEC.md): every decision carries its reversibility class and the scope it needs
    if (!LEDGER_CLASSES.includes(d.class)) problems.push(`${id}: class must be one of ${LEDGER_CLASSES.join(' | ')}`);
    if (d.status === 'excluded' ? d.scope !== 'none' && !WORKSPACE_SCOPES.includes(d.scope) : !WORKSPACE_SCOPES.includes(d.scope)) problems.push(`${id}: scope must be an approved xeno-workspace scope${d.status === 'excluded' ? ' or "none"' : ''}`);
    if (d.status === 'capability' && capabilityScopes) {
      const declared = [].concat(d.capability || []).filter((n) => capabilityScopes.has(n)).map((n) => capabilityScopes.get(n));
      if (declared.length && !declared.includes(d.scope)) problems.push(`${id}: scope ${d.scope} is not the declared scope of its capability (${[...new Set(declared)].join(', ')})`);
    }
    if (d.status === 'capability') {
      const names = [].concat(d.capability || []);
      if (!names.length) problems.push(`${id}: capability status names no capability`);
      for (const n of names) if (!capabilityNames.has(n)) problems.push(`${id}: capability ${n} is not declared in the catalogue`);
    } else if (d.status === 'excluded') {
      if (!EXCLUSION_CATEGORIES[d.category]) problems.push(`${id}: exclusion category "${d.category}" is not one of ${Object.keys(EXCLUSION_CATEGORIES).join(', ')}`);
      if (d.category === 'covered-by' && !decisions[d.of]) problems.push(`${id}: covered-by names ${d.of}, which has no decision`);
      if (!d.because) problems.push(`${id}: an exclusion needs a because`);
    } else if (d.status !== 'planned') problems.push(`${id}: status must be capability | planned | excluded`);
  }
  return problems;
}

export function coverage(actions, ledger) {
  const per = {};
  for (const [id, file] of actions) {
    const div = (ledger.divisions || {})[file] || '(none)';
    const d = (ledger.actions || {})[id] || { status: 'missing' };
    const row = (per[div] ||= { actions: 0, capability: 0, planned: 0, excluded: 0, missing: 0 });
    row.actions++; row[d.status]++;
  }
  for (const r of Object.values(per)) { const owed = r.actions - r.excluded; r.coverage = owed ? Math.round((r.capability / owed) * 1000) / 10 : 100; }
  return per;
}

export function debtDoc(actions, ledger) {
  const per = coverage(actions, ledger);
  const t = Object.values(per).reduce((a, r) => { for (const k of ['actions', 'capability', 'planned', 'excluded']) a[k] += r[k]; return a; }, { actions: 0, capability: 0, planned: 0, excluded: 0 });
  const owed = t.actions - t.excluded;
  const L = ['# Agent parity debt — the XENO platform', '', '> GENERATED by `npm run parity -- --write` from the code and `src/server/capabilities/parity-ledger.json`. Do not edit by hand; `npm run parity` fails when this file is stale.', '',
    'Every action a person can take on the platform, and whether an agent can take it (XENO AGENT CAPABILITY - SPEC.md §19.4). **Planned** entries are the owning division’s backlog: each is a feature agents are missing.', '',
    `**Total:** ${t.actions} actions · ${t.capability} agent capability · ${t.planned} planned (debt) · ${t.excluded} excluded · **coverage ${owed ? Math.round((t.capability / owed) * 1000) / 10 : 100}%** of the ${owed} owed.`, '',
    '| division | actions | capability | planned (debt) | excluded | coverage |', '|---|---:|---:|---:|---:|---:|'];
  for (const [div, r] of Object.entries(per).sort((a, b) => b[1].planned - a[1].planned || a[0].localeCompare(b[0]))) L.push(`| ${div} | ${r.actions} | ${r.capability} | ${r.planned} | ${r.excluded} | ${r.coverage}% |`);
  const byDiv = {};
  for (const [id, file] of actions) { const d = (ledger.actions || {})[id]; if (d && d.status === 'planned') (byDiv[(ledger.divisions || {})[file]] ||= []).push(id); }
  for (const div of Object.keys(byDiv).sort()) {
    L.push('', `## ${div} — ${byDiv[div].length} planned`, '');
    for (const id of byDiv[div].sort()) { const note = ledger.actions[id].note; L.push(`- \`${id}\`${note ? ` — ${note}` : ''}`); }
  }
  return L.join('\n') + '\n';
}


// ───────────────────────────── P0: class, scope, because (XENO WORKSPACE AGENT SURFACE - SPEC.md)

/** Route files whose writes reach a third party (a payment provider, a mail provider): `external`, never just reversible. */
export const EXTERNAL_FILES = Object.freeze(new Set(['billingRoutes.js', 'accountGiftRoutes.js', 'emailRoutes.js', 'paymentRoutes.js']));

/** The derived default class of an action — what --classify writes when the division has not decided. */
export function defaultClass(id, decision, file, capClasses = new Map()) {
  if (decision && decision.status === 'capability') {
    const cls = [].concat(decision.capability || []).map((n) => ledgerClassOf(capClasses.get(n))).filter(Boolean);
    for (const c of ['external', 'irreversible', 'reversible', 'safe']) if (cls.includes(c)) return c;
  }
  if (decision && decision.status === 'excluded' && decision.category === 'view-state') return 'safe';
  const m = /:(GET|HEAD|POST|PUT|PATCH|DELETE|ALL) /.exec(id);
  if (!m) return 'reversible';                                       // a UI action that changes something
  if (m[1] === 'GET' || m[1] === 'HEAD') return 'safe';
  if (EXTERNAL_FILES.has(file)) return 'external';
  return m[1] === 'DELETE' ? 'irreversible' : 'reversible';
}

/** Fill every missing class/scope/because. Returns how many fields it wrote. */
export function classify(actions, ledger, capClasses = new Map()) {
  let n = 0;
  for (const [id, file] of actions) {
    const d = ledger.actions[id]; if (!d) continue;
    if (!d.class) { d.class = defaultClass(id, d, file, capClasses); n++; }
    if (!d.scope) { d.scope = d.status === 'excluded' ? 'none' : scopeFor(DIVISION_AREA[(ledger.divisions || {})[file]] || 'workspace', d.class); n++; }
    if (d.status === 'excluded' && !d.because) { d.because = d.reason || EXCLUSION_CATEGORIES[d.category]; delete d.reason; n++; }
    if (d.status === 'excluded' && d.reason && d.because) { delete d.reason; }
  }
  return n;
}

/** The divisions the owner reviews first, in the spec's order; the rest follow by debt. */
const REPORT_ORDER = ['storage', 'studio', 'tasks', 'chat', 'agents', 'commerce', 'workspace', 'places', 'forum'];

/** docs/AGENT-WORKSPACE-SURFACE-REPORT.md — generated from the ledger, never edited by hand. */
export function surfaceReport(actions, ledger) {
  const per = {};
  for (const [id, file] of actions) {
    const div = (ledger.divisions || {})[file] || '(none)';
    const d = (ledger.actions || {})[id] || { status: 'missing' };
    const r = (per[div] ||= { actions: 0, capability: 0, planned: 0, excluded: 0, missing: 0, classes: {}, scopes: {} });
    r.actions++; r[d.status] = (r[d.status] || 0) + 1;
    if (d.class) r.classes[d.class] = (r.classes[d.class] || 0) + 1;
    if (d.status === 'planned' && d.scope) r.scopes[d.scope] = (r.scopes[d.scope] || 0) + 1;
  }
  const order = [...REPORT_ORDER.filter((d) => per[d]), ...Object.keys(per).filter((d) => !REPORT_ORDER.includes(d)).sort((a, b) => per[b].planned - per[a].planned || a.localeCompare(b))];
  const L = ['# Workspace agent surface — inventory report', '', '> GENERATED by `npm run parity -- --report` from `src/server/capabilities/parity-ledger.json` (XENO WORKSPACE AGENT SURFACE - SPEC.md P0). Do not edit by hand; `npm run parity` fails when it is stale. A wrong `class` or `scope` is corrected in the ledger entry by the owning division.', '',
    'Per division: how many actions a person can take, how many an agent can take today, how many are planned (the debt P5 pays down), the reversibility class of each (§4) and the `xeno-workspace` scope the planned ones will need.', '',
    '| division | actions | capability | planned | excluded | safe | reversible | irreversible | external | planned by scope |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|'];
  for (const div of order) {
    const r = per[div], c = r.classes;
    const sc = Object.entries(r.scopes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `\`${k}\` ${v}`).join(', ') || '—';
    L.push(`| ${div} | ${r.actions} | ${r.capability} | ${r.planned} | ${r.excluded} | ${c.safe || 0} | ${c.reversible || 0} | ${c.irreversible || 0} | ${c.external || 0} | ${sc} |`);
  }
  L.push('', `Scopes (one-way names, approved 2026-10-20): ${WORKSPACE_SCOPES.map((s) => `\`${s}\``).join(', ')}.`, '');
  return L.join('\n');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const actions = extract();
  const ledger = readJson(LEDGER, { divisions: {}, actions: {} });
  const snapshot = readJson(SNAPSHOT, { capabilities: [] });
  const caps = new Set(snapshot.capabilities.map((c) => c.name));
  if (args.has('--seed')) {
    let n = 0;
    for (const [id] of actions) if (!ledger.actions[id]) { ledger.actions[id] = { status: 'planned' }; n++; }
    ledger.actions = Object.fromEntries(Object.entries(ledger.actions).filter(([id]) => actions.has(id)).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + '\n');
    console.log(`seeded ${n} undecided actions as planned`);
  }
  if (args.has('--classify')) {
    const capClasses = new Map(snapshot.capabilities.map((c) => [c.name, c.class]));
    const n = classify(actions, ledger, capClasses);
    writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + '\n');
    console.log(`classified: wrote ${n} fields`);
  }
  if (args.has('--json')) { console.log(JSON.stringify(coverage(actions, ledger), null, 2)); return; }
  const doc = debtDoc(actions, ledger);
  if (args.has('--write') || args.has('--seed')) { writeFileSync(DEBT_DOC, doc); console.log(`wrote ${DEBT_DOC}`); }
  const problems = evaluate(actions, ledger, caps, new Map(snapshot.capabilities.filter((c) => c.scope).map((c) => [c.name, c.scope])));
  const report = surfaceReport(actions, ledger);
  if (args.has('--report') || args.has('--write') || args.has('--classify')) { writeFileSync(REPORT_DOC, report); console.log(`wrote ${REPORT_DOC}`); }
  if (!existsSync(REPORT_DOC) || readFileSync(REPORT_DOC, 'utf8').replace(/\r\n/g, '\n') !== report) problems.push('docs/AGENT-WORKSPACE-SURFACE-REPORT.md is stale — run npm run parity -- --report');
  if (!existsSync(DEBT_DOC) || readFileSync(DEBT_DOC, 'utf8').replace(/\r\n/g, '\n') !== doc) problems.push('docs/AGENT-PARITY-DEBT.md is stale — run npm run parity -- --write');
  const per = coverage(actions, ledger);
  const t = Object.values(per).reduce((a, r) => { a.n += r.actions; a.c += r.capability; a.p += r.planned; a.e += r.excluded; return a; }, { n: 0, c: 0, p: 0, e: 0 });
  console.log(`parity: ${t.n} actions · ${t.c} capability · ${t.p} planned (debt) · ${t.e} excluded`);
  if (problems.length) { console.error(`parity FAILED (${problems.length}):\n  ${problems.slice(0, 60).join('\n  ')}${problems.length > 60 ? `\n  … ${problems.length - 60} more` : ''}`); process.exit(1); }
  console.log('parity OK — every action has a decision');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

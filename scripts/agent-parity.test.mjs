// Mutation checks for the platform parity gate: each test removes one protection and proves the gate notices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { extract, evaluate, routesOf, uiActionsOf, coverage } from './agent-parity.mjs';
import { WORKSPACE_SCOPES } from '../src/server/capabilities/scopes.js';

const ledger = JSON.parse(readFileSync(new URL('../src/server/capabilities/parity-ledger.json', import.meta.url)));
const snap = JSON.parse(readFileSync(new URL('../src/server/capabilities/catalogue.snapshot.json', import.meta.url)));
const caps = new Set(snap.capabilities.map((c) => c.name));
const real = extract();

test('the real platform passes: every action has a decision', () => {
  assert.deepEqual(evaluate(real, ledger, caps), []);
  assert.ok(real.size > 900, `derived ${real.size} actions — extraction collapsed`);
});

test('the committed gate passes end to end (incl. the generated debt doc)', () => {
  execFileSync(process.execPath, [new URL('./agent-parity.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')], { stdio: 'pipe' });
});

test('MUTATION: a new undecided route fails the gate', () => {
  const root = mkdtempSync(join(tmpdir(), 'parity-'));
  mkdirSync(join(root, 'src', 'server', 'routes'), { recursive: true });
  mkdirSync(join(root, 'prototypes', 'xeno-workspace'), { recursive: true });
  writeFileSync(join(root, 'src', 'server', 'routes', 'newRoutes.js'), "router.get('/old', h);\nrouter.post('/brand-new', h);\n");
  writeFileSync(join(root, 'prototypes', 'xeno-workspace', 'ui.js'), "x.closest('[data-do]'); `<b data-do=\"save\">`");
  const actions = extract(root);
  const l = { divisions: { 'newRoutes.js': 'test', 'ui.js': 'test' }, actions: { 'route:newRoutes.js:GET /old': { status: 'planned', class: 'safe', scope: 'storage:read' }, 'ui:ui.js:data-do=save': { status: 'planned', class: 'reversible', scope: 'storage:write' } } };
  const p = evaluate(actions, l, caps);
  assert.deepEqual(p, ['undecided: route:newRoutes.js:POST /brand-new']);
});

test('MUTATION: an undecided UI action, a stale entry, an undeclared capability and a bad exclusion all fail', () => {
  const actions = new Map([['ui:a.js:data-x=go', 'a.js'], ['route:a.js:GET /', 'a.js']]);
  const p = evaluate(actions, { divisions: { 'a.js': 'd' }, actions: {
    'route:a.js:GET /': { status: 'capability', capability: 'tasks.task.nope' },
    'route:a.js:GET /gone': { status: 'planned' },
  } }, caps);
  assert.ok(p.includes('undecided: ui:a.js:data-x=go'));
  assert.ok(p.some((x) => x.includes('stale: route:a.js:GET /gone')));
  assert.ok(p.some((x) => x.includes('tasks.task.nope is not declared')));
  const q = evaluate(new Map([['route:a.js:GET /', 'a.js']]), { divisions: { 'a.js': 'd' }, actions: { 'route:a.js:GET /': { status: 'excluded', category: 'too-hard' } } }, caps);
  assert.ok(q.some((x) => x.includes('not one of')));
  assert.ok(q.some((x) => x.includes('needs a because')));
});

test('MUTATION: a file with no division fails', () => {
  const p = evaluate(new Map([['route:z.js:GET /', 'z.js']]), { divisions: {}, actions: { 'route:z.js:GET /': { status: 'planned' } } }, caps);
  assert.ok(p.some((x) => x.startsWith('no division for z.js')));
});

test('extraction reads array paths, other routers, and literal UI values', () => {
  assert.deepEqual(routesOf('f.js', "router.post(['/a', '/b'], h);\nmanagement.get('/c', h);\nres.get('x');"), ['route:f.js:POST /a', 'route:f.js:POST /b', 'route:f.js:GET /c (management)']);
  assert.deepEqual(uiActionsOf('u.js', "e.closest('[data-act]'); '<i data-act=\"one\"></i><i data-act=\"${v}\"></i>'").sort(), ['ui:u.js:data-act=one']);
  assert.deepEqual(uiActionsOf('u.js', "e.closest('[data-dyn]'); `<i data-dyn=\"${v}\"></i>`"), ['ui:u.js:data-dyn']);
});

test('coverage counts capabilities against what is owed (excluded is not owed)', () => {
  const c = coverage(new Map([['a', 'f'], ['b', 'f'], ['c', 'f']]), { divisions: { f: 'd' }, actions: { a: { status: 'capability' }, b: { status: 'planned' }, c: { status: 'excluded' } } });
  assert.equal(c.d.coverage, 50);
});

test('P0: --classify derives class and scope, moves reason to because, and the report is generated from the ledger', async () => {
  const { classify, surfaceReport, defaultClass } = await import('./agent-parity.mjs');
  const actions = new Map([['route:libraryRoutes.js:GET /folders', 'libraryRoutes.js'], ['route:libraryRoutes.js:DELETE /folders/:id', 'libraryRoutes.js'], ['route:billingRoutes.js:POST /checkout', 'billingRoutes.js'], ['route:authRoutes.js:GET /x', 'authRoutes.js']]);
  const l = { divisions: { 'libraryRoutes.js': 'storage', 'billingRoutes.js': 'commerce', 'authRoutes.js': 'account' }, actions: {
    'route:libraryRoutes.js:GET /folders': { status: 'planned' }, 'route:libraryRoutes.js:DELETE /folders/:id': { status: 'planned' },
    'route:billingRoutes.js:POST /checkout': { status: 'planned' }, 'route:authRoutes.js:GET /x': { status: 'excluded', category: 'unauthenticated', reason: 'before sign-in' } } };
  classify(actions, l);
  const pick = (id) => [l.actions[id].class, l.actions[id].scope];
  assert.deepEqual(pick('route:libraryRoutes.js:GET /folders'), ['safe', 'storage:read']);
  assert.deepEqual(pick('route:libraryRoutes.js:DELETE /folders/:id'), ['irreversible', 'storage:write']);
  assert.deepEqual(pick('route:billingRoutes.js:POST /checkout'), ['external', 'wallet:spend']);
  assert.equal(l.actions['route:authRoutes.js:GET /x'].because, 'before sign-in');
  assert.equal(l.actions['route:authRoutes.js:GET /x'].reason, undefined);
  assert.equal(defaultClass('ui:a.js:data-x=go', { status: 'planned' }, 'a.js'), 'reversible');
  assert.match(surfaceReport(actions, l), /\| storage \| 2 \| 0 \| 2 \| 0 \| 1 \| 0 \| 1 \| 0 \|/);
});

test('P0: the real ledger carries class and scope on every entry, and because on every exclusion', () => {
  for (const [id, d] of Object.entries(ledger.actions)) {
    assert.ok(['safe', 'reversible', 'irreversible', 'external'].includes(d.class), `${id}: class`);
    assert.ok(d.scope, `${id}: scope`);
    if (d.status === 'excluded') assert.ok(d.because, `${id}: because`);
  }
});

// ── P3: each rule proven by a mutation of the REAL ledger and catalogue (XENO WORKSPACE AGENT SURFACE - SPEC.md)
const capScopes = new Map(snap.capabilities.map((c) => [c.name, c.scope]));
const mutated = (fn) => { const l = JSON.parse(JSON.stringify(ledger)); fn(l); return evaluate(real, l, caps, capScopes); };
const firstWhere = (pred) => Object.keys(ledger.actions).find((id) => pred(ledger.actions[id]));

test('P3: the real ledger passes every P3 rule', () => {
  assert.deepEqual(evaluate(real, ledger, caps, capScopes), []);
});

test('P3 MUTATION: deleting one declaration turns its capability entry red', () => {
  const id = firstWhere((d) => d.status === 'capability');
  const name = [].concat(ledger.actions[id].capability)[0];
  const fewer = new Set([...caps].filter((n) => n !== name));
  const p = evaluate(real, ledger, fewer, capScopes);
  assert.ok(p.some((x) => x.includes(`${name} is not declared`)), p.slice(0, 3).join(' | '));
});

test('P3 MUTATION: a blank class, a blank or unknown scope, or a blank because each turn the gate red', () => {
  const id = firstWhere((d) => d.status === 'planned');
  const ex = firstWhere((d) => d.status === 'excluded');
  assert.ok(mutated((l) => { delete l.actions[id].class; }).some((x) => x.startsWith(`${id}: class`)));
  assert.ok(mutated((l) => { l.actions[id].class = 'maybe'; }).some((x) => x.startsWith(`${id}: class`)));
  assert.ok(mutated((l) => { delete l.actions[id].scope; }).some((x) => x.startsWith(`${id}: scope`)));
  assert.ok(mutated((l) => { l.actions[id].scope = 'none'; }).some((x) => x.startsWith(`${id}: scope`)), 'only an exclusion may need no scope');
  assert.ok(mutated((l) => { l.actions[id].scope = 'everything:*'; }).some((x) => x.startsWith(`${id}: scope`)));
  assert.ok(mutated((l) => { delete l.actions[ex].because; }).some((x) => x === `${ex}: an exclusion needs a because`));
});

test('P3 MUTATION: a capability entry whose scope disagrees with its declaration turns red', () => {
  const id = firstWhere((d) => d.status === 'capability' && [].concat(d.capability).length === 1);
  const other = WORKSPACE_SCOPES.find((s) => s !== ledger.actions[id].scope);
  assert.ok(mutated((l) => { l.actions[id].scope = other; }).some((x) => x.startsWith(`${id}: scope ${other} is not the declared scope`)));
});

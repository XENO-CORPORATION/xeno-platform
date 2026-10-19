// Mutation checks for the platform parity gate: each test removes one protection and proves the gate notices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { extract, evaluate, routesOf, uiActionsOf, coverage } from './agent-parity.mjs';

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
  const l = { divisions: { 'newRoutes.js': 'test', 'ui.js': 'test' }, actions: { 'route:newRoutes.js:GET /old': { status: 'planned' }, 'ui:ui.js:data-do=save': { status: 'planned' } } };
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
  assert.ok(q.some((x) => x.includes('needs a reason')));
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

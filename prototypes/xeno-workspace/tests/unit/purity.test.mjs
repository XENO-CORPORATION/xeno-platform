// The cores may not reach the browser. Two halves, and each is proven able to fail:
//   load  - a core runs in a bare context; a browser global referenced at load time throws there;
//   scan  - the source, with comments and quoted strings removed, has no browser global and no XENO_ identifier
//           (the one export line per core is exempt by exact pattern: plain identifiers only).
// Index order: each core is loaded by the page before its adapter.
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm'; import { fileURLToPath } from 'node:url';
import { loadCore } from './load-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORES = [['history-core.js', 'history.js'], ['select-core.js', 'select.js']].filter(([c]) => fs.existsSync(path.join(root, c)));
const FORBIDDEN = ['document', 'window', 'globalThis', 'self', 'navigator', 'localStorage', 'sessionStorage', 'location',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'MutationObserver', 'requestAnimationFrame', 'CustomEvent',
  'performance', 'fetch', 'console', 'Date', 'structuredClone', 'URL', 'URLSearchParams', 'eval', 'Function'];
const EXPORT_LINE = /^\s*root\.XENO_(HIST|SEL)_CORE = \{[\w, ]*\};\s*$/;

// Removes // and /* */ comments and the contents of '...' and "..." strings. Newlines survive, so line numbers hold.
// Template literals are kept, so a ${...} inside one is still scanned.
export function stripCommentsAndStrings(src) {
  let out = '', i = 0; const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') {
      const start = i; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2; out += src.slice(start, i).replace(/[^\n]/g, ' '); continue;
    }
    if (c === "'" || c === '"') { i += 1; while (i < n && src[i] !== c) { if (src[i] === '\\') i += 1; i += 1; } i += 1; out += '""'; continue; }
    out += c; i += 1;
  }
  return out;
}

// The hits in a source: forbidden browser globals as whole words, and XENO_ identifiers outside the export line.
export function scan(src) {
  const hits = [];
  const code = stripCommentsAndStrings(src).split('\n');
  const raw = src.split('\n');
  code.forEach((line, idx) => {
    if (EXPORT_LINE.test(raw[idx] ?? '')) return;
    for (const w of FORBIDDEN) if (new RegExp(`\\b${w}\\b`).test(line)) hits.push(`${w} (line ${idx + 1})`);
    if (/\bXENO_\w*/.test(line)) hits.push(`XENO_ identifier (line ${idx + 1})`);
  });
  return hits;
}

test('each core loads in a bare context with no browser', () => {
  assert.ok(CORES.length > 0, 'at least one core exists');
  for (const [core] of CORES) assert.doesNotThrow(() => loadCore(core), core);
});

test('each core is free of browser globals and of XENO_ identifiers (quoted strings and comments excluded)', () => {
  for (const [core] of CORES) {
    const hits = scan(fs.readFileSync(path.join(root, core), 'utf8'));
    assert.deepEqual(hits, [], `${core} reaches the browser`);
  }
});

test('the load half can fail: a browser global referenced at load time throws in the bare context', () => {
  const ctx = vm.createContext({});
  assert.throws(() => vm.runInContext('document.title = "x";', ctx), (e) => e.name === 'ReferenceError');
});

test('the scan half can fail: planted browser references and an unexempt XENO_ identifier are found', () => {
  assert.deepEqual(scan('const t = Date.now();').map((h) => h.split(' ')[0]), ['Date']);
  assert.deepEqual(scan('function f() { return document.body; }').map((h) => h.split(' ')[0]), ['document']);
  assert.deepEqual(scan('root.XENO_SEL_CORE_BAD = {};').map((h) => h.split(' ').slice(0, 2).join(' ')), ['XENO_ identifier']);
});

test('quoted strings and comments do not trip the scan, and line numbers survive a block comment', () => {
  assert.deepEqual(scan("const msg = 'open the document'; // console.log(Date.now())\n/* window\n spans lines */ const x = 1;"), []);
  assert.deepEqual(scan('/* a\n b\n c */\nconst t = Date.now();'), ['Date (line 4)']);
});

test('the export line is exempt only as written: plain identifiers, nothing else', () => {
  assert.deepEqual(scan('root.XENO_HIST_CORE = { createHistory, ago };'), []);
  assert.notDeepEqual(scan('root.XENO_HIST_CORE = { createHistory: window.x };'), []);
});

test('index order: each core is loaded before the adapter that uses it', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [core, adapter] of CORES) {
    const c = html.indexOf(`src="${core}"`), a = html.indexOf(`src="${adapter}"`);
    assert.ok(c >= 0, `${core} is loaded by index.html`);
    assert.ok(a >= 0, `${adapter} is loaded by index.html`);
    assert.ok(c < a, `${core} precedes ${adapter}`);
  }
});

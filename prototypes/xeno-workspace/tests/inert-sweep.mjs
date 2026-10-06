// Every visible control whose only behaviour is a placeholder toast, on every route — the frontend's remaining debt.
import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url'; import fs from 'node:fs';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms)); const ev = (f, ...a) => p.evaluate(f, ...a);
const src = fs.readFileSync(new URL('./pages-test.mjs', import.meta.url), 'utf8'); const routes = eval(src.slice(src.indexOf("['studio/g/projects'"), src.indexOf("];", src.indexOf("['studio/g/projects'")) + 1));
const extra = await (async () => { await p.goto(url); await wait(500); return ev(() => { const out = ['overview', 'adaptive']; for (const m of ['studio', 'office', 'social', 'corpo', 'dev', 'tools']) { out.push(m); for (const z of XW.zonesFor(m)) out.push(`${m}/z/${z.id}`); } for (const id of Object.keys(XW.PR)) out.push(`overview/p/${id}`); return out; }); })();
const all = [...new Set([...routes, ...extra])];
await p.setViewport({ width: 1440, height: 900 }); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });
const found = new Map();
for (const r of all) {
  await p.goto(url + '#/' + r.split('/').map(encodeURIComponent).join('/')); await p.reload(); await wait(650);
  const res = await ev(() => [...document.querySelectorAll('[data-toast]')].filter((n) => n.offsetParent || n.closest('#rail')).map((n) => ({ where: n.closest('#rail') ? 'rail' : n.closest('#panel') ? 'panel' : n.closest('.topbar,.pg-top') ? 'header' : n.closest('.mfoot') ? 'footer' : 'main', label: (n.getAttribute('aria-label') || n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50), toast: n.dataset.toast.slice(0, 70) })));
  for (const x of res) { const k = `${x.where} | ${x.label} → ${x.toast}`; if (!found.has(k)) found.set(k, new Set()); found.get(k).add(r); }
}
const rows = [...found.entries()].sort((a, b) => b[1].size - a[1].size);
console.log(`routes swept: ${all.length}   distinct toast-only controls: ${rows.length}   total placements: ${rows.reduce((n, [, s]) => n + s.size, 0)}\n`);
for (const [k, s] of rows) console.log(String(s.size).padStart(3), k, '   e.g.', [...s][0]);
// the gate: no placeholder on any route, and none left in the code (the sweep cannot reach every dialog)
const files = fs.readFileSync('index.html', 'utf8').match(/src="[^"]+\.js"/g).map((x) => x.slice(5, -1));
const codeHits = files.flatMap((f) => (fs.readFileSync(f, 'utf8').match(/data-toast="|opens in the real app|builder next|Prototype placeholder/g) || []).map((m) => `${f}: ${m}`));
console.log('code placeholders:', codeHits.length, codeHits.slice(0, 8));
const pass = rows.length === 0 && codeHits.length === 0 && !errs.length;
console.log(pass ? 'GATE PASS — no control on any route is a placeholder' : 'GATE FAIL', '| errors', errs.slice(0, 5)); await b.close(); process.exitCode = pass ? 0 : 1;

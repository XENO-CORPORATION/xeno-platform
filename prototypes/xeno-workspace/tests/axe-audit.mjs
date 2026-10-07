import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url'; import fs from 'node:fs';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const src = fs.readFileSync(new URL('./pages-test.mjs', import.meta.url), 'utf8'); const routes = eval(src.slice(src.indexOf("['studio/g/projects'"), src.indexOf("];", src.indexOf("['studio/g/projects'")) + 1));
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(url); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); });
const agg = {};
for (const r of (process.argv[2] ? [process.argv[2]] : routes)) { await p.goto(url + '#/' + r); await p.reload(); await wait(600); await p.evaluate(AXE);
  const res = await p.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, ex: v.nodes.slice(0, 2).map((x) => x.target.join(' ') + ' :: ' + (x.failureSummary || '').split('\n')[1]) })));
  for (const v of res) { const a = (agg[v.id] = agg[v.id] || { impact: v.impact, help: v.help, nodes: 0, pages: [], ex: v.ex }); a.nodes += v.n; a.pages.push(r); } }
fs.writeFileSync(new URL('./axe-report.json', import.meta.url), JSON.stringify(agg, null, 1));
for (const [id, a] of Object.entries(agg).sort((x, y) => y[1].nodes - x[1].nodes)) console.log(`${a.impact.padEnd(9)} ${id.padEnd(28)} ${String(a.nodes).padStart(5)} nodes on ${a.pages.length} pages — ${a.help}\n            e.g. ${a.ex[0]}`);
await b.close();

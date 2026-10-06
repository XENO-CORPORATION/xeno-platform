import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); }; const ev = (f) => p.evaluate(f);
for (const [W, H] of [[1920, 1080], [1440, 900], [1280, 720]]) {
  await p.setViewport({ width: W, height: H }); await p.goto(url); await ev(() => { localStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); });
  for (const r of ['overview/g/projects', 'overview/g/library', 'dev/z/agents', 'overview/g/workspace/Settings']) for (const want of ['open', 'closed']) {
    await p.goto(url + '#/' + r); await p.reload(); await wait(700);
    if ((await ev(() => document.documentElement.dataset.panel)) !== want) { await p.keyboard.down('Control'); await p.keyboard.press('Backslash'); await p.keyboard.up('Control'); await wait(500); }
    const panel = await ev(() => document.documentElement.dataset.panel);
    const g = await ev(() => { const R = (s) => document.querySelector(s)?.getBoundingClientRect(); const op = document.documentElement.dataset.panel === 'closed' ? document.querySelector('.pg-top .opener svg').getBoundingClientRect() : null; const top = R('.pg-top'), act = R('.pg-top-acts > :last-child'), cr = R('.pg-top .crumbs'), h1 = R('.pg h1') || R('.pg > :first-child'), bar = (R('.pg > .pg-tabs') || R('.pg > :first-child')), body = R('.pg-body'), foot = R('.mfoot'), fl = R('.mfoot > .sb-l'), fr = R('.mfoot > .sb-r'), mv = document.querySelector('.pg-mview');
      return { left: [Math.round(op ? op.left + 2 : cr.left), Math.round(h1.left), Math.round(fl ? fl.left : foot.left)], right: [act ? Math.round(act.right) : null, Math.round((bar || body).right), Math.round(fr.right)], headH: Math.round(top.height), footAtBottom: Math.round(foot.bottom - document.getElementById('main').getBoundingClientRect().bottom), sb: mv.offsetWidth - mv.clientWidth }; });
    const L = g.left.filter((x) => x != null), Rr = g.right.filter((x) => x != null);
    const lOk = Math.max(...L) - Math.min(...L) <= 2;
    ok(lOk && Math.max(...Rr) - Math.min(...Rr) <= 1 && g.headH === 46 && Math.abs(g.footAtBottom) <= 2, `${W}x${H} ${r} panel ${panel}: left edges ${g.left} · right edges ${g.right} · header ${g.headH}px · scrollbar strip ${g.sb}px`);
  }
}
// width does not change when content starts or stops scrolling
await p.setViewport({ width: 1440, height: 900 }); await p.goto(url + '#/overview/g/projects'); await p.reload(); await wait(700);
const w1 = await ev(() => document.querySelector('.pg-table').getBoundingClientRect().width);
await ev(() => document.querySelector('[data-pg-q="projects"]').focus()); await p.keyboard.type('zzzz'); await wait(100); await p.keyboard.press('Escape'); await wait(100);
await p.goto(url + '#/overview/g/library'); await p.reload(); await wait(700); const long = await ev(() => { const m = document.querySelector('.pg-mview'); return m.scrollHeight > m.clientHeight; });
await p.goto(url + '#/overview/g/projects'); await p.reload(); await wait(700); const w2 = await ev(() => document.querySelector('.pg-table').getBoundingClientRect().width);
await p.goto(url + '#/overview/g/library'); await p.reload(); await wait(700); const gl = await ev(() => document.querySelector('.pg-body').getBoundingClientRect().width);
await p.goto(url + '#/overview/g/library/Trash'); await p.reload(); await wait(700); const gs = await ev(() => document.querySelector('.pg-body').getBoundingClientRect().width);
ok(w1 === w2 && Math.abs(gl - gs) < 1 && long, `content width is identical on a long page (Library, scrolls: ${long}) and a short one (Trash): ${gl} vs ${gs}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5)); await b.close();

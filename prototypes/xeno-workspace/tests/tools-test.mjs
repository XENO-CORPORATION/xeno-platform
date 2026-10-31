import { shot } from './shot.mjs';
// Tools mode is real: the signed XENO tool packages from the registry, verified by the REAL /api/tools routes
// (services/toolPackages.js, against updates.xenostudio.ai) and mounted in the tool page with the web ToolHost.
//   1. Tools › Image lists the real tools, with whether each runs here or needs Hub for something
//   2. a tool opens at its id address (/workspace/tools/spaces/image/<tool id>) and a fresh tab lands on it
//   3. inside the frame the package actually mounts (its own React UI renders), from verified bytes only
//   4. a package whose bytes were changed is refused by the server and never runs
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import http from 'node:http';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const express = require(path.join(repo, 'src/server/node_modules/express'));
const { createServer } = await import('vite');
const toolsRoutes = (await import(path.join(repo, 'src/server/routes/toolsRoutes.js').replace(/\\/g, '/').replace(/^([A-Z]:)/, 'file:///$1'))).default;
const toolPkgs = await import(path.join(repo, 'src/server/services/toolPackages.js').replace(/\\/g, '/').replace(/^([A-Z]:)/, 'file:///$1'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };

// the real routes, in process
const api = express(); api.use('/api/tools', toolsRoutes);
const apiServer = http.createServer(api); await new Promise((r) => apiServer.listen(0, '127.0.0.1', r));
const apiBase = `http://127.0.0.1:${apiServer.address().port}`;
const PORT = 5219, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: path.join(repo, 'vite.config.ts'), root: repo, logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 120000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };

async function open(url) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => {
    const u = new URL(q.url());
    if (!u.pathname.startsWith('/api/')) return q.continue();
    if (u.pathname.startsWith('/api/tools')) {
      const r = await fetch(apiBase + u.pathname + u.search); const body = Buffer.from(await r.arrayBuffer());
      return q.respond({ status: r.status, contentType: r.headers.get('content-type') || 'application/octet-stream', body });
    }
    const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/artifacts' && u.searchParams.get('kind') === 'tool') return json({ artifacts: [{ id: 'a_mytool1', kind: 'tool', title: 'Logo export kit', description: 'Transparent PNG + SVG in three sizes', category: 'generator', currentRevision: 3, updatedAt: new Date().toISOString() }] });
    if (u.pathname === '/api/artifacts/a_mytool1') return json({ artifact: { id: 'a_mytool1', kind: 'tool', title: 'Logo export kit', currentRevision: 3 } });
    if (u.pathname === '/api/artifacts/a_mytool1/view-token' && q.method() === 'POST') return json({ viewToken: 't', revision: 3, frameUrl: '/a/a_mytool1/v/t/r/3/index.html' });
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    return json({ success: false, error: 'not found' }, 404);
  });
  await p.goto(base + url, { waitUntil: 'domcontentloaded' }); await wait(2500);
  return { p, errs };
}

try {
  const { p, errs } = await open('/workspace/#/tools/z/image');
  await wait(2000);
  const s0 = await p.evaluate(() => ({ page: document.querySelector('[data-tl-page]')?.dataset.tlPage, live: !!(window.XENO_ZONE_LIVE || {})['tools.image'], ids: [...document.querySelectorAll('[data-tl-open]')].map((x) => x.dataset.tlOpen) }));
  ok(s0.page === 'ready' && s0.live && s0.ids.includes('image-resize') && s0.ids.includes('asset-extractor'), `Tools › Image lists the real tools (${JSON.stringify(s0)})`);
  ok(await p.$('[data-tl-open="image-resize"][data-tl-runs="partly"]') !== null && await p.$('[data-tl-open="asset-extractor"][data-tl-runs="yes"]') !== null, 'each says whether it runs here or needs Hub for something');
  await p.click('[data-tl-open="asset-extractor"]'); await wait(1500);
  const url1 = await p.evaluate(() => location.pathname);
  ok(url1.endsWith('/tools/spaces/image/asset-extractor'), `it opens at its id address (${url1})`);
  const frame = async (pg) => { const h = await pg.$('[data-tl-frame]'); return h && h.contentFrame(); };
  let f = await frame(p); for (let i = 0; i < 20 && f && !(await f.$('[data-tool-mounted]')) && !(await f.$('[data-tool-error]')); i++) await wait(500);
  const mounted = f && await f.evaluate(() => ({ m: document.querySelector('[data-tool-mounted]')?.dataset.toolMounted, err: document.querySelector('[data-tool-error]')?.textContent, text: document.body.innerText.slice(0, 200), buttons: document.querySelectorAll('button').length }));
  ok(mounted && mounted.m === 'asset-extractor' && mounted.buttons > 0, `the signed package mounts and renders its own UI (${JSON.stringify(mounted)})`);
  await shot(p, 'tools');
  ok(!errs.length, `no page errors (${errs.join(' | ')})`);
  await p.close();

  const t2 = await open(url1);
  ok(await t2.p.$('[data-tl-tool="asset-extractor"]') !== null, 'a fresh tab on the address lands on the tool');
  await t2.p.close();

  // the Marketplace's Tools are the real tools, and opening one goes to the tool
  const t5 = await open('/workspace/tools/market');
  for (let i = 0; i < 20 && !(await t5.p.$('[data-arg="tool:whisper"]')); i++) await wait(300);
  const mk = await t5.p.evaluate(() => ({ real: [...document.querySelectorAll('[data-arg^="tool:"]')].map((b) => b.dataset.arg).filter((v, i, a) => a.indexOf(v) === i).length, sample: (window.XENO_PG_MARKET || []).some((x) => x.name === 'Background remover'), bought: (window.XENO_PG_MARKET || []).filter((x) => x.toolId && x.owned).length }));
  ok(mk.real >= 17 && !mk.sample && mk.bought === 0, `the Marketplace lists every real tool, no sample one, and none counted as a purchase (${JSON.stringify(mk)})`);
  await shot(t5.p, 'tools-market');
  await t5.p.click('[data-mk="open"][data-arg="tool:whisper"]'); await wait(1500);
  const went = await t5.p.evaluate(() => ({ path: location.pathname, tool: document.querySelector('[data-tl-tool]')?.dataset.tlTool }));
  ok(went.tool === 'whisper' && /\/tools\/spaces\/audio\/whisper$/.test(went.path), `opening a tool in the Marketplace goes to the tool (${JSON.stringify(went)})`);
  ok(!t5.errs.length, `no page errors in the Marketplace (${t5.errs.join(' | ')})`);
  await t5.p.close();

  // xenosystem.ai/tools: say what you want, get the tools for it; Create my own says coming soon; a card opens /tools/<id>
  const t4 = await open('/tools');
  for (let i = 0; i < 20 && !(await t4.p.$('[data-tools-card]')); i++) await wait(300);
  ok(await t4.p.$('[data-tools-picker] [data-tools-all] [data-tools-card="whisper"]') !== null, '/tools lists every tool');
  ok(await t4.p.$('[data-tools-header]') !== null && await t4.p.$('[data-tools-create]') === null && await t4.p.$('[data-tools-create-card]') === null, 'XENO Tools has its own header; Create my own appears only after typing');
  await t4.p.type('[data-tools-input]', 'remove the background from my logo'); await wait(1500);
  const first = await t4.p.$eval('[data-tools-results] [data-tools-card]', (e) => e.dataset.toolsCard).catch(() => null);
  ok(first === 'background-removal', `what you type picks the tool for it, as you type (${first})`);
  ok(await t4.p.$('[data-tools-create]') !== null && await t4.p.$('[data-tools-create-card]') !== null, 'once something is typed, Create my own appears');
  await t4.p.click('[data-tools-create]'); await wait(200);
  const dlg = await t4.p.evaluate(() => ({ open: !!document.querySelector('[data-tools-create-dialog]'), what: document.querySelector('[data-tools-create-what]')?.value }));
  ok(dlg.open && dlg.what === 'remove the background from my logo', `Create my own opens the Workshop hand-off with the words carried over (${JSON.stringify(dlg)})`);
  await shot(t4.p, 'tools-create');
  await t4.p.keyboard.press('Escape'); await wait(150);
  ok(await t4.p.$('[data-tools-create-dialog]') === null, 'Escape closes it');
  await t4.p.click('[data-tools-tab="mine"]'); await wait(800);
  ok(await t4.p.$('[data-tools-mine-card="a_mytool1"]') !== null, 'My tools lists the tools the person made');
  await shot(t4.p, 'tools-mine');
  await t4.p.click('[data-tools-tab="all"]'); await wait(150);
  await t4.p.click('[data-tools-theme]'); await wait(100);
  ok(await t4.p.evaluate(() => document.documentElement.dataset.theme) === 'light', 'the theme toggle switches to light');
  await t4.p.click('[data-tools-theme]'); await wait(100);
  await shot(t4.p, 'tools-site');
  await t4.p.click('[data-tools-results] [data-tools-card="background-removal"]'); await wait(3500);
  const site = await t4.p.evaluate(() => ({ path: location.pathname, m: document.querySelector('[data-tool-mounted]')?.dataset.toolMounted, back: !!document.querySelector('[data-tools-back]') }));
  ok(site.path === '/tools/background-removal' && site.m === 'background-removal' && site.back, `a tool opens full page at /tools/<id> (${JSON.stringify(site)})`);
  ok(!t4.errs.length, `no page errors on the tools site (${t4.errs.join(' | ')})`);
  await t4.p.close();

  // a tool the person made runs SEALED: a sandboxed frame on the view token's address, never on the page itself
  const t6 = await open('/tools/mine/a_mytool1');
  await wait(1200);
  const fr = await t6.p.evaluate(() => { const f = document.querySelector('[data-tools-mine-tool] iframe'); return f && { src: f.getAttribute('src'), sandbox: f.getAttribute('sandbox'), title: document.title }; });
  ok(fr && fr.src === '/a/a_mytool1/v/t/r/3/index.html' && fr.sandbox === 'allow-scripts allow-forms allow-modals allow-popups allow-downloads' && !/allow-same-origin/.test(fr.sandbox), `a tool you made runs sealed in its view-token frame (${JSON.stringify(fr)})`);
  ok(!t6.errs.length, `no page errors on your tool (${t6.errs.join(' | ')})`);
  await t6.p.close();

  // a changed byte: the server refuses the package, so the page has nothing to run
  const real = globalThis.fetch;
  toolPkgs.setFetch(async (u, ...a) => { const r = await real(u, ...a); if (!String(u).endsWith('/index.js')) return r; const buf = Buffer.from(await r.arrayBuffer()); return new Response(Buffer.concat([buf, Buffer.from('\n;alert(1)')]), { status: 200 }); });
  const t3 = await open('/tool-host.html?tool=asset-extractor&v=' + (await (await real(apiBase + '/api/tools')).json()).tools.find((x) => x.id === 'asset-extractor').version);
  await wait(2500);
  const bad = await t3.p.evaluate(() => ({ err: document.querySelector('[data-tool-error]')?.textContent || '', mounted: !!document.querySelector('[data-tool-mounted]') }));
  ok(!bad.mounted && /could not be opened/.test(bad.err), `a tampered package is refused and never runs (${JSON.stringify(bad)})`);
  toolPkgs.setFetch((...a) => real(...a));
} finally {
  await b.close(); await server.close(); apiServer.close();
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);

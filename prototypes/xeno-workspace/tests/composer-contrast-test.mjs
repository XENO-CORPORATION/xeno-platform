// composer-contrast-test — the model's name in the chat composer must read in every theme (owner, 2026-11-27, relayed:
// "GPT-5.8 Terra" was white on a near-white box in the light theme). The real chat app from the production build, on the
// chat host, with the platform theme set to light and to dark: the name's colour against the box it sits on, measured as
// WCAG's contrast ratio, must be at least 4.5:1 in both.
//   npx vite build && node prototypes/xeno-workspace/tests/composer-contrast-test.mjs
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import http from 'node:http'; import fs from 'node:fs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..'), dist = path.join(repo, 'dist');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
if (!fs.existsSync(path.join(dist, 'workspace', 'chat.html'))) throw new Error('build first: npx vite build');
let failed = 0; const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const USER = { id: 7, username: 'andreia', email: 'a@x.test', display_name: 'Andreia', avatar_url: null, email_verified: true, role: 'user', kind: 'human' };
const file = (res, f) => { try { const b = fs.readFileSync(f); res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); } };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const json = (b, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.pathname === '/api/auth/me' || u.pathname === '/api/auth/validate') return json({ success: true, valid: true, user: USER });
    if (u.pathname === '/api/auth/onboarding') return json({ success: true, done: true, welcomeAcknowledged: true });
    if (u.pathname === '/api/auth/activation-status') return json({ success: true, activated: true });
    if (u.pathname === '/api/chat/conversations') return json({ success: true, conversations: [], total: 0 });
    if (u.pathname === '/api/chat/projects') return json({ success: true, projects: [] });
    if (u.pathname === '/api/workspaces') return json({ success: true, workspaces: [] });
    if (u.pathname === '/api/models') return json({ success: true, models: [] });
    return json({ success: true });
  }
  if (u.pathname === '/env-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('window.__ENV__={};'); }
  if (/^\/chat(\/|$)/.test(u.pathname)) return file(res, path.join(dist, 'index.html'));
  if (/^\/((c|projects|library|images)(\/[^.]*)?)?$/.test(u.pathname)) return file(res, path.join(dist, 'workspace', 'chat.html'));
  return file(res, path.join(dist, decodeURIComponent(u.pathname)));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const HOST = 'http://chat.localhost:' + server.address().port;
const br = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
// WCAG 2.x relative luminance and contrast; a translucent colour is laid over what is under it first
const measure = () => {
  // rgb()/rgba(), and color(srgb r g b / a), which is what a color-mix() token computes to
  const parse = (c) => {
    let m = c.match(/rgba?\(([^)]+)\)/); if (m) { const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [r, g, b, a]; }
    m = c.match(/color\(srgb\s+([^)]+)\)/); if (m) { const [r, g, b, a = 1] = m[1].split(/[ /]+/).filter(Boolean).map(Number); return [r * 255, g * 255, b * 255, a]; }
    return null;
  };
  const over = (top, under) => top[3] >= 1 ? top : [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const name = document.querySelector('[data-chat-model-trigger] .ap-model') || document.querySelector('[data-chat-model-trigger]');
  if (!name) return null;
  // the box under it: everything painted at that point, not only its ancestors (the composer's box is drawn by an element
  // that is not one: an ancestor-only walk read #0a0a0a under a name that sat on a near-white box)
  const r = name.getBoundingClientRect(), stack = document.elementsFromPoint(r.left + 2, r.top + r.height / 2);
  const layers = []; for (const e of stack) { if (e === name || name.contains(e)) continue; const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }   // top first; composed bottom up below
  if (window.__dumpStack) console.log('STACK MEDIA', JSON.stringify({ frameDark: matchMedia('(prefers-color-scheme: dark)').matches, frameLight: matchMedia('(prefers-color-scheme: light)').matches, parentDark: parent.matchMedia('(prefers-color-scheme: dark)').matches, parentLight: parent.matchMedia('(prefers-color-scheme: light)').matches, stored: localStorage.getItem('xeno_platform_theme'), parentTheme: parent.document.documentElement.dataset.theme || parent.document.documentElement.className.slice(0, 80) }));
  if (window.__dumpStack) { const box = stack.find((e) => /rounded-2xl/.test(String(e.className))); const hits = []; const walk = (rules, media) => { for (const r of rules) { if (r.cssRules && !r.selectorText) { walk(r.cssRules, (r.conditionText || r.media?.mediaText || '') + ' ' + media); continue; } try { if (r.selectorText && box.matches(r.selectorText) && /background/.test(r.style.cssText)) hits.push([media.trim(), r.selectorText.slice(0, 160), r.style.cssText.slice(0, 160)]); } catch {} } }; for (const sh of document.styleSheets) { try { walk(sh.cssRules, ''); } catch {} } console.log('STACK RULES', JSON.stringify(hits)); }
  if (window.__dumpStack) console.log('STACK', JSON.stringify([...stack.slice(0, 18), document.documentElement, document.body].filter((e, i, l) => l.indexOf(e) === i).map((e) => { const s = getComputedStyle(e); return [e.tagName, String(e.className.baseVal ?? e.className).slice(0, 40), s.getPropertyValue('--chat-elevated').trim(), s.getPropertyValue('--chat-text').trim(), (e.getAttribute('style') || '').includes('--chat-elevated') ? 'INLINE ' + (e.getAttribute('style').match(/--chat-elevated:\s*[^;]+/) || [''])[0] : '']; })));
  let bg = [255, 255, 255, 1]; for (const l of layers.reverse()) bg = over(l, bg);
  const fg = over(parse(getComputedStyle(name).color), bg), L1 = lum(fg), L2 = lum(bg);
  return { text: name.textContent.trim().slice(0, 30), fg: fg.slice(0, 3).map(Math.round), bg: bg.slice(0, 3).map(Math.round), ratio: Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100, theme: [...document.querySelectorAll('[class*="chat-theme-"]')].map((e) => [...e.classList].find((c) => /^chat-theme-(light|dark|dim)$/.test(c))).find(Boolean) };
};
try {
  // light, dark, and nothing chosen yet (the theme follows the system) with the system light and dark: the captures that
  // found the defect had nothing chosen
  for (const [theme, system] of [['light', 'light'], ['dark', 'dark'], ['unset', 'light'], ['unset', 'dark'], ['unset', 'none'], ['light', 'none']]) {
    const ctx = await br.createBrowserContext();   // its own storage: a theme saved by one case must not leak into the next
    const p = await ctx.newPage(); await p.setViewport({ width: 1440, height: 900 });
    if (process.env.DUMP) p.on('console', (msg) => { if (msg.text().startsWith('STACK')) console.log(`  ${theme}/${system}`, msg.text().slice(0, 1500)); });
    if (system !== 'none') await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: system }]);
    if (theme !== 'unset') await p.evaluateOnNewDocument((t) => { try { localStorage.setItem('xeno_platform_theme', t); } catch {} }, theme);
    await p.goto(HOST + '/', { waitUntil: 'domcontentloaded' });
    let m = null;
    for (let i = 0; i < 60 && !m; i++) { await settle(500); const el = await p.$('#xw-chat-frame'); const fr = el && await el.contentFrame(); if (fr) { if (process.env.DUMP) await fr.evaluate(() => { window.__dumpStack = true; }).catch(() => {}); m = await fr.evaluate(measure).catch(() => null); } }
    if (process.env.DUMP) { p.on('console', () => {}); }
    console.log(`  ${theme}/${system}:`, JSON.stringify(m));
    if (process.env.SHOT) { fs.mkdirSync(path.join(repo, 'scratchpad'), { recursive: true }); await p.screenshot({ path: path.join(repo, 'scratchpad', `contrast-${theme}-${system}.png`) }); }
    ok(!!m && m.ratio >= 4.5, `${theme} theme, system ${system}: the model's name "${m?.text}" reads on its box (${m?.ratio}:1, text ${JSON.stringify(m?.fg)} on ${JSON.stringify(m?.bg)}, chat ${m?.theme})`);
    await ctx.close();
  }
} finally { await br.close(); server.close(); }
console.log(failed ? `${failed} FAILED` : 'composer-contrast: all passed'); process.exit(failed ? 1 : 0);

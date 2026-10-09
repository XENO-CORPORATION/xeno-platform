// The workspace on the platform's theme (theme.js): the saved choice, where it is kept, what happens when a save is
// refused, pages agreeing with each other, and text staying readable at every named stop.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url'; import { spawnSync } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5192, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const db = { appearance: { theme: 'dark', themeBrightness: 0 }, refuse: false, patches: [] };
async function open({ hash = '#/overview/g/settings/Appearance', local = null, scheme = 'dark' } = {}) {
  const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1400, height: 900 });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  if (local) await p.evaluateOnNewDocument((l) => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const k in l) localStorage.setItem(k, l[k]); } } catch {} }, local);
  await p.setRequestInterception(true);
  p.on('request', (q) => { const u = new URL(q.url()); if (!u.pathname.startsWith('/api/')) return q.continue(); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/user-data/settings' && q.method() === 'GET') return json({ success: true, settings: { appearance: { ...db.appearance } } });
    if (u.pathname === '/api/user-data/settings' && q.method() === 'PATCH') { const body = JSON.parse(q.postData() || '{}'); db.patches.push(body); if (db.refuse) return json({ success: false, error: 'Internal server error' }, 500);
      for (const up of body.updates || []) { if (up.path === 'appearance.theme') db.appearance.theme = up.value; if (up.path === 'appearance.themeBrightness') db.appearance.themeBrightness = up.value; } return json({ success: true, settings: { appearance: { ...db.appearance } } }); }
    const body = { '/api/account/overview': { success: true, overview: { user: USER, credits: { balance: 0 }, workspace_count: 1 } }, '/api/account/sessions': { success: true, sessions: [] }, '/api/account/security': { success: true, security: { confirmation: { confirmed: false, available: true, expires_at: null }, methods: ['password'], has_password: true, email: '', pending_email: null } }, '/api/account/exports': { success: true, exports: [] }, '/api/auth/linked-accounts': { success: true, accounts: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } }, '/api/dashboard/stats': { success: true, stats: { usage_available: false, usage_by_surface: [] } }, '/api/workspaces': { success: true, workspaces: [] }, '/api/chat/projects': { success: true, projects: [] }, '/api/chat/conversations': { success: true, conversations: [], total: 0 }, '/api/library/assets': { success: true, items: [] } }[u.pathname];
    return body ? json(body) : json({ success: false }, 404); });
  await p.goto(base + '/workspace/' + hash, { waitUntil: 'domcontentloaded' }); await wait(1400);
  return { p, errs, ctx };
}
// resolved colours, and the contrast of each text colour on the page and on a panel
const look = (p) => p.evaluate(() => {
  const probe = document.createElement('i'); document.body.appendChild(probe);
  // a mixed colour computes to `color(srgb r g b)` with channels from 0 to 1; a plain one to `rgb(r, g, b)`
  const rgb = (v) => { probe.style.color = v; const c = getComputedStyle(probe).color, m = c.replace(/^[a-z]+\((srgb )?/, '').match(/-?[\d.]+(?:e-?\d+)?/g).map(Number); return c.startsWith('color(') ? m.slice(0, 3).map((x) => x * 255) : m.slice(0, 3); };
  const cs = getComputedStyle(document.documentElement), val = (n) => rgb(cs.getPropertyValue(n).trim());
  const lum = ([r, g, b2]) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b2); };
  const ratio = (a, c) => { const [x, y] = [lum(a), lum(c)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const hex = (c) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  const canvas = val('--canvas'), panel = val('--panel'), text = val('--text'), muted = val('--muted'), dim = val('--dim');
  const out = { canvas: hex(canvas), text: hex(text), scheme: cs.colorScheme, theme: document.documentElement.dataset.theme, stored: [localStorage.getItem('xeno_platform_theme'), localStorage.getItem('xeno_platform_theme_brightness')],
    checked: [...document.querySelectorAll('[data-theme-pick][aria-checked="true"]')].map((x) => x.dataset.themePick).join(','), range: document.querySelector('[data-theme-bright]')?.value ?? null,
    worst: Math.min(ratio(text, canvas), ratio(muted, canvas), ratio(dim, canvas), ratio(text, panel), ratio(muted, panel), ratio(dim, panel)), toast: document.querySelector('.toast')?.textContent || '' };
  probe.remove(); return out; });
try {
  { // the account's saved choice, the controls, a refused save
    db.appearance = { theme: 'dark', themeBrightness: 0 }; const { p, errs } = await open(); let v = await look(p);
    ok(v.canvas === '#0a0a0a' && v.text === '#fafafa' && v.scheme === 'dark' && v.theme === 'dark' && v.checked === 'dark', `Dark is the platform's first stop, and Settings shows it chosen (${v.canvas} ${v.text} ${v.checked})`);
    await p.click('.pg--set [data-theme-pick="light"]'); await wait(500); v = await look(p);
    ok(JSON.stringify(db.patches.at(-1)) === JSON.stringify({ updates: [{ path: 'appearance.theme', value: 'light' }, { path: 'appearance.themeBrightness', value: 100 }] }), 'choosing Light saves it to the account as the platform saves it (' + JSON.stringify(db.patches.at(-1)) + ')');
    ok(v.canvas === '#ffffff' && v.text === '#0a0a0a' && v.scheme === 'light' && v.checked === 'light' && v.stored.join() === 'light,100' && v.range === '100', `Light is applied, remembered locally, and shown chosen (${v.canvas} ${v.stored})`);
    await p.click('.pg--set [data-theme-pick="dim"]'); await wait(500); v = await look(p);
    ok(v.canvas === '#181a1e' && v.theme === 'dim' && v.range === '50', `Dim is the middle stop (${v.canvas})`);
    // a refused save changes nothing
    db.refuse = true; const n = db.patches.length; await p.click('.pg--set [data-theme-pick="dark"]'); await wait(600); v = await look(p);
    ok(db.patches.length === n + 1 && v.canvas === '#181a1e' && v.checked === 'dim' && v.stored.join() === 'dim,50' && /couldn’t be saved|server error/i.test(v.toast), `when the save is refused nothing changes and the page says so (${v.canvas}, “${v.toast}”)`);
    db.refuse = false;
    // any point on the line
    await p.evaluate(() => { const r = document.querySelector('[data-theme-bright]'); r.value = '30'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(600); v = await look(p);
    ok(v.canvas === '#161617' && v.stored.join() === 'custom,30' && v.checked === '' && db.appearance.theme === 'custom' && db.appearance.themeBrightness === 30, `the slider sets a custom point between Dark and Light, saved as custom (${v.canvas} ${v.stored})`);
    ok(errs.length === 0, 'no page errors (' + errs.slice(0, 2).join(' | ') + ')');
    // another page of the same site changes the theme: this one follows without a reload
    const other = await p.browserContext().newPage(); await other.setRequestInterception(true); other.on('request', (q) => (q.url().includes('/api/') ? q.respond({ status: 404, body: '{}' }) : q.continue()));
    await other.goto(base + '/workspace/keys.js'); await other.evaluate(() => { localStorage.setItem('xeno_platform_theme', 'light'); localStorage.setItem('xeno_platform_theme_brightness', '100'); }); await wait(500); v = await look(p);
    ok(v.canvas === '#ffffff' && v.checked === 'light', 'a change made in another page of the site shows here at once, and the control follows');
    await other.close(); await p.close(); }
  { // the first paint uses the last-known choice; then the account's saved choice wins
    db.appearance = { theme: 'light', themeBrightness: 100 };
    const { p } = await open({ local: { xeno_platform_theme: 'dark', xeno_platform_theme_brightness: '0' } }); const v = await look(p);
    ok(v.canvas === '#ffffff' && v.stored.join() === 'light,100', 'the account’s saved theme replaces a stale local one');
    await p.close(); }
  { // nothing saved anywhere: follow the device
    db.appearance = { theme: null, themeBrightness: 0 };
    let { p } = await open({ scheme: 'light' }); let v = await look(p);
    ok(v.canvas === '#ffffff' && v.checked === 'system', 'with nothing chosen the workspace follows the device: a light device gets Light');
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await wait(300); v = await look(p);
    ok(v.canvas === '#0a0a0a', 'and it follows the device when the device changes');
    await p.close(); }
  { // readable at every named stop, and at the ones between
    db.appearance = { theme: 'dark', themeBrightness: 0 }; const { p } = await open(); const worst = [];
    for (let pos = 0; pos <= 100; pos += 5) { await p.evaluate((pos) => { localStorage.setItem('xeno_platform_theme', 'custom'); localStorage.setItem('xeno_platform_theme_brightness', String(pos)); dispatchEvent(new CustomEvent('xeno_platform_theme_change')); }, pos); const v = await look(p); if (v.worst < 4.5) worst.push(`${pos}%: ${v.worst.toFixed(2)}`); }
    ok(worst.length === 0, 'text, muted text and the faintest text pass 4.5:1 on the page and on a panel at all 21 stops' + (worst.length ? ' — failing: ' + worst.join(', ') : ''));
    await p.close(); }
  { // from disk there is no account: the choice is kept in the browser
    const p = await b.newPage(); await p.goto(pathToFileURL(path.join(here, '..', 'index.html')).href + '#/overview/g/settings/Appearance'); await wait(900);
    await p.click('.pg--set [data-theme-pick="light"]'); await wait(400); const v = await look(p);
    ok(v.canvas === '#ffffff' && v.stored.join() === 'light,100', 'opened from disk, the theme is kept in the browser');
    await p.close(); }
  // the two generated files are current, and no stylesheet has a hard-coded grey left
  const run = (args) => spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8' });
  const pal = run(['scripts/gen-workspace-theme.mjs', '--check']); ok(pal.status === 0, 'the palette is the platform’s own, regenerated and unchanged' + (pal.status ? ' — ' + pal.stderr.trim() : ''));
  const col = run(['scripts/workspace-theme-colors.mjs', '--check']); ok(col.status === 0, 'no stylesheet has a hard-coded grey: every one comes from the theme' + (col.status ? ' — ' + col.stderr.trim() : ''));
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;

// Shared helpers for the real-stack walks: a browser, typing like a person, reading mail from the catcher, and the throwaway DB.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
export const here = path.dirname(fileURLToPath(import.meta.url));
/** Everything a run writes (logs, caught mail, screenshots, downloads) goes to the repo's gitignored scratchpad. */
export const OUT = path.resolve(here, '../../scratchpad/real-stack');
const require = createRequire(path.resolve(here, '../../package.json'));
export const puppeteer = require('puppeteer');
export const SITE = 'http://localhost:5183';
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const notes = [];
export const ok = (c, m, detail = '') => { if (!c) fails++; const line = `${c ? 'PASS' : 'FAIL'} ${m}${!c && detail ? ' :: ' + String(detail).slice(0, 400) : ''}`; notes.push(line); console.log(line); return c; };
export const failures = () => fails;

export async function browser() { return puppeteer.launch({ headless: true, protocolTimeout: 90000 }); }
export async function page(b) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  p.bad = []; p.on('response', (r) => { const u = r.url(); if (u.includes('/api/') && r.status() >= 500) p.bad.push(`${r.status()} ${r.request().method()} ${new URL(u).pathname}`); });
  return p;
}
export async function go(p, addr, settle = 1500) { await p.goto(SITE + addr, { waitUntil: 'networkidle2', timeout: 60000 }); await wait(settle); }
export const text = (p, sel = 'body') => p.evaluate((s) => document.querySelector(s)?.innerText || '', sel);
/** Type into the input matching a placeholder or label text, as keystrokes. */
export async function type(p, selector, value) { await p.waitForSelector(selector, { timeout: 15000 }); await p.click(selector, { clickCount: 3 }); await p.type(selector, value, { delay: 5 }); }
/** Click the first visible button/link whose text matches. */
export async function clickText(p, re, scope = 'button, a, [role=button], [role=menuitem], [role=tab]') {
  const handles = await p.$$(scope);
  for (const h of handles) {
    const t = await h.evaluate((n) => { const r = n.getBoundingClientRect(); return r.width && r.height ? (n.innerText || n.getAttribute('aria-label') || n.title || '').trim() : ''; });
    if (t && (typeof re === 'string' ? t === re : re.test(t))) { await h.click(); return t; }
  }
  return null;
}
export async function shot(p, name) { fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true }); await p.screenshot({ path: path.join(OUT, 'shots', name + '.png') }).catch(() => {}); }

/** Mail the catcher received, newest last, each { to, subject, html }. */
export function mail() {
  const dir = path.join(OUT, 'mail'); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).map((m) => ({ ...m, to: [].concat(m.to)[0] }));
}
export async function waitMail(pred, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { const m = mail().filter(pred); if (m.length) return m[m.length - 1]; await wait(500); } return null; }

/** SQL against the throwaway database (never production): the container named by start.mjs. */
export function sql(q) {
  const r = spawnSync('ssh', ['xeno-platform-001', `sudo docker exec -i real-stack-pg psql -U postgres -d xeno_real -tAX -F '|'`], { input: q, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim();
}

/** A brand-new person: signs up through the form, types the emailed code, presses Continue. Returns { name, email, password }. */
export async function newPerson(p, first = 'Alex') {
  const who = { name: `${first} Tester`, email: `${first.toLowerCase()}.${Date.now()}@example.test`, password: 'Walk-the-loop-42!' };
  // Signup allows 10 per address in 15 minutes, and rightly. Each test person gets their own address from the documentation range.
  await p.setExtraHTTPHeaders({ 'CF-Connecting-IP': `203.0.113.${(Date.now() % 250) + 1}` });
  await go(p, '/signup'); await clickText(p, /continue with email/i); await wait(500);
  await type(p, 'input[placeholder="Your name"]', who.name); await type(p, 'input[type=email]', who.email); await type(p, 'input[type=password]', who.password);
  await clickText(p, 'Create account'); await wait(4000);
  const m = await waitMail((x) => x.to === who.email && /verify/i.test(x.subject));
  const code = m && (m.html.replace(/<[^>]+>/g, ' ').match(/\b(\d{6})\b/) || [])[1];
  if (!code) throw new Error('no activation code arrived for ' + who.email);
  await p.click('input'); await p.keyboard.type(code, { delay: 40 }); await wait(3500);
  await clickText(p, 'Continue'); await wait(2500);
  who.id = sql(`SELECT id FROM users WHERE email='${who.email}'`);
  return who;
}
/** Workspace dialogs (XD): fill a field by id, submit, read the open dialog. */
export const fill = async (p, id, v) => { const sel = `#xdf-${id}`; await p.waitForSelector(sel, { timeout: 10000 }); await p.click(sel, { clickCount: 3 }); await p.type(sel, String(v), { delay: 5 }); };
/** A 'rows' field (an invoice's lines): fill line n (1-based) column by column; Add a line first when it isn't there yet. */
export const fillRow = async (p, field, n, cols) => {
  const rows = `.xd [data-f="${field}"] .xd-row`;
  while ((await p.$$(rows)).length < n) { await p.click(`.xd [data-f="${field}"] [data-rows-add]`); await wait(150); }
  for (const [col, v] of Object.entries(cols)) { const sel = `${rows}:nth-child(${n}) [data-col="${col}"]`; await p.$eval(sel, (e) => { e.value = ''; }); await p.type(sel, String(v), { delay: 5 }); }   // emptied first: a column may start with a value (quantity 1)
};
export const submit = async (p) => { await p.click('.xd [data-xd-ok], .xd [data-xd-submit], .xd button[type="submit"]'); await wait(1500); };
export const dialog = (p) => p.evaluate(() => { const all = document.querySelectorAll('.xd [role=dialog]'); const d = all[all.length - 1]; return d ? (d.innerText.trim() || d.textContent) : ''; });
/** The message a dialog shows after a refused submit (.xd-warn), or ''. */
export const dialogWarn = (p) => p.evaluate(() => [...document.querySelectorAll('.xd .xd-warn')].filter((w) => !w.hidden).map((w) => w.textContent).join(' '));
export const signedIn = async (p) => (await p.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'same-origin' })).status)) === 200;

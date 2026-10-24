// The Shift+R report window is readable on every theme: its title and subtitle meet WCAG 2.2 AA (4.5:1) against the
// header they sit on — in the workspace's Dark theme, its Light theme, and on a page with no workspace tokens (the
// public site). Found live 2026-10-24: in Light the workspace's global `h2{color:var(--text)}` (a dark grey) landed on
// the composer's fixed dark header (#1a1a1a), about 1.1:1. report.css now takes every colour from the design-system
// tokens. Mutation: put `background:#1a1a1a` back on `.xreport header` → the Light case fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const THEMES = {
  dark: ':root{--canvas:#0a0a0a;--panel:#111111;--control:#1f1f1f;--text:#fafafa;--muted:#a3a3a3;--dim:#8b8b92;--border:rgba(255,255,255,.10);color-scheme:dark}body{background:var(--canvas);color:var(--text)}h2{color:var(--text)}',
  light: ':root{--canvas:#fafafa;--panel:#ffffff;--control:#f0f0f0;--text:#171717;--muted:#525252;--dim:#62626a;--border:rgba(0,0,0,.10);color-scheme:light}body{background:var(--canvas);color:var(--text)}h2{color:var(--text)}',
  site: 'body{background:#060606;color:#ece7df}',
};

test('the report window title and subtitle meet 4.5:1 in Dark, Light and on the public site', { timeout: 60000 }, async () => {
  let theme = 'dark';
  const server = createServer(async (req, res) => {
    const p = new URL(req.url, 'http://local').pathname;
    if (p === '/api/auth/me') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ success: true, user: { id: '11111111-1111-4111-8111-111111111111', username: 'ada' } })); }
    if (p.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); return res.end('{}'); }
    if (p.endsWith('.js') || p.endsWith('.css')) { try { res.setHeader('Content-Type', p.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8'); return res.end(await readFile('prototypes/xeno-workspace/' + p.split('/').at(-1))); } catch { res.statusCode = 404; return res.end(); } }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><style>${THEMES[theme]}</style><link rel="stylesheet" href="/workspace/report.css"><script src="/workspace/report-client.js"></script><script src="/workspace/report-capture.js"></script><script src="/workspace/report-view.js"></script><p>page</p>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ headless: true });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const t of Object.keys(THEMES)) {
      theme = t;
      const page = await browser.newPage();
      await page.goto(base + '/workspace/studio');
      await page.keyboard.down('Shift'); await page.keyboard.press('R'); await page.keyboard.up('Shift');
      await page.waitForSelector('.xreport[open] header h2');
      const r = await page.evaluate(() => {
        // resolve any CSS colour (color-mix included) to sRGB through a canvas, then WCAG relative luminance
        const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        const rgb = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillRect(0, 0, 1, 1); cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return [...cx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
        const head = document.querySelector('.xreport header'), bg = getComputedStyle(head).backgroundColor;
        return { title: ratio(getComputedStyle(head.querySelector('h2')).color, bg), sub: ratio(getComputedStyle(head.querySelector('p')).color, bg) };
      });
      assert.ok(r.title >= 4.5, `${t}: the title is ${r.title.toFixed(2)}:1 against its header (needs 4.5)`);
      assert.ok(r.sub >= 4.5, `${t}: the subtitle is ${r.sub.toFixed(2)}:1 against its header (needs 4.5)`);
      await page.close();
    }
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});

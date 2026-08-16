/*
 * §6 lists "voice identical at dark/light/30/65 %" as a standing probe and no such file existed —
 * `custom.mjs` compares chat against search, and the voice route was never in it. This is that probe:
 * the same eleven-token read, run on voice and on chat, at both named themes and two custom stops.
 *
 * Voice is the route most likely to drift, because it is the one that does not mount ChatWithLLM.
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 2 } });

// Seed BEFORE any script runs — a write made after load races the theme effect and gets clobbered.
const read = async (url, theme, pos) => {
  const p = await b.newPage();
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await p.evaluateOnNewDocument((t, v) => {
    localStorage.setItem('xeno-chat-theme', t);
    if (v !== null) localStorage.setItem('xeno-chat-theme-brightness', String(v));
  }, theme, pos);
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 4200));
  const out = await p.evaluate(() => {
    const root = document.querySelector('[data-chat-theme-preference]') || document.querySelector('.chat-themed');
    if (!root) return { missing: true };
    const cs = getComputedStyle(root);
    const pick = (n) => cs.getPropertyValue(n).trim();
    return {
      cls: [...root.classList].find((c) => c.startsWith('chat-theme-')),
      canvas: pick('--chat-canvas'), surface: pick('--chat-surface'), text: pick('--chat-text'),
      muted: pick('--chat-muted'), border: pick('--chat-border'), control: pick('--chat-control'),
      elevated: pick('--chat-elevated'), xenoSurface: pick('--xeno-surface'),
    };
  });
  await p.close();
  return { out, errs };
};

const CASES = [['dark', null], ['light', null], ['custom', 30], ['custom', 65]];
const ROUTES = [['voice', 'voice'], ['search', 'search']];
let bad = 0;
for (const [name, seg] of ROUTES) {
  for (const [theme, pos] of CASES) {
    const other = await read(`http://localhost:5183/overview/chat/${seg}`, theme, pos);
    const chat = await read('http://localhost:5183/overview/chat/llm', theme, pos);
    const same = JSON.stringify(other.out) === JSON.stringify(chat.out);
    if (!same) bad += 1;
    const label = pos === null ? theme : `${theme} ${pos}%`;
    console.log(`${name.padEnd(7)} ${label.padEnd(12)} identical=${same}  canvas=${other.out.canvas || '(none)'}`);
    if (!same) {
      console.log(`  ${name}`, JSON.stringify(other.out));
      console.log('  chat  ', JSON.stringify(chat.out));
    }
    const errs = [...other.errs, ...chat.errs];
    if (errs.length) console.log('  errs', JSON.stringify(errs));
  }
}
console.log(bad === 0 ? '\nboth routes match chat on every stop' : `\n${bad} stop(s) differ`);
await b.close();

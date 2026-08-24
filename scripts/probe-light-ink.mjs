/*
 * Near-white ink on a light canvas — text hardcoded for the dark theme that nobody re-checked when
 * light shipped. Invisible in light, and invisible to any check that only runs in dark.
 *
 * This replaces a scratchpad probe that ran on the CHAT route only. The failure mode has nothing to
 * do with which route a control sits on: a `text-zinc-100` written during a dark-only pass reads the
 * same wherever it is. Checking one of three routes answered a third of the question.
 *
 * `dim` is measured too, and deliberately reported rather than asserted: dim's canvas is `#171718`,
 * so near-white ink there is CORRECT. Printing it keeps the number honest — a reader can see the
 * check understood the difference instead of quietly excluding a theme it could not explain.
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { CHAT_ORIGIN } from './lib/chat-origin.mjs';
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1500, height: 950 } });

const ROUTES = [['chat', 'llm'], ['search', 'search'], ['voice', 'voice']];

const inkOn = async (theme, seg) => {
  const p = await b.newPage();
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  // Seed before any script runs — the chat persists its theme on mount and clobbers a later write.
  await p.evaluateOnNewDocument((t) => {
    localStorage.setItem('xeno-chat-theme', t);
    localStorage.setItem('xeno-chat-theme-brightness', '100');
  }, theme);
  await p.goto(`${CHAT_ORIGIN}/overview/chat/${seg}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForSelector('.chat-themed', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3800));

  const found = await p.evaluate(() => {
    const lum = (c) => {
      const m = c.match(/\d+/g);
      if (!m) return null;
      const [r, g, bl] = m.map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255;
    };
    const canvas = getComputedStyle(document.querySelector('.chat-themed')).getPropertyValue('--chat-canvas').trim();
    const out = [];
    for (const el of document.querySelectorAll('.chat-themed *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6 || r.bottom < 0 || r.top > innerHeight) continue;
      if (!el.textContent || !el.textContent.trim() || el.children.length > 0) continue;
      const cs = getComputedStyle(el);
      const l = lum(cs.color);
      if (l !== null && l > 0.85) {
        out.push({ text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 34), color: cs.color });
      }
    }
    return { canvas, out };
  });
  await p.close();
  return found;
};

let worst = 0;
for (const theme of ['light', 'dim']) {
  console.log(`\n${theme}:`);
  for (const [name, seg] of ROUTES) {
    const { canvas, out } = await inkOn(theme, seg);
    if (theme === 'light') worst = Math.max(worst, out.length);
    const note = theme === 'dim' ? '  (expected — dim is a DARK canvas, near-white ink is right here)' : '';
    console.log(`  ${name.padEnd(7)} canvas ${canvas}   near-white ink: ${out.length}${note}`);
    for (const o of out) console.log(`      ${o.color}  ${JSON.stringify(o.text)}`);
  }
}
console.log(`\nlight-canvas near-white ink, worst route: ${worst}`);
console.log('The known one is the caption over a dark generated image, which is content, not chrome.');
await b.close();

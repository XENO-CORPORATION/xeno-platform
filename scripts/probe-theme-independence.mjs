/*
 * Is it actually true that metrics, target size and tab order are theme-independent?
 *
 * That claim is the reason three probes are staying single-theme, and it is a HYPOTHESIS. This
 * session's repeated lesson is that untested assumptions about probes are what go wrong — so measure
 * it once, cheaply, and either stop worrying with evidence or find out it varies.
 *
 * Runs the three probes' core numbers in dark and in light and diffs them.
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { CHAT_URL } from './lib/chat-origin.mjs';
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });

const read = async (theme) => {
  const p = await b.newPage();
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await p.evaluateOnNewDocument((t) => localStorage.setItem('xeno-chat-theme', t), theme);
  await p.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForSelector('.chat-themed', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4200));

  // tab order: walk it for real
  const seq = [];
  for (let i = 0; i < 90; i += 1) {
    await p.keyboard.press('Tab');
    const d = await p.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return `${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)}`;
    });
    if (!d) break;
    if (seq.length > 4 && d === seq[0]) break;
    seq.push(d);
  }

  const rest = await p.evaluate(() => {
    // adopted metrics
    let controls = 0, drift = 0;
    for (const el of document.querySelectorAll('.chat-themed .xeno-btn, .chat-themed .xeno-input')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      controls += 1;
      const declared = parseFloat(getComputedStyle(el).getPropertyValue('--xeno-h'));
      if (declared && Math.abs(el.offsetHeight - declared) > 0.5) drift += 1;
    }
    // sub-24px interactive targets
    let small = 0;
    for (const el of document.querySelectorAll('.chat-themed button, .chat-themed [role="button"], .chat-themed a[href]')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (Math.min(r.width, r.height) < 24) small += 1;
    }
    return { controls, drift, small };
  });
  await p.close();
  return { ...rest, tabStops: seq.length, seq };
};

const runs = [];
for (let i = 0; i < 3; i += 1) runs.push(await read('dark'));
console.log('same theme, three runs — tabStops:', runs.map((r) => r.tabStops).join(', '));
console.log('                        controls:', runs.map((r) => r.controls).join(', '));
console.log('                           small:', runs.map((r) => r.small).join(', '));
const dark = runs[0];
const light = await read('light');

const same = (k) => (dark[k] === light[k] ? 'same' : `DIFFERS  ${dark[k]} vs ${light[k]}`);
console.log('');
for (const k of ['controls', 'drift', 'small', 'tabStops']) console.log(`  ${k.padEnd(10)} ${same(k)}`);
const onlyLight = light.seq.filter((x) => !dark.seq.includes(x));
const onlyDark = dark.seq.filter((x) => !light.seq.includes(x));
console.log('in LIGHT only:', JSON.stringify(onlyLight));
console.log('in DARK only: ', JSON.stringify(onlyDark));
await b.close();

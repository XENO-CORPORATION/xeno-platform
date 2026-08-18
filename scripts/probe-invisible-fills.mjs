/*
 * Removing the duplicated `!important` rule was right — a hand-written control fill now paints what
 * its own class says. But that rule had been force-mapping every `bg-[var(--chat-control)]` to
 * `--chat-control-strong`, and one of the things it was accidentally rescuing was any such fill
 * sitting on a surface of the SAME value. In dark, `--chat-control` and `--chat-elevated` are both
 * #262626: a control filled with one, on a panel painted the other, is invisible.
 *
 * This walks every painted element and reports the ones whose background matches the nearest painted
 * ancestor's — the fill that is doing no work. It is the same failure the library's `quiet` fill has
 * a precondition about, found from the product's side.
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { CHAT_URL } from './lib/chat-origin.mjs';
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;
/*
 * ACROSS THE THEMES, not just the one the browser starts in.
 *
 * This probe is about colour COLLISIONS — a fill that matches the surface under it — and which pairs
 * collide is exactly what a theme changes. In dark, `--chat-control` and `--chat-elevated` are both
 * #262626; there is no reason the same two should collapse in light, and no reason a different pair
 * should not. A single-theme run answers the question for one third of the product.
 *
 * `dim` is included because it went unchecked on every route for as long as `probe-voicebright`
 * existed, which is the shape of gap worth assuming is still around.
 */
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });

const measure = async (theme) => {
  const p = await b.newPage();
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  // Seed BEFORE any script runs — the chat persists its theme on mount and would clobber a later write.
  await p.evaluateOnNewDocument((t) => localStorage.setItem('xeno-chat-theme', t), theme);
  await p.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForSelector('.chat-themed', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4200));

  const result = await p.evaluate(() => {
  const TRANSPARENT = 'rgba(0, 0, 0, 0)';
  const painted = (el) => {
    const bg = getComputedStyle(el).backgroundColor;
    return bg && bg !== TRANSPARENT ? bg : null;
  };
  const surfaceUnder = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const bg = painted(n);
      if (bg) return bg;
    }
    return null;
  };
  const hits = [];
  for (const el of document.querySelectorAll('.chat-themed *')) {
    const bg = painted(el);
    if (!bg) continue;
    // A control, not a layout box: it has to be interactive or carry a control fill class.
    const cls = String(el.className || '');
    const interactive = el.matches('button, [role="tab"], [role="button"], a') || cls.includes('bg-[var(--chat-');
    if (!interactive) continue;
    const under = surfaceUnder(el);
    if (under && under === bg) {
      hits.push({ tag: el.tagName.toLowerCase(), bg, text: (el.textContent || '').trim().slice(0, 28), cls: cls.slice(0, 76) });
    }
  }
    return hits;
  });
  await p.close();
  return result;
};

/*
 * Matching the surface is not automatically wrong — a resting row on a tray is MEANT to be flat and
 * let its border do the delineating. What this list is for is the pair: if a control and its selected
 * twin both appear here, the selection is invisible and that is the bug. Read it with that question.
 */
const THEMES = ['dark', 'dim', 'light'];
const totals = [];
for (const theme of THEMES) {
  const hits = await measure(theme);
  totals.push(hits.length);
  console.log(`
${theme}: controls whose fill matches the surface under them: ${hits.length}`);
  for (const h of hits) console.log(`  ${h.bg}  <${h.tag}> ${JSON.stringify(h.text)}  ${h.cls}`);
}
console.log(`
per theme: ${THEMES.map((t, i) => `${t} ${totals[i]}`).join(', ')}`);
/* One number for the runner to hold, and it has to be theme-aware: a count that is right in dark and
   wrong in light is the bug this probe exists to catch, so the verdict is the WORST of the three. */
console.log(`worst: ${Math.max(...totals)}`);
await b.close();

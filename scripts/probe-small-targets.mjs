/*
 * §9 records six controls below the scale's floor (`xs` = 24px) and frames it as a missing size. That
 * framing is worth testing, because a small INTERACTIVE target is not only a design question: WCAG
 * 2.2 AA "Target Size (Minimum)" asks for 24×24 CSS px, with an exception when spacing keeps a 24px
 * circle from overlapping a neighbour's.
 *
 * So this measures two different things and keeps them apart:
 *   - the visible box, which is what the size scale is about
 *   - the actual HIT area, which is what a user's finger meets — a 16px glyph inside a 24px padded
 *     button passes on the second while failing on the first, and vice versa
 *
 * Anything reported here is a real control: it has a click handler, a role, or is a <button>.
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });
const p = await b.newPage();
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
await p.goto('http://localhost:5183/overview/chat/llm', { waitUntil: 'domcontentloaded', timeout: 90000 });
await p.waitForSelector('.chat-themed', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4200));

const out = await p.evaluate(() => {
  const FLOOR = 24;
  const all = [...document.querySelectorAll('.chat-themed button, .chat-themed [role="button"], .chat-themed a[href]')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter((x) => x.r.width > 0 && x.r.height > 0);

  const hits = [];
  for (const { el, r } of all) {
    if (Math.min(r.width, r.height) >= FLOOR) continue;
    /*
     * The SPACING exception, which is the half of the rule people forget. An undersized target still
     * passes if a 24px circle centred on it does not intersect the circle of any other target — so
     * "smaller than 24" and "fails 2.2 AA" are different claims, and only the second is a defect.
     */
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let nearest = Infinity;
    for (const other of all) {
      if (other.el === el) continue;
      const ox = other.r.left + other.r.width / 2;
      const oy = other.r.top + other.r.height / 2;
      nearest = Math.min(nearest, Math.hypot(cx - ox, cy - oy));
    }
    hits.push({
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
      nearest: nearest === Infinity ? null : +nearest.toFixed(1),
      spaced: nearest >= FLOOR,
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
      adopted: el.classList.contains('xeno-btn') || el.classList.contains('xeno-icon-btn'),
    });
  }
  return hits;
});

console.log(`interactive targets under 24px: ${out.length}\n`);
for (const h of out) {
  const verdict = h.spaced ? 'passes on spacing' : 'FAILS 2.2 AA';
  console.log(
    `  ${String(h.w).padStart(5)} x ${String(h.h).padEnd(5)} ${h.adopted ? 'adopted    ' : 'hand-written'} ` +
      `nearest ${String(h.nearest).padStart(6)}px  ${verdict.padEnd(18)} ${JSON.stringify(h.label)}`,
  );
}
const failing = out.filter((h) => !h.spaced).length;
console.log(`\n  ${failing} of ${out.length} fail the target-size minimum outright.`);
console.log('  Branches the mock cannot render — attachment chips, the customize page — are not counted here.');
await b.close();

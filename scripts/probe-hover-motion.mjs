/*
 * Does the sidebar still MOVE on hover — the travelling pill, and the glyphs inside the rows?
 *
 * Nothing in the fourteen-probe programme measured motion. Every one of them reads a settled value: a
 * height, a radius, a fill, a tab order. So the whole suite could stay green while every animation in
 * the chat was dead, and that is exactly how this got reported — by a person, looking at it.
 *
 * Two mechanisms, measured separately because they fail independently:
 *
 *   the pill   `useGooPill` writes `--xeno-goo-y` / `--xeno-goo-h` on the host as the pointer crosses
 *              `[data-goo-row]`. Measured by hovering each row and checking the pill both MOVES and
 *              LANDS on the row it is following — a pill that moves to the wrong place is a bug no
 *              "did anything change" assertion can see.
 *
 *   the glyphs `icon-motion.css` animates `.xeno-element[data-glyph]` inside any button in a
 *              `.xeno-icon-hosts` scope. Measured with `getAnimations({subtree: true})`, which counts
 *              what is actually RUNNING rather than what the stylesheet hoped for.
 *
 * TWO TRAPS, both walked into while writing this, both of which report "all motion is dead":
 *
 * 1. The sidebar rests at `left: -260px` with `pointerEvents: 'none'` until `isHistoryOpen`. Hovering
 *    without opening it reports six dead rows — §5.4d, where a switched-off branch and an unreachable
 *    hover look identical from outside. Opening it IS the probe; a run that cannot click the toggle
 *    must say so rather than report failure.
 *
 * 2. Headless Chrome defaults to `prefers-reduced-motion: reduce`, and the chat correctly honours it.
 *    Measured all three ways: unset -> 0 animations, `reduce` -> 0, `no-preference` -> 2. So the media
 *    feature is emulated EXPLICITLY below. Without that line this probe measures the browser's
 *    accessibility default and calls it a regression.
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { CHAT_URL } from './lib/chat-origin.mjs';
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;

const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
/* Trap 2. Not a preference — the condition under which these animations are SUPPOSED to run. */
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
await p.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await new Promise((r) => setTimeout(r, 5000));

const opener = await p.$('[aria-label="Open conversation history"]');
if (!opener) {
  console.log('could not reach the sidebar toggle — nothing measured');
  console.log('rows measured: 0');
  await b.close();
  process.exit(0);
}
await opener.click();
/* The panel is `transition-all duration-300`; read after it lands or every rect is mid-slide. */
await new Promise((r) => setTimeout(r, 700));

const shape = await p.evaluate(() => {
  const host = document.querySelector('.chat-goo-sidebar');
  if (!host) return { ok: false, why: 'no goo host' };
  const hr = host.getBoundingClientRect();
  if (hr.left < 0) return { ok: false, why: `still off-screen at left ${hr.left}` };
  if (!host.querySelector(':scope > .xeno-goo-pill')) return { ok: false, why: 'no pill child' };
  return { ok: true, rows: host.querySelectorAll('[data-goo-row]').length };
});
if (!shape.ok) {
  console.log(`sidebar not measurable: ${shape.why}`);
  console.log('rows measured: 0');
  await b.close();
  process.exit(1);
}

const rows = await p.evaluate(() =>
  [...document.querySelectorAll('.chat-goo-sidebar [data-goo-row]')].map((row, i) => {
    const r = row.getBoundingClientRect();
    return {
      i,
      label: (row.textContent || '').trim().slice(0, 20),
      glyph: row.querySelector('svg.xeno-element[data-glyph]')?.getAttribute('data-glyph') ?? null,
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      top: +r.top.toFixed(1),
    };
  }));

const seen = [];
for (const row of rows) {
  await p.mouse.move(row.x, row.y);
  /* Past `--xeno-goo-dur` (220ms) so the pill reading is settled, and the glyph animations — 150-400ms —
     are still running, which is what `getAnimations` can see. One wait cannot suit both, so this one is
     chosen for the pill and the glyph count is read first, before the sleep. */
  const anim = await p.evaluate((i) => {
    const icon = document.querySelectorAll('.chat-goo-sidebar [data-goo-row]')[i]
      .querySelector('svg.xeno-element[data-glyph]');
    return icon ? icon.getAnimations({ subtree: true }).length : -1;
  }, row.i);
  await new Promise((r) => setTimeout(r, 320));
  const pill = await p.evaluate(() => {
    const host = document.querySelector('.chat-goo-sidebar');
    const cs = getComputedStyle(host);
    const el = host.querySelector(':scope > .xeno-goo-pill');
    return {
      goo: host.getAttribute('data-goo'),
      y: cs.getPropertyValue('--xeno-goo-y').trim(),
      h: cs.getPropertyValue('--xeno-goo-h').trim(),
      opacity: +getComputedStyle(el).opacity,
      top: +el.getBoundingClientRect().top.toFixed(1),
    };
  });
  const offBy = +(pill.top - row.top).toFixed(1);
  seen.push({ ...row, ...pill, anim, offBy });
  console.log(
    `  ${String(row.label).padEnd(20)} glyph=${String(row.glyph).padEnd(8)} ` +
      `goo=${pill.goo} y=${(pill.y || '-').padEnd(6)} off-by ${String(offBy).padEnd(5)} animations=${anim}`,
  );
}

const positions = new Set(seen.map((s) => `${s.y}|${s.h}`));
const lands = seen.every((s) => Math.abs(s.offBy) <= 1);
const travels = positions.size > 1 && seen.some((s) => s.goo === 'on') && seen.some((s) => s.opacity > 0);
const glyphRows = seen.filter((s) => s.glyph);
const still = glyphRows.filter((s) => s.anim === 0);

console.log(`\nrows measured: ${seen.length}`);
console.log(`distinct pill positions: ${positions.size}`);
console.log(`pill travels and lands on its row: ${travels && lands}`);
console.log(`glyphs animating on hover: ${glyphRows.length - still.length}/${glyphRows.length}`);
if (still.length) console.log(`  still: ${still.map((s) => s.glyph).join(', ')}`);
/* A ratio is the wrong shape for a gate: "6 animating" stays true when a seventh row is added dead.
   The verdict has to be the ALL, so adding a row that does not move fails instead of diluting. */
console.log(`every row moves: ${travels && lands && !still.length && glyphRows.length === seen.length}`);

if (!travels || !lands || still.length) {
  console.error('\nMotion regressed. Before blaming the app, check the two traps in this file’s header:');
  console.error('  the sidebar must be OPEN, and prefers-reduced-motion must be emulated no-preference.');
  process.exit(1);
}
await b.close();

/*
 * §9's `secondary` divergence, measured rather than argued.
 *
 * The chat's theme-normalisation block force-maps legacy hardcoded fills onto the chat tokens, and it
 * names `[class*="bg-[var(--chat-control)]"]` TWICE at the same specificity — once mapping to
 * `--chat-control` and once to `--chat-control-strong`. The later rule wins, so every hand-written
 * control fill in the chat paints #404040 while the `secondary` Buttons converted from that same
 * class paint #262626: the rule is keyed on a Tailwind class substring and a library component has no
 * such class on it.
 *
 * This reads both populations off the running chat and prints what they actually paint.
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;
/*
 * ACROSS THE THEMES. What this watches is whether a hand-written control fill and the converted
 * `secondary` beside it land on the SAME colour — and both sides of that comparison are token-valued,
 * so the answer is per-theme by construction. `probe-invisible-fills` found each theme collapses a
 * different pair of surface tokens; there was no reason to assume this comparison is the exception.
 */
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });

const measure = async (theme) => {
const p = await b.newPage();
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
// Seed BEFORE any script runs — the chat persists its theme on mount and clobbers a later write.
await p.evaluateOnNewDocument((t) => localStorage.setItem('xeno-chat-theme', t), theme);
await p.goto('http://localhost:5183/overview/chat/llm', { waitUntil: 'domcontentloaded', timeout: 90000 });
// The themed root mounts after the route resolves; waiting for the selector rather than a fixed
// delay keeps this from failing on a slow first compile after an edit.
await p.waitForSelector('.chat-themed', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4200));

const out = await p.evaluate(() => {
  const root = document.querySelector('.chat-themed');
  const cs = getComputedStyle(root);
  const tok = (n) => cs.getPropertyValue(n).trim();

  const tally = (els) => {
    const counts = {};
    for (const el of els) {
      const bg = getComputedStyle(el).backgroundColor;
      counts[bg] = (counts[bg] || 0) + 1;
    }
    return counts;
  };

  const handWritten = [...document.querySelectorAll('[class*="bg-[var(--chat-control)]"]')]
    .filter((el) => !el.className.includes('hover:bg-[var(--chat-control)]') || el.className.includes(' bg-[var(--chat-control)]'));
  const converted = [...document.querySelectorAll('.xeno-btn[data-variant="secondary"]')];

  return {
    tokens: { control: tok('--chat-control'), controlStrong: tok('--chat-control-strong') },
    handWritten: { n: handWritten.length, fills: tally(handWritten) },
    convertedSecondary: { n: converted.length, fills: tally(converted) },
  };
});

  await p.close();
  return out;
};

/*
 * A token read with `getPropertyValue` comes back AS AUTHORED (`#262626`); a computed background
 * comes back resolved (`rgb(38, 38, 38)`). Comparing the strings reports zero matches on a probe that
 * is working — §6 tabulates this exact mistake, and this file walked into it anyway on the pass that
 * added the theme loop. Normalise, then compare.
 */
const rgb = (v) => {
  const m = /^#([0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return v.trim();
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

let atControl = 0;
for (const theme of ['dark', 'dim', 'light']) {
  const out = await measure(theme);
  const hw = Object.entries(out.handWritten.fills).sort((a, b) => b[1] - a[1]);
  const cv = Object.keys(out.convertedSecondary.fills);
  /* The number worth holding: how many hand-written control fills land on `--chat-control` ITSELF.
     Before the duplicated `!important` selector was removed they landed on `--chat-control-strong`
     instead, and that is the regression this exists to catch — a per-theme colour, not a count. */
  const onControl = hw.find(([k]) => k === rgb(out.tokens.control))?.[1] ?? 0;
  if (theme === 'dark') atControl = onControl;
  console.log(`\n${theme}: control ${out.tokens.control}, strong ${out.tokens.controlStrong}`);
  console.log(`  hand-written (${out.handWritten.n}): ${hw.map(([k, n]) => `${k} x${n}`).join(', ') || '(none on screen)'}`);
  console.log(`  converted secondary (${out.convertedSecondary.n}): ${cv.join(', ') || '(none on screen)'}`);
  console.log(`  on --chat-control: ${onControl}`);
}
console.log(`\ndark hand-written fills on --chat-control: ${atControl}`);
await b.close();

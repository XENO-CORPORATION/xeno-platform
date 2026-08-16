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
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });
const p = await b.newPage();
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
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

console.log(JSON.stringify(out, null, 1));
const hw = Object.keys(out.handWritten.fills);
const cv = Object.keys(out.convertedSecondary.fills);
if (hw.length && cv.length) {
  console.log(`\nhand-written control fills: ${hw.join(', ')}`);
  console.log(`converted secondary fills:  ${cv.join(', ')}`);
  console.log(hw.join() === cv.join() ? '\nthey agree' : '\nTHEY DIVERGE — the duplicated rule is still winning');
} else {
  console.log('\nnot enough of one population on screen to compare');
}
await b.close();

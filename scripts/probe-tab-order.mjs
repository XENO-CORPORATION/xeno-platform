/*
 * Tab order, walked with real Tab presses rather than inferred from the DOM.
 *
 * §9 records 10 pointer-cursor `<div>`s in the default chat with neither `role` nor `tabIndex` — a
 * mouse reaches them and a keyboard reaches none. Fixing that ADDS stops, so the question is not only
 * "is the new thing focusable" but "what moved". This prints the sequence so a before and an after can
 * be diffed, and counts the click targets a keyboard still cannot reach.
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });
const p = await b.newPage();
await p.goto('http://localhost:5183/overview/chat/llm', { waitUntil: 'domcontentloaded', timeout: 90000 });
await p.waitForSelector('.chat-themed', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4200));

const describe = () =>
  p.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34);
    return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''} ${JSON.stringify(label)}`;
  });

/* Walk far enough to leave the app taskbar and reach the chat itself, and do NOT stop on a repeated
   label — several controls are icon-only and describe identically without being the same stop. The
   wrap is detected by returning to the FIRST stop instead. */
const seq = [];
for (let i = 0; i < 90; i += 1) {
  await p.keyboard.press('Tab');
  const d = await describe();
  if (!d) break;
  if (seq.length > 4 && d === seq[0]) break;
  seq.push(d);
}

/*
 * Count OUTERMOST targets only. The first version counted every pointer-cursor div, and a click
 * target's children INHERIT `cursor: pointer` — so one disclosure header with a title, a count line
 * and a favicon stack inside it reported as nine separate unreachable targets. Making that header a
 * button dropped the number from 13 to 4, which looked like nine fixes and was one.
 */
const unreachable = await p.evaluate(() => {
  const isTarget = (el) =>
    getComputedStyle(el).cursor === 'pointer' &&
    !el.getAttribute('role') &&
    !el.hasAttribute('tabindex') &&
    !el.closest('button,[role="button"],a[href]');
  const out = [];
  for (const el of document.querySelectorAll('.chat-themed div[class]')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (!isTarget(el)) continue;
    let nested = false;
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (n.tagName === 'DIV' && n.classList.length && isTarget(n)) { nested = true; break; }
    }
    if (nested) continue;
    /*
     * The other false positive, found the same way as the nesting one: a CONTAINER that carries
     * `cursor: pointer` while the thing you actually click is a focusable child. The history list's
     * rows are the case — the div takes `onPointerDown` for dragging and the row's button sits
     * inside it, already reachable. Flagging the wrapper reported a defect that was not there.
     */
    if (el.querySelector('button, [role="button"], a[href], [tabindex]')) continue;
    out.push({ w: +r.width.toFixed(0), h: +r.height.toFixed(0), label: (el.textContent || '').trim().slice(0, 30) });
  }
  return out;
});

console.log(`tab stops (first ${seq.length}):`);
seq.forEach((d, i) => console.log(`  ${String(i + 1).padStart(2)}. ${d}`));
console.log(`\ndistinct click targets a keyboard cannot reach: ${unreachable.length}`);
for (const u of unreachable) console.log(`  ${u.w}x${u.h}  ${JSON.stringify(u.label)}`);
await b.close();

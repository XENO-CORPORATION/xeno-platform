/*
 * §3.4 says appearance classes come OFF when a control is converted — the component owns its box, so
 * a surviving `h-`, `p-`, `rounded-` or `bg-` is either a missed conversion or a gap someone patched
 * at the call site and did not record.
 *
 * A static grep for those classes finds nothing, but it can only see literal `className` strings: a
 * conditional, a shared const or an interpolation hides one completely. So this asks the rendered
 * page instead, which cannot be evaded — every adopted control is measured against what its OWN size
 * token says it should be, and anything overriding it shows up as a difference rather than as a
 * class.
 *
 * The scale, from the library's `size.css`: xs 24 · sm 28 · md 32 · lg 36, and the radius is
 * `--xeno-radius-control` for every one of them.
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
  const rows = [];
  for (const el of document.querySelectorAll('.chat-themed .xeno-btn, .chat-themed .xeno-input, .chat-themed .xeno-textarea')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    /*
     * `offsetHeight`, not the rect. A rect includes TRANSFORMS, and the composer's voice chevron
     * rests at `scale(0.92)` until the microphone is hovered — 28 x 0.92 = 25.8, which read as a
     * control drifting from its size token and was a reveal doing its job. A probe that reads
     * rendered geometry cannot tell intent from accident; the layout box can.
     */
    const layoutH = el.offsetHeight;
    const cs = getComputedStyle(el);
    const declared = parseFloat(cs.getPropertyValue('--xeno-h')) || null;
    const radius = cs.getPropertyValue('--xeno-radius-control').trim();
    const isTextarea = el.classList.contains('xeno-textarea');
    rows.push({
      kind: el.classList.contains('xeno-input') ? 'input' : isTextarea ? 'textarea' : 'button',
      size: el.getAttribute('data-xeno-size'),
      variant: el.getAttribute('data-variant'),
      declaredH: declared,
      actualH: layoutH,
      paintedH: +r.height.toFixed(1),
      declaredR: radius,
      actualR: cs.borderTopLeftRadius,
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24),
      // A textarea sets its own height by rows/min-height, so only the button/input scale applies.
      scaled: !isTextarea,
    });
  }
  return rows;
});

const drift = out.filter((r) => r.scaled && r.declaredH && Math.abs(r.actualH - r.declaredH) > 0.5);
const radiusDrift = out.filter((r) => r.scaled && r.declaredR && r.actualR !== r.declaredR);

console.log(`adopted controls measured: ${out.length}`);
console.log(`height differing from the size token: ${drift.length}`);
for (const d of drift) console.log(`  ${d.kind} ${d.size}/${d.variant}  declared ${d.declaredH} actual ${d.actualH}  ${JSON.stringify(d.label)}`);
console.log(`radius differing from --xeno-radius-control: ${radiusDrift.length}`);
for (const d of radiusDrift) console.log(`  ${d.kind} ${d.size}/${d.variant}  declared ${d.declaredR} actual ${d.actualR}  ${JSON.stringify(d.label)}`);
await b.close();

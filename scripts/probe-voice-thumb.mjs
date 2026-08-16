/* Measure the hold-to-record thumb against its track. The popover is only reachable on mic hover, so
   the switch is rebuilt here from the exact classes in ChatWithLLM and measured in isolation. */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:5183/overview/chat/llm', { waitUntil: 'domcontentloaded', timeout: 90000 });
await new Promise((r) => setTimeout(r, 4000));

const out = await p.evaluate(() => {
  const host = document.createElement('div');
  host.className = 'chat-themed';
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
  const mk = (active) => `
    <button class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-md border p-[2px] ${
      active ? 'border-[var(--chat-text)] bg-[var(--chat-text)]' : 'border-[var(--chat-border)] bg-[var(--chat-canvas)]'
    }" data-t="${active ? 'on' : 'off'}">
      <span class="pointer-events-none absolute left-[2px] top-1/2 block rounded-[3px] ${
        active ? 'h-3 w-3 translate-x-[10px] -translate-y-1/2 bg-[var(--chat-elevated)]'
               : 'h-2.5 w-2.5 translate-x-0 -translate-y-1/2 bg-[var(--chat-text)]'
      }" data-k></span>
    </button>`;
  host.innerHTML = mk(false) + mk(true);
  document.body.appendChild(host);
  const read = (sel) => {
    const t = host.querySelector(sel);
    const k = t.querySelector('[data-k]');
    const tr = t.getBoundingClientRect(), kr = k.getBoundingClientRect();
    const cs = getComputedStyle(t);
    const bl = parseFloat(cs.borderLeftWidth), br = parseFloat(cs.borderRightWidth);
    const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
    return {
      track: +tr.width.toFixed(2), thumb: +kr.width.toFixed(2),
      gapLeft: +(kr.left - tr.left).toFixed(2),
      gapRight: +(tr.right - kr.right).toFixed(2),
      innerLeft: bl + pl, innerRight: br + pr,
    };
  };
  const r = { off: read('[data-t="off"]'), on: read('[data-t="on"]') };
  host.remove();
  return r;
});
console.log(JSON.stringify(out, null, 1));
console.log('\ninactive: left gap', out.off.gapLeft, ' right gap', out.off.gapRight);
console.log('active:   left gap', out.on.gapLeft, ' right gap', out.on.gapRight);
/* A toggle's thumb sits at one END, so comparing its two gaps in a single state says nothing. The
   inset that has to match is the resting LEFT gap against the travelled RIGHT gap. */
console.log('inset matches at both ends:', out.off.gapLeft === out.on.gapRight, `(${out.off.gapLeft} / ${out.on.gapRight})`);
await b.close();

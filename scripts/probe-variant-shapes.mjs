/*
 * Seam (b): a hand-written control whose PAINTED shape already IS a variant.
 *
 * Four of these were caught hiding behind an inline `style`, each a `ghost` overridden into
 * `secondary` or `danger`. The same shapes written as plain Tailwind are the last place to look, and
 * the comparison should not be done by eye — a class list says what was typed, not what renders.
 *
 * So: read every hand-written `<button>` in the chat off the RUNNING page, and match its resting
 * fill / ink / border against what each variant computes to in the same document. Both sides are
 * measured in the same place, so no normalisation of authored-vs-computed is needed.
 *
 * A match is a CANDIDATE. The class list cannot see hover, focus, a disabled branch, or a `Stays
 * hand-written` reason naming something none of those show — every hit gets read before it is
 * converted.
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

const out = await p.evaluate(async () => {
  const root = document.querySelector('.chat-themed');

  // Render one of each variant in the same document, so both sides resolve against the same theme.
  const ref = document.createElement('div');
  ref.style.cssText = 'position:fixed;left:-9999px;top:0';
  const VARIANTS = ['primary', 'secondary', 'outline', 'quiet', 'ghost', 'danger'];
  ref.innerHTML = VARIANTS.map(
    (v) => `<button class="xeno-btn" data-xeno-size="md" data-variant="${v}" data-availability="enabled" data-v="${v}">x</button>`,
  ).join('');
  root.appendChild(ref);
  await new Promise((r) => setTimeout(r, 400)); // let the colour transitions settle

  const shape = (el) => {
    const cs = getComputedStyle(el);
    const bw = parseFloat(cs.borderTopWidth) || 0;
    return [cs.backgroundColor, cs.color, bw > 0 ? cs.borderTopColor : 'none'].join(' | ');
  };
  const variants = VARIANTS.map((v) => ({ v, shape: shape(ref.querySelector(`[data-v="${v}"]`)) }));
  ref.remove();

  const hits = [];
  for (const el of root.querySelectorAll('button')) {
    if (el.classList.contains('xeno-btn')) continue; // already adopted
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const s = shape(el);
    /* ALL matches, not the first. `quiet` and `danger` compute identically at rest — transparent
       fill, muted ink, a hairline — and differ only on hover, so a `find` would silently answer
       "quiet" to a question that has two answers. */
    const matches = variants.filter((v) => v.shape === s).map((v) => v.v);
    if (!matches.length) continue;
    hits.push({
      variant: matches.join(' or '),
      shape: s,
      h: el.offsetHeight,
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30),
      cls: String(el.className || '').slice(0, 64),
    });
  }
  return { variants, hits };
});

console.log('variant shapes, measured in this document:');
for (const v of out.variants) console.log(`  ${v.v.padEnd(10)} ${v.shape}`);
console.log(`\nhand-written buttons whose resting shape already IS a variant: ${out.hits.length}\n`);
for (const h of out.hits) console.log(`  ${h.variant.padEnd(10)} h${String(h.h).padEnd(4)} ${JSON.stringify(h.label)}\n     ${h.cls}`);
console.log('\nA match is a candidate, and a weak one. Resting shape says nothing about hover, focus or a');
console.log('disabled branch — and it is the COMPUTED shape, so a product !important rule painting a');
console.log('control makes it match a variant it has nothing to do with. That is exactly what the one');
console.log('hit here turned out to be. Read the recorded reason before converting anything.');
await b.close();

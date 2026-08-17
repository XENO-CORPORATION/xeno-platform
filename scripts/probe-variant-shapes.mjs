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
 *
 * ALL THREE THEMES, and this is the one probe where that is not diligence but the point.
 *
 * §6 measured the three single-theme probes and found metrics, target size and tab order identical
 * across dark and light — geometry does not care. This one compares COLOURS, and §9 records that each
 * theme collapses a different pair of tokens: dark has `elevated == control` (#262626), light has
 * `elevated == canvas` (#ffffff), dim has neither. A collision is exactly what makes two things that
 * are different look the same, so a single-theme run of this probe has both failure directions at
 * once — it can miss a real match, and it can invent one.
 *
 * Which is why the answer is reported as ALL-THREE versus SOME. A button matching a variant in every
 * theme is tracking that variant's tokens. A button matching in one is sitting on that theme's
 * collision, and converting it would break the other two.
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;

const VARIANTS = ['primary', 'secondary', 'outline', 'quiet', 'ghost', 'danger'];
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });

const measure = async (theme) => {
  const p = await b.newPage();
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  /* Seed BEFORE any script runs — the chat persists its theme on mount and clobbers a later write.
     Same construction as probe-control-fill; a page per theme rather than a live switch, because a
     switch leaves colour transitions in flight and the whole probe reads resting colour. */
  await p.evaluateOnNewDocument((t) => localStorage.setItem('xeno-chat-theme', t), theme);
  await p.goto('http://localhost:5183/overview/chat/llm', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForSelector('.chat-themed', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4200));

  const out = await p.evaluate(async (VARIANTS) => {
    const root = document.querySelector('.chat-themed');

    // Render one of each variant in the same document, so both sides resolve against the same theme.
    const ref = document.createElement('div');
    ref.style.cssText = 'position:fixed;left:-9999px;top:0';
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
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      const cls = String(el.className || '').slice(0, 64);
      hits.push({ key: `${label}##${cls}`, variant: matches.join(' or '), shape: s, h: el.offsetHeight, label, cls });
    }
    return { variants, hits };
  }, VARIANTS);

  await p.close();
  return out;
};

const THEMES = ['dark', 'dim', 'light'];
const byTheme = new Map();
for (const theme of THEMES) {
  const out = await measure(theme);
  byTheme.set(theme, out);
  console.log(`\n${theme} — variant shapes measured in this document:`);
  for (const v of out.variants) console.log(`  ${v.v.padEnd(10)} ${v.shape}`);
  console.log(`  hand-written buttons whose resting shape matches one: ${out.hits.length}`);
  for (const h of out.hits) console.log(`    ${h.variant.padEnd(18)} h${String(h.h).padEnd(4)} ${JSON.stringify(h.label)}`);
}

/* Keyed on label + class rather than on shape: the shape is what CHANGES between themes, so keying on
   it would make every button look like a different button in each theme and the intersection would
   always be empty. */
const seen = new Map();
for (const theme of THEMES) {
  for (const h of byTheme.get(theme).hits) {
    if (!seen.has(h.key)) seen.set(h.key, { ...h, themes: [] });
    seen.get(h.key).themes.push(theme);
  }
}
const all = [...seen.values()].filter((h) => h.themes.length === THEMES.length);
const some = [...seen.values()].filter((h) => h.themes.length < THEMES.length);

console.log(`\nmatching a variant in ALL three themes: ${all.length}`);
for (const h of all) console.log(`  ${h.variant.padEnd(18)} ${JSON.stringify(h.label)}\n     ${h.cls}`);
console.log(`matching in SOME themes only: ${some.length}`);
for (const h of some) console.log(`  ${h.themes.join('+').padEnd(18)} ${h.variant.padEnd(14)} ${JSON.stringify(h.label)}`);

console.log('\nA match is a candidate, and a weak one. Resting shape says nothing about hover, focus or a');
console.log('disabled branch — and it is the COMPUTED shape, so a product !important rule painting a');
console.log('control makes it match a variant it has nothing to do with. That is exactly what the one');
console.log('all-three hit here turned out to be. Read the recorded reason before converting anything.');
console.log('A SOME-themes hit is the weaker kind again: it is riding a token collision that exists in');
console.log('those themes and not the others, so converting it would fix one theme and break two.');
await b.close();

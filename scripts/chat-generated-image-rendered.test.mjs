/**
 * The generated-image frame, RENDERED — the built stylesheet in a real browser.
 *
 * chat-generated-image.test.mjs proves the component emits the right markup and states in a DOM;
 * whether the frame is really the image's shape, whether its placeholder paints in each palette and
 * whether it animates are decided by stylesheets winning on specificity, and only a browser resolves
 * that. Runs after `npm run build`, like the other *-rendered gates.
 *
 *   - a 16:9 placeholder is 16:9 at the full column width, a 9:16 one is narrowed, a square is square;
 *   - the frame reads as a surface in light, dim and dark — its border and ground come from the
 *     chat tokens, so it is neither invisible on dark nor a black hole on light;
 *   - the glint sweeps, and stops under "reduce motion";
 *   - the download control is hidden until hover/focus and always shown on touch.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const dist = 'dist/assets';
if (!existsSync(dist)) {
  console.log('SKIP chat-generated-image-rendered: dist/assets is missing — it runs after `npm run build` in the build stage');
  process.exit(0);
}
const cssFiles = readdirSync(dist).filter((f) => f.endsWith('.css')).sort((a, b) => (a.startsWith('index-') ? -1 : b.startsWith('index-') ? 1 : a.localeCompare(b)));
const css = cssFiles.map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');
if (!css.includes('.chat-genimage-frame')) {
  console.log('✘ the built CSS carries no .chat-genimage-frame — the stylesheet was not bundled');
  process.exit(1);
}

/* The markup ChatGeneratedImages renders for each state. Kept in step with the component by the
   source check at the bottom. */
const generating = (aspect, ratio, maxWidth) => `
  <figure class="chat-genimage" data-genimage-state="generating" data-aspect="${aspect}" style="max-width:${maxWidth}px">
    <div class="chat-genimage-frame" style="aspect-ratio:${ratio}">
      <span class="chat-genimage-shimmer" role="status" aria-live="polite">
        <span class="chat-genimage-glint" aria-hidden="true"></span>
        <span class="chat-genimage-caption">Creating image</span>
      </span>
    </div>
  </figure>`;
const ready = `
  <figure class="chat-genimage" data-genimage-state="preview" data-aspect="1:1" style="max-width:560px">
    <div class="chat-genimage-frame" style="aspect-ratio:1">
      <img class="chat-genimage-img" alt="x" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Crect width='10' height='10' fill='%23446'/%3E%3C/svg%3E">
      <button type="button" class="chat-genimage-open" aria-label="Open image"></button>
      <span class="chat-genimage-actions"><button type="button" class="chat-genimage-action" aria-label="Download image">D</button></span>
    </div>
  </figure>`;
const page = (theme, canvas) => `<section class="xeno chat-themed chat-theme-${theme}" data-theme="${theme === 'light' ? 'light' : 'dark'}" id="${theme}" style="width:700px;padding:16px;background:${canvas}">
  <div class="chat-genimages">
    ${generating('16:9', 16 / 9, 560)}
    ${generating('9:16', 9 / 16, 315)}
    ${generating('1:1', 1, 560)}
    ${ready}
  </div>
</section>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0">
${page('light', '#ffffff')}${page('dim', '#171718')}${page('dark', '#0a0a0a')}
</body></html>`;
const file = join(tmpdir(), `xeno-genimage-${process.pid}.html`);
writeFileSync(file, html);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};
/**
 * A colour as three 0..1 channels, from every form a browser reports: `#rrggbb`, `rgb()/rgba()`, and
 * `color(srgb r g b)` — the last is what Chromium returns for a `color-mix()` the frame's ground uses.
 */
const channels = (s) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255);
  const nums = (s.match(/-?[\d.]+/g) || []).map(Number);
  if (/^color\(srgb/.test(s.trim())) return nums.slice(0, 3);
  return nums.slice(0, 3).map((c) => c / 255);
};
const rgb = (s) => channels(s);
const luminance = (s) => {
  const [r, g, b] = channels(s).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const browser = await puppeteer.launch({ headless: true });
try {
  const tab = await browser.newPage();
  // headless Chromium inherits the host's reduced-motion setting; ask for motion explicitly
  await tab.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await tab.setViewport({ width: 760, height: 2400 });
  await tab.goto(pathToFileURL(file).href);
  await new Promise((r) => setTimeout(r, 300));

  const read = (id) => tab.evaluate((sectionId) => {
    const section = document.getElementById(sectionId);
    const frames = [...section.querySelectorAll('.chat-genimage-frame')];
    const box = (el) => el.getBoundingClientRect();
    const cs = (el) => getComputedStyle(el);
    const actions = section.querySelector('.chat-genimage-actions');
    return {
      sizes: frames.map((f) => ({ w: box(f).width, h: box(f).height })),
      ground: cs(frames[0]).backgroundColor,
      border: cs(frames[0]).borderTopColor,
      borderWidth: cs(frames[0]).borderTopWidth,
      radius: cs(frames[0]).borderTopLeftRadius,
      caption: cs(section.querySelector('.chat-genimage-caption')).color,
      glintAnimated: cs(section.querySelector('.chat-genimage-glint')).animationName !== 'none',
      actionsOpacity: cs(actions).opacity,
      imgFit: cs(section.querySelector('.chat-genimage-img')).objectFit,
    };
  }, id);

  for (const [theme, canvas] of [['light', '#ffffff'], ['dim', '#171718'], ['dark', '#0a0a0a']]) {
    const r = await read(theme);
    const [wide, tall, square] = r.sizes;
    check(`${theme}: a 16:9 placeholder IS 16:9 at the full 560px column`, Math.abs(wide.w - 560) < 1 && Math.abs(wide.w / wide.h - 16 / 9) < 0.02, JSON.stringify(wide));
    check(`${theme}: a 9:16 placeholder is 9:16 and narrowed to 315px, so it is not a 1000px wall`, Math.abs(tall.w - 315) < 1 && Math.abs(tall.w / tall.h - 9 / 16) < 0.02, JSON.stringify(tall));
    check(`${theme}: a square placeholder is square`, Math.abs(square.w - square.h) < 1, JSON.stringify(square));
    const groundDelta = Math.abs(luminance(r.ground) - luminance(canvas));
    check(`${theme}: the frame is a visible surface — its ground differs from the page, but only slightly`, groundDelta > 0.002 && groundDelta < 0.2, `ground=${r.ground} page=${canvas} Δ=${groundDelta.toFixed(4)}`);
    check(`${theme}: it has a hairline border from the chat token, and rounded corners`, r.borderWidth === '1px' && rgb(r.border).length >= 3 && parseFloat(r.radius) >= 12, `${r.borderWidth} ${r.border} r=${r.radius}`);
    const captionContrast = Math.abs(luminance(r.caption) - luminance(canvas));
    check(`${theme}: the caption is readable on its page`, captionContrast > 0.15, `caption=${r.caption}`);
    check(`${theme}: the placeholder glint sweeps`, r.glintAnimated);
    check(`${theme}: the download control waits for hover or focus`, r.actionsOpacity === '0', `opacity=${r.actionsOpacity}`);
    check(`${theme}: the picture fills its frame (it already has the frame's shape)`, r.imgFit === 'cover');
  }

  await tab.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const reduced = await read('dark');
  check('under reduced motion the glint stops', !reduced.glintAnimated);

  await tab.hover('#dark .chat-genimage[data-genimage-state="preview"] .chat-genimage-frame');
  const hovered = await tab.evaluate(() => getComputedStyle(document.querySelector('#dark .chat-genimage-actions')).opacity);
  check('hovering the image reveals its download control', hovered === '1', `opacity=${hovered}`);

  const source = readFileSync('src/components/playground/Chat/ChatGeneratedImage.tsx', 'utf8');
  check('ChatGeneratedImage.tsx still renders the markup this gate assumes',
    /className="chat-genimage-frame" style=\{\{ aspectRatio: `\$\{aspect\}` \}\}/.test(source)
      && /chat-genimage-shimmer/.test(source) && /chat-genimage-glint/.test(source)
      && /chat-genimage-actions/.test(source) && /maxWidth: `\$\{frameMaxWidth\(aspect\)\}px`/.test(source));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
process.exitCode = failed.length ? 1 : 0;

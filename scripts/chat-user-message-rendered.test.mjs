/**
 * A long user message COLLAPSES — the built stylesheet, in a real browser.
 *
 * A pasted transcript or console dump is a real user message that must be kept whole, but shown in
 * full it pushes the reply and every earlier turn off the screen (2026-09-26: a user sent a ~6 KB
 * message and lost the conversation above it). ChatUserMessage clamps a tall message to a few lines
 * with a fade and a "Show more"; the full text stays in the DOM so Copy and Edit are unaffected.
 *
 * Whether the clamp actually bounds the height, whether the fade reads, and whether the toggle is a
 * legible control in every palette are decided by stylesheets winning on specificity — only a browser
 * resolves that. Runs after `npm run build`, like the other *-rendered gates.
 *
 *   - a clamped body is bounded well below its full content height, and its overflow is hidden;
 *   - an un-clamped (expanded / short) body shows its whole height;
 *   - the toggle is readable on the bubble in light, dim and dark;
 *   - the collapse is CSS, so the FULL text is present in the DOM either way (Copy/Edit read it).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const dist = 'dist/assets';
if (!existsSync(dist)) {
  console.log('SKIP chat-user-message-rendered: dist/assets is missing — it runs after `npm run build` in the build stage');
  process.exit(0);
}
const css = readdirSync(dist).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');
if (!css.includes('.chat-usermsg-text')) {
  console.log('✘ the built CSS carries no .chat-usermsg-text — the stylesheet was not bundled');
  process.exit(1);
}

const LONG = Array.from({ length: 60 }, (_, i) => `line ${i + 1} of a very long pasted message that must be clamped`).join('\n');
const SHORT = 'a short question';

/* The markup ChatUserMessage renders, inside the bubble body the shared element provides. Kept in
   step with the component by the source check at the bottom. */
const bubble = (clamped, withToggle, body) => `
  <div class="xeno-message" data-role="user">
    <div class="xeno-message-body">
      <div class="chat-usermsg"${clamped ? '' : ' data-expanded'}>
        <div class="chat-usermsg-text"${clamped ? ' data-clamped' : ''}>${body.replace(/\n/g, '<br>')}</div>
        ${withToggle ? `<button type="button" class="chat-usermsg-toggle" aria-expanded="${!clamped}">${clamped ? 'Show more' : 'Show less'}</button>` : ''}
      </div>
    </div>
  </div>`;
const page = (theme, canvas) => `<section class="xeno chat-themed chat-theme-${theme}" data-theme="${theme === 'light' ? 'light' : 'dark'}" id="${theme}" style="width:760px;padding:16px;background:${canvas}">
  <div id="clamped">${bubble(true, true, LONG)}</div>
  <div id="expanded">${bubble(false, true, LONG)}</div>
  <div id="short">${bubble(false, false, SHORT)}</div>
</section>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0">
${page('light', '#ffffff')}${page('dim', '#171718')}${page('dark', '#0a0a0a')}
</body></html>`;
const file = join(tmpdir(), `xeno-usermsg-${process.pid}.html`);
writeFileSync(file, html);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✘'} ${name}${detail && !ok ? ` — ${detail}` : ''}`); };
const channels = (s) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255);
  const nums = (s.match(/-?[\d.]+/g) || []).map(Number);
  if (/^color\(srgb/.test(s.trim())) return nums.slice(0, 3);
  return nums.slice(0, 3).map((c) => c / 255);
};
const luminance = (s) => { const [r, g, b] = channels(s).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

const browser = await puppeteer.launch({ headless: true });
try {
  const tab = await browser.newPage();
  await tab.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await tab.setViewport({ width: 820, height: 2600 });
  await tab.goto(pathToFileURL(file).href);
  await new Promise((r) => setTimeout(r, 200));

  const read = (id) => tab.evaluate((sectionId) => {
    const section = document.getElementById(sectionId);
    const clampedText = section.querySelector('#clamped .chat-usermsg-text');
    const expandedText = section.querySelector('#expanded .chat-usermsg-text');
    const toggle = section.querySelector('#clamped .chat-usermsg-toggle');
    const cs = (el) => getComputedStyle(el);
    return {
      clampedClient: clampedText.clientHeight,
      clampedScroll: clampedText.scrollHeight,
      clampedMask: cs(clampedText).maskImage || cs(clampedText).webkitMaskImage,
      expandedClient: expandedText.clientHeight,
      expandedScroll: expandedText.scrollHeight,
      clampedFullText: clampedText.innerText.replace(/\s+/g, ' ').trim().length,
      toggleColor: cs(toggle).color,
      canvas: cs(section).backgroundColor,
    };
  }, id);

  for (const theme of ['light', 'dim', 'dark']) {
    const r = await read(theme);
    check(`${theme}: a clamped message is bounded well below its content, and hides the overflow`,
      r.clampedClient > 0 && r.clampedScroll > r.clampedClient + 40 && r.clampedClient < 260, JSON.stringify({ c: r.clampedClient, s: r.clampedScroll }));
    check(`${theme}: an expanded message shows its whole height (no clamp)`,
      Math.abs(r.expandedClient - r.expandedScroll) <= 2, JSON.stringify({ c: r.expandedClient, s: r.expandedScroll }));
    check(`${theme}: the clamp fades rather than hard-cuts (mask-image set)`, /gradient/.test(r.clampedMask || ''), r.clampedMask);
    check(`${theme}: collapse is CSS — the FULL text stays in the DOM (Copy/Edit read it)`, r.clampedFullText > 800, `len=${r.clampedFullText}`);
    const contrast = Math.abs(luminance(r.toggleColor) - luminance(r.canvas));
    check(`${theme}: the Show more toggle is readable on its bubble`, contrast > 0.1, `toggle=${r.toggleColor}`);
  }

  const source = readFileSync('src/components/playground/Chat/ChatUserMessage.tsx', 'utf8').replace(/\r\n/g, '\n');
  check('ChatUserMessage.tsx still emits the markup this gate assumes', /className="chat-usermsg-text"/.test(source) && /data-clamped=/.test(source) && /className="chat-usermsg-toggle"/.test(source));
  check('ChatUserMessage.tsx MEASURES overflow (it is not a dead clamp that never toggles)', /scrollHeight\s*-\s*el\.clientHeight/.test(source) && /ResizeObserver/.test(source));
  const chat = readFileSync('src/components/playground/Chat/ChatWithLLM.tsx', 'utf8').replace(/\r\n/g, '\n');
  check('ChatWithLLM renders the user body through ChatUserMessage', /<ChatUserMessage text=\{message\.text\} \/>/.test(chat));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
process.exitCode = failed.length ? 1 : 0;

/**
 * The in-chat code-execution block, RENDERED — the built stylesheet in a real browser.
 *
 * chat-turn-transcript.test.mjs proves the component's DATA (folding events into `code` steps and the
 * run_code tool call); whether the block reads as a surface in each palette, whether stderr is
 * distinguishable from stdout, whether the copy control hides until hover and whether the spinner
 * animates are decided by stylesheets winning on specificity, and only a browser resolves that. Runs
 * after `npm run build`, like the other *-rendered gates.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const dist = 'dist/assets';
if (!existsSync(dist)) {
  console.log('SKIP chat-code-execution-rendered: dist/assets is missing — it runs after `npm run build` in the build stage');
  process.exit(0);
}
const cssFiles = readdirSync(dist).filter((f) => f.endsWith('.css')).sort((a, b) => (a.startsWith('index-') ? -1 : b.startsWith('index-') ? 1 : a.localeCompare(b)));
const css = cssFiles.map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');
if (!css.includes('.chat-code')) {
  console.log('✘ the built CSS carries no .chat-code — the stylesheet was not bundled');
  process.exit(1);
}

/* The markup ChatCodeExecution renders, kept in step with the component by the source check below. */
const run = (state, extras = '') => `
  <div class="chat-code" data-code-state="${state}">
    <div class="chat-code-header">
      <button type="button" class="chat-code-toggle" aria-expanded="true">▾<span class="chat-code-lang-icon">T</span><span class="chat-code-lang">Python</span></button>
      <span class="chat-code-status" data-code-state="${state}">${state === 'running' ? '<span class="chat-code-spin">o</span>Running' : state === 'error' ? 'Exit 1' : 'Done'}</span>
    </div>
    <div class="chat-code-body">
      <div class="chat-code-source">
        <button type="button" class="chat-code-copy">C</button>
        <pre class="chat-code-pre"><code>print(2 + 2)</code></pre>
      </div>
      ${extras}
    </div>
  </div>`;
const output = `
  <div class="chat-code-output">
    <pre class="chat-code-stdout"><code>4</code></pre>
    <pre class="chat-code-stderr"><code>Traceback (most recent call last)</code></pre>
  </div>
  <div class="chat-code-files">
    <span class="chat-code-file" data-openable="true"><span class="chat-code-file-icon">F</span><button type="button" class="chat-code-file-name">out.csv</button><button type="button" class="chat-code-file-download">D</button></span>
  </div>`;
const page = (theme, canvas) => `<section class="xeno chat-themed chat-theme-${theme}" data-theme="${theme === 'light' ? 'light' : 'dark'}" id="${theme}" style="width:760px;padding:16px;background:${canvas}">
  <div class="chat-codes">
    ${run('running')}
    ${run('success', output)}
    ${run('error', output)}
  </div>
</section>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0">
${page('light', '#ffffff')}${page('dim', '#171718')}${page('dark', '#0a0a0a')}
</body></html>`;
const file = join(tmpdir(), `xeno-codeexec-${process.pid}.html`);
writeFileSync(file, html);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};
const channels = (s) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255);
  const nums = (s.match(/-?[\d.]+/g) || []).map(Number);
  if (/^color\(srgb/.test(s.trim())) return nums.slice(0, 3);
  return nums.slice(0, 3).map((c) => c / 255);
};
const luminance = (s) => {
  const [r, g, b] = channels(s).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const browser = await puppeteer.launch({ headless: true });
try {
  const tab = await browser.newPage();
  await tab.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await tab.setViewport({ width: 820, height: 2600 });
  await tab.goto(pathToFileURL(file).href);
  await new Promise((r) => setTimeout(r, 300));

  const read = (id) => tab.evaluate((sectionId) => {
    const section = document.getElementById(sectionId);
    const cs = (sel) => { const el = section.querySelector(sel); return el ? getComputedStyle(el) : null; };
    const block = cs('.chat-code');
    return {
      ground: block.backgroundColor,
      border: block.borderTopColor,
      borderWidth: block.borderTopWidth,
      radius: block.borderTopLeftRadius,
      preFont: cs('.chat-code-pre').fontFamily,
      preWhite: cs('.chat-code-pre').whiteSpace,
      stdoutColor: cs('.chat-code-stdout').color,
      stderrColor: cs('.chat-code-stderr').color,
      statusOkColor: (() => { const el = [...section.querySelectorAll('.chat-code-status')].find((e) => e.dataset.codeState === 'success'); return el ? getComputedStyle(el).color : ''; })(),
      statusErrColor: (() => { const el = [...section.querySelectorAll('.chat-code-status')].find((e) => e.dataset.codeState === 'error'); return el ? getComputedStyle(el).color : ''; })(),
      copyOpacity: cs('.chat-code-copy').opacity,
      spinAnimated: cs('.chat-code-spin').animationName !== 'none',
    };
  }, id);

  for (const [theme, canvas] of [['light', '#ffffff'], ['dim', '#171718'], ['dark', '#0a0a0a']]) {
    const r = await read(theme);
    const groundDelta = Math.abs(luminance(r.ground) - luminance(canvas));
    check(`${theme}: the block is a visible surface — its ground differs from the page, but only slightly`, groundDelta > 0.001 && groundDelta < 0.25, `ground=${r.ground} page=${canvas} Δ=${groundDelta.toFixed(4)}`);
    check(`${theme}: it has a hairline border from the chat token and rounded corners`, r.borderWidth === '1px' && channels(r.border).length >= 3 && parseFloat(r.radius) >= 12, `${r.borderWidth} ${r.border} r=${r.radius}`);
    check(`${theme}: the source is monospace and does not wrap`, /mono/i.test(r.preFont) && r.preWhite === 'pre', `${r.preFont} ${r.preWhite}`);
    check(`${theme}: stderr is distinguishable from stdout — a failure reads differently from output`, r.stderrColor !== r.stdoutColor, `stdout=${r.stdoutColor} stderr=${r.stderrColor}`);
    check(`${theme}: a failed run's status reads differently from a done one`, r.statusErrColor !== r.statusOkColor, `ok=${r.statusOkColor} err=${r.statusErrColor}`);
    check(`${theme}: the copy control waits for hover`, r.copyOpacity === '0', `opacity=${r.copyOpacity}`);
    check(`${theme}: the running spinner turns`, r.spinAnimated);
  }

  await tab.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const reduced = await tab.evaluate(() => getComputedStyle(document.querySelector('#dark .chat-code-spin')).animationName !== 'none');
  check('under reduced motion the spinner stops', !reduced);

  await tab.hover('#dark .chat-code-source');
  await new Promise((r) => setTimeout(r, 250)); // the reveal fades in (120ms) — let it settle
  const hovered = await tab.evaluate(() => getComputedStyle(document.querySelector('#dark .chat-code-copy')).opacity);
  check('hovering the source reveals its copy control', Number(hovered) > 0.5, `opacity=${hovered}`);

  const source = readFileSync('src/components/playground/Chat/ChatCodeExecution.tsx', 'utf8');
  check('ChatCodeExecution.tsx still renders the markup this gate assumes',
    /className="chat-code" data-code-state=/.test(source)
      && /chat-code-status/.test(source) && /chat-code-pre/.test(source)
      && /chat-code-stdout/.test(source) && /chat-code-stderr/.test(source)
      && /chat-code-copy/.test(source) && /chat-code-spin/.test(source)
      && /chat-code-file/.test(source));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
process.exitCode = failed.length ? 1 : 0;

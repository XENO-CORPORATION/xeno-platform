/**
 * A `.focus-self` field, focused, draws NO outline and NO ring — measured in a real browser, with
 * the site's REAL stylesheets, INSIDE the platform shell.
 *
 * ## Why a render and not a grep (2026-09-18)
 *
 * The chat's edit field kept a 2px white stroke on focus through four source-level fixes — an
 * accent border, a focus-within ring, the browser's own textarea border and the plate itself were
 * each removed, and the stroke stayed. Every one of those reads was true of the CSS and wrong
 * about the page: the chat mounts inside `[data-overview-shell]`, whose `platform-theme.css`
 * gives every `input/select/textarea` its own `:focus-visible` outline at (0,2,0) — the same
 * specificity as `.focus-self:focus-visible` — and loads later, so it won. A grep of one
 * stylesheet cannot see a rule in another; a focused element's computed style can.
 *
 * So this gate builds the page (every emitted stylesheet, in order), mounts the composer's and
 * the edit field's exact markup inside the shell, focuses each by click AND by keyboard, and
 * reads what the browser would paint: outline transparent or none, box-shadow with no visible
 * spread, and no ancestor whose border changed because the field took focus.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const dist = 'dist/assets';
if (!existsSync(dist)) {
  // `npm test` runs BEFORE the build in gates.yml, so an absent dist is expected there; the gate
  // is then run for real in the build stage (gates.yml + ci-local.mjs), right after `npm run build`.
  console.log('SKIP focus-self-rendered: dist/assets is missing — it runs after `npm run build` in the build stage');
  process.exit(0);
}
// The shell's focus-ring token is an INLINE style (`buildPlatformThemeStyle` in
// `src/platform/platformTheme.ts`), not a stylesheet value, so the harness sets it the way the
// app does. Without it `outline: 2px solid var(--xeno-theme-focus-ring)` is invalid at computed
// value and resolves to `initial` (`medium none currentColor`) — a control that can never ring,
// which is how the first run of this gate reported `outline: rgb(255,255,255) none 3px`.
// index first, then the rest in name order — the order the app loads them is index then chunks
const cssFiles = readdirSync(dist).filter((f) => f.endsWith('.css')).sort((a, b) => (a.startsWith('index-') ? -1 : b.startsWith('index-') ? 1 : a.localeCompare(b)));
const css = cssFiles.map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');
const chat = readFileSync('src/components/playground/Chat/ChatWithLLM.tsx', 'utf8');
const editClass = /className="(focus-self min-h-\[2\.75rem\] w-full resize-y[^"]*)"/.exec(chat)?.[1];
const composerClass = /className=\{`(focus-self w-full resize-none border-none[^`]*?)\$\{/.exec(chat)?.[1];
if (!editClass || !composerClass) { console.error('could not find the edit or composer textarea classes in ChatWithLLM.tsx'); process.exit(1); }

const html = `<!doctype html><html class="dark"><head><meta charset="utf-8"><style>${css}</style></head>
<body style="background:#0a0a0a;padding:40px">
<div data-overview-shell data-theme="dark" class="chat-themed chat-theme-dark" style="--xeno-theme-focus-ring: color-mix(in srgb, #ffffff 52%, transparent)">
  <div class="chat-message-editor flex w-full flex-col gap-2 rounded-xl border border-[var(--chat-border)] bg-[var(--chat-surface)] p-2 text-[var(--chat-text)]">
    <div id="plate" class="rounded-lg border border-[var(--chat-border)] bg-[var(--chat-canvas)]/40 px-2.5 py-2">
      <textarea id="edit" class="${editClass}" rows="1">hello</textarea>
    </div>
  </div>
  <div data-chat-composer-shell class="chat-composer-shell" style="margin-top:40px;border:1px solid var(--chat-border);padding:8px">
    <textarea id="composer" class="${composerClass} min-h-[3rem]" rows="2"></textarea>
  </div>
</div></body></html>`;
const file = join(tmpdir(), `xeno-focus-self-${process.pid}.html`);
writeFileSync(file, html);

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '✔' : '✖'} ${name}${ok ? '' : ` — ${detail}`}`); };

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 400 });
  await page.goto(pathToFileURL(file).href);

  const snapshot = (id) => page.evaluate((id) => {
    const el = document.getElementById(id);
    const pick = (n) => { const c = getComputedStyle(n); return { outline: c.outline, outlineWidth: c.outlineWidth, outlineStyle: c.outlineStyle, outlineColor: c.outlineColor, boxShadow: c.boxShadow, borderColor: c.borderColor }; };
    const chain = []; let n = el; while (n && n !== document.body) { chain.push({ id: n.id || n.tagName.toLowerCase(), ...pick(n) }); n = n.parentElement; }
    return { active: document.activeElement === el, fv: el.matches(':focus-visible'), chain };
  }, id);

  const visibleOutline = (s) => s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && !/rgba\(\d+, \d+, \d+, 0\)$/.test(s.outlineColor);
  const visibleShadow = (s) => s.boxShadow !== 'none' && /\d+px \d+px \d+px [1-9]\d*px/.test(s.boxShadow);

  for (const id of ['edit', 'composer']) {
    const before = await snapshot(id);
    await page.click(`#${id}`);
    await new Promise((r) => setTimeout(r, 80));
    const clicked = await snapshot(id);
    check(`${id}: focused by click, and :focus-visible matches (a text field always does)`, clicked.active && clicked.fv);
    check(`${id}: no visible outline on the field when focused`, !visibleOutline(clicked.chain[0]), JSON.stringify(clicked.chain[0]));
    check(`${id}: no visible box-shadow ring on the field when focused`, !visibleShadow(clicked.chain[0]), clicked.chain[0].boxShadow);
    for (let i = 1; i < clicked.chain.length; i += 1) {
      const b = before.chain[i], a = clicked.chain[i];
      check(`${id}: ancestor ${a.id} paints nothing extra because the field took focus`, a.borderColor === b.borderColor && a.boxShadow === b.boxShadow && !visibleOutline(a), `${JSON.stringify(b)} → ${JSON.stringify(a)}`);
    }
    // keyboard focus is the other path to :focus-visible
    await page.keyboard.press('Tab'); await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    await new Promise((r) => setTimeout(r, 80));
    const keyed = await snapshot(id);
    check(`${id}: focused by keyboard — still no visible outline`, keyed.active && !visibleOutline(keyed.chain[0]), JSON.stringify(keyed.chain[0]));
  }

  // the control that proves the gate can fail: a plain textarea inside the shell DOES get the ring
  await page.evaluate(() => { const t = document.createElement('textarea'); t.id = 'plain'; document.querySelector('[data-overview-shell]').prepend(t); });
  await page.focus('#plain'); // programmatic focus on a text field is :focus-visible in Chromium
  await new Promise((r) => setTimeout(r, 80));
  const plain = await snapshot('plain');
  check('control: a plain textarea in the shell takes the shell ring (the gate can tell a ring from none)', plain.active && plain.fv && visibleOutline(plain.chain[0]), JSON.stringify(plain));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} gates passed`);
if (failed) process.exitCode = 1;

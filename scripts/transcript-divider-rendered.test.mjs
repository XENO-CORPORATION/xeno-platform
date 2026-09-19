/**
 * The clock line's divider waits for the thing it separates.
 *
 * A separator with nothing on its right is a dangling line: the library shows `.xa-vr` whenever a
 * collapsed turn is live, so a plain model (no steps) drew `▪ Working for 2s │` for the whole turn.
 * chat-theme.css re-derives it from the ticker's CONTENT.
 *
 * Why a rendered gate: the rule that hides the divider lives in a stylesheet shipped by another
 * package and is beaten only on specificity, so a source grep proves a string exists and nothing
 * about which rule WINS. Only a browser resolves that. Runs after `npm run build`, like
 * focus-self-rendered and effort-menu-rendered.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const dist = 'dist/assets';
if (!existsSync(dist)) {
  console.log('SKIP transcript-divider-rendered: dist/assets is missing — it runs after `npm run build` in the build stage');
  process.exit(0);
}
const cssFiles = readdirSync(dist).filter((f) => f.endsWith('.css')).sort((a, b) => (a.startsWith('index-') ? -1 : b.startsWith('index-') ? 1 : a.localeCompare(b)));
const css = cssFiles.map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');

/*
 * The clock line's anatomy as ClockLine renders it (Transcript.js): the dot, the reading, then the
 * divider, the ticker and the chevron — every element always present, the stylesheet deciding what
 * shows. The ticker's words live in `.xa-tx > .xa-t > span`, which is what "has a current step"
 * means; with no step yet React emits `.xa-tx` with no children at all.
 */
const STEP_WORDS = '<span class="xa-t xa-first">Searching the web · 3 results</span>';
const line = (words) => `
      <div class="xa-linerow">
        <div class="xa-line" data-line>
          <span class="xa-dot"></span>
          <span class="xa-read xa-num" data-read>Working for <span class="xa-n">· 4s</span></span>
          <span class="xa-vr"></span>
          <span class="xa-cur" data-cur2>
            <span class="xa-slot"><span class="xa-gl xa-first"><span class="xa-sq"></span></span></span>
            <span class="xa-tx">${words}</span>
          </span>
          <span class="xa-chev"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6" /></svg></span>
          <span class="xa-shots" data-shots></span>
        </div>
      </div>`;

/** One turn, in one state. `turn` classes are the ones TranscriptTurn decides from `live`. */
const turn = (id, { live, words, mode = 'collapsed', asking = false }) => `
  <div class="chat-themed chat-theme-dark" style="width:640px;padding:16px;background:var(--chat-canvas)">
    <div class="xa-transcript chat-turn-head${mode === 'collapsed' ? ' xa-collapsed' : ''}" id="${id}">
      <div class="xa-turn ${live ? 'xa-live xa-opening' : 'xa-done xa-bare'}${asking ? ' xa-asking' : ''}">${line(words)}</div>
    </div>
  </div>`;

const html = `<!doctype html><html class="dark"><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0">
${turn('live-empty', { live: true, words: '' })}
${turn('live-step', { live: true, words: STEP_WORDS })}
${turn('live-asking', { live: true, words: STEP_WORDS, asking: true })}
${turn('settled', { live: false, words: STEP_WORDS })}
${turn('expanded-empty', { live: true, words: '', mode: 'expanded' })}
</body></html>`;
const file = join(tmpdir(), `xeno-transcript-divider-${process.pid}.html`);
writeFileSync(file, html);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '\u2714' : '\u2718'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });
  await page.goto(pathToFileURL(file).href);
  await new Promise((r) => setTimeout(r, 700)); // past `.xa-line`'s 280ms rise + 160ms delay

  const read = (id) => page.evaluate((turnId) => {
    const root = document.getElementById(turnId);
    const vr = root.querySelector('.xa-line .xa-vr');
    const cur = root.querySelector('.xa-line .xa-cur');
    const tx = root.querySelector('.xa-line .xa-tx');
    const box = vr.getBoundingClientRect();
    return {
      display: getComputedStyle(vr).display,
      width: box.width,
      curDisplay: getComputedStyle(cur).display,
      txEmpty: tx.children.length === 0,
      background: getComputedStyle(vr).backgroundColor,
    };
  }, id);

  const empty = await read('live-empty');
  check('a live turn with NO step yet: the divider is not drawn', empty.display === 'none' && empty.width === 0, `display=${empty.display} width=${empty.width}px`);
  check('  and the ticker really is empty — that is why (the gate would pass vacuously otherwise)', empty.txEmpty === true && empty.curDisplay === 'flex', `txEmpty=${empty.txEmpty} ticker=${empty.curDisplay}`);

  const step = await read('live-step');
  check('a live turn WITH a step: the divider is drawn, separating the words from the clock', step.display === 'block' && step.width > 0, `display=${step.display} width=${step.width}px`);
  check('  and it paints its hairline, not an invisible placeholder', step.background !== 'rgba(0, 0, 0, 0)' && step.background !== 'transparent', step.background);

  const settled = await read('settled');
  check('a settled turn keeps the receipt rule it already had (this change must not touch it)', settled.display === 'none', `display=${settled.display}`);

  const asking = await read('live-asking');
  check('an ask pending stays the library\u2019s own pair rule — divider hidden even with words in the ticker', asking.display === 'none', `display=${asking.display}`);

  const expanded = await read('expanded-empty');
  check('expanded mode is untouched — the rail is open, so the line carries no divider', expanded.display === 'none', `display=${expanded.display}`);

  check('the only difference between the two live cases is the ticker\u2019s content', empty.display !== step.display && empty.txEmpty !== step.txEmpty);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
process.exitCode = failed.length ? 1 : 0;

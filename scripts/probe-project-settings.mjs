/*
 * The project settings dialog — the surface with the most decided controls, and until now the
 * largest thing no probe could see.
 *
 * §6 offers "temporarily feed a branch, screenshot, REVERT" for surfaces the mock cannot reach. That
 * turned out to be unnecessary here, and finding that out is the transferable part: `chatProjects`
 * seeds itself from localStorage (`chatProjects_playground`), so the branch can be fed from OUTSIDE
 * the app. No source edit, nothing to revert, no chance of a temporary fixture surviving into a
 * commit.
 *
 * **Check for a persisted state before editing source to reach a branch.** Several of this chat's
 * states persist, and a persisted state is one a probe can write.
 *
 * Each click checks the target is actually hittable first. A click that lands on nothing looks
 * exactly like a click that changes nothing, which cost an iteration to learn: the model trigger
 * rests at `visibility: hidden; pointer-events: none` and a null result read as "interaction reveals
 * no components".
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;

const PROJECT = {
  id: 'probe-project',
  name: 'Probe project',
  description: 'Seeded by probe-project-settings.mjs',
  createdAt: 1755000000000,
  updatedAt: 1755000000000,
  instructions: 'Think step by step.',
};

const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });

const walkTo = async (theme) => {
  const p = await b.newPage();
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await p.evaluateOnNewDocument((proj, t) => {
    localStorage.setItem('chatProjects_playground', JSON.stringify([proj]));
    localStorage.setItem('xeno-chat-theme', t);
  }, PROJECT, theme);
  await p.goto('http://localhost:5183/overview/chat/llm', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForSelector('.chat-themed', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4200));

  for (const label of ['Projects', PROJECT.name, 'Open project settings']) {
    const hit = await p.evaluate((x) => {
      const el = [...document.querySelectorAll('button,[role="button"]')].find((e) =>
        ((e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ')).includes(x),
      );
      if (!el) return 'missing';
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return 'zero box';
      const cs = getComputedStyle(el);
      /*
       * `visibility` only — NOT `pointer-events`. The check has to match the click method, and this
       * dispatches a synthetic `el.click()`, which bypasses `pointer-events` entirely. Several of the
       * rail controls rest at `pointer-events: none` until hovered, so rejecting on it would refuse
       * to click things a synthetic click reaches perfectly well. A real `page.click()` would need
       * the stricter check; the two are not interchangeable, and reusing the wrong one here reported
       * "could not reach Projects" for a control that had just been clicked successfully.
       */
      if (cs.visibility === 'hidden') return 'visibility:hidden';
      el.scrollIntoView({ block: 'center' });
      el.click();
      return 'clicked';
    }, label);
    if (hit !== 'clicked') {
      console.log(`  ${theme}: could not reach "${label}" — ${hit}`);
      await p.close();
      return null;
    }
    await new Promise((r) => setTimeout(r, 1400));
  }
  return p;
};

let worstDrift = 0;
let reached = 0;
for (const theme of ['dark', 'light']) {
  const p = await walkTo(theme);
  if (!p) continue;
  const out = await p.evaluate(() => {
    const d = document.querySelector('[data-project-settings-dialog]');
    if (!d) return null;
    const q = (s) => d.querySelectorAll(s).length;
    // The layout box, not the rect — a transform would make a correct control look drifted.
    const drift = [...d.querySelectorAll('.xeno-btn, .xeno-input, .xeno-textarea')].filter((e) => {
      const dec = parseFloat(getComputedStyle(e).getPropertyValue('--xeno-h'));
      return dec && Math.abs(e.offsetHeight - dec) > 0.5;
    }).length;
    return {
      Button: q('.xeno-btn:not(.xeno-icon-btn)'),
      IconButton: q('.xeno-icon-btn'),
      TextInput: q('.xeno-input'),
      Textarea: q('.xeno-textarea'),
      handWritten: [...d.querySelectorAll('button')].filter((e) => !e.classList.contains('xeno-btn')).length,
      drift,
    };
  });
  await p.close();
  if (!out) { console.log(`  ${theme}: dialog did not open`); continue; }
  reached += 1;
  worstDrift = Math.max(worstDrift, out.drift);
  console.log(`  ${theme}: Button ${out.Button}, IconButton ${out.IconButton}, TextInput ${out.TextInput}, Textarea ${out.Textarea}, hand-written ${out.handWritten}, height drift ${out.drift}`);
}
await b.close();
console.log(`\nproject settings dialog reached in ${reached} theme(s), worst height drift: ${worstDrift}`);

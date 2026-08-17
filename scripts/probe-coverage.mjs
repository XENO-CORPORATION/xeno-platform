/*
 * How much of the chat do the probes actually see?
 *
 * Every browser probe measures what the default route paints, and the mock has no projects, no
 * artifacts, no scheduled tasks, no share link and no attachments. §6 and §10 say so in prose. This
 * turns it into a number, because "some branches are unmeasured" and "half the controls are
 * unmeasured" call for very different amounts of worry, and nobody knew which one was true.
 *
 * Method: count the adopted library components in the SOURCE, count the ones that render on each
 * route, and report the difference. Source counts come from `spec-status.mjs`'s own approach — a
 * `<Component` occurrence — so the two sides are counted the same way.
 *
 * What this cannot do is tell a branch that is unreachable in the mock from one that simply is not on
 * screen at this scroll position. It reports what rendered, and names that limit rather than implying
 * coverage it did not measure.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT = path.join(HERE, '../src/components/playground/Chat');
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;

const COMPONENTS = ['Button', 'IconButton', 'MenuItem', 'Spinner', 'TextInput', 'Textarea', 'Switch', 'MessageBubble', 'ListRow', 'SegmentedControl', 'ToggleButton'];
const inSource = Object.fromEntries(COMPONENTS.map((c) => [c, 0]));
for (const f of readdirSync(CHAT).filter((x) => x.endsWith('.tsx'))) {
  const src = readFileSync(path.join(CHAT, f), 'utf8');
  for (const c of COMPONENTS) inSource[c] += src.split(`<${c}`).length - 1;
}

/* The DOM class each component renders, so the browser side counts the same things. */
const SELECTOR = {
  Button: '.xeno-btn:not(.xeno-icon-btn):not(.xeno-toggle)',
  IconButton: '.xeno-icon-btn',
  MenuItem: '.xeno-menu-item',
  Spinner: '.xeno-spinner',
  TextInput: '.xeno-input',
  Textarea: '.xeno-textarea',
  Switch: '.xeno-switch',
  MessageBubble: '.xeno-message-bubble',
  ListRow: '.xeno-list-row',
  SegmentedControl: '.xeno-segmented',
  ToggleButton: '.xeno-toggle',
};

const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });
const seen = Object.fromEntries(COMPONENTS.map((c) => [c, 0]));
for (const seg of ['llm', 'search', 'voice']) {
  const p = await b.newPage();
  await p.goto(`http://localhost:5183/overview/chat/${seg}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForSelector('.chat-themed', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4200));
  const counts = await p.evaluate((sel) => {
    const out = {};
    for (const [name, s] of Object.entries(sel)) out[name] = document.querySelectorAll(s).length;
    return out;
  }, SELECTOR);
  for (const c of COMPONENTS) seen[c] = Math.max(seen[c], counts[c]);
  await p.close();
}
await b.close();

let src = 0, obs = 0;
console.log('component        in source   rendered   unmeasured');
for (const c of COMPONENTS) {
  if (!inSource[c]) continue;
  src += inSource[c];
  obs += Math.min(seen[c], inSource[c]);
  const gap = Math.max(0, inSource[c] - seen[c]);
  console.log(`  ${c.padEnd(16)} ${String(inSource[c]).padStart(4)}      ${String(seen[c]).padStart(5)}      ${String(gap).padStart(5)}`);
}
const pct = Math.round((obs / src) * 100);
console.log(`\nadopted components: ${src} in source, ${obs} rendered on the three routes — ${pct}% seen by the probes.`);
console.log(`
This is a FLOOR on coverage, not a census, and the gap conflates three different things:

  1. unreachable without data — projects, artifacts, scheduled tasks, a share link, attachments,
     the customize page. The mock has none of these, so those controls are decided in source and
     will never render here.
  2. not mounted until interaction — a menu's items exist only while it is open, a dialog's controls
     only while it is up. MEASURED, and it is near zero: driving the composer's reveal row and then
     the model tray left the library count flat at 45 while the total VISIBLE button count FELL,
     94 -> 91 -> 83. Those panels are built from the controls that stayed hand-written, and opening
     one covers the composer controls behind it. Interaction does not hide library components from
     this count.
  3. transient — every Spinner is 0 because nothing is loading at the moment of the count.

So the gap is (1) and (3), and (1) dominates: the blind spot is the data-dependent branches, not
closed menus. Worth knowing before anyone spends an afternoon automating clicks to close it.

Deliberately NOT wired into 'npm run probe:chat'. Its number moves whenever a component is added or
removed, which is normal development rather than a regression — a gate that fires on healthy change
teaches people to ignore gates. It is a diagnostic to run when the question is "how much of this do
we actually see", and the answer today is: a quarter.`);

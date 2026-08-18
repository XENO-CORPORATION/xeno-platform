/*
 * Tailwind utilities written in the chat that generate NO css rule.
 *
 * A whole family of silent failures lives here, and three of them had shipped. `min-h-8` on the
 * project settings tablist asked for 32px and the element rendered at 26; `min-h-9` on its narrow
 * twin the same; `min-w-10` on the update carousel's counter meant the counter had no minimum width
 * and shifted whenever the digit count changed — beside a `tabular-nums` whose whole job is to stop
 * exactly that.
 *
 * All three are real Tailwind classes. They arrived in **3.4**, when the spacing scale was extended to
 * `min-h` / `min-w` / `max-*`, and this repo is on **3.3.0**. So the class is valid everywhere except
 * here, which is the worst version of the bug: it is correct in the docs, correct in an editor, and
 * generates nothing.
 *
 * NOTHING else catches it. Not TypeScript — a className is a string. Not the build — an ungenerated
 * class is not an error, it is simply absent. Not a unit test, not a screenshot anyone glances at:
 * `min-h-8` failing means a control is 26px instead of 32, which looks like a design decision.
 *
 * So the check has to be "does a rule exist", asked of the browser, because only the browser has the
 * generated stylesheet.
 *
 * TWO STATED LIMITS, so a green run is not read as more than it is:
 *
 *  - VARIANTS are skipped (`hover:`, `sm:`, `[&>*]:`). A variant generates a selector that does not
 *    contain the bare class name, so checking them this way would report every one of them dead.
 *  - Only tokens matching a known utility PREFIX are checked. A first pass without that mined the
 *    prose and the identifiers out of template literals and reported "the", "way." and `persona.id`
 *    as dead classes — 60-odd false positives, which is how a check gets ignored.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { CHAT_URL } from './lib/chat-origin.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT = path.join(HERE, '../src/components/playground/Chat');
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;

const PREFIX = /^(?:-?(?:m|p)[xytrbl]?-|min-[hw]-|max-[hw]-|[hw]-|size-|gap-|space-[xy]-|inset-|top-|right-|bottom-|left-|text-|font-|leading-|tracking-|bg-|border|rounded|shadow|opacity-|z-|flex-|grid-|col-|row-|items-|justify-|self-|place-|order-|basis-|grow|shrink|overflow-|whitespace-|break-|truncate$|cursor-|select-|pointer-events-|resize|transition|duration-|ease-|delay-|animate-|scale-|rotate-|translate-|skew-|origin-|blur|backdrop-|ring|outline|divide-|fill-|stroke-|aspect-|object-|columns-|line-clamp-|list-|align-|table-|caption-|scroll-|snap-|touch-|will-change-|contain-|sr-only$|not-sr-only$|absolute$|relative$|fixed$|sticky$|static$|block$|inline|flex$|grid$|hidden$|contents$|visible$|invisible$|collapse$|isolate$|antialiased$|italic$|underline$|uppercase$|lowercase$|capitalize$)/;

const uses = new Map();
for (const f of readdirSync(CHAT).filter((x) => x.endsWith('.tsx'))) {
  const src = readFileSync(path.join(CHAT, f), 'utf8');
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([\s\S]*?)`\}|\{"([^"]*)"\})/g)) {
    const body = m[1] ?? m[2] ?? m[3] ?? '';
    const line = src.slice(0, m.index).split('\n').length;
    for (const raw of body.split(/[\s\n]+/)) {
      /* A template body carries the quotes of the ternary branches inside it, so `px-2` arrives as
         `px-2'`. Strip the quotes rather than rejecting the token — rejecting it would skip most of
         the conditional classes in this file, which is where the interesting ones live. */
      const t = raw.trim().replace(/^['"`]+|['"`]+$/g, '');
      if (!t || t.includes('${') || /[{}()?A-Z]/.test(t)) continue;
      if (t.includes(':')) continue;
      if (!PREFIX.test(t)) continue;
      if (!uses.has(t)) uses.set(t, `${f}:${line}`);
    }
  }
}

const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await p.waitForSelector('.chat-themed', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));

const dead = await p.evaluate((list) => {
  const named = new Set();
  const CLASS_IN_SELECTOR = /\.((?:\\.|[\w-])+)/g;
  const walk = (rs) => {
    for (const r of rs) {
      const sel = r.selectorText;
      if (sel) for (const m of sel.matchAll(CLASS_IN_SELECTOR)) named.add(m[1].replace(/\\/g, ''));
      if (r.cssRules) { try { walk([...r.cssRules]); } catch { /* cross-origin sheet */ } }
    }
  };
  for (const s of document.styleSheets) {
    try { walk([...s.cssRules]); } catch { /* cross-origin sheet */ }
  }
  return list.filter((t) => !named.has(t));
}, [...uses.keys()]);

console.log(`plain utilities written in the chat: ${uses.size}`);
console.log(`written but NO rule generated: ${dead.length}`);
for (const d of dead.sort()) console.log(`    ${d.padEnd(28)} ${uses.get(d)}`);
if (dead.length) {
  console.log('\nEach of these is a class that does nothing. Check the Tailwind version before assuming');
  console.log('the class is wrong — the three found so far were all valid classes from a LATER version,');
  console.log('and the repair is the same value written as an arbitrary one: min-h-8 -> min-h-[32px].');
}
await b.close();

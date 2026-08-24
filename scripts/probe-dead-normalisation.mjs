/*
 * The theme-normalisation block in ChatWithLLM force-maps legacy hardcoded fills onto the chat tokens,
 * keyed on Tailwind class SUBSTRINGS — `[class*="bg-[#161618]"]` and friends. Every conversion that
 * replaces a hand-written control with a component deletes one of those classes, and the rule that
 * named it stays behind matching nothing.
 *
 * That is worse than dead code. One of its selectors was duplicated with two different answers, and
 * finding that took reading a block whose size implied every line was load-bearing. A rule that
 * matches nothing makes the rest look necessary.
 *
 * So: pull every selector out of the block and ask the live page how many elements each one matches.
 * A selector at zero is a candidate for deletion — a candidate, not a verdict, because a branch the
 * mock cannot render (projects, artifacts, attachments, the customize page) would also report zero.
 * The two are told apart by grepping the class out of the source afterwards.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { CHAT_URL } from './lib/chat-origin.mjs';
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;

const src = readFileSync(new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url), 'utf8');
/* The block is the run of `.chat-themed …` rules inside the component's own <style> literal. */
/* `\s*` before the brace, not nothing: the last selector of a rule is written `…"] {`, so a pattern
   demanding `[,{]` immediately after the bracket silently skipped one selector per rule — five of
   sixteen on the first run, which would have reported the seam swept while leaving rules behind. */
const selectors = [...src.matchAll(/^\s*(\.chat-themed (?:\[[^\]]+\] )?\[class\*="[^"]+"\])\s*[,{]/gm)].map((m) => m[1]);
const unique = [...new Set(selectors)];

const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });
const p = await b.newPage();
await p.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await p.waitForSelector('.chat-themed', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4200));

const counts = await p.evaluate((sels) => sels.map((s) => {
  try { return document.querySelectorAll(s).length; } catch { return -1; }
}), unique);
await b.close();

const rows = unique.map((s, i) => ({ sel: s, n: counts[i] }));
const live = rows.filter((r) => r.n > 0);
const zero = rows.filter((r) => r.n === 0);

console.log(`normalisation selectors: ${rows.length}   matching something: ${live.length}   matching nothing here: ${zero.length}\n`);
for (const r of live) console.log(`  ${String(r.n).padStart(3)}  ${r.sel}`);
console.log('');
for (const r of zero) {
  const cls = /\[class\*="([^"]+)"\]/.exec(r.sel)?.[1] ?? '';
  /* The class appears in this file at least once — inside the SELECTOR naming it. Anything above one
     is a real `className`. The first version of this check compared against zero and reported every
     dead rule as live. */
  const inSource = src.split(cls).length - 1 > 1;
  console.log(`    0  ${r.sel}   ${inSource ? 'class still written in this file' : 'CLASS GONE FROM SOURCE'}`);
}
console.log('\nA zero on the default chat is not proof: branches the mock cannot render report zero too.');
console.log('The right-hand column is what separates them.');

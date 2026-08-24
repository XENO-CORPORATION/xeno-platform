/*
 * The §9 findings deliberately left open for the owner, re-checked.
 *
 * An open finding decays two ways and both are silent: it gets fixed by someone else and nobody
 * closes the entry, or it gets WORSE and nobody notices because it was already "known". Prose in a
 * spec cannot tell you which. This asks the repo and the running chat instead.
 *
 * A confirmation is a result. So is discovering one has quietly become closeable.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { CHAT_URL } from './lib/chat-origin.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT = path.join(HERE, '../src/components/playground/Chat');
const LIB = path.join(HERE, '../../xeno-elements-foundations/packages/elements-react/src');
const req = createRequire('C:/code-dev/xeno-platform/package.json');
const puppeteer = (await import(pathToFileURL(req.resolve('puppeteer')).href)).default;

const chatSrc = readdirSync(CHAT)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => readFileSync(path.join(CHAT, f), 'utf8'))
  .join('\n');

/* 1. Two chat surface roles with no variant member. Closing this means the LIBRARY gaining a second
      control fill or a translucent wash — palette, which extends a LOCKED document. */
const libTheme = existsSync(path.join(LIB, 'xeno-theme.css')) ? readFileSync(path.join(LIB, 'xeno-theme.css'), 'utf8') : '';
const hasStrong = /--xeno-control-strong\s*:/.test(libTheme);
const hasOverlay = /--xeno-overlay\s*:/.test(libTheme);

/* 2. The blue cluster in SearchChatInterface — counted, because "some blue" is not a status. */
const blueClasses = (chatSrc.match(/(?:text|bg|border|ring|from|to)-blue-\d+(?:\/\d+)?/g) ?? []).length;
const blueLiterals = (chatSrc.match(/rgba?\((?:59, 130, 246|96 165 250)[^)]*\)/g) ?? []).length;

/*
 * 3. The three data- state hooks recomputed every render and read by nothing.
 *
 * The finding was posed as "these three should get a consumer or be deleted", and investigating it
 * showed both answers are wrong for all three. Two mirror `LEGACY_HOVER_TOOL_RAIL`, a hardcoded
 * `false` carrying a `: boolean` annotation so TypeScript will not call its branch dead — a feature
 * parked on purpose, whose state mirrors would have to be written again by whoever un-parks it. The
 * third, `data-percentage`, is an ANCHOR the two buckets could not hold: its value is computed, so it
 * read as state, but `index * STEP` never changes for the bar carrying it.
 *
 * So the question is no longer "is it read" — it is "does it say why not". Counting occurrences is
 * also what made this finding misreport: writing the reasons put the hook NAMES in prose, and two of
 * the three dropped off this list for having been explained. A mention in a comment is not a use.
 */
const REASONED = /Unread on purpose/;
const STATE_HOOKS = ['data-percentage', 'data-rail-open', 'data-active-tool'];
const stillUnread = STATE_HOOKS.filter((h) => {
  const at = chatSrc.indexOf(`${h}=`);
  if (at < 0) return false;
  return !REASONED.test(chatSrc.slice(Math.max(0, at - 1500), at));
});

/* 4. The light-theme collision: `elevated` == `canvas`, so a floating panel has no fill contrast. */
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1200, height: 800 } });
const tokens = {};
for (const theme of ['dark', 'dim', 'light']) {
  const p = await b.newPage();
  await p.evaluateOnNewDocument((t) => localStorage.setItem('xeno-chat-theme', t), theme);
  await p.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForSelector('.chat-themed', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4000));
  tokens[theme] = await p.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.chat-themed'));
    const g = (n) => cs.getPropertyValue(n).trim();
    return { canvas: g('--chat-canvas'), elevated: g('--chat-elevated'), control: g('--chat-control') };
  });
  await p.close();
}
await b.close();

const collisions = Object.entries(tokens)
  .map(([t, v]) => {
    const pairs = [];
    if (v.elevated === v.control) pairs.push('elevated==control');
    if (v.elevated === v.canvas) pairs.push('elevated==canvas');
    if (v.canvas === v.control) pairs.push('canvas==control');
    return `${t} ${pairs.length ? pairs.join(',') : 'none'}`;
  })
  .join('  |  ');

const say = (open, label, detail) => console.log(`  ${open ? 'OPEN  ' : 'CLOSED'} ${label.padEnd(42)} ${detail}`);
console.log('§9 findings left open for the owner, re-checked:\n');
say(!hasStrong && !hasOverlay, 'no variant member for 2 surface roles', `library declares control-strong: ${hasStrong}, overlay: ${hasOverlay}`);
say(blueClasses + blueLiterals > 0, 'blue cluster the theme does not reach', `${blueClasses} utility classes + ${blueLiterals} literal rgb()`);
say(stillUnread.length > 0, 'data- state hooks read by nothing', stillUnread.join(', ') || 'none');
say(collisions.includes('=='), 'surface tokens colliding per theme', collisions);
console.log('\nA confirmation is a result. If one of these has quietly become closeable, close it.');

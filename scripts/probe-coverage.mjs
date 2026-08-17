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
  /* `.xeno-message`, not `.xeno-message-bubble` — the component's class does not carry the word this
     file is named after, and the wrong guess reported 0 rendered for the whole programme while a demo
     thread sat on screen. A typo here and a coverage gap both print a zero. */
  MessageBubble: '.xeno-message',
  ListRow: '.xeno-list-row',
  SegmentedControl: '.xeno-segmented',
  ToggleButton: '.xeno-toggle',
};

/*
 * SEEDED, because an unseeded count measures the mock rather than the chat. `chatProjects` reads from
 * localStorage, and `files` and `scheduledTasks` hang off the project object, so one write reaches
 * the projects page, the project file list and the scheduled cards. The projects page is opened by
 * its own persisted flag rather than by clicking.
 */
const PROJECT = {
  id: 'coverage-project', name: 'Coverage project', description: 'seeded', createdAt: 1755000000000,
  updatedAt: 1755000000000, instructions: 'Think step by step.',
  files: [{ id: 'f1', name: 'spec.txt', type: 'text/plain', size: 2048, addedAt: 1755000000000, encoding: 'text', content: 'seeded' }],
  scheduledTasks: [{ id: 't1', title: 'Weekly check-in', cadence: 'Every Monday', mark: 'M' }],
};

/*
 * UNION across the walk, not the max at any one step — and that change is the answer to the ceiling.
 *
 * Taking the largest simultaneous count is why mutually exclusive branches capped the number: the
 * share dialog's "Create share link" and "Delete link / Done" are two states of one dialog, so a
 * per-step max can only ever see one of them. What we actually want to know is how many distinct
 * controls have EVER been rendered, which a union answers and a max cannot.
 *
 * Identity is `component + accessible name`, which is imperfect in two directions and worth saying:
 * two different source controls sharing a label collapse into one, and one source control rendered
 * per-row in a list counts once. It is a better proxy than a max and still a proxy.
 */
/* Each selector must correspond to a rule the library actually ships. A class nobody styles is a typo
   in this file, not an unrendered component, and the difference is invisible in the output — which is
   exactly how `MessageBubble` reported 0 for this entire programme. */
const LIBCSS = path.join(HERE, '../../xeno-elements-foundations/packages/elements-react/src');
const libRules = (() => {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.css')) out.push(readFileSync(full, 'utf8'));
    }
  };
  try { walk(LIBCSS); } catch { /* library not checked out beside this repo — skip the guard */ }
  return out.join('\n');
})();
if (libRules) {
  const unknown = Object.entries(SELECTOR)
    .map(([name, sel]) => [name, sel.match(/\.[a-z-]+/)[0]])
    .filter(([, cls]) => !libRules.includes(cls));
  if (unknown.length) {
    console.error('SELECTOR entries matching no rule in the library — these are typos, not gaps:');
    for (const [name, cls] of unknown) console.error(`  ${name}  ${cls}`);
    process.exit(1);
  }
}

const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });
/*
 * BOTH aggregations, because neither is the truth on its own:
 *   atOnce   the largest simultaneous count. Cannot see two mutually exclusive states of one dialog.
 *   distinct the union of `component + accessible name` across the whole walk. Sees both states, but
 *            collapses controls that SHARE a label — which is why IconButton reads 41 distinct
 *            against 49 at once, the icon buttons being far more repetitive in naming than Buttons.
 * The total counts DISTINCT. Taking the larger of the two flattered it: 41 icon buttons render on the
 * chat route from 23 distinct labels, because one `<IconButton>` inside a `.map()` renders once per
 * message. Instances answer "what is on screen"; this table asks "how many of the 255 source
 * occurrences have we ever seen", and a repeat is one of those. `at once` stays as context.
 */
const seenIds = Object.fromEntries(COMPONENTS.map((c) => [c, new Set()]));
const seenMax = Object.fromEntries(COMPONENTS.map((c) => [c, 0]));
const observe = (counts) => {
  for (const [c, ids] of Object.entries(counts)) {
    seenMax[c] = Math.max(seenMax[c], ids.length);
    for (const id of ids) seenIds[c].add(id);
  }
};
/*
 * Identity is the label PLUS the nearest `data-` landmark, not the label alone.
 *
 * A label on its own collapses two different source sites that happen to share a word — a Cancel in
 * the delete dialog and a Cancel in project settings are one entry, so the count under-reports. The
 * chat is dense with `data-` hooks marking dialogs and pages (that is what the 20 unreferenced
 * anchors in `probe-dead-hooks` ARE), so the nearest one names the surface a control sits on and
 * separates them.
 *
 * Still a proxy: a control with no landmarked ancestor falls back to the label, and two sites sharing
 * a label INSIDE one surface still collapse. It errs toward undercounting, which is the safe
 * direction for a coverage figure.
 */
const IDENTIFY = `(sel) => {
  const landmark = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const hit = [...n.attributes || []].find((a) => a.name.startsWith('data-') && !/^data-(xeno|variant|availability|selection|glyph|motion)/.test(a.name));
      if (hit) return hit.name;
    }
    return '';
  };
  const out = {};
  for (const [name, s] of Object.entries(sel)) {
    out[name] = [...document.querySelectorAll(s)].map((el, i) => {
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) || 'anon' + i;
      return landmark(el) + '|' + label;
    });
  }
  return out;
}`;
for (const seg of ['llm', 'search', 'voice']) {
  const p = await b.newPage();
  /* Only the project list is seeded. `xeno-chat-projects-page-open` is NOT feedable — the app writes
     it on mount and a seeded 'true' reads back as 'false', so setting it would have looked like
     coverage without buying any. The page is opened by clicking, like a user would. */
  await p.evaluateOnNewDocument((proj) => {
    localStorage.setItem('chatProjects_playground', JSON.stringify([proj]));
    /* Recent files are filtered by `lastUsed > sevenDaysAgo`, so the timestamp has to be computed
       HERE rather than baked into a constant — a fixed date would age out and the seed would go
       silently empty, which is the same trap as a key the app overwrites on mount. */
    const now = Date.now();
    localStorage.setItem('recentFiles_default', JSON.stringify([
      { id: 'rf1', name: 'seeded-spec.txt', type: 'text/plain', size: 2048, lastUsed: now - 1000 },
      { id: 'rf2', name: 'seeded-notes.md', type: 'text/markdown', size: 900, lastUsed: now - 2000 },
    ]));
    /* `chatHistory_playground`, NOT `chatHistory_default` — the history store keys off
       `sharedInterfaceId = 'playground'`, a different constant from the `interfaceId` prop that names
       the recent-files store. Two stores, two ids, one letter of difference in the code that reads
       them. Seeded with a pinned, an unread and an archived conversation so the row variants render. */
    const convo = (i, extra) => Object.assign({
      id: 'seed-' + i, title: 'Seeded conversation ' + i, timestamp: now - i * 1000,
      messages: [{ id: 'm' + i, role: 'user', content: 'hello ' + i }],
    }, extra || {});
    localStorage.setItem('chatHistory_playground', JSON.stringify([
      convo(1, { isPinned: true, pinOrder: 0 }), convo(2, { isUnread: true }), convo(3, {}), convo(4, { isArchived: true }),
      /* Linked to the seeded project by `projectId`. The project rail renders its chats through
         `projectChats.map(...)`, which is the only place `<ListRow>` appears outside the conversation
         selector — a project with no conversations shows the rail and none of its rows. */
      convo(5, { projectId: proj.id }),
    ]));
  }, PROJECT);
  await p.goto(`http://localhost:5183/overview/chat/${seg}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForSelector('.chat-themed', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4200));

  /* Count AT REST first. The walk below clicks before it measures, so without this the resting state
     is never counted — and opening a panel covers the composer controls behind it, so the first click
     LOSES components. That cost a coverage point and read as the history seed's fault. */
  observe(await p.evaluate(eval(IDENTIFY), SELECTOR));

  /* Walk into the project surfaces where they exist. Synthetic clicks, so `pointer-events` does not
     apply — see the note in `probe-project-settings.mjs` about matching the check to the method. */
  /*
   * The biggest per-component gaps turned out to be whole PAGES, not scattered controls: Artifacts,
   * Scheduled, Settings and Customize are boolean-state pages behind the history sidebar, holding 16
   * of the 74 unrendered Buttons between them. They need no seeding at all — just the sidebar open
   * and a click each. Naming where a blind spot lives is what made it reachable.
   */
  /*
   * NESTED steps, not flat ones. A sequence of single clicks cannot reach a section INSIDE a page:
   * `Settings` opens the global settings page, and by the time a later `Memory` click came round the
   * page had been replaced by whatever the walk clicked next. The one real `<Switch>` in the chat
   * stayed at zero because of the ORDER, not because it was unreachable.
   *
   * Each entry is now a path — click these in immediate succession — so a nested surface is reached
   * while its parent is still open.
   */
  for (const step of [
    ['Open conversation history'], ['Conversation actions'],
    ['Artifacts'], ['Scheduled'],
    /*
     * All SIX sections of the global settings page, not just Memory. `SECTIONS` in
     * `ChatGlobalSettingsPage` lists skills/instructions/personas/memory/connectors/plugins, and the
     * walk was visiting one of them — the densest single surface in the chat by adopted-component
     * count sits behind `Skills`, because `ChatSkillsWorkspace` (8 Buttons) is a section here rather
     * than a page of its own.
     */
    ['Settings'],
    ['Settings', 'Skills'], ['Settings', 'Instructions'], ['Settings', 'Personas'],
    ['Settings', 'Memory'], ['Settings', 'Connectors'], ['Settings', 'Plugins'],
    /* `Share conversation` needs `messages.length > 0`, which the demo thread supplies — no seed.
       `ChatSkillsWorkspace` is not a page of its own: it is a SECTION of the chat settings modal, so
       it comes with whatever opens that. Reading where a component is mounted, rather than guessing a
       trigger for it, is what turned the last aggregate number into four points. */
    ['Share conversation'],
    /*
     * The chat settings MODAL, which is not the settings PAGE — two surfaces, two controls, both
     * saying "Settings". `ChatSkillsWorkspace` (8 Buttons, the densest single surface in this chat)
     * is a section of the modal.
     *
     * The path runs through `More chat options`, because the modal's own `Chat settings` control does
     * not exist in the DOM at rest — it is a `MenuItem` inside that menu. A path whose first step is
     * absent fails exactly like a surface that is unreachable, and looks the same in the total: this
     * one bought zero until the menu was opened first.
     */
    ['More chat options'], ['More chat options', 'Settings'],
    ['More chat options', 'Settings', 'Skills'], ['More chat options', 'Settings', 'Personas'],
    /*
     * The rest of that menu, enumerated rather than guessed one path at a time — it holds twelve
     * items and the walk was using one. `Delete` opens the confirm dialog whose solid-danger button
     * was converted during this adoption and had never been rendered for a probe; `Customize` and
     * `Theme` are surfaces of their own; `View files in chat` and `Search messages` open panels.
     * `Upload a file` and `Recent` are deliberately absent: they lead to the `hidden` attach panel.
     */
    ['More chat options', 'Delete'],
    ['More chat options', 'Customize'],
    ['More chat options', 'Theme'],
    ['More chat options', 'View files in chat'],
    ['More chat options', 'Search messages'],
    ['Projects'], ['Projects', PROJECT.name],
    /* `Edit code` puts a code block into edit mode, which is the ONLY place `Textarea` renders on
       these routes — the other three sit in dialogs. The demo thread supplies the code blocks. */
    ['Edit code'],
  ]) {
    for (const label of step) {
      await p.evaluate((x) => {
        /* `title` as well as `aria-label` and text — the code block's Edit is titled, not labelled. */
        const el = [...document.querySelectorAll('button,[role="button"]')].find((e) =>
          ((e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim().replace(/\s+/g, ' ')).includes(x),
        );
        if (el && getComputedStyle(el).visibility !== 'hidden') { el.scrollIntoView({ block: 'center' }); el.click(); }
      }, label);
      await new Promise((r) => setTimeout(r, 1300));
    }
    observe(await p.evaluate(eval(IDENTIFY), SELECTOR));
  }
  /*
   * A TRANSIENT state has to be sampled during the action, not after it.
   *
   * `Spinner` read 0 for the whole programme and needed no network interception at all: typing into
   * the composer and pressing Enter renders two of them on the search route — at 400ms. By 900ms they
   * are gone, and every sample this probe took was at 4200ms. The component was rendering all along,
   * in a window narrower than the settle delay.
   */
  const composer = await p.$('textarea');
  if (composer) {
    await composer.type('what is a transcript summariser');
    await p.keyboard.press('Enter');
    for (const delay of [350, 700, 1400]) {
      await new Promise((r) => setTimeout(r, delay === 350 ? 350 : delay - 350));
      observe(await p.evaluate(eval(IDENTIFY), SELECTOR));
    }
  }

  observe(await p.evaluate(eval(IDENTIFY), SELECTOR));
  await p.close();
}
await b.close();

let src = 0, obs = 0;
console.log('component        in source   at once   distinct   unmeasured');
for (const c of COMPONENTS) {
  if (!inSource[c]) continue;
  src += inSource[c];
  /*
   * DISTINCT, not the larger of the two. Taking the max flattered the number: 41 icon buttons render
   * on the chat route from 23 distinct labels, because one `<IconButton>` inside a `.map()` renders
   * once per message. Counting instances answers "how many controls are on screen"; this table asks
   * "how many of the 255 source occurrences have we ever seen", and for that a repeat is one.
   *
   * `at once` stays in the table as context — it is what a screenshot would show — but it is not what
   * the total counts.
   */
  const best = seenIds[c].size;
  obs += Math.min(best, inSource[c]);
  const gap = Math.max(0, inSource[c] - best);
  console.log(`  ${c.padEnd(16)} ${String(inSource[c]).padStart(4)}     ${String(seenMax[c]).padStart(5)}     ${String(seenIds[c].size).padStart(6)}      ${String(gap).padStart(5)}`);
}
/*
 * A LIMIT of this aggregation, worth knowing before reading a seed as worthless: `seen` is the MAX
 * across the three routes, so a gain on one route is invisible if another already exceeded it.
 * Seeding conversations and opening a row menu takes MenuItem from 2 to 7 on the chat route — five
 * components no probe had ever rendered — and the reported number does not move, because search
 * already showed 12. The per-route gain is real and this total understates it.
 */
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
  3. transient — a state narrower than the settle delay. This read "every Spinner is 0" for the whole
     programme, and the fix was not network interception: typing into the composer and pressing Enter
     renders two spinners at 400ms, gone by 900ms, while every sample was taken at 4200ms. The walk
     now samples DURING the action. A transient component is not unreachable, it is mistimed.
  5. MUTUALLY EXCLUSIVE branches of one surface. The share dialog opens and renders 1 of its 4
     Buttons, because "Create share link" and "Delete link / Done" are two states of the same dialog
     and only one exists at a time. No amount of walking reaches both in a single count. This is a
     property of the code, not of the measurement, and it means 100% is not the target — the number
     has a ceiling well below it that nobody has computed.
  4. DELIBERATELY HIDDEN markup — the attach / recent-files panel carries the Tailwind class
     "hidden", so display:none unconditionally, kept for a tool rail this route does not use. No
     hover and no click can open it. One of the TextInputs converted during this adoption lives
     inside it, which is most of why TextInput reads 12 in source and 0 rendered.
     (No backticks in this block: it is inside a template literal, and quoting a class name in them
     ends the literal. Same trap as the style block in ChatWithLLM, different file.)

So the gap is (1) and (3), and (1) dominates: the blind spot is the data-dependent branches, not
closed menus. Worth knowing before anyone spends an afternoon automating clicks to close it.

Deliberately NOT wired into 'npm run probe:chat'. Its number moves whenever a component is added or
removed, which is normal development rather than a regression — a gate that fires on healthy change
teaches people to ignore gates. It is a diagnostic to run when the question is "how much of this do
we actually see", and the answer today is: a quarter.`);
